#!/bin/bash
# 스킬 뼈대를 비대화형으로 생성한다.
#
# 이 스크립트는 skill-author 스킬의 워커가 호출한다. 사람이 직접 써도 되지만
# 대화형 프롬프트는 없다 — 모든 입력은 인자로 받는다.
#
# 여기가 "상호작용 모델 → context/agent/background/WORKER.md" 파생의 유일한 구현이다.
# 판단표 원본은 docs/skill-specification.md 의 "Context 선택"이고, 그 표를 코드로 옮긴
# 곳은 이 파일 하나뿐이어야 한다. 두 곳에 두면 갈라진다.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 템플릿은 스킬 안에 동봉한다. 스킬 바깥(저장소 루트)에 두면 플러그인으로 배포될 때
# 함께 실려가지 않아, 설치본에서 "템플릿을 찾을 수 없다"로 죽는다 — 실제로 그랬다.
TEMPLATE_DIR="$SCRIPT_DIR/../assets/skill-template"

# 생성 대상은 **현재 작업 중인 저장소**다. 스크립트 위치에서 역산하면
# 플러그인 캐시(~/.claude/plugins/cache/...)를 가리켜 엉뚱한 곳에 스킬을 만든다.
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"

usage() {
    cat <<'USAGE'
Usage: scaffold.sh --category <cat> --name <name> --description <desc>
                   --interaction <model> [options]

필수:
  --category <cat>        카테고리 (kebab-case, 예: ci-experts)
  --name <name>           스킬 이름 (kebab-case, 예: ci-log-doctor)
  --description <desc>    무엇을 하는지 + 언제 쓰는지 (1024자 이내)
  --interaction <model>   none | dialog | highrisk | gate-worker | plan-apply | resume

선택:
  --version <ver>         기본값 1.0.0
  --dep <spec>            의존성 (반복 가능, 예: --dep 'gh>=2.0.0')
  --background false      context: fork 인 경우에만. 스킬 호출을 동기로 끝낸다
  --root <path>           저장소 루트 (테스트용, 기본값은 이 스크립트 기준 자동 계산)
  --dry-run               파일을 만들지 않고 계획만 출력
  --force                 대상 디렉토리가 이미 있어도 진행
  -h, --help              이 도움말

상호작용 모델 → 실행 방식 (docs/skill-specification.md "Context 선택"):
  none          상호작용 없음                      → context: fork
  dialog        여러 라운드 자유 서술형 대화가 핵심  → context: inline
  highrisk      고위험·비가역 게이트가 여러 곳       → context: inline
  gate-worker   본문은 길지만 *입력*은 조사 전 확정  → inline 게이트 + WORKER.md
  plan-apply    조사 의존 + 비가역                 → context: fork (계획 산출 전용)
  resume        조사 의존 + 가역                   → context: fork + 반환-재개
USAGE
}

# ── 인자 파싱 ────────────────────────────────────────────────────────────────
category=""
skill_name=""
description=""
interaction=""
version="1.0.0"
background_opt=""
dry_run="no"
force="no"
deps=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --category)    category="${2:-}";    shift 2 ;;
        --name)        skill_name="${2:-}";  shift 2 ;;
        --description) description="${2:-}"; shift 2 ;;
        --interaction) interaction="${2:-}"; shift 2 ;;
        --version)     version="${2:-}";     shift 2 ;;
        --background)  background_opt="${2:-}"; shift 2 ;;
        --root)        REPO_ROOT="${2:-}"; shift 2 ;;
        --dep)         deps+=("${2:-}");     shift 2 ;;
        --dry-run)     dry_run="yes";        shift ;;
        --force)       force="yes";          shift ;;
        -h|--help)     usage; exit 0 ;;
        *)
            echo "❌ 알 수 없는 인자: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

die() {
    echo "❌ $1" >&2
    exit 2
}

# ── 검증 ────────────────────────────────────────────────────────────────────
[[ -n "$category" ]]    || die "--category 는 필수입니다"
[[ -n "$skill_name" ]]  || die "--name 은 필수입니다"
[[ -n "$description" ]] || die "--description 은 필수입니다"
[[ -n "$interaction" ]] || die "--interaction 은 필수입니다"

[[ "$category" =~ ^[a-z0-9-]+$ ]]   || die "카테고리는 소문자·숫자·하이픈만 씁니다: $category"
[[ "$skill_name" =~ ^[a-z0-9-]+$ ]] || die "스킬 이름은 소문자·숫자·하이픈만 씁니다: $skill_name"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "버전은 시맨틱 버저닝이어야 합니다: $version"

# description 은 프론트매터 한 줄로 들어가므로 줄바꿈을 허용하지 않는다
[[ "$description" != *$'\n'* ]] || die "설명에 줄바꿈을 넣을 수 없습니다 (프론트매터 한 줄)"
(( ${#description} <= 1024 ))   || die "설명은 1024자를 넘길 수 없습니다 (현재 ${#description}자)"

case "$interaction" in
    none|dialog|highrisk|gate-worker|plan-apply|resume) ;;
    *) die "--interaction 값이 잘못됐습니다: $interaction (none|dialog|highrisk|gate-worker|plan-apply|resume)" ;;
esac

[[ -d "$TEMPLATE_DIR" ]] || die "템플릿 디렉토리를 찾을 수 없습니다: $TEMPLATE_DIR"

# 대상 저장소 확인. 엉뚱한 곳에 스킬을 만들어놓고 성공했다고 보고하느니 즉시 멈춘다.
[[ -n "$REPO_ROOT" ]] || die "git 저장소 안에서 실행하세요 (생성 대상을 찾을 수 없습니다). 또는 --root 로 지정하세요"
if [[ ! -f "$REPO_ROOT/tools/validate-skill.sh" || ! -f "$REPO_ROOT/.claude-plugin/marketplace.json" ]]; then
    die "여기는 aha-skills 저장소가 아닙니다: $REPO_ROOT
   이 스킬은 저장소 관례(카테고리 구조·검증기·marketplace 등록)를 전제로 합니다.
   aha-skills 체크아웃 안에서 실행하거나 --root 로 지정하세요."
fi

# ── 파생: 상호작용 모델 → context / agent / background / WORKER.md ──────────
emit_worker="no"
agent_value=""
case "$interaction" in
    dialog|highrisk)
        # 중계로는 대화가 성립하지 않거나, 게이트 지연·누락이 사고로 이어진다
        context_value="inline"
        ;;
    gate-worker)
        # 게이트만 주 대화에 두고 실행 본문은 WORKER.md 로 분리한다
        context_value="inline"
        emit_worker="yes"
        ;;
    *)
        context_value="fork"
        # 게이트가 있으면 반드시 general-purpose — Explore/Plan 은 one-shot 이라 재개 불가
        agent_value="general-purpose"
        ;;
esac

background_value=""
if [[ -n "$background_opt" ]]; then
    [[ "$background_opt" == "false" ]] || die "--background 는 false 만 지원합니다 (true 는 플랫폼 기본값이라 적지 않습니다)"
    [[ "$context_value" == "fork" ]]   || die "--background 는 context: fork 에서만 의미가 있습니다 (--interaction $interaction → $context_value)"
    background_value="false"
fi

case "$interaction" in
    none)        interaction_label="상호작용 없음 → context: fork" ;;
    dialog)      interaction_label="자유형 대화가 핵심 → context: inline" ;;
    highrisk)    interaction_label="고위험·비가역 게이트 다수 → context: inline" ;;
    gate-worker) interaction_label="의도를 앞에서 확정 가능 → 게이트(inline) + 워커(WORKER.md)" ;;
    plan-apply)  interaction_label="조사 의존 + 비가역 → plan/apply 분할 (이 스킬은 plan 쪽)" ;;
    *)           interaction_label="조사 의존 + 가역 → context: fork + 반환-재개" ;;
esac
if [[ -n "$background_value" ]]; then
    interaction_label="$interaction_label + background: false"
fi

target_dir="$REPO_ROOT/skills/$category/$skill_name"
rel_target="skills/$category/$skill_name"
# 훅 command 는 $CLAUDE_PLUGIN_ROOT 기준이다. 이 변수는 **플러그인(= 카테고리) 설치 루트**를
# 가리키므로 경로에 카테고리를 다시 넣지 않는다. CWD 상대경로 형태는 플러그인 설치 환경에서
# 조용히 실행되지 않는다 (tools/validate-hook-paths.sh 헤더 참고).
hook_base="\${CLAUDE_PLUGIN_ROOT}/$skill_name"
# 반면 SKILL.md **본문**에서는 $CLAUDE_SKILL_DIR 이 치환된다 (훅에서는 안 된다). 이 변수는
# **스킬 디렉토리 자체**라서 뒤에 카테고리도 스킬 이름도 붙이지 않는다
# (tools/validate-body-paths.sh 가 CI 에서 잡는다).
skill_dir_ref="\${CLAUDE_SKILL_DIR}"

# ── dry-run ─────────────────────────────────────────────────────────────────
if [[ "$dry_run" == "yes" ]]; then
    echo "[dry-run] 생성하지 않습니다."
    echo "  경로:      $rel_target"
    echo "  실행 방식: $interaction_label"
    echo "  context:   $context_value"
    if [[ -n "$agent_value" ]]; then
        echo "  agent:     $agent_value"
    fi
    if [[ -n "$background_value" ]]; then
        echo "  background: $background_value"
    fi
    echo "  WORKER.md: $emit_worker"
    if (( ${#deps[@]} > 0 )); then
        echo "  의존성:    ${deps[*]}"
    else
        echo "  의존성:    없음"
    fi
    exit 0
fi

if [[ -d "$target_dir" && "$force" != "yes" ]]; then
    die "이미 존재합니다: $rel_target (덮어쓰려면 --force)"
fi

# ── 프론트매터 조립 ─────────────────────────────────────────────────────────
# 사용자 입력 스칼라는 반드시 YAML 이중 인용 문자열로 직렬화한다.
# 그냥 박으면 `--description '사용 시점: 배포 전'` 같은 정상 입력도 프론트매터를 깨뜨린다
# ("mapping values are not allowed here"). 콜론·해시·따옴표·백슬래시가 모두 해당된다.
yaml_dq() {
    local s="$1"
    s="${s//\\/\\\\}"   # 백슬래시를 먼저 — 순서를 바꾸면 이스케이프가 중복된다
    s="${s//\"/\\\"}"
    printf '"%s"' "$s"
}

# 의존성이 없으면 블록을 통째로 비운다 — 빈 줄을 남기지 않는다
deps_block=""
if (( ${#deps[@]} > 0 )); then
    deps_block=$'\n'"dependencies:"
    for dep in "${deps[@]}"; do
        deps_block="$deps_block"$'\n'"  - $(yaml_dq "$dep")"
    done
    # matcher 는 도구 이름만 매칭한다. 명령 내용은 if 로 거른다
    deps_block="$deps_block"$'\n'"hooks:
  PreToolUse:
    - matcher: \"Bash\"
      hooks:
        - type: command
          if: \"Bash(your-command *)\"
          command: \"bash \\\"$hook_base/scripts/example-hook.sh\\\"\"
          description: \"이 훅이 하는 일에 대한 설명\""
fi

context_block="context: $context_value"
if [[ -n "$agent_value" ]]; then
    context_block="$context_block"$'\n'"agent: $agent_value"
fi
if [[ -n "$background_value" ]]; then
    context_block="$context_block"$'\n'"background: $background_value"
fi

# ── 본문의 스크립트 경로 절 ─────────────────────────────────────────────────
# 이 절이 없으면 저자가 규약을 모른 채 CWD 상대경로(`scripts/...`)를 적고, 플러그인으로
# 설치된 환경에서 **첫 호출부터** `No such file or directory` 로 죽는다. 훅 경로 결함과
# 달리 조용히 넘어가지 않으므로 본문 맨 앞에 둔다.
script_path_section="## 스크립트 경로 (먼저 읽을 것)

이 스킬의 스크립트는 \`$skill_dir_ref\` 아래에 있습니다. 하네스가 SKILL.md 를 넘겨줄 때 이
변수를 **스킬 디렉토리 절대경로로 미리 치환**하므로, 아래 형태를 그대로 실행하면 됩니다.

\`\`\`bash
bash \"$skill_dir_ref/scripts/<script>.sh\"
\`\`\`

- 뒤에 카테고리(\`$category\`)나 스킬 이름을 덧붙이지 마세요 — 이 변수가 이미 스킬 디렉토리입니다
- 따옴표는 필수입니다. 치환된 설치 경로에 공백이 들어갈 수 있습니다
- CWD 기준 상대경로로 부르지 마세요. 플러그인으로 설치된 환경에는 그 경로가 없어서 첫 호출부터
  \`No such file or directory\` 로 실패합니다
- 프론트매터 \`hooks:\` 는 \`\${CLAUDE_PLUGIN_ROOT}\` 규약을 씁니다 — **본문과 훅의 변수가
  다릅니다.** 서로 바꿔 쓰면 치환되지 않고 조용히 깨집니다"

# ── 본문의 사용자 확인 섹션 (실제로 실행 가능한 방식만 안내한다) ────────────
case "$interaction" in
    dialog|highrisk)
        gate_section="## 사용자 확인

inline 스킬이므로 \`AskUserQuestion\` 을 직접 호출할 수 있습니다. 무엇을 물을지와
선택지를 여기에 적으세요."
        ;;
    gate-worker)
        gate_section="## 1. 의도 확정 (게이트)

조사·탐색을 시작하기 **전에**, 필요한 것만 \`AskUserQuestion\` 으로 묻습니다.
이미 대화에서 알 수 있는 값은 묻지 말고 채운 뒤 확인만 받으세요. 게이트는 얇게 유지합니다.

## 2. Intent Contract 구성

답변을 아래로 압축합니다. 원 대화나 중간 추론은 옮기지 않습니다.

\`\`\`yaml
goal: 사용자가 달성하려는 결과
scope:
  in: [포함]
  out: [제외]
constraints: [기술·정책·호환성]
acceptance_criteria: [완료 판정 기준]
decisions:
  - question: 확정한 선택
    answer: 사용자 답
\`\`\`

## 3. 워커 실행

\`general-purpose\` 에이전트를 띄우면서 \`$skill_dir_ref/WORKER.md\` 를 읽고 따르라는
지시와 Contract 만 전달합니다. 탐색 로그·파일 읽기·중간 추론은 전부 워커에 남고,
주 대화에는 워커의 짧은 최종 요약만 돌아옵니다.

**워커 프롬프트에는 치환된 절대경로 두 개를 실어 보냅니다.** \`$skill_dir_ref\` 치환은
SKILL.md 본문과 \`allowed-tools\` 에서만 일어나므로, 워커가 Read 로 읽는 \`WORKER.md\` 안에서는
이 변수가 날문자로 남습니다:

1. 읽어야 할 본문: \`$skill_dir_ref/WORKER.md\` 의 절대경로
2. 참조 문서의 기준 디렉토리: \`$skill_dir_ref\` 의 절대경로 (WORKER.md 가 \`docs/\` 나
   \`scripts/\` 를 상대경로로 가리키면, 이게 없으면 워커가 **자기 CWD 기준**으로 찾아 실패합니다)

워커가 \`NEEDS_DECISION\` 을 반환하면(의도 확정 단계에서 예상하지 못한 결정) 여기서
\`AskUserQuestion\` 으로 묻고, 새 워커를 만들지 말고 \`SendMessage\` 로 기존 워커를
재개시킵니다."
        ;;
    plan-apply)
        gate_section="## 계획 산출 (plan/apply 분할)

질문이 조사 결과에 의존하고 그 결정이 비가역이므로, 승인을 실행 **중**이 아니라
두 스킬 호출 **사이**에 둡니다. 그 자리에서는 주 에이전트가 사용자에게 직접 물을 수 있으므로
재개 프로토콜이 필요 없습니다.

이 스킬(plan 쪽)의 규칙:

- **어떤 외부 상태도 바꾸지 않습니다.** 읽기 전용입니다.
- 조사 결과를 계획 아티팩트(파일)로 남깁니다.
- 주 대화에는 계획 파일 경로와 짧은 요약만 반환합니다.
- 사용자에게 묻지 않습니다 — 승인은 이 스킬이 끝난 뒤에 이뤄집니다.

적용은 별도의 \`$skill_name-apply\` 스킬이 맡고, 계획 파일만 입력으로 받습니다.
계획이 낡았을 수 있으므로 apply 쪽에서 fingerprint 로 검증하세요."
        ;;
    resume)
        gate_section="## 승인 게이트

판정 근거를 요약해 보여준 뒤, 아래 형식으로 반환하고 **실행을 멈춥니다** (relay 지시문 줄은
고정 문구이므로 그대로 둡니다):

\`\`\`
PENDING_DECISION:
[오케스트레이터 지시] 아래 내용을 요약·재구성하지 말고 사용자에게 원문 그대로 보여주세요. 지금은 작업이 끝난 게 아니라 사용자 응답을 기다리며 멈춘 상태입니다.
<질문> (<선택지> / <선택지>)
\`\`\`

오케스트레이터가 사용자에게 전달하고, 답변이 오면 재개됩니다.
게이트가 여러 개면 가까운 것끼리 묶어 왕복을 줄이세요.

> fork 서브에이전트는 \`AskUserQuestion\` 을 호출할 수 없습니다. 본문이나 딸린 문서에
> \"물어본다\"고 적으면 조용히 무시됩니다."
        ;;
    *)
        gate_section="## 주의사항

사용 시 주의할 점을 설명합니다.

> 이 스킬은 실행 중 사용자 확인이 없는 것으로 설계됐습니다. 확인이 필요해지면
> \`docs/skill-specification.md\` 의 \"Context 선택\" 판단표부터 다시 보세요."
        ;;
esac

# ── 생성 ────────────────────────────────────────────────────────────────────
# --force 재생성 시, 조건부 산출물이 이전 선택의 잔여물로 남으면 프론트매터와 불일치한다.
# 예: gate-worker + dep 로 만든 스킬을 `none --force` 로 다시 만들면 SKILL.md 는
# context: fork / 훅 없음이 되는데 WORKER.md 와 example-hook.sh 가 그대로 남았다.
# 그래서 이 스크립트가 관리하는 조건부 파일은 생성 전에 지우고, 필요할 때만 다시 만든다.
if [[ -d "$target_dir" ]]; then
    rm -f "$target_dir/WORKER.md" "$target_dir/scripts/example-hook.sh"
fi

mkdir -p "$target_dir/docs" "$target_dir/scripts/tests"

# 템플릿 본문에서 placeholder 를 치환한다.
# 프론트매터는 위에서 파생한 값으로 새로 쓰고, 본문 산문만 템플릿에서 가져온다.
# GUIDELINES/REFERENCE 는 docs/ 로 내려가므로 루트 기준 상대 링크를 함께 고친다.
substitute() {
    sed -e "s|category/skill-name|$category/$skill_name|g" \
        -e "s|skill-name|$skill_name|g" \
        -e "s|](GUIDELINES.md)|](docs/GUIDELINES.md)|g" \
        -e "s|](REFERENCE.md)|](docs/REFERENCE.md)|g" "$1"
}

# docs/ 안의 문서끼리는 서로 같은 디렉토리에 있고, README 만 한 단계 위에 있다
substitute_docs() {
    sed -e "s|category/skill-name|$category/$skill_name|g" \
        -e "s|skill-name|$skill_name|g" \
        -e "s|](README.md)|](../README.md)|g" "$1"
}

# SKILL.md — 프론트매터는 파생값, 본문은 템플릿에서 (첫 --- 쌍 이후)
{
    printf -- '---\n'
    printf 'name: %s\n' "$skill_name"
    printf 'description: %s\n' "$(yaml_dq "$description")"
    printf 'version: %s\n' "$(yaml_dq "$version")"
    printf '%s\n' "$context_block"
    printf 'language: "korean"%s\n' "$deps_block"
    printf -- '---\n\n'
    printf '# %s 스킬\n\n' "$skill_name"
    printf '## 개요\n\n이 스킬의 목적과 기능을 설명합니다.\n\n'
    printf '%s\n\n' "$script_path_section"
    printf '## 사용 방법\n\n스킬을 사용하는 방법을 단계별로 설명합니다:\n\n1. 단계 1\n2. 단계 2\n3. 단계 3\n\n'
    printf "## 예시\n\n사용 예시를 보여줍니다:\n\n\`\`\`bash\n# 예시 명령\ncommand argument\n\`\`\`\n\n"
    printf '%s\n\n' "$gate_section"
    printf '## 관련 문서\n\n- [사용자 문서](README.md)\n- [문서 인덱스](docs/INDEX.md)\n- [구현 가이드](docs/GUIDELINES.md)\n'
} > "$target_dir/SKILL.md"

# WORKER.md — 게이트/워커 분리를 택한 경우에만
if [[ "$emit_worker" == "yes" ]]; then
    cat > "$target_dir/WORKER.md" <<EOF
# $skill_name 워커

이 파일은 \`SKILL.md\` 게이트가 \`general-purpose\` 에이전트에게 넘기는 실행 본문입니다.
주 대화에 적재되지 않으므로 길어져도 됩니다 — 절차·예시·주의사항은 여기에 씁니다.

## 입력

Intent Contract 와, 게이트가 넘겨준 **스킬 디렉토리 절대경로**를 받습니다. 원 대화 맥락은
없다고 가정하세요.

> 이 파일 안에서는 \`\${CLAUDE_SKILL_DIR}\` 를 쓰지 마세요. 그 치환은 SKILL.md 본문과
> \`allowed-tools\` 에서만 일어나고, 이 파일은 Read 도구로 읽히므로 날문자로 남습니다.
> 스크립트나 \`docs/\` 를 가리킬 때는 게이트가 넘겨준 절대경로를 기준으로 쓰세요. 절대경로를
> 받지 못했으면 추측하지 말고 그 사실을 보고하고 멈추세요.

## 실행

1. 단계 1
2. 단계 2
3. 단계 3

## 사용자 결정이 필요해진 경우

의도는 게이트에서 확정됐으므로 원칙적으로 되묻지 않습니다. 그럼에도 확정되지 않은
결정이 드러나면, **추측하지 말고** 아래만 반환하고 멈춥니다:

\`\`\`
NEEDS_DECISION
question: <구체적인 질문 하나>
options:
  - label: <선택지>
    consequence: <트레이드오프>
recommended: <선택지 또는 없음>
why: <한 문장>
\`\`\`

게이트가 사용자에게 묻고 \`SendMessage\` 로 이 에이전트를 재개시킵니다.
서브에이전트에는 사용자에게 직접 묻는 도구가 없으므로, 직접 묻지 마세요.

## 반환 형식

주 대화로 돌아가는 유일한 창구이므로 짧게 유지합니다:

- 결과
- 변경한 파일 또는 산출물 경로
- 검증한 방법
- 남은 위험
EOF
fi

# README.md — 템플릿 산문 + 실행 방식 기술
{
    printf '# %s\n\n%s\n' "$skill_name" "$description"
    substitute "$TEMPLATE_DIR/README.md" | tail -n +4
    # 백틱은 마크다운 코드 표기다. 단일 인용부호 안에 두면 shellcheck 가 명령 치환으로 오해한다
    printf '\n## 실행 방식\n\n'
    printf -- "- 상호작용 모델: \`%s\` — %s\n" "$interaction" "$interaction_label"
    printf -- "- \`context: %s\`\n" "$context_value"
    if [[ -n "$agent_value" ]]; then
        printf -- "- \`agent: %s\`\n" "$agent_value"
    fi
    if [[ -n "$background_value" ]]; then
        printf -- "- \`background: %s\`\n" "$background_value"
    fi
    printf '\n판정 근거는 [Context 선택 판단표](../../../docs/skill-specification.md)를 따릅니다.\n'
} > "$target_dir/README.md"

substitute_docs "$TEMPLATE_DIR/GUIDELINES.md" > "$target_dir/docs/GUIDELINES.md"
substitute_docs "$TEMPLATE_DIR/REFERENCE.md"  > "$target_dir/docs/REFERENCE.md"

cat > "$target_dir/docs/INDEX.md" <<EOF
# 문서 인덱스

이 디렉토리에는 $skill_name 스킬의 상세 문서가 있습니다.

## 사용 가능한 문서

### [GUIDELINES.md](GUIDELINES.md)
구현 가이드. 아키텍처, 구현 단계, 테스트 방법을 다룹니다.

### [REFERENCE.md](REFERENCE.md)
레퍼런스. 명령어, 설정, 종료 코드 등 상세 정보를 제공합니다.

## 팁

- 에이전트는 사용자가 명시적으로 요청하지 않는 한 이 문서들을 읽지 않습니다.
- 사용자는 [README.md](../README.md)로 시작하고, 이 인덱스로 상세 문서를 탐색하세요.
EOF

# 테스트 하네스 — 러너는 스킬 무관하게 동작하므로 그대로 복사한다.
# scripts/ 가 있는 스킬은 scripts/tests/run.sh 를 반드시 포함해야 한다(CLAUDE.md).
cp "$TEMPLATE_DIR/scripts/tests/run.sh" "$target_dir/scripts/tests/run.sh"
cp "$TEMPLATE_DIR/scripts/tests/example.bats" "$target_dir/scripts/tests/example.bats"
chmod +x "$target_dir/scripts/tests/run.sh"

# 훅을 선언한 경우에만 훅 스크립트 자리를 만든다 — 안 쓰는 파일을 남기지 않는다
if (( ${#deps[@]} > 0 )); then
    cat > "$target_dir/scripts/example-hook.sh" <<EOF
#!/bin/bash
# $skill_name 훅 스크립트

set -euo pipefail

# 여기에 훅 로직을 구현하세요
echo "# $skill_name 훅이 실행되었습니다"
EOF
    chmod +x "$target_dir/scripts/example-hook.sh"
fi

# ── 보고 ────────────────────────────────────────────────────────────────────
echo "✅ 생성 완료: $rel_target"
echo "   실행 방식: $interaction_label"
echo ""
echo "생성된 파일:"
echo "  $rel_target/SKILL.md"
if [[ "$emit_worker" == "yes" ]]; then
    echo "  $rel_target/WORKER.md"
fi
echo "  $rel_target/README.md"
echo "  $rel_target/docs/{INDEX,GUIDELINES,REFERENCE}.md"
echo "  $rel_target/scripts/tests/{run.sh,example.bats}"
if (( ${#deps[@]} > 0 )); then
    echo "  $rel_target/scripts/example-hook.sh"
fi
exit 0
