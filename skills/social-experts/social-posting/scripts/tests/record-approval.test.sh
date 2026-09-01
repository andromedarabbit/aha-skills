#!/bin/bash
# record-approval.sh — 승인 훅 계약 검증. header/답변 계약·no-op 조건·크래시 무결성.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
HOOK="$SKILL_DIR/scripts/record-approval.sh"

sandbox="$(mktemp -d)"
trap 'rm -rf "$sandbox"' EXIT
# 포인터 파일 경로도 샌드박스 안으로 — 글로벌 포인터와 섞이지 않게
export TMPDIR="$sandbox/tmp"
mkdir -p "$TMPDIR"
job="$sandbox/job"
mkdir -p "$job/drafts"
printf 'draft-x\n' >"$job/drafts/x.md"
printf 'draft-li\n' >"$job/drafts/linkedin.md"
cat >"$job/job-state.md" <<'EOF'
---
stage: 8
slug: t
platforms: [x, linkedin]
accounts: {x: u0, linkedin: u1}
status: {x: draft, linkedin: draft}
---
EOF

receipt="$job/receipt.json"

fail() { echo "❌ $1" >&2; exit 1; }

hash_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

run_hook() {
  printf '%s' "$1" | SOCIAL_POSTING_JOB="$job" bash "$HOOK"
}

# --- 1. 정상 승인: header '게시 승인' + 답변 '게시' ---
approval_json='{"tool_name":"AskUserQuestion","tool_input":{"questions":[{"question":"이 문구로 게시할까요?","header":"게시 승인","options":[{"label":"게시"},{"label":"수정"},{"label":"취소"}]}]},"tool_response":{"answers":{"이 문구로 게시할까요?":"게시"}}}'
run_hook "$approval_json"

jq -e '.approved_via == "posttooluse-hook" and (.approved_at | type == "string")' "$receipt" >/dev/null \
  || fail "정상 승인에서 approved_via/approved_at이 기록되지 않았다"
[ "$(jq -r '.approved_accounts' "$receipt")" = "{x: u0, linkedin: u1}" ] \
  || fail "승인 시점 accounts 스냅샷(approved_accounts)이 기록되지 않았다: $(cat "$receipt")"
[ "$(jq -r '.approved_digests.x' "$receipt")" = "$(hash_of "$job/drafts/x.md")" ] \
  || fail "approved_digests.x가 실측 sha256과 불일치"
[ "$(jq -r '.approved_digests.linkedin' "$receipt")" = "$(hash_of "$job/drafts/linkedin.md")" ] \
  || fail "approved_digests.linkedin가 실측 sha256과 불일치"

# --- 2. header 불일치 → no-op ---
rm -f "$receipt"
other_header='{"tool_name":"AskUserQuestion","tool_input":{"questions":[{"question":"진행할까요?","header":"커밋 범위","options":[{"label":"진행"}]}]},"tool_response":{"answers":{"진행할까요?":"진행"}}}'
run_hook "$other_header"
[ ! -f "$receipt" ] || fail "계약 외 header('커밋 범위')에 반응하면 안 된다"

# --- 3. 답변 불일치('수정') → no-op ---
rm -f "$receipt"
revised_json='{"tool_name":"AskUserQuestion","tool_input":{"questions":[{"question":"이 문구로 게시할까요?","header":"게시 승인","options":[{"label":"게시"},{"label":"수정"}]}]},"tool_response":{"answers":{"이 문구로 게시할까요?":"수정"}}}'
run_hook "$revised_json"
[ ! -f "$receipt" ] || fail "답변 '수정'은 승인이 아니다 — 기록하면 안 된다"

# --- 4. tool_name 불일치 → no-op ---
rm -f "$receipt"
bash_tool='{"tool_name":"Bash","tool_input":{"command":"echo hi"},"tool_response":{}}'
run_hook "$bash_tool"
[ ! -f "$receipt" ] || fail "AskUserQuestion 외 도구 이벤트에 반응하면 안 된다"

# --- 5. malformed stdin → 크래시 없이 exit 0 ---
if ! printf 'not-json{{{' | SOCIAL_POSTING_JOB="$job" bash "$HOOK"; then
  fail "malformed 입력에서 exit 0이어야 한다"
fi

# --- 6. 활성 작업 없음 → 조용히 no-op ---
if ! printf '%s' "$approval_json" | env -u SOCIAL_POSTING_JOB bash "$HOOK"; then
  fail "작업 없음에도 exit 0이어야 한다"
fi

echo "✅ record-approval.test.sh 통과"
