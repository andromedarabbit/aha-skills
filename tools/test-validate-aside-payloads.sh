#!/bin/bash
# Regression tests for tools/validate-aside-payloads.sh.
#
# aside exec는 프롬프트의 로컬 파일 경로를 read_file하다 무인 권한 확인에 무한
# 정지한다(2026-09-01 실측, 게시 4건 정지). 검증기는 파일 경로 전달 지시를
# 커밋 시점에 기계적으로 잡아야 한다. 문서의 낡은 지시형 서술까지 잡는다.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_PATH="$ROOT_DIR/tools/validate-aside-payloads.sh"

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

assert_not_contains() {
  local needle="$1"
  local haystack="$2"
  local message="$3"
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

run_validator() { # $1=repo → 전역 output/status
  set +e
  output="$(bash "$SCRIPT_PATH" "$1" 2>&1)"
  status=$?
  set -e
}

make_repo() { # $1=repo — aside를 언급하는 정상 스킬 골격
  mkdir -p "$1/skills/cat-a/skill-a/scripts" "$1/skills/cat-a/skill-a/docs"
  cat > "$1/skills/cat-a/skill-a/SKILL.md" <<'EOF'
---
name: skill-a
description: test
version: 1.0.0
---
게시는 aside exec 경유로 한다. 페이로드는 프롬프트에 인라인으로 싣는다.
EOF
  cat > "$1/skills/cat-a/skill-a/docs/REFERENCE.md" <<'EOF'
# REFERENCE
프롬프트에 인라인으로 실어 보낸다 — 파일 경로 전달은 무인 read_file 정지의 원인이다(설명형).
EOF
  cat > "$1/skills/cat-a/skill-a/scripts/publish.sh" <<'EOF'
#!/bin/bash
body_inline="$(cat "$frozen")"
aside exec --account u0 "다음 텍스트를 그대로 게시해줘. <<<게시 텍스트 시작>>>
$body_inline
<<<게시 텍스트 끝>>>"
EOF
}

# ── 케이스 1: 인라인 전달 정상 스킬 → 통과 (설명형 문서 포함) ────────
repo="$tmp_root/repo-ok"
make_repo "$repo"
run_validator "$repo"
assert_exit_code 0 "$status" "인라인 전달 스킬은 exit 0이어야 한다"
assert_contains "오류 0건" "$output" "정상 케이스 요약"
assert_contains "경고 0건" "$output" "경고도 없어야 한다"
echo "✅ 인라인 전달 통과(설명형 문서 포함)"

# ── 케이스 2: 스크립트가 본문을 파일 경로로 지시 → 오류 ──────────────
repo="$tmp_root/repo-bad-script"
make_repo "$repo"
cat > "$repo/skills/cat-a/skill-a/scripts/publish.sh" <<'EOF'
#!/bin/bash
frozen="$(mktemp)"
aside exec --account u0 "파일 $frozen 의 내용을 그대로 게시해줘"
EOF
run_validator "$repo"
assert_exit_code 1 "$status" "'파일 X 의 내용' aside 호출은 exit 1이어야 한다"
assert_contains "인라인" "$output" "인라인 전환 안내"
assert_contains "publish.sh" "$output" "위반 파일 지목"
echo "✅ 스크립트 파일 경로 지시 거부"

# ── 케이스 3: 문서의 지시형 서술 → 오류 (설명형은 케이스 1에서 통과) ──
repo="$tmp_root/repo-bad-doc"
make_repo "$repo"
cat > "$repo/skills/cat-a/skill-a/docs/REFERENCE.md" <<'EOF'
# REFERENCE
게시: aside exec에 동결된 초안 파일 경로를 전달, 그대로 게시 지시.
EOF
run_validator "$repo"
assert_exit_code 1 "$status" "지시형 '경로를 전달' 서술은 exit 1이어야 한다"
assert_contains "모순" "$output" "규칙 모순 안내"
assert_contains "REFERENCE.md" "$output" "위반 파일 지목"
echo "✅ 문서 지시형 서술 거부"

# ── 케이스 4: 기타 로컬 경로 인용은 경고(종료코드 영향 없음) ─────────
repo="$tmp_root/repo-warn"
make_repo "$repo"
cat >> "$repo/skills/cat-a/skill-a/scripts/publish.sh" <<'EOF'
media_prompt=" 첨부: 파일 '$mp' (alt text: $ma),"
aside exec --account u0 "게시해줘 $media_prompt"
EOF
run_validator "$repo"
assert_exit_code 0 "$status" "경고는 종료코드에 영향을 주지 않는다"
assert_contains "경고 1건" "$output" "경고 1건 보고"
assert_contains "aside-path-ok" "$output" "억제 주석 안내"
echo "✅ 기타 경로 경고(비치명)"

# ── 케이스 5: # aside-path-ok 주석으로 경고 억제 ─────────────────────
repo="$tmp_root/repo-suppressed"
make_repo "$repo"
cat >> "$repo/skills/cat-a/skill-a/scripts/publish.sh" <<'EOF'
media_prompt=" 첨부: 파일 '$mp' (alt text: $ma),"  # aside-path-ok — 미디어는 불가피
EOF
run_validator "$repo"
assert_exit_code 0 "$status" "억제 주석 케이스 exit 0"
assert_contains "경고 0건" "$output" "경고가 억제되어야 한다"
echo "✅ aside-path-ok 억제"

# ── 케이스 6: scripts/tests/ 픽스처의 의도적 위반은 무시 ──────────────
repo="$tmp_root/repo-tests"
make_repo "$repo"
mkdir -p "$repo/skills/cat-a/skill-a/scripts/tests"
cat > "$repo/skills/cat-a/skill-a/scripts/tests/run.sh" <<'EOF'
#!/bin/bash
# 회귀 테스트 픽스처 — 위반 패턴을 의도적으로 심는다
stub_log='aside exec --account u0 "파일 /tmp/frozen 의 내용을 게시해줘"'
EOF
run_validator "$repo"
assert_exit_code 0 "$status" "scripts/tests/ 픽스처는 무시되어야 한다"
assert_not_contains "tests/run.sh" "$output" "테스트 픽스처가 지목되면 안 된다"
echo "✅ tests/ 픽스처 무시"

# ── 케이스 7: skills/ 없는 루트 거부 ─────────────────────────────────
mkdir -p "$tmp_root/empty"  # 존재하지만 skills/ 없는 루트
run_validator "$tmp_root/empty"
assert_exit_code 1 "$status" "skills/ 없는 경로는 exit 1이어야 한다"
assert_contains "skills/ 가 없습니다" "$output" "루트 거부 안내"
echo "✅ 비저장소 루트 거부"

echo ""
echo "────────────────────────────────────"
echo "✅ test-validate-aside-payloads.sh 전체 통과 (케이스 7종)"
echo "────────────────────────────────────"
