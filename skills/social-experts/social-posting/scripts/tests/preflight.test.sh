#!/bin/bash
# preflight.sh — 환경 스냅샷 검증. aside stub·부재·워크스페이스 탐지.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PREFLIGHT="$SKILL_DIR/scripts/preflight.sh"

sandbox="$(mktemp -d)"
trap 'rm -rf "$sandbox"' EXIT

fail() { echo "❌ $1" >&2; exit 1; }

# aside stub (PATH 주입)
mkdir -p "$sandbox/bin"
cat >"$sandbox/bin/aside" <<'EOF'
#!/bin/bash
case "$1" in
  --version) echo "1.26.810-stub" ;;
  account)
    case "$2" in
      list)   echo "* u0  개인"; echo "  u1  사내" ;;
      status) echo "활성 프로필: u0" ;;
    esac
    ;;
esac
exit 0
EOF
chmod +x "$sandbox/bin/aside"

# --- 1. aside stub 정상 → JSON 파싱 가능 + 필드 반영 ---
cd "$sandbox"
out="$(PATH="$sandbox/bin:$PATH" bash "$PREFLIGHT")"
echo "$out" | jq -e '.aside.available == true and .aside.version == "1.26.810-stub"' >/dev/null \
  || fail "aside available/version 필드 불일치: $out"
echo "$out" | jq -e '(.aside.account_list | length) == 2' >/dev/null \
  || fail "account_list 라인 수 불일치: $out"
echo "$out" | jq -e '.aside.account_status | test("u0")' >/dev/null \
  || fail "account_status 미반영: $out"
# stub aside에는 repl이 없어 권한 바인딩은 soft-fail(ok:false)이어야 한다
echo "$out" | jq -e '.aside.permissions.ok == false' >/dev/null \
  || fail "권한 바인딩 soft-fail 미반영: $out"

# --- 2. aside 부재 → exit 0 + available=false ---
out2="$(PATH="/usr/bin:/bin" bash "$PREFLIGHT")" || fail "aside 부재에도 exit 0이어야 한다"
echo "$out2" | jq -e '.aside.available == false' >/dev/null \
  || fail "부재 시 available=false 여야 한다: $out2"
echo "$out2" | jq -e '.aside.permissions.reason == "aside_not_available"' >/dev/null \
  || fail "부재 시 권한 필드 미반영: $out2"

# --- 3. 워크스페이스 탐지: social/ 폴더 → social_root·voice_profile 반영 ---
mkdir -p "$sandbox/social/job"
printf -- '---\nversion: 1\n---\n' >"$sandbox/social/voice-profile.md"
out3="$(cd "$sandbox/social/job" && PATH="$sandbox/bin:$PATH" bash "$PREFLIGHT")"
echo "$out3" | jq -e --arg root "$sandbox/social" '.workspace.social_root == $root and .workspace.has_voice_profile == true' >/dev/null \
  || fail "social_root/has_voice_profile 탐지 실패: $out3"

# --- 4. md 후보 수집 ---
printf '# 제목\n' >"$sandbox/note.md"
out4="$(cd "$sandbox" && PATH="$sandbox/bin:$PATH" bash "$PREFLIGHT")"
echo "$out4" | jq -e '(.workspace.md_candidates | index("note.md" // "*/note.md" // "note.md")) != null or (.workspace.md_candidates | length) >= 1' >/dev/null \
  || fail "md_candidates 미수집: $out4"

echo "✅ preflight.test.sh 통과"
