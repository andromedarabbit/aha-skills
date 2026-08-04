#!/bin/bash
# SKILL.md 본문 스크립트 경로 검증 스크립트
#
# ── 이 검사가 존재하는 이유 ─────────────────────────────────────────────
# `validate-hook-paths.sh` 는 프론트매터 `hooks:` 의 경로를 본다. 같은 결함이
# **본문**에도 있는데, 성격이 정반대로 나쁘다:
#
#   훅  : 경로가 틀리면 조용히 실행되지 않는다 → 아무도 모르고 몇 달 방치된다
#   본문: 경로가 틀리면 에이전트가 그 경로로 실제 실행한다
#         → **첫 호출부터 `No such file or directory` 로 실패한다**
#
# 실제로 14개 스킬의 본문이 `bash .claude/skills/<category>/<skill>/scripts/<x>.sh`
# 로 스크립트를 부르라고 지시하고 있었다. 이건 CWD 상대경로라서 스킬이 플러그인으로
# 설치된 환경(그리고 분석 대상 저장소 안에서 실행하는 경우)에는 존재하지 않는다.
#
# ── 세 변수의 역할이 다르다 (서로 바꿔 쓰면 조용히 깨진다) ───────────────
#   ${CLAUDE_PLUGIN_ROOT}  프론트매터 `hooks:` 전용. 플러그인(= 카테고리) 루트라서
#                          뒤에 `<skill>/` 을 붙인다. **본문에서는 치환되지 않는다**
#                          (훅 실행 시 env 로만 주입된다)
#   ${CLAUDE_SKILL_DIR}    SKILL.md **본문**과 `allowed-tools` 전용. **그 스킬
#                          디렉토리 자체**라서 뒤에 바로 `scripts/` 가 온다.
#                          **훅에서는 치환되지 않는다**
#   $SKILL_DIR             **딸린 문서 전용**. `docs/*.md`·`README.md`·`WORKER.md` 는
#                          치환을 전혀 받지 못하므로(아래 참고) 거기서는 이 변수를
#                          쓰고, **값을 정하는 방법을 그 문서에 함께 적는다**
#                          (플러그인 캐시 경로 / 클론 경로). SKILL.md **본문**에서는
#                          여전히 구식 관례다 — 하네스가 이미 치환해 주는데 손으로
#                          담는 단계를 하나 더 만드는 셈이라 WARNING 으로 잡는다
#
# 본문/`allowed-tools` 치환은 공식 문서에 없다. 근거는 Claude Code v2.1.220
# 바이너리의 문자열이다:
#   if(s.isSkillMode) z = z.replace(/\$\{CLAUDE_SKILL_DIR\}/g, p)     // 본문
#   if(s.isSkillMode) q = q.replace(/\$\{CLAUDE_SKILL_DIR\}/g, ()=>p) // allowed-tools
#
# `${CLAUDE_SKILL_DIR}` 치환은 **SKILL.md 본문과 `allowed-tools` 에서만** 일어난다.
# `docs/*.md`·`README.md`·`WORKER.md` 같은 딸린 문서는 **누가 읽든 Read 도구로 읽히므로**
# 날문자로 남는다. 판정 기준은 "에이전트용이냐 사람용이냐"가 아니라 **"하네스를 거치느냐"**
# 다 — 그래서 딸린 문서에서는 이 변수를 경로로 쓸 수 없다. 대신:
#   - 서브에이전트(`WORKER.md`)에는 게이트(SKILL.md 본문)가 **치환된 절대경로**를 프롬프트에
#     실어 보낸다
#   - 사람이 셸에서 직접 돌릴 예시는 `$SKILL_DIR` 을 쓰고 **그 값을 정하는 방법을 같은 문서에
#     적는다**
# 자세한 규약은 docs/hook-patterns.md 의 "SKILL.md 본문 경로 규약" 절에 있다.
#
# ── 검사 내용 ──────────────────────────────────────────────────────────
# (A) 각 skills/*/*/SKILL.md 의 **본문**(두 번째 `---` 이후). 프론트매터는
#     validate-hook-paths.sh 담당이다.
# (B) 같은 스킬 디렉토리의 **딸린 문서** — `SKILL.md`·`CHANGELOG.md` 를 제외한 모든 `*.md`
#     (아래 7번). `assets/`·`*-workspace/` 는 둘 다 제외한다.
#
# 1) 본문에 `.claude/skills/` 가 나오면 **무조건 ERROR** (아래 "예외 없음" 참고)
# 2) `${CLAUDE_SKILL_DIR}` 뒤에 카테고리·스킬 이름이 붙어 있으면 ERROR
#    (가장 틀리기 쉬운 지점 — 이 변수는 이미 스킬 디렉토리다)
# 3) `${CLAUDE_SKILL_DIR}/<path>` 의 `<path>` 가 그 스킬 디렉토리에 없으면 ERROR
# 4) 본문에서 `${CLAUDE_PLUGIN_ROOT}` 를 **경로로** 쓰면 ERROR (치환되지 않는다)
# 5) 셸 문맥에서 따옴표가 없으면 WARNING (설치 경로에 공백이 있을 수 있다)
# 6) 본문의 `$SKILL_DIR` 구식 관례는 WARNING
# 7) **딸린 문서**에서 `${CLAUDE_SKILL_DIR}` 를 **경로로** 쓰면 ERROR
# 8) **딸린 문서**의 `.claude/skills/` 옛 형태는 WARNING (본문과 달리 오류가 아니다 — 아래)
#
# ── 7번의 판정 기준: 뒤에 `/` 가 붙었는가 ──────────────────────────────
# 규약을 설명하는 문서는 변수 **이름**을 부를 수밖에 없다("본문에서는
# `${CLAUDE_SKILL_DIR}` 가 치환된다"). 그래서 `.claude/skills/` 처럼 리터럴 자체를
# 금지할 수는 없고, 4번(`${CLAUDE_PLUGIN_ROOT}`)에 이미 쓰고 있는 것과 **같은 문법
# 기준**을 쓴다:
#   `${CLAUDE_SKILL_DIR}/...`  → 경로로 쓴 것이다. 읽는 쪽이 그대로 셸에 넘기면 bash 가
#                                빈 문자열로 확장해 `bash /scripts/x.sh` 로 실패한다 → ERROR
#   `${CLAUDE_SKILL_DIR}`      → 언급이다 → 통과
# `CHANGELOG.md` 는 과거 기록이라 경로 형태를 인용할 일이 정상이므로 제외한다.
#
# 이 검사가 없는 동안, "docs/ 는 대부분 에이전트가 읽으니 `${CLAUDE_SKILL_DIR}` 를 쓰라"는
# 잘못된 안내가 8개 문서 60여 곳에 퍼졌다. 딸린 문서는 에이전트가 읽어도 Read 를 거치므로
# 치환되지 않는다 — 읽는 주체가 아니라 **경로가 하네스를 거치느냐**가 기준이다.
#
# ── 왜 `.claude/skills/` 에 예외를 두지 않는가 ──────────────────────────
# "왜 이 형태를 쓰면 안 되는가"를 설명하려고 그 문자열을 인용하는 산문과, 실제
# 실행 지시를 구분하려는 시도를 **의도적으로 버렸다.** 구분 기준을 무엇으로 잡아도
# (인터프리터 접두어 유무, 인라인 코드인지 코드블록인지, 경로가 구체적인지
# 생략기호인지) 판정이 애매해지고, **그 애매함이 곧 미탐 경로가 된다.** 옛 형태가
# 하나 남아 조용히 통과하면 그 스킬은 플러그인 설치 환경에서 첫 호출부터 죽는다.
#
# 반대편 비용은 훨씬 싸다. 설명은 리터럴 없이도 쓸 수 있다 —
# "CWD 상대경로는 플러그인 설치 환경에서 풀리지 않는다" 로 충분하다. 그래서
# 규약을 설명하는 문장이 걸리면 예외를 넣지 말고 **문장에서 리터럴을 빼라.**
#
# ── 딸린 문서에서는 왜 경고인가 (8번) ───────────────────────────────────
# 위 논리는 **본문**에 대한 것이다. 본문의 리터럴은 에이전트가 그대로 실행해 하드 실패로
# 이어지지만, 딸린 문서의 등장은 대부분 "이 형태가 왜 틀렸는지" 가르치는 문장이다. 실제로
# 이 검사를 붙이자마자 걸린 두 곳(git-commit-helper 의 README·TROUBLESHOOTING)이 정확히
# 그 서술이라, 오류로 두면 규약을 설명하는 문서 때문에 CI 가 빨간불이 된다. 그래서 여기서는
# 눈에 띄게만 하고(WARNING) 판단은 사람에게 남긴다.
# `~/.claude/skills/...` 는 아예 제외한다 — 홈 기준 **절대경로**라 CWD 상대경로와 다른
# 물건이고(로컬 설치 심링크 위치를 적는 정당한 용법), 섞으면 오탐이 된다.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ERRORS=0
WARNINGS=0
CHECKED=0

echo "🔍 SKILL.md 본문 경로 검증 시작..."
echo ""

if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ 오류: 이 검사기에는 python3 가 필요합니다"
  exit 1
fi

body_output=$(python3 - "$PROJECT_ROOT" <<'PY'
import os
import re
import sys

project_root = os.path.abspath(sys.argv[1])
skills_root = os.path.join(project_root, "skills")

# 경로 문자를 ASCII 로 한정한다. \w 는 유니코드라서 한국어 조사가 붙은
# `${CLAUDE_SKILL_DIR}/WORKER.md의` 를 경로에 빨아들인다.
PATH_CHARS = r"[A-Za-z0-9._/<>~+-]"

OLD_PREFIX = ".claude/skills/"
OLD_RE = re.compile(re.escape(OLD_PREFIX) + PATH_CHARS + r"*")
SKILL_DIR_RE = re.compile(r"\$\{CLAUDE_SKILL_DIR\}|\$CLAUDE_SKILL_DIR(?![A-Za-z0-9_])")
PLUGIN_ROOT_RE = re.compile(r"\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT(?![A-Za-z0-9_])")
# `$SKILL_DIR` / `${SKILL_DIR}` 만 잡는다. `${CLAUDE_SKILL_DIR}` 은 `$` 다음이
# `{C` 라서 매칭되지 않는다.
LEGACY_RE = re.compile(r"\$\{?SKILL_DIR\}?")
TAIL_RE = re.compile(PATH_CHARS + r"*")
# 인라인 코드 스팬이 셸 명령인지: 환경변수 접두사 + 인터프리터
EXEC_RE = re.compile(
    r"^\s*(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]*\s+)*"
    r"(?:sudo\s+)?(?:bash|sh|zsh|python3?|uv|uvx|source|\.)(?:\s|$)"
)


def emit(*fields):
    print("\t".join(str(f) for f in fields))


def find_skill_files(root):
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [
            d for d in dirnames
            if not d.endswith("-workspace") and d != "assets"
        ]
        if "SKILL.md" in filenames:
            found.append(os.path.join(dirpath, "SKILL.md"))
    return sorted(found)


# 딸린 문서: `SKILL.md`(본문 검사 대상)와 `CHANGELOG.md`(과거 기록)를 뺀 모든 `*.md`.
# 파일 이름 목록을 열거하지 않는 이유는 `GUIDELINES.md` 처럼 스킬 루트에 있는 문서와
# `references/`·`docs/` 하위를 전부 덮어야 하기 때문이다.
DOC_SKIP_NAMES = {"SKILL.md", "CHANGELOG.md"}


def find_doc_files(root):
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [
            d for d in dirnames
            if not d.endswith("-workspace") and d != "assets"
        ]
        for name in filenames:
            if name.endswith(".md") and name not in DOC_SKIP_NAMES:
                found.append(os.path.join(dirpath, name))
    return sorted(found)


def body_lines(path):
    """프론트매터(첫 `---` 블록)를 제외한 본문을 (줄번호, 내용) 으로 돌려준다."""
    with open(path, "r", encoding="utf-8") as f:
        lines = f.read().splitlines()
    if not lines or lines[0].strip() != "---":
        return [(i + 1, line) for i, line in enumerate(lines)]
    for idx, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            return [(i + 1, l) for i, l in enumerate(lines[idx + 1:], start=idx + 1)]
    # 프론트매터가 닫히지 않았다 — 전체를 본문으로 본다(별도 검사기가 잡는다)
    return [(i + 1, line) for i, line in enumerate(lines)]


def strip_trailing_punct(token):
    """문장 부호가 경로에 붙어 들어온 것을 떼어낸다. 생략기호(`...`)는 지킨다."""
    while token:
        last = token[-1]
        if last in ",;:)>":
            token = token[:-1]
            continue
        if last == "." and not token.endswith(".."):
            token = token[:-1]
            continue
        break
    return token


def is_placeholder(tail):
    """실행할 수 없는 자리표시자 경로인가.

    존재 확인에만 쓴다. `${CLAUDE_SKILL_DIR}/scripts/<x>.sh` 처럼 형태만 보여주는
    예시는 실재하는 파일을 가리키지 않는 게 정상이다. `.claude/skills/` 판정에는
    쓰지 않는다 — 거기엔 예외가 없다.
    """
    return ("..." in tail) or ("<" in tail) or ("*" in tail)


def inline_code_spans(line):
    """한 줄의 인라인 코드 스팬 (start, end) 목록. 백틱 1개 스팬만 다룬다."""
    spans = []
    positions = [m.start() for m in re.finditer(r"`", line)]
    for i in range(0, len(positions) - 1, 2):
        spans.append((positions[i] + 1, positions[i + 1]))
    return spans


def shell_context(line, pos, in_fence):
    """이 위치가 '실제로 셸이 실행할 자리'인가 — 따옴표 경고의 적용 범위."""
    if in_fence:
        return True
    for start, end in inline_code_spans(line):
        if start <= pos < end:
            return bool(EXEC_RE.match(line[start:end]))
    return False


def is_quoted(line, pos):
    return pos > 0 and line[pos - 1] in "\"'"


skill_files = find_skill_files(skills_root)
if not skill_files:
    emit("FATAL", "SKILL.md 파일을 찾을 수 없음")
    emit("SUMMARY", 0, 1, 0)
    sys.exit(1)

known_categories = set()
known_skills = set()
if os.path.isdir(skills_root):
    for category in sorted(os.listdir(skills_root)):
        cat_path = os.path.join(skills_root, category)
        if not os.path.isdir(cat_path):
            continue
        known_categories.add(category)
        for skill in os.listdir(cat_path):
            if os.path.isdir(os.path.join(cat_path, skill)):
                known_skills.add(skill)

checked = 0
errors = 0
warnings = 0

for skill_file in skill_files:
    rel_skill_file = os.path.relpath(skill_file, project_root)
    skill_dir = os.path.dirname(skill_file)
    own_skill = os.path.basename(skill_dir)
    own_category = os.path.basename(os.path.dirname(skill_dir))

    emit("FILE", rel_skill_file)
    file_findings = 0
    in_fence = False

    for lineno, line in body_lines(skill_file):
        stripped = line.strip()
        if stripped.startswith("```") or stripped.startswith("~~~"):
            in_fence = not in_fence
            continue

        # ── 1) 옛 형태 `.claude/skills/` — 예외 없이 오류 ────────────────
        for m in OLD_RE.finditer(line):
            token = strip_trailing_punct(m.group(0))
            rest = token[len(OLD_PREFIX):]
            checked += 1
            file_findings += 1
            segments = [s for s in rest.split("/") if s]
            suggestion = (
                "${CLAUDE_SKILL_DIR}/" + "/".join(segments[2:])
                if len(segments) > 2 else "${CLAUDE_SKILL_DIR}"
            )
            emit("ERR_OLD_FORM", rel_skill_file, lineno, token, suggestion)
            errors += 1

        # ── 2~3, 5) `${CLAUDE_SKILL_DIR}` ──────────────────────────────
        for m in SKILL_DIR_RE.finditer(line):
            tail = strip_trailing_punct(TAIL_RE.match(line, m.end()).group(0))
            checked += 1
            file_findings += 1

            if not tail.startswith("/"):
                # 변수 자체를 설명하는 산문 언급
                emit("INFO_BARE_SKILL_DIR", rel_skill_file, lineno)
                continue

            rel = tail[1:]
            if shell_context(line, m.start(), in_fence) and not is_quoted(line, m.start()):
                emit("WARN_UNQUOTED", rel_skill_file, lineno, "${CLAUDE_SKILL_DIR}" + tail)
                warnings += 1

            first_seg = rel.split("/")[0]
            resolved = os.path.normpath(os.path.join(skill_dir, rel.rstrip("/")))

            # 2) 카테고리·스킬 이름을 덧붙인 경우
            if first_seg in (own_skill, own_category):
                emit("ERR_SELF_PREFIX", rel_skill_file, lineno,
                     "${CLAUDE_SKILL_DIR}" + tail, first_seg,
                     "${CLAUDE_SKILL_DIR}/" + "/".join(rel.split("/")[1:]))
                errors += 1
                continue
            if is_placeholder(rel):
                emit("INFO_PLACEHOLDER", rel_skill_file, lineno,
                     "${CLAUDE_SKILL_DIR}" + tail)
                continue
            if not (os.path.isfile(resolved) or os.path.isdir(resolved)):
                if first_seg in known_categories or first_seg in known_skills:
                    emit("ERR_NAME_PREFIX", rel_skill_file, lineno,
                         "${CLAUDE_SKILL_DIR}" + tail, first_seg)
                    errors += 1
                    continue
                # 3) 존재하지 않는 경로
                emit("ERR_MISSING", rel_skill_file, lineno,
                     "${CLAUDE_SKILL_DIR}" + tail,
                     os.path.relpath(resolved, project_root))
                errors += 1
                continue
            emit("OK", rel_skill_file, lineno, "${CLAUDE_SKILL_DIR}" + tail)

        # ── 4) 본문의 `${CLAUDE_PLUGIN_ROOT}` ──────────────────────────
        # 경로로 쓴 것만 오류다. 훅 규약을 설명하려면 변수 이름을 부르는 것 말고는
        # 방법이 없어서(리터럴을 뺄 수 있는 `.claude/skills/` 와 다르다), 뒤에 `/`
        # 가 붙지 않은 언급은 통과시킨다. 판정은 순수 문법 검사라 애매함이 없다.
        for m in PLUGIN_ROOT_RE.finditer(line):
            tail = strip_trailing_punct(TAIL_RE.match(line, m.end()).group(0))
            checked += 1
            file_findings += 1
            if not tail.startswith("/"):
                emit("INFO_BARE_PLUGIN_ROOT", rel_skill_file, lineno)
                continue
            segments = [s for s in tail[1:].split("/") if s]
            suggestion = (
                "${CLAUDE_SKILL_DIR}/" + "/".join(segments[1:])
                if len(segments) > 1 else "${CLAUDE_SKILL_DIR}"
            )
            emit("ERR_PLUGIN_ROOT_IN_BODY", rel_skill_file, lineno,
                 "${CLAUDE_PLUGIN_ROOT}" + tail, suggestion)
            errors += 1

        # ── 6) 구식 `$SKILL_DIR` 관례 ──────────────────────────────────
        for m in LEGACY_RE.finditer(line):
            checked += 1
            file_findings += 1
            emit("WARN_LEGACY_SKILL_DIR", rel_skill_file, lineno, m.group(0))
            warnings += 1

    if file_findings == 0:
        emit("INFO_NO_PATHS", rel_skill_file)

# ── 7) 딸린 문서에서 `${CLAUDE_SKILL_DIR}` 를 경로로 쓴 것 ──────────────────
# 파일 단위 헤더는 찍지 않는다. 딸린 문서는 수백 개라서 "이 파일엔 없음" 을 전부
# 출력하면 정작 오류가 묻힌다.
emit("DOCS_SECTION")
for doc_file in find_doc_files(skills_root):
    rel_doc = os.path.relpath(doc_file, project_root)
    with open(doc_file, "r", encoding="utf-8") as f:
        doc_lines = f.read().splitlines()

    for lineno, line in enumerate(doc_lines, start=1):
        # ── 7a) 딸린 문서의 옛 형태 `.claude/skills/` ─────────────────────
        # 예전에는 이 루프가 SKILL_DIR_RE 하나만 봐서 딸린 문서는 이 검사에서 통째로 빠져
        # 있었다(2026-07-30 코드리뷰 지적). 다만 본문과 달리 **경고**로 둔다:
        #
        #   - 본문의 리터럴은 에이전트가 그대로 실행해 하드 실패한다 → 오류가 맞다.
        #   - 딸린 문서의 등장은 대부분 "이 형태가 왜 틀렸는지" 가르치는 문장이다. 실제로
        #     git-commit-helper 의 README·TROUBLESHOOTING 두 곳이 정확히 그 서술이고,
        #     이걸 오류로 만들면 규약을 설명하는 문서 때문에 CI 가 빨간불이 된다.
        #
        # `~/.claude/skills/...` 는 아예 제외한다 — 홈 기준 **절대경로**라 CWD 상대경로와
        # 다른 물건이고(로컬 설치 심링크 위치를 적는 정당한 용법), 섞으면 오탐이 된다.
        for m in OLD_RE.finditer(line):
            if m.start() > 0 and line[m.start() - 1] in "~/":
                continue
            token = strip_trailing_punct(m.group(0))
            rest = token[len(OLD_PREFIX):]
            segments = [s for s in rest.split("/") if s]
            checked += 1
            suggestion = (
                "$SKILL_DIR/" + "/".join(segments[2:])
                if len(segments) > 2 else "$SKILL_DIR"
            )
            emit("WARN_OLD_FORM_IN_DOC", rel_doc, lineno, token, suggestion)
            warnings += 1

        # 딸린 문서의 `${CLAUDE_PLUGIN_ROOT}` 는 **검사하지 않는다.** 리뷰에서 검사하자는
        # 제안이 있었으나 실측해보니 오탐만 나온다 — skill-author 의 README·WORKER 는 훅
        # 규약 자체를 가르치느라 `${CLAUDE_PLUGIN_ROOT}/<skill>/scripts/...` 전체 형태를
        # 적어야 하고, 그걸 "경로로 쓴 것"과 문법으로 구분할 방법이 없다.

        # ── 7b) 딸린 문서의 `${CLAUDE_SKILL_DIR}` ─────────────────────────
        for m in SKILL_DIR_RE.finditer(line):
            tail = strip_trailing_punct(TAIL_RE.match(line, m.end()).group(0))
            checked += 1
            if not tail.startswith("/"):
                # 규약을 설명하려면 변수 이름을 부를 수밖에 없다 — 언급은 정상이다
                emit("DOC_INFO_MENTION", rel_doc, lineno)
                continue
            emit("ERR_SKILL_DIR_IN_DOC", rel_doc, lineno,
                 "${CLAUDE_SKILL_DIR}" + tail, "$SKILL_DIR" + tail)
            errors += 1

emit("SUMMARY", checked, errors, warnings)
sys.exit(0)
PY
) || true

summary_found=0
while IFS=$'\t' read -r code f1 f2 f3 f4 f5; do
  [ -z "$code" ] && continue
  case "$code" in
    FILE)
      echo ""
      echo "🔍 검증: $f1"
      ;;
    OK)
      echo "  ✅ $f1:$f2 - $f3"
      ;;
    INFO_NO_PATHS)
      echo "  ℹ️  본문에 스크립트 경로 참조 없음"
      ;;
    INFO_BARE_SKILL_DIR)
      echo "  ℹ️  $f1:$f2 - \${CLAUDE_SKILL_DIR} 변수 자체를 설명하는 언급"
      ;;
    INFO_BARE_PLUGIN_ROOT)
      echo "  ℹ️  $f1:$f2 - \${CLAUDE_PLUGIN_ROOT} 를 경로가 아니라 규약으로 언급(정상)"
      ;;
    INFO_PLACEHOLDER)
      echo "  ℹ️  $f1:$f2 - 자리표시자 경로라 존재 확인을 건너뜀: $f3"
      ;;
    WARN_UNQUOTED)
      echo "  ⚠️  경고: $f1:$f2 - 경로에 따옴표가 없음 - $f3"
      echo "      설치 경로에 공백이 있으면 깨집니다. bash \"\${CLAUDE_SKILL_DIR}/scripts/x.sh\" 형태로 감싸세요"
      ;;
    WARN_LEGACY_SKILL_DIR)
      echo "  ⚠️  경고: $f1:$f2 - 구식 $f3 관례"
      echo "      하네스가 본문의 \${CLAUDE_SKILL_DIR} 를 미리 치환하므로 변수에 담는 단계가 필요 없습니다"
      ;;
    ERR_OLD_FORM)
      echo "  ❌ 오류: $f1:$f2 - 옛 본문 경로 형태 - $f3"
      echo "      \`.claude/skills/\` 는 CWD 상대경로여서 플러그인 설치 환경에 존재하지 않고,"
      echo "      에이전트가 그대로 실행하면 **첫 호출부터 \`No such file or directory\` 로 실패**합니다:"
      echo "        $f4"
      echo "      (\${CLAUDE_SKILL_DIR} 는 스킬 디렉토리 자체입니다 — 카테고리·스킬 이름을 붙이지 마세요)"
      echo "      규약을 **설명**하려던 문장이라도 예외는 없습니다. 리터럴을 빼고 쓰세요"
      ;;
    ERR_SELF_PREFIX)
      echo "  ❌ 오류: $f1:$f2 - \${CLAUDE_SKILL_DIR} 뒤에 '$f4' 를 덧붙였음 - $f3"
      echo "      이 변수는 **그 스킬 디렉토리 자체**입니다. 뒤에 카테고리나 스킬 이름이 오면 안 됩니다:"
      echo "        $f5"
      ;;
    ERR_NAME_PREFIX)
      echo "  ❌ 오류: $f1:$f2 - \${CLAUDE_SKILL_DIR} 뒤에 카테고리·스킬 이름 '$f4' 가 붙었음 - $f3"
      echo "      \${CLAUDE_SKILL_DIR} 다음에는 바로 \`scripts/\` 같은 스킬 내부 경로가 옵니다"
      ;;
    ERR_MISSING)
      echo "  ❌ 오류: $f1:$f2 - 파일 없음 - $f3 (기대 위치: $f4)"
      ;;
    DOCS_SECTION)
      echo ""
      echo "🔍 딸린 문서(docs/·README.md·WORKER.md 등) 검증 — CHANGELOG.md 제외"
      ;;
    DOC_INFO_MENTION)
      echo "  ℹ️  $f1:$f2 - \${CLAUDE_SKILL_DIR} 를 경로가 아니라 규약으로 언급(정상)"
      ;;
    ERR_SKILL_DIR_IN_DOC)
      echo "  ❌ 오류: $f1:$f2 - 딸린 문서에서 \${CLAUDE_SKILL_DIR} 를 경로로 사용 - $f3"
      echo "      치환은 SKILL.md 본문과 \`allowed-tools\` 에서만 일어납니다. 딸린 문서는 누가 읽든"
      echo "      Read 도구로 읽히므로 날문자로 남고, 읽는 쪽이 그대로 셸에 넘기면 빈 문자열로 확장돼"
      echo "      \`bash /scripts/...\` 로 실패합니다:"
      echo "        $f4"
      echo "      \$SKILL_DIR 값을 정하는 방법(플러그인 캐시 경로 / 클론 경로)도 그 문서에 적으세요."
      echo "      규약을 **설명**하려고 변수 이름만 부르는 건 통과합니다 — 뒤에 \`/\` 를 붙이지 마세요"
      ;;
    ERR_PLUGIN_ROOT_IN_BODY)
      echo "  ❌ 오류: $f1:$f2 - 본문에서 \${CLAUDE_PLUGIN_ROOT} 를 경로로 사용 - $f3"
      echo "      이 변수는 프론트매터 \`hooks:\` 에서만 치환됩니다. 본문에서는 빈 문자열이 되어 경로가 깨집니다:"
      echo "        $f4"
      ;;
    WARN_OLD_FORM_IN_DOC)
      echo "  ⚠️  경고: $f1:$f2 - 딸린 문서에 옛 경로 형태 - $f3"
      echo "      딸린 문서는 치환을 받지 못하므로 읽는 쪽이 그대로 실행하면 실패합니다:"
      echo "        $f4"
      echo "      (이 형태가 왜 틀렸는지 **설명**하는 문장이면 그대로 두어도 됩니다 — 그래서 오류가 아니라 경고입니다)"
      ;;
    SUMMARY)
      CHECKED=$((CHECKED + f1))
      ERRORS=$((ERRORS + f2))
      WARNINGS=$((WARNINGS + f3))
      summary_found=1
      ;;
    FATAL)
      echo "  ❌ 오류: $f1"
      ;;
    *)
      echo "  ⚠️  알 수 없는 검증 출력: $code"
      ;;
  esac
done <<< "$body_output"

if [ "$summary_found" -ne 1 ]; then
  echo ""
  echo "  ❌ 오류: 본문 경로 검증 결과 요약을 읽지 못함"
  ERRORS=$((ERRORS + 1))
fi

echo ""
echo "────────────────────────────────────"
echo "📊 검증 결과:"
echo "  검사 항목: $CHECKED"
echo "  경고 수: $WARNINGS"
echo "  오류 수: $ERRORS"
echo "────────────────────────────────────"

if [ "$ERRORS" -eq 0 ]; then
  echo "✅ 모든 본문 경로가 유효합니다"
  exit 0
fi

echo "❌ $ERRORS 개의 오류가 발견되었습니다"
exit 1
