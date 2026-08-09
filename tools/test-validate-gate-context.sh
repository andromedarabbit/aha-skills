#!/bin/bash
# Regression tests for tools/validate-gate-context.sh
#
# allowed-tools 에 AskUserQuestion 이 있을 때 context 가 fork 면 잡고,
# inline/생략이면 통과시키는지 검증한다.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_PATH="$ROOT_DIR/tools/validate-gate-context.sh"

assert_contains() {
  local needle="$1" haystack="$2" message="$3"
  # 파이프를 쓰지 않는다. `set -o pipefail` 아래에서 grep -q 가 첫 매치에 바로 종료하면
  # 남은 입력을 쓰던 printf 가 죽고 그 상태가 파이프라인 실패로 올라온다 — needle 이
  # 분명히 있는데도 실패로 보고된다. 순수 bash 매칭은 그 경로가 없다.
  # needle 은 따옴표로 감싸 리터럴로 취급된다.
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
  # 있으면 안 되는 것이 있는데도 조용히 통과한다.
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

LAST_OUT=""
LAST_RC=0

# 인라인 allowed-tools + (생략 가능한) context 로 단일 스킬 repo 를 만들고 검증기를 실행.
# stdout 캡처, 종료코드를 전역 LAST_RC 에 저장.
run_inline() {
  local case_name="$1" allowed="$2" context_val="$3"
  local repo="$tmp_root/$case_name"
  mkdir -p "$repo/skills/cat/skill-x"
  {
    echo "---"
    echo "name: skill-x"
    echo "description: test"
    echo "version: 1.0.0"
    echo "allowed-tools: $allowed"
    if [ -n "$context_val" ]; then
      echo "context: $context_val"
    fi
    echo 'language: "korean"'
    echo "---"
  } > "$repo/skills/cat/skill-x/SKILL.md"

  # 검증기를 가짜 저장소로 복사하지 않고 저장소 루트를 인자로 넘긴다.
  set +e
  LAST_OUT="$(bash "$SCRIPT_PATH" "$repo" 2>&1)"
  LAST_RC=$?
  set -e
}

# 블록 리스트 형태의 allowed-tools 테스트용.
run_block() {
  local case_name="$1" context_val="$2"
  local repo="$tmp_root/$case_name"
  mkdir -p "$repo/skills/cat/skill-x"
  {
    echo "---"
    echo "name: skill-x"
    echo "description: test"
    echo "version: 1.0.0"
    echo "allowed-tools:"
    echo "  - Read"
    echo "  - AskUserQuestion"
    if [ -n "$context_val" ]; then
      echo "context: $context_val"
    fi
    echo 'language: "korean"'
    echo "---"
  } > "$repo/skills/cat/skill-x/SKILL.md"

  set +e
  LAST_OUT="$(bash "$SCRIPT_PATH" "$repo" 2>&1)"
  LAST_RC=$?
  set -e
}

echo "=== test-validate-gate-context ==="

# 0) 경로 인자 처리 — 없는 경로는 조용히 자기 저장소로 폴백하지 말고 실패해야 한다.
set +e
LAST_OUT="$(bash "$SCRIPT_PATH" "$tmp_root/does-not-exist" 2>&1)"
LAST_RC=$?
set -e
assert_exit_code 1 "$LAST_RC" "없는 저장소 루트 인자는 실패해야 함"
assert_contains "저장소 루트를 찾을 수 없습니다" "$LAST_OUT" "경로 오류 메시지가 나와야 함"
echo "✅ case bad-root-arg"

# 1) AskUserQuestion + context: fork → 실패 (잡아야 하는 핵심 케이스)
run_inline "fork-gate" "Read, AskUserQuestion" "fork"
assert_exit_code 1 "$LAST_RC" "fork + AskUserQuestion은 실패해야 함"
assert_contains "context가 fork입니다" "$LAST_OUT" "fork 게이트 위반을 잡아야 함"
echo "✅ case fork-gate"

# 2) AskUserQuestion + context: inline → 통과
run_inline "inline-gate" "Read, AskUserQuestion" "inline"
assert_exit_code 0 "$LAST_RC" "inline + AskUserQuestion은 통과해야 함"
assert_contains "오류 0건" "$LAST_OUT" "inline은 오류 0건"
echo "✅ case inline-gate"

# 3) AskUserQuestion + context 생략 → 통과 (기본 inline)
run_inline "omitted-context" "AskUserQuestion" ""
assert_exit_code 0 "$LAST_RC" "context 생략 + AskUserQuestion은 통과해야 함 (기본 inline)"
assert_contains "오류 0건" "$LAST_OUT" "context 생략은 오류 0건"
echo "✅ case omitted-context"

# 4) AskUserQuestion 없음 + context: fork → 통과 (게이트 무관)
run_inline "no-gate-tool" "Read, Bash" "fork"
assert_exit_code 0 "$LAST_RC" "AskUserQuestion 없는 fork는 통과해야 함"
assert_not_contains "❌" "$LAST_OUT" "게이트 무관 스킬은 에러를 보고하면 안 됨"
echo "✅ case no-gate-tool"

# 5) 블록 리스트 형태 allowed-tools + fork → 잡아야 함 (파싱 형태 회귀)
run_block "block-fork" "fork"
assert_exit_code 1 "$LAST_RC" "블록 리스트 + fork는 실패해야 함"
assert_contains "context가 fork입니다" "$LAST_OUT" "블록 리스트 형태도 잡아야 함"
echo "✅ case block-fork"

# 6) 블록 리스트 형태 + inline → 통과
run_block "block-inline" "inline"
assert_exit_code 0 "$LAST_RC" "블록 리스트 + inline은 통과해야 함"
assert_contains "오류 0건" "$LAST_OUT" "블록 inline은 오류 0건"
echo "✅ case block-inline"

# 7) allowed-tools 없는 스킬 → 통과
run_inline "no-allowed-tools" "" ""
assert_exit_code 0 "$LAST_RC" "allowed-tools 없는 스킬은 통과해야 함"
assert_not_contains "❌" "$LAST_OUT" "allowed-tools 없으면 에러가 없어야 함"
echo "✅ case no-allowed-tools"

echo ""
echo "✅ 모든 테스트 통과"
