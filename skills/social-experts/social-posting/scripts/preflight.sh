#!/bin/bash
# preflight.sh - 스킬 호출 즉시 수집하는 환경 스냅샷. JSON 1줄 출력, 항상 exit 0.
#
# 실패는 에러가 아니라 필드로 보고한다(soft-fail) — Stage 2가 이 값을 보고
# 선택지를 만든다. aside 명령은 인자 없이 빠르게 끝나는 것만 쓴다.
#
# Usage: bash preflight.sh
# 출력 예:
# {"aside":{"available":true,"version":"1.26.810.1915","account_list":["u0 …","u1 …"],
#           "account_status":"…"},"uv":true,"python3":true,"jq":true,
#  "workspace":{"cwd":"…","social_root":"/…","has_voice_profile":false,
#               "md_candidates":["a.md","b.md"]}}

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# aside 하위 명령 출력을 안전하게 모은다(부재·실패 → 빈 값)
capture() {
  local cmd="$1"
  shift
  command -v "$cmd" >/dev/null 2>&1 || return 1
  "$cmd" "$@" 2>/dev/null || true
}

aside_available=false
aside_version=""
account_list_json="[]"
account_status=""

if command -v aside >/dev/null 2>&1; then
  aside_available=true
  aside_version="$(capture aside --version | head -1)"
  # account list / status 출력 형식은 aside 버전에 따라 달라질 수 있어 원문 라인을
  # 그대로 실는다 — 파싱은 에이전트가 Stage 2에서 한다
  account_list_json="$(capture aside account list | jq -R -s -c 'split("\n") | map(select(length > 0))' 2>/dev/null || printf '[]')"
  account_status="$(capture aside account status | head -1)"
fi

# aside 권한 바인딩(활성 계정) — 상태 계산은 aside-permissions.sh 에 맡긴다(유일한 구현).
# 실패는 에러가 아니라 ok:false 필드로 보고한다(soft-fail).
permissions_json='{"ok":false,"reason":"aside_not_available"}'
if [[ "$aside_available" == "true" ]]; then
  permissions_json="$(bash "$SCRIPT_DIR/aside-permissions.sh" status 2>/dev/null \
    || printf '{"ok":false,"reason":"permission_check_failed"}')"
fi
permissions_json="$(printf '%s' "$permissions_json" | jq -c . 2>/dev/null || printf '{"ok":false,"reason":"permission_check_failed"}')"

uv_ok=false
command -v uv >/dev/null 2>&1 && uv_ok=true
python3_ok=false
command -v python3 >/dev/null 2>&1 && python3_ok=true
jq_ok=false
command -v jq >/dev/null 2>&1 && jq_ok=true

# 워크스페이스: CWD에서 위로 social/ 폴더를 찾는다(루트까지)
cwd="$(pwd)"
social_root=""
probe="$cwd"
while [[ -n "$probe" ]]; do
  if [[ -d "$probe/social" ]]; then
    social_root="$probe/social"
    break
  fi
  [[ "$probe" == "/" ]] && break
  probe="$(dirname "$probe")"
done

has_voice_profile=false
md_candidates_json="[]"
if [[ -n "$social_root" ]]; then
  [[ -f "$social_root/voice-profile.md" ]] && has_voice_profile=true
fi
# 소재 후보: CWD 주변의 .md 몇 개 (Stage 2 '기존 문서' 선택지 재료)
if [[ "$jq_ok" == "true" ]]; then
  md_candidates_json="$( { find "$cwd" -maxdepth 2 -name '*.md' -type f -not -path '*/.git/*' 2>/dev/null || true; } \
    | head -5 \
    | jq -R -s -c 'split("\n") | map(select(length > 0))' 2>/dev/null || printf '[]')"
fi

jq -n \
  --argjson aside_available "$aside_available" \
  --arg aside_version "$aside_version" \
  --argjson account_list "$(printf '%s' "$account_list_json" | jq -c . 2>/dev/null || printf '[]')" \
  --arg account_status "$account_status" \
  --argjson permissions "$permissions_json" \
  --argjson uv "$uv_ok" \
  --argjson python3 "$python3_ok" \
  --argjson jq_ok "$jq_ok" \
  --arg cwd "$cwd" \
  --arg social_root "$social_root" \
  --argjson has_voice_profile "$has_voice_profile" \
  --argjson md_candidates "$(printf '%s' "$md_candidates_json" | jq -c . 2>/dev/null || printf '[]')" \
  '{aside: {available: $aside_available, version: $aside_version, account_list: $account_list, account_status: $account_status, permissions: $permissions},
    uv: $uv, python3: $python3, jq: $jq_ok,
    workspace: {cwd: $cwd, social_root: $social_root, has_voice_profile: $has_voice_profile, md_candidates: $md_candidates}}'

exit 0
