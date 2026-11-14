#!/bin/bash
# preflight.sh — 환경 스냅샷 검증. ego-browser stub·부재·바인딩·워크스페이스 탐지.
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PREFLIGHT="$SKILL_DIR/scripts/preflight.sh"

sandbox="$(mktemp -d)"
trap 'rm -rf "$sandbox"' EXIT

fail() { echo "❌ $1" >&2; exit 1; }

# ego-browser stub (PATH 주입)
mkdir -p "$sandbox/bin"
cat >"$sandbox/bin/ego-browser" <<'EOF'
#!/bin/bash
case "$1" in
  --version) echo "0.6.3.14-stub" ;;
esac
exit 0
EOF
chmod +x "$sandbox/bin/ego-browser"

# --- 1. ego stub 정상 → JSON 파싱 가능 + 필드 반영, binding 미바인딩 ---
cd "$sandbox"
out="$(PATH="$sandbox/bin:$PATH" SOCIAL_EGO_STATE_DIR="$sandbox/no-state" bash "$PREFLIGHT")"
echo "$out" | jq -e '.ego.available == true and .ego.version == "0.6.3.14-stub"' >/dev/null \
  || fail "ego available/version 필드 불일치: $out"
echo "$out" | jq -e '.ego.executable | test("ego-browser$")' >/dev/null \
  || fail "ego executable 필드 미반영: $out"
echo "$out" | jq -e '.ego.binding.bound == false and (.ego.binding.identity | length) == 0' >/dev/null \
  || fail "binding 없을 때 bound=false 여야 한다: $out"
echo "$out" | jq -e '.node == true and .uv == true and .jq == true' >/dev/null \
  || fail "도구 불 필드 미반영: $out"

# --- 2. ego 부재 → exit 0 + available=false ---
out2="$(PATH="/usr/bin:/bin" SOCIAL_EGO_STATE_DIR="$sandbox/no-state" bash "$PREFLIGHT")" || fail "ego 부재에도 exit 0이어야 한다"
echo "$out2" | jq -e '.ego.available == false and .ego.version == "" and .ego.binding.bound == false' >/dev/null \
  || fail "부재 시 available=false·빈 버전이어야 한다: $out2"

# --- 3. binding 존재 → bound=true + 플랫폼별 신원 반영 ---
mkdir -p "$sandbox/state"
printf '{"transport":"ego-post/1","executable":"/x/ego-browser","taskSpaceName":"social-posting-skill","egoVersion":"0.6.3.14","identity":{"x":"me","linkedin":"my-slug"}}' \
  >"$sandbox/state/binding.json"
out3="$(PATH="$sandbox/bin:$PATH" SOCIAL_EGO_STATE_DIR="$sandbox/state" bash "$PREFLIGHT")"
echo "$out3" | jq -e '.ego.binding.bound == true and .ego.binding.identity.x == "me" and .ego.binding.identity.linkedin == "my-slug"' >/dev/null \
  || fail "binding 신원 미반영: $out3"

# --- 4. 워크스페이스 탐지: social/ 폴더 → social_root·voice_profile 반영 ---
mkdir -p "$sandbox/social/job"
printf -- '---\nversion: 1\n---\n' >"$sandbox/social/voice-profile.md"
out4="$(cd "$sandbox/social/job" && PATH="$sandbox/bin:$PATH" SOCIAL_EGO_STATE_DIR="$sandbox/state" bash "$PREFLIGHT")"
echo "$out4" | jq -e --arg root "$sandbox/social" '.workspace.social_root == $root and .workspace.has_voice_profile == true' >/dev/null \
  || fail "social_root/has_voice_profile 탐지 실패: $out4"

# --- 5. md 후보 수집 ---
printf '# 제목\n' >"$sandbox/note.md"
out5="$(cd "$sandbox" && PATH="$sandbox/bin:$PATH" SOCIAL_EGO_STATE_DIR="$sandbox/state" bash "$PREFLIGHT")"
echo "$out5" | jq -e '(.workspace.md_candidates | length) >= 1' >/dev/null \
  || fail "md_candidates 미수집: $out5"

echo "✅ preflight.test.sh 통과"
