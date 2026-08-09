#!/bin/bash
# Regression tests for tools/validate-matchers.sh
#
# 두 버그 클래스를 잡는지, 그리고 정상 matcher를 오탐하지 않는지 검증한다.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_PATH="$ROOT_DIR/tools/validate-matchers.sh"

assert_contains() {
  local needle="$1" haystack="$2" message="$3"
  # 파이프를 쓰지 않는다. `set -o pipefail` 아래에서 grep -q 가 첫 매치에 바로 종료하면
  # 남은 입력을 쓰던 printf 가 죽고 그 상태가 파이프라인 실패로 올라온다 — needle 이
  # 분명히 있는데도 실패로 보고된다. 실제로 CI 에서 48KB SKILL.md 상대로 간헐 실패했고
  # (MR !46, 재실행하니 통과) 입력이 클수록 잘 터진다. 순수 bash 매칭은 그 경로가 없다.
  # needle 은 따옴표로 감싸 리터럴로 취급된다 — grep -F 와 같고, 대시로 시작해도 안전하다.
  if [[ "$haystack" != *"$needle"* ]]; then
    echo "❌ $message"
    echo "   expected to contain: $needle"
    echo "   output:"
    printf '%s\n' "$haystack"
    exit 1
  fi
}

assert_not_contains() {
  local needle="$1" haystack="$2" message="$3"
  # assert_contains 와 같은 이유로 파이프를 쓰지 않는다. 이쪽은 방향이 반대라 더 위험하다 —
  # grep 이 매치하고 조기 종료해 printf 가 죽으면 pipefail 이 파이프라인을 실패로 만들고,
  # 그러면 이 `if` 가 거짓이 되어 **있으면 안 되는 것이 있는데도 조용히 통과**한다.
  if [[ "$haystack" == *"$needle"* ]]; then
    echo "❌ $message"
    echo "   expected NOT to contain: $needle"
    echo "   output:"
    printf '%s\n' "$haystack"
    exit 1
  fi
}

assert_exit_code() {
  local expected="$1" actual="$2" message="$3"
  if [ "$expected" -ne "$actual" ]; then
    echo "❌ $message (expected=$expected actual=$actual)"
    exit 1
  fi
}

tmp_root="$(mktemp -d)"
trap 'rm -rf "$tmp_root"' EXIT

# 주어진 hooks 블록을 가진 단일 스킬 repo를 만들고 검증기를 실행.
# stdout 캡처, 종료코드를 전역 LAST_RC에 저장.
LAST_OUT=""
LAST_RC=0
run_with_hooks() {
  local case_name="$1" hooks_block="$2"
  local repo="$tmp_root/$case_name"
  mkdir -p "$repo/skills/cat/skill-x"
  {
    echo "---"
    echo "name: skill-x"
    echo "description: test"
    echo "version: 1.0.0"
    echo "context: fork"
    echo "agent: general-purpose"
    echo 'language: "korean"'
    printf '%s\n' "$hooks_block"
    echo "---"
  } > "$repo/skills/cat/skill-x/SKILL.md"

  # 검증기를 가짜 저장소로 복사하지 않고 저장소 루트를 인자로 넘긴다 — 복사본이 원본과
  # 갈라질 여지를 없앤다.
  set +e
  LAST_OUT="$(bash "$SCRIPT_PATH" "$repo" 2>&1)"
  LAST_RC=$?
  set -e
}

echo "=== test-validate-matchers ==="

# 0) 경로 인자 처리 — 없는 경로는 조용히 자기 저장소로 폴백하지 말고 실패해야 한다.
#    폴백하면 CI가 엉뚱한 트리를 검사하고도 초록불을 내준다.
set +e
LAST_OUT="$(bash "$SCRIPT_PATH" "$tmp_root/does-not-exist" 2>&1)"
LAST_RC=$?
set -e
assert_exit_code 1 "$LAST_RC" "없는 저장소 루트 인자는 실패해야 함"
assert_contains "저장소 루트를 찾을 수 없습니다" "$LAST_OUT" "경로 오류 메시지가 나와야 함"
echo "✅ case bad-root-arg"

# 1) 정상 matcher + 정상 이벤트 → 통과, 오탐 없음
run_with_hooks "valid" 'hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/skill-x/scripts/a.sh\""
  PostToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "bash .claude/skills/cat/skill-x/scripts/b.sh"
    - matcher: "mcp__example__resource_(create|update)_action"
      hooks:
        - type: command
          command: "bash .claude/skills/cat/skill-x/scripts/c.sh"'
assert_exit_code 0 "$LAST_RC" "정상 matcher는 통과해야 함"
assert_contains "오류 0건" "$LAST_OUT" "정상 케이스는 오류 0건"
echo "✅ case valid"

# 2) 존재하지 않는 이벤트(PostToolWrite) → 실패
run_with_hooks "bad-event" 'hooks:
  PostToolWrite:
    - matcher: ".*commit-message\\.txt$"
      hooks:
        - type: command
          command: "bash .claude/skills/cat/skill-x/scripts/a.sh"'
assert_exit_code 1 "$LAST_RC" "PostToolWrite는 실패해야 함"
assert_contains "존재하지 않는 hook 이벤트 'PostToolWrite'" "$LAST_OUT" "PostToolWrite 이벤트를 잡아야 함"
echo "✅ case bad-event"

# 3) 명령 내용 matcher → 절대 발동 불가로 실패
run_with_hooks "content-matcher" 'hooks:
  PreToolUse:
    - matcher: "Bash.*git.*commit"
      hooks:
        - type: command
          command: "bash .claude/skills/cat/skill-x/scripts/a.sh"'
assert_exit_code 1 "$LAST_RC" "내용 matcher는 실패해야 함"
assert_contains "절대 발동 안 함" "$LAST_OUT" "내용 matcher를 잡아야 함"
echo "✅ case content-matcher"

# 4) 파일 경로 matcher → 실패 (tool 이벤트에서)
run_with_hooks "path-matcher" 'hooks:
  PostToolUse:
    - matcher: ".*mr-description\\.md$"
      hooks:
        - type: command
          command: "bash .claude/skills/cat/skill-x/scripts/a.sh"'
assert_exit_code 1 "$LAST_RC" "경로 matcher는 실패해야 함"
assert_contains "절대 발동 안 함" "$LAST_OUT" "경로 matcher를 잡아야 함"
echo "✅ case path-matcher"

# 5) 정상 Bash.* 와이드 matcher → 통과 (오탐 회귀 방지)
run_with_hooks "wide-bash" 'hooks:
  PreToolUse:
    - matcher: "Bash.*"
      hooks:
        - type: command
          command: "bash .claude/skills/cat/skill-x/scripts/a.sh"'
assert_exit_code 0 "$LAST_RC" "Bash.* 는 통과해야 함"
assert_not_contains "절대 발동 안 함" "$LAST_OUT" "Bash.* 를 오탐하면 안 됨"
echo "✅ case wide-bash"

# 6) 훅을 선언한 스킬이 아예 없는 트리 → 통과해야 한다 (상류와의 의도적 차이)
#    상류는 `checked == 0` 자체를 실패로 봤다. 이 저장소는 훅 없는 스킬 하나로 시작할 수
#    있어서(skill-author 가 정확히 그렇다) 그러면 첫 실행부터 빨간불이 된다. 가드의 원래
#    의도는 "선언했는데 안 잡힌다"이므로 조건을 그쪽으로 좁혔고, 이 케이스가 그 회귀를 막는다.
run_with_hooks "no-hooks" ''
assert_exit_code 0 "$LAST_RC" "훅 없는 트리는 통과해야 함"
assert_contains "훅을 선언한 스킬이 없습니다" "$LAST_OUT" "훅 0건 안내가 나와야 함"
assert_not_contains "❌" "$LAST_OUT" "훅 없는 트리를 실패로 보고하면 안 됨"
echo "✅ case no-hooks"

echo ""
echo "✅ 모든 테스트 통과"
