#!/usr/bin/env bats
# Example test file — replace with real tests for your skill.
#
# 이 파일을 실제 테스트로 교체하세요.
# BATS 문서: https://github.com/bats-core/bats-core
# 저장소 내 실제 예시: skills/git-experts/commit-rule-extractor/scripts/tests/

setup() {
  TEST_DIR="$(mktemp -d)"
  export HOME="$TEST_DIR"
  # Add your test setup here (temp files, PATH stubs, etc.)
}

teardown() {
  rm -rf "$TEST_DIR"
}

@test "example: script exits successfully" {
  # Replace with your actual script path and arguments
  run echo "hello from test"
  [ "$status" -eq 0 ]
  [[ "$output" == *"hello"* ]]
}
