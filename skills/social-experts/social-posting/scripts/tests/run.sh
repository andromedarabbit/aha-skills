#!/bin/bash
# Test runner — tools/run-all-tests.sh 와 CI가 이 경로(scripts/tests/run.sh)를
# 발견해 실행한다. writing-experts의 공용 러너 형식을 이 스킬에 맞게 축약했다.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SCRIPT_TESTS="$SKILL_DIR/scripts/tests"

if compgen -G "$SCRIPT_TESTS/*.test.mjs" >/dev/null && ! command -v node >/dev/null 2>&1; then
  printf '❌ 오류: node가 없어 ego 실행 계층 테스트를 실행할 수 없습니다\n' >&2
  exit 1
fi

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
# 백틱은 명령 치환이 아니라 Markdown 판정식의 일부다.
# shellcheck disable=SC2016
GATE_PHRASE='`approved_digests`에 해당 플랫폼이 있고 `drafts/<platform>.md`의 sha256과 일치'
for rel in SKILL.md assets/state-schema.md docs/REFERENCE.md \
  ../x-expert/SKILL.md ../facebook-expert/SKILL.md \
  ../bluesky-expert/SKILL.md ../linkedin-expert/SKILL.md ../instagram-expert/SKILL.md; do
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
PRIVATE_PHRASE='Instagram private 판정식: 명시적 게시 요청 또는 사전에 허용한 게시 작업이고, 현재 초안·사진·계정이 검증되며 Share 직전 실제 친한친구 대상이 확인됨'
for rel in SKILL.md assets/state-schema.md docs/REFERENCE.md ../instagram-expert/SKILL.md; do
  grep -Fq "$PRIVATE_PHRASE" "$SKILL_DIR/$rel" || {
    printf '❌ 오류: %s에 Instagram private 판정식이 없습니다\n' "$rel" >&2
    exit 1
  }
done
suites_run=$((suites_run + 1))

# --- 훅 계약 header 문구: record-approval.sh가 인식하려면 SKILL.md가 계약 문구를 써야 한다 ---
if ! grep -Fq '게시 승인' "$SKILL_DIR/SKILL.md"; then
  echo "❌ 오류: SKILL.md에 훅 계약 header '게시 승인' 문구가 없습니다 — Stage 8 게이트가 훅을 발동시키지 못한다" >&2
  exit 1
fi
echo "  훅 계약 header 문구 통과"
suites_run=$((suites_run + 1))

# 문서 검사는 절차의 드리프트만 잡는다. 실제 사용자 질문 호출은 행동 평가 대상이다.
for rel in SKILL.md README.md assets/orca-scan-prompt.md ../threads-expert/docs/playbook.md docs/REFERENCE.md; do
  grep -Fq 'THREADS_UNVERIFIED' "$SKILL_DIR/$rel" || {
    printf '❌ 오류: %s에 Threads 게시 차단 계약이 없습니다\n' "$rel" >&2
    exit 1
  }
done
for rel in SKILL.md README.md assets/orca-scan-prompt.md ../instagram-expert/SKILL.md ../instagram-expert/docs/playbook.md docs/REFERENCE.md; do
  for phrase in private public 친한친구; do
    grep -Fq "$phrase" "$SKILL_DIR/$rel" || {
      printf '❌ 오류: %s에 Instagram 공개 범위 계약(%s)이 없습니다\n' "$rel" "$phrase" >&2
      exit 1
    }
  done
done
for phrase in '최근 24시간' '시간 미상' '관찰 범위' '중복 실행 방지'; do
  for rel in SKILL.md assets/orca-scan-prompt.md; do
    grep -Fq "$phrase" "$SKILL_DIR/$rel" || {
      printf '❌ 오류: %s에 읽기 전용 전달 계약(%s)이 없습니다\n' "$rel" "$phrase" >&2
      exit 1
    }
  done
done
suites_run=$((suites_run + 1))

# --- Shell integration tests ---
for test_file in "$SCRIPT_TESTS"/*.test.sh; do
  [ -f "$test_file" ] || continue
  echo "  Running $(basename "$test_file")..."
  bash "$test_file"
  suites_run=$((suites_run + 1))
done

# --- Node test suites (ego-post.mjs 실행 계층 계약) ---
if compgen -G "$SCRIPT_TESTS/*.test.mjs" >/dev/null; then
  echo "  Running node --test ..."
  node --test "$SCRIPT_TESTS"/*.test.mjs
  suites_run=$((suites_run + 1))
fi

if [ "$suites_run" -eq 0 ]; then
  echo "❌ 오류: 실행된 테스트 스위트가 0개입니다" >&2
  exit 1
fi

echo "✅ 모든 테스트 통과 (스위트 ${suites_run}개)"
