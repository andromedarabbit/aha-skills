#!/bin/bash
# AskUserQuestion 게이트 컨텍스트 정적 검증 스크립트
#
# SKILL.md 프론트매터의 allowed-tools 에 AskUserQuestion 이 선언됐는데 context 가
# fork 인 스킬을 잡는다. fork 서브에이전트는 AskUserQuestion 을 호출할 수 없어서,
# fork 스킬이 allowed-tools 에 AskUserQuestion 을 넣으면 게이트가 조용히 발동하지
# 않는다 — 에이전트는 "승인 게이트가 있다"고 믿으면서 실제로는 한 번도 뜨지 않는다.
#
# validate-skill.sh 는 SKILL.md 본문 산문의 "AskUserQuestion 지시"를 잡고,
# 이 검사기는 프론트매터의 allowed-tools 선언을 잡는다 — 서로 별개 검사.
#
# Claude 실행이 필요 없는 결정적 검사 — CI/pre-commit에 적합.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 검사할 저장소 루트. 인자를 주면 그곳의 skills/ 를 스캔한다.
# 인자를 무시하고 늘 자기 위치에서 역산하면 테스트가 스크립트를 가짜 저장소로 복사해야만
# 하는데, 그러면 복사본이 원본과 갈라질 수 있다.
SCAN_ROOT="${1:-$PROJECT_ROOT}"

if [ ! -d "$SCAN_ROOT" ]; then
  echo "❌ 오류: 저장소 루트를 찾을 수 없습니다: $SCAN_ROOT"
  echo "사용법: $(basename "$0") [저장소_루트]"
  exit 1
fi

# skills/ 가 없는 디렉토리를 넘기면 "0건 검사, 오류 0건"으로 초록불이 됐다.
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

echo "🔍 AskUserQuestion 게이트 컨텍스트 검증 시작... ($SCAN_ROOT)"
echo ""

python3 - "$SCAN_ROOT" <<'PY'
import os
import re
import sys

project_root = sys.argv[1]


def extract_frontmatter(text):
    m = re.match(r"^---\n(.*?)\n---", text, re.S)
    return m.group(1) if m else None


def strip_quotes(s):
    s = s.strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in ("'", '"'):
        return s[1:-1]
    return s


def parse_context(fm):
    # context 는 최상위 키. 생략되면 None (기본 inline).
    for ln in fm.splitlines():
        m = re.match(r"^context:\s*(.+?)\s*$", ln)
        if m:
            return strip_quotes(m.group(1))
    return None


def parse_allowed_tools(fm):
    # allowed-tools 는 최상위 키. 두 형태를 모두 잡는다:
    #   (1) 인라인:  allowed-tools: Read, Bash, AskUserQuestion
    #   (2) 블록 리스트:
    #         allowed-tools:
    #           - Read
    #           - AskUserQuestion
    tokens = set()
    lines = fm.splitlines()
    for i, ln in enumerate(lines):
        m_inline = re.match(r"^allowed-tools:\s*(\S.*?)\s*$", ln)
        if m_inline:
            for tok in re.split(r"[,\s]+", m_inline.group(1)):
                t = strip_quotes(tok)
                if t:
                    tokens.add(t)
            continue
        if re.match(r"^allowed-tools:\s*$", ln):
            for nxt in lines[i + 1:]:
                if nxt.strip() == "":
                    continue
                if not nxt[0].isspace():
                    break
                mi = re.match(r"^\s+-\s*(.+?)\s*$", nxt)
                if mi:
                    tokens.add(strip_quotes(mi.group(1)))
                else:
                    break
    return tokens


skills = []
for dirpath, _dirnames, filenames in os.walk(os.path.join(project_root, "skills")):
    # 평가 산출물과 스킬이 품은 템플릿(assets/)은 스킬이 아니다
    if "-workspace" in dirpath or f"{os.sep}assets{os.sep}" in dirpath + os.sep:
        continue
    if "SKILL.md" in filenames:
        skills.append(os.path.join(dirpath, "SKILL.md"))
skills.sort()

errors = 0
checked = 0  # AskUserQuestion 을 allowed-tools 에 선언한 스킬 수

for sf in skills:
    rel = os.path.relpath(sf, project_root)
    with open(sf, encoding="utf-8") as f:
        text = f.read()
    fm = extract_frontmatter(text)
    if not fm:
        continue
    tokens = parse_allowed_tools(fm)
    if "AskUserQuestion" not in tokens:
        continue
    checked += 1
    ctx = parse_context(fm)
    if ctx == "fork":
        print(f"❌ {rel}")
        print("   - allowed-tools에 AskUserQuestion이 있지만 context가 fork입니다.")
        print("     서브에이전트(fork)는 AskUserQuestion을 호출할 수 없어 게이트가 발동하지 않습니다.")
        print("     context: inline으로 바꾸거나, fork에서는 PENDING_DECISION: 반환-재개 방식을 쓰세요.")
        errors += 1
    else:
        print(f"✅ {rel}")

print("")
print("────────────────────────────────────")
print(f"📊 검증 결과: AskUserQuestion 선언 스킬 {checked}건 검사, 오류 {errors}건")
print("────────────────────────────────────")

sys.exit(1 if errors else 0)
PY
