#!/bin/bash
# Run all skill tests via discovery.
# CI calls this script; developers can also run it locally.
#
# Discovery rules:
#   1. Find skills/*/*/scripts/tests/run.sh (excluding *-workspace directories)
#   2. Find skills/*/shared/tests/*.bats (shared test suites)
#   3. Skip skills with a .ci-skip-test marker file
#
# Suites run in parallel (TEST_JOBS, default 4). 스위트 하나라도 실패하면 종료 코드 1.
# 병렬이라 즉시 중단하지 않고 끝까지 돈 뒤 실패 스위트의 로그를 전부 출력한다.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

JOBS="${TEST_JOBS:-4}"

# --- Pre-flight: check bats availability ---
if ! command -v bats >/dev/null 2>&1; then
  echo "❌ bats-core is required but not found."
  echo "   Install: https://github.com/bats-core/bats-core#installation"
  exit 1
fi

SUITES=()   # 원소: "kind|path|label" (kind: run|bats)
SKIPPED=0

echo "=== Discovering skill tests ==="
echo ""

# --- Phase 1: Skill-level run.sh discovery ---
while IFS= read -r run_sh; do
  # Derive skill directory (two levels up from scripts/tests/run.sh)
  skill_dir="$(cd "$(dirname "$run_sh")/../.." && pwd)"
  skill_name="$(basename "$skill_dir")"
  relative_path="${run_sh#"$REPO_ROOT/"}"

  # Skip workspace/snapshot directories
  if [[ "$relative_path" == *"-workspace/"* ]]; then
    continue
  fi

  # Skip if .ci-skip-test marker exists
  if [[ -f "$skill_dir/.ci-skip-test" ]]; then
    reason="$(cat "$skill_dir/.ci-skip-test" 2>/dev/null || echo "no reason given")"
    echo "⏭️  [$skill_name] skipped — $reason"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  SUITES+=("run|$run_sh|$skill_name")
done < <(find skills -path "*/scripts/tests/run.sh" -type f | sort)

# --- Phase 2: Shared BATS test suites ---
while IFS= read -r bats_file; do
  relative_path="${bats_file#"$REPO_ROOT/"}"
  suite_name="$(basename "$bats_file" .bats)"

  # Check for .ci-skip-test in the shared directory
  shared_dir="$(dirname "$bats_file")/.."
  if [[ -f "$shared_dir/.ci-skip-test" ]]; then
    reason="$(cat "$shared_dir/.ci-skip-test" 2>/dev/null || echo "no reason given")"
    echo "⏭️  [shared/$suite_name] skipped — $reason"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  SUITES+=("bats|$bats_file|shared/$suite_name")
done < <(find skills -path "*/shared/tests/*.bats" -type f | sort)

echo "▶️  ${#SUITES[@]} suite(s), $JOBS parallel"
echo ""

LOGDIR="$(mktemp -d)"
trap 'rm -rf "$LOGDIR"' EXIT
export LOGDIR

run_one() {
  local kind="$1" path="$2" label="$3"
  local log="$LOGDIR/$label.log"
  if [[ "$kind" == "bats" ]]; then
    bats "$path" >"$log" 2>&1
  else
    bash "$path" >"$log" 2>&1
  fi
}
export -f run_one

# 실패 목록은 xargs 종료 후 로그로 집계한다 — 병렬 출력이 뒤섞이는 걸 막는다.
set +e
printf '%s\0' "${SUITES[@]}" | xargs -0 -n1 -P "$JOBS" bash -c '
  IFS="|" read -r kind path label <<< "$1"
  run_one "$kind" "$path" "$label" || touch "$LOGDIR/$label.fail"
' _
xargs_rc=$?
set -e

# --- Report ---
FAILED=0
for suite_entry in "${SUITES[@]}"; do
  IFS="|" read -r _ path label <<< "$suite_entry"
  relative_path="${path#"$REPO_ROOT/"}"
  if [[ -f "$LOGDIR/$label.fail" ]]; then
    FAILED=$((FAILED + 1))
    echo "❌ [$label] $relative_path"
    cat "$LOGDIR/$label.log"
    echo ""
  else
    echo "✅ [$label] $relative_path"
  fi
done

# --- Summary ---
echo ""
echo "=== Done ==="
if [[ ${#SUITES[@]} -eq 0 && $SKIPPED -eq 0 ]]; then
  echo "⚠️  No tests found."
  exit 0
fi

if [[ $FAILED -gt 0 || $xargs_rc -ne 0 ]]; then
  echo "❌ $FAILED suite(s) failed, $(( ${#SUITES[@]} - FAILED )) passed, $SKIPPED skipped."
  exit 1
fi

echo "✅ ${#SUITES[@]} test suite(s) passed, $SKIPPED skipped."
