#!/bin/bash
# publish.sh - 게시의 유일한 진입점. 직접 ego-browser를 호출하지 말고 이 스크립트를 경유한다.
#
# 게시 직전 7중 가드 (전부 이 스크립트가 강제 — 훅은 승인 기록 담당):
#   1. 플랫폼이 job-state.md의 platforms 안에 있는가 (Stage 2에서 사용자가 고른 대상)
#   2. Ready 판정식 — approved_digests에 해당 플랫폼이 있고 drafts/<platform>.md의
#      sha256과 일치 (승인 후 초안이 바뀌면 거부 = 실패-닫힘 가드)
#   3. 하드 제약 재실행 (check-drafts.py, 이중 검사)
#   4. 계정 — job-state.md accounts에서 해당 플랫폼 계정(ego 바인딩 신원)만 읽는다
#      (사용자가 Stage 2에서 지정한 값 외에는 애초에 입력 경로가 없다)
#   5. 승인 시점 계정 매핑(approved_accounts, 훅 스냅샷)과 현재 job-state가 일치하는가
#      (승인 후 계정 변경 = 계정 재타깃 차단)
#   6. 본문 동결 직후 원본 전체 파일 digest를 승인과 재검증 (검사→동결 사이 TOCTOU 차단)
#   7. scan 사진·출처는 전용 사본의 승인 digest를 검증하고 사본만 실행층에 전달
#
# 통과하면 check-drafts 페이로드 JSON(본문·media 절대경로+alt·link·visibility)에 가드 4의
# ego 신원을 실어 ego-post.mjs post(고정 스크립트 실행 계층)에 넘긴다. 게시 성공 신호는
# ego-post의 DOM 증거 판정이고 URL 회수는 최선 노력 — 회수 실패는 POSTED+urlRecovered:false
# 로 exit 0(실제 게시 후 exit 1은 중복 게시 재시도를 부른다). 부분 게시는 PARTIAL_POSTED
# exit 1. 게시 결과(URL)의 영수증 기록은 Stage 10 read-back 이후 post-state.sh set
# posted_<platform> <url>로 에이전트가 한다. 동결 파일은 EXIT trap으로 정리된다.
#
# Usage:
#   publish.sh --job <job-dir> --platform <x|linkedin|facebook|bluesky> [--dry-run]
# --dry-run: 가드만 통과시키고 ego 실행 계층은 호출하지 않는다 (게시 직전 확인용).
#
# Exit: 0 게시 지시 완료(URL 회수 실패 포함) / 1 가드 거부·실패·부분 게시 (fail-closed)

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
[[ "$platform" != "instagram" ]] || die "INSTAGRAM_UNVERIFIED — 실제 UI의 사진 피드·계정·첨부·read-back 검증 전 Instagram 게시는 차단됩니다"
[[ "$platform" != "threads" ]] || die "THREADS_UNVERIFIED — 실제 UI의 길이·사진·답글·read-back 검증 전 Threads 게시는 차단됩니다"

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
  uv run -q --with grapheme --with pyyaml python "$SCRIPT_DIR/check-drafts.py" "$job" --platform "$platform" 2>&1
)" || die "하드 제약 위반 — 게시를 거부합니다:
$check_out"

# --- 가드 4: 계정은 job-state.md 기재값만 ---
accounts_line="$(sed -n 's/^accounts:[[:space:]]*//p' "$STATE_FILE" | head -1)"
account="$(printf '%s' "$accounts_line" | sed -n "s/.*[{,][[:space:]]*$platform:[[:space:]]*\([^,}[:space:]]*\).*/\1/p")"
[[ -n "$account" ]] || die "job-state.md accounts에 '$platform' 계정이 없습니다 — Stage 2에서 사용자가 계정을 지정해야 합니다 (스킬이 임의로 정하지 않는다)"

# --- 가드 5: 승인 시점 계정 매핑과 일치해야 한다 (계정 재타깃 차단) ---
approved_accounts="$(receipt_get '.approved_accounts // ""')"
[[ -n "$approved_accounts" ]] || die "승인 영수증에 approved_accounts 스냅샷이 없습니다 — 이전 계약의 승인입니다. Stage 8 승인을 다시 받으세요"
[[ "$approved_accounts" == "$accounts_line" ]] || die "승인 시점 계정 매핑과 현재 job-state accounts가 다릅니다 — 승인 후 계정이 변경됐습니다. Stage 8 승인을 다시 받으세요 (실패-닫힘 가드)"

# --- 게시 페이로드: check-drafts 산출 JSON + ego 바인딩 신원 → ego-post 실행 계층 ---
# 실행 계층: SOCIAL_EGO_POST 심(테스트 전용 — payload JSON을 stdin으로 받고 JSON 1줄을
# stdout에 돌려주는 계약) 또는 node ego-post.mjs post. ego-post가 게시·미디어·공개범위·
# 스레드 답글 체인을 전부 고정 스크립트로 수행한다.
if [[ -z "${SOCIAL_EGO_POST:-}" ]] && ! command -v node >/dev/null 2>&1; then
  die "node가 없어 ego 실행 계층(ego-post.mjs)을 돌릴 수 없습니다 — fail-closed로 게시를 거부합니다"
fi

frozen=""
frozen_media=""
trap 'rm -f "$frozen"; [[ -z "$frozen_media" ]] || rm -rf "$frozen_media"' EXIT
frozen_media="$(mktemp -d "${TMPDIR:-/tmp}/social-posting-media.XXXXXX")" \
  || die "사진 동결용 임시디렉터리를 만들 수 없습니다"
payload_json="$(uv run -q --with grapheme --with pyyaml python "$SCRIPT_DIR/check-drafts.py" "$job" --platform "$platform" --freeze-media "$frozen_media")" \
  || die "게시 페이로드 생성 실패 (초안 형식·scan 사진 사본 검증을 확인하세요)"

frozen="$(mktemp "${TMPDIR:-/tmp}/social-posting-body.XXXXXX")"
printf '%s' "$payload_json" | jq -j '.body' >"$frozen"
chmod 0400 "$frozen"

# --- 가드 6: 동결 직후 원본 전체 파일의 digest를 승인과 재검증 (TOCTOU 차단) ---
approved_digest="$(receipt_get ".approved_digests[\"$platform\"] // \"\"")"
current_digest="$(hash_file "$DRAFT")"
[[ -n "$approved_digest" && "$approved_digest" == "$current_digest" ]] \
  || die "승인 digest와 현재 초안이 일치하지 않습니다 — 가드 통과 후 초안이 변경됐습니다. Stage 8 승인을 다시 받으세요 (실패-닫힘 가드)"

# --- 가드 7: 사본 동결 이후 원본 변경도 실행 전에 거부한다 (실행층은 검증한 사본만 읽음) ---
check_out="$(
  uv run -q --with grapheme --with pyyaml python "$SCRIPT_DIR/check-drafts.py" "$job" --platform "$platform" 2>&1
)" || die "scan 미디어 재검증 실패 — 게시를 거부합니다:\n$check_out"

media_count="$(printf '%s' "$payload_json" | jq '.media | length')"
link="$(printf '%s' "$payload_json" | jq -r '.link // ""')"
format="$(printf '%s' "$payload_json" | jq -r '.format // "single"')"
# 세그먼트 수는 check-drafts.py parse_draft와 같은 방식으로 센다(공백 세그먼트 제외) —
# 부분 게시(PARTIAL_POSTED) 판정과 산출 개수가 어긋나면 오탐한다
segments="$(printf '%s' "$payload_json" | jq -r '[.body | split("\n=== POST ===\n")[] | gsub("^\\s+|\\s+$";"") | select(length > 0)] | length')"
visibility="$(printf '%s' "$payload_json" | jq -r '.visibility // "keep"')"

# ego 페이로드: check-drafts JSON + 가드 4가 뽑은 ego 바인딩 신원(identity).
# ego-post가 binding 신원과 identity를 대조해 계정 재타깃을 한 번 더 차단한다.
ego_payload="$(printf '%s' "$payload_json" | jq -c --arg identity "$account" '. + {identity: $identity}')"

if [[ "$dry_run" == "true" ]]; then
  echo "가드 통과 (dry-run): platform=$platform identity=$account format=$format"
  [[ "$format" == "thread" ]] && echo "스레드: 세그먼트 $segments개, 답글 체인으로 연결 게시"
  echo "동결 본문: $frozen ($(wc -c <"$frozen" | tr -d ' ') bytes)"
  echo "media: $media_count, link: ${link:-없음}, visibility: $visibility"
  echo "ego-post.mjs post (payload: body ${segments}세그먼트, media ${media_count}개, identity=$account)"
  rm -f "$frozen"
  exit 0
fi

echo "게시 지시: platform=$platform identity=$account format=$format (ego-post)"
export SOCIAL_POSTING_FROZEN="$frozen" # audit 증거 — 하위 프로세스(테스트 stub 포함)로 전달

run_ego_post() {
  if [[ -n "${SOCIAL_EGO_POST:-}" ]]; then bash "$SOCIAL_EGO_POST"; else node "$SCRIPT_DIR/ego-post.mjs" post; fi
}
# ego-post는 자체 상한 타임아웃(세그먼트 수 산식, 최대 570s)으로 자식을 정리한다 —
# 이 스크립트에는 감시 루프가 없다. 호출측(하네스 Bash)은 timeout을 넉넉히 줘야 한다.
result="$(printf '%s' "$ego_payload" | run_ego_post)"
ego_exit=$?

status="$(printf '%s' "$result" | jq -r '.status // ""' 2>/dev/null || true)"

if [[ "$status" == "POSTED" && "$ego_exit" -eq 0 ]]; then
  url_recovered="$(printf '%s' "$result" | jq -r '.urlRecovered')"
  printf '%s\n' "$result"
  if [[ "$url_recovered" != "true" ]]; then
    # 게시는 DOM 증거로 성립했다 — URL 회수 실패로 exit 1을 주면 호출측이 재시도해
    # 중복 게시를 만든다. 프로필에서 URL을 찾아 posted 기록하고 read-back은 생략한다.
    echo "⚠️ 게시 성공(DOM 증거)했으나 게시 URL 회수에 실패했다 — 프로필에서 게시물을 확인해 post-state.sh set posted_$platform <url> 로 기록하고 사용자에게 알려라. read-back(url 일치 검증)은 URL 확보 후 수행한다."
    exit 0
  fi
  echo "게시 URL 회수 완료. Stage 10 read-back(ego-post.mjs readback)으로 본문 일치를 검증한 뒤 post-state.sh set posted_$platform <url> 로 기록하세요."
  exit 0
fi

if [[ "$status" == "PARTIAL_POSTED" ]]; then
  partial_urls="$(printf '%s' "$result" | jq -r '.urls | join(" ")')"
  reason="$(printf '%s' "$result" | jq -r '.reason // "?"')"
  printf '%s\n' "$result"
  die "부분 게시 — 세그먼트 일부만 게시됐다(사유: $reason). 이미 게시된 URL: ${partial_urls:-없음}. 재시도 금지 — 게시된 게시물을 확인하고 사용자에게 즉시 보고하세요"
fi

# 실행이 시작된 뒤 출력 유실·프로토콜 실패는 미게시의 증거가 아니다.
[[ -n "$result" ]] && printf '%s\n' "$result"
if [[ "$status" == "POST_FAILED" ]]; then
  die "게시 전 실패 — 출력의 reason을 확인하세요. 이미 게시된 세그먼트가 없는지 확인한 뒤 사용자에게 보고하세요"
fi
die "게시 결과 불명(status: ${status:-불명}, exit: $ego_exit) — 재시도 금지. 프로필에서 실제 게시 여부와 세그먼트를 확인하고 사용자에게 즉시 보고하세요"
