#!/bin/bash
# YAML 프론트매터 형식을 검증합니다

set -euo pipefail

# 색상 출력
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 사용법
usage() {
    echo "Usage: $0 <skill-md-path>"
    echo "Example: $0 skills/meta-experts/skill-author/SKILL.md"
    exit 1
}

# 인자 확인
if [[ $# -eq 0 ]]; then
    usage
fi

SKILL_FILE="$1"

# 파일 확인
if [[ ! -f "$SKILL_FILE" ]]; then
    echo -e "${RED}❌ 오류: 파일을 찾을 수 없습니다: $SKILL_FILE${NC}"
    exit 1
fi

echo -e "${GREEN}🔍 프론트매터 검증 중: $SKILL_FILE${NC}"
echo ""

# 오류 수집
ERRORS=0

# 프론트매터 추출 (첫 번째 ---와 두 번째 --- 사이의 내용)
FRONTMATTER=$(awk '/^---$/ {if (++count == 2) exit; next} count == 1' "$SKILL_FILE")

# 프론트매터 존재 확인
if [[ -z "$FRONTMATTER" ]]; then
    echo -e "${RED}❌ 프론트매터를 찾을 수 없습니다${NC}"
    echo "   SKILL.md 상단에 ---로 감싸진 YAML 블록이 있어야 합니다"
    exit 1
fi

echo -e "${GREEN}✅ 프론트매터 발견${NC}"
echo ""

# 실제 YAML 파서로 유효성 확인.
#
# 왜 필요한가: 이 스크립트의 나머지 검사는 전부 정규식/awk 기반이라 "키가 있는가·값 형식이
# 맞는가"만 본다. 그래서 **YAML 문법 자체가 깨진 프론트매터가 통과해 왔다.** 실제로
# 2026-07-29 전수 점검에서 2개 스킬이 걸렸다 — `description` 값 안의 인용되지 않은
# `: `(콜론+공백) 때문에 YAML 이 그 지점을 중첩 매핑으로 해석해 파싱이 실패했다.
# (예: `description: ... 이 스킬을 쓴다: "방치된 노트북 찾아줘" ...`)
# 값에 `: `·`#`·선행 `[`·`{` 등이 들어가면 인용이 필요하다. 내부에 `"`와 백틱이 섞여 있으면
# 단일 인용(`'...'`, 내부 `'`는 `''`)이 안전하다.
#
# 파서를 어떻게 구하는가(2026-07-30 수정). 예전에는 `python3 -c 'import yaml'` 하나만 보고
# 실패하면 검사를 통째로 건너뛰었는데, CI 이미지에 PyYAML 이 없어서 **이 검사가 CI 에서 한
# 번도 돌지 않았다** — 정작 같은 브랜치의 assets/skill-template/SKILL.md 가 저장소에서 유일하게
# YAML 파싱에 실패하는 파일이었는데도 파이프라인은 초록이었다. 검사기가 조용히 통과하는 것은
# 검사기가 없는 것보다 나쁘다(있다고 믿게 되므로).
#
# 그래서 (1) uv 가 있으면 uv 로라도 파서를 구하고, (2) 그래도 없으면 CI 에서는 실패시킨다.
# 로컬에서는 종전대로 경고만 하고 넘어간다 — 파서가 없다고 개발자가 이 스크립트를 아예
# 못 쓰게 만들 이유는 없다.
YAML_RUNNER=""
if command -v python3 >/dev/null 2>&1 && python3 -c 'import yaml' >/dev/null 2>&1; then
    YAML_RUNNER="python3"
elif command -v uv >/dev/null 2>&1; then
    YAML_RUNNER="uv run --quiet --with pyyaml python3"
fi

if [ -n "$YAML_RUNNER" ]; then
    # 단어 분리를 의도한다(uv 형태는 여러 토큰이다).
    # shellcheck disable=SC2086
    yaml_err="$(printf '%s\n' "$FRONTMATTER" | $YAML_RUNNER -c '
import sys, yaml
try:
    d = yaml.safe_load(sys.stdin.read())
except Exception as e:
    m = getattr(e, "problem_mark", None)
    where = f"{m.line + 1}행 {m.column}열 부근: " if m else ""
    print(where + str(e).splitlines()[0])
    sys.exit(1)
if not isinstance(d, dict):
    print("프론트매터가 키-값 매핑이 아닙니다 (파싱 결과: %s)" % type(d).__name__)
    sys.exit(1)
' 2>&1)" && {
        echo -e "${GREEN}✅ YAML 파싱 유효${NC}"
    } || {
        echo -e "${RED}❌ YAML 파싱 실패: ${yaml_err}${NC}"
        echo "   값에 콜론+공백(': ')이 있으면 인용이 필요합니다 — 예: description: '...쓴다: \"...\"...'"
        ERRORS=$((ERRORS + 1))
    }
    echo ""
elif [ -n "${CI:-}" ]; then
    # CI 에서는 건너뛰지 않는다 — 여기서 조용히 넘어가면 이 검사는 존재하지 않는 것과 같다.
    echo -e "${RED}❌ YAML 파서를 구할 수 없습니다 (python3+PyYAML 도 uv 도 없음)${NC}"
    echo "   CI 에서는 이 검사를 건너뛰지 않습니다. 잡의 before_script 에서 uv 를 설치하세요."
    ERRORS=$((ERRORS + 1))
    echo ""
else
    echo -e "${YELLOW}⚠️  PyYAML·uv 없음 — YAML 파싱 검사를 건너뜁니다(로컬 한정)${NC}"
    echo "   CI 에서는 이 경로가 실패로 처리됩니다. 로컬에서도 검사하려면: uv 설치 또는 pip install pyyaml"
    echo ""
fi

# 필수 필드 확인
echo "📋 필수 필드 확인..."

REQUIRED_FIELDS=(
    "name:"
    "description:"
    "version:"
    "context:"
    "language:"
)

for field in "${REQUIRED_FIELDS[@]}"; do
    if echo "$FRONTMATTER" | grep -q "^${field}"; then
        value=$(echo "$FRONTMATTER" | grep "^${field}" | sed "s/${field} //")
        echo -e "  ${GREEN}✅ $field${NC} $value"
    else
        echo -e "  ${RED}❌ $field (필수 필드 누락)${NC}"
        ERRORS=$((ERRORS + 1))
    fi
done

echo ""

# 선택적 필드 확인
echo "📋 선택적 필드 확인..."

OPTIONAL_FIELDS=(
    "dependencies:"
)

for field in "${OPTIONAL_FIELDS[@]}"; do
    if echo "$FRONTMATTER" | grep -q "^${field}"; then
        value=$(echo "$FRONTMATTER" | grep "^${field}" | sed "s/${field} //")
        echo -e "  ${GREEN}✅ $field${NC} $value"
    else
        echo -e "  ${YELLOW}⚠️  $field (없음, 선택적)${NC}"
    fi
done

echo ""

# 필드 값 검증
echo "🔍 필드 값 검증..."

# name: kebab-case 확인
if echo "$FRONTMATTER" | grep -q "^name:"; then
    name_value=$(echo "$FRONTMATTER" | grep "^name:" | sed 's/name: //' | tr -d '"')
    if [[ "$name_value" =~ ^[a-z0-9-]+$ ]]; then
        echo -e "  ${GREEN}✅ name: 올바른 kebab-case 형식${NC}"
    else
        echo -e "  ${RED}❌ name: 소문자와 하이픈만 사용해야 합니다${NC}"
        ERRORS=$((ERRORS + 1))
    fi
fi

# version: 시맨틱 버전 확인
if echo "$FRONTMATTER" | grep -q "^version:"; then
    version_value=$(echo "$FRONTMATTER" | grep "^version:" | sed 's/version: //' | tr -d '"')
    if [[ "$version_value" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo -e "  ${GREEN}✅ version: 올바른 시맨틱 버전 형식${NC}"
    else
        echo -e "  ${RED}❌ version: MAJOR.MINOR.PATCH 형식이어야 합니다${NC}"
        ERRORS=$((ERRORS + 1))
    fi
fi

# context: 유효한 값 확인
if echo "$FRONTMATTER" | grep -q "^context:"; then
    context_value=$(echo "$FRONTMATTER" | grep "^context:" | sed 's/context: //' | tr -d '"')
    if [[ "$context_value" =~ ^(fork|inline)$ ]]; then
        echo -e "  ${GREEN}✅ context: 올바른 값${NC}"
    else
        echo -e "  ${RED}❌ context: 'fork' 또는 'inline'이어야 합니다${NC}"
        ERRORS=$((ERRORS + 1))
    fi
fi

# agent: context: fork일 때만 필수 (fork 서브에이전트를 실행할 agent 유형을 결정하는 필드라
# inline에서는 의미가 없다 — docs/frontmatter-reference.md 참고)
if echo "$FRONTMATTER" | grep -q "^agent:"; then
    echo -e "  ${GREEN}✅ agent:${NC} $(echo "$FRONTMATTER" | grep "^agent:" | sed 's/agent: //')"
elif [[ "${context_value:-}" == "fork" ]]; then
    echo -e "  ${RED}❌ agent: (context: fork에서 필수 필드 누락)${NC}"
    ERRORS=$((ERRORS + 1))
else
    echo -e "  ${YELLOW}⚠️  agent: (없음, context: inline에서는 선택적)${NC}"
fi

# description: 길이(공식 한도 1024자) + when-to-use 트리거 검증
if echo "$FRONTMATTER" | grep -q "^description:"; then
    desc_raw=$(echo "$FRONTMATTER" | grep "^description:" | sed 's/^description: *//' | sed 's/^['\''"]//; s/['\''"]$//')
    if [[ "$desc_raw" =~ ^[\>\|] ]]; then
        # YAML 블록 스칼라 (>-, >, |-, |): 들여쓰기된 연속 줄을 이어붙인다
        desc_value=$(echo "$FRONTMATTER" | awk '
            /^description:/ { found=1; next }
            found && /^[[:space:]]*$/ { printf " "; next }
            found && /^  /            { sub(/^  /, ""); printf "%s ", $0; next }
            found                     { exit }
        ' | sed 's/  */ /g; s/ $//')
    else
        desc_value="$desc_raw"
    fi

    # 글자 수는 UTF-8 코드포인트 기준으로 센다 (로케일 비의존).
    # tr로 continuation 바이트(0x80-0xBF)를 지운 뒤 남은 lead 바이트 수 = 코드포인트 수.
    desc_length=$(printf '%s' "$desc_value" | LC_ALL=C tr -d '\200-\277' | LC_ALL=C wc -c | tr -d ' ')

    # 1) 하드캡: 1024자 초과는 error (픽스처 포함 모든 파일에 적용)
    if [[ "$desc_length" -gt 1024 ]]; then
        echo -e "  ${RED}❌ description: ${desc_length}자 (공식 한도 1024자 초과)${NC}"
        ERRORS=$((ERRORS + 1))
    else
        echo -e "  ${GREEN}✅ description: 길이 ${desc_length}자 (≤1024)${NC}"
    fi

    # 2) when-to-use 트리거 검증 (워크스페이스 스냅샷/픽스처 경로는 제외)
    if [[ "$SKILL_FILE" =~ (workspace|/snapshots/|skill-snapshot|/iter[0-9]+) ]]; then
        echo -e "  ${YELLOW}⚠️  description 트리거 검사 건너뜀 (픽스처/스냅샷 경로)${NC}"
    elif printf '%s' "$desc_value" | grep -qiE "할 때|일 때|쓸 때|필요할 때|없을 때|때 사용|요청 시|요청할 때|호출 시|호출 시점|트리거|when[- ]to[- ]use|use when|trigger"; then
        echo -e "  ${GREEN}✅ description: when-to-use 트리거 포함${NC}"
    else
        echo -e "  ${RED}❌ description: 'when-to-use' 트리거가 없습니다 (예: '~할 때 사용', 슬래시 커맨드/요청 트리거)${NC}"
        ERRORS=$((ERRORS + 1))
    fi
fi

echo ""

# 훅 확인
if echo "$FRONTMATTER" | grep -q "^hooks:"; then
    echo "🔗 훅 확인..."
    echo -e "  ${GREEN}✅ hooks: 정의됨${NC}"

    # 훅 타입 확인 (표시 전용 — 이벤트 이름의 권위 검증은 validate-matchers.sh)
    hook_types=$(echo "$FRONTMATTER" | grep -E "^[[:space:]]*(PreToolUse|PostToolUse):" || true)
    if [[ -n "$hook_types" ]]; then
        echo "  정의된 훅 타입:"
        echo "$hook_types" | while read -r line; do
            echo -e "    ${GREEN}✅${NC} $line"
        done
    fi
else
    echo "ℹ️  훅이 정의되지 않음 (선택적)"
fi

echo ""
echo "═════════════════════════════════════════════"

# 결과
if [[ $ERRORS -eq 0 ]]; then
    echo -e "${GREEN}✅ 프론트매터 검증 통과!${NC}"
    exit 0
else
    echo -e "${RED}❌ 검증 실패: $ERRORS 개의 오류가 발견되었습니다${NC}"
    exit 1
fi
