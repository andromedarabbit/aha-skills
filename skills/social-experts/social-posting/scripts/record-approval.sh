#!/bin/bash
# record-approval.sh - PostToolUse 훅 (matcher: AskUserQuestion)
#
# 목적: 게시 승인(Stage 8)이 실제로 AskUserQuestion 도구로 사용자에게
# 물어보고 응답을 받았다는 사실을, 에이전트의 자기 신고가 아니라 **하네스가
# 직접 목격한 사실**로 영수증에 남긴다.
#
# 왜 필요한가: publish.sh의 digest 가드는 "승인 시점 초안 = 현재 초안"만 증명한다.
# 에이전트가 AskUserQuestion 없이 승인을 만들어 넘겨도 그 검사는 통과할 수 있다.
# 이 훅은 승인 기록 경로를 "실제 AskUserQuestion PostToolUse 이벤트가 있어야만
# 채워지는 곳"(lib/receipt.sh)으로 제한한다 — post-state.sh로는 approved_*를
# set할 수 없으므로, 이 훅이 승인 기록의 유일한 입구다.
#
# 하네스 계약(oh-my-skills gitlab-mr-creation의 record-stage4-approval.sh가
# 실제 Claude Code 바이너리 zod 스키마로 확인한 것과 동일 구조):
#   PostToolUse 이벤트: {hook_event_name, session_id, cwd, tool_name, tool_input,
#     tool_response, ...}
#   AskUserQuestion tool_input: {questions: [{question, header, options, multiSelect}]}
#   tool_response: {answers: {<question 텍스트>: <선택 답변 텍스트>, ...}}
#   PostToolUse는 도구 호출이 성공한 뒤(= 사용자 응답 수령 후) 발동한다.
#
# 훅 계약: tool_input.questions 중 header가 정확히 "게시 승인"인 문항의 답변이
# 정확히 "게시"일 때만 승인으로 기록한다. SKILL.md Stage 8이 이 header·답변
# 문구를 그대로 써야 훅이 인식한다.
#
# 기록 내용: 활성 작업 drafts/ 아래 모든 <platform>.md의 sha256을
# approved_digests 객체로 남기고(승인 시점에 존재하는 초안 전부가 승인 대상),
# 승인 시점의 accounts 매핑을 approved_accounts로 스냅샷한다 — 승인 후 계정이
# 바뀌면 publish.sh가 이 값과의 불일치로 게시를 거부한다(계정 재타깃 가드).
# 승인 대상 플랫폼을 좁히려면 Stage 2에서 platforms를 줄이면 된다.
#
# 한계(문서화): 로컬 bash 스크립트라 에이전트가 이 스크립트를 직접 호출하며
# 위조 stdin을 흘려보내면 속일 수 있다. 그건 정상 도구 호출 경로를 지키는
# 에이전트의 우회를 막는 이 설계의 대상이 아닌 노골적 적대 행위다.
#
# 항상 exit 0(하네스 표준). 실패는 조용히 무시한다 — 훅이 못 돌면 승인이
# 기록되지 않을 뿐이고 publish.sh가 실패-닫힘으로 거부한다.

set -uo pipefail

main() {
  local input tool_name tool_input tool_response
  input="$(cat)"

  tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)"
  [ "$tool_name" = "AskUserQuestion" ] || exit 0

  tool_input="$(printf '%s' "$input" | jq -c '.tool_input // {}' 2>/dev/null)"
  tool_response="$(printf '%s' "$input" | jq -c '.tool_response // {}' 2>/dev/null)"

  # 훅 계약: header가 정확히 "게시 승인"인 문항의 question 텍스트를 찾고,
  # 그 문항에 대한 answers[question]이 정확히 "게시"일 때만 반응한다.
  local q_text answer
  q_text="$(printf '%s' "$tool_input" | jq -r '
    (.questions // [])
    | map(select((.header // "") == "게시 승인"))
    | .[0].question // empty
  ' 2>/dev/null)"
  [ -n "$q_text" ] || exit 0

  answer="$(printf '%s' "$tool_response" | jq -r --arg q "$q_text" '.answers[$q] // empty' 2>/dev/null)"
  [ "$answer" = "게시" ] || exit 0

  local job lib_path
  job="$(printf '%s' "${SOCIAL_POSTING_JOB:-}")"
  if [ -z "$job" ]; then
    local pointer="${TMPDIR:-/tmp}/social-posting-current-job"
    [ -f "$pointer" ] || exit 0
    job="$(head -1 "$pointer")"
  fi
  [ -d "$job/drafts" ] || exit 0

  lib_path="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/receipt.sh"
  [ -f "$lib_path" ] || exit 0
  # shellcheck source=SCRIPTDIR/lib/receipt.sh
  source "$lib_path"

  export SOCIAL_POSTING_RECEIPT="${job%/}/receipt.json"

  # 승인 시점 초안 digest 전부를 객체로 만든다
  local digests draft name
  digests="{}"
  for draft in "$job"/drafts/*.md; do
    [ -f "$draft" ] || continue
    name="$(basename "$draft" .md)"
    digests="$(printf '%s' "$digests" | jq --arg k "$name" --arg v "$(hash_file "$draft")" '.[$k] = $v')"
  done

  receipt_set_json approved_digests "$digests"
  receipt_set approved_at "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  receipt_set approved_via "posttooluse-hook"

  # 승인 시점 계정 매핑 스냅샷 (계정 재타깃 가드 — publish.sh가 대조한다)
  local accounts_line
  accounts_line="$(sed -n 's/^accounts:[[:space:]]*//p' "$job/job-state.md" 2>/dev/null | head -1)"
  if [ -n "$accounts_line" ]; then
    receipt_set approved_accounts "$accounts_line"
  fi

  exit 0
}

main
