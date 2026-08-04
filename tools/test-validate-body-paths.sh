#!/bin/bash
# Regression tests for tools/validate-body-paths.sh.
#
# Every case builds a throwaway skills/ tree under mktemp and runs the validator against it.
# Nothing here reads the real repository: while the .claude/skills -> ${CLAUDE_SKILL_DIR}
# migration is in flight the real tree changes under us, so asserting on it would make these
# tests flap.
#
# The body-path defect these tests guard is the loud sibling of the hook-path one: a wrong
# body path is not silently skipped -- the agent runs it and dies on the first call with
# "No such file or directory". So the .claude/skills rule is deliberately exception-free,
# and `old_form_in_prose` pins that down.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_PATH="$ROOT_DIR/tools/validate-body-paths.sh"

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

FRONTMATTER='---
name: skill-ok
description: test
version: 1.0.0
context: fork
agent: general-purpose
language: "korean"
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/skill-ok/scripts/check.sh\""
          description: "test"
---'

# $1 = repo dir, $2 = body text for skills/cat-a/skill-ok/SKILL.md
create_repo() {
  local repo="$1"
  local body="$2"
  mkdir -p "$repo/tools" \
           "$repo/skills/cat-a/skill-ok/scripts" \
           "$repo/skills/cat-a/skill-ok/docs" \
           "$repo/skills/cat-b/skill-b"
  cp "$SCRIPT_PATH" "$repo/tools/validate-body-paths.sh"
  printf '#!/bin/bash\nexit 0\n' > "$repo/skills/cat-a/skill-ok/scripts/check.sh"
  printf '#!/usr/bin/env python3\n' > "$repo/skills/cat-a/skill-ok/scripts/report.py"
  printf 'worker\n' > "$repo/skills/cat-a/skill-ok/WORKER.md"
  {
    printf '%s\n' "$FRONTMATTER"
    printf '%s\n' "$body"
  } > "$repo/skills/cat-a/skill-ok/SKILL.md"
  # 두 번째 스킬은 본문이 비어 있어야 한다 — 케이스별 판정을 오염시키지 않게
  {
    echo "---"
    echo "name: skill-b"
    echo "description: test"
    echo "version: 1.0.0"
    echo "context: fork"
    echo "agent: general-purpose"
    echo 'language: "korean"'
    echo "---"
    echo ""
    echo "이 스킬은 스크립트가 없습니다."
  } > "$repo/skills/cat-b/skill-b/SKILL.md"
}

run_validator() {
  local repo="$1"
  set +e
  OUTPUT="$(bash "$repo/tools/validate-body-paths.sh" 2>&1)"
  STATUS=$?
  set -e
}

# ── 케이스 정의 ────────────────────────────────────────────────────────

case_body() {
  case "$1" in
    good_form)
      cat <<'EOF'
## 스크립트 경로

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/check.sh"
uv run "${CLAUDE_SKILL_DIR}/scripts/report.py"
```
EOF
      ;;
    old_form_execution)
      cat <<'EOF'
```bash
bash .claude/skills/cat-a/skill-ok/scripts/check.sh
```
EOF
      ;;
    old_form_no_interpreter)
      # 인터프리터가 없는 실행 지시 — 인터프리터 유무로 갈랐다면 놓쳤을 형태
      cat <<'EOF'
`general-purpose` 에이전트를 띄우면서 `.claude/skills/cat-a/skill-ok/WORKER.md`를 읽으라고 지시한다.
EOF
      ;;
    old_form_in_prose)
      # 규약을 설명하는 산문에서 인용해도 예외가 없다는 걸 못 박는 케이스
      cat <<'EOF'
`.claude/skills/...`로 시작하는 상대경로는 쓰지 마세요 — CWD 기준으로 풀립니다.
EOF
      ;;
    old_form_var_assignment)
      cat <<'EOF'
```bash
SKILL_DIR=".claude/skills/cat-a/skill-ok"
```
EOF
      ;;
    self_prefix_skill)
      cat <<'EOF'
```bash
bash "${CLAUDE_SKILL_DIR}/skill-ok/scripts/check.sh"
```
EOF
      ;;
    self_prefix_category)
      cat <<'EOF'
```bash
bash "${CLAUDE_SKILL_DIR}/cat-a/skill-ok/scripts/check.sh"
```
EOF
      ;;
    other_name_prefix)
      cat <<'EOF'
```bash
bash "${CLAUDE_SKILL_DIR}/skill-b/scripts/check.sh"
```
EOF
      ;;
    missing_file)
      cat <<'EOF'
```bash
bash "${CLAUDE_SKILL_DIR}/scripts/nope.sh"
```
EOF
      ;;
    placeholder_path)
      cat <<'EOF'
호출 형태는 `bash "${CLAUDE_SKILL_DIR}/scripts/<x>.sh"` 입니다. 짧게 쓴 곳도
모두 `${CLAUDE_SKILL_DIR}/scripts/...` 를 뜻합니다.
EOF
      ;;
    plugin_root_path_in_body)
      cat <<'EOF'
```bash
bash "${CLAUDE_PLUGIN_ROOT}/skill-ok/scripts/check.sh"
```
EOF
      ;;
    plugin_root_bare_mention)
      cat <<'EOF'
프론트매터 `hooks:`는 `${CLAUDE_PLUGIN_ROOT}` 규약을 씁니다. 본문 변수와 다릅니다.
EOF
      ;;
    unquoted_in_fence)
      cat <<'EOF'
```bash
bash ${CLAUDE_SKILL_DIR}/scripts/check.sh
```
EOF
      ;;
    unquoted_prose_mention)
      # 셸 문맥이 아닌 인라인 언급은 따옴표 경고 대상이 아니다
      cat <<'EOF'
스크립트는 `${CLAUDE_SKILL_DIR}/scripts/` 디렉토리에 있습니다.
EOF
      ;;
    legacy_skill_dir)
      cat <<'EOF'
```bash
SKILL_DIR="<이 스킬의 base directory>"
bash "$SKILL_DIR/scripts/check.sh"
```
EOF
      ;;
    korean_particle_suffix)
      # `\w` 로 경로를 잡으면 조사가 딸려 들어와 존재 확인이 거짓 실패한다
      cat <<'EOF'
워커에게 `${CLAUDE_SKILL_DIR}/WORKER.md`를 읽으라고 지시한다.
EOF
      ;;
    frontmatter_not_scanned)
      # 프론트매터의 ${CLAUDE_PLUGIN_ROOT} 훅 경로는 이 검사기 담당이 아니다
      cat <<'EOF'
본문에는 경로가 없습니다.
EOF
      ;;
    doc_*)
      # 딸린 문서 케이스는 SKILL.md 본문이 판정에 끼어들지 않게 비워 둔다
      cat <<'EOF'
본문에는 경로가 없습니다.
EOF
      ;;
    *)
      echo "알 수 없는 케이스: $1" >&2
      exit 1
      ;;
  esac
}

# 딸린 문서 픽스처. `create_repo` 는 항상 같은 트리를 깔아 주므로, 케이스별로 필요한
# 문서만 여기서 덮어쓴다.
write_doc_fixture() {
  local case_name="$1"
  local skill="$2/skills/cat-a/skill-ok"

  case "$case_name" in
    doc_skill_dir_path_use)
      cat > "$skill/docs/TROUBLESHOOTING.md" <<'EOF'
# 문제 해결

스크립트를 직접 돌려 봅니다:

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/check.sh"
```
EOF
      ;;
    doc_skill_dir_bare_mention)
      cat > "$skill/docs/TROUBLESHOOTING.md" <<'EOF'
# 문제 해결

SKILL.md 본문에서는 `${CLAUDE_SKILL_DIR}` 가 절대경로로 치환됩니다. 이 문서는 Read 로
읽히므로 `$SKILL_DIR` 을 씁니다.

```bash
bash "$SKILL_DIR/scripts/check.sh"
```
EOF
      ;;
    doc_changelog_excluded)
      cat > "$skill/docs/CHANGELOG.md" <<'EOF'
# 변경 이력

## 1.1.0
- 본문 스크립트 호출을 `"${CLAUDE_SKILL_DIR}/scripts/check.sh"` 로 교체했다.
EOF
      ;;
    doc_worker_path_use)
      cat > "$skill/WORKER.md" <<'EOF'
# 워커

읽을 문서: `${CLAUDE_SKILL_DIR}/references/rules.md`
EOF
      ;;
    doc_readme_path_use)
      cat > "$skill/README.md" <<'EOF'
# 스킬

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/check.sh"
```
EOF
      ;;
  esac
}

run_case() {
  local case_name="$1"
  local repo="$tmp_root/$case_name"
  create_repo "$repo" "$(case_body "$case_name")"
  write_doc_fixture "$case_name" "$repo"
  run_validator "$repo"

  case "$case_name" in
    good_form)
      assert_exit_code 0 "$STATUS" "the CLAUDE_SKILL_DIR form should pass"
      assert_contains "모든 본문 경로가 유효합니다" "$OUTPUT" "success message"
      assert_contains "scripts/check.sh" "$OUTPUT" "resolved path reported"
      ;;
    old_form_execution)
      assert_exit_code 1 "$STATUS" "an executed old-form path must be rejected"
      assert_contains "옛 본문 경로 형태" "$OUTPUT" "old form error"
      assert_contains "CLAUDE_SKILL_DIR}/scripts/check.sh" "$OUTPUT" "migration hint drops category+skill"
      ;;
    old_form_no_interpreter)
      assert_exit_code 1 "$STATUS" "an old-form path without an interpreter must still be rejected"
      assert_contains "옛 본문 경로 형태" "$OUTPUT" "old form error"
      assert_contains "CLAUDE_SKILL_DIR}/WORKER.md" "$OUTPUT" "migration hint for a doc path"
      ;;
    old_form_in_prose)
      assert_exit_code 1 "$STATUS" "even a prose citation is rejected -- the rule has no exceptions"
      assert_contains "옛 본문 경로 형태" "$OUTPUT" "old form error"
      assert_contains "예외는 없습니다" "$OUTPUT" "no-exception guidance"
      ;;
    old_form_var_assignment)
      assert_exit_code 1 "$STATUS" "an old-form path in a variable assignment must be rejected"
      assert_contains "옛 본문 경로 형태" "$OUTPUT" "old form error"
      ;;
    self_prefix_skill)
      assert_exit_code 1 "$STATUS" "appending the skill name must be rejected"
      assert_contains "덧붙였음" "$OUTPUT" "self prefix error"
      assert_contains "스킬 디렉토리 자체" "$OUTPUT" "self prefix hint"
      ;;
    self_prefix_category)
      assert_exit_code 1 "$STATUS" "appending the category name must be rejected"
      assert_contains "덧붙였음" "$OUTPUT" "self prefix error"
      ;;
    other_name_prefix)
      assert_exit_code 1 "$STATUS" "appending another skill's name must be rejected"
      assert_contains "카테고리·스킬 이름 'skill-b' 가 붙었음" "$OUTPUT" "name prefix error"
      ;;
    missing_file)
      assert_exit_code 1 "$STATUS" "a path that does not exist must be rejected"
      assert_contains "파일 없음" "$OUTPUT" "missing file error"
      ;;
    placeholder_path)
      assert_exit_code 0 "$STATUS" "placeholder shapes are not existence-checked"
      assert_contains "자리표시자 경로라 존재 확인을 건너뜀" "$OUTPUT" "placeholder info"
      ;;
    plugin_root_path_in_body)
      assert_exit_code 1 "$STATUS" "CLAUDE_PLUGIN_ROOT is not substituted in the body"
      assert_contains "본문에서 \${CLAUDE_PLUGIN_ROOT} 를 경로로 사용" "$OUTPUT" "plugin root error"
      assert_contains "CLAUDE_SKILL_DIR}/scripts/check.sh" "$OUTPUT" "plugin root migration hint"
      ;;
    plugin_root_bare_mention)
      assert_exit_code 0 "$STATUS" "naming the hook variable in prose is correct documentation"
      assert_contains "규약으로 언급(정상)" "$OUTPUT" "bare mention info"
      ;;
    unquoted_in_fence)
      assert_exit_code 0 "$STATUS" "an unquoted path warns but does not fail"
      assert_contains "경로에 따옴표가 없음" "$OUTPUT" "unquoted warning"
      assert_contains "경고 수: 1" "$OUTPUT" "exactly one warning"
      ;;
    unquoted_prose_mention)
      assert_exit_code 0 "$STATUS" "a prose mention is not a shell context"
      assert_not_contains "따옴표가 없음" "$OUTPUT" "no quoting warning outside shell context"
      ;;
    legacy_skill_dir)
      assert_exit_code 0 "$STATUS" "the legacy \$SKILL_DIR convention warns but does not fail"
      assert_contains "구식 \$SKILL_DIR 관례" "$OUTPUT" "legacy warning"
      ;;
    korean_particle_suffix)
      assert_exit_code 0 "$STATUS" "a Korean particle after the path must not break existence check"
      assert_contains "WORKER.md" "$OUTPUT" "path resolved without the particle"
      assert_not_contains "파일 없음" "$OUTPUT" "no false missing-file error"
      ;;
    frontmatter_not_scanned)
      assert_exit_code 0 "$STATUS" "frontmatter hook paths belong to validate-hook-paths.sh"
      assert_contains "본문에 스크립트 경로 참조 없음" "$OUTPUT" "frontmatter skipped"
      ;;
    doc_skill_dir_path_use)
      assert_exit_code 1 "$STATUS" "docs get no substitution -- a path use must be rejected"
      assert_contains "딸린 문서에서 \${CLAUDE_SKILL_DIR} 를 경로로 사용" "$OUTPUT" "doc path-use error"
      assert_contains 'SKILL_DIR/scripts/check.sh' "$OUTPUT" "migration hint switches to \$SKILL_DIR"
      ;;
    doc_skill_dir_bare_mention)
      assert_exit_code 0 "$STATUS" "naming the variable to explain the convention is correct documentation"
      assert_contains "규약으로 언급(정상)" "$OUTPUT" "doc bare mention info"
      assert_not_contains "딸린 문서에서" "$OUTPUT" "no error for a bare mention"
      ;;
    doc_changelog_excluded)
      assert_exit_code 0 "$STATUS" "CHANGELOG records past path forms on purpose"
      assert_not_contains "딸린 문서에서" "$OUTPUT" "CHANGELOG is not scanned"
      ;;
    doc_worker_path_use)
      assert_exit_code 1 "$STATUS" "WORKER.md is read with the Read tool, not substituted"
      assert_contains "WORKER.md:3" "$OUTPUT" "error points at WORKER.md"
      ;;
    doc_readme_path_use)
      assert_exit_code 1 "$STATUS" "README.md is read with the Read tool, not substituted"
      assert_contains "README.md:4" "$OUTPUT" "error points at README.md"
      ;;
  esac

  echo "✅ $case_name"
}

echo "▶ 테스트: validate-body-paths 본문 경로 판정"
run_case good_form
run_case old_form_execution
run_case old_form_no_interpreter
run_case old_form_in_prose
run_case old_form_var_assignment
run_case self_prefix_skill
run_case self_prefix_category
run_case other_name_prefix
run_case missing_file
run_case placeholder_path
run_case plugin_root_path_in_body
run_case plugin_root_bare_mention
run_case unquoted_in_fence
run_case unquoted_prose_mention
run_case legacy_skill_dir
run_case korean_particle_suffix
run_case frontmatter_not_scanned
run_case doc_skill_dir_path_use
run_case doc_skill_dir_bare_mention
run_case doc_changelog_excluded
run_case doc_worker_path_use
run_case doc_readme_path_use

echo "✅ validate-body-paths 회귀 테스트 통과"
