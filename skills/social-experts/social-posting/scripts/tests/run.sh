#!/bin/bash
# Test runner — tools/run-all-tests.sh 와 CI가 이 경로(scripts/tests/run.sh)를
# 발견해 실행한다. writing-experts의 공용 러너 형식을 이 스킬에 맞게 축약했다.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SCRIPT_TESTS="$SKILL_DIR/scripts/tests"

echo "=== social-posting tests ==="

suites_run=0

# --- 경로 독립 회귀: 스킬 문서 전체에 홈 절대경로 하드코딩 금지 ---
# 이 스킬은 vault·특정 저장소와 독립이어야 한다 (state-schema.md "경로는 런타임에 확정").
if grep -rn '/Users/' "$SKILL_DIR" --include='*.md' >/dev/null 2>&1; then
  echo "❌ 오류: 스킬 문서에 절대경로(/Users/...)가 하드코딩돼 있습니다 — 경로 독립 위반" >&2
  grep -rn '/Users/' "$SKILL_DIR" --include='*.md' >&2 || true
  exit 1
fi
echo "  경로 독립성 통과"
suites_run=$((suites_run + 1))

# --- 게이트 판정식 동일 문구 검사: 세 문서가 같은 문구를 써야 게이트 판정이 안 갈린다 ---
GATE_PHRASE='`approved_digests`에 해당 플랫폼이 있고 `drafts/<platform>.md`의 sha256과 일치'
for rel in SKILL.md assets/state-schema.md docs/REFERENCE.md; do
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

# --- 훅 계약 header 문구: record-approval.sh가 인식하려면 SKILL.md가 계약 문구를 써야 한다 ---
if ! grep -Fq '게시 승인' "$SKILL_DIR/SKILL.md"; then
  echo "❌ 오류: SKILL.md에 훅 계약 header '게시 승인' 문구가 없습니다 — Stage 8 게이트가 훅을 발동시키지 못한다" >&2
  exit 1
fi
echo "  훅 계약 header 문구 통과"
suites_run=$((suites_run + 1))

# --- Shell integration tests ---
for test_file in "$SCRIPT_TESTS"/*.test.sh; do
  [ -f "$test_file" ] || continue
  echo "  Running $(basename "$test_file")..."
  bash "$test_file"
  suites_run=$((suites_run + 1))
done

if [ "$suites_run" -eq 0 ]; then
  echo "❌ 오류: 실행된 테스트 스위트가 0개입니다" >&2
  exit 1
fi

echo "✅ 모든 테스트 통과 (스위트 ${suites_run}개)"
