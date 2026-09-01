#!/bin/bash
# publish.sh - 게시의 유일한 진입점. 직접 aside exec를 호출하지 말고 이 스크립트를 경유한다.
#
# 게시 직전 6중 가드 (전부 이 스크립트가 강제 — 훅은 편의일 뿐, 강제력은 여기 있다):
#   1. 플랫폼이 job-state.md의 platforms 안에 있는가 (Stage 2에서 사용자가 고른 대상)
#   2. Ready 판정식 — approved_digests에 해당 플랫폼이 있고 drafts/<platform>.md의
#      sha256과 일치 (승인 후 초안이 바뀌면 거부 = 실패-닫힘 가드)
#   3. 하드 제약 재실행 (check-drafts.py, 이중 검사)
#   4. 계정 — job-state.md accounts에서 해당 플랫폼 계정만 읽는다 (사용자가 Stage 2에서
#      지정한 값 외에는 애초에 입력 경로가 없다)
#   5. 승인 시점 계정 매핑(approved_accounts, 훅 스냅샷)과 현재 job-state가 일치하는가
#      (승인 후 계정 변경 = 계정 재타깃 차단)
#   6. 본문 동결 직후 원본 전체 파일 digest를 승인과 재검증 (검사→동결 사이 TOCTOU 차단)
#
# 통과하면 본문만(frontmatter 제거, check-drafts.py --platform 산출) mktemp 0400 동결 파일로
# 만들고 media/link는 프롬프트 지시로 전달해 aside exec에 **변경·요약 없이 그대로 게시**를
# 지시한다. 승인 digest는 초안 전체 파일 기준이라 페이로드 분리와 무관하게 원본을 묶는다.
# 게시 성공 신호는 aside 출력의 URL(https?://) 기계 감지다. 게시 결과(URL)의 영수증 기록은
# Stage 10 read-back 이후 post-state.sh set posted_<platform> <url>로 에이전트가 한다.
# 동결 파일은 EXIT trap으로 어느 종료 경로에서든 정리된다.
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

# --- 가드 5: 승인 시점 계정 매핑과 일치해야 한다 (계정 재타깃 차단) ---
approved_accounts="$(receipt_get '.approved_accounts // ""')"
[[ -n "$approved_accounts" ]] || die "승인 영수증에 approved_accounts 스냅샷이 없습니다 — 이전 계약의 승인입니다. Stage 8 승인을 다시 받으세요"
[[ "$approved_accounts" == "$accounts_line" ]] || die "승인 시점 계정 매핑과 현재 job-state accounts가 다릅니다 — 승인 후 계정이 변경됐습니다. Stage 8 승인을 다시 받으세요 (실패-닫힘 가드)"

# --- 게시 페이로드 분리: 본문만 동결, media/link는 지시로 전달 ---
command -v aside >/dev/null 2>&1 || die "aside CLI가 없습니다 — Aside 앱 설치 후 aside --version 으로 확인하세요"

payload_json="$(uv run -q --with grapheme --with pyyaml python "$SCRIPT_DIR/check-drafts.py" "$job" --platform "$platform")" \
  || die "게시 페이로드 생성 실패 (초안 형식 오류 가능 — check-drafts를 다시 실행해 확인하세요)"

frozen=""
out_file=""
trap 'rm -f "$frozen" "$out_file"' EXIT
frozen="$(mktemp "${TMPDIR:-/tmp}/social-posting-body.XXXXXX")"
printf '%s' "$payload_json" | jq -j '.body' >"$frozen"
chmod 0400 "$frozen"

# --- 가드 6: 동결 직후 원본 전체 파일의 digest를 승인과 재검증 (TOCTOU 차단) ---
approved_digest="$(receipt_get ".approved_digests[\"$platform\"] // \"\"")"
current_digest="$(hash_file "$DRAFT")"
[[ -n "$approved_digest" && "$approved_digest" == "$current_digest" ]] \
  || die "승인 digest와 현재 초안이 일치하지 않습니다 — 가드 통과 후 초안이 변경됐습니다. Stage 8 승인을 다시 받으세요 (실패-닫힘 가드)"

# --- media/link 지시 조립 (frontmatter는 게시 텍스트가 아니라 메타데이터) ---
media_prompt=""
media_count="$(printf '%s' "$payload_json" | jq '.media | length')"
if [[ "$media_count" -gt 0 ]]; then
  media_prompt=" 첨부 미디어:"
  while IFS=$'\t' read -r mp ma; do
    media_prompt="$media_prompt 파일 '$mp' (alt text: $ma),"  # aside-path-ok — 미디어 첨부는 경로 전달이 불가피(알려진 제약)
  done < <(printf '%s' "$payload_json" | jq -r '.media[] | "\(.path)\t\(.alt)"')
  media_prompt="${media_prompt%,} — 본문과 함께 첨부해 게시한다."
fi
link_prompt=""
link="$(printf '%s' "$payload_json" | jq -r '.link // ""')"
[[ -n "$link" ]] && link_prompt=" 본문의 자연스러운 위치에 이 링크를 포함한다: $link"

# --- Facebook 공개 범위 지시 (Stage 2에서 사용자가 정한 값만 — keep이면 계정 기본 설정) ---
visibility_prompt=""
if [[ "$platform" == "facebook" ]]; then
  visibility="$(printf '%s' "$payload_json" | jq -r '.visibility // "keep"')"
  if [[ "$visibility" == "public" ]]; then
    visibility_prompt=" 게시물 공개 범위를 '공개'(전체 공개)로 설정해 게시한다."
  elif [[ "$visibility" == "friends" ]]; then
    visibility_prompt=" 게시물 공개 범위를 '친구'만 보도록 설정해 게시한다."
  fi
fi

# --- 게시 형식 분기: 스레드는 답글 체인으로 연결 지시 (흩어진 게시물 방지) ---
format="$(printf '%s' "$payload_json" | jq -r '.format // "single"')"
# 세그먼트 수는 check-drafts.py parse_draft와 같은 방식으로 센다(공백 세그먼트 제외) —
# 개수 기준이 어긋나면 URL 가드가 오탐한다
segments="$(printf '%s' "$payload_json" | jq -r '[.body | split("\n=== POST ===\n")[] | gsub("^\\s+|\\s+$";"") | select(length > 0)] | length')"
if [[ "$format" == "thread" ]]; then
  post_prompt="'=== POST ===' 줄은 스레드 경계다 — 세그먼트를 순서대로 게시하되, 두 번째 세그먼트부터는 바로 앞 게시물에 대한 답글로 달아 하나의 스레드(답글 체인)로 연결한다."
  [[ "$media_count" -gt 0 ]] && media_prompt="$media_prompt 미디어는 첫 게시물에만 첨부한다."
else
  post_prompt="'=== POST ===' 줄은 스레드 경계다 — 각 세그먼트를 순서대로 별도 게시물로 게시한다."
fi

# --- 본문은 인라인으로 전달한다 (2026-09-01 실측 근본 원인 제거) ---
# aside exec가 프롬프트의 로컬 파일 경로를 read_file하다 무인 권한 확인에 무한 정지했다.
# 본문을 프롬프트에 직접 싣으면 read_file이 일어나지 않는다. 동결 파일은 audit 증거로
# 유지되고 SOCIAL_POSTING_FROZEN으로 하위 프로세스(테스트 stub 포함)에 경로가 전달된다.
body_inline="$(cat "$frozen")"
export SOCIAL_POSTING_FROZEN="$frozen"
prompt="다음 게시 텍스트를 그대로 $platform 에 게시해줘. 텍스트를 변경·요약·추가·삭제하지 마세요. <<<게시 텍스트 시작>>>
$body_inline
<<<게시 텍스트 끝>>> $post_prompt$media_prompt$link_prompt$visibility_prompt 완료 후 게시된 게시물 URL을 반환해줘."

if [[ "$dry_run" == "true" ]]; then
  echo "가드 통과 (dry-run): platform=$platform account=$account format=$format"
  [[ "$format" == "thread" ]] && echo "스레드: 세그먼트 $segments개, 답글 체인으로 연결 게시"
  echo "동결 본문: $frozen ($(wc -c <"$frozen" | tr -d ' ') bytes)"
  echo "media: $media_count, link: ${link:-없음}"
  echo "aside exec --account $account \"$prompt\""
  rm -f "$frozen"
  exit 0
fi

echo "게시 지시: platform=$platform account=$account format=$format"
# --- aside exec를 상한 타임아웃으로 감싼다 — 무한 정지를 기명 실패로 바꾼다 ---
# 무인 read_file 권한 정지, 게시 후 완료 알림 추적 루프 등으로 exec가 물고 있던 전례
# (2026-09-01, 수 분~15분+) 때문에 상한을 넘으면 프로세스를 죽고 "게시 여부 불명"으로
# 실패 종료한다. 브라우저 UI 경로 실측은 39~300초 분산 + 300초 초과 사망 1회(LinkedIn)
# 관측 — 기본 420초는 상한의 1.4배 여유(병렬 실행 브라우저 경합 흡수 포함).
# 상한은 SOCIAL_ASIDE_TIMEOUT(초)으로 조정 가능하다.
aside_timeout="${SOCIAL_ASIDE_TIMEOUT:-420}"
out_file="$(mktemp "${TMPDIR:-/tmp}/social-posting-out.XXXXXX")"
aside exec --account "$account" "$prompt" >"$out_file" 2>&1 &
aside_pid=$!
deadline=$(( $(date +%s) + aside_timeout ))
hung=0
while kill -0 "$aside_pid" 2>/dev/null; do
  if [ "$(date +%s)" -ge "$deadline" ]; then hung=1; break; fi
  sleep 2
done
if [ "$hung" = "1" ]; then
  kill "$aside_pid" 2>/dev/null
  wait "$aside_pid" 2>/dev/null
  printf '%s\n' "$(cat "$out_file")" >&2
  die "aside exec가 ${aside_timeout}초 내에 완료되지 않았다 — 게시 여부 불명(타임아웃). 브라우저와 공개 API로 게시 여부를 확인한 뒤 사용자에게 즉시 보고하세요"
fi
wait "$aside_pid" \
  || { printf '%s\n' "$(cat "$out_file")" >&2; die "aside exec 실패 — 게시되지 않았을 가능성이 크다. aside 출력을 확인하고 성공 여부를 판별한 뒤, 성공했을 때만 Stage 10 read-back을 진행하세요"; }
out="$(cat "$out_file")"

# --- 게시 성공 신호: aside 출력에서 게시 URL을 기계 확인한다 (침묵 실패 차단) ---
url_count="$(printf '%s' "$out" | grep -oE 'https?://' | wc -l | tr -d '[:space:]')"
if [[ "$url_count" -eq 0 ]]; then
  printf '%s\n' "$out"
  die "aside 출력에서 게시 URL(https?://)을 찾지 못했다 — 게시 여부 불명. 위 출력을 즉시 확인하고, 게시가 확인된 경우에만 read-back 후 posted 기록, 아니면 사용자에게 보고하세요"
fi
# 스레드는 세그먼트 수만큼 URL이 나와야 한다 — 부분 게시 감지
if [[ "$format" == "thread" && "$url_count" -lt "$segments" ]]; then
  printf '%s\n' "$out"
  die "스레드 세그먼트 $segments개 중 게시 URL $url_count개 — 부분 게시 가능성. 위 출력을 확인해 이미 게시된 게시물을 파악하고 사용자에게 즉시 보고하세요"
fi

printf '%s\n' "$out"
echo "게시 URL 감지됨. Stage 10 read-back으로 본문 일치를 검증한 뒤 post-state.sh set posted_$platform <url> 로 기록하세요."
exit 0
