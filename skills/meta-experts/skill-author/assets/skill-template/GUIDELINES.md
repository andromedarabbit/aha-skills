# 구현 가이드라인

이 문서는 스킬을 구현하고 확장할 때 참고하는 가이드라인입니다.

## 개요

이 가이드라인의 목적과 범위를 설명합니다.

## 아키텍처

스킬의 전체 구조와 각 컴포넌트의 역할을 설명합니다.

```
스킬 구조 다이어그램
```

## Context 선택

스킬의 실행 컨텍스트를 결정하는 기준입니다.

### fork vs inline 결정 기준

Context는 `context:` 한 줄로 실행 방식을 제어하는 수단입니다.

첫 번째 기준은 **실행 중에 사용자에게 물어봐야 하는가**입니다 — `fork` 서브에이전트는
`AskUserQuestion`을 쓸 수 없기 때문입니다.

- 상호작용 없음 → `fork`
- 여러 라운드 자유형 대화가 핵심이거나, 고위험·비가역 게이트가 여러 곳 → `inline`
- 조사 **전에** 의도 확정 가능 → `inline` 게이트 + `WORKER.md` 워커
- 질문이 조사 결과에 의존, 가역 → `fork` + `PENDING_DECISION` 반환-재개
- 질문이 조사 결과에 의존, 비가역 → plan/apply 분할

상호작용 여부가 같다면 그다음 기준이 컨텍스트 소모량입니다. 판단표 전문은
`docs/skill-specification.md`의 "Context 선택"에 있습니다.

**이 스킬의 선택:** 실제 값은 `SKILL.md` 프론트매터와 [README의 "실행 방식"](README.md)에 있습니다.
여기서는 값을 다시 적지 말고 **왜 그 갈래로 판정됐는지**만 쓰세요 — 값을 세 곳에 적으면 갈라집니다.

**선택 이유:** (여기에 이 스킬이 해당 갈래로 판정된 이유를 설명)

## Agent 선택

작업 유형에 따라 최적화된 에이전트를 선택합니다.

### Agent Types 선택 기준

`agent`는 `context: fork`일 때만 의미가 있습니다.

내장 agent (Claude Code 기준):
- `general-purpose` — 잘 모르겠으면 이것
- `Explore`, `Plan` — **one-shot이라 `SendMessage` 재개가 안 됩니다.** 승인 게이트가 있는
  스킬(반환-재개 패턴)에는 쓸 수 없습니다.

> 참고: 언어/프레임워크 전문 agent는 플랫폼/버전에 따라 다를 수 있습니다.

**선택 이유:** (여기에 이 스킬이 해당 agent를 선택한 이유를 설명)

## Hooks 구현

이벤트 기반 자동화를 위한 훅 구현 가이드입니다.

### 훅 경로 규칙

```yaml
command: "bash \"${CLAUDE_PLUGIN_ROOT}/<skill>/scripts/<script>.sh\""
```

- `${CLAUDE_PLUGIN_ROOT}` 는 **플러그인(= 카테고리) 설치 루트**입니다. 경로에 카테고리를
  다시 넣지 마세요 — 가장 자주 틀리는 지점입니다.
- 따옴표는 필수입니다. 설치 경로에 공백이 들어갈 수 있습니다.
- `${CLAUDE_SKILL_DIR}` 은 훅에서 치환되지 않습니다 (SKILL.md 본문·`allowed-tools` 전용).
- CWD 기준 상대경로는 플러그인 설치 환경에서 풀리지 않고, 훅은 그때 **에러 없이 조용히 실행되지
  않습니다**. 쓰지 마세요.

### 본문 경로 규칙 (훅과 다른 변수를 씁니다)

SKILL.md **본문**에서 스크립트를 부를 때는 `${CLAUDE_SKILL_DIR}` 을 씁니다. 쓸 형태는
`SKILL.md` 의 "스크립트 경로 (먼저 읽을 것)" 절에 그대로 들어 있으니 그 줄을 재사용하세요.

- 이 변수는 **스킬 디렉토리 자체**입니다. 뒤에 카테고리도 스킬 이름도 붙이지 마세요 —
  훅 규약(`${CLAUDE_PLUGIN_ROOT}/<skill>/...`)을 그대로 옮기면 한 단계가 남습니다.
- 따옴표는 본문에서도 필수입니다.
- **본문 결함은 훅 결함보다 시끄럽습니다.** 훅은 조용히 안 돌지만, 본문 경로가 틀리면 에이전트가
  그 경로로 실제 실행해서 **첫 호출부터** `No such file or directory` 로 실패합니다.

### 딸린 문서 경로 규칙 (또 다릅니다)

`docs/*.md` · `README.md` · `WORKER.md` 안에서는 `${CLAUDE_SKILL_DIR}` 을 **경로로 쓰지
마세요.** 치환은 SKILL.md 본문과 `allowed-tools` 에서만 일어나고, 딸린 문서는 에이전트가 읽든
사람이 읽든 Read 도구로 읽혀 날문자로 남습니다. 기준은 "에이전트용이냐 사람용이냐"가 아니라
**"하네스를 거치느냐"** 입니다. 규약을 설명하려고 변수 **이름만** 부르는 건 괜찮습니다.

- 서브에이전트(`WORKER.md`)에는 게이트가 프롬프트에 **치환된 절대경로**를 실어 보냅니다 — 읽을
  문서의 절대경로와, 그 문서 안의 상대 참조를 풀 기준 디렉토리 둘 다 필요합니다.
- 사람이 셸에서 직접 돌릴 예시는 `$SKILL_DIR` 을 쓰고, **그 값을 정하는 방법을 문서에 적으세요**
  (플러그인 캐시 경로 / 클론 경로). 문서가 여러 개면 README 한 곳에 두고 나머지는 링크합니다.

`tools/validate-hook-paths.sh` 와 `tools/validate-body-paths.sh` 가 각각을 CI 에서 검사합니다.
자세한 배경은 저장소의 `docs/hook-patterns.md` 에 있습니다.

### 일반적인 훅 패턴

**1. 자동 의존성 설치 (PreToolUse):**
```yaml
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(tool-name *)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/skill-name/scripts/check-deps.sh\""
          description: "tool-name 자동 설치"
```

**2. 로그 자동 요약 (PostToolUse):**
```yaml
hooks:
  PostToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(command * log*)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/skill-name/scripts/summarize-log.sh\""
          description: "로그 요약"
```

**3. 시크릿 마스킹 (PostToolUse):**
```yaml
hooks:
  PostToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(*api*)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/skill-name/scripts/sanitize-output.sh\""
          description: "시크릿 마스킹"
```

> `PostToolWrite`는 실재하는 이벤트가 아닙니다. 출력 후처리는 `PostToolUse` + `if`로 씁니다.

**4. 훅 체이닝 (여러 훅 순차 실행):**
```yaml
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(kubectl *)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/skill-name/scripts/check-kubectl.sh\""
          description: "kubectl 확인"
        - type: command
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/skill-name/scripts/verify-context.sh\""
          description: "클러스터 확인"
        - type: file
          path: "${CLAUDE_PLUGIN_ROOT}/skill-name/context.json"
          description: "컨텍스트 로드"
```

### 이 스킬의 Hooks

(여기에 이 스킬이 사용하는 훅과 그 이유를 설명)

**사용하는 훅:**
- PreToolUse: (목적)
- PostToolUse: (목적)

**훅 실행 흐름:**
```
사용자 입력
    ↓
[PreToolUse] 의존성 확인
    ↓
도구 실행
    ↓
[PostToolUse] 결과 후처리
    ↓
사용자에게 결과 표시
```

## 필수 조건

### 환경 요구사항

- 요구사항 1
- 요구사항 2

### 의존성

```bash
# 설치 명령
install-tool
```

## 구현 단계

### 1단계: 준비

첫 번째 단계에서 수행할 작업을 설명합니다.

### 2단계: 구현

두 번째 단계에서 수행할 작업을 설명합니다.

### 3단계: 테스트

테스트 방법을 설명합니다.

## 확장 방법

새로운 기능을 추가하는 방법을 설명합니다.

### 새 기능 추가

1. 단계 1
2. 단계 2

## 테스트

### 단위 테스트

```bash
# 테스트 실행
run-test
```

### 통합 테스트

```bash
# 통합 테스트 실행
run-integration-test
```

### 훅 테스트

훅이 올바르게 동작하는지 테스트합니다:

```bash
# 1. 훅 스크립트 실행 권한 확인
chmod +x skills/category/skill-name/scripts/*.sh

# 2. 훅 스크립트 단독 실행
bash skills/category/skill-name/scripts/check-deps.sh

# 3. 훅 트리거 조건 확인
# matcher 패턴에 맞는 명령 실행하여 훅이 트리거되는지 확인
```

**훅 디버깅:**
```bash
# 스크립트에 디버깅 추가
#!/bin/bash
set -x  # 모든 명령 출력

echo "# DEBUG: Running hook"
echo "# DEBUG: Args: $@"
```

## 배포

배포 절차를 설명합니다.

### 릴리스 체크리스트

- [ ] 테스트 통과
- [ ] 문서 업데이트
- [ ] 버전 bump
- [ ] CHANGELOG.md 업데이트

## 참고

- [사용자 문서](README.md)
- [레퍼런스](REFERENCE.md)
