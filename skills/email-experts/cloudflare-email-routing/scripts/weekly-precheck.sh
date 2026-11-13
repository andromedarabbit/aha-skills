#!/usr/bin/env bash
# weekly-precheck.sh - orca 자동화 --precheck 진입점. 주간 보고(헬스체크 + 수신 실패)를 LLM 없이 만든다.
#
# Usage: weekly-precheck.sh --zone <domain> --baseline <json> --mode cli|agent [--events-file <json>] [--dry-run]
#
# 모드 스위치:
#   cli    스크립트가 보고서를 만들어 NOTIFY_TO 로 발송하고 끝낸다. 에이전트를 띄우지 않는다.
#   agent  판정이 필요한 건(후보 유형의 미배달 메시지, 점검 이상, 조회 오류)이 있을 때만 에이전트를 띄운다.
#          없으면 cli 와 같이 발송하고 끝낸다. 띄울 때는 발송하지 않는다 — 에이전트가 판정을 덧붙여 1건만 보낸다.
#
# 보고서는 고정 경로에 남긴다: ${XDG_CACHE_HOME:-~/.cache}/cloudflare-email-routing/weekly-<zone>.md
#
# exit 0  에이전트를 띄운다 (orca precheck 계약: 0 이면 실행)
# exit 1  에이전트를 띄우지 않는다 (보고 완료 또는 보고할 것 없음)
# exit 2  사용 오류 (orca 는 스킵하지만 stderr 에 사유를 남긴다)
#
# 통지가 실패하면(notify.sh 비정상 종료) 아무도 모르게 끝나지 않도록 exit 0 으로 에이전트를 띄워 카드에 남기게 한다.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  sed -n '2,3p' "$0" >&2
  exit 2
}

need_value() {
  [[ $# -ge 2 ]] || { echo "사용 오류: $1 에 값이 필요하다" >&2; usage; }
}

ZONE=""
BASELINE=""
MODE=""
EVENTS_FILE=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --zone) need_value "$@"; ZONE="$2"; shift 2 ;;
    --baseline) need_value "$@"; BASELINE="$2"; shift 2 ;;
    --mode) need_value "$@"; MODE="$2"; shift 2 ;;
    --events-file) need_value "$@"; EVENTS_FILE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage ;;
    *) echo "알 수 없는 옵션: $1" >&2; usage ;;
  esac
done

[[ -n "$ZONE" && -n "$BASELINE" ]] || usage
[[ "$MODE" == "cli" || "$MODE" == "agent" ]] || { echo "사용 오류: --mode 는 cli 또는 agent" >&2; usage; }

# cf 는 실행 위치에 .cloudflare/ 캐시를 만든다. 호출 위치(저장소·노트 폴더)를 더럽히지 않도록 캐시 디렉터리로 옮겨 실행하므로 경로는 절대 경로여야 한다
[[ "$BASELINE" == /* && ( -z "$EVENTS_FILE" || "$EVENTS_FILE" == /* ) ]] || { echo "사용 오류: --baseline, --events-file 은 절대 경로" >&2; usage; }

CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/cloudflare-email-routing"
mkdir -p "$CACHE_DIR" || { echo "사용 오류: 캐시 디렉터리를 만들 수 없다 ($CACHE_DIR)" >&2; exit 2; }
cd "$CACHE_DIR" || exit 2
REPORT="$CACHE_DIR/weekly-$ZONE.md"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/wpc.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# 두 점검은 서로 독립이다. 한쪽이 환경 오류여도 다른 쪽 결과는 보고에 남긴다
bash "$HERE/healthcheck.sh" --zone "$ZONE" --baseline "$BASELINE" --md-out "$WORK/hc.md" >/dev/null 2>"$WORK/hc.err"
hc_rc=$?

fr_args=(--zone "$ZONE" --days 7 --md-out "$WORK/fr.md")
[[ -z "$EVENTS_FILE" ]] || fr_args+=(--events-file "$EVENTS_FILE")
"$HERE/failure_report.py" "${fr_args[@]}" >/dev/null 2>"$WORK/fr.err"
fr_rc=$?

section() { # <제목> <본문 파일> <오류 파일> <종료 코드>
  echo "## $1"
  if [[ -s "$2" ]]; then
    sed '1d' "$2"
    return
  fi
  echo "환경 오류: $(head -c 300 "$3" 2>/dev/null)"
}

{
  echo "# 이메일 주간 보고 — $ZONE ($(date +%Y-%m-%d))"
  echo
  section "헬스체크 (C1~C8)" "$WORK/hc.md" "$WORK/hc.err"
  echo
  section "수신 실패 (최근 7일)" "$WORK/fr.md" "$WORK/fr.err"
} >"$REPORT"

fail_events="$(grep -oE '실패 이벤트 [0-9]+건' "$WORK/fr.md" 2>/dev/null | grep -oE '[0-9]+' | head -1)"
subject="[email 주간 보고] $ZONE 실패 ${fail_events:-0}건"
[[ "$hc_rc" == 1 ]] && subject="$subject · 점검 이상"
[[ "$hc_rc" == 2 || "$fr_rc" == 2 ]] && subject="$subject · 조회 오류"

# agent 모드에서 판정이 필요한 건이 있으면 발송하지 않고 에이전트에게 넘긴다
if [[ "$MODE" == "agent" ]] && { [[ "$fr_rc" != 0 ]] || [[ "$hc_rc" != 0 ]]; }; then
  echo "에이전트 판정 필요 (healthcheck=$hc_rc failure_report=$fr_rc) — 보고서: $REPORT"
  exit 0
fi

notify_args=(--subject "$subject" --body-file "$REPORT")
[[ "$DRY_RUN" == false ]] || notify_args+=(--dry-run)
if bash "$HERE/notify.sh" "${notify_args[@]}"; then
  echo "보고 발송 완료 (mode=$MODE) — 보고서: $REPORT"
  exit 1
fi
echo "통지 실패 — 에이전트가 카드에 기록해야 한다. 보고서: $REPORT" >&2
exit 0
