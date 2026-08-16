#!/bin/bash
# Regression tests for tools/validate-marketplace.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_PATH="$ROOT_DIR/tools/validate-marketplace.sh"

tmp_root="$(mktemp -d)"
trap 'rm -rf "$tmp_root"' EXIT

LAST_OUT="" ; LAST_RC=0
run_with() {
  local name="$1" json="$2"
  printf '%s' "$json" > "$tmp_root/$name.json"
  set +e
  LAST_OUT="$(bash "$SCRIPT_PATH" "$tmp_root/$name.json" 2>&1)"
  LAST_RC=$?
  set -e
}

assert_rc() {
  local exp="$1" msg="$2"
  [ "$LAST_RC" -eq "$exp" ] || { echo "❌ $msg (expected rc=$exp, got $LAST_RC)"; echo "$LAST_OUT"; exit 1; }
}

echo "=== test-validate-marketplace ==="

run_with valid '{"name":"m","owner":{"name":"o"},"metadata":{"version":"1.0.0"},"plugins":[{"name":"p","source":"./x","skills":["./a"],"strict":false}]}'
assert_rc 0 "유효한 marketplace는 통과해야 함"
echo "✅ case valid"

run_with no-name '{"owner":{"name":"o"},"plugins":[]}'
assert_rc 1 "name 누락은 실패해야 함"
echo "✅ case no-name"

run_with no-owner '{"name":"m","plugins":[]}'
assert_rc 1 "owner 누락은 실패해야 함"
echo "✅ case no-owner"

run_with plugin-no-source '{"name":"m","owner":{"name":"o"},"plugins":[{"name":"p"}]}'
assert_rc 1 "plugin source 누락은 실패해야 함"
echo "✅ case plugin-no-source"

run_with dup '{"name":"m","owner":{"name":"o"},"plugins":[{"name":"p","source":"./a"},{"name":"p","source":"./b"}]}'
assert_rc 1 "중복 plugin name은 실패해야 함"
echo "✅ case dup-name"

run_with bad-type '{"name":"m","owner":{"name":"o"},"plugins":[{"name":"p","source":"./a","skills":"nope"}]}'
assert_rc 1 "skills가 배열이 아니면 실패해야 함"
echo "✅ case bad-skills-type"

# --- 등록 정합성 (skills/ 트리 ↔ marketplace.json) --------------------------
# 위 케이스들은 marketplace.json 을 임시 디렉토리에 홀로 두므로 형제 skills/ 가 없어
# 정합성 검사가 건너뛴다. 아래는 <root>/.claude-plugin/ + <root>/skills/ 배치를 만들어 검사시킨다.

# 사용법: run_in_tree <이름> <json> <디스크에 둘 스킬들: "cat/name" ...>
run_in_tree() {
  local name="$1" json="$2"; shift 2
  local root="$tmp_root/tree-$name"
  mkdir -p "$root/.claude-plugin"
  printf '%s' "$json" > "$root/.claude-plugin/marketplace.json"
  local spec
  for spec in "$@"; do
    mkdir -p "$root/skills/$spec"
    printf -- '---\nname: x\n---\n' > "$root/skills/$spec/SKILL.md"
  done
  set +e
  LAST_OUT="$(bash "$SCRIPT_PATH" "$root/.claude-plugin/marketplace.json" 2>&1)"
  LAST_RC=$?
  set -e
}

REGISTERED='{"name":"m","owner":{"name":"o"},"plugins":[{"name":"cat-experts","source":"./skills/cat-experts","skills":["./alpha"]}]}'

run_in_tree matched "$REGISTERED" cat-experts/alpha
assert_rc 0 "디스크와 등록이 일치하면 통과해야 함"
echo "✅ case registration-matched"

run_in_tree unregistered "$REGISTERED" cat-experts/alpha cat-experts/beta
assert_rc 1 "등록되지 않은 스킬이 있으면 실패해야 함"
case "$LAST_OUT" in
  *"cat-experts/beta"*) ;;
  *) echo "❌ 미등록 스킬 이름이 오류 메시지에 없음"; echo "$LAST_OUT"; exit 1 ;;
esac
echo "✅ case registration-unregistered"

# 유령 등록은 skills/ 가 있는 상태에서만 판정한다 — 디렉토리 자체가 없으면 비교 대상이
# 없는 것이지 불일치가 아니다. 그래서 alpha 는 디스크에 두고 ghost 만 등록에 남긴다.
GHOSTED='{"name":"m","owner":{"name":"o"},"plugins":[{"name":"cat-experts","source":"./skills/cat-experts","skills":["./alpha","./ghost"]}]}'
run_in_tree ghost "$GHOSTED" cat-experts/alpha
assert_rc 1 "SKILL.md 없는 유령 등록은 실패해야 함"
case "$LAST_OUT" in
  *"유령 등록"*) ;;
  *) echo "❌ 유령 등록 메시지가 없음"; echo "$LAST_OUT"; exit 1 ;;
esac
echo "✅ case registration-ghost"

# strict 엔트리의 agents 정합성 — plugin.json 선언 ↔ {source}/agents/*.md 양방향
# 사용법: run_strict_tree <이름> <plugin.json agents JSON 배열> <디스크에 둘 에이전트 파일들...>
run_strict_tree() {
  local name="$1" agents_json="$2"; shift 2
  local root="$tmp_root/stree-$name"
  mkdir -p "$root/.claude-plugin" "$root/skills/cat-experts/.claude-plugin" "$root/skills/cat-experts/agents"
  printf '{"name":"m","owner":{"name":"o"},"plugins":[{"name":"cat-experts","source":"./skills/cat-experts","strict":true}]}' \
    > "$root/.claude-plugin/marketplace.json"
  printf '{"name":"cat-experts","version":"1.0.0","skills":["./alpha"],"agents":%s}' "$agents_json" \
    > "$root/skills/cat-experts/.claude-plugin/plugin.json"
  mkdir -p "$root/skills/cat-experts/alpha"
  printf -- '---\nname: x\n---\n' > "$root/skills/cat-experts/alpha/SKILL.md"
  local f
  for f in "$@"; do
    printf -- '---\nname: y\n---\n' > "$root/skills/cat-experts/agents/$f"
  done
  set +e
  LAST_OUT="$(bash "$SCRIPT_PATH" "$root/.claude-plugin/marketplace.json" 2>&1)"
  LAST_RC=$?
  set -e
}

run_strict_tree agents-ok '["./agents/a1.md"]' a1.md
assert_rc 0 "strict agents 선언과 디스크가 일치하면 통과해야 함"
echo "✅ case strict-agents-matched"

run_strict_tree agents-undeclared '["./agents/a1.md"]' a1.md a2.md
assert_rc 1 "plugin.json 에 선언되지 않은 에이전트 파일이 있으면 실패해야 함"
case "$LAST_OUT" in
  *"선언되지 않았습니다"*) ;;
  *) echo "❌ 미선언 에이전트 메시지가 없음"; echo "$LAST_OUT"; exit 1 ;;
esac
echo "✅ case strict-agents-undeclared"

run_strict_tree agents-ghost '["./agents/a1.md","./agents/gone.md"]' a1.md
assert_rc 1 "plugin.json agents 의 유령 선언은 실패해야 함"
case "$LAST_OUT" in
  *"유령 선언"*) ;;
  *) echo "❌ 유령 agents 선언 메시지가 없음"; echo "$LAST_OUT"; exit 1 ;;
esac
echo "✅ case strict-agents-ghost"

echo ""
echo "✅ 모든 테스트 통과"
