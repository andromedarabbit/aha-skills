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

# 혼합 작업에서 질문에 표시하지 않은 초안을 승인하면 안 된다.
mixed_job="$sandbox/job-mixed"
mkdir -p "$mixed_job/drafts"
printf 'draft-x\n' >"$mixed_job/drafts/x.md"
printf 'draft-facebook\n' >"$mixed_job/drafts/facebook.md"
printf 'platforms: [x, facebook]\naccounts: {x: me, facebook: other}\n' >"$mixed_job/job-state.md"
selected_json='{"tool_name":"AskUserQuestion","tool_input":{"questions":[{"question":"게시 대상: x\n이 문구로 게시할까요?","header":"게시 승인"}]},"tool_response":{"answers":{"게시 대상: x\n이 문구로 게시할까요?":"게시"}}}'
printf '%s' "$selected_json" | SOCIAL_POSTING_JOB="$mixed_job" bash "$HOOK"
jq -e '.approved_digests | keys == ["x"]' "$mixed_job/receipt.json" >/dev/null \
  || fail "X만 표시한 승인은 같은 작업의 Facebook 초안을 포함하면 안 된다"

# 잘못된 범위는 신규 승인도 만들지 않고 기존 영수증도 바꾸지 않는다.
mkdir -p "$mixed_job/invalid"
printf 'draft-threads\n' >"$mixed_job/drafts/threads.md"
printf 'platforms: [x, facebook, bluesky, threads]\naccounts: {x: me, facebook: other}\n' >"$mixed_job/job-state.md"
for question in '이 문구로 게시할까요?' '게시 대상:' '게시 대상: ' \
  '게시 대상: x,x' '게시 대상: twitter' '게시 대상: linkedin' \
  '게시 대상: x,bluesky' '게시 대상: x,threads' '게시 대상: threads' \
  '게시 대상: x,' '게시 대상: x, facebook' $'게시 대상: x\n게시 대상: facebook'; do
  event="$(jq -nc --arg q "$question" '{tool_name:"AskUserQuestion",tool_input:{questions:[{header:"게시 승인",question:$q}]},tool_response:{answers:{($q):"게시"}}}')"
  printf '{"approved_digests":{"facebook":"legacy"},"approved_accounts":"{x: me, facebook: other}","posted_facebook":"https://stub.example/fb/1","posted_facebook_at":"2026-11-01T00:00:00Z"}' >"$mixed_job/receipt.json"
  before="$(hash_of "$mixed_job/receipt.json")"
  printf '%s' "$event" | SOCIAL_POSTING_JOB="$mixed_job" bash "$HOOK"
  [ "$(hash_of "$mixed_job/receipt.json")" = "$before" ] || fail "잘못된 질문이 기존 영수증을 바꿨다: $question"
  mv "$mixed_job/receipt.json" "$mixed_job/invalid/receipt.json"
  printf '%s' "$event" | SOCIAL_POSTING_JOB="$mixed_job" bash "$HOOK"
  [ ! -f "$mixed_job/receipt.json" ] || fail "잘못된 질문이 새 승인을 만들었다: $question"
done
mv "$mixed_job/invalid/receipt.json" "$mixed_job/receipt.json"
state_before="$(hash_of "$mixed_job/job-state.md")"
facebook_before="$(hash_of "$mixed_job/drafts/facebook.md")"
printf '%s' "$selected_json" | SOCIAL_POSTING_JOB="$mixed_job" bash "$HOOK"
jq -e '.approved_digests | keys == ["x"]' "$mixed_job/receipt.json" >/dev/null || fail "새 승인은 기존 Facebook 승인과 병합하면 안 된다"
jq -e '.approved_accounts == "{x: me, facebook: other}" and .posted_facebook == "https://stub.example/fb/1" and .posted_facebook_at == "2026-11-01T00:00:00Z"' "$mixed_job/receipt.json" >/dev/null || fail "단독 승인도 전체 계정 스냅샷과 게시 기록을 보존해야 한다"
[ "$(hash_of "$mixed_job/job-state.md")" = "$state_before" ] || fail "승인 범위를 좁히려고 기존 job을 축소하면 안 된다"
[ "$(hash_of "$mixed_job/drafts/facebook.md")" = "$facebook_before" ] || fail "선택하지 않은 Facebook 초안을 바꾸거나 삭제하면 안 된다"

# Instagram이 섞인 요청은 전부 거부하고, X만 표시한 승인은 전체 계정·게시 기록을 보존한다.
instagram_job="$sandbox/job-instagram"
mkdir -p "$instagram_job/drafts"
printf 'draft-x\n' >"$instagram_job/drafts/x.md"
printf 'draft-instagram\n' >"$instagram_job/drafts/instagram.md"
printf 'platforms: [x, instagram]\naccounts: {x: me, instagram: photo-owner}\n' >"$instagram_job/job-state.md"
printf '{"approved_digests":{"x":"legacy"},"approved_accounts":"{x: me, instagram: photo-owner}","posted_x":"https://stub.example/x/1","posted_instagram":"https://www.instagram.com/p/old/","posted_instagram_at":"2026-11-01T00:00:00Z"}' >"$instagram_job/receipt.json"
state_before="$(hash_of "$instagram_job/job-state.md")"
draft_before="$(hash_of "$instagram_job/drafts/instagram.md")"
for question in '게시 대상: instagram' '게시 대상: x,instagram' '게시 대상: instagram,x'; do
  event="$(jq -nc --arg q "$question" '{tool_name:"AskUserQuestion",tool_input:{questions:[{header:"게시 승인",question:$q}]},tool_response:{answers:{($q):"게시"}}}')"
  before="$(hash_of "$instagram_job/receipt.json")"
  printf '%s' "$event" | SOCIAL_POSTING_JOB="$instagram_job" bash "$HOOK"
  [ "$(hash_of "$instagram_job/receipt.json")" = "$before" ] || fail "Instagram 혼합 승인을 일부 승인으로 복구하면 안 된다"
  mv "$instagram_job/receipt.json" "$sandbox/instagram-receipt.json"
  printf '%s' "$event" | SOCIAL_POSTING_JOB="$instagram_job" bash "$HOOK"
  [ ! -f "$instagram_job/receipt.json" ] || fail "Instagram을 포함한 새 승인을 만들면 안 된다"
  mv "$sandbox/instagram-receipt.json" "$instagram_job/receipt.json"
done
printf '%s' "$selected_json" | SOCIAL_POSTING_JOB="$instagram_job" bash "$HOOK"
jq -e '(.approved_digests | keys == ["x"]) and .approved_accounts == "{x: me, instagram: photo-owner}" and .posted_x == "https://stub.example/x/1" and .posted_instagram == "https://www.instagram.com/p/old/" and .posted_instagram_at == "2026-11-01T00:00:00Z"' "$instagram_job/receipt.json" >/dev/null || fail "X만 승인해도 Instagram을 포함한 계정·게시 기록은 보존해야 한다"
[ "$(hash_of "$instagram_job/job-state.md")" = "$state_before" ] || fail "Instagram 혼합 작업의 범위를 축소하면 안 된다"
[ "$(hash_of "$instagram_job/drafts/instagram.md")" = "$draft_before" ] || fail "Instagram 초안은 보존해야 한다"

# --- 1. 정상 승인: header '게시 승인' + 답변 '게시' ---
approval_json='{"tool_name":"AskUserQuestion","tool_input":{"questions":[{"question":"게시 대상: x,linkedin\n이 문구로 게시할까요?","header":"게시 승인","options":[{"label":"게시"},{"label":"수정"},{"label":"취소"}]}]},"tool_response":{"answers":{"게시 대상: x,linkedin\n이 문구로 게시할까요?":"게시"}}}'
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
revised_json='{"tool_name":"AskUserQuestion","tool_input":{"questions":[{"question":"게시 대상: x,linkedin\n이 문구로 게시할까요?","header":"게시 승인","options":[{"label":"게시"},{"label":"수정"}]}]},"tool_response":{"answers":{"게시 대상: x,linkedin\n이 문구로 게시할까요?":"수정"}}}'
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
