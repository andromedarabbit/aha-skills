#!/bin/bash
# Test runner for this skill.
# Discovered and executed automatically by tools/run-all-tests.sh and CI.
#
# 테스트가 0개 실행된 상태를 통과로 두지 않는다. 이 저장소는 "테스트는 있는데 러너가
# 못 찾아서 CI 가 한 번도 안 돌렸다"는 사고를 이미 겪었다.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SKILL_NAME="$(basename "$SKILL_DIR")"

# 표준 경로는 scripts/tests/ (= SCRIPT_DIR) 다. 예전 스킬들이 쓰던
# scripts/__tests__/ 도 호환을 위해 함께 훑는다.
LEGACY_TESTS_DIR="$SKILL_DIR/scripts/__tests__"

echo "=== $SKILL_NAME tests ==="

suites_run=0

# --- BATS tests ---
if compgen -G "$SCRIPT_DIR/*.bats" >/dev/null 2>&1; then
  bats "$SCRIPT_DIR"/*.bats
  suites_run=$((suites_run + 1))
fi

# --- Python tests ---
# scaffold 가 만드는 경로는 scripts/tests/ 다. 레거시 scripts/__tests__ 만 보면
# 생성된 test_*.py 가 조용히 건너뛰어진다.
#
# pytest 에 넘길 디렉토리와 직접 실행할 파일은 따로 모은다.
# pytest 의 기본 python_files 패턴은 test_*.py 와 *_test.py 뿐이다. *.test.py 는
# 수집하지 않으므로, *.test.py 만 있는 디렉토리를 pytest 에 넘기면 "수집 0건" 으로
# exit 5 가 나고 set -e 에 걸려 러너 전체가 거짓 실패한다. 같은 이유로 uv 도
# pytest 대상이 있을 때만 필요하다.
pytest_dirs=()
manual_py_tests=()
for candidate in "$SCRIPT_DIR" "$LEGACY_TESTS_DIR"; do
  [ -d "$candidate" ] || continue
  if compgen -G "$candidate/test_*.py" >/dev/null 2>&1 || \
     compgen -G "$candidate/*_test.py" >/dev/null 2>&1; then
    pytest_dirs+=("$candidate")
  fi
  for test_file in "$candidate"/*.test.py; do
    [ -f "$test_file" ] || continue
    manual_py_tests+=("$test_file")
  done
done

if (( ${#pytest_dirs[@]} > 0 )); then
  # uv 부재는 skip 이 아니라 실패다. 건너뛰면 Python 테스트가 안 돌았는데 초록불이 된다.
  if ! command -v uv >/dev/null 2>&1; then
    echo "❌ 오류: pytest 대상이 있는데 uv 가 없습니다 — Python 테스트를 실행할 수 없습니다" >&2
    echo "      설치: curl -LsSf https://astral.sh/uv/install.sh | sh" >&2
    exit 1
  fi
  uv run --with pytest pytest -v "${pytest_dirs[@]}"
  suites_run=$((suites_run + 1))
fi

if (( ${#manual_py_tests[@]} > 0 )); then
  for test_file in "${manual_py_tests[@]}"; do
    echo "  Running $(basename "$test_file")..."
    python3 "$test_file"
    suites_run=$((suites_run + 1))
  done
fi

# --- Shell integration tests ---
for test_file in "$SCRIPT_DIR"/*.test.sh "$LEGACY_TESTS_DIR"/*.test.sh; do
  [ -f "$test_file" ] || continue
  echo "  Running $(basename "$test_file")..."
  bash "$test_file"
  suites_run=$((suites_run + 1))
done

if [ "$suites_run" -eq 0 ]; then
  echo "❌ 오류: 실행된 테스트 스위트가 0개입니다" >&2
  echo "      탐색 경로: $SCRIPT_DIR, $LEGACY_TESTS_DIR" >&2
  echo "      파일명 패턴: *.bats / test_*.py / *_test.py / *.test.py / *.test.sh" >&2
  exit 1
fi

echo "✅ 모든 테스트 통과 (스위트 ${suites_run}개)"
