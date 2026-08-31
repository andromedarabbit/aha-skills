#!/bin/bash
# post-state.sh — 영수증 CLI 검증. 승인 가드의 뼈대가 실제로 막는지 확인한다.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
STATE="$SKILL_DIR/scripts/post-state.sh"
POINTER="${TMPDIR:-/tmp}/social-posting-current-job"

sandbox="$(mktemp -d)"
cleanup() { rm -rf "$sandbox" "$POINTER"; }
trap cleanup EXIT
job="$sandbox/job"

fail() { echo "❌ $1" >&2; exit 1; }

hash_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# --- activate: 활성 포인터 기록 + drafts 생성 ---
(
  unset SOCIAL_POSTING_JOB
  export SOCIAL_POSTING_RECEIPT="$job/receipt.json"
  bash "$STATE" activate "$job" >/dev/null
) || fail "activate 실패"
[ -f "$POINTER" ] || fail "activate가 포인터를 기록하지 않았다"
grep -Fq "$job" "$POINTER" || fail "포인터가 작업 디렉토리를 가리키지 않는다"
[ -d "$job/drafts" ] || fail "activate가 drafts/를 만들지 않았다"

export SOCIAL_POSTING_JOB="$job"
export SOCIAL_POSTING_RECEIPT="$job/receipt.json"

# --- set/get 왕복 + 타임스탬프 자동 동반 ---
bash "$STATE" set posted_x "https://x.com/u/1" >/dev/null || fail "posted_x set 실패"
[ "$(bash "$STATE" get posted_x)" = "https://x.com/u/1" ] || fail "posted_x set/get 왕복 실패"
[ -n "$(bash "$STATE" get posted_x_at)" ] || fail "posted_x_at 자동 기록 실패"

# --- approved_* 는 CLI로 set/unset 불가 (자기 신고 차단) ---
if bash "$STATE" set approved_digests '{"x":"deadbeef"}' >/dev/null 2>&1; then
  fail "approved_digests를 CLI로 set할 수 있으면 안 된다"
fi
if bash "$STATE" unset approved_at >/dev/null 2>&1; then
  fail "approved_at을 CLI로 unset할 수 있으면 안 된다"
fi

# --- digest ---
printf 'hello\n' >"$job/drafts/x.md"
expected="$(hash_of "$job/drafts/x.md")"
[ "$(bash "$STATE" digest x)" = "$expected" ] || fail "digest 계산 불일치"

# --- ready 판정식: 승인 없으면 불일치 ---
if bash "$STATE" ready x >/dev/null 2>&1; then
  fail "승인 digest가 없으면 ready가 아니어야 한다"
fi

# --- ready 판정식: 승인 digest와 일치하면 통과 ---
printf '{"approved_digests":{"x":"%s"}}' "$expected" >"$SOCIAL_POSTING_RECEIPT"
bash "$STATE" ready x >/dev/null || fail "digest 일치 시 ready여야 한다"

# --- ready 판정식: 승인 후 초안 수정 시 불일치 (실패-닫힘) ---
printf 'hello world\n' >"$job/drafts/x.md"
if bash "$STATE" ready x >/dev/null 2>&1; then
  fail "승인 후 수정된 초안은 ready가 아니어야 한다"
fi

# --- clear ---
bash "$STATE" clear
[ "$(bash "$STATE" get)" = "{}" ] || fail "clear 후 영수증이 비어 있어야 한다"

echo "✅ post-state.test.sh 통과"
