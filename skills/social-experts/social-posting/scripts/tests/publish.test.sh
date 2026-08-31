#!/bin/bash
# publish.sh — 게시 가드 검증. digest·플랫폼·계정·하드 제약 가드가 실제로 막는지.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PUBLISH="$SKILL_DIR/scripts/publish.sh"

sandbox="$(mktemp -d)"
trap 'rm -rf "$sandbox"' EXIT
export TMPDIR="$sandbox/tmp"
mkdir -p "$TMPDIR"

fail() { echo "❌ $1" >&2; exit 1; }

if ! command -v uv >/dev/null 2>&1; then
  echo "❌ 오류: uv 가 없습니다 — 하드 제약 재실행 검증을 실행할 수 없습니다" >&2
  exit 1
fi

# aside stub: 호출 로그만 남긴다
mkdir -p "$sandbox/bin"
export SOCIAL_ASIDE_LOG="$sandbox/aside-calls.log"
cat >"$sandbox/bin/aside" <<'EOF'
#!/bin/bash
printf '%s\n' "$*" >>"$SOCIAL_ASIDE_LOG"
echo "게시 완료: https://stub.example/post/1"
exit 0
EOF
chmod +x "$sandbox/bin/aside"
export PATH="$sandbox/bin:$PATH"

hash_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

make_job() { # $1=dir  $2=platforms  $3=accounts
  mkdir -p "$1/drafts"
  cat >"$1/job-state.md" <<EOF
---
stage: 8
slug: t
platforms: [$2]
accounts: {$3}
status: {$2: draft}
---
EOF
}

# --- 1. 승인 정상 → dry-run 통과, 실제 실행은 exec 1회 ---
job="$sandbox/job-ok"
make_job "$job" "x" "x: u0"
printf -- '---\nplatform: x\nformat: single\n---\n스파크 잡을 3배 빠르게 만든 이야기\n' >"$job/drafts/x.md"
printf '{"approved_digests":{"x":"%s"}}' "$(hash_of "$job/drafts/x.md")" >"$job/receipt.json"

bash "$PUBLISH" --job "$job" --platform x --dry-run >/dev/null || fail "승인 정상 dry-run이 통과해야 한다"

aside_call_count() { { cat "$SOCIAL_ASIDE_LOG" 2>/dev/null || true; } | wc -l | tr -d '[:space:]'; }

[ "$(aside_call_count)" = "0" ] || fail "dry-run은 aside를 호출하면 안 된다"

bash "$PUBLISH" --job "$job" --platform x >/dev/null || fail "승인 정상 실행이 실패했다"
[ "$(aside_call_count)" = "1" ] || fail "aside exec는 정확히 1회 호출되어야 한다"
grep -q -- "--account u0" "$SOCIAL_ASIDE_LOG" || fail "job-state 계정(u0)으로 호출해야 한다"
grep -q "그대로" "$SOCIAL_ASIDE_LOG" || fail "변경 금지 지시가 프롬프트에 담겨야 한다"

# --- 2. digest 불일치 (승인 후 수정) → 거부 ---
job2="$sandbox/job-tampered"
make_job "$job2" "x" "x: u0"
printf -- '---\nplatform: x\nformat: single\n---\n원본 문구\n' >"$job2/drafts/x.md"
printf '{"approved_digests":{"x":"%s"}}' "$(hash_of "$job2/drafts/x.md")" >"$job2/receipt.json"
printf -- '---\nplatform: x\nformat: single\n---\n승인 후 몰래 수정한 문구\n' >"$job2/drafts/x.md"
if bash "$PUBLISH" --job "$job2" --platform x >/dev/null 2>&1; then
  fail "승인 후 수정된 초안은 거부되어야 한다 (실패-닫힘)"
fi

# --- 3. 미승인 플랫폼 → 거부 ---
job3="$sandbox/job-unapproved"
make_job "$job3" "x" "x: u0"
printf -- '---\nplatform: x\nformat: single\n---\n본문\n' >"$job3/drafts/x.md"
printf '{}' >"$job3/receipt.json"
if bash "$PUBLISH" --job "$job3" --platform x >/dev/null 2>&1; then
  fail "승인 digest가 없으면 거부되어야 한다"
fi

# --- 4. 대상 밖 플랫폼 → 거부 ---
if bash "$PUBLISH" --job "$job" --platform linkedin >/dev/null 2>&1; then
  fail "platforms에 없는 플랫폼은 거부되어야 한다"
fi

# --- 5. 계정 미지정 → 거부 ---
job5="$sandbox/job-noaccount"
make_job "$job5" "x" "linkedin: u1"
printf -- '---\nplatform: x\nformat: single\n---\n본문\n' >"$job5/drafts/x.md"
printf '{"approved_digests":{"x":"%s"}}' "$(hash_of "$job5/drafts/x.md")" >"$job5/receipt.json"
if bash "$PUBLISH" --job "$job5" --platform x >/dev/null 2>&1; then
  fail "accounts에 해당 플랫폼 계정이 없으면 거부되어야 한다"
fi

# --- 6. 하드 제약 위반 (승인은 유효) → 가드 3이 거부 ---
job6="$sandbox/job-violating"
make_job "$job6" "x" "x: u0"
k141="$(printf '가%.0s' $(seq 1 141))"
printf -- '---\nplatform: x\nformat: single\n---\n%s\n' "$k141" >"$job6/drafts/x.md"
printf '{"approved_digests":{"x":"%s"}}' "$(hash_of "$job6/drafts/x.md")" >"$job6/receipt.json"
if bash "$PUBLISH" --job "$job6" --platform x >/dev/null 2>&1; then
  fail "하드 제약 위반(282>280)은 가드 3에서 거부되어야 한다"
fi

# --- 7. aside 실패 → exit 1 ---
cat >"$sandbox/bin/aside" <<'EOF'
#!/bin/bash
echo "aside 오류" >&2
exit 1
EOF
if bash "$PUBLISH" --job "$job" --platform x >/dev/null 2>&1; then
  fail "aside 실행 실패 시 exit 1이어야 한다"
fi

echo "✅ publish.test.sh 통과"
