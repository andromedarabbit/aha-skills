#!/bin/bash
# Regression tests for tools/validate-hook-paths.sh.
#
# Covers both halves of the validator:
#   - hook `command` path judgement (${CLAUDE_PLUGIN_ROOT} form vs. the old .claude/skills form)
#   - marketplace.json plugin/skill path validation
#
# The hook-path cases matter because a wrong hook path is NOT a syntax error -- the hook simply
# never runs, silently. CI is the only place that can catch it.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_PATH="$ROOT_DIR/tools/validate-hook-paths.sh"

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

create_base_repo() {
  local repo="$1"
  mkdir -p "$repo/skills/cat-a/skill-ok/scripts" "$repo/skills/cat-b/skill-b"
  cat > "$repo/skills/cat-a/skill-ok/SKILL.md" <<'EOF'
---
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
---
EOF
  cat > "$repo/skills/cat-a/skill-ok/scripts/check.sh" <<'EOF'
#!/bin/bash
exit 0
EOF
  chmod +x "$repo/skills/cat-a/skill-ok/scripts/check.sh"
  cat > "$repo/skills/cat-b/skill-b/SKILL.md" <<'EOF'
---
name: skill-b
description: test
version: 1.0.0
context: fork
agent: general-purpose
language: "korean"
---
EOF
}

# 훅 경로 케이스용 헬퍼: skill-ok 의 훅 command 를 원하는 값으로 갈아끼운다.
# $1 = repo, $2 = command 값 (SKILL.md 에 그대로 들어갈 YAML 스칼라 본문)
set_hook_command() {
  local repo="$1"
  local command_value="$2"
  {
    echo "---"
    echo "name: skill-ok"
    echo "description: test"
    echo "version: 1.0.0"
    echo "context: fork"
    echo "agent: general-purpose"
    echo 'language: "korean"'
    echo "hooks:"
    echo "  PreToolUse:"
    echo '    - matcher: "Bash"'
    echo "      hooks:"
    echo "        - type: command"
    echo "          command: \"$command_value\""
    echo '          description: "test"'
    echo "---"
  } > "$repo/skills/cat-a/skill-ok/SKILL.md"
}

# 유효한 marketplace.json — 훅 경로만 보고 싶은 케이스에서 쓴다
write_valid_marketplace() {
  cat > "$1/.claude-plugin/marketplace.json" <<'EOF'
{
  "plugins": [
    {
      "name": "plugin-a",
      "source": "./skills/cat-a",
      "skills": ["./skill-ok"]
    },
    {
      "name": "plugin-b",
      "source": "./skills/cat-b",
      "skills": ["./skill-b"]
    }
  ]
}
EOF
}

run_case() {
  local case_name="$1"
  local repo="$tmp_root/$case_name"
  create_base_repo "$repo"
  mkdir -p "$repo/.claude-plugin" "$repo/tools"
  cp "$SCRIPT_PATH" "$repo/tools/validate-hook-paths.sh"

  case "$case_name" in
    duplicate)
      cat > "$repo/.claude-plugin/marketplace.json" <<'EOF'
{
  "plugins": [
    {
      "name": "plugin-a",
      "source": "./skills/cat-a",
      "skills": ["./skill-ok"]
    },
    {
      "name": "plugin-b",
      "source": "./skills/cat-a",
      "skills": ["./skill-ok"]
    }
  ]
}
EOF
      ;;
    skill_outside)
      cat > "$repo/.claude-plugin/marketplace.json" <<'EOF'
{
  "plugins": [
    {
      "name": "plugin-a",
      "source": "./skills/cat-a",
      "skills": ["../cat-b/skill-b"]
    }
  ]
}
EOF
      ;;
    source_missing)
      cat > "$repo/.claude-plugin/marketplace.json" <<'EOF'
{
  "plugins": [
    {
      "name": "plugin-a",
      "source": "./skills/not-exists",
      "skills": ["./skill-ok"]
    }
  ]
}
EOF
      ;;
    source_symlink_outside)
      local outside="$tmp_root/outside-$case_name"
      mkdir -p "$outside/evil-skill"
      cat > "$outside/evil-skill/SKILL.md" <<'EOF'
---
name: evil
description: evil
version: 1.0.0
context: fork
agent: general-purpose
language: "korean"
---
EOF
      ln -s "$outside" "$repo/skills/symlink-out"
      cat > "$repo/.claude-plugin/marketplace.json" <<'EOF'
{
  "plugins": [
    {
      "name": "plugin-a",
      "source": "./skills/symlink-out",
      "skills": ["./evil-skill"]
    }
  ]
}
EOF
      ;;
    skill_symlink_outside)
      local outside="$tmp_root/outside-$case_name"
      mkdir -p "$outside/evil-skill"
      cat > "$outside/evil-skill/SKILL.md" <<'EOF'
---
name: evil
description: evil
version: 1.0.0
context: fork
agent: general-purpose
language: "korean"
---
EOF
      ln -s "$outside/evil-skill" "$repo/skills/cat-a/skill-link-out"
      cat > "$repo/.claude-plugin/marketplace.json" <<'EOF'
{
  "plugins": [
    {
      "name": "plugin-a",
      "source": "./skills/cat-a",
      "skills": ["./skill-link-out"]
    }
  ]
}
EOF
      ;;
    skill_missing)
      cat > "$repo/.claude-plugin/marketplace.json" <<'EOF'
{
  "plugins": [
    {
      "name": "plugin-a",
      "source": "./skills/cat-a",
      "skills": ["./not-found"]
    }
  ]
}
EOF
      ;;
    invalid_source)
      cat > "$repo/.claude-plugin/marketplace.json" <<'EOF'
{
  "plugins": [
    {
      "name": "plugin-a",
      "source": "",
      "skills": ["./skill-ok"]
    }
  ]
}
EOF
      ;;
    invalid_skills)
      cat > "$repo/.claude-plugin/marketplace.json" <<'EOF'
{
  "plugins": [
    {
      "name": "plugin-a",
      "source": "./skills/cat-a",
      "skills": "./skill-ok"
    }
  ]
}
EOF
      ;;
    invalid_skill_entry)
      cat > "$repo/.claude-plugin/marketplace.json" <<'EOF'
{
  "plugins": [
    {
      "name": "plugin-a",
      "source": "./skills/cat-a",
      "skills": [""]
    }
  ]
}
EOF
      ;;
    hook_path_escape)
      mkdir -p "$repo/escape"
      cat > "$repo/escape/check.sh" <<'EOF'
#!/bin/bash
exit 0
EOF
      chmod +x "$repo/escape/check.sh"
      cat > "$repo/skills/cat-a/skill-ok/SKILL.md" <<'EOF'
---
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
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/skill-ok/../../../escape/check.sh\""
          description: "escape"
---
EOF
      cat > "$repo/.claude-plugin/marketplace.json" <<'EOF'
{
  "plugins": [
    {
      "name": "plugin-a",
      "source": "./skills/cat-a",
      "skills": ["./skill-ok"]
    }
  ]
}
EOF
      ;;
    absolute_hook_path)
      mkdir -p "$repo/abs"
      cat > "$repo/abs/check.sh" <<'EOF'
#!/bin/bash
exit 0
EOF
      chmod +x "$repo/abs/check.sh"
      cat > "$repo/skills/cat-a/skill-ok/SKILL.md" <<EOF
---
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
          command: "bash $repo/abs/check.sh"
          description: "absolute"
---
EOF
      cat > "$repo/.claude-plugin/marketplace.json" <<'EOF'
{
  "plugins": [
    {
      "name": "plugin-a",
      "source": "./skills/cat-a",
      "skills": ["./skill-ok"]
    }
  ]
}
EOF
      ;;
    relative_hook_path)
      cat > "$repo/skills/cat-a/skill-ok/SKILL.md" <<'EOF'
---
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
          command: "bash scripts/check.sh"
          description: "relative"
---
EOF
      cat > "$repo/.claude-plugin/marketplace.json" <<'EOF'
{
  "plugins": [
    {
      "name": "plugin-a",
      "source": "./skills/cat-a",
      "skills": ["./skill-ok"]
    }
  ]
}
EOF
      ;;
    invalid_plugins_root)
      cat > "$repo/.claude-plugin/marketplace.json" <<'EOF'
{
  "plugins": {}
}
EOF
      ;;
    invalid_plugin_entry)
      cat > "$repo/.claude-plugin/marketplace.json" <<'EOF'
{
  "plugins": ["nope"]
}
EOF
      ;;
    hook_new_form_ok)
      # 기준 저장소가 이미 새 표준형이다 — 그대로 통과해야 한다
      write_valid_marketplace "$repo"
      ;;
    hook_old_form)
      set_hook_command "$repo" 'bash .claude/skills/cat-a/skill-ok/scripts/check.sh'
      write_valid_marketplace "$repo"
      ;;
    hook_missing_file)
      set_hook_command "$repo" 'bash \"${CLAUDE_PLUGIN_ROOT}/skill-ok/scripts/nope.sh\"'
      write_valid_marketplace "$repo"
      ;;
    hook_skill_dir_var)
      set_hook_command "$repo" 'bash \"${CLAUDE_SKILL_DIR}/scripts/check.sh\"'
      write_valid_marketplace "$repo"
      ;;
    hook_category_in_path)
      # $CLAUDE_PLUGIN_ROOT 는 카테고리 루트다 — 경로에 카테고리를 또 넣으면 안 된다
      set_hook_command "$repo" 'bash \"${CLAUDE_PLUGIN_ROOT}/cat-a/skill-ok/scripts/check.sh\"'
      write_valid_marketplace "$repo"
      ;;
    hook_cross_plugin)
      mkdir -p "$repo/skills/cat-b/skill-b/scripts"
      printf '#!/bin/bash\nexit 0\n' > "$repo/skills/cat-b/skill-b/scripts/check.sh"
      set_hook_command "$repo" 'bash \"${CLAUDE_PLUGIN_ROOT}/skill-b/scripts/check.sh\"'
      write_valid_marketplace "$repo"
      ;;
    hook_ambiguous_skill)
      # 같은 이름의 디렉토리가 두 카테고리에 있고, 훅을 선언한 스킬은 어느 쪽도 아니다
      mkdir -p "$repo/skills/cat-a/dup/scripts" "$repo/skills/cat-b/dup/scripts" \
               "$repo/skills/cat-c/caller"
      printf '#!/bin/bash\nexit 0\n' > "$repo/skills/cat-a/dup/scripts/x.sh"
      printf '#!/bin/bash\nexit 0\n' > "$repo/skills/cat-b/dup/scripts/x.sh"
      {
        echo "---"
        echo "name: caller"
        echo "description: test"
        echo "version: 1.0.0"
        echo "context: fork"
        echo "agent: general-purpose"
        echo 'language: "korean"'
        echo "hooks:"
        echo "  PreToolUse:"
        echo '    - matcher: "Bash"'
        echo "      hooks:"
        echo "        - type: command"
        echo '          command: "bash \"${CLAUDE_PLUGIN_ROOT}/dup/scripts/x.sh\""'
        echo '          description: "test"'
        echo "---"
      } > "$repo/skills/cat-c/caller/SKILL.md"
      write_valid_marketplace "$repo"
      ;;
    hook_own_category_wins)
      # 이름이 겹쳐도 자기 카테고리 안에 있으면 확정 가능하다 (shared/ 실사례)
      mkdir -p "$repo/skills/cat-a/shared/scripts" "$repo/skills/cat-b/shared"
      printf '#!/bin/bash\nexit 0\n' > "$repo/skills/cat-a/shared/scripts/lib.sh"
      set_hook_command "$repo" 'bash \"${CLAUDE_PLUGIN_ROOT}/shared/scripts/lib.sh\"'
      write_valid_marketplace "$repo"
      ;;
    hook_uv_run_with_args)
      # 인터프리터는 bash 만이 아니고, 스크립트 뒤에 인자가 붙을 수 있다
      printf '#!/usr/bin/env python3\n' > "$repo/skills/cat-a/skill-ok/scripts/report.py"
      set_hook_command "$repo" 'uv run \"${CLAUDE_PLUGIN_ROOT}/skill-ok/scripts/report.py\" doctor --quiet-ok'
      write_valid_marketplace "$repo"
      ;;
    hook_unquoted_warning)
      set_hook_command "$repo" 'bash ${CLAUDE_PLUGIN_ROOT}/skill-ok/scripts/check.sh'
      write_valid_marketplace "$repo"
      ;;
    hook_inline_command)
      set_hook_command "$repo" 'bash -c \"echo hello\"'
      write_valid_marketplace "$repo"
      ;;
    *)
      echo "알 수 없는 케이스: $case_name"
      exit 1
      ;;
  esac

  set +e
  local output
  output="$(bash "$repo/tools/validate-hook-paths.sh" 2>&1)"
  local status=$?
  set -e

  case "$case_name" in
    duplicate)
      assert_exit_code 1 "$status" "duplicate should fail"
      assert_contains "중복 스킬 참조" "$output" "duplicate error message"
      ;;
    skill_outside)
      assert_exit_code 1 "$status" "skill_outside should fail"
      assert_contains "source 범위를 벗어난 skill 경로" "$output" "skill outside error message"
      ;;
    source_missing)
      assert_exit_code 1 "$status" "source_missing should fail"
      assert_contains "source 경로 없음" "$output" "source missing error message"
      ;;
    source_symlink_outside)
      assert_exit_code 1 "$status" "source symlink outside should fail"
      assert_contains "프로젝트 범위를 벗어난 source 경로" "$output" "source outside error message"
      ;;
    skill_symlink_outside)
      assert_exit_code 1 "$status" "skill symlink outside should fail"
      assert_contains "source 범위를 벗어난 skill 경로" "$output" "skill symlink outside error message"
      ;;
    skill_missing)
      assert_exit_code 1 "$status" "skill_missing should fail"
      assert_contains "스킬 경로 없음" "$output" "skill missing error message"
      ;;
    invalid_source)
      assert_exit_code 1 "$status" "invalid_source should fail"
      assert_contains "잘못된 source 설정" "$output" "invalid source error message"
      ;;
    invalid_skills)
      assert_exit_code 1 "$status" "invalid_skills should fail"
      assert_contains "skills는 문자열 배열이어야 함" "$output" "invalid skills error message"
      ;;
    invalid_skill_entry)
      assert_exit_code 1 "$status" "invalid_skill_entry should fail"
      assert_contains "잘못된 skill 설정" "$output" "invalid skill entry error message"
      ;;
    hook_path_escape)
      assert_exit_code 1 "$status" "hook_path_escape should fail"
      assert_contains "skills 범위를 벗어난 훅 경로" "$output" "hook path escape error message"
      ;;
    absolute_hook_path)
      assert_exit_code 1 "$status" "absolute_hook_path should fail"
      assert_contains "절대 경로 훅은 허용되지 않음" "$output" "absolute hook path error message"
      ;;
    relative_hook_path)
      assert_exit_code 1 "$status" "relative_hook_path should fail"
      assert_contains "로 시작하지 않는 훅 경로 - scripts/check.sh" "$output" "relative hook path error message"
      ;;
    invalid_plugins_root)
      assert_exit_code 1 "$status" "invalid_plugins_root should fail"
      assert_contains "plugins는 배열이어야 합니다" "$output" "invalid plugins root error message"
      ;;
    invalid_plugin_entry)
      assert_exit_code 1 "$status" "invalid_plugin_entry should fail"
      assert_contains "plugin 엔트리는 객체여야 합니다" "$output" "invalid plugin entry error message"
      ;;
    hook_new_form_ok)
      assert_exit_code 0 "$status" "the CLAUDE_PLUGIN_ROOT form should pass"
      assert_contains "모든 훅 경로가 유효합니다" "$output" "new form success message"
      ;;
    hook_old_form)
      assert_exit_code 1 "$status" "the old .claude/skills form must be rejected"
      assert_contains "옛 훅 경로 형태" "$output" "old form error message"
      # 마이그레이션 안내가 카테고리를 뺀 경로를 제시해야 한다
      assert_contains "CLAUDE_PLUGIN_ROOT}/skill-ok/scripts/check.sh" "$output" "migration hint"
      ;;
    hook_missing_file)
      assert_exit_code 1 "$status" "new form pointing at a missing file should fail"
      assert_contains "파일 없음" "$output" "missing file error message"
      ;;
    hook_skill_dir_var)
      assert_exit_code 1 "$status" "CLAUDE_SKILL_DIR is not substituted in hooks"
      assert_contains "CLAUDE_SKILL_DIR} 는 훅에서 치환되지 않음" "$output" "skill dir error message"
      ;;
    hook_category_in_path)
      assert_exit_code 1 "$status" "repeating the category in the path should fail"
      assert_contains "존재하지 않는 스킬을 가리킴" "$output" "category-in-path error message"
      assert_contains "카테고리가 아니라 스킬 이름" "$output" "category-in-path hint"
      ;;
    hook_cross_plugin)
      assert_exit_code 1 "$status" "referencing another category should fail"
      assert_contains "다른 플러그인(카테고리)의 경로를 가리킴" "$output" "cross plugin error message"
      ;;
    hook_ambiguous_skill)
      assert_exit_code 1 "$status" "an ambiguous skill name should fail explicitly"
      assert_contains "여러 카테고리에 중복되어 경로를 확정할 수 없음" "$output" "ambiguous error message"
      ;;
    hook_own_category_wins)
      assert_exit_code 0 "$status" "a duplicated name resolves via the declaring skill's own category"
      assert_contains "shared/scripts/lib.sh" "$output" "own category resolution"
      ;;
    hook_uv_run_with_args)
      assert_exit_code 0 "$status" "non-bash interpreters and trailing args should be handled"
      assert_contains "skill-ok/scripts/report.py" "$output" "uv run path extraction"
      ;;
    hook_unquoted_warning)
      assert_exit_code 0 "$status" "an unquoted path warns but does not fail"
      assert_contains "경로에 따옴표가 없음" "$output" "unquoted warning message"
      ;;
    hook_inline_command)
      assert_exit_code 0 "$status" "an inline -c command has no script path to check"
      assert_contains "인라인 명령" "$output" "inline command info message"
      ;;
  esac

  echo "✅ $case_name"
}

echo "▶ 테스트: validate-hook-paths 훅 경로 판정"
run_case hook_new_form_ok
run_case hook_old_form
run_case hook_missing_file
run_case hook_skill_dir_var
run_case hook_category_in_path
run_case hook_cross_plugin
run_case hook_ambiguous_skill
run_case hook_own_category_wins
run_case hook_uv_run_with_args
run_case hook_unquoted_warning
run_case hook_inline_command

echo "▶ 테스트: validate-hook-paths marketplace 회귀"
run_case duplicate
run_case skill_outside
run_case source_missing
run_case source_symlink_outside
run_case skill_symlink_outside
run_case skill_missing
run_case invalid_source
run_case invalid_skills
run_case invalid_skill_entry
run_case hook_path_escape
run_case absolute_hook_path
run_case relative_hook_path
run_case invalid_plugins_root
run_case invalid_plugin_entry

echo "✅ validate-hook-paths 회귀 테스트 통과"
