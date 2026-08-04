#!/usr/bin/env bats
# Regression tests for the test runner (run.sh) that this skill ships in two
# places: its own scripts/tests/ and the scaffold template.
#
# Regression: py_dirs collected a directory when it held EITHER test_*.py OR
# *.test.py, then handed that directory to pytest. pytest does not collect
# *.test.py under its default python_files pattern, so a directory holding only
# *.test.py made pytest exit 5 ("no tests collected"), and set -euo pipefail
# killed the whole runner before the manual fallback loop ever ran.
#
# NOTE: @test names must stay ASCII. Non-ASCII names make bats report
# "unknown test name" and silently run zero tests, which looks like a pass.

setup() {
  TEST_DIR="$(mktemp -d)"
  BATS_SKILL_DIR="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SKILL_RUNNER="$BATS_SKILL_DIR/scripts/tests/run.sh"
  TEMPLATE_RUNNER="$BATS_SKILL_DIR/assets/skill-template/scripts/tests/run.sh"
}

teardown() {
  rm -rf "$TEST_DIR"
}

# Build a throwaway skill tree whose scripts/tests/ holds a copy of the given
# runner. Echoes the path of the copied runner.
make_skill() {
  local runner="$1" name="$2"
  local tests_dir="$TEST_DIR/$name/scripts/tests"
  mkdir -p "$tests_dir"
  cp "$runner" "$tests_dir/run.sh"
  chmod +x "$tests_dir/run.sh"
  echo "$tests_dir"
}

write_passing_dot_test_py() {
  printf 'print("ok")\n' > "$1/sample.test.py"
}

write_failing_dot_test_py() {
  printf 'raise SystemExit(1)\n' > "$1/sample.test.py"
}

write_passing_pytest_py() {
  printf 'def test_ok():\n    assert True\n' > "$1/test_sample.py"
}

# pytest's default python_files pattern is `test_*.py *_test.py`. Both must
# reach pytest, or a suite named the second way is silently never run.
write_passing_suffix_pytest_py() {
  printf 'def test_ok():\n    assert True\n' > "$1/sample_test.py"
}

# --- the regression itself ---------------------------------------------------

@test "skill runner passes when the dir holds only dot-test-dot-py files" {
  local tests_dir
  tests_dir="$(make_skill "$SKILL_RUNNER" s-only-manual)"
  write_passing_dot_test_py "$tests_dir"

  run bash "$tests_dir/run.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"sample.test.py"* ]]
  [[ "$output" == *"스위트 1개"* ]]
}

@test "template runner passes when the dir holds only dot-test-dot-py files" {
  local tests_dir
  tests_dir="$(make_skill "$TEMPLATE_RUNNER" t-only-manual)"
  write_passing_dot_test_py "$tests_dir"

  run bash "$tests_dir/run.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"sample.test.py"* ]]
}

# uv is only needed for the pytest half. Requiring it for a *.test.py-only
# suite turned a runnable suite into a hard failure.
@test "dot-test-dot-py only suites do not require uv" {
  if [ ! -x /usr/bin/python3 ]; then
    skip "no /usr/bin/python3 to build a uv-free PATH with"
  fi
  local tests_dir
  tests_dir="$(make_skill "$SKILL_RUNNER" s-plain-path)"
  write_passing_dot_test_py "$tests_dir"

  run env PATH="/usr/bin:/bin" bash "$tests_dir/run.sh"
  [ "$status" -eq 0 ]
  [[ "$output" != *"uv"* ]]
}

# --- the fix must not hide real failures -------------------------------------

@test "a failing dot-test-dot-py file still fails the runner" {
  local tests_dir
  tests_dir="$(make_skill "$SKILL_RUNNER" s-manual-fails)"
  write_failing_dot_test_py "$tests_dir"

  run bash "$tests_dir/run.sh"
  [ "$status" -ne 0 ]
}

@test "an empty tests dir still fails instead of reporting zero suites as green" {
  local tests_dir
  tests_dir="$(make_skill "$SKILL_RUNNER" s-empty)"

  run bash "$tests_dir/run.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"0개"* ]]
}

# --- the pytest half keeps working -------------------------------------------

@test "pytest targets still run and both python patterns coexist" {
  if ! command -v uv >/dev/null 2>&1; then
    skip "uv is required to exercise the pytest half"
  fi
  local tests_dir
  tests_dir="$(make_skill "$SKILL_RUNNER" s-both)"
  write_passing_pytest_py "$tests_dir"
  write_passing_dot_test_py "$tests_dir"

  run bash "$tests_dir/run.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"test_sample.py"* ]]
  [[ "$output" == *"sample.test.py"* ]]
  # one pytest suite + one manual suite
  [[ "$output" == *"스위트 2개"* ]]
}

@test "suffix-named pytest files reach pytest instead of being dropped" {
  if ! command -v uv >/dev/null 2>&1; then
    skip "uv is required to exercise the pytest half"
  fi
  local tests_dir
  tests_dir="$(make_skill "$SKILL_RUNNER" s-suffix)"
  write_passing_suffix_pytest_py "$tests_dir"

  run bash "$tests_dir/run.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"sample_test.py"* ]]
  [[ "$output" == *"스위트 1개"* ]]
}

@test "missing uv is still a hard failure when there is a pytest target" {
  if [ ! -x /usr/bin/python3 ]; then
    skip "no /usr/bin/python3 to build a uv-free PATH with"
  fi
  local tests_dir
  tests_dir="$(make_skill "$SKILL_RUNNER" s-pytest-no-uv)"
  write_passing_pytest_py "$tests_dir"

  run env PATH="/usr/bin:/bin" bash "$tests_dir/run.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"uv"* ]]
}

# --- the two copies must not drift -------------------------------------------
#
# This repo has already been bitten by a derived copy diverging from its
# original (two hash implementations -> permanent re-extraction loop). The
# template copy is what every scaffolded skill inherits, so a fix landing in
# only one of them silently ships the bug forward.

@test "skill runner and template runner stay byte identical" {
  run cmp "$SKILL_RUNNER" "$TEMPLATE_RUNNER"
  [ "$status" -eq 0 ]
}
