#!/bin/bash
# Regression tests for tools/validate-mktemp-templates.sh.
#
# macOS BSD mktemp는 XXXXXX 뒤 접미사를 랜덤화하지 않는다 — 접미사 템플릿은
# 병렬 실행이 같은 고정 경로를 공유하게 만든다(2026-09-01 게시 뒤섞임 사고).
# 검증기는 이를 커밋 시점에 기계적으로 잡아야 한다.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_PATH="$ROOT_DIR/tools/validate-mktemp-templates.sh"

assert_contains() {
  local needle="$1"
  local haystack="$2"
  local message="$3"
  # 파이프를 쓰지 않는다 — set -o pipefail 아래 grep -q 조기 종료가 간헐 실패를
  # 만든다(MR !46). 순수 bash 서브스트링 매칭은 그 경로가 없다.
  if [[ "$haystack" != *"$needle"* ]]; then
    echo "❌ $message"
    echo "   expected to contain: $needle"
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

run_validator() { # $1=repo → 전역 output/status
  set +e
  output="$(bash "$SCRIPT_PATH" "$1" 2>&1)"
  status=$?
  set -e
}

# ── 케이스 1: 정상 템플릿만 있으면 통과 ─────────────────────────────
repo="$tmp_root/repo-ok"
mkdir -p "$repo/skills/cat-a/skill-a/scripts"
cat > "$repo/skills/cat-a/skill-a/SKILL.md" <<'EOF'
---
name: skill-a
description: test
version: 1.0.0
---
본문
EOF
cat > "$repo/skills/cat-a/skill-a/scripts/run.sh" <<'EOF'
#!/bin/bash
a="$(mktemp "${TMPDIR:-/tmp}/body.XXXXXX")"
b="$(mktemp)"
c="$(mktemp -d)"
# 주석의 나쁜 템플릿은 실행되지 않는다: mktemp "/tmp/x.XXXXXX.md"
EOF
run_validator "$repo"
assert_exit_code 0 "$status" "정상 템플릿(XXXXXX 종료·무인자·mktemp -d·주석)은 exit 0이어야 한다"
assert_contains "오류 0건" "$output" "정상 케이스 요약"
echo "✅ 정상 템플릿 통과"

# ── 케이스 2: 접미사 템플릿 → 오류 ──────────────────────────────────
repo="$tmp_root/repo-bad"
mkdir -p "$repo/skills/cat-a/skill-a/scripts"
cp "$tmp_root/repo-ok/skills/cat-a/skill-a/SKILL.md" "$repo/skills/cat-a/skill-a/SKILL.md"
cat > "$repo/skills/cat-a/skill-a/scripts/run.sh" <<'EOF'
#!/bin/bash
frozen="$(mktemp "${TMPDIR:-/tmp}/social-posting-body.XXXXXX.md")"
EOF
run_validator "$repo"
assert_exit_code 1 "$status" "XXXXXX 뒤 접미사 템플릿은 exit 1이어야 한다"
assert_contains "접미사" "$output" "접미사 안내 메시지"
assert_contains "run.sh" "$output" "위반 파일이 지목되어야 한다"
echo "✅ 접미사 템플릿 거부"

# ── 케이스 3: 비인용 템플릿도 잡는다 ────────────────────────────────
repo="$tmp_root/repo-bare"
mkdir -p "$repo/skills/cat-a/skill-a/scripts"
cp "$tmp_root/repo-ok/skills/cat-a/skill-a/SKILL.md" "$repo/skills/cat-a/skill-a/SKILL.md"
cat > "$repo/skills/cat-a/skill-a/scripts/run.sh" <<'EOF'
#!/bin/bash
f="$(mktemp /tmp/out.XXXXXX.txt)"
EOF
run_validator "$repo"
assert_exit_code 1 "$status" "비인용 접미사 템플릿도 exit 1이어야 한다"
assert_contains "접미사" "$output" "비인용 케이스 안내"
echo "✅ 비인용 접미사 템플릿 거부"

# ── 케이스 4: skills/ 없는 루트 거부 ─────────────────────────────────
mkdir -p "$tmp_root/empty"  # 존재하지만 skills/ 없는 루트
run_validator "$tmp_root/empty"
assert_exit_code 1 "$status" "skills/ 없는 경로는 exit 1이어야 한다"
assert_contains "skills/ 가 없습니다" "$output" "루트 거부 안내"
echo "✅ 비저장소 루트 거부"

echo ""
echo "────────────────────────────────────"
echo "✅ test-validate-mktemp-templates.sh 전체 통과 (케이스 4종)"
echo "────────────────────────────────────"
