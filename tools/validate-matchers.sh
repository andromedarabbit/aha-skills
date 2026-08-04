#!/bin/bash
# Matcher/event 정적 검증 스크립트 (Layer 1 린트)
#
# 모든 SKILL.md 훅에 대해 두 가지 버그 클래스를 정적으로 잡는다:
#   (1) 존재하지 않는 hook 이벤트 사용 (예: PostToolWrite)
#   (2) tool 이벤트의 matcher가 어떤 도구 이름과도 매칭 불가 → 절대 발동 안 함
#
# 근거: PreToolUse/PostToolUse 등에서 matcher는 **도구 이름**(Bash, Edit, mcp__...)
#       하고만 비교된다(공식 문서 "how a hook resolves"). 명령/경로 내용을 담은
#       matcher(예: "Bash.*git.*commit")는 비교 대상 문자열이 "Bash"뿐이라 발동하지 않는다.
#       내용 필터는 `if` 필드나 훅 스크립트(stdin의 tool_input.command)에서 처리해야 한다.
#
# Claude 실행이 필요 없는 결정적 검사 — CI/pre-commit에 적합.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 검사할 저장소 루트. 인자를 주면 그곳의 skills/ 를 스캔한다.
# 인자를 무시하고 늘 자기 위치에서 역산하면 테스트가 스크립트를 가짜 저장소로 복사해야만
# 하는데(test-validate-matchers.sh 가 실제로 그랬다), 그러면 복사본이 원본과 갈라질 수 있다.
SCAN_ROOT="${1:-$PROJECT_ROOT}"

if [ ! -d "$SCAN_ROOT" ]; then
  echo "❌ 오류: 저장소 루트를 찾을 수 없습니다: $SCAN_ROOT"
  echo "사용법: $(basename "$0") [저장소_루트]"
  exit 1
fi

# 존재하지만 skills/ 가 없는 디렉토리를 넘기면 "0건 검사, 오류 0건"으로 초록불이 됐다.
# 경로 인자를 받게 만든 목적(임의의 가짜 저장소를 검사) 자체가 무력화되므로 거부한다.
if [ ! -d "$SCAN_ROOT/skills" ]; then
  echo "❌ 오류: 저장소 루트가 아닙니다 — skills/ 가 없습니다: $SCAN_ROOT"
  echo "사용법: $(basename "$0") [저장소_루트]"
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ 오류: 이 검증에는 python3가 필요합니다"
  exit 1
fi

echo "🔍 matcher/event 정적 검증 시작... ($SCAN_ROOT)"
echo ""

python3 - "$SCAN_ROOT" <<'PY'
import os
import re
import sys
import warnings

# 깨진 matcher 안에는 Python이 경고하는 패턴(POSIX [[:space:]] 등)이 섞여 있다.
# 어차피 발동 불가 판정이므로 정규식 경고는 무시한다.
warnings.filterwarnings("ignore")

project_root = sys.argv[1]

# Claude Code 공식 hook 이벤트 집합 (29개).
# 출처: SchemaStore 공식 스키마 claude-code-plugin-manifest.json 의 propertyNames enum
#       https://www.schemastore.org/claude-code-plugin-manifest.json (확인: 2026-06-15)
# 새 이벤트가 추가되면 위 스키마 기준으로 갱신.
VALID_EVENTS = {
    "PreToolUse", "PostToolUse", "PostToolUseFailure", "PostToolBatch",
    "Notification", "UserPromptSubmit", "UserPromptExpansion",
    "SessionStart", "SessionEnd", "Stop", "StopFailure",
    "SubagentStart", "SubagentStop", "PreCompact", "PostCompact",
    "PermissionRequest", "PermissionDenied", "Setup", "TeammateIdle",
    "TaskCreated", "TaskCompleted", "Elicitation", "ElicitationResult",
    "ConfigChange", "WorktreeCreate", "WorktreeRemove",
    "InstructionsLoaded", "CwdChanged", "FileChanged",
}

# matcher가 도구 이름과 비교되는 이벤트들.
TOOL_EVENTS = {
    "PreToolUse", "PostToolUse", "PostToolUseFailure",
    "PermissionRequest", "PermissionDenied",
}

# 알려진 내장 도구 이름. matcher는 도구 이름하고만 비교된다.
# 오탐(정상 matcher를 깨졌다고 판정)을 피하려고 넉넉하게 둔다 — 깨진 matcher들은
# 어떤 도구 이름에도 없는 리터럴(git/glab/brew/custom-cli/confluence/.txt/.log/Test 등)을 요구한다.
#
# AskUserQuestion·Agent·EnterPlanMode·NotebookRead·TaskCreate/Get/List/Update/Stop/Output
# 은 MR !35 작업 중 설치된 Claude Code 바이너리(v2.1.220)의 문자열을 직접 확인해 추가했다
# (validate-matchers.sh 가 gitlab-mr-creation 의 정상적인 `matcher: "AskUserQuestion"`
# PostToolUse 훅을 "어떤 도구 이름과도 매칭 불가"로 오판했던 것이 발단 — 이 리스트 자체가
# 오래돼 실재하는 도구 이름을 놓치고 있었다).
TOOL_NAMES = [
    "Bash", "Edit", "MultiEdit", "Write", "Read", "Glob", "Grep", "Task",
    "WebFetch", "WebSearch", "NotebookEdit", "NotebookRead", "TodoWrite",
    "ExitPlanMode", "EnterPlanMode", "BashOutput", "KillShell", "SlashCommand",
    "Skill", "Agent", "AskUserQuestion",
    "TaskCreate", "TaskGet", "TaskList", "TaskUpdate", "TaskStop", "TaskOutput",
    "ListMcpResources", "ListMcpResourcesTool", "ReadMcpResource", "ReadMcpResourceTool",
]


def extract_frontmatter(text):
    m = re.match(r"^---\n(.*?)\n---", text, re.S)
    return m.group(1) if m else None


def parse_hooks(fm):
    """frontmatter에서 hooks 블록의 event 목록과 (event, matcher) 쌍을 추출."""
    lines = fm.splitlines()
    start = None
    for i, ln in enumerate(lines):
        if re.match(r"^hooks:\s*$", ln):
            start = i + 1
            break
    if start is None:
        return [], []

    block = []
    for ln in lines[start:]:
        if ln.strip() == "":
            block.append(ln)
            continue
        # indent 0(주석 아님)이면 hooks 블록 종료
        if not ln[0].isspace():
            break
        block.append(ln)

    events, pairs, current = [], [], None
    for ln in block:
        mev = re.match(r"^  (\w+):\s*$", ln)
        if mev:
            current = mev.group(1)
            events.append(current)
            continue
        mm = re.match(r"^\s+-?\s*matcher:\s*(.+?)\s*$", ln)
        if mm and current is not None:
            pairs.append((current, unquote_yaml(mm.group(1).strip())))
    return events, pairs


def unquote_yaml(val):
    """YAML 스칼라의 따옴표를 벗기고 실제 정규식 문자열로 복원."""
    if len(val) >= 2 and val[0] == '"' and val[-1] == '"':
        # 큰따옴표 스칼라: 백슬래시 이스케이프 처리 (\\ → \, \" → ")
        return val[1:-1].replace('\\\\', '\\').replace('\\"', '"')
    if len(val) >= 2 and val[0] == "'" and val[-1] == "'":
        # 작은따옴표 스칼라: 이스케이프 없음, '' → ' 만 처리
        return val[1:-1].replace("''", "'")
    return val


def matcher_can_fire(matcher):
    """matcher가 적어도 한 개의 도구 이름과 매칭 가능한가. None=정규식 오류."""
    m = matcher.strip()
    if m in ("", "*", ".*"):
        return True
    # 정규식 유효성을 **먼저** 본다. mcp__ 단축 판정이 compile 앞에 있으면
    # `mcp__[` 처럼 깨진 정규식이 "정상"으로 통과해 버린다(런타임에는 매칭이
    # 안 되는데 검사기는 통과시키는, 이 검사기가 잡으라고 있는 바로 그 상황).
    try:
        rx = re.compile(m)
    except re.error:
        return None
    if "mcp__" in m:  # MCP 도구 이름 타겟팅 — TOOL_NAMES 에 없어도 정상
        return True
    # re.search(가장 관대한 해석)로 검사 → 오탐 최소화
    return any(rx.search(name) for name in TOOL_NAMES)


skills = []
for dirpath, _dirnames, filenames in os.walk(os.path.join(project_root, "skills")):
    # 평가 산출물과 스킬이 품은 템플릿(assets/)은 스킬이 아니다
    if "-workspace" in dirpath or f"{os.sep}assets{os.sep}" in dirpath + os.sep:
        continue
    if "SKILL.md" in filenames:
        skills.append(os.path.join(dirpath, "SKILL.md"))
skills.sort()

errors = 0
checked = 0
declaring = 0  # hooks: 를 선언한 스킬 수 — 아래 0건 가드의 판정 기준

for sf in skills:
    rel = os.path.relpath(sf, project_root)
    with open(sf, encoding="utf-8") as f:
        text = f.read()
    fm = extract_frontmatter(text)
    if not fm or "hooks:" not in fm:
        continue
    declaring += 1

    events, pairs = parse_hooks(fm)
    issues = []

    for ev in events:
        if ev not in VALID_EVENTS:
            issues.append(
                f"존재하지 않는 hook 이벤트 '{ev}' — 공식 이벤트가 아님 "
                f"(PostToolUse/FileChanged 등 실재 이벤트로 이전)"
            )

    for ev, matcher in pairs:
        if ev not in TOOL_EVENTS:
            continue  # 비-tool 이벤트는 matcher 의미가 달라 이벤트 검사로 충분
        checked += 1
        res = matcher_can_fire(matcher)
        if res is None:
            issues.append(f'[{ev}] matcher 정규식 오류: "{matcher}"')
        elif res is False:
            issues.append(
                f'[{ev}] matcher가 어떤 도구 이름과도 매칭 불가 → 절대 발동 안 함: '
                f'"{matcher}"  (matcher는 도구 이름만 비교 — 내용/경로 필터는 if 필드나 스크립트로)'
            )

    if issues:
        print(f"❌ {rel}")
        for it in issues:
            print(f"   - {it}")
            errors += 1
    else:
        print(f"✅ {rel}")

print("")
print("────────────────────────────────────")
print(f"📊 검증 결과: tool matcher {checked}건 검사, 오류 {errors}건")
print("────────────────────────────────────")

# 훅을 선언한 스킬이 있는데 검사 대상이 0건이면 통과가 아니라 실패다. 스캔 경로가
# 잘못됐거나 프론트매터 파싱이 깨진 것이므로 초록불로 덮으면 안 된다.
#
# 상류(oh-my-skills)와의 의도적 차이: 상류는 `checked == 0` 자체를 실패로 봤다. 훅을 쓰는
# 스킬이 항상 여러 개 있는 저장소에서는 그게 곧 "파서가 깨졌다"였기 때문이다. 이 저장소는
# 훅 없는 스킬 하나로 시작할 수 있어서(예: skill-author 는 hooks: 가 없고, 훅 예제를 품은
# assets/ 는 위에서 스캔 제외된다) 그 등식이 성립하지 않는다. 가드의 원래 의도인
# "선언했는데 안 잡힌다"를 조건에 그대로 옮겼다. docs/UPSTREAM.md 참조.
if declaring > 0 and checked == 0:
    print("❌ 오류: 훅을 선언한 스킬이 있는데 검사한 tool matcher가 0건입니다 "
          "— 스캔 경로나 프론트매터 파싱을 확인하세요")
    sys.exit(1)
if declaring == 0:
    print("ℹ️  훅을 선언한 스킬이 없습니다 — 검사 대상 0건")

sys.exit(1 if errors else 0)
PY
