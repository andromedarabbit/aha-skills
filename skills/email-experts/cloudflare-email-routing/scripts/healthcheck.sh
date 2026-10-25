#!/usr/bin/env bash
# healthcheck.sh - 메일 인증·라우팅 헬스체크 C1~C7. 읽기 전용 동사만 쓴다.
#
# Usage: healthcheck.sh --zone <domain> --baseline <json> [--json] [--md-out <path>]
#
# exit 0  정상
# exit 1  이상(체크 실패) — 호출자가 notify.sh로 통지
# exit 2  환경 오류(의존성 부재, baseline 불량, cf 인증 만료 등) — dig 체크 결과는 계속 보고
#
# dig 체크(C1~C5)는 cf 없이 돈다. cf 체크(C6)가 환경 오류면 exit 2로 끝나되 나머지는 그대로 출력한다.

set -uo pipefail

usage() {
  sed -n '2,8p' "$0" >&2
  exit 2
}

ZONE=""
BASELINE=""
AS_JSON=false
MD_OUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --zone) ZONE="${2:-}"; shift 2 ;;
    --baseline) BASELINE="${2:-}"; shift 2 ;;
    --json) AS_JSON=true; shift ;;
    --md-out) MD_OUT="${2:-}"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "알 수 없는 옵션: $1" >&2; usage ;;
  esac
done

[[ -n "$ZONE" && -n "$BASELINE" ]] || usage

for dep in dig jq; do
  if ! command -v "$dep" >/dev/null 2>&1; then
    echo "환경 오류: $dep 없음" >&2
    exit 2
  fi
done

if ! jq -e '.zone and .dmarc.policy and .spf and .dkim.selector and .mx and .routing.rule_count != null' "$BASELINE" >/dev/null 2>&1; then
  echo "환경 오류: baseline 스키마 불일치 (assets/baseline-schema.json 참조)" >&2
  exit 2
fi

if [[ "$(jq -r '.zone' "$BASELINE")" != "$ZONE" ]]; then
  echo "환경 오류: baseline.zone 과 --zone 이 다르다" >&2
  exit 2
fi

RESULTS="$(mktemp "${TMPDIR:-/tmp}/ehc.XXXXXX")"
trap 'rm -f "$RESULTS"' EXIT
ENV_ERROR=0

# record <id> <name> <ok|fail|error> <expected> <actual>
record() {
  printf '%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" "$5" >> "$RESULTS"
  if [[ "$3" == "error" ]]; then ENV_ERROR=1; fi
}

txt() { dig +short TXT "$1" | tr -d '"'; }

# C1: _dmarc TXT는 정확히 1개
dmarc_raw="$(dig +short TXT "_dmarc.$ZONE")"
dmarc_count="$(grep -c . <<<"$dmarc_raw" || true)"
if [[ "$dmarc_count" == "1" ]]; then c1=ok; else c1=fail; fi
record C1 "_dmarc TXT 개수" "$c1" "1" "$dmarc_count"

# C2: DMARC 정책 == baseline + rua 존재
dmarc_rec="$(tr -d '"' <<<"$dmarc_raw" | head -1)"
dmarc_policy="$(grep -oE '(^|;)[[:space:]]*p=[a-z]+' <<<"$dmarc_rec" | head -1 | sed 's/.*p=//')"
expected_policy="$(jq -r '.dmarc.policy' "$BASELINE")"
has_rua=false
grep -q 'rua=' <<<"$dmarc_rec" && has_rua=true
if [[ "$dmarc_policy" == "$expected_policy" && "$has_rua" == true ]]; then c2=ok; else c2=fail; fi
record C2 "DMARC 정책·rua" "$c2" "p=$expected_policy + rua" "p=${dmarc_policy:-none} rua=$has_rua"

# C3: SPF TXT == baseline
spf_list="$(txt "$ZONE" | grep '^v=spf1' || true)"
spf_count="$(grep -c . <<<"$spf_list" || true)"
expected_spf="$(jq -r '.spf' "$BASELINE")"
if [[ "$spf_count" == "1" && "$spf_list" == "$expected_spf" ]]; then c3=ok; else c3=fail; fi
record C3 "SPF TXT" "$c3" "$expected_spf" "$spf_list"

# C4: DKIM 셀렉터 TXT 존재
selector="$(jq -r '.dkim.selector' "$BASELINE")"
dkim_present="$(txt "${selector}._domainkey.$ZONE" | grep -c . || true)"
if [[ "$dkim_present" -ge 1 ]]; then c4=ok; else c4=fail; fi
record C4 "DKIM 셀렉터 $selector" "$c4" "존재" "레코드 ${dkim_present}개"

# C5: MX 집합 == baseline
actual_mx="$(dig +short MX "$ZONE" | awk '{print $2}' | sed 's/\.$//' | sort | paste -sd, -)"
expected_mx="$(jq -r '.mx | sort | join(",")' "$BASELINE")"
if [[ "$actual_mx" == "$expected_mx" ]]; then c5=ok; else c5=fail; fi
record C5 "MX 집합" "$c5" "$expected_mx" "$actual_mx"

# C6: Email Routing 활성 + 규칙 수 == baseline (cf 의존, 실패 시 환경 오류)
if ! command -v cf >/dev/null 2>&1; then
  record C6 "Email Routing 상태" error "활성 + 규칙 ${expected_rules:-?}" "cf 없음"
else
  settings="$(cf email-routing settings get -z "$ZONE" 2>/dev/null || true)"
  enabled="$(jq -r '.enabled // empty' <<<"$settings" 2>/dev/null || true)"
  rules="$(cf email-routing rules list -z "$ZONE" 2>/dev/null || true)"
  rule_count="$(jq -r 'if type=="array" then length else empty end' <<<"$rules" 2>/dev/null || true)"
  expected_rules="$(jq -r '.routing.rule_count' "$BASELINE")"
  if [[ -z "$enabled" || -z "$rule_count" ]]; then
    record C6 "Email Routing 상태" error "활성 + 규칙 $expected_rules" "cf 조회 실패(인증 만료 가능)"
  elif [[ "$enabled" == "true" && "$rule_count" == "$expected_rules" ]]; then
    record C6 "Email Routing 상태" ok "활성 + 규칙 $expected_rules" "활성 + 규칙 $rule_count"
  else
    record C6 "Email Routing 상태" fail "활성 + 규칙 $expected_rules" "enabled=$enabled 규칙 $rule_count"
  fi
fi

# C7: 드리프트 요약 — C2~C6 중 baseline과 다른 항목 수
drift="$(awk -F'\t' '$1 ~ /^C[2-6]$/ && $3 != "ok" {n++} END {print n+0}' "$RESULTS")"
if [[ "$drift" == "0" ]]; then record C7 "baseline 드리프트" ok "0" "0"; else record C7 "baseline 드리프트" fail "0" "$drift"; fi

fail_count="$(awk -F'\t' '$3 == "fail" {n++} END {print n+0}' "$RESULTS")"
ok_count="$(awk -F'\t' '$3 == "ok" {n++} END {print n+0}' "$RESULTS")"

render_md() {
  echo "# cloudflare-email-routing 점검 — $ZONE"
  echo
  echo "| 체크 | 항목 | 기대값 | 실제값 | 결과 |"
  echo "|---|---|---|---|---|"
  awk -F'\t' '{
    mark = ($3=="ok") ? "✅" : ($3=="fail") ? "❌" : "⚠️"
    printf "| %s | %s | %s | %s | %s |\n", $1, $2, $4, $5, mark
  }' "$RESULTS"
  echo
  echo "요약: 정상 ${ok_count}건 / 이상 ${fail_count}건"
}

if [[ "$AS_JSON" == true ]]; then
  jq -Rn --arg zone "$ZONE" '
    [inputs | split("\t") | {id: .[0], name: .[1], status: .[2], expected: .[3], actual: .[4]}]
    | {zone: $zone, results: .}' < "$RESULTS"
else
  render_md
fi

if [[ -n "$MD_OUT" ]]; then
  render_md > "$MD_OUT"
fi

if [[ "$ENV_ERROR" == 1 ]]; then exit 2; fi
if [[ "$fail_count" -gt 0 ]]; then exit 1; fi
exit 0
