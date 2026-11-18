#!/bin/bash
# post-state.sh - 게시 작업 상태·승인 영수증을 읽고 쓴다.
#
# Usage:
#   post-state.sh activate <job-dir>     # 작업 디렉토리를 만들고 활성 포인터 기록
#   post-state.sh get [<key>]            # 영수증 전체 JSON 또는 값 하나
#   post-state.sh set <key> <value>      # posted_* 키만 기록 가능
#   post-state.sh unset <key>            # posted_* 키만 무효화
#   post-state.sh digest <platform>      # 현재 drafts/<platform>.md의 sha256
#   post-state.sh ready <platform>       # Ready 판정식 판정 (일치하면 exit 0)
#   post-state.sh clear                  # 영수증 폐기
#
# 영수증 키:
#   approved_digests  승인 시점 플랫폼별 초안 sha256 ({x: "...", linkedin: "..."})
#   approved_at       승인 시각
#   approved_via      누가 기록했는지 (posttooluse-hook만 유효)
#   posted_<platform> 게시 완료 후의 게시물 URL
#   posted_<platform>_at  위 기록 시각 (set이 자동 동반)
#
# **approved_* 세 키는 이 CLI로 set/unset할 수 없다.** 에이전트가 실제
# AskUserQuestion 없이 승인을 "자기 신고"하는 경로를 원천 막는다 —
# record-approval.sh 훅(PostToolUse, matcher: AskUserQuestion)만 lib/receipt.sh의
# 기록 함수를 직접 호출한다. 에이전트는 get으로 읽을 수만 있다.
#
# 작업 디렉토리 해석: SOCIAL_POSTING_JOB 환경변수 > 활성 포인터(activate가 기록).
# publish.sh는 --job 인자로 직접 지정한다.
#
# Exit: 0 성공 / 1 사용법·검증 실패 / ready 판정 불일치

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/lib/receipt.sh
source "$SCRIPT_DIR/lib/receipt.sh"

usage() {
  cat >&2 <<'EOF'
사용법:
  post-state.sh activate <job-dir>
  post-state.sh get [<key>]
  post-state.sh set <key> <value>        (posted_* 만 가능)
  post-state.sh unset <key>              (posted_* 만 가능)
  post-state.sh digest <platform>
  post-state.sh ready <platform>
  post-state.sh clear

영수증 키: approved_digests, approved_at, approved_via, posted_*,
  posted_*_at (set이 자동 기록)
  (approved_*는 record-approval.sh 훅만 기록합니다)
EOF
}

die() {
  echo "$1" >&2
  exit 1
}

is_approved_key() {
  [[ "$1" == approved_* ]]
}

is_readable_key() {
  is_approved_key "$1" || [[ "$1" == posted_* ]]
}

is_settable_key() {
  [[ "$1" == posted_* ]] && [[ "$1" != *_at ]]
}

timestamp_field_for() {
  [[ "$1" == posted_* ]] && printf '%s_at' "$1" || printf ''
}

cmd_activate() {
  [[ $# -ge 1 ]] || die "activate 는 <job-dir> 가 필요합니다"
  local job="$1"
  mkdir -p "$job/drafts"
  local abs
  abs="$(cd "$job" && pwd)"
  printf '%s\n' "$abs" >"$(receipt_pointer_path)"
  echo "활성 작업: $abs"
}

cmd_get() {
  if [[ $# -eq 0 ]]; then
    receipt_read | jq -c '.'
    return 0
  fi
  local key="$1"
  is_readable_key "$key" || die "조회 가능한 키가 아닙니다: $key (approved_*, posted_* 만 조회할 수 있습니다)"
  receipt_get ".${key} // \"\""
}

cmd_set() {
  [[ $# -ge 2 ]] || die "set 은 <key> <value> 가 필요합니다"
  local key="$1" value="$2"
  if is_approved_key "$key"; then
    die "'$key'는 이 CLI로 기록할 수 없습니다 — record-approval.sh 훅(PostToolUse, matcher: AskUserQuestion)만 기록합니다. 실제 AskUserQuestion으로 사용자 승인을 받으세요."
  fi
  is_settable_key "$key" || die "기록 가능한 키가 아닙니다: $key (posted_<platform> 만 가능)"
  [[ -n "$value" ]] || die "값이 비어 있습니다: $key"

  receipt_set "$key" "$value" || die "영수증 기록 실패: $key"

  local ts_field
  ts_field="$(timestamp_field_for "$key")"
  if [[ -n "$ts_field" ]]; then
    receipt_set "$ts_field" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" || die "타임스탬프 기록 실패"
  fi
}

cmd_unset() {
  [[ $# -ge 1 ]] || die "unset 은 <key> 가 필요합니다"
  local key="$1"
  if is_approved_key "$key"; then
    die "'$key'는 이 CLI로 무효화할 수 없습니다 — record-approval.sh 훅만 관리합니다."
  fi
  is_settable_key "$key" || die "무효화 가능한 키가 아닙니다: $key"
  receipt_unset "$key" || die "영수증 무효화 실패: $key"

  local ts_field
  ts_field="$(timestamp_field_for "$key")"
  if [[ -n "$ts_field" ]]; then
    receipt_unset "$ts_field" || die "타임스탬프 무효화 실패"
  fi
}

cmd_digest() {
  [[ $# -ge 1 ]] || die "digest 는 <platform> 이 필요합니다"
  local platform="$1" job
  job="$(receipt_job_dir)" || die "활성 작업을 찾을 수 없습니다 — activate 먼저 실행하세요"
  local draft="${job%/}/drafts/${platform}.md"
  [[ -f "$draft" ]] || die "초안 파일이 없습니다: $draft"
  hash_file "$draft"
}

cmd_ready() {
  [[ $# -ge 1 ]] || die "ready 는 <platform> 이 필요합니다"
  if receipt_digest_matches "$1"; then
    echo "ready: $1"
    return 0
  fi
  echo "not ready: $1 (승인 digest가 없거나 현재 초안과 일치하지 않습니다 — Stage 8 승인을 다시 받으세요)" >&2
  return 1
}

cmd_clear() {
  local p
  p="$(receipt_path)" || die "활성 작업을 찾을 수 없습니다"
  rm -f "$p"
}

main() {
  [[ $# -ge 1 ]] || { usage; exit 1; }
  local sub="$1"
  shift
  case "$sub" in
    activate) cmd_activate "$@" ;;
    get) cmd_get "$@" ;;
    set) cmd_set "$@" ;;
    unset) cmd_unset "$@" ;;
    digest) cmd_digest "$@" ;;
    ready) cmd_ready "$@" ;;
    clear) cmd_clear ;;
    --help|-h) usage; exit 0 ;;
    *) echo "알 수 없는 서브커맨드: $sub" >&2; usage; exit 1 ;;
  esac
}

main "$@"
