#!/bin/bash
# preflight.sh - 스킬 호출 즉시 수집하는 환경 스냅샷. JSON 1줄 출력, 항상 exit 0.
#
# 실패는 에러가 아니라 필드로 보고한다(soft-fail) — Stage 2가 이 값을 보고
# 선택지를 만든다. ego-browser 명령은 인자 없이 빠르게 끝나는 것만 쓴다.
#
# Usage: bash preflight.sh
# 출력 예:
# {"ego":{"available":true,"version":"0.6.3.14","executable":"/path/ego-browser",
#         "binding":{"bound":true,"identity":{"x":"me"}}},
#  "uv":true,"python3":true,"node":true,"jq":true,
#  "workspace":{"cwd":"…","social_root":"/…","has_voice_profile":false,
#               "md_candidates":["a.md","b.md"]}}

set -uo pipefail

capture() {
  local cmd="$1"
  shift
  command -v "$cmd" >/dev/null 2>&1 || return 1
  "$cmd" "$@" 2>/dev/null || true
}

ego_available=false
ego_version=""
ego_executable=""

if command -v ego-browser >/dev/null 2>&1; then
  ego_available=true
  ego_executable="$(command -v ego-browser)"
  # 실측(2026-11-14, 0.6.3.14): --version 출력도 stderr로 재배선된다 — 통합 캡처로 첫 줄을 얻는다.
  # 출력 형태는 버전에 따라 달라질 수 있어 파싱 없이 첫 줄만 그대로 실는다.
  ego_version="$( { ego-browser --version 2>&1 || true; } | head -1)"
fi

# ego 바인딩(신원) — ego-post.mjs setup이 기록한 binding.json을 읽기만 한다.
# 상태 디렉토리는 ego-post.mjs와 동일 규칙(런타임 확정)으로 잡는다.
ego_binding_json='{"bound":false,"identity":{}}'
state_dir="${SOCIAL_EGO_STATE_DIR:-$HOME/.local/share/aha-skills/social-posting}"
if [[ -f "$state_dir/binding.json" ]]; then
  ego_binding_json="$(jq -c '{bound:true, identity:(.identity // {})}' "$state_dir/binding.json" 2>/dev/null \
    || printf '{"bound":false,"identity":{}}')"
fi

uv_ok=false
command -v uv >/dev/null 2>&1 && uv_ok=true
python3_ok=false
command -v python3 >/dev/null 2>&1 && python3_ok=true
node_ok=false
command -v node >/dev/null 2>&1 && node_ok=true
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
  --argjson ego_available "$ego_available" \
  --arg ego_version "$ego_version" \
  --arg ego_executable "$ego_executable" \
  --argjson ego_binding "$(printf '%s' "$ego_binding_json" | jq -c . 2>/dev/null || printf '{"bound":false,"identity":{}}')" \
  --argjson uv "$uv_ok" \
  --argjson python3 "$python3_ok" \
  --argjson node "$node_ok" \
  --argjson jq_ok "$jq_ok" \
  --arg cwd "$cwd" \
  --arg social_root "$social_root" \
  --argjson has_voice_profile "$has_voice_profile" \
  --argjson md_candidates "$(printf '%s' "$md_candidates_json" | jq -c . 2>/dev/null || printf '[]')" \
  '{ego: {available: $ego_available, version: $ego_version, executable: $ego_executable, binding: $ego_binding},
    uv: $uv, python3: $python3, node: $node, jq: $jq_ok,
    workspace: {cwd: $cwd, social_root: $social_root, has_voice_profile: $has_voice_profile, md_candidates: $md_candidates}}'

exit 0
