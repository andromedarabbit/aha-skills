# Agent Skills 명세

이 문서는 [Agent Skills 공식 명세](https://github.com/anthropics/skills)의 번역본입니다.

## 개요

Agent Skills는 Claude Code의 기능을 확장하는 재사용 가능한 워크플로우, 도구, 도메인별 지식입니다. 스킬은 프롬프트 엔지니어링을 코드처럼 버전 관리하고 공유할 수 있게 해줍니다.

## 스킬 구조

### 필수 파일

```
my-skill/
├── SKILL.md        # 스킬 정의 (프론트매터 포함)
├── README.md       # 사용자 문서
└── GUIDELINES.md   # 구현 가이드라인
```

### 선택적 파일

```
my-skill/
├── REFERENCE.md            # 명령어/API 레퍼런스
├── TROUBLESHOOTING.md      # 문제 해결 가이드
├── scripts/                # 훅에서 사용하는 헬퍼 스크립트
└── scripts/tests/          # 테스트 (run.sh 진입점 필수)
```

> **테스트 규칙:** `scripts/`가 있는 스킬은 `scripts/tests/run.sh`를 포함해야 합니다.
> 상세 가이드: [docs/testing-guide.md](testing-guide.md)

## SKILL.md 프론트매터

모든 스킬은 `SKILL.md` 파일 상단에 YAML 프론트매터를 포함해야 합니다:

```yaml
---
name: my-skill
description: 이 스킬이 무엇인지 간단한 설명
dependencies:
  - tool-name>=version
version: 1.0.0
context: fork
agent: general-purpose
language: "korean"
hooks:
  PreToolUse:
    - matcher: "RegexPattern"
      hooks:
        - type: command
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/my-skill/scripts/script.sh\""
          description: "이 훅이 하는 일 설명"
---
```

### 필드 설명

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `name` | string | ✅ | 스킬 이름 (kebab-case) |
| `description` | string | ✅ | 기능 + 언제 쓰는지(when-to-use)를 구체적으로 (최대 1024자) |
| `dependencies` | array | ❌ | 필요한 외부 도구 |
| `version` | string | ✅ | 시맨틱 버전 |
| `context` | string | ✅ | `fork` 또는 `inline` |
| `agent` | string | △ | 실행할 에이전트 유형 (`context: fork`일 때만 필수) |
| `background` | boolean | ❌ | `context: fork` 전용. 기본값 `true`, `false`면 호출한 턴 안에서 동기 실행 |
| `language` | string | ✅ | 콘텐츠 언어 (예: `"korean"`) |
| `hooks` | object | ❌ | 훅 정의 |

## 훅 (Hooks)

훅은 특정 이벤트가 발생할 때 실행되는 스크립트입니다. Claude Code의 핵심 차별화 기능 중 하나입니다.

### 사용 가능한 훅 타입

| 훅 타입 | 설명 | 주요 사용 사례 |
|---------|------|----------------|
| `PreToolUse` | 도구 사용 전 실행 | 의존성 체크, 자동 설치, 환경 검증 |
| `PostToolUse` | 도구 사용 후 실행 | 결과 파싱, 로그 수집 |
| `UserPromptSubmit` | 프롬프트 제출 시 실행 | 프롬프트 전처리, 컨텍스트 주입 |
| `SessionStart` | 세션 시작 시 실행 | 초기 환경 설정, 상태 점검 |
| `Stop` | 응답 종료 시 실행 | 마무리 정리, 후처리 |

> **참고**: `matcher`는 도구 이름에만 적용됩니다. 따라서 도구 이벤트 5종(`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `PermissionDenied`)만 `matcher`를 사용하고, `UserPromptSubmit`·`SessionStart`·`Stop` 같은 비(非)도구 이벤트는 `matcher`를 쓰지 않습니다.

### Hooks 실행 흐름

```
사용자 입력
    ↓
[PreToolUse Hook] ← 의존성 체크, 자동 설치
    ↓
도구 실행 (Bash, Read, Edit 등)
    ↓
[PostToolUse Hook] ← 결과 파싱, 로그 요약
    ↓
응답 생성
    ↓
[Stop Hook] ← 응답 종료 후 마무리 정리
    ↓
사용자에게 결과 표시
```

### 실전 활용 예제

#### 1. 자동 의존성 설치 (PreToolUse)

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

**효과**: 사용자가 수동으로 도구를 설치할 필요 없이 스킬이 자동으로 처리

#### 2. 로그 요약 (PostToolUse)

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

**효과**: 긴 CI 로그를 자동으로 요약하여 핵심 정보만 표시

#### 3. 시크릿 마스킹 (PostToolUse + if)

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

**효과**: API 토큰, 비밀번호 등 민감한 정보를 자동으로 마스킹

### 훅 구조

```yaml
hooks:
  PreToolUse:
    - matcher: "Bash"              # 도구 이름만. 정규식이 아니다
      hooks:
        - type: command            # command 또는 file
          if: "Bash(glab *)"       # 명령 내용은 여기서 거른다
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/my-skill/scripts/check.sh\""
          description: "설명"      # 훅 설명
```

### 훅 경로 규칙

**중요**: 모든 훅 명령은 `${CLAUDE_PLUGIN_ROOT}` 기준 경로를 따옴표로 감싸서 써야 합니다.
`${CLAUDE_PLUGIN_ROOT}`는 **플러그인(= 카테고리) 설치 루트**라서 경로에 카테고리가 들어가지
않습니다.

```yaml
# 올바름
command: "bash \"${CLAUDE_PLUGIN_ROOT}/my-skill/scripts/check.sh\""

# 잘못됨
command: "bash .claude/skills/gitlab-experts/my-skill/scripts/check.sh"  # 조용히 실행 안 됨
command: "bash \"${CLAUDE_PLUGIN_ROOT}/gitlab-experts/my-skill/scripts/check.sh\""  # 카테고리 중복
command: "bash \"${CLAUDE_SKILL_DIR}/scripts/check.sh\""  # 훅에서는 치환되지 않음
command: "bash scripts/check.sh"
command: "bash ../../my-skill/scripts/check.sh"
```

옛 `.claude/skills/...` 형태는 CWD 상대경로여서 플러그인 설치 환경에서 **에러 없이 조용히
실행되지 않습니다**. 배경·근거·검사 방법은 [훅 패턴 > 훅 경로 규칙](hook-patterns.md#훅-경로-규칙)
참고.

## 컨텍스트 타입

| 타입 | 설명 |
|------|------|
| `fork` | 새로운 에이전트 인스턴스에서 실행 |
| `inline` | 현재 대화 컨텍스트에서 실행 |

### Context 선택

첫 번째 기준은 **실행 중에 사용자에게 물어봐야 하는가**입니다. `fork` 스킬의 서브에이전트는 `AskUserQuestion`을 쓸 수 없으므로(모든 서브에이전트 공통), 이 답이 곧 실행 방식을 정합니다.

물어봐야 한다면, 두 번째 기준은 **그 질문이 조사 결과에 의존하는가**입니다. 의존하지 않으면 조사 전에 의도를 확정하고 실행 전체를 격리할 수 있습니다. 의존하면 조사를 먼저 하고 그 결과를 근거로 물어야 합니다.

> **여기서 "질문"은 실행에 필요한 *입력*을 말합니다 — 비가역 변경에 대한 *승인*이 아닙니다.**
> 승인은 무엇이 바뀌는지(diff·미리보기·영향 범위) 보여준 **뒤에** 받아야 하므로, 사용자가 인자로 미리
> 말해줬더라도 "조사 전에 확정 가능"으로 취급하면 안 됩니다. 그렇게 하면 승인이 Intent Contract에
> 미리 담겨 워커가 확인 없이 비가역 쓰기를 실행합니다. 입력은 게이트에서 앞당겨 받고, 승인은 그
> 지점까지 진행한 뒤 `NEEDS_DECISION`(게이트+워커)이나 `PENDING_DECISION`(fork)으로 되물으세요.
>
> 예: `usermanager`의 "cider.kim을 zeppelin-public에 추가할까요?"는 인자에서 바로 나오는 문장이지만
> LDAP 멤버십을 실제로 바꾸는 승인이므로 미리 받지 않습니다. `setup-emr-on-eks-airflow-connection`이
> 노드풀명·태그·EMR 버전 7개는 게이트에서 받고 prod 쓰기 승인만 Step 4 dry-run 뒤로 미루는 것이
> 같은 이유입니다.
>
> (이때 반환 텍스트에는 오케스트레이터용 relay 지시문을 반드시 포함합니다 — 정확한
> 문구는 [프론트매터 참조](frontmatter-reference.md#fork-스킬에서-사용자-확인받기).)

| # | 실행 중 상호작용 | 패턴 | 실행 방식 |
|---|---|---|---|
| 1 | 없음 — 조회·진단·자율 자동화 | 단일 fork | `context: fork` |
| 2 | 여러 라운드 자유형 대화가 스킬의 핵심 | inline 대화 | `context: inline` |
| 3 | 고위험·비가역 게이트가 여러 곳 | inline 게이트 | `context: inline` |
| 4 | 비가역·외부 공개 게이트 1곳 · 질문이 조사에 의존하지 않음 | inline 게이트 | `context: inline` |
| 5 | 실행 본문이 길고 산출물이 큰데 *입력*은 조사 전 확정 가능 | 게이트 + 워커 | `context: inline` 게이트 + `WORKER.md` |
| 6 | 질문이 조사 결과에 의존 · 가역 | fork + 반환-재개 | `context: fork` |
| 7 | 질문이 조사 결과에 의존 · 비가역 · 게이트 1곳 | plan/apply 분할 | `context: fork` 스킬 2개 |

**여러 행에 걸치면 위쪽이 이깁니다.** 특히 3행과 7행은 겹치기 쉬운데(비가역 게이트가 여러 개면
7행도 형식상 맞습니다), 그때는 3행 → `inline`입니다. plan/apply는 승인 지점이 **한 곳**이라
호출 경계로 깔끔하게 쪼개질 때만 값을 합니다 — 승인이 여러 단계에 흩어져 있으면 스킬을 3개 이상
쪼개야 하고, 트리거가 갈라지는 비용이 이득을 넘습니다.

**4행은 2026-07-29 등급 재산정에서 뒤늦게 발견된 빈칸입니다.** `usermanager`(LDAP 그룹 멤버십
변경)가 여기 걸리는데, 3행은 "게이트가 *여러 곳*", 6행은 "*가역*", 7행은 "조사 의존"이라 셋 다
정확히는 맞지 않아 그때까지 판정이 불가능했습니다. 판정 근거는 이렇습니다 — **실행 중 물어야 할
일이 있으면 fork의 격리 이득이 애초에 없습니다.** 질문이 조사에 의존하지 않으면 fork가 격리할
"조사"라는 게 존재하지 않고, 남는 건 게이트뿐인데 fork는 그 게이트를 `AskUserQuestion`이 아니라
텍스트 관례로만 표현할 수 있습니다. 게이트가 지키는 게 비가역·공개 동작이라면 그 관례는
방어가 아닙니다 — 실제로 `gitlab-mr-reviews`에서 오케스트레이터가 그 텍스트를 대신 승인해
리뷰 8건이 사용자 확인 없이 반영된 사고가 있었습니다(`docs/todo/pending-decision-relay-directive-rollout.md`).

**6행 단서 — 게이트 내용이 요약을 견디지 못하면 6행을 적용하지 않습니다.** 6행이 대리 승인
위험을 감수하는 근거는 "동작이 가역"이라는 점입니다. 그런데 6행은 **게이트에 담기는 내용이
요약돼 전달돼도 무해하다**는 것도 함께 전제하고 있고, 그 전제는 질문이 짧을 때만 성립합니다
(표준 예시 *"Owner가 2명뿐입니다. Maintainer를 리뷰어에 포함할까요?"*가 그 크기입니다).

게이트에 실어야 할 것이 **수정 후보 목록·제안서·미리보기**처럼 사용자가 읽어야만 고를 수 있는
크기라면, 오케스트레이터를 거치며 "N건이 있습니다, 진행할까요?"로 줄어드는 순간 선택 근거가
통째로 사라집니다. 사용자는 눈감고 고르는데 스킬은 "확인받음"으로 성공 보고합니다. relay 지시문을
붙여도 막지 못합니다 — `gitlab-mr-creation`에서 지시문을 붙이고도 요약 전달이 일어났습니다.
이 경우 **가역이라도 `inline` + `AskUserQuestion`**으로 갑니다.

해당 사례: `de-review`(v2.0.0, gated_auto 수정 후보 목록), `de-visualize`(v1.0.0, 후보 5개 ×
위치·형식·ASCII 미리보기·근거·우선순위). 판정 근거 전문은 각 스킬의 `docs/GUIDELINES.md`에
있습니다. 차선책으로 **제안서를 파일에 쓰고 반환은 짧게** 하는 파일 매개 방식이 있지만, 요약
전달만 막고 대리 승인은 남습니다(오케스트레이터가 파일을 안 열고 답할 수 있습니다).

**위임을 검토하기 전에 물어야 할 것: 그게 애초에 이 스킬의 책임인가.** 무거운 단계를 자체 워커로
감싸기 전에, 그 일이 남의 전문 영역이면 **전문 스킬에 위임하고 격리는 그쪽에 맡깁니다.** 예:
`gitlab-mr-creation`은 v3.0.0에서 테스트 실행과 코드리뷰를 워커로 감싸는 대신 아예 떼어내
`compound-engineering:ce-code-review` 같은 전문 스킬에 넘겼습니다 — 위임 대상이 자체 서브에이전트로
격리하므로 이쪽에 워커가 필요 없어졌고, 리뷰 도구가 바뀔 때 이 스킬이 따라 바뀌지 않게 됐습니다.

그리고 **중간 산출물이 커도 에이전트가 그 내용을 판단할 필요가 없다면 위임이 아니라 파일 매개가
답입니다** — 스크립트 출력을 임시 파일로 넘기면(`--pool-file` 등) 리다이렉트된 출력은 컨텍스트에
들어오지 않으므로 왕복 0회로 격리됩니다. 위임은 *책임이 남의 것일 때* 쓰고, 격리는 부수 효과입니다.

상호작용 여부가 같다면 그다음 기준은 컨텍스트 소모량입니다 — 탐색·로그 수집이 길수록 격리하는 쪽이 유리합니다.

이 판정은 `skill-author` 스킬이 대신 내려줍니다. 값을 손으로 고르지 마세요 — 상호작용 모델에서
`context`/`agent`/`background`/`WORKER.md` 여부를 파생시키는 구현은
`skills/meta-experts/skill-author/scripts/scaffold.sh` 한 곳뿐입니다.

#### 게이트 + 워커

실행 본문이 길고 중간 산출물이 큰데, 실행에 필요한 **입력**은 조사 전에 확정할 수 있을 때 씁니다.
비가역 변경에 대한 **승인**은 조사 후에 받아야 하므로 워커가 `NEEDS_DECISION`으로 되묻습니다 —
즉 "질문이 조사 결과에 의존하지 않을 때"가 아니라 "*입력*이 조사에 의존하지 않을 때"가 기준입니다
(`setup-emr-on-eks-airflow-connection`이 입력 7개는 게이트에서 받고 prod 쓰기 승인만 dry-run 뒤로
미루는 방식입니다). `SKILL.md`는 얇은 inline 게이트로 두고 — `AskUserQuestion`으로 입력을 확정한 뒤
Intent Contract로 압축 — 실행 본문은 `WORKER.md`에 두고 `general-purpose` 에이전트에게 Contract와 함께 넘깁니다. 탐색 로그·파일 읽기·중간 추론은 워커에 남고, 주 대화에는 짧은 최종 요약만 돌아옵니다.

워커가 확정되지 않은 결정을 만나면 `NEEDS_DECISION`을 반환하고 멈춥니다. 게이트가 사용자에게 묻고 `SendMessage`로 같은 워커를 재개시킵니다 — 주 경로가 아니라 예외 처리입니다.

**사례:** 대상 기간·계정·범위처럼 조사 이전에 확정되는 입력을 받는 스킬.

#### plan/apply 분할

질문이 조사 결과에 의존하고 그 결정이 비가역일 때 씁니다. `X-plan`(읽기 전용, 질문 없음, 계획 아티팩트만 산출)과 `X-apply`(계획 파일만 입력)로 나눕니다. 승인이 두 호출 **사이**에서 일어나므로 주 에이전트가 `AskUserQuestion`을 정상적으로 쓰고, 재개 프로토콜이 필요 없습니다. 계획 아티팩트가 감사 기록과 재실행 근거로 남습니다.

**후보(현재 구현 없음):** java-spring-refactor — "N개 파일 M LOC를 적용할까요?"는 diff를 뽑은 뒤에만 나오는 질문이라 이 갈래에 해당하지만, 실제로는 아직 `fork` + 반환-재개로 동작합니다. 이 저장소에 plan/apply를 채택한 스킬은 아직 없습니다.

#### fork

```yaml
context: fork
agent: general-purpose
```

**사례:** gitlab-ci-pipeline-doctor(상호작용 없음)

> `fork` 스킬의 사용자 확인은 `PENDING_DECISION:` 반환-재개 방식으로, 호출 전 모호성 해소 질문은 `description`에 담습니다 — 예시는 [프론트매터 참조](frontmatter-reference.md#fork-스킬에서-사용자-확인받기) 참고.

#### inline

```yaml
context: inline
```

**사례:** git-commit-helper(커밋 타입·scope·설명을 여러 라운드로 수집), jupyterhub-custom-image-rollout(prod go/no-go 포함 게이트 7곳), homebrew-formula(formula 값 확인 후 PR 제출), gitlab-mr-creation(비가역 공개 산출물 + 승인 게이트 2곳 — v2.x까지 `fork`였다가 v3.0.0에서 판정표 3행으로 교정)

## 에이전트 타입

### Agent 선택 가이드

#### 기본 추천

- **잘 모르겠으면 `general-purpose`**

#### 내장 agent 종류 (Claude Code)

> 플랫폼마다 내장 agent 구성은 다릅니다. (Cursor/Kiro/Claude Code 상이)

- `general-purpose`
- `Explore`
- `Plan`

### Agent 선택 가이드

- **잘 모르겠으면 `general-purpose`**

내장 agent 종류 (Claude Code):
- `general-purpose`
- `Explore`
- `Plan`

> 참고: 플랫폼/버전에 따라 내장 agent 구성은 달라질 수 있습니다.

## 스킬 등록

### 수동 설치

스킬을 Claude Code에서 사용하려면 `SKILL.md` 파일을 `.claude/skills/` 디렉토리에 배치하세요:

> 스킬이 어디에 설치되든 훅 `command` 는 `${CLAUDE_PLUGIN_ROOT}` 기준으로 씁니다.
> `.claude/skills/...` 를 훅 경로로 적으면 CWD 상대경로가 되어 해석되지 않습니다.

```
~/.claude/skills/
└── oh-my-skills/
    └── skills/
        └── my-skill/
            └── SKILL.md
```

### 마켓플레이스 설치

```bash
/plugin marketplace add https://git.baemin.in/dataplatform/oh-my-skills.git
/plugin install gitlab-experts@oh-my-skills
```

## 모범 사례

1. **명명 규칙**: kebab-case 사용 (`my-skill`, `gitlab-ci-doctor`)
2. **버전 관리**: 시맨틱 버전 준수
3. **문서화**: README.md에 사용자 관점의 문서 작성
4. **훅 경로**: 항상 전체 상대 경로 사용
5. **언어 일관성**: 한국어 스킬은 모든 콘텐츠를 한국어로 작성

## Python 코드 작성 가이드라인

### 패키지 관리

스킬에서 Python 코드를 작성할 때는 **uv**를 사용하여 의존성을 관리하세요.

#### uv로 의존성 설치

```bash
# 가상 환경 생성
uv venv

# 의존성 설치
uv pip install -r requirements.txt
```

#### uvx로 스크립트 실행

**권장**: `uvx`를 사용하면 가상 환경 없이 스크립트를 실행할 수 있습니다.

```bash
# 단일 스크립트 실행
uvx script.py

# 패키지에서 실행
uvx --from package-name script

# 인자 전달
uvx script.py --arg value
```

### 훅에서 Python 사용

#### Python 스크립트 훅 예시

```yaml
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(*python*analyze*)"
          command: "uvx \"${CLAUDE_PLUGIN_ROOT}/my-skill/scripts/analyze.py\""
          description: "로그 분석 스크립트 실행"
```

#### Python Shebang

```python
#!/usr/bin/env python3
# 또는
#!/usr/bin/env -S uvx --from
```

### Python 스크립트 구조

```
my-skill/
├── scripts/
│   ├── analyze.py        # Python 스크립트
│   ├── format.py         # 포맷팅 스크립트
│   └── requirements.txt  # 의존성 목록
└── SKILL.md
```

### 이유

- **빠른 의존성 해결**: uv는 pip보다 10-100배 빠름
- **일관된 환경 관리**: 모든 개발자가 동일한 환경 사용
- **venv 없이 실행**: uvx로 가상 환경 없이 즉시 실행 가능

## 참고

- [프론트매터 레퍼런스](frontmatter-reference.md)
- [명명 규칙](naming-conventions.md)
- [훅 패턴](hook-patterns.md)
- [한국어 콘텐츠 가이드라인](korean-content-guidelines.md)
