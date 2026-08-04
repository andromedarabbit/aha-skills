# 훅 패턴

이 문서는 Agent Skills에서 훅을 사용하는 일반적인 패턴과 모범 사례를 설명합니다.

## 훅이란?

훅은 특정 이벤트가 발생할 때 자동으로 실행되는 스크립트입니다. 스킬이 특정 상황에서 자동으로 동작하도록 할 수 있습니다.

## 훅 타입

### PreToolUse

도구가 사용되기 **전에** 실행됩니다.

**사용 사례:**
- 의존성 확인
- 환경 검증
- 입력값 검증
- 설정 파일 준비

```yaml
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(glab *)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/gitlab-ci-pipeline-doctor/scripts/check-deps.sh\""
          description: "glab 설치 확인"
```

### PostToolUse

도구가 사용된 **후에** 실행됩니다.

**사용 사례:**
- 결과 파싱
- 로그 수집
- 상태 업데이트
- 추가 처리

```yaml
hooks:
  PostToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(glab ci *)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/gitlab-ci-pipeline-doctor/scripts/summarize-ci-log.sh\""
          description: "CI 로그 요약"
```

### 비도구 이벤트 (UserPromptSubmit, SessionStart, Stop 등)

`PreToolUse`/`PostToolUse`처럼 도구 실행에 묶이지 않고, 세션 생명주기나 사용자 입력 시점에 동작하는 이벤트도 있습니다. 예를 들어 `SessionStart`(세션 시작 시), `UserPromptSubmit`(사용자가 프롬프트를 보낼 때), `Stop`(응답 종료 시)을 활용할 수 있습니다.

> 참고: `matcher`는 도구 이벤트 5종(PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, PermissionDenied)에만 적용됩니다. 비도구 이벤트에는 `matcher`를 쓰지 않습니다.

```yaml
hooks:
  SessionStart:
    - hooks:
        - type: command
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/gitlab-ci-pipeline-doctor/scripts/init-session.sh\""
          description: "세션 시작 시 환경 초기화"
```

## 일반적인 패턴

### 1. 의존성 확인 및 자동 설치 패턴 ⭐

스킬이 필요한 도구를 확인하고, 없으면 자동으로 설치합니다.

#### ❌ 안티패턴: 매번 확인만 하기

```bash
#!/bin/bash
# 나쁨: 매번 확인만 하고 사용자에게 수동 설치 요구

check_command() {
    if ! command -v "$1" &> /dev/null; then
        echo "# ⚠️ 오류: $1가 설치되지 않았습니다"
        echo "# 설치: brew install $1"
        exit 1
    fi
}

check_command "glab"
check_command "jq"
```

**문제점:**
- 매번 확인 → 시간 낭비
- 사용자가 수동으로 설치해야 함 → 마찰 증가
- AI가 문제를 해결할 수 없음 → 워크플로우 중단

#### ✅ 베스트 프랙티스: 확인 + 자동 설치

```bash
#!/bin/bash
# 좋음: 확인하고 없으면 자동 설치

set -euo pipefail

install_if_missing() {
    local tool="$1"
    local install_cmd="$2"

    # command -v는 builtin이므로 빠름 (Google Shell Style Guide 권장)
    if ! command -v "$tool" &> /dev/null; then
        echo "# 📦 $tool 설치 중..."

        if eval "$install_cmd"; then
            echo "# ✅ $tool 설치 완료"
        else
            echo "# ❌ $tool 설치 실패" >&2
            echo "# 수동 설치: $install_cmd" >&2
            exit 1
        fi
    fi
    # 이미 설치되어 있으면 출력 없음 (조용히 성공)
}

# macOS
if [[ "$OSTYPE" == "darwin"* ]]; then
    install_if_missing "glab" "brew install glab"
    install_if_missing "jq" "brew install jq"
# Linux
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    install_if_missing "glab" "sudo apt-get install -y glab"
    install_if_missing "jq" "sudo apt-get install -y jq"
fi
```

**장점:**
- ✅ 이미 설치되어 있으면 즉시 통과 (빠름)
- ✅ 없으면 자동 설치 (마찰 제거)
- ✅ 설치 실패 시에만 AI에게 알림 (문제 중심)
- ✅ `command -v` builtin 사용 (Google Shell Style Guide 권장)

#### 📊 성능 비교

```bash
# 안티패턴: 매번 확인 + 수동 설치
# 1회차: 확인 실패 → 사용자 수동 설치 → 재시도
# 2회차: 확인 성공 → 진행
# 총 시간: ~30초 (사용자 개입 포함)

# 베스트 프랙티스: 자동 설치
# 1회차: 확인 실패 → 자동 설치 → 진행
# 2회차: 확인 성공 → 즉시 진행 (< 0.1초)
# 총 시간: ~5초 (자동화)
```

#### 🎯 핵심 원칙

1. **Fail Fast**: 문제가 있을 때만 AI에게 알림
2. **Silent Success**: 정상 동작 시 조용히 통과
3. **Auto-Heal**: 가능하면 자동으로 문제 해결
4. **Use Builtins**: `command -v` > `which` (성능)

**SKILL.md 예시:**
```yaml
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(glab *)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/gitlab-ci-pipeline-doctor/scripts/check-deps.sh\""
          description: "의존성 자동 설치"
```

### 2. 환경 감지 패턴

사용자의 환경(로컬, CI, 등)을 감지하고 적절히 동작합니다.

**scripts/detect-env.sh:**
```bash
#!/bin/bash

# CI 환경 감지
if [[ -n "$CI_PIPELINE_ID" ]]; then
    echo "# GitLab CI 환경이 감지되었습니다"
    export ENV_TYPE="ci"
else
    echo "# 로컬 환경이 감지되었습니다"
    export ENV_TYPE="local"
fi
```

### 3. 설정 파일 생성 패턴

필요한 설정 파일을 자동으로 생성합니다.

**SKILL.md:**
```yaml
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: file
          if: "Bash(brew *)"
          path: "${CLAUDE_PLUGIN_ROOT}/homebrew-formula/brew-config.json"
          description: "brew 설정 로드"
```

### 4. 로그 파싱 패턴

도구 실행 결과를 파싱하여 요약 정보를 제공합니다.

**scripts/summarize-ci-log.sh:**
```bash
#!/bin/bash

# 이전 명령의 출력을 파싱
parse_output() {
    local log_file="$1"

    # 실패한 잡 찾기
    local failed_jobs=$(grep -c "Job failed" "$log_file")

    if [[ $failed_jobs -gt 0 ]]; then
        echo "# ⚠️ $failed_jobs 개의 잡이 실패했습니다"
    fi

    # 에러 메시지 추출
    grep -A 5 "ERROR:" "$log_file" | head -20
}

parse_output "$1"
```

### 5. 안전 래퍼 패턴

위험한 명령을 실행하기 전에 확인을 받습니다.

**scripts/safe-execute.sh:**
```bash
#!/bin/bash

# prod 환경에서는 추가 확인
if [[ "$ENVIRONMENT" == "prod" ]]; then
    echo "# ⚠️ 프로덕션 환경입니다"
    echo "# 정말 실행하시겠습니까? [y/N]"
    read -r response
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
        echo "# 작업이 취소되었습니다"
        exit 0
    fi
fi
```

## Matcher 패턴

**중요**: `matcher`는 **도구 이름**(Bash, Edit, Write, Read, Grep, Glob, Task, WebFetch, `mcp__...` 등)에만 매칭됩니다. `matcher`에 `glab`이나 `kubectl` 같은 명령·경로 내용을 넣으면, 비교 대상은 도구 이름(예: `Bash`)뿐이라 절대 발동하지 않습니다. 명령·경로로 좁히려면 `if:` 필드를 사용하세요.

### 특정 도구만 매칭

```yaml
# Bash 도구만
- matcher: "Bash"

# 여러 도구
- matcher: "(Read|Grep|Glob)"
```

### 특정 명령으로 좁히기 (if 사용)

`if:`는 `matcher`가 아니라 **개별 훅 항목**(`type:`·`command:`와 같은 레벨)에 둡니다. Bash 명령 패턴은 끝에 `*`를 붙여 인자가 따라오는 호출까지 매칭합니다.

```yaml
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(glab *)"          # glab 명령만
          command: "..."
        - type: command
          if: "Bash(git commit*)"     # git commit 계열만
          command: "..."
        - type: command
          if: "Bash(glab ci *)"       # glab ci 관련 명령만
          command: "..."
```

### 파일 경로로 좁히기 (if 사용)

파일 경로는 `**/` 더블스타로 시작해 하위 디렉터리까지 매칭합니다 (단일 `*`는 경로 구분자를 넘지 못합니다).

```yaml
hooks:
  PostToolUse:
    - matcher: "Read"
      hooks:
        - type: command
          if: "Read(**/*.yaml)"       # yaml 파일을 읽을 때만
          command: "..."
```

## 훅 체이닝

여러 훅을 순서대로 실행할 수 있습니다:

```yaml
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        # 1. 의존성 확인
        - type: command
          if: "Bash(brew *)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/homebrew-formula/scripts/check-brew.sh\""
          description: "brew 확인"

        # 2. 탭 확인
        - type: command
          if: "Bash(brew *)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/homebrew-formula/scripts/verify-tap.sh\""
          description: "현재 tap 확인"

        # 3. 설정 로드
        - type: file
          if: "Bash(brew *)"
          path: "${CLAUDE_PLUGIN_ROOT}/homebrew-formula/context.json"
          description: "컨텍스트 정보 로드"
```

## 훅 경로 규칙

**중요**: 모든 훅 경로는 `${CLAUDE_PLUGIN_ROOT}` 기준이며, 따옴표로 감싸야 합니다.

```yaml
# 올바름 — 카테고리는 경로에 들어가지 않는다
command: "bash \"${CLAUDE_PLUGIN_ROOT}/my-skill/scripts/check.sh\""
command: "uv run \"${CLAUDE_PLUGIN_ROOT}/my-skill/scripts/report.py\" --quiet-ok"
path: "${CLAUDE_PLUGIN_ROOT}/my-skill/config.json"

# 잘못됨
command: "bash .claude/skills/gitlab-experts/my-skill/scripts/check.sh"       # 옛 형태 → 조용히 실행 안 됨
command: "bash \"${CLAUDE_PLUGIN_ROOT}/gitlab-experts/my-skill/scripts/check.sh\""  # 카테고리 중복
command: "bash \"${CLAUDE_SKILL_DIR}/scripts/check.sh\""                     # 훅에서는 치환되지 않음
command: "bash ${CLAUDE_PLUGIN_ROOT}/my-skill/scripts/check.sh"              # 따옴표 없음
command: "bash scripts/check.sh"
command: "bash ../../my-skill/scripts/check.sh"
path: "config.json"
```

### `$CLAUDE_PLUGIN_ROOT`는 카테고리 루트다

가장 틀리기 쉬운 지점입니다. 이 저장소는 카테고리 하나가 플러그인 하나이므로,
`$CLAUDE_PLUGIN_ROOT`는 **카테고리 디렉토리**를 가리킵니다. 즉 경로에 카테고리를 다시
넣으면 안 되고, 바로 스킬 이름부터 씁니다. 실측:

```
~/.claude/plugins/cache/oh-my-skills/gitlab-experts/<sha>/gitlab-mr-creation/scripts/check-deps.sh
└───────────────────── $CLAUDE_PLUGIN_ROOT ─────────────────────┘└──── 스킬 디렉토리 ────┘
```

이 덕분에 같은 카테고리 안의 공용 스크립트도 훅에서 참조할 수 있습니다
(예: `${CLAUDE_PLUGIN_ROOT}/shared/scripts/sanitize-output.sh`). 반대로 **다른 카테고리의
스크립트는 참조할 수 없습니다** — 그 카테고리는 다른 플러그인이라 설치 경로가 다릅니다.

### 따옴표는 필수

플러그인 설치 경로는 사용자 홈 아래에 있고, 공백이 들어갈 수 있습니다. 경로를 따옴표로
감싸지 않으면 셸이 단어를 쪼개 엉뚱한 인자로 실행됩니다. YAML 이중 인용 문자열 안에서는
`\"`로 이스케이프합니다.

```yaml
command: "bash \"${CLAUDE_PLUGIN_ROOT}/my-skill/scripts/check.sh\" --quiet-ok"
```

### `${CLAUDE_SKILL_DIR}`는 훅에서 동작하지 않는다

`${CLAUDE_SKILL_DIR}`는 SKILL.md **본문**과 `allowed-tools`에서만 치환됩니다. 훅
`command`에 쓰면 빈 문자열로 남아 조용히 실패합니다. 본문에서 스킬 안의 파일(예:
`WORKER.md`)을 가리킬 때는 `${CLAUDE_SKILL_DIR}`, 훅에서는 `${CLAUDE_PLUGIN_ROOT}`입니다.

### 왜 규약이 바뀌었나

옛 규약은 `bash .claude/skills/<category>/<skill>/scripts/<x>.sh`였습니다. 이건 **CWD 기준
상대경로**라서, 스킬이 플러그인으로 설치된 환경에서는 존재하지 않는 경로였습니다(이 저장소에
`.claude/skills/` 디렉토리 자체가 없습니다).

문제는 훅이 경로가 틀렸을 때 **에러를 내지 않는다**는 점입니다. 그냥 아무 일도 일어나지
않습니다. 그래서 이 저장소의 훅 43개가 전부 안 도는 상태로 방치됐고, `gitlab-mr-creation`의
Stage 4 승인 영수증 훅(`record-stage4-approval.sh`)은 한 번도 실행되지 않은 채
"승인 게이트가 있다"고 문서화돼 있었습니다. 옛 검사기가 그 형태를 규약으로 강제했으니
CI 도 전부 통과시켰습니다.

`tools/validate-hook-paths.sh`가 이제 옛 형태를 오류로 잡고, 새 형태는 스킬 이름으로
카테고리를 역탐색해 실제 파일이 있는지까지 확인합니다.

> **공식 문서에 없는 동작입니다.** 스킬 프론트매터 훅 자체가 문서화되지 않은 기능이고,
> `${CLAUDE_PLUGIN_ROOT}`는 공식 문서에서 플러그인의 `hooks/hooks.json` 문맥으로만
> 설명됩니다. 스킬 훅에서도 치환된다는 근거는 Claude Code v2.1.220 바이너리의 문자열입니다:
>
> ```
> but only ${CLAUDE_PLUGIN_ROOT} is available for skill hooks
> (${CLAUDE_PLUGIN_DATA} is plugin-only).
> ```
>
> `for skill hooks` — 하네스가 스킬 훅을 명시적으로 지원합니다.

## SKILL.md 본문 경로 규약

훅이 아니지만 **같은 함정의 반대편**이라서 여기 함께 둡니다. 훅과 본문은 서로 다른 변수를
쓰고, 바꿔 쓰면 조용히 깨집니다.

### 파일이 어디에 있느냐로 결정된다 — 누가 읽느냐가 아니다

**판정 기준은 하나입니다: 그 파일이 하네스를 거치느냐.** "에이전트가 읽으니 하네스 변수를
쓰면 되겠지"는 틀린 추론이고, 실제로 이 저장소가 한 번 그렇게 틀렸습니다(아래 참고).

| 파일 | 쓸 것 | 왜 |
|---|---|---|
| 프론트매터 `hooks:` (플러그인 `hooks/hooks.json` 포함) | `${CLAUDE_PLUGIN_ROOT}/<skill>/scripts/...` | 훅 실행 시 env 로 주입된다. 플러그인(= 카테고리) 루트라 뒤에 스킬 이름이 온다 |
| SKILL.md **본문**, `allowed-tools` | `${CLAUDE_SKILL_DIR}/scripts/...` | 하네스가 프롬프트를 만들 때 **절대경로로 미리 치환**한다. 스킬 디렉토리 자체라 바로 `scripts/` |
| **딸린 문서** — `docs/*.md`, `README.md`, `WORKER.md` | `$SKILL_DIR/scripts/...` **+ 그 값을 정하는 방법 안내** | 치환이 **없다.** 누가 읽든 Read 도구로 읽히므로 하네스를 거치지 않는다 |
| **스크립트 내부** | `$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)` 기준 | 서브프로세스라 치환도 env 주입도 없다. 스스로 위치를 찾아야 한다 |

**`$SKILL_DIR`은 SKILL.md 본문에서는 구식이고, 딸린 문서에서는 정답입니다.** 본문에서는
하네스가 `${CLAUDE_SKILL_DIR}`를 미리 치환하므로 변수를 손으로 담는 준비 단계가 불필요하고,
그 단계를 잊으면 빈 값으로 실행됩니다. 반대로 딸린 문서에는 치환이 없으니 `${CLAUDE_SKILL_DIR}`를
적으면 읽는 쪽이 그대로 셸에 넘기고 bash 가 빈 문자열로 확장해 `bash /scripts/x.sh` 로 죽습니다.
딸린 문서에서는 `$SKILL_DIR`을 쓰고, **그 값을 어떻게 정하는지**(플러그인 캐시 경로 / 클론 경로)를
문서 안에 한 번 적어 두세요.

> **이 저장소가 실제로 틀린 방식:** 2026-07-29 전환 중에 "`docs/`는 대부분 에이전트가 읽으니
> `${CLAUDE_SKILL_DIR}`를 쓰라"고 안내했다가 8개 파일 53곳에 치환되지 않는 변수를 넣었습니다.
> 판정 기준을 "누가 읽나"로 잡은 것이 원인이었습니다. 기준은 "하네스를 거치나"입니다.

```bash
# 올바름 — 카테고리도 스킬 이름도 붙이지 않는다
bash "${CLAUDE_SKILL_DIR}/scripts/preflight.sh"
uv run "${CLAUDE_SKILL_DIR}/scripts/report.py" doctor

# 잘못됨
bash .claude/skills/gitlab-experts/my-skill/scripts/x.sh  # CWD 상대경로 → 첫 호출부터 실패
bash "${CLAUDE_SKILL_DIR}/my-skill/scripts/x.sh"          # 스킬 이름 중복
bash "${CLAUDE_SKILL_DIR}/gitlab-experts/my-skill/scripts/x.sh"  # 카테고리 중복
bash "${CLAUDE_PLUGIN_ROOT}/my-skill/scripts/x.sh"        # 본문에서는 치환되지 않음
bash ${CLAUDE_SKILL_DIR}/scripts/x.sh                     # 따옴표 없음
```

### 카테고리도 스킬 이름도 붙이지 않는다

가장 틀리기 쉬운 지점입니다. `${CLAUDE_PLUGIN_ROOT}`는 카테고리 루트라서 뒤에 스킬 이름이
오지만, `${CLAUDE_SKILL_DIR}`는 **이미 스킬 디렉토리 자체**입니다. 훅 규약을 그대로 본문에
옮기면 한 단계가 남습니다.

```
~/.claude/plugins/cache/oh-my-skills/gitlab-experts/<sha>/gitlab-mr-creation/scripts/check-deps.sh
└──────────────── $CLAUDE_PLUGIN_ROOT ────────────────┘
└──────────────────────── $CLAUDE_SKILL_DIR ────────────────────────┘
```

### 따옴표는 본문에서도 필수

치환된 절대경로는 사용자 홈 아래에 있고 공백이 들어갈 수 있습니다. 따옴표가 없으면 셸이
단어를 쪼개 엉뚱한 인자로 실행합니다. 본문은 YAML이 아니므로 이스케이프 없이 그냥 `"`입니다.

### 서로 바꿔 쓰면 조용히 깨진다

- 훅에 `${CLAUDE_SKILL_DIR}`를 쓰면 → 빈 문자열이 되고, 훅은 실패해도 아무 신호가 없습니다
- 본문에 `${CLAUDE_PLUGIN_ROOT}`를 쓰면 → 치환되지 않습니다. 이 변수는 훅을 실행할 때
  환경변수로만 주입되므로, 본문에서는 날문자로 남거나 셸이 빈 값으로 풀어 경로가 깨집니다

### 서브에이전트·딸린 문서에는 치환된 절대경로를 넘긴다

치환은 **SKILL.md 본문과 `allowed-tools`에서만** 일어납니다. `WORKER.md`나
`references/*.md` 같은 딸린 문서는 워커가 Read 도구로 읽으므로 **`${CLAUDE_SKILL_DIR}`가
날문자로 남습니다.** 그래서:

- **딸린 문서 안에서는 `${CLAUDE_SKILL_DIR}`를 쓰지 않습니다.** 아무도 치환해 주지 않습니다
- **게이트(SKILL.md 본문)가 워커 프롬프트에 치환된 절대경로를 실어 보냅니다.** 두 개가
  필요합니다:
  1. 읽을 문서의 절대경로 (예: `WORKER.md`)
  2. 그 문서 안의 상대 참조를 풀 **기준 디렉토리**

두 번째를 빼먹는 게 실제로 걸린 함정입니다. `aws-cost-analysis`와
`setup-emr-on-eks-airflow-connection`의 `WORKER.md`는 `references/*.md`를 순수 상대경로로
지시하는데, `WORKER.md`의 절대경로만 넘기면 워커가 **자기 CWD 기준**으로 찾아 실패합니다.

### 왜 규약이 바뀌었나

훅과 본문의 결함은 뿌리가 같지만(둘 다 `.claude/skills/` CWD 상대경로) 증상이 정반대입니다.

| | 경로가 틀렸을 때 | 발견 시점 |
|---|---|---|
| 훅 | 조용히 실행되지 않는다 | 몇 달 뒤, 또는 영원히 |
| 본문 | 에이전트가 그 경로로 실제 실행한다 | **첫 호출** — `No such file or directory` |

14개 스킬의 본문이 그 상태였습니다. 플러그인으로 설치해서 쓰는 사용자에게는 스킬이 첫 단계
부터 죽었고, 저장소를 체크아웃해 루트에서 실행한 개발자에게만 우연히 동작했습니다.

`tools/validate-body-paths.sh`가 이제 이것을 CI에서 잡습니다.

### 검사기는 `.claude/skills/`에 예외를 두지 않는다

"왜 이 형태를 쓰면 안 되는가"를 설명하려고 그 문자열을 인용하는 산문도 오류입니다. 실행
지시와 산문 인용을 구분하는 기준을 무엇으로 잡아도(인터프리터 접두어 유무, 인라인 코드인지
코드블록인지, 경로가 구체적인지 생략기호인지) 판정이 애매해지고, **그 애매함이 곧 미탐
경로**가 됩니다. 옛 형태 하나가 조용히 통과하면 그 스킬은 첫 호출부터 죽습니다.

반대편 비용은 훨씬 쌉니다 — 설명은 리터럴 없이도 됩니다. "CWD 상대경로는 플러그인 설치
환경에서 풀리지 않는다"로 충분합니다. 검사기에 걸리면 예외를 넣지 말고 **문장에서 리터럴을
빼세요.**

> **공식 문서에 없는 동작입니다.** 본문·`allowed-tools` 치환의 근거는 Claude Code v2.1.220
> 바이너리의 문자열입니다:
>
> ```js
> if (s.isSkillMode) z = z.replace(/\$\{CLAUDE_SKILL_DIR\}/g, p)      // 본문
> if (s.isSkillMode) q = q.replace(/\$\{CLAUDE_SKILL_DIR\}/g, () => p) // allowed-tools
> ```
>
> `isSkillMode` 조건이 붙어 있다는 게 핵심입니다 — 스킬로 로드될 때만 치환되고, 딸린 문서를
> Read로 읽는 경로에는 이 코드가 관여하지 않습니다.

## 모범 사례

### 1. 빠른 실패

훅은 빨리 실행되어야 합니다:

```bash
#!/bin/bash
# 좋음: 즉시 확인
command -v glab || { echo "glab가 필요합니다"; exit 1; }

# 나쁨: 불필요한 작업
echo "시작합니다..."
sleep 1
echo "확인 중..."
command -v glab
```

### 2. 명확한 출력

사용자에게 무엇이 일어나는지 알리세요:

```bash
#!/bin/bash
# 좋음
echo "# 🔍 glab 설치 확인 중..."

# 나쁨
# (출력 없음)
```

### 3. 종료 코드 활용

종료 코드로 성공/실패를 명확히 표시하세요:

```bash
#!/bin/bash
# 성공 시 0
if command -v glab &> /dev/null; then
    exit 0
fi

# 실패 시 1
exit 1
```

### 4. 임시 파일 정리

임시 파일은 항상 정리하세요:

```bash
#!/bin/bash
trap 'rm -f /tmp/my-skill-temp-*' EXIT

# 작업 수행
echo "data" > /tmp/my-skill-temp-data
```

## 디버깅

### 훅이 실행되지 않을 때

1. **matcher 확인**: `matcher`는 도구 이름(`Bash`, `Edit` 등)만 매칭합니다. 명령 내용은 `if`로
   거릅니다 — `matcher: "Bash.*glab.*"`처럼 쓰면 영영 발동하지 않습니다
2. **경로 확인**: `${CLAUDE_PLUGIN_ROOT}/<skill>/...` 형태인지, 카테고리를 중복해서 넣지
   않았는지, 따옴표로 감쌌는지 확인합니다. `./tools/validate-hook-paths.sh`로 검사하세요.
   훅은 경로가 틀려도 에러 없이 조용히 안 돌기 때문에 이 검사가 유일한 신호입니다
3. **권한 확인**: 스크립트에 실행 권한이 있는지 확인

```bash
# 스크립트 실행 권한 추가
chmod +x skills/<category>/my-skill/scripts/*.sh
```

### 훅 디버깅

```bash
# 훅 스크립트에 디버깅 추가
#!/bin/bash
set -x  # 모든 명령 출력

echo "# DEBUG: Running hook"
echo "# DEBUG: Args: $@"
```

### 6. 자동 의존성 설치 패턴

스킬 실행 전에 필요한 도구를 자동으로 설치합니다.

**실제 사용 사례**: gitlab-ci-pipeline-doctor 스킬

**SKILL.md:**
```yaml
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(glab *)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/gitlab-ci-pipeline-doctor/scripts/check-deps.sh\""
          description: "glab 자동 설치"
```

**scripts/check-deps.sh:**
```bash
#!/bin/bash
# 의존성 자동 설치

install_if_missing() {
    local tool="$1"
    local install_cmd="$2"

    if ! command -v "$tool" &> /dev/null; then
        echo "# 📦 $tool 설치 중..."
        eval "$install_cmd"

        if command -v "$tool" &> /dev/null; then
            echo "# ✅ $tool 설치 완료"
        else
            echo "# ❌ $tool 설치 실패"
            exit 1
        fi
    else
        echo "# ✅ $tool 이미 설치됨"
    fi
}

# macOS
if [[ "$OSTYPE" == "darwin"* ]]; then
    install_if_missing "glab" "brew install glab"
    install_if_missing "jq" "brew install jq"
# Linux
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    install_if_missing "glab" "curl -s https://gitlab.com/gitlab-org/cli/-/releases/permalink/latest/downloads/glab_linux_amd64.tar.gz | tar xz -C /usr/local/bin"
    install_if_missing "jq" "sudo apt-get install -y jq"
fi
```

### 7. 시크릿 마스킹 패턴

민감한 정보를 자동으로 마스킹하여 로그에 노출되지 않도록 합니다.

**실제 사용 사례**: PostToolUse 훅 + `if:`로 대상 명령을 좁혀 출력 후처리

**SKILL.md:**
```yaml
hooks:
  PostToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(glab *)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/shared/scripts/sanitize-output.sh\""
          description: "시크릿 마스킹"
```

**scripts/sanitize-output.sh:**
```bash
#!/bin/bash
# 출력에서 민감한 정보 마스킹

sanitize() {
    local output="$1"

    # GitLab 토큰 마스킹
    output=$(echo "$output" | sed -E 's/glpat-[a-zA-Z0-9_-]+/***GITLAB_TOKEN***/g')

    # API 키 마스킹
    output=$(echo "$output" | sed -E 's/api[_-]?key[=:][a-zA-Z0-9_-]+/api_key=***MASKED***/gi')

    # 비밀번호 마스킹
    output=$(echo "$output" | sed -E 's/password[=:][^ ]+/password=***MASKED***/gi')

    # 이메일 부분 마스킹
    output=$(echo "$output" | sed -E 's/([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/***@\2/g')

    echo "$output"
}

# stdin에서 읽어서 마스킹 후 출력
while IFS= read -r line; do
    sanitize "$line"
done
```

### 8. 로그 요약 자동화 패턴

긴 CI 로그를 자동으로 요약하여 핵심 정보만 표시합니다.

**실제 사용 사례**: gitlab-ci-pipeline-doctor 스킬

**SKILL.md:**
```yaml
hooks:
  PostToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(glab ci *)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/gitlab-ci-pipeline-doctor/scripts/summarize-ci-log.sh\""
          description: "CI 로그 요약"
```

**scripts/summarize-ci-log.sh:**
```bash
#!/bin/bash
# CI 로그 요약 생성

summarize_log() {
    local log_content="$1"

    echo "# 📊 CI 로그 요약"
    echo ""

    # 실패한 잡 수
    local failed_count=$(echo "$log_content" | grep -c "Job failed")
    if [[ $failed_count -gt 0 ]]; then
        echo "## ❌ 실패: $failed_count 개 잡"
        echo ""
    fi

    # 에러 메시지 추출 (최대 10개)
    echo "## 🔍 주요 에러"
    echo "$log_content" | grep -i "error:" | head -10 | while read -r line; do
        echo "- $line"
    done
    echo ""

    # 경고 메시지 수
    local warning_count=$(echo "$log_content" | grep -ic "warning:")
    if [[ $warning_count -gt 0 ]]; then
        echo "## ⚠️ 경고: $warning_count 개"
        echo ""
    fi

    # 실행 시간 추출
    local duration=$(echo "$log_content" | grep -o "Duration: [0-9:]*" | head -1)
    if [[ -n "$duration" ]]; then
        echo "## ⏱️ $duration"
        echo ""
    fi

    # 전체 로그 링크
    echo "---"
    echo "💡 전체 로그는 위 출력을 참고하세요"
}

# stdin 또는 파일에서 로그 읽기
if [[ -p /dev/stdin ]]; then
    log_content=$(cat)
else
    log_content=$(cat "$1" 2>/dev/null || echo "")
fi

summarize_log "$log_content"
```

### 9. 훅 체이닝 패턴

여러 훅을 순차적으로 실행하여 복잡한 워크플로우를 구성합니다.

**실제 사용 사례**: 다단계 검증 및 준비

**SKILL.md:**
```yaml
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        # 1단계: 의존성 확인
        - type: command
          if: "Bash(brew *)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/homebrew-formula/scripts/check-brew.sh\""
          description: "brew 설치 확인"

        # 2단계: 탭 확인
        - type: command
          if: "Bash(brew *)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/homebrew-formula/scripts/verify-tap.sh\""
          description: "현재 tap 확인"

        # 3단계: 권한 확인
        - type: command
          if: "Bash(brew *)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/homebrew-formula/scripts/check-permissions.sh\""
          description: "사용자 권한 확인"

        # 4단계: 컨텍스트 정보 로드
        - type: file
          if: "Bash(brew *)"
          path: "${CLAUDE_PLUGIN_ROOT}/homebrew-formula/context.json"
          description: "tap 정보 로드"
```

**실행 흐름:**
```
brew 명령 감지
    ↓
[훅 1] brew 설치 확인 → 실패 시 중단
    ↓
[훅 2] tap 확인 → 실패 시 중단
    ↓
[훅 3] 권한 확인 → 실패 시 중단
    ↓
[훅 4] tap 정보 로드
    ↓
brew 명령 실행
```

**주의사항:**
- 훅은 정의된 순서대로 실행됩니다
- 하나의 훅이 실패(exit code ≠ 0)하면 다음 훅은 실행되지 않습니다
- 각 훅은 독립적으로 실행되므로 환경 변수는 공유되지 않습니다

### 10. 커밋 메시지 생성 패턴

Git 변경 사항을 분석하여 Conventional Commits 형식의 커밋 메시지를 자동 생성합니다.

**실제 사용 사례**: git-commit-helper 스킬

**SKILL.md:**
```yaml
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(git commit*)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/git-commit-helper/scripts/check-deps.sh\""
          description: "git 및 jq 설치 확인"
        - type: command
          if: "Bash(git commit*)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/git-commit-helper/scripts/validate-git-state.sh\""
          description: "Git 저장소 상태 검증"

  PostToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(git diff*)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/git-commit-helper/scripts/analyze-staged-changes.sh\""
          description: "staged 변경 사항 분석 및 타입 추론"
    - matcher: "Write"
      hooks:
        - type: command
          if: "Write(**/commit-message.txt)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/git-commit-helper/scripts/validate-commit-message.sh\" \"$FILE\""
          description: "커밋 메시지 형식 검증"
```

**scripts/analyze-staged-changes.sh:**
```bash
#!/bin/bash
# staged 변경 사항 분석 및 타입 추론

set -euo pipefail

analyze_changes() {
    local added=$(git diff --cached --numstat | awk '{sum+=$1} END {print sum+0}')
    local deleted=$(git diff --cached --numstat | awk '{sum+=$2} END {print sum+0}')
    local files=$(git diff --cached --name-only | wc -l | tr -d ' ')

    # 타입 자동 추론
    local type="feat"
    if [[ $deleted -gt $added ]]; then
        type="refactor"
    elif git diff --cached --name-only | grep -q "test"; then
        type="test"
    elif git diff --cached --name-only | grep -qE "README|\.md$"; then
        type="docs"
    fi

    # JSON 출력
    jq -n \
        --arg type "$type" \
        --argjson added "$added" \
        --argjson deleted "$deleted" \
        --argjson files "$files" \
        '{type: $type, added: $added, deleted: $deleted, files: $files}'
}

analyze_changes
```

**워크플로우:**
```
git add 실행
    ↓
[PreToolUse] 의존성 확인 (git, jq)
    ↓
[PreToolUse] Git 상태 검증 (브랜치, staged changes)
    ↓
git diff --staged 실행
    ↓
[PostToolUse] 변경 사항 분석 (타입/scope 추론)
    ↓
커밋 메시지 생성
    ↓
[PostToolUse] 메시지 형식 검증 (Conventional Commits)
    ↓
git commit 실행
```

**특징:**
- 2가지 훅 타입 활용 (PreToolUse, PostToolUse)
- 타입 자동 추론 (feat/fix/docs/test/refactor)
- Conventional Commits 형식 검증
- 한국어 대화형 인터페이스

## 참고

- [스킬 명세](skill-specification.md)
- [프론트매터 레퍼런스](frontmatter-reference.md)
- [명명 규칙](naming-conventions.md)
- [플랫폼 비교](platform-comparison.md)
