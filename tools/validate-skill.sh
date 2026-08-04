#!/bin/bash
# 스킬 구조 및 필수 파일을 검증합니다

set -euo pipefail

# 색상 출력
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 사용법
usage() {
    echo "Usage: $0 <skill-path>"
    echo "Example: $0 skills/gitlab-experts/gitlab-ci-pipeline-doctor"
    exit 1
}

# 인자 확인
if [[ $# -eq 0 ]]; then
    usage
fi

SKILL_PATH="$1"

# 스킬 경로 확인
if [[ ! -d "$SKILL_PATH" ]]; then
    echo -e "${RED}❌ 오류: 스킬 디렉토리를 찾을 수 없습니다: $SKILL_PATH${NC}"
    exit 1
fi

# shellcheck 설치 확인 및 설치
ensure_shellcheck() {
    if command -v shellcheck &> /dev/null; then
        return 0
    fi

    echo -e "${YELLOW}📦 shellcheck가 설치되어 있지 않습니다. 설치를 시작합니다...${NC}"

    # CI 환경 또는 Linux - binary 직접 다운로드
    if [[ "${CI:-}" == "true" ]] || [[ "$(uname)" == "Linux" ]]; then
        echo -e "${BLUE}📥 shellcheck binary를 다운로드합니다...${NC}"

        # 아키텍처 감지
        case "$(uname -m)" in
            x86_64) arch="x86_64" ;;
            aarch64|arm64) arch="aarch64" ;;
            *)
                echo -e "${RED}❌ 지원하지 않는 아키텍처: $(uname -m)${NC}"
                exit 1
                ;;
        esac

        # tmpdir 생성 및 다운로드
        tmpdir=$(mktemp -d)
        trap "rm -rf $tmpdir" EXIT

        # binary 다운로드 (stable 버전)
        scversion="stable"
        url="https://github.com/koalaman/shellcheck/releases/download/${scversion}/shellcheck-${scversion}.linux.${arch}.tar.xz"

        if curl -fsSL "${url}" | tar -xJ -C "${tmpdir}"; then
            mv "${tmpdir}/shellcheck-${scversion}/shellcheck" /usr/local/bin/
            chmod +x /usr/local/bin/shellcheck
            echo -e "${GREEN}✅ shellcheck 설치 완료 (binary, ${arch})${NC}"
            return 0
        else
            echo -e "${RED}❌ shellcheck 다운로드 실패: ${url}${NC}"
            exit 1
        fi
    fi

    # macOS (Homebrew)
    if command -v brew &> /dev/null; then
        brew install shellcheck
        echo -e "${GREEN}✅ shellcheck 설치 완료 (brew)${NC}"
        return 0
    fi

    echo -e "${RED}❌ shellcheck를 설치할 수 없습니다${NC}"
    exit 1
}

echo -e "${GREEN}🔍 검증 중: $SKILL_PATH${NC}"
echo ""

# 오류 수집
ERRORS=0
WARNINGS=0

# shellcheck 설치 확인 (스크립트가 있을 경우만)
if [[ -d "$SKILL_PATH/scripts" ]]; then
    ensure_shellcheck
fi

# 필수 파일 확인
echo "📁 필수 파일 확인..."

# SKILL.md와 README.md는 반드시 root에 있어야 함
REQUIRED_ROOT_FILES=("SKILL.md" "README.md")
for file in "${REQUIRED_ROOT_FILES[@]}"; do
    if [[ -f "$SKILL_PATH/$file" ]]; then
        echo -e "  ${GREEN}✅ $file${NC}"
    else
        echo -e "  ${RED}❌ $file (필수 파일 누락)${NC}"
        ERRORS=$((ERRORS + 1))
    fi
done

# GUIDELINES.md는 root 또는 docs/ 폴더에 있어야 함
if [[ -f "$SKILL_PATH/GUIDELINES.md" ]]; then
    echo -e "  ${GREEN}✅ GUIDELINES.md${NC}"
elif [[ -f "$SKILL_PATH/docs/GUIDELINES.md" ]]; then
    echo -e "  ${GREEN}✅ docs/GUIDELINES.md${NC}"
else
    echo -e "  ${RED}❌ GUIDELINES.md (필수 파일 누락 - root 또는 docs/ 폴더에 있어야 함)${NC}"
    ERRORS=$((ERRORS + 1))
fi

# scripts/가 있으면 테스트 러너가 있어야 함 (CLAUDE.md "테스트 규칙")
#
# 예전엔 경고였다 — 규칙은 "새 스킬"을 대상으로 하는데 기존 스킬 3개가 못 지키고 있었기
# 때문이다. 그 3개(confluence-publish, analyze-emr-cost-surge-root-cause,
# analyze-spark-resources)에 러너가 생겨서 실패로 승격했다.
#
# run-all-tests.sh 가 찾는 경로가 정확히 이것뿐이라, 러너가 없으면 테스트 파일이 아무리
# 많아도 CI 에서 한 번도 실행되지 않는다. confluence-publish 가 실제로 그 상태였다 —
# 테스트 9개가 전부 통과하는데 아무도 돌리지 않고 있었다.
if [[ -d "$SKILL_PATH/scripts" ]]; then
    if [[ -f "$SKILL_PATH/scripts/tests/run.sh" ]]; then
        echo -e "  ${GREEN}✅ scripts/tests/run.sh${NC}"
    else
        echo -e "  ${RED}❌ scripts/tests/run.sh (없음 — scripts/가 있으면 필수. 없으면 CI가 테스트를 발견하지 못한다)${NC}"
        ERRORS=$((ERRORS + 1))
    fi
fi

# 게이트+워커 스킬: SKILL.md가 WORKER.md를 참조하면 그 파일이 실재해야 한다.
# 참조만 있고 파일이 없으면 워커가 빈 프롬프트로 뜬다.
if [[ -f "$SKILL_PATH/SKILL.md" ]] && grep -q "WORKER\.md" "$SKILL_PATH/SKILL.md"; then
    if [[ -f "$SKILL_PATH/WORKER.md" ]]; then
        echo -e "  ${GREEN}✅ WORKER.md (게이트가 참조함)${NC}"
    else
        echo -e "  ${RED}❌ WORKER.md (SKILL.md가 참조하는데 파일이 없음)${NC}"
        ERRORS=$((ERRORS + 1))
    fi
fi

echo ""

# 서브에이전트로 넘어가는 본문에 AskUserQuestion "지시"가 있으면 실행되지 않는다.
# 모든 서브에이전트에서 이 도구가 제거되므로, 지시를 적어두면 조용히 무시된다.
#
# 판정 규칙: 도구 이름 뒤에 "~할 수 없"이 **직접 붙은** 문장은 지시가 아니라 경고문이므로
# 통과시킨다. 그 외의 등장은 지시로 본다.
#
# 이 규칙에 이르기까지 두 번 틀렸다.
#   1차: 줄 안에 '없|못|불가'가 있으면 통과 → "티어 구분 없이", "name 이 없으면" 같은
#        무관한 '없'에 걸려 진짜 위반 2건을 놓쳤다.
#   2차: 토큰 자체를 전면 금지 → 벤치마크에서 서로 다른 3개 실행이 전부 걸렸는데
#        세 문장 다 "fork 스킬은 이 도구를 쓸 수 없다"는 **올바른 경고**였다.
# 부정을 토큰에 결합시킨 아래 패턴은 알려진 위반 4건·경고 4건을 8/8 정확히 갈라낸다.
#
# 대상 선정:
#   - fork 스킬 → SKILL.md 전체와 딸린 문서 전부(게이트가 없으므로 정당한 용례가 없다)
#   - 게이트+워커 스킬 → WORKER.md 만(docs/ 는 게이트 동작도 설명하므로 정당하다)
#   - inline 전용 스킬 → 대상 아님(그 도구를 실제로 쓸 수 있다)
# CHANGELOG 는 과거 이력 서술이므로 언제나 제외한다.
#
# 이 정규식은 원래 POSIX bracket expression으로 한글 범위(가-힣)를 썼는데,
# GNU grep이 로케일과 무관하게 "Invalid collation character"로 죽는 경우가
# 있었다(2026-08-01 CI — LC_ALL=C.UTF-8을 명시해도 재현됐다). 아래 `|| true`가
# 이 에러(exit 2)까지 "위반 없음"(exit 1)과 똑같이 삼켜버려 검증기가 조용히
# 아무것도 못 잡는 상태가 될 위험까지 있어, 로케일에 기대는 대신 PCRE(-P)의
# 유니코드 스크립트 속성 `\p{Hangul}`로 바꿨다 — 시스템 로케일이 아니라 PCRE에
# 내장된 유니코드 테이블을 쓰므로 collation 문제 자체가 생기지 않는다.
#
# 다만 macOS 기본 BSD grep은 -P 자체를 지원하지 않는다(원래의 -E 범위 표현은
# BSD grep에서는 로케일과 무관하게 문제없이 동작함을 확인했다) — 그래서 -P 지원
# 여부를 감지해 지원하면 PCRE 패턴을, 아니면 원래의 -E 패턴을 쓰도록 분기한다.
if grep --help 2>&1 | grep -q -- '-P'; then
    AUQ_GREP_FLAGS="-vP"
    AUQ_WARNING_RE='(*UTF8)AskUserQuestion[^\p{Hangul}]*(을|를|은|는)? *[^.]{0,20}(쓸|사용할|호출할|부를|이용할) 수 없'
else
    AUQ_GREP_FLAGS="-vE"
    AUQ_WARNING_RE='AskUserQuestion[^가-힣]*(을|를|은|는)? *[^.]{0,20}(쓸|사용할|호출할|부를|이용할) 수 없'
fi
echo "🔒 서브에이전트 도구 제약 확인..."
subagent_bodies=()
if [[ -f "$SKILL_PATH/WORKER.md" ]]; then
    subagent_bodies+=("$SKILL_PATH/WORKER.md")
elif [[ -f "$SKILL_PATH/SKILL.md" ]] && grep -q "^context: *fork" "$SKILL_PATH/SKILL.md"; then
    subagent_bodies+=("$SKILL_PATH/SKILL.md")
    while IFS= read -r doc; do
        [[ -n "$doc" ]] && subagent_bodies+=("$doc")
    done < <(find "$SKILL_PATH" -maxdepth 2 \
        \( -name "README.md" -o -path "*/docs/*.md" -o -path "*/references/*.md" \) \
        -type f ! -iname "CHANGELOG.md" | sort)
fi

if [[ ${#subagent_bodies[@]} -eq 0 ]]; then
    echo -e "  ${GREEN}✅ 해당 없음 (서브에이전트로 넘어가는 본문 없음)${NC}"
else
    auq_found=0
    for body in "${subagent_bodies[@]}"; do
        # exit 1(매치 없음 = 위반 없음)만 정상으로 다루고, 그 외 종료 코드는
        # 진짜 실행 오류(파일을 못 읽음, 정규식이 이 grep에서 거부됨 등)이므로
        # "위반 없음"과 똑같이 삼키지 않고 표면화한다(2026-08-01 GitLab 리뷰 지적).
        # pipefail이 켜져 있어 이 대입문 자체의 종료 코드가 두 번째 grep의 종료
        # 코드를 그대로 반영한다 — PIPESTATUS를 따로 쓸 필요가 없다.
        if offenders=$(grep -n "AskUserQuestion" "$body" | grep "$AUQ_GREP_FLAGS" "$AUQ_WARNING_RE"); then
            grep_rc=0
        else
            grep_rc=$?
        fi
        if [[ $grep_rc -gt 1 ]]; then
            echo -e "  ${RED}❌ $(basename "$body"): AskUserQuestion 검사용 grep이 실행 오류(exit $grep_rc)로 실패했습니다 — 파일/정규식을 확인하세요${NC}"
            auq_found=1
            ERRORS=$((ERRORS + 1))
            continue
        fi
        if [[ -n "$offenders" ]]; then
            echo -e "  ${RED}❌ $(basename "$body"): AskUserQuestion 지시 (서브에이전트에는 이 도구가 없습니다)${NC}"
            while IFS= read -r line; do
                [[ -n "$line" ]] && echo -e "     ${YELLOW}${line%%:*}행: ${line#*:}${NC}"
            done <<< "$offenders"
            echo -e "     ${YELLOW}→ PENDING_DECISION/NEEDS_DECISION 반환-재개 패턴을 쓰세요${NC}"
            auq_found=1
            ERRORS=$((ERRORS + 1))
        fi
    done
    if [[ $auq_found -eq 0 ]]; then
        echo -e "  ${GREEN}✅ AskUserQuestion 지시 없음${NC}"
    fi
fi

echo ""

# PENDING_DECISION 반환에 오케스트레이터용 relay 지시문이 있는지 확인 (ERROR).
#
# 표준(docs/frontmatter-reference.md#fork-스킬에서-사용자-확인받기)은 `PENDING_DECISION:`을
# 단독 줄로 두고 바로 다음 줄에 고정 relay 지시문("오케스트레이터 지시")을 넣도록 한다.
# 2026-07-29 WARNING → ERROR 로 승격했다. 승격 조건이던 relay 대상 3개
# (java-spring-refactor / confluence-publish / de-publish)가 모두 마이그레이션됐고,
# PENDING_DECISION 을 언급하는 스킬 7개 전부가 이 검사를 통과하는 것을 확인했다.
# (그중 3개는 inline 으로 전환돼 방출 자체가 없고 산문 인용만 남았다.)
#
# 이 검사가 잡지 못하는 것 (중요): relay 지시문의 유무만 본다. 그 게이트가 **지키는 동작이
# 비가역·외부 공개인지**는 보지 않는다 — 그런 스킬은 애초에 fork 가 아니라 context: inline
# 이어야 하고(판정표 3행), relay 지시문을 붙이는 건 잘못된 방향으로 한 걸음 더 가는 것이다.
# 2026-07-29 등급 재산정에서 대상 7개 중 3개가 이 경우로 판정돼 inline 전환 대상이 됐다.
#
# 선행 조건이던 A등급 3건은 모두 inline 전환으로 해소됐다 — gitlab-mr-reviews(v2.0.0),
# usermanager(v2.0.0), analyze-spark-resources(v2.0.0). 셋 다 PENDING_DECISION 을 더 이상
# 방출하지 않으므로 이 검사의 대상 자체가 아니다(산문 인용만 남았다). analyze-spark-resources
# 는 push·MR 생성을 scripts/create-spark-mr.sh 단일 진입점으로 모으면서 위임 보류 문제도
# 함께 정리했다 — 예전 주석은 그 전 상태를 서술하고 있었다(2026-07-30 정정).
# 등급표와 판정 근거: docs/todo/pending-decision-relay-directive-rollout.md
echo "🔄 PENDING_DECISION 오케스트레이터 relay 지시문 확인 (ERROR)..."
RELAY_MARKER="오케스트레이터 지시"
if [[ -f "$SKILL_PATH/SKILL.md" ]] && grep -q "PENDING_DECISION" "$SKILL_PATH/SKILL.md"; then
    relay_warn=0
    # `grep -n`의 "줄번호:내용"을 `IFS=: read -r lineno content`로 분리하면, 내용이
    # 콜론으로 끝날 때(`PENDING_DECISION:`처럼) read가 마지막 필드의 트레일링 콜론을
    # 통째로 삼켜버려 content에서 콜론이 사라진다(실제로 확인된 버그) — 그래서 아래
    # 정규식들이 전부 무력화된다. 첫 콜론만 기준으로 파라미터 확장으로 나눠 원본을 보존한다.
    while IFS= read -r line; do
        lineno="${line%%:*}"
        content="${line#*:}"
        # 인라인 코드 인용(`PENDING_DECISION:` 형태로 콜론 바로 뒤에 닫는 백틱)은 실제 방출
        # 지점이 아니라 산문에서 규칙을 설명하는 인용이므로 검사 대상에서 제외한다.
        # (예: SKILL.md 선언부 "...에서는 `PENDING_DECISION:`을 단독 줄로 반환한 뒤...")
        if [[ "$content" == *'PENDING_DECISION:`'* ]]; then
            continue
        fi
        # 토큰이 단독 줄인 경우만 "실제 방출 지점" 후보로 본다 (콜론 뒤 공백만 허용)
        if [[ "$content" =~ ^[[:space:]]*PENDING_DECISION:[[:space:]]*$ ]]; then
            next_line=$(sed -n "$((lineno+1))p" "$SKILL_PATH/SKILL.md")
            if [[ "$next_line" != *"$RELAY_MARKER"* ]]; then
                echo -e "  ${RED}❌ SKILL.md:${lineno}행 PENDING_DECISION 다음 줄에 relay 지시문이 없습니다${NC}"
                relay_warn=1
                ERRORS=$((ERRORS + 1))
            fi
        # 토큰+질문이 같은 줄(구식 한 줄형)
        elif [[ "$content" =~ PENDING_DECISION:[[:space:]]*[^[:space:]] ]]; then
            echo -e "  ${RED}❌ SKILL.md:${lineno}행 구식 한 줄형 PENDING_DECISION — 토큰 단독 줄 + relay 지시문 표준으로 마이그레이션 필요${NC}"
            relay_warn=1
            ERRORS=$((ERRORS + 1))
        fi
    done < <(grep -n "PENDING_DECISION" "$SKILL_PATH/SKILL.md")
    if [[ $relay_warn -eq 0 ]]; then
        echo -e "  ${GREEN}✅ 모든 PENDING_DECISION이 relay 지시문 표준을 따름${NC}"
    fi
else
    echo "  ℹ️  PENDING_DECISION 없음 (해당 없음)"
fi

echo ""

# SKILL.md 프론트매터 확인
if [[ -f "$SKILL_PATH/SKILL.md" ]]; then
    echo "📄 SKILL.md 프론트매터 확인..."

    # 프론트매터 시작 확인
    if grep -q "^---$" "$SKILL_PATH/SKILL.md"; then
        echo -e "  ${GREEN}✅ 프론트매터 시작 (---)${NC}"
    else
        echo -e "  ${RED}❌ 프론트매터 시작 (---)을 찾을 수 없습니다${NC}"
        ERRORS=$((ERRORS + 1))
    fi

    # 필수 필드 확인
    REQUIRED_FIELDS=("name:" "description:" "version:" "context:")
    for field in "${REQUIRED_FIELDS[@]}"; do
        if grep -q "^${field}" "$SKILL_PATH/SKILL.md"; then
            echo -e "  ${GREEN}✅ $field${NC}"
        else
            echo -e "  ${RED}❌ $field (필수 필드 누락)${NC}"
            ERRORS=$((ERRORS + 1))
        fi
    done

    # agent: context: fork일 때만 필수 (inline에서는 의미 없는 필드 — docs/frontmatter-reference.md 참고)
    skill_context_value=$(grep "^context:" "$SKILL_PATH/SKILL.md" | head -1 | sed 's/context: //' | tr -d '"')
    if grep -q "^agent:" "$SKILL_PATH/SKILL.md"; then
        echo -e "  ${GREEN}✅ agent:${NC}"
    elif [[ "$skill_context_value" == "fork" ]]; then
        echo -e "  ${RED}❌ agent: (context: fork에서 필수 필드 누락)${NC}"
        ERRORS=$((ERRORS + 1))
    else
        echo -e "  ${YELLOW}⚠️  agent: (없음, context: inline에서는 선택적)${NC}"
    fi

    # language 필드 확인 (필수)
    if grep -q "^language:" "$SKILL_PATH/SKILL.md"; then
        echo -e "  ${GREEN}✅ language: (필수)${NC}"
    else
        echo -e "  ${RED}❌ language: (필수 필드 누락)${NC}"
        ERRORS=$((ERRORS + 1))
    fi

    # hooks 확인 (강력 권장)
    if grep -q "^hooks:" "$SKILL_PATH/SKILL.md"; then
        echo -e "  ${GREEN}✅ hooks: (강력 권장)${NC}"

        # 훅 경로 검사 (간이). 권위 있는 검사는 tools/validate-hook-paths.sh 이고 CI 가 그걸
        # 돌린다 — 여기서는 옛 규약이 남았는지만 빠르게 본다.
        #
        # 2026-07-29 규약이 뒤집혔다: 옛 `bash .claude/skills/<category>/<skill>/...` 는
        # **실행 시점 작업 디렉토리 기준 상대경로**라 플러그인 설치에서 해석되지 않고,
        # 훅이 조용히 실행되지 않았다(PreToolUse 는 exit 2 만 차단이라 아무도 눈치채지 못한다).
        # 새 규약은 `bash "${CLAUDE_PLUGIN_ROOT}/<skill>/scripts/<x>.sh"` — 이 변수는
        # 플러그인(=카테고리) 루트를 가리키므로 경로에 카테고리가 들어가지 않는다.
        #
        # 예전 구현은 `grep -A 10 "hooks:"` 로 훅을 찾았는데, 훅이 7개인 스킬은 절반도
        # 보지 못했다(창이 10줄). 프론트매터 전체에서 찾는다.
        echo "  🔍 훅 경로 검사..."
        hook_fm=$(awk '/^---$/ {if (++c == 2) exit; next} c == 1' "$SKILL_PATH/SKILL.md")
        hook_bad=0
        while IFS= read -r cmd; do
            [[ -z "$cmd" ]] && continue
            if [[ "$cmd" == *'.claude/skills/'* ]]; then
                echo -e "    ${RED}❌ $cmd${NC}"
                echo -e "       ${RED}→ 옛 규약(CWD 상대경로)입니다. 플러그인 설치에서 실행되지 않습니다.${NC}"
                echo -e "       ${RED}→ bash \"\${CLAUDE_PLUGIN_ROOT}/<skill>/scripts/<x>.sh\" 형태로 바꾸세요(카테고리 제외).${NC}"
                hook_bad=1
                ERRORS=$((ERRORS + 1))
            elif [[ "$cmd" == *'CLAUDE_PLUGIN_ROOT'* ]]; then
                echo -e "    ${GREEN}✅ $cmd${NC}"
            else
                echo -e "    ${YELLOW}⚠️  $cmd (경로 규약을 판단할 수 없음 — validate-hook-paths.sh 로 확인)${NC}"
                WARNINGS=$((WARNINGS + 1))
            fi
        done <<< "$(printf '%s\n' "$hook_fm" | grep -E '^\s*command:' | sed -E 's/^[[:space:]]*command:[[:space:]]*//')"
        if [[ $hook_bad -eq 0 ]]; then
            :
        fi
    else
        echo -e "  ${YELLOW}⚠️  hooks: 정의되지 않음 (강력 권장)${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  SKILL.md이 없어서 프론트매터 확인을 건너뜁니다${NC}"
fi

echo ""

# 선택적 파일 확인
echo "📁 선택적 파일 확인..."

OPTIONAL_FILES=("REFERENCE.md" "TROUBLESHOOTING.md")
for file in "${OPTIONAL_FILES[@]}"; do
    if [[ -f "$SKILL_PATH/$file" ]]; then
        echo -e "  ${GREEN}✅ $file (존재)${NC}"
    elif [[ -f "$SKILL_PATH/docs/$file" ]]; then
        echo -e "  ${GREEN}✅ docs/$file (존재)${NC}"
    else
        echo -e "  ${YELLOW}⚠️  $file (없음, 선택적)${NC}"
    fi
done

echo ""

# scripts 디렉토리 확인
if [[ -d "$SKILL_PATH/scripts" ]]; then
    echo "📜 scripts 디렉토리 확인..."

    script_count=$(find "$SKILL_PATH/scripts" -name "*.sh" -type f | wc -l | xargs)
    echo "  📊 스크립트 수: $script_count"

    shellcheck_errors=0

    # 각 스크립트 검사
    for script in "$SKILL_PATH/scripts"/*.sh; do
        if [[ -f "$script" ]]; then
            script_name=$(basename "$script")
            script_base="    $script_name"

            # 실행 권한 확인
            if [[ -x "$script" ]]; then
                echo -e "  ${GREEN}✅${script_base} (실행 가능)${NC}"
            else
                echo -e "  ${YELLOW}⚠️ ${script_base} (실행 권한 없음)${NC}"
            fi

            # shellcheck 검사
            echo -e "    ${BLUE}🔍 shellcheck 검사 중...${NC}"
            if shellcheck -x "$script" 2>&1; then
                echo -e "    ${GREEN}✅ shellcheck 통과${NC}"
            else
                echo -e "    ${YELLOW}⚠️  shellcheck 경고 발생${NC}"
                shellcheck_errors=$((shellcheck_errors + 1))
                ERRORS=$((ERRORS + 1))
            fi
        fi
    done

    # shellcheck 오류 요약
    if [[ $shellcheck_errors -gt 0 ]]; then
        echo -e "  ${YELLOW}⚠️  $shellcheck_errors 개의 스크립트에서 shellcheck 경고 발생${NC}"
    fi
else
    echo "  ℹ️  scripts 디렉토리 없음 (선택적)"
fi

echo ""
echo "═════════════════════════════════════════════"

# 결과
if [[ $WARNINGS -gt 0 ]]; then
    echo -e "${YELLOW}⚠️  $WARNINGS 개의 경고가 발견되었습니다 (검증 실패로 이어지지 않음)${NC}"
fi

if [[ $ERRORS -eq 0 ]]; then
    echo -e "${GREEN}✅ 검증 통과! 모든 필수 요소가 올바릅니다.${NC}"
    exit 0
else
    echo -e "${RED}❌ 검증 실패: $ERRORS 개의 오류가 발견되었습니다${NC}"
    exit 1
fi
