# 프론트매터 레퍼런스

이 문서는 Agent Skills의 SKILL.md 프론트매터 필드에 대한 상세 레퍼런스입니다.

## 프론트매터 형식

SKILL.md 파일 상단에 YAML 블록으로 작성합니다:

```yaml
---
name: skill-name
description: 스킬 설명
dependencies:
  - tool>=version
version: 1.0.0
context: fork
agent: general-purpose
language: "korean"
hooks:
  PreToolUse:
    - matcher: "pattern"
      hooks:
        - type: command
          command: "bash script.sh"
          description: "설명"
---
```

## 필드 레퍼런스

### name

**타입**: `string`
**필수**: ✅
**형식**: kebab-case

스킬의 고유 이름입니다. 파일 이름과 일치해야 합니다.

```yaml
name: ci-log-doctor          # 올바름
name: CiLogDoctor             # 잘못됨
```

### description

**타입**: `string`
**필수**: ✅
**최대 길이**: 1,024자 (공식 명세)

스킬이 **무엇을 하는지**와 **언제 쓰는지(when-to-use 트리거)**를 함께 설명합니다. Claude는 이 description만 보고 여러 스킬 중 어느 것을 쓸지 결정하므로, 기능 나열에 그치지 말고 "어떤 상황/요청에서 이 스킬이 트리거되어야 하는지"를 구체적으로 적습니다. 트리거가 빈약하면 Claude가 스킬을 안 쓰고 넘어가는 undertrigger가 발생합니다. 공식 한도는 1,024자이며, 그 안에서 불필요하게 장황하지 않게 작성합니다.

```yaml
# 좋음: 기능 + when-to-use 트리거를 함께 담음
description: CI 파이프라인 실패를 진단하고 수정 제안을 제공합니다. CI 파이프라인이 실패하거나 워크플로 설정 파일 오류를 디버깅할 때 사용합니다

# 나쁨: 기능만 있고 "언제 쓰는지"가 없음 — undertrigger 위험
description: CI 파이프라인 진단 도구
```

### dependencies

**타입**: `array[string]`
**필수**: ❌

스킬 실행에 필요한 외부 도구나 라이브러리입니다.

```yaml
dependencies:
  - gh>=2.0.0
  - jq>=1.6

# 또는 버전 없이
dependencies:
  - gh
  - jq
```

### version

**타입**: `string`
**필수**: ✅
**형식**: 시맨틱 버전 (MAJOR.MINOR.PATCH)

```yaml
version: 1.0.0     # 초기 릴리스
version: 1.1.0     # 하위 호환 기능 추가
version: 2.0.0     # 하위 호환 불가 변경
version: 1.0.1     # 버그 수정
```

### context

**타입**: `string`
**필수**: ✅
**값**: `fork` | `inline`

스킬의 실행 컨텍스트를 지정합니다.

| 값 | 설명 | 사용 사례 |
|----|------|-----------|
| `fork` | 새 에이전트 인스턴스에서 실행 | 대부분의 스킬 |
| `inline` | 현재 대화에서 실행 | 간단한 유틸리티 |

```yaml
context: fork     # 일반적인 스킬
context: inline   # 간단한 헬퍼
```

#### 언제 사용하는가?

Context는 **설명으로 설득하는 옵션이 아니라**, `context:` 한 줄로 **실행 방식이 바뀌는 제어 레버**입니다.

첫 번째 기준은 **실행 중에 사용자에게 물어봐야 하는가**입니다. `fork` 스킬의 서브에이전트는 `AskUserQuestion`을 쓸 수 없으므로(아래 "fork 스킬에서 사용자 확인받기" 참고), 이 답이 곧 `context` 값을 정합니다.

`tools/validate-gate-context.sh`가 이 규칙을 CI에서 잡습니다 — `allowed-tools`에 `AskUserQuestion`이 있으면서 `context`가 `inline`이 아니면 오류입니다. 본문 산문의 "fork라서 쓸 수 없으니 멈추고 보고한다" 언급은 잡지 않습니다. 판단표 전문은 [스킬 명세](skill-specification.md#context-선택)에 있습니다.

물어봐야 한다면 그다음 기준은 **그 질문이 조사 결과에 의존하는가**입니다.

> **행 번호의 권위는 [스킬 명세](skill-specification.md#context-선택)에 있습니다.** 아래 표는 그
> 표를 줄여 옮긴 것이라 **행 번호가 반드시 일치해야 합니다** — 이 문서의 다른 곳(아래 "fork
> 스킬에서 사용자 확인받기")이 "4행", "6행" 같은 번호로 이 표를 가리키기 때문입니다. 실제로
> 2026-07-29 에 명세 쪽에만 4행이 추가되고 이 표는 6행짜리로 남아, 같은 문서가 자기 표에 없는
> 행을 인용하는 상태가 됐습니다(2026-07-30 코드리뷰에서 발견해 동기화). 명세를 고치면 여기도
> 같이 고치세요.

| # | 실행 중 상호작용 | 실행 방식 |
|---|---|---|
| 1 | 없음 — 조회·진단·자율 자동화 | `fork` |
| 2 | 여러 라운드 자유형 대화가 핵심 | `inline` |
| 3 | 고위험·비가역 게이트가 여러 곳 | `inline` |
| 4 | 비가역·외부 공개 게이트 1곳 · 질문이 조사에 의존하지 않음 | `inline` |
| 5 | 실행 본문이 길고 산출물이 큰데 *입력*은 조사 전 확정 가능 | `inline` 게이트 + `WORKER.md` 워커 |
| 6 | 질문이 조사 결과에 의존 · 가역 | `fork` + 반환-재개 |
| 7 | 질문이 조사 결과에 의존 · 비가역 · 게이트 1곳 | plan/apply 분할 (`fork` 스킬 2개) |

**여러 행에 걸치면 위쪽이 이깁니다** — 3행과 7행이 특히 겹치기 쉬운데, 그때는 3행(`inline`)입니다. 자세한 근거와 "위임 전에 그게 이 스킬의 책임인지 먼저 묻는다" 원칙은 [스킬 명세](skill-specification.md#context-선택) 참고.

**6행에는 단서가 붙습니다.** 게이트에 담을 내용이 **요약되면 선택 근거가 사라지는 크기**(수정 후보 목록, 제안서, 미리보기)라면 가역이라도 6행을 적용하지 않고 `inline` + `AskUserQuestion`으로 갑니다. 아래 "fork 스킬에서 사용자 확인받기"가 설명하듯 relay는 실행 보증이 아니라 관례이고, 요약 전달이 일어나면 사용자는 근거 없이 고르는데 스킬은 "확인받음"으로 성공 보고합니다. 실제 적용 사례는 `doc-review` v2.0.0과 `doc-visualize` v1.0.0입니다. 단서 전문은 [스킬 명세](skill-specification.md#context-선택)에 있습니다.

상호작용 여부가 같다면 그다음 기준이 컨텍스트 소모량입니다 — 탐색·로그 수집이 길수록 격리하는 쪽이 유리합니다. 단 `inline`에서는 **주 에이전트가 실행할 절차를 참조 문서로 빼는 것이 자기무효**입니다(그 에이전트가 다시 Read해서 같은 토큰이 같은 컨텍스트에 들어옵니다) — 옮길 수 있는 건 주 에이전트가 안 읽어도 되는 레퍼런스뿐입니다.

**fork 예제 (상호작용 없음: ci-log-doctor):**
```yaml
context: fork
```

**inline 예제 (대화형 수집이 핵심: commit-helper):**
```yaml
context: inline
```

#### fork 스킬에서 사용자 확인받기

**`context: fork` 스킬은 `AskUserQuestion`을 쓸 수 없습니다.** 이 도구는 모든 서브에이전트의 도구 목록에서 제외되므로, fork 스킬 본문에 "AskUserQuestion으로 묻는다"고 써도 실행되지 않습니다. `background: false`로도 풀리지 않습니다.

대신 **반환-재개** 방식을 씁니다 — 서브에이전트가 `PENDING_DECISION:`을 단독 줄로 반환하고(바로 다음 줄에 relay 지시문과 질문이 옴) 멈추면, 오케스트레이터가 사용자에게 원문 그대로 전달하고 답변을 받아 `SendMessage`로 재개시킵니다.

> [!WARNING]
> **반환-재개는 게이트가 지키는 동작이 *가역*일 때만 맞습니다.** 판정표 6행이 이 패턴의 조건을 "질문이 조사 결과에 의존 · **가역**"으로 못 박은 이유입니다. 게이트가 비가역·외부 공개 동작(MR 생성, 리뷰 코멘트 posting·resolve, 권한 변경, 원격 삭제)을 지킨다면 `fork` 자체가 틀린 선택이고, 3행(게이트 여러 곳)이나 4행(게이트 1곳 · 조사 비의존)대로 `context: inline` + `AskUserQuestion`으로 가야 합니다.
>
> **경계 판단 — "외부에 보인다"가 곧 "비가역"은 아닙니다.** 두 가지를 함께 보세요: **(1) 되돌리는 비용이 얼마인가** — 위키 페이지 게시는 버전 이력으로 되돌아가지만, resolve된 리뷰 코멘트나 이미 행사된 접근 권한은 그렇지 않습니다. **(2) 프롬프트 게이트가 뚫렸을 때 스크립트가 기본값으로 막아 주는가** — `--apply`/`--yes` 없이는 아무 일도 안 일어나거나 write-enable 환경변수가 필요한 구조라면 기본 경로가 안전합니다. 둘 다 유리하면 `fork` + relay로 남겨도 되고, 아니면 `inline`입니다. 실제 등급 판정 사례와 그 근거는 `docs/todo/pending-decision-relay-directive-rollout.md`에 있습니다.
>
> 아래 relay 지시문은 **실행 보증이 아니라 관례입니다.** 수신 측인 오케스트레이터는 우리 코드가 아니라 사용자의 메인 세션이라, 지시문을 넣어도 그렇게 파싱한다는 보증이 없습니다. 실제로 `pr-reviewer`(2026-07-29)에서 오케스트레이터가 리뷰 8건을 **대리 승인**하고 워커를 재개시켜, 사용자가 내용을 한 번도 보지 못한 채 코드 수정·커밋·원격 posting까지 진행됐습니다. `pr-creator`은 relay 지시문을 붙이고도 요약 전달을 겪었습니다.
>
> 되돌릴 수 없는 지점의 방어는 프롬프트가 아니라 **스크립트**에 두세요 — `pr-creator`의 `create-pr.sh --approved-head`처럼 스크립트가 스스로 현실을 확인하고 거부하는 형태입니다. 등급별 판정 사례는 `docs/todo/pending-decision-relay-directive-rollout.md` 참고.

```
# 잘못됨
AskUserQuestion으로 사용자에게 묻는다: "Maintainer도 포함할까요?"

# 올바름
PENDING_DECISION:
[오케스트레이터 지시] 아래 내용을 요약·재구성하지 말고 사용자에게 원문 그대로 보여주세요. 지금은 작업이 끝난 게 아니라 사용자 응답을 기다리며 멈춘 상태입니다.
Owner가 2명뿐입니다. Maintainer를 리뷰어에 포함할까요? (포함/직접 지정)
를 반환하고 실행을 멈춘다.
```

**오케스트레이터는 이 반환 텍스트를 요약·재구성하지 않고 사용자에게 원문 그대로 보여줘야 합니다.** 일반 서브에이전트 결과에 대해 오케스트레이터가 관례적으로 하는 "간결 요약 후 전달"은 `PENDING_DECISION` 반환에는 적용되지 않습니다 — 텍스트 안에 포함된 위 relay 지시문 한 줄이 그 예외를 명시적으로 선언합니다. SKILL.md 본문의 모든 `PENDING_DECISION` 반환은 `PENDING_DECISION:`을 단독 줄로 두고 그 바로 다음 줄에 이 지시문을 반드시 포함해야 합니다.

**`PENDING_DECISION`으로 멈춘 상태는 완료가 아니라 사용자 응답을 기다리는 일시정지입니다.** 하네스가 표시하는 완료성 알림 문구(예: "Agent ... finished")와 무관하게, 오케스트레이터는 이 반환을 재개 대기 상태로 취급하고 사용자 응답을 받으면 `SendMessage`로 같은 서브에이전트를 재개해야 합니다. "완료됨"이라는 알림 문구를 실제 작업 종료로 오인해 사용자에게 "완료됐습니다" 류의 메시지를 붙이지 마세요.

기존 스킬들의 `PENDING_DECISION` 문구는 "토큰+질문이 한 줄" 형태와 "토큰 다음 여러 줄 블록" 형태가 섞여 있었습니다. 이 표준은 질문 내용의 줄 수·형식을 통일하지 않습니다 — `PENDING_DECISION:` 토큰이 **단독으로 한 줄**에 오고, 그 바로 다음 줄에 위 relay 지시문이 오는 것만 표준화합니다. 기존 스킬을 고칠 때는 토큰과 질문이 같은 줄에 있으면 줄바꿈을 넣고 relay 지시문 한 줄만 추가하면 되며, 질문 본문 자체는 그대로 유지합니다.

SKILL.md 본문에는 위 "올바름"처럼 **동작만** 적습니다. 도구를 못 쓴다는 설명이나 왜 그런지는 이 문서(작성자용)에만 두세요 — 본문은 매 호출마다 서브에이전트 프롬프트로 들어가는 토큰입니다.

게이트가 여러 개면 **가까운 것끼리 묶어** 왕복을 줄이세요. 반대로 매 라운드가 자유 서술형 대화라면(예: 챕터별 피드백 반영) fork가 아니라 `inline`이 맞습니다.

**호출 전 모호성 해소 질문은 `description`에 둡니다.** fork 스킬은 호출되는 순간 SKILL.md 본문이 서브에이전트 프롬프트가 되므로, 오케스트레이터가 포크 *전에* 읽는 건 `description`뿐입니다. "모호하면 호출 전에 먼저 확인 질문을 하고 답을 인자에 담아 호출하세요"처럼 `description`에 적어야 실제로 동작합니다.

### background

**타입**: `boolean`
**필수**: ❌
**적용 대상**: `context: fork`일 때만
**기본값**: `true`

fork 스킬의 서브에이전트를 background로 돌릴지 여부입니다. 기본값(`true`)에서는 결과가 별도 턴의 알림으로 도착하므로, 반환-재개 체크포인트마다 지연이 생깁니다. `false`로 두면 호출한 턴 안에서 동기적으로 끝나 체크포인트가 즉시 도달합니다 — 대신 그동안 메인 세션이 블로킹됩니다.

**사전 작업이 짧고 게이트가 있는 스킬에 `false`를 씁니다.** 탐색이 오래 걸리는 스킬은 기본값을 유지하세요.

```yaml
context: fork
background: false
```

### agent

**타입**: `string`
**필수**: △ (`context: fork`일 때만 — `inline`에서는 의미 없는 필드이므로 넣지 않습니다)

fork 서브에이전트를 실행할 에이전트 유형입니다.

| 에이전트 | 설명 | 반환-재개 |
|---------|------|---|
| `general-purpose` | 일반 작업 | 가능 |
| `Explore` | 코드베이스 탐색 | **불가** |
| `Plan` | 계획 수립 | **불가** |

```yaml
context: fork
agent: general-purpose
```

#### 언제 사용하는가?

**게이트가 하나라도 있으면 `general-purpose`여야 합니다.** `Explore`와 `Plan`은 one-shot이라 재개할 에이전트 ID가 없습니다 — `PENDING_DECISION`을 반환하고 멈춰도 `SendMessage`로 되살릴 수 없어, 반환-재개 패턴이 성립하지 않습니다. `Explore`/`Plan`은 게이트가 전혀 없는 순수 조회·분석 스킬에서만 고려하세요.

`inline` 스킬에는 이 필드를 쓰지 않습니다. 서브에이전트를 띄우지 않으므로 값이 무시됩니다.

> 참고: Cursor/Kiro/Claude Code는 내장 agent 구성과 이름이 다를 수 있습니다.

### language

**타입**: `string`
**필수**: ✅
**값**: `"korean"` | `"english"` | 기타

스킬 콘텐츠의 주요 언어입니다.

```yaml
language: "korean"    # 한국어 스킬
language: "english"   # 영어 스킬
```

### hooks

**타입**: `object`
**필수**: ❌

이벤트 기반 훅을 정의합니다. **Claude Code의 핵심 차별화 기능**입니다.

#### 훅 타입

| 훅 | 설명 | 주요 사용 사례 |
|----|------|----------------|
| `PreToolUse` | 도구 사용 전 실행 | 의존성 체크, 자동 설치, 환경 검증 |
| `PostToolUse` | 도구 사용 후 실행 | 결과 파싱, 로그 수집, 요약 |
| `UserPromptSubmit` | 사용자 입력 제출 시 실행 | 입력 검증, 컨텍스트 주입 |
| `SessionStart` | 세션 시작 시 실행 | 초기 설정, 환경 로드 |
| `Stop` | 응답 종료 시 실행 | 마무리 작업, 후처리 |

> 참고: `matcher`는 도구 이벤트(`PreToolUse`, `PostToolUse` 등)에만 적용됩니다. `UserPromptSubmit`·`SessionStart`·`Stop` 같은 비도구 이벤트에는 `matcher`가 없습니다.

#### 훅 구조

```yaml
hooks:
  PreToolUse:
    - matcher: "RegexPattern"
      hooks:
        - type: command
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/skill/script.sh\""
          description: "이 훅의 설명"
        - type: file
          path: "${CLAUDE_PLUGIN_ROOT}/skill/config.json"
```

#### 언제 사용하는가? (적극 사용 권장)

**PreToolUse - 환경/의존성 준비 (권장):**
- ✅ 스킬 작동에 필요한 도구 설치/검증 (예: gh, jq)
- ✅ 실행 환경 조성 (설정 파일 준비, 권한/컨텍스트 체크)

**PostToolUse - 결과 검증 & 피드백 루프 (권장):**
- ✅ 긴 로그 요약/정규화
- ✅ 실패 원인 파싱 후 다음 액션 제안
- ✅ "결과가 맞는지"를 재검증하는 루프 구성

**출력 후처리 — `PostToolUse` + `if` 경로 필터 (시크릿 마스킹 등):**
- ✅ 시크릿 마스킹 (API 토큰, 비밀번호)
- ✅ 민감정보 제거/포맷팅
- ⚠️ `PostToolWrite`는 실재하는 이벤트가 아니다(`tools/validate-matchers.sh`가 거부). 파일 작성 후처리는 `PostToolUse`에 `if`로 대상 경로를 좁혀 구현한다

**실제 활용 예제:**

```yaml
# 패턴 1: 자동 의존성 설치
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(gh *)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/ci-log-doctor/scripts/check-deps.sh\""
          description: "gh 자동 설치"

# 패턴 2: CI 로그 요약
hooks:
  PostToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(gh run *)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/ci-log-doctor/scripts/summarize-ci-log.sh\""
          description: "CI 로그 요약"

# 패턴 3: 훅 체이닝 (여러 훅 순차 실행)
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(brew *)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/brew-formula/scripts/check-brew.sh\""
          description: "brew 확인"
        - type: command
          if: "Bash(brew *)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/brew-formula/scripts/verify-tap.sh\""
          description: "tap 확인"
        - type: file
          path: "${CLAUDE_PLUGIN_ROOT}/brew-formula/context.json"
          description: "컨텍스트 로드"
```

#### matcher

훅을 트리거할 **도구 이름**을 지정합니다. matcher는 명령 내용이 아니라 도구 이름하고만 비교되므로, `"Bash.*git"`처럼 명령 내용을 겨냥한 정규식은 비교 대상이 `"Bash"`뿐이라 **절대 발동하지 않습니다**. 명령 내용 기반 필터링은 아래 `if` 필드로 합니다.

```yaml
matcher: "Bash"                         # Bash 도구 사용 시
matcher: "Write|Edit"                   # 파일 쓰기/편집 도구
matcher: "(Read|Grep|Glob)"             # 파일 읽기 도구 사용 시
matcher: "mcp__server__tool"            # 특정 MCP 도구(도구 이름 정규식 가능)
```

#### if

특정 훅을 **명령 내용**으로 거르는 선택 필드입니다. matcher가 도구 이름으로 1차 선별한 뒤, `if`가 `도구(패턴)` 문법으로 2차 필터링합니다.

```yaml
if: "Bash(kubectl *)"                   # kubectl 명령일 때만
if: "Bash(git commit*)"                 # git commit 명령일 때만
if: "Write(**/skill-team-rules/*.md)"   # 특정 경로 파일을 쓸 때만
```

#### type

훅의 실행 유형입니다.

| 타입 | 설명 |
|------|------|
| `command` | 셸 명령 실행 |
| `file` | 파일 콘텐츠 삽입 |

```yaml
# command 타입
- type: command
  command: "bash \"${CLAUDE_PLUGIN_ROOT}/my-skill/scripts/check.sh\""
  description: "의존성 확인"

# file 타입
- type: file
  path: "${CLAUDE_PLUGIN_ROOT}/my-skill/context.json"
  description: "컨텍스트 정보 추가"
```

## 전체 예시

```yaml
---
name: ci-log-doctor
description: CI 파이프라인 실패를 진단하고 수정 제안을 제공합니다
dependencies:
  - gh>=2.0.0
  - jq>=1.6
version: 2.0.0
context: fork
agent: general-purpose
language: "korean"
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(gh *)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/ci-log-doctor/scripts/check-deps.sh\""
          description: "gh 설치 확인"
  PostToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(gh run *)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/ci-log-doctor/scripts/analyze-ci-config.sh\""
          description: "CI 설정 분석"
---
```

## 주의사항

1. **훅 경로**: 항상 `"bash \"${CLAUDE_PLUGIN_ROOT}/<skill>/scripts/<script>.sh\""` 형태.
   `${CLAUDE_PLUGIN_ROOT}`는 카테고리 설치 루트라서 **경로에 카테고리가 들어가지 않고**,
   따옴표는 필수입니다. `${CLAUDE_SKILL_DIR}`는 훅에서 치환되지 않습니다.
   자세한 배경과 근거는 [훅 패턴 > 훅 경로 규칙](hook-patterns.md#훅-경로-규칙) 참고
2. **YAML 형식**: 들여쓰기와 콜론 위치 정확히 지켜야 함
3. **버전 호환성**: breaking change가 있으면 major version 증가
4. **의존성**: 버전이 중요하면 명시, 그렇지 않으면 이름만

## 참고

- [스킬 명세](skill-specification.md)
- [명명 규칙](naming-conventions.md)
- [훅 패턴](hook-patterns.md)
