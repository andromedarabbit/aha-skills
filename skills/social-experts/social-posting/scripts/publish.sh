#!/bin/bash
# publish.sh - 게시의 유일한 진입점. 직접 aside exec를 호출하지 말고 이 스크립트를 경유한다.
#
# 게시 직전 4중 가드 (전부 이 스크립트가 강제 — 훅은 편의일 뿐, 강제력은 여기 있다):
#   1. 플랫폼이 job-state.md의 platforms 안에 있는가 (Stage 2에서 사용자가 고른 대상)
#   2. Ready 판정식 — approved_digests에 해당 플랫폼이 있고 drafts/<platform>.md의
#      sha256과 일치 (승인 후 초안이 바뀌면 거부 = 실패-닫힘 가드)
#   3. 하드 제약 재실행 (check-drafts.py, 이중 검사)
#   4. 계정 — job-state.md accounts에서 해당 플랫폼 계정만 읽는다 (사용자가 Stage 2에서
#      지정한 값 외에는 애초에 입력 경로가 없다)
#
# 통과하면 초안을 mktemp 0400 동결 파일로 만들어 aside exec에 **변경·요약 없이 그대로
# 게시**를 지시한다. 게시 결과(URL)의 영수증 기록은 Stage 10 read-back 이후
# post-state.sh set posted_<platform> <url>로 에이전트가 한다.
#
# Usage:
#   publish.sh --job <job-dir> --platform <x|linkedin|facebook|bluesky> [--dry-run]
# --dry-run: 가드만 통과시키고 aside는 호출하지 않는다 (게시 직전 확인용).
#
# Exit: 0 게시 지시 완료 / 1 가드 거부·실패 (fail-closed)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/lib/receipt.sh
source "$SCRIPT_DIR/lib/receipt.sh"

usage() {
  cat >&2 <<'EOF'
사용법:
  publish.sh --job <job-dir> --platform <x|linkedin|facebook|bluesky> [--dry-run]
EOF
}

die() {
  echo "❌ $1" >&2
  exit 1
}

job=""
platform=""
dry_run=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --job) job="${2:?}"; shift 2 ;;
    --platform) platform="${2:?}"; shift 2 ;;
    --dry-run) dry_run=true; shift ;;
    *) usage; exit 1 ;;
  esac
done
[[ -n "$job" && -n "$platform" ]] || { usage; exit 1; }
job="${job%/}"

STATE_FILE="$job/job-state.md"
[[ -f "$STATE_FILE" ]] || die "job-state.md가 없습니다: $STATE_FILE"
DRAFT="$job/drafts/$platform.md"
[[ -f "$DRAFT" ]] || die "초안이 없습니다: $DRAFT"

# 가드·digest 계산이 --job 인자 기준으로 동작하게 환경 고정
export SOCIAL_POSTING_JOB="$job"
export SOCIAL_POSTING_RECEIPT="$job/receipt.json"

# --- 가드 1: Stage 2에서 지정한 플랫폼인가 ---
platforms_line="$(sed -n 's/^platforms:[[:space:]]*//p' "$STATE_FILE" | head -1)"
platforms_norm="$(printf '%s' "$platforms_line" | tr -d '[]' | tr ',' ' ')"
grep -qw "$platform" <<<"$platforms_norm" \
  || die "플랫폼 '$platform'은 이 작업의 대상이 아닙니다 (platforms: $platforms_line)"

# --- 가드 2: Ready 판정식 (승인 digest 일치) ---
receipt_digest_matches "$platform" \
  || die "승인 digest가 없거나 현재 초안과 일치하지 않습니다 — 승인 후 초안이 수정됐습니다. Stage 8 승인을 다시 받으세요 (실패-닫힘 가드)"

# --- 가드 3: 하드 제약 재실행 ---
command -v uv >/dev/null 2>&1 \
  || die "uv가 없어 하드 제약을 검사할 수 없습니다 — fail-closed로 게시를 거부합니다. 설치: curl -LsSf https://astral.sh/uv/install.sh | sh"
check_out="$(
  uv run -q --with grapheme --with pyyaml python "$SCRIPT_DIR/check-drafts.py" "$job" 2>&1
)" || die "하드 제약 위반 — 게시를 거부합니다:
$check_out"

# --- 가드 4: 계정은 job-state.md 기재값만 ---
accounts_line="$(sed -n 's/^accounts:[[:space:]]*//p' "$STATE_FILE" | head -1)"
account="$(printf '%s' "$accounts_line" | sed -n "s/.*[{,][[:space:]]*$platform:[[:space:]]*\([^,}[:space:]]*\).*/\1/p")"
[[ -n "$account" ]] || die "job-state.md accounts에 '$platform' 계정이 없습니다 — Stage 2에서 사용자가 계정을 지정해야 합니다 (스킬이 임의로 정하지 않는다)"

# --- 초안 동결 (TOCTOU 차단) + 게시 지시 ---
command -v aside >/dev/null 2>&1 || die "aside CLI가 없습니다 — Aside 앱 설치 후 aside --version 으로 확인하세요"

frozen="$(mktemp "${TMPDIR:-/tmp}/social-posting-draft.XXXXXX.md")"
cp "$DRAFT" "$frozen"
chmod 0400 "$frozen"

prompt="파일 $frozen 의 내용을 그대로 $platform 에 게시해줘. 텍스트를 변경·요약·추가·삭제하지 마세요. '=== POST ===' 줄은 스레드 경계다 — 각 세그먼트를 순서대로 별도 게시물로 게시한다. 완료 후 게시된 게시물 URL을 반환해줘."

if [[ "$dry_run" == "true" ]]; then
  echo "가드 통과 (dry-run): platform=$platform account=$account"
  echo "동결 초안: $frozen"
  echo "aside exec --account $account \"$prompt\""
  rm -f "$frozen"
  exit 0
fi

echo "게시 지시: platform=$platform account=$account"
if ! aside exec --account "$account" "$prompt"; then
  rm -f "$frozen"
  die "aside exec 실패 — 게시되지 않았을 가능성이 크다. aside 출력을 확인하고 성공 여부를 판별한 뒤, 성공했을 때만 Stage 10 read-back을 진행하세요"
fi

# 동결 파일은 게시 지시 후 즉시 삭제 (승인 문구 잔류 최소화)
rm -f "$frozen"
echo "게시 지시 완료. Stage 10 read-back으로 본문 일치를 검증한 뒤 post-state.sh set posted_$platform <url> 로 기록하세요."
exit 0
