#!/bin/bash
# Regression tests for tools/check-frontmatter.sh description length/trigger validation.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_PATH="$ROOT_DIR/tools/check-frontmatter.sh"

assert_contains() {
  local needle="$1"
  local haystack="$2"
  local message="$3"
  # 파이프를 쓰지 않는다. `set -o pipefail` 아래에서 grep -q 가 첫 매치에 바로 종료하면
  # 남은 입력을 쓰던 printf 가 죽고 그 상태가 파이프라인 실패로 올라온다 — needle 이
  # 분명히 있는데도 실패로 보고된다. 실제로 CI 에서 48KB SKILL.md 상대로 간헐 실패했고
  # (MR !46, 재실행하니 통과) 입력이 클수록 잘 터진다. 순수 bash 매칭은 그 경로가 없다.
  # needle 은 따옴표로 감싸 리터럴로 취급된다 — grep -F 와 같고, 대시로 시작해도 안전하다.
  if [[ "$haystack" != *"$needle"* ]]; then
    echo "❌ $message"
    echo "   expected to contain: $needle"
    echo "   output:"
    printf '%s\n' "$haystack"
    exit 1
  fi
}

assert_not_contains() {
  local needle="$1"
  local haystack="$2"
  local message="$3"
  # assert_contains 와 같은 이유로 파이프를 쓰지 않는다. 이쪽은 방향이 반대라 더 위험하다 —
  # grep 이 매치하고 조기 종료해 printf 가 죽으면 pipefail 이 파이프라인을 실패로 만들고,
  # 그러면 이 `if` 가 거짓이 되어 **있으면 안 되는 것이 있는데도 조용히 통과**한다.
  if [[ "$haystack" == *"$needle"* ]]; then
    echo "❌ $message"
    echo "   expected NOT to contain: $needle"
    echo "   output:"
    printf '%s\n' "$haystack"
    exit 1
  fi
}

assert_exit_code() {
  local expected="$1"
  local actual="$2"
  local message="$3"
  if [ "$expected" -ne "$actual" ]; then
    echo "❌ $message"
    echo "   expected: $expected"
    echo "   actual  : $actual"
    exit 1
  fi
}

tmp_root="$(mktemp -d)"
trap 'rm -rf "$tmp_root"' EXIT

# Write a SKILL.md with the given description at the given path.
# All other required fields are valid so only description logic varies.
make_skill() {
  local path="$1"
  local desc="$2"
  mkdir -p "$(dirname "$path")"
  cat > "$path" <<EOF
---
name: test-skill
description: $desc
version: 1.0.0
context: fork
agent: general-purpose
language: "korean"
---

# test
EOF
}

OUTPUT=""
STATUS=0
run_check() {
  set +e
  OUTPUT="$(bash "$SCRIPT_PATH" "$1" 2>&1)"
  STATUS=$?
  set -e
}

echo "▶ 테스트: check-frontmatter description 길이/트리거 회귀"

# 1) 트리거 포함 + 1024자 이하 → 통과
p="$tmp_root/ok/SKILL.md"
make_skill "$p" "GitLab CI 실패를 진단합니다. CI가 깨졌을 때 사용하세요."
run_check "$p"
assert_exit_code 0 "$STATUS" "트리거+짧은 길이는 통과해야 함"
assert_contains "when-to-use 트리거 포함" "$OUTPUT" "트리거 감지 메시지"
echo "✅ 트리거_포함_정상"

# 2) 1024자 초과 (트리거는 포함해 길이 오류만 격리) → 실패
long_ascii="$(printf 'a%.0s' $(seq 1 1100))"
p="$tmp_root/toolong/SKILL.md"
make_skill "$p" "use when needed $long_ascii"
run_check "$p"
assert_exit_code 1 "$STATUS" "1024자 초과는 실패해야 함"
assert_contains "1024자 초과" "$OUTPUT" "길이 초과 메시지"
echo "✅ 길이_초과"

# 3) 트리거 없는 짧은 description (실배포 경로) → 실패
p="$tmp_root/notrigger/SKILL.md"
make_skill "$p" "GitLab CI 파이프라인 진단 도구"
run_check "$p"
assert_exit_code 1 "$STATUS" "트리거 없으면 실패해야 함"
assert_contains "트리거가 없습니다" "$OUTPUT" "트리거 누락 메시지"
echo "✅ 트리거_없음"

# 4) 트리거 없지만 픽스처/스냅샷 경로 → 트리거 검사 건너뜀, 통과
p="$tmp_root/snapshots/some-skill/SKILL.md"
make_skill "$p" "GitLab CI 파이프라인 진단 도구"
run_check "$p"
assert_exit_code 0 "$STATUS" "픽스처 경로는 트리거 검사를 건너뛰어야 함"
assert_contains "트리거 검사 건너뜀" "$OUTPUT" "픽스처 건너뜀 메시지"
echo "✅ 픽스처_건너뜀"

# 5) 한국어 트리거 마커 → 통과
p="$tmp_root/kotrigger/SKILL.md"
make_skill "$p" "문서를 게시합니다. 위키에 올릴 때 사용합니다."
run_check "$p"
assert_exit_code 0 "$STATUS" "한국어 트리거는 통과해야 함"
echo "✅ 한국어_트리거"

# 6) 영어 트리거 마커 → 통과
p="$tmp_root/entrigger/SKILL.md"
make_skill "$p" "Publishes documents. Use when the user wants to publish."
run_check "$p"
assert_exit_code 0 "$STATUS" "영어 트리거는 통과해야 함"
echo "✅ 영어_트리거"

# 7) 멀티바이트 길이 회귀: 한국어 ~416자(>1024 바이트, <1024 자)는 통과해야 한다
#    (바이트로 세면 잘못 초과 처리됨 — 코드포인트 카운팅 보증)
kdesc=""
for _ in $(seq 1 26); do kdesc+="사용자가 요청할 때 이 스킬을 사용한다 "; done
p="$tmp_root/kounder/SKILL.md"
make_skill "$p" "$kdesc"
run_check "$p"
assert_exit_code 0 "$STATUS" "한국어 1024자 미만은 통과해야 함 (바이트 아님)"
assert_contains "≤1024" "$OUTPUT" "한도 이내 길이 메시지"
assert_not_contains "1024자 초과" "$OUTPUT" "한국어를 바이트로 세면 안 됨"
echo "✅ 한국어_한도_이내"

# 8) 맥락 없는 bare 키워드("요청")만 있으면 → 실패 (트리거 regex 강화 회귀 잠금)
p="$tmp_root/baretrigger/SKILL.md"
make_skill "$p" "사용자 요청 데이터를 분석하는 도구입니다."
run_check "$p"
assert_exit_code 1 "$STATUS" "맥락 없는 bare 키워드는 실패해야 함"
assert_contains "트리거가 없습니다" "$OUTPUT" "bare 키워드 트리거 누락 메시지"
echo "✅ bare_키워드_트리거_없음"

# 9) single-quote로 감싼 description → 따옴표가 추출 값에 포함되지 않아야 함
p="$tmp_root/squote/SKILL.md"
make_skill "$p" "'문서를 게시합니다. 위키에 올릴 때 사용합니다.'"
run_check "$p"
assert_exit_code 0 "$STATUS" "작은따옴표 description은 통과해야 함"
assert_contains "when-to-use 트리거 포함" "$OUTPUT" "작은따옴표 트리거 감지"
echo "✅ 작은따옴표_description"

echo "✅ check-frontmatter 회귀 테스트 통과"
