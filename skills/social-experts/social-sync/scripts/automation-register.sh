#!/usr/bin/env bash
# social-sync orca automation을 등록·조회한다. 생성은 항상 --disabled로 한다 —
# 활성화는 setup 모드가 마지막 AskUserQuestion 확인 뒤 orca automations edit로 한다.
#
# 사용법:
#   automation-register.sh --create --workspace <selector> [--trigger "<cron>"]
#   automation-register.sh --status
#
# --workspace: orca 워크스페이스 셀렉터(path:<dir> 등). setup 모드가 현재 저장소
# 경로에서 만들어 전달한다. --trigger: 5필드 cron (기본 매시간 "0 * * * *").
#
# env: SOCIAL_SYNC_CONFIG_DIR, SOCIAL_SYNC_ORCA (orca 대신 스텁 명령 — 테스트용)
set -euo pipefail

CONFIG_DIR="${SOCIAL_SYNC_CONFIG_DIR:-$HOME/.config/social-sync}"
ORCA="${SOCIAL_SYNC_ORCA:-orca}"
NAME="social-sync"
PROMPT="/social-sync tick"
PRECHECK="bash ${CONFIG_DIR}/gate.sh"
PRECHECK_TIMEOUT="600"  # orca 상한이 600초다 (게이트 자체는 플랫폼당 120초 상한이 따로 있다)
DEFAULT_TRIGGER="0 * * * *"
TIMEZONE="Asia/Seoul"

usage() {
  sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

automation_show() {
  # name으로 automation을 찾아 상태 JSON을 내거나 빈 문자열을 반환한다.
  "$ORCA" automations list --json 2>/dev/null |
    jq -r --arg name "$NAME" '
      (.result // . | if type == "array" then . else (.automations // []) end)
      | map(select(.name == $name)) | .[0] // empty' 2>/dev/null
}

check_register_result() {
  local body="$1"
  jq -e '.ok == true' >/dev/null 2>&1 <<<"$body" || {
    echo "❌ orca automations create가 실패했습니다: $body" >&2
    exit 1
  }
  jq -r '.result.automation.id // .result.id // empty' <<<"$body"
}

main() {
  [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && usage 0

  local mode="${1:-}"
  shift || true

  case "$mode" in
    --status)
      local found
      found="$(automation_show)"
      if [[ -z "$found" ]]; then
        printf '{"registered": false}\n'
        exit 0
      fi
      local id trigger enabled precheck prompt drift="false"
      id="$(jq -r '.id // empty' <<<"$found")"
      trigger="$(jq -r '.trigger // empty' <<<"$found")"
      enabled="$(jq -r '.enabled // false' <<<"$found")"
      local detail
      detail="$("$ORCA" automations show "$id" --json 2>/dev/null || true)"
      precheck="$(jq -r '.result.precheck // .precheck // empty' <<<"$detail")"
      prompt="$(jq -r '.result.prompt // .prompt // empty' <<<"$detail")"
      [[ "$precheck" == "$PRECHECK" && "$prompt" == "$PROMPT" ]] || drift="true"
      jq -n --arg id "$id" --arg trigger "$trigger" --arg precheck "$precheck" --arg prompt "$prompt" \
        --arg enabled "$enabled" --arg drift "$drift" \
        '{registered: true, id: $id, enabled: ($enabled | test("true")), trigger: $trigger,
          precheck: $precheck, prompt: $prompt, drift: ($drift == "true")}'
      exit 0
      ;;
    --create)
      local workspace="" trigger="$DEFAULT_TRIGGER"
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --workspace) workspace="${2:?}"; shift 2 ;;
          --trigger) trigger="${2:?}"; shift 2 ;;
          *) usage 1 ;;
        esac
      done
      [[ -n "$workspace" ]] || usage 1
      local body id
      body="$("$ORCA" automations create --name "$NAME" --trigger "$trigger" \
        --prompt "$PROMPT" --provider claude --timezone "$TIMEZONE" \
        --precheck "$PRECHECK" --precheck-timeout "$PRECHECK_TIMEOUT" \
        --fresh-session --workspace "$workspace" --disabled --json)"
      id="$(check_register_result "$body")"
      [[ -n "$id" ]] || { echo "❌ automation id를 회수하지 못했습니다: $body" >&2; exit 1; }
      printf '{"created": true, "id": "%s", "enabled": false, "trigger": "%s"}\n' "$id" "$trigger"
      exit 0
      ;;
    *)
      usage 1
      ;;
  esac
}

main "$@"
