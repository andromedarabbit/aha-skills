#!/bin/bash
# 훅 경로 검증 스크립트
#
# ── 이 검사가 존재하는 이유 ─────────────────────────────────────────────
# 스킬 프론트매터의 훅 `command` 는 경로가 틀려도 **에러가 나지 않는다**. 그냥
# 조용히 아무 일도 일어나지 않는다. 훅이 안 돌았다는 신호가 어디에도 안 남기
# 때문에 사람 눈에도, 테스트에도 안 걸리고 몇 달을 방치할 수 있다. 그래서
# CI 가 대신 잡아야 한다.
#
# 실제로 이 저장소의 훅 43개가 전부 `bash .claude/skills/<category>/<skill>/...`
# 형태였다. 이건 CWD 기준 상대경로라서 플러그인으로 설치된 환경에서는 존재하지
# 않는 경로다(이 저장소에는 `.claude/skills/` 디렉토리 자체가 없다). 그 결과
# 한 스킬의 Stage 4 승인 영수증 훅이 한 번도 실행되지 않은 채로
# "승인 게이트가 있다"고 문서화돼 있었다. 옛 검사기는 그 형태를 **규약으로 강제**
# 했으니 43개가 전부 통과했다.
#
# ── 올바른 형태 ────────────────────────────────────────────────────────
#   command: "bash \"${CLAUDE_PLUGIN_ROOT}/<skill>/scripts/<x>.sh\" <인자들>"
#
# - `${CLAUDE_PLUGIN_ROOT}` 는 **플러그인(= 카테고리) 설치 루트**다. 경로에
#   카테고리가 다시 들어가지 않는다. 실측:
#
#     ~/.claude/plugins/cache/aha-skills/meta-experts/<sha>/skill-author/scripts/check-deps.sh
#     └───────────────────── $CLAUDE_PLUGIN_ROOT ─────────────────────┘└──── 스킬 디렉토리 ────┘
#
# - 따옴표는 필수다. 설치 경로에 공백이 들어갈 수 있다.
# - `${CLAUDE_SKILL_DIR}` 는 훅에서 치환되지 않는다(SKILL.md 본문과
#   `allowed-tools` 에서만 치환된다). 훅에 쓰면 빈 문자열이 된다.
# - 스킬 프론트매터 훅에서 이 치환이 동작한다는 건 공식 문서에 없다. 근거는
#   Claude Code v2.1.220 바이너리의 문자열이다:
#     "but only ${CLAUDE_PLUGIN_ROOT} is available for skill hooks
#      (${CLAUDE_PLUGIN_DATA} is plugin-only)."
#
# ── 검사 내용 ──────────────────────────────────────────────────────────
# 1) 스킬 프론트매터의 모든 훅 `command` 에서 스크립트 경로 토큰을 뽑아
#    `${CLAUDE_PLUGIN_ROOT}/...` 형태인지, 그 파일이 실제로 있는지 확인한다.
#    인터프리터는 하드코딩하지 않는다 — 첫 토큰을 인터프리터로 보고, 그 뒤에서
#    처음 나오는 경로 같은 토큰을 검사한다(bash·uv run·python3·uvx 모두 커버).
# 2) 옛 `.claude/skills/...` 형태, 절대경로, `${CLAUDE_SKILL_DIR}`, 기타
#    상대경로는 거부한다.
# 3) marketplace.json 의 스킬 경로를 확인한다.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ERRORS=0
WARNINGS=0
CHECKED=0

echo "🔍 훅 경로 검증 시작..."
echo ""

# ── 1~2. 스킬 프론트매터 훅 경로 검증 ──────────────────────────────────
# skills/ 아래에 있어도 스킬이 아닌 것은 뺀다 (validate-matchers.sh 와 같은 규칙):
#   - *-workspace/  : 평가·벤치마크 산출물
#   - */assets/*    : 스킬이 자원으로 품고 있는 템플릿. placeholder 경로를 담고
#                     있어 실제 파일을 가리키지 않는 게 정상이다
echo "📁 SKILL.md 파일 검색..."

if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ 오류: 이 검사기에는 python3 가 필요합니다"
  exit 1
fi

hook_output=$(python3 - "$PROJECT_ROOT" <<'PY'
import os
import shlex
import sys

project_root = os.path.abspath(sys.argv[1])
skills_root = os.path.join(project_root, "skills")
skills_root_real = os.path.realpath(skills_root)

NEW_PREFIXES = ("${CLAUDE_PLUGIN_ROOT}/", "$CLAUDE_PLUGIN_ROOT/")
OLD_PREFIX = ".claude/skills/"


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


def frontmatter_lines(path):
    """--- 로 감싼 첫 블록만 돌려준다."""
    with open(path, "r", encoding="utf-8") as f:
        lines = f.read().splitlines()
    if not lines or lines[0].strip() != "---":
        return []
    out = []
    for line in lines[1:]:
        if line.strip() == "---":
            return out
        out.append(line)
    return []


def unquote_yaml_scalar(raw):
    """YAML 스칼라의 겉따옴표를 벗기고 이스케이프를 되돌린다."""
    raw = raw.strip()
    if len(raw) >= 2 and raw[0] == '"' and raw[-1] == '"':
        return raw[1:-1].replace('\\"', '"').replace("\\\\", "\\")
    if len(raw) >= 2 and raw[0] == "'" and raw[-1] == "'":
        return raw[1:-1].replace("''", "'")
    return raw


def script_token(cmd):
    """인터프리터 뒤에서 처음 나오는 '경로 같은' 토큰을 찾는다.

    인터프리터 목록을 하드코딩하지 않는다. 첫 토큰은 인터프리터로 보고 버리고,
    그다음부터 플래그(-x)를 건너뛰며 '/' 가 들어간 첫 토큰을 스크립트 경로로 본다.
    (`uv run <path> doctor`, `uvx --from x <path>`, `bash <path> --quiet-ok` 모두 커버)
    """
    try:
        tokens = shlex.split(cmd)
    except ValueError:
        return None, "PARSE"
    if not tokens:
        return None, "EMPTY"
    if "-c" in tokens[1:]:
        return None, "INLINE"
    for tok in tokens[1:]:
        if tok.startswith("-"):
            continue
        if "/" in tok:
            return tok, None
    return None, "NOPATH"


def is_quoted(cmd, token):
    """command 안에서 경로 토큰이 따옴표로 감싸져 있었는지 확인."""
    return ('"' + token) in cmd or ("'" + token) in cmd


def within_skills_root(path):
    real = os.path.realpath(path)
    return real == skills_root_real or real.startswith(skills_root_real + os.sep)


def categories_containing(name):
    if not os.path.isdir(skills_root):
        return []
    hits = []
    for category in sorted(os.listdir(skills_root)):
        if os.path.isdir(os.path.join(skills_root, category, name)):
            hits.append(category)
    return hits


skill_files = find_skill_files(skills_root)
if not skill_files:
    emit("FATAL", "SKILL.md 파일을 찾을 수 없음")
    emit("SUMMARY", 0, 1, 0)
    sys.exit(1)

checked = 0
errors = 0
warnings = 0

for skill_file in skill_files:
    rel_skill_file = os.path.relpath(skill_file, project_root)
    emit("FILE", rel_skill_file)

    fm = frontmatter_lines(skill_file)
    if not fm:
        emit("WARN_NO_FRONTMATTER", rel_skill_file)
        warnings += 1
        continue

    # 이 훅이 선언된 스킬이 속한 카테고리 = 런타임의 $CLAUDE_PLUGIN_ROOT 가 가리키는 플러그인
    rel_parts = os.path.relpath(os.path.dirname(skill_file), skills_root).split(os.sep)
    own_category = rel_parts[0] if rel_parts and rel_parts[0] not in (".", "") else ""

    commands = []
    for line in fm:
        stripped = line.strip()
        if not stripped.startswith("command:"):
            continue
        value = unquote_yaml_scalar(stripped[len("command:"):])
        if value:
            commands.append(value)

    if not commands:
        emit("INFO_NO_HOOK", rel_skill_file)
        continue

    for cmd in commands:
        token, why = script_token(cmd)
        if token is None:
            emit("INFO_SKIP", why or "UNKNOWN", cmd)
            continue

        checked += 1

        # 새 표준형: ${CLAUDE_PLUGIN_ROOT}/<skill>/...
        new_prefix = next((p for p in NEW_PREFIXES if token.startswith(p)), None)
        if new_prefix:
            rel = token[len(new_prefix):]
            if not is_quoted(cmd, token):
                emit("WARN_UNQUOTED", token, cmd)
                warnings += 1
            first_seg = rel.split("/")[0]
            cats = categories_containing(first_seg)

            if own_category and own_category in cats:
                resolved = os.path.join(skills_root, own_category, rel)
                if not within_skills_root(resolved):
                    emit("ERR_ESCAPE", token, os.path.realpath(resolved))
                    errors += 1
                elif os.path.isfile(resolved):
                    emit("OK", token)
                else:
                    emit("ERR_MISSING", token, os.path.relpath(resolved, project_root))
                    errors += 1
            elif not cats:
                emit("ERR_UNKNOWN_SKILL", token, first_seg, own_category)
                errors += 1
            elif len(cats) > 1:
                emit("ERR_AMBIGUOUS", token, first_seg, ", ".join(cats), own_category)
                errors += 1
            else:
                emit("ERR_CROSS_PLUGIN", token, first_seg, cats[0], own_category)
                errors += 1
            continue

        # 옛 형태: 조용히 실행되지 않는다 → 거부 + 마이그레이션 안내
        if token.startswith(OLD_PREFIX):
            rest = token[len(OLD_PREFIX):].split("/")
            suggestion = (
                '${CLAUDE_PLUGIN_ROOT}/' + "/".join(rest[1:])
                if len(rest) > 1 else '${CLAUDE_PLUGIN_ROOT}/<skill>/...'
            )
            emit("ERR_OLD_FORM", token, suggestion)
            errors += 1
            continue

        if "${CLAUDE_SKILL_DIR}" in token or "$CLAUDE_SKILL_DIR" in token:
            emit("ERR_SKILL_DIR", token)
            errors += 1
            continue

        if token.startswith("/"):
            emit("ERR_ABSOLUTE", token)
            errors += 1
            continue

        emit("ERR_NONSTANDARD", token)
        errors += 1

emit("SUMMARY", checked, errors, warnings)
sys.exit(0)
PY
) || true

hook_summary_found=0
while IFS=$'\t' read -r code f1 f2 f3 f4; do
  [ -z "$code" ] && continue
  case "$code" in
    FILE)
      echo ""
      echo "🔍 검증: $f1"
      ;;
    OK)
      echo "  ✅ $f1"
      ;;
    INFO_NO_HOOK)
      echo "  ℹ️  훅 경로 없음"
      ;;
    INFO_SKIP)
      case "$f1" in
        INLINE) echo "  ℹ️  인라인 명령(-c)은 검사 대상이 아님: $f2" ;;
        NOPATH) echo "  ℹ️  스크립트 경로 없는 훅: $f2" ;;
        PARSE)  echo "  ℹ️  명령을 토큰화할 수 없어 건너뜀: $f2" ;;
        *)      echo "  ℹ️  검사 건너뜀($f1): $f2" ;;
      esac
      ;;
    WARN_NO_FRONTMATTER)
      echo "  ⚠️  경고: YAML 프론트매터를 찾을 수 없음"
      ;;
    WARN_UNQUOTED)
      echo "  ⚠️  경고: 경로에 따옴표가 없음 - $f1"
      echo "      설치 경로에 공백이 있으면 깨집니다. command: \"bash \\\"\${CLAUDE_PLUGIN_ROOT}/...\\\"\" 형태로 감싸세요"
      ;;
    ERR_MISSING)
      echo "  ❌ 오류: 파일 없음 - $f1 (기대 위치: $f2)"
      ;;
    ERR_OLD_FORM)
      echo "  ❌ 오류: 옛 훅 경로 형태 - $f1"
      echo "      \`.claude/skills/...\` 는 CWD 상대경로여서 플러그인 설치 환경에서 해석되지 않고,"
      echo "      에러 없이 **조용히 실행되지 않습니다**. 아래 형태로 바꾸세요:"
      echo "        command: \"bash \\\"$f2\\\"\""
      echo "      (\$CLAUDE_PLUGIN_ROOT 는 카테고리 설치 루트입니다 — 경로에 카테고리를 다시 넣지 마세요)"
      ;;
    ERR_SKILL_DIR)
      echo "  ❌ 오류: \${CLAUDE_SKILL_DIR} 는 훅에서 치환되지 않음 - $f1"
      echo "      SKILL.md 본문·allowed-tools 전용입니다. 훅에서는 \${CLAUDE_PLUGIN_ROOT}/<skill>/... 를 쓰세요"
      ;;
    ERR_ABSOLUTE)
      echo "  ❌ 오류: 절대 경로 훅은 허용되지 않음 - $f1"
      ;;
    ERR_NONSTANDARD)
      echo "  ❌ 오류: \${CLAUDE_PLUGIN_ROOT} 로 시작하지 않는 훅 경로 - $f1"
      echo "      표준형: \"bash \\\"\${CLAUDE_PLUGIN_ROOT}/<skill>/scripts/<x>.sh\\\"\""
      ;;
    ERR_ESCAPE)
      echo "  ❌ 오류: skills 범위를 벗어난 훅 경로 - $f1 (실제 경로: $f2)"
      ;;
    ERR_UNKNOWN_SKILL)
      echo "  ❌ 오류: 존재하지 않는 스킬을 가리킴 - $f1"
      echo "      skills/*/$f2/ 가 없습니다. \$CLAUDE_PLUGIN_ROOT 다음에는 **카테고리가 아니라 스킬 이름**이 옵니다"
      echo "      (선언 스킬의 카테고리: ${f3:-<불명>})"
      ;;
    ERR_AMBIGUOUS)
      echo "  ❌ 오류: 스킬 이름이 여러 카테고리에 중복되어 경로를 확정할 수 없음 - $f1"
      echo "      '$f2' 가 있는 카테고리: $f3"
      echo "      선언 스킬은 '$f4' 카테고리에 있어 어느 것도 자기 플러그인이 아닙니다."
      echo "      훅은 자기 플러그인(= 자기 카테고리) 안의 경로만 가리킬 수 있습니다"
      ;;
    ERR_CROSS_PLUGIN)
      echo "  ❌ 오류: 다른 플러그인(카테고리)의 경로를 가리킴 - $f1"
      echo "      '$f2' 는 '$f3' 카테고리에 있고, 이 훅은 '$f4' 카테고리에서 선언됐습니다."
      echo "      \$CLAUDE_PLUGIN_ROOT 는 선언 스킬의 카테고리 루트라서 런타임에 해석되지 않습니다"
      ;;
    SUMMARY)
      CHECKED=$((CHECKED + f1))
      ERRORS=$((ERRORS + f2))
      WARNINGS=$((WARNINGS + f3))
      hook_summary_found=1
      ;;
    FATAL)
      echo "  ❌ 오류: $f1"
      ;;
    *)
      echo "  ⚠️  알 수 없는 검증 출력: $code"
      ;;
  esac
done <<< "$hook_output"

if [ "$hook_summary_found" -ne 1 ]; then
  echo ""
  echo "  ❌ 오류: 훅 경로 검증 결과 요약을 읽지 못함"
  ERRORS=$((ERRORS + 1))
fi

# ── 3. marketplace.json의 스킬 경로 검증 ───────────────────────────────
echo ""
echo "🔍 검증: marketplace.json 스킬 경로"

marketplace_file="$PROJECT_ROOT/.claude-plugin/marketplace.json"

if [ -f "$marketplace_file" ]; then
  validation_output=""
  validation_output=$(python3 - "$PROJECT_ROOT" "$marketplace_file" <<'PY'
import json
import os
import sys

project_root = os.path.abspath(sys.argv[1])
project_root_real = os.path.realpath(project_root)
marketplace_file = sys.argv[2]

try:
    with open(marketplace_file, "r", encoding="utf-8") as f:
        data = json.load(f)
except Exception as e:
    print(f"FATAL\tJSON 파싱 오류: {e}")
    print("SUMMARY\t0\t1")
    sys.exit(1)

plugins = data.get("plugins", [])
checked = 0
errors = 0
seen_skill_md = {}

if not isinstance(plugins, list):
    print("FATAL\tplugins는 배열이어야 합니다")
    print("SUMMARY\t0\t1")
    sys.exit(1)


def is_within(parent: str, child: str) -> bool:
    try:
        return os.path.commonpath([parent, child]) == parent
    except ValueError:
        return False


for plugin in plugins:
    if not isinstance(plugin, dict):
        errors += 1
        print(f"FATAL\tplugin 엔트리는 객체여야 합니다: {plugin!r}")
        continue

    plugin_name = str(plugin.get("name", "<unknown-plugin>"))
    source_raw = plugin.get("source")
    skills_raw = plugin.get("skills")

    if not isinstance(source_raw, str) or not source_raw.strip():
        errors += 1
        print(f"ERR_SOURCE_INVALID\t{plugin_name}\t{source_raw!r}")
        continue

    # strict 엔트리는 컴포넌트를 source 의 .claude-plugin/plugin.json 이 지정한다
    # (validate-marketplace.sh 의 strict 인식과 같은 규칙 — skills 가 없다고 오류 내지 않는다).
    if skills_raw is None and plugin.get("strict") is True:
        pj_source = source_raw[2:] if source_raw.startswith("./") else source_raw
        pj = os.path.join(project_root, pj_source, ".claude-plugin", "plugin.json")
        try:
            with open(pj, "r", encoding="utf-8") as f:
                skills_raw = json.load(f).get("skills")
        except Exception as e:
            errors += 1
            print(f"ERR_SKILLS_INVALID\t{plugin_name}\tstrict 엔트리의 plugin.json 읽기 실패 ({pj}): {e}")
            continue

    if not isinstance(skills_raw, list):
        errors += 1
        print(f"ERR_SKILLS_INVALID\t{plugin_name}\t{skills_raw!r}")
        continue

    source_rel = source_raw[2:] if source_raw.startswith("./") else source_raw
    source_abs = os.path.abspath(os.path.normpath(os.path.join(project_root, source_rel)))
    source_real = os.path.realpath(source_abs)

    if not is_within(project_root_real, source_real):
        errors += 1
        print(f"ERR_SOURCE_OUTSIDE\t{plugin_name}\t{source_raw}\t{source_real}")
        continue

    if not os.path.isdir(source_real):
        errors += 1
        print(f"ERR_SOURCE_MISSING\t{plugin_name}\t{source_raw}\t{source_real}")
        continue

    for skill_raw in skills_raw:
        checked += 1
        if not isinstance(skill_raw, str) or not skill_raw.strip():
            errors += 1
            print(f"ERR_SKILL_INVALID\t{plugin_name}\t{source_raw}\t{skill_raw!r}")
            continue
        skill_rel = skill_raw[2:] if skill_raw.startswith("./") else skill_raw
        skill_abs = os.path.abspath(os.path.normpath(os.path.join(source_real, skill_rel)))
        skill_real = os.path.realpath(skill_abs)

        if not is_within(source_real, skill_real):
            errors += 1
            print(f"ERR_SKILL_OUTSIDE\t{plugin_name}\t{source_raw}\t{skill_raw}\t{skill_real}")
            continue

        skill_md = os.path.join(skill_real, "SKILL.md")
        if not os.path.isfile(skill_md):
            errors += 1
            print(f"ERR_MISSING\t{plugin_name}\t{source_raw}\t{skill_raw}\t{skill_md}")
            continue

        canonical_skill_md = os.path.realpath(skill_md)
        if canonical_skill_md in seen_skill_md:
            errors += 1
            first_plugin, first_source, first_skill = seen_skill_md[canonical_skill_md]
            print(
                f"ERR_DUPLICATE\t{plugin_name}\t{source_raw}\t{skill_raw}\t{skill_md}\t"
                f"{first_plugin}\t{first_source}\t{first_skill}"
            )
            continue

        seen_skill_md[canonical_skill_md] = (plugin_name, source_raw, skill_raw)
        print(f"OK\t{plugin_name}\t{source_raw}\t{skill_raw}\t{skill_md}")

if checked == 0:
    print("INFO\tNO_SKILLS")

print(f"SUMMARY\t{checked}\t{errors}")
sys.exit(1 if errors else 0)
PY
) || true

  marketplace_checked=0
  marketplace_errors=0
  summary_found=0

  while IFS=$'\t' read -r code field1 field2 field3 field4 field5 field6 field7; do
    [ -z "$code" ] && continue

    case "$code" in
      OK)
        echo "  ✅ $field1: $field3 (source: $field2)"
        ;;
      ERR_MISSING)
        echo "  ❌ 오류: 스킬 경로 없음 - plugin=$field1, source=$field2, skill=$field3 (예상: $field4)"
        ;;
      ERR_DUPLICATE)
        echo "  ❌ 오류: 중복 스킬 참조 - plugin=$field1, source=$field2, skill=$field3 (기존: plugin=$field5, source=$field6, skill=$field7)"
        ;;
      ERR_SKILL_OUTSIDE)
        echo "  ❌ 오류: source 범위를 벗어난 skill 경로 - plugin=$field1, source=$field2, skill=$field3 (해석: $field4)"
        ;;
      ERR_SOURCE_OUTSIDE)
        echo "  ❌ 오류: 프로젝트 범위를 벗어난 source 경로 - plugin=$field1, source=$field2 (해석: $field3)"
        ;;
      ERR_SOURCE_MISSING)
        echo "  ❌ 오류: source 경로 없음 - plugin=$field1, source=$field2 (해석: $field3)"
        ;;
      ERR_SOURCE_INVALID)
        echo "  ❌ 오류: 잘못된 source 설정 - plugin=$field1, source=$field2"
        ;;
      ERR_SKILLS_INVALID)
        echo "  ❌ 오류: skills는 문자열 배열이어야 함 - plugin=$field1, skills=$field2"
        ;;
      ERR_SKILL_INVALID)
        echo "  ❌ 오류: 잘못된 skill 설정 - plugin=$field1, source=$field2, skill=$field3"
        ;;
      INFO)
        if [ "$field1" = "NO_SKILLS" ]; then
          echo "  ℹ️  marketplace.json에 스킬 경로 없음"
        fi
        ;;
      FATAL)
        echo "  ❌ 오류: $field1"
        ;;
      SUMMARY)
        marketplace_checked="$field1"
        marketplace_errors="$field2"
        summary_found=1
        ;;
      *)
        echo "  ⚠️  알 수 없는 검증 출력: $code"
        ;;
    esac
  done <<< "$validation_output"

  if [ "$summary_found" -eq 1 ]; then
    CHECKED=$((CHECKED + marketplace_checked))
    ERRORS=$((ERRORS + marketplace_errors))
  else
    echo "  ❌ 오류: marketplace.json 검증 결과 요약을 읽지 못함"
    ERRORS=$((ERRORS + 1))
  fi
else
  echo "  ⚠️  marketplace.json 파일 없음"
fi

# ── 4. 결과 요약 ───────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────"
echo "📊 검증 결과:"
echo "  검사 항목: $CHECKED"
echo "  경고 수: $WARNINGS"
echo "  오류 수: $ERRORS"
echo "────────────────────────────────────"

if [ $ERRORS -eq 0 ]; then
  echo "✅ 모든 훅 경로가 유효합니다"
  exit 0
else
  echo "❌ $ERRORS 개의 오류가 발견되었습니다"
  exit 1
fi
