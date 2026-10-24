#!/bin/bash
# Regression tests for tools/run-all-tests.sh
#
# 병렬 실행에서도 발견·skip·실패 집계가 정확한지 가짜 저장소로 검증한다.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_PATH="$ROOT_DIR/tools/run-all-tests.sh"

# --- 환경 격리: mktemp 저장소 + stub bats ---
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
mkdir -p "$WORK_DIR/tools" "$WORK_DIR/stub-bin"

# bats 를 stub 으로 대체 — shared bats 스위트가 없으면 호출되지 않지만,
# pre-flight 의 command -v 검사를 통과시키기 위해 필요하다.
printf '#!/bin/bash\nexit 0\n' > "$WORK_DIR/stub-bin/bats"
chmod +x "$WORK_DIR/stub-bin/bats"
cp "$SCRIPT_PATH" "$WORK_DIR/tools/run-all-tests.sh"

make_skill() {  # make_skill <이름> <pass|fail>
  local name="$1" mode="$2"
  mkdir -p "$WORK_DIR/skills/test-experts/$name/scripts/tests"
  if [[ "$mode" == "pass" ]]; then
    printf '#!/bin/bash\nset -euo pipefail\necho "%s OK"\n' "$name" \
      > "$WORK_DIR/skills/test-experts/$name/scripts/tests/run.sh"
  else
    printf '#!/bin/bash\nset -euo pipefail\necho "%s 가 출발했다"\necho "%s 실패" >&2\nexit 3\n' "$name" "$name" \
      > "$WORK_DIR/skills/test-experts/$name/scripts/tests/run.sh"
  fi
  chmod +x "$WORK_DIR/skills/test-experts/$name/scripts/tests/run.sh"
}

fail() {
  echo "❌ $1"
  exit 1
}

echo "=== test-run-all-tests ==="

# --- 케이스 1: 전부 통과 ---
make_skill alpha pass
make_skill beta pass
out="$(PATH="$WORK_DIR/stub-bin:$PATH" bash "$WORK_DIR/tools/run-all-tests.sh")" || fail "케이스 1: 전부 통과해야 하는데 실패했다"
[[ "$out" == *"2 test suite(s) passed"* ]] || fail "케이스 1: 통과 요약이 없다 — $out"

# --- 케이스 2: 하나가 실패해도 나머지는 끝까지 돌고 종료 코드 1 ---
make_skill gamma fail
set +e
out="$(PATH="$WORK_DIR/stub-bin:$PATH" bash "$WORK_DIR/tools/run-all-tests.sh" 2>&1)"
rc=$?
set -e
[[ $rc -eq 1 ]] || fail "케이스 2: 실패 스위트가 있으면 종료 코드 1이어야 한다 — rc=$rc"
[[ "$out" == *"1 suite(s) failed"* ]] || fail "케이스 2: 실패 요약이 없다 — $out"
[[ "$out" == *"gamma"*"❌"* ]] || fail "케이스 2: 실패 스위트의 로그가 출력돼야 한다 — $out"
[[ "$out" == *"alpha"*"✅"* ]] || fail "케이스 2: 실패해도 통과 스위트는 끝까지 돌아야 한다 — $out"

# --- 케이스 3: .ci-skip-test 마커 존중 ---
mkdir -p "$WORK_DIR/skills/test-experts/delta/scripts/tests"
printf '#!/bin/bash\nexit 1\n' > "$WORK_DIR/skills/test-experts/delta/scripts/tests/run.sh"
echo "사유 테스트" > "$WORK_DIR/skills/test-experts/delta/.ci-skip-test"
set +e
out="$(PATH="$WORK_DIR/stub-bin:$PATH" bash "$WORK_DIR/tools/run-all-tests.sh" 2>&1)"
rc=$?
set -e
[[ $rc -eq 1 ]] || fail "케이스 3: skip은 실패 집계를 바꾸지 않는다 — rc=$rc"
[[ "$out" == *"skipped — 사유 테스트"* ]] || fail "케이스 3: skip 사유가 출력돼야 한다 — $out"

# --- 케이스 4: TEST_JOBS=1 (직렬) 도 같은 계약 ---
set +e
out="$(PATH="$WORK_DIR/stub-bin:$PATH" TEST_JOBS=1 bash "$WORK_DIR/tools/run-all-tests.sh" 2>&1)"
rc=$?
set -e
[[ $rc -eq 1 ]] || fail "케이스 4: TEST_JOBS=1에서도 실패 집계가 동일해야 한다 — rc=$rc"

# --- 케이스 5: -workspace 디렉토리 제외 ---
mkdir -p "$WORK_DIR/skills/test-experts/epsilon-workspace/scripts/tests"
printf '#!/bin/bash\nexit 1\n' > "$WORK_DIR/skills/test-experts/epsilon-workspace/scripts/tests/run.sh"
set +e
out="$(PATH="$WORK_DIR/stub-bin:$PATH" bash "$WORK_DIR/tools/run-all-tests.sh" 2>&1)"
rc=$?
set -e
[[ $rc -eq 1 ]] || fail "케이스 5: workspace 제외 후에도 실패는 유지돼야 한다 — rc=$rc"
[[ "$out" != *"epsilon-workspace"* ]] || fail "케이스 5: -workspace 디렉토리는 스캔에서 제외돼야 한다"

# --- 케이스 6: 공유 bats — 실패가 실패로 집계되고 실제 실행된다 ---
# 라벨 shared/<이름>의 슬래시가 로그 경로를 망가뜨려 스위트가 미실행·통과로
# 집계됐던 결함의 회귀 케이스다. stub bats를 실패시켜 재현한다.
mkdir -p "$WORK_DIR/skills/test-experts/shared/tests"
printf '1..1\nok 1 placeholder\n' > "$WORK_DIR/skills/test-experts/shared/tests/broken.bats"
printf '#!/bin/bash\nexit 7\n' > "$WORK_DIR/stub-bin/bats"
set +e
out="$(PATH="$WORK_DIR/stub-bin:$PATH" bash "$WORK_DIR/tools/run-all-tests.sh" 2>&1)"
rc=$?
set -e
[[ $rc -eq 1 ]] || fail "케이스 6: 실패한 공유 bats는 종료 코드 1이어야 한다 — rc=$rc"
[[ "$out" == *"2 suite(s) failed"* ]] || fail "케이스 6: gamma+shared 실패 2건으로 집계돼야 한다 — $out"
[[ "$out" == *"❌ [shared/broken]"* ]] || fail "케이스 6: shared 라벨 실패가 로그와 함께 리포트돼야 한다 — $out"

printf '#!/bin/bash\nexit 0\n' > "$WORK_DIR/stub-bin/bats"
# gamma가 여전히 실패(raw exit 1)라 종료 코드는 1이 맞다 — 이 케이스는 shared/broken의 리포트만 본다
set +e
out="$(PATH="$WORK_DIR/stub-bin:$PATH" bash "$WORK_DIR/tools/run-all-tests.sh" 2>&1)"
set -e
[[ "$out" == *"✅ [shared/broken]"* ]] || fail "케이스 6b: 공유 bats 통과가 리포트돼야 한다 — $out"

# --- 케이스 7: 스위트 0개 — exit 0 + No tests found ---
# 빈 SUITES 배열 확장이 macOS bash 3.2 + set -u에서 크래시하던 결함의 회귀 케이스다.
FRESH="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR" "$FRESH"' EXIT
mkdir -p "$FRESH/tools" "$FRESH/stub-bin"
cp "$SCRIPT_PATH" "$FRESH/tools/run-all-tests.sh"
printf '#!/bin/bash\nexit 0\n' > "$FRESH/stub-bin/bats"
chmod +x "$FRESH/stub-bin/bats"
out="$(PATH="$FRESH/stub-bin:$PATH" bash "$FRESH/tools/run-all-tests.sh")" || fail "케이스 7: 0스위트는 exit 0이어야 한다"
[[ "$out" == *"No tests found"* ]] || fail "케이스 7: No tests found 메시지가 필요하다 — $out"

echo ""
echo "✅ test-run-all-tests 전부 통과"
