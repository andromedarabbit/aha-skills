#!/bin/bash
# writing-experts 플러그인 공용 스킬 테스트 러너.
#
# 각 스킬의 scripts/tests/run.sh 래퍼가 환경변수 파라미터를 넘겨 호출한다.
# 탐색 계약은 래퍼가 유지한다 — tools/run-all-tests.sh 와 CI 는 여전히
# scripts/tests/run.sh 경로만 발견한다. 이 파일은 4개 스킬에서 같은
# 130줄 러너를 복제하던 시대를 끝내기 위해 추출됐다 (리뷰 #2).
#
# 파라미터 (환경변수, 래퍼가 export):
#   SKILL_DIR   - 대상 스킬 디렉토리 절대경로 (필수)
#   AGENTS      - 개행 구분 "에이전트명|허용 tools" 목록. 플러그인 루트 agents/
#                 frontmatter 무결성 검사: 필드 존재, delimiter 쌍(#7),
#                 name 값 대조(#15), tools 값 대조
#   PATH_CHECK  - 1이면 경로 독립 회귀: 스킬 문서 + 플러그인 agents/ 에서
#                 홈 절대경로(/Users/) 하드코딩 검사(#10 — agents/ 포함)
#   GATE_PHRASE - 게이트 판정식 핵심 문구. GATE_FILES 각 파일에 정확히
#                 들어있는지 grep -F 검사(#14 — 문서 간 수기 동기화 방어)
#   GATE_FILES  - 공백 구분 파일 상대경로 (SKILL_DIR 기준, ../ 허용)
#
# 테스트가 0개 실행된 상태를 통과로 두지 않는다. 이 저장소는 "테스트는
# 있는데 러너가 못 찾아서 CI 가 한 번도 안 돌렸다"는 사고를 이미 겪었다.
set -euo pipefail

if [ -z "${SKILL_DIR:-}" ]; then
  echo "❌ 오류: SKILL_DIR 이 설정되지 않았습니다 — 래퍼가 export 해야 합니다" >&2
  exit 1
fi

PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENTS_DIR="$PLUGIN_DIR/agents"
SKILL_NAME="$(basename "$SKILL_DIR")"
SCRIPT_TESTS="$SKILL_DIR/scripts/tests"
LEGACY_TESTS_DIR="$SKILL_DIR/scripts/__tests__"

echo "=== $SKILL_NAME tests ==="

suites_run=0

# --- Plugin agents/ frontmatter 무결성 검사 ---
# 저장소 검증기는 스킬 디렉터리 기준이라 플러그인 루트의 agents/ 를 안 본다.
# 이 러너가 플러그인 단위로 에이전트 정의를 직접 검증한다
# (컨벤션: 검증 수단을 하나 더 확보).
if [ -n "${AGENTS:-}" ]; then
  while IFS='|' read -r agent allowed_tools; do
    [ -n "$agent" ] || continue
    file="$AGENTS_DIR/$agent.md"
    if [ ! -f "$file" ]; then
      echo "❌ 오류: 에이전트 정의 파일이 없습니다 — $file" >&2
      exit 1
    fi
    # frontmatter delimiter 쌍 검사(#7): 닫는 --- 이 없으면 awk 가 본문 끝까지
    # frontmatter 로 수집해 본문의 필드 패턴 줄이 검사를 통과해버린다.
    delims=$(grep -c '^---$' "$file" || true)
    if [ "$delims" -lt 2 ]; then
      echo "❌ 오류: $agent.md frontmatter delimiter(^---$)가 $delims건 — 닫는 --- 이 없습니다" >&2
      exit 1
    fi
    fm="$(awk '/^---$/{n++; next} n==1' "$file")"
    for field in name description tools; do
      if ! grep -qE "^${field}:" <<<"$fm"; then
        echo "❌ 오류: $agent.md frontmatter에 $field 필드가 없습니다" >&2
        exit 1
      fi
    done
    # name 값 대조(#15): 개명 누락(예: blog-auditor.md 안에 career-memoir 이름
    # 잔존)은 존재 검사로는 못 잡는다. 저장소 검증기도 안 보는 축이다.
    agent_name="$(grep -E '^name:' <<<"$fm" | head -1 | sed 's/^name:[[:space:]]*//')"
    if [ "$agent_name" != "$agent" ]; then
      echo "❌ 오류: $agent.md frontmatter name='$agent_name' — 파일명과 불일치" >&2
      exit 1
    fi
    tools="$(grep -E '^tools:' <<<"$fm" | head -1 | sed 's/^tools:[[:space:]]*//')"
    if [ "$tools" != "$allowed_tools" ]; then
      echo "❌ 오류: $agent.md tools='$tools' — 허용목록 '$allowed_tools'와 불일치" >&2
      exit 1
    fi
  done <<<"$AGENTS"
  echo "  agents/ frontmatter 무결성 통과"
  suites_run=$((suites_run + 1))
fi

# --- 경로 독립 회귀(#10: 의존 에이전트 정의 포함) ---
# 이 검사가 켜진 스킬은 vault·특정 저장소와 독립이어야 한다. 스킬 문서와 이
# 파이프라인이 의존하는 에이전트 정의(AGENTS 목록)에 홈 절대경로가 하드코딩돼
# 있으면 안 된다. agents/ 디렉토리 전체를 보지 않는다 — career-memoir 에이전트는
# 레거시 설계로 vault 경로를 명시하는 게 합법이기 때문이다.
if [ "${PATH_CHECK:-0}" = "1" ]; then
  path_targets=("$SKILL_DIR")
  if [ -n "${AGENTS:-}" ]; then
    while IFS='|' read -r agent _tools; do
      [ -n "$agent" ] && path_targets+=("$AGENTS_DIR/$agent.md")
    done <<<"$AGENTS"
  fi
  if grep -rn '/Users/' "${path_targets[@]}" --include='*.md' >/dev/null 2>&1; then
    echo "❌ 오류: 스킬 문서 또는 의존 에이전트 정의에 절대경로(/Users/...)가 하드코딩돼 있습니다 — 경로 독립 위반" >&2
    grep -rn '/Users/' "${path_targets[@]}" --include='*.md' >&2 || true
    exit 1
  fi
  echo "  경로 독립성 통과 (스킬 문서 + 의존 에이전트 정의)"
  suites_run=$((suites_run + 1))
fi

# --- 게이트 판정식 동일 문구 검사(#14) ---
# "문구가 달라지면 게이트 판정이 갈린다"는 문서 불변식의 기계 검증.
# GATE_PHRASE 는 판정식의 핵심 부분문자열(stage 값 + 섹션명 + 행 조건).
if [ -n "${GATE_PHRASE:-}" ] && [ -n "${GATE_FILES:-}" ]; then
  for rel in $GATE_FILES; do
    target="$SKILL_DIR/$rel"
    if [ ! -f "$target" ]; then
      echo "❌ 오류: 게이트 판정식 검사 대상 파일이 없습니다 — $target" >&2
      exit 1
    fi
    if ! grep -Fq "$GATE_PHRASE" "$target"; then
      echo "❌ 오류: 게이트 판정식 문구가 $target 에 없습니다 — 문서 간 드리프트" >&2
      exit 1
    fi
  done
  echo "  게이트 판정식 동일 문구 통과"
  suites_run=$((suites_run + 1))
fi

# --- BATS tests ---
if compgen -G "$SCRIPT_TESTS/*.bats" >/dev/null 2>&1; then
  bats "$SCRIPT_TESTS"/*.bats
  suites_run=$((suites_run + 1))
fi

# --- Python tests ---
# pytest 에 넘길 디렉토리와 직접 실행할 파일은 따로 모은다.
# pytest 의 기본 python_files 패턴은 test_*.py 와 *_test.py 뿐이다. *.test.py 는
# 수집하지 않으므로, *.test.py 만 있는 디렉토리를 pytest 에 넘기면 "수집 0건" 으로
# exit 5 가 나고 set -e 에 걸려 러너 전체가 거짓 실패한다. 같은 이유로 uv 도
# pytest 대상이 있을 때만 필요하다.
pytest_dirs=()
manual_py_tests=()
for candidate in "$SCRIPT_TESTS" "$LEGACY_TESTS_DIR"; do
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
for test_file in "$SCRIPT_TESTS"/*.test.sh "$LEGACY_TESTS_DIR"/*.test.sh; do
  [ -f "$test_file" ] || continue
  echo "  Running $(basename "$test_file")..."
  bash "$test_file"
  suites_run=$((suites_run + 1))
done

if [ "$suites_run" -eq 0 ]; then
  echo "❌ 오류: 실행된 테스트 스위트가 0개입니다" >&2
  echo "      탐색 경로: $SCRIPT_TESTS, $LEGACY_TESTS_DIR" >&2
  echo "      파일명 패턴: *.bats / test_*.py / *_test.py / *.test.py / *.test.sh" >&2
  exit 1
fi

echo "✅ 모든 테스트 통과 (스위트 ${suites_run}개)"
