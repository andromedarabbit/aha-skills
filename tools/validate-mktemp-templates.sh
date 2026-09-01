#!/bin/bash
# mktemp 템플릿 접미사 검증 스크립트
#
# mktemp 템플릿의 X 문자열(XXXXXX)이 마지막 문자가 아니면 오류로 잡는다.
# macOS BSD mktemp는 접미사가 붙은 템플릿을 랜덤화하지 않고 그대로 파일명으로
# 쓴다 — 모든 실행이 같은 고정 경로를 공유하게 되고, 병렬 실행에서 서로 다른
# 페이로드가 뒤섞인다. 2026-09-01 social-posting에서 플랫폼 간 문구가 뒤섞인 채
# 실제로 게시된 사고의 원인이었다 (social-posting-workspace 사고, docs/hook-patterns.md
# "자연어 실행 계층 페이로드 규칙" 참조).
#
# GNU mktemp는 접미사를 지원하지만 이 저장소는 macOS에서도 돌아야 하므로
# 공용 스크립트는 BSD 동작(XXXXXX 마지막)으로 통일한다.
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

echo "🔍 mktemp 템플릿 검증 시작... ($SCAN_ROOT)"
echo ""

python3 - "$SCAN_ROOT" <<'PY'
import os
import re
import sys

project_root = sys.argv[1]

# 템플릿 인자 추출: 인용 형식 우선, 없으면 비인용 토큰. 플래그(-d 등)는 건너뛴다.
MKTEMP_QUOTED = re.compile(r"mktemp\s+(?:-\w+\s+)*[\"']([^\"']+)[\"']")
MKTEMP_BARE = re.compile(r"mktemp\s+(?:-\w+\s+)*([^\s;)&|]+)")
XRUN = re.compile(r"X{3,}")

scripts = []
for dirpath, dirnames, filenames in os.walk(os.path.join(project_root, "skills")):
    # 평가 산출물(*-workspace)은 스킬이 아니다. 템플릿 리터럴만 보므로 tests/ 포함 전체 스캔 —
    # 테스트가 나쁜 템플릿을 실제로 쓰고 있으면 그것도 버그다.
    dirnames[:] = [d for d in dirnames if "-workspace" not in d]
    for fn in filenames:
        if fn.endswith(".sh"):
            scripts.append(os.path.join(dirpath, fn))
scripts.sort()

errors = 0
checked = 0  # mktemp 호출이 있는 스크립트 수

for path in scripts:
    rel = os.path.relpath(path, project_root)
    with open(path, encoding="utf-8", errors="replace") as f:
        lines = f.read().splitlines()

    def is_code(line):
        return "mktemp" in line and not line.lstrip().startswith("#")

    if not any(is_code(l) for l in lines):
        continue
    checked += 1

    hits = []
    for i, line in enumerate(lines, 1):
        if not is_code(line):
            continue
        m = MKTEMP_QUOTED.search(line)
        if not m:
            m = MKTEMP_BARE.search(line)
            if not m or "X" not in m.group(1):
                continue
        xm = XRUN.search(m.group(1))
        if xm and xm.end() != len(m.group(1)):
            hits.append((i, m.group(1)))

    if hits:
        print(f"❌ {rel}")
        for i, tmpl in hits:
            print(f"   - {i}행: 템플릿 '{tmpl}' — X 문자열 뒤에 접미사가 붙어 있다.")
            print("     macOS BSD mktemp는 접미사가 있으면 랜덤화하지 않고 그대로 파일명으로 쓴다.")
            print("     병렬 실행이 같은 고정 경로를 공유하게 된다(2026-09-01 게시 뒤섞임 사고 원인).")
            print("     접미사를 제거해 X 문자열을 템플릿 마지막에 두라.")
        errors += 1
    else:
        print(f"✅ {rel}")

print("")
print("────────────────────────────────────")
print(f"📊 검증 결과: mktemp 사용 스크립트 {checked}건 검사, 오류 {errors}건")
print("────────────────────────────────────")

sys.exit(1 if errors else 0)
PY
