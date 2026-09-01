#!/bin/bash
# aside 실행 계층 페이로드 검증 스크립트
#
# 자연어 실행 계층(aside exec/repl)에 "로컬 파일 경로"를 넘기는 지시를 잡는다.
# aside exec는 프롬프트의 로컬 파일 경로를 read_file하려다 무인(unattended) 권한
# 확인에 무한 정지한다 — 답할 주체가 없기 때문이다. 2026-09-01 social-posting에서
# 게시 4건 전부 이 경로로 수 분~15분 정지했고, 실측 차별 프로브로 확정됐다.
# 페이로드는 프롬프트에 인라인으로 실어 보낸다 (docs/hook-patterns.md
# "자연어 실행 계층 페이로드 규칙" 참조).
#
# 판정:
#   오류  - aside exec/repl 호출 라인에서 본문을 파일 경로로 지시하는 패턴("파일 X 의 내용")
#   오류  - 마크다운에서 파일 경로 전달을 지시하는 서술("파일 … 경로를 전달") —
#           설명형("파일 경로 전달은/이 …")은 규칙 서술이므로 잡지 않는다
#   경고  - aside 맥락 스크립트의 기타 로컬 경로 인용(미디어 첨부 등 불가피한 경우) —
#           줄 끝 "# aside-path-ok" 주석으로 억제한다. 종료코드에는 영향 없음
#
# 검사 대상: aside를 언급하는 SKILL.md + 딸린 문서(CHANGELOG 제외) + scripts/**
# (scripts/tests/ 는 제외 — 회귀 테스트가 위반 패턴을 픽스처로 심는 것이 정상이다)
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

echo "🔍 aside 실행 계층 페이로드 검증 시작... ($SCAN_ROOT)"
echo ""

python3 - "$SCAN_ROOT" <<'PY'
import os
import re
import sys

project_root = sys.argv[1]

# 실측 사고 형태 그대로: aside 호출 라인에서 본문을 파일 경로로 지시하는 관형구.
ASIDE_CALL = re.compile(r"aside\s+(?:exec|repl)")
BODY_PATH_DIRECTIVE = re.compile(r"파일\s+\S+\s+의\s*내용")
# 마크다운 지시형 — "동결된 초안 파일 경로를 전달". 설명형("파일 경로 전달은 …")과
# "경로를 전달" 유무로 문자열 수준에서 구분된다(2026-09-01 실제 라인 대조 확인).
MD_PATH_IMPERATIVE = re.compile(r"파일.{0,30}경로를\s*전달")
# 경고용: aside 맥락 스크립트의 기타 로컬 경로 인용 — "파일 '$var'" / "파일 $var"
SHELL_PATH_REF = re.compile(r"파일\s+['\"]?\$[A-Za-z_{]")
SUPPRESS = "# aside-path-ok"

md_files = []   # SKILL.md + 딸린 문서
sh_files = []   # scripts/ (tests 제외)
for dirpath, dirnames, filenames in os.walk(os.path.join(project_root, "skills")):
    # 평가 산출물(*-workspace)과 스킬이 품은 템플릿(assets/)은 스킬이 아니다
    dirnames[:] = [
        d
        for d in dirnames
        if "-workspace" not in d and d != "assets" and d != "tests"
    ]
    is_script_dir = f"{os.sep}scripts{os.sep}" in dirpath + os.sep
    for fn in filenames:
        path = os.path.join(dirpath, fn)
        if is_script_dir:
            if fn.endswith(".sh"):
                sh_files.append(path)
        elif fn == "SKILL.md" or (fn.endswith(".md") and fn != "CHANGELOG.md"):
            md_files.append(path)
md_files.sort()
sh_files.sort()


def rel(path):
    return os.path.relpath(path, project_root)


errors = 0
warnings = 0
checked = 0  # aside를 언급하는 파일 수

for path in md_files:
    with open(path, encoding="utf-8", errors="replace") as f:
        lines = f.read().splitlines()
    if not any("aside" in l.lower() for l in lines):
        continue
    checked += 1
    hits = []
    for i, line in enumerate(lines, 1):
        if MD_PATH_IMPERATIVE.search(line):
            hits.append(i)
    if hits:
        print(f"❌ {rel(path)}")
        for i in hits:
            print(f"   - {i}행: 파일 경로 전달을 지시하는 서술 — 인라인 전달 규칙과 모순된다.")
            print("     aside exec는 로컬 파일 경로를 read_file하다 무인 권한 확인에 무한 정지한다.")
            print("     페이로드는 프롬프트에 인라인으로 실어 보낸다 (docs/hook-patterns.md 참조).")
        errors += 1
    else:
        print(f"✅ {rel(path)}")

for path in sh_files:
    with open(path, encoding="utf-8", errors="replace") as f:
        lines = f.read().splitlines()
    if not any("aside" in l.lower() for l in lines):
        continue
    checked += 1
    err_hits = []
    warn_hits = []
    for i, line in enumerate(lines, 1):
        if line.lstrip().startswith("#") and SUPPRESS not in line:
            pass  # 주석 라인은 지시가 아니지만 아래 정규식은 주석에서도 무해하다
        if ASIDE_CALL.search(line) and BODY_PATH_DIRECTIVE.search(line):
            err_hits.append(i)
            continue
        if SHELL_PATH_REF.search(line) and SUPPRESS not in line:
            warn_hits.append(i)
    if err_hits:
        print(f"❌ {rel(path)}")
        for i in err_hits:
            print(f"   - {i}행: aside 호출 프롬프트가 본문을 '파일 <경로> 의 내용'으로 지시한다.")
            print("     aside exec는 로컬 파일 경로를 read_file하다 무인 권한 확인에 무한 정지한다")
            print("     (2026-09-01 실측 — 게시 4건 정지 사고). 페이로드를 프롬프트에 인라인으로 실어라.")
        errors += 1
    elif warn_hits:
        print(f"⚠️  경고: {rel(path)}")
        for i in warn_hits:
            print(f"   - {i}행: aside 맥락에서 로컬 파일 경로를 인용한다 — 무인 read_file 정지 위험.")
            print("     불가피한 경우(미디어 첨부 등) 줄 끝에 '# aside-path-ok' 주석으로 억제한다.")
        warnings += 1
    else:
        print(f"✅ {rel(path)}")

print("")
print("────────────────────────────────────")
print(f"📊 검증 결과: aside 언급 파일 {checked}건 검사, 경고 {warnings}건, 오류 {errors}건")
print("────────────────────────────────────")

sys.exit(1 if errors else 0)
PY
