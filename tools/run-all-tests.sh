#!/bin/bash
# Run all skill tests via discovery.
# CI calls this script; developers can also run it locally.
#
# Discovery rules:
#   1. Find skills/*/*/scripts/tests/run.sh (excluding *-workspace directories)
#   2. Find skills/*/shared/tests/*.bats (shared test suites)
#   3. Skip skills with a .ci-skip-test marker file
#
# Fail-fast: exits on first failure.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# --- Pre-flight: check bats availability ---
if ! command -v bats >/dev/null 2>&1; then
  echo "❌ bats-core is required but not found."
  echo "   Install: https://github.com/bats-core/bats-core#installation"
  exit 1
fi

TESTED=0
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

  echo "▶️  [$skill_name] $relative_path"
  bash "$run_sh"
  TESTED=$((TESTED + 1))
  echo ""

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

  echo "▶️  [shared/$suite_name] $relative_path"
  bats "$bats_file"
  TESTED=$((TESTED + 1))
  echo ""

done < <(find skills -path "*/shared/tests/*.bats" -type f | sort)

# --- Summary ---
echo "=== Done ==="
if [[ $TESTED -eq 0 && $SKIPPED -eq 0 ]]; then
  echo "⚠️  No tests found."
  exit 0
fi

echo "✅ $TESTED test suite(s) passed, $SKIPPED skipped."
