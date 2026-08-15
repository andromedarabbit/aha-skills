# 구현 가이드라인

이 문서는 스킬을 구현하고 확장할 때 참고하는 가이드라인이다.

## 개요

이 스킬은 런타임 코드가 없다 — 동작의 전부가 지시문이다: `SKILL.md`(게이트) +
`WORKER.md`(오케스트레이션) + 플러그인 에이전트 2종(`agents/career-memoir-compiler-worker.md`,
`agents/career-memoir-auditor.md`). 구현·확장은 이 문서들을 고치는 것과 같다.

## 아키텍처

```text
사용자: "정리 시작"
    ↓
SKILL.md 게이트 (inline, 주 대화)
    1) 명시적 정리 선언 확인
    2) Stage 2 완료 신호 판정 (state-schema.md와 동일 문구)
    ↓ 통과 시 dispatch (WORKER.md 절대경로 + 기준 디렉토리 절대경로)
general-purpose 서브에이전트가 WORKER.md 오케스트레이션 실행
    ├─ Task(subagent_type="career-memoir-compiler-worker")  — 초안 조립 (tools: Read, Write)
    ├─ Task(subagent_type="career-memoir-auditor")          — 충실성 감사 (tools: Read, Grep)
    ├─ 근거 없는 문장 교정 → 재감사 1회 (루프 상한 2회)
    ↓ 통과
vault 초안/경력 회고 에세이/draft-vN.md 저장 (rev 주석)
    ↓
im-not-ai 인계 (/ce-doc-review → /humanize-korean)
```

데이터는 전부 vault에 있다(스킬 디렉터리가 아님): 상태·세션 원문·초안 모두
`/Users/keaton/Workspace/Obsidian/notes/초안/경력 회고 에세이/` 아래.

## Context 선택

스킬의 실행 컨텍스트를 결정하는 기준이다.

### fork vs inline 결정 기준

Context는 `context:` 한 줄로 실행 방식을 제어하는 수단이다.

첫 번째 기준은 **실행 중에 사용자에게 물어봐야 하는가**이다 — `fork` 서브에이전트는
`AskUserQuestion`을 쓸 수 없기 때문이다.

- 상호작용 없음 → `fork`
- 여러 라운드 자유형 대화가 핵심이거나, 고위험·비가역 게이트가 여러 곳 → `inline`
- 조사 **전에** 의도 확정 가능 → `inline` 게이트 + `WORKER.md` 워커
- 질문이 조사 결과에 의존, 가역 → `fork` + `PENDING_DECISION` 반환-재개
- 질문이 조사 결과에 의존, 비가역 → plan/apply 분할

상호작용 여부가 같다면 그다음 기준이 컨텍스트 소모량이다. 판단표 전문은
`docs/skill-specification.md`의 "Context 선택"에 있다.

**이 스킬의 선택:** 실제 값은 `SKILL.md` 프론트매터와 [README의 "실행 방식"](../README.md)에
있다. 여기서는 값을 다시 적지 말고 **왜 그 갈래로 판정됐는지**만 쓴다 — 값을 세 곳에 적으면
갈라진다.

**선택 이유:** 시작과 끝이 사용자 상호작용이다 — 게이트는 주 대화의 사용자 선언("정리
시작")을 확인하고, 미통과·재감사 상한 초과·NEEDS_DECISION은 사용자에게 보고하거나
`AskUserQuestion`으로 처리해야 한다. 무거운 컴파일 본문은 WORKER.md 워커로 격리해 주
대화 컨텍스트를 보호한다.

## Agent 선택

작업 유형에 따라 최적화된 에이전트를 선택한다.

### Agent Types 선택 기준

내장 agent (Claude Code 기준):

- `general-purpose` — 잘 모르겠으면 이것
- `Explore`, `Plan` — **one-shot이라 `SendMessage` 재개가 안 됩니다.** 승인 게이트가 있는
  스킬(반환-재개 패턴)에는 쓸 수 없습니다.

**이 스킬의 선택:** 오케스트레이션 워커는 `general-purpose` — 재감사 루프와
NEEDS_DECISION 재개(`SendMessage`)를 처리해야 하기 때문이다. 생성·감사는 내장 agent가
아니라 **플러그인 에이전트**로 호출한다: `career-memoir-compiler-worker`(tools: Read,
Write)와 `career-memoir-auditor`(tools: Read, Grep). 도구 하드 제한이 각 역할의 안전
경계다 — 감사자는 초안을 수정할 수 없다. 게이트(SKILL.md) → 오케스트레이션(WORKER.md,
general-purpose) → 플러그인 에이전트의 오케스트레이션 중첩은 표준 동작이다.

## Hooks 구현

**이 스킬은 훅을 정의하지 않는다.** 런타임 스크립트가 없어 훅이 붙일 대상이 없다.
검증은 `scripts/tests/run.sh`(플러그인 agents/ frontmatter 무결성 검사 포함)가 담당한다.

훅 경로 규약이 필요해지는 시점(스크립트 추가 시)에는 저장소의 `docs/hook-patterns.md`와
`scaffold`가 만든 규약을 따른다 — 이 문서에 복사해 두지 않는다(단일 source of truth).

### 딸린 문서 경로 규칙

`docs/*.md` · `README.md` · `WORKER.md` 안에서는 `${CLAUDE_SKILL_DIR}`을 **경로로 쓰지
마세요.** 치환은 SKILL.md 본문과 `allowed-tools`에서만 일어나고, 딸린 문서는 에이전트가
읽든 사람이 읽든 Read 도구로 읽혀 날문자로 남습니다. 기준은 "에이전트용이냐 사람용이냐"가
아니라 **"하네스를 거치느냐"** 입니다. 규약을 설명하려고 변수 **이름만** 부르는 건
괜찮습니다.

- 서브에이전트(`WORKER.md`)에는 게이트가 프롬프트에 **치환된 절대경로**를 실어 보낸다 —
  읽을 문서(WORKER.md)의 절대경로와, 그 문서 안의 상대 참조를 풀 기준 디렉토리 둘 다.
- 이 스킬의 실제 데이터 경로(vault)는 사람이 읽어도 유효한 고정 절대경로이므로 그대로
  적는다.

## 유지보수 규칙 (이 스킬 고유)

- **게이트 판정식은 문구 단위로 고정** — SKILL.md의 Stage 2 완료 신호 판정식은
  career-memoir-interviewer의 `assets/state-schema.md`(§4)와 동일 문구를 유지한다.
  판정식을 고칠 땐 양쪽을 같이 고친다.
- **루프 상한 2회·버전 규칙은 WORKER.md가 source of truth** — 초안 저장 경로·N 증가
  시점을 바꿀 때 WORKER.md와 README를 함께 갱신한다.
- **에이전트 정의 파일(`agents/*.md`)은 이 스킬 디렉터리 밖**에 있다 — 호출 계약 요약은
  [REFERENCE.md](REFERENCE.md), 변경은 에이전트 정의 파일에서 한다.
- vault를 옮기면 SKILL.md·WORKER.md·README의 절대경로를 함께 고친다.

## 테스트

```bash
bash skills/writing-experts/career-memoir-compiler/scripts/tests/run.sh
```

에이전트 frontmatter 무결성(distiller/compiler-worker/auditor 3종의 존재·name/tools 필드·
허용목록 준수)을 검사한다. 스펙의 검증 8항목(문구 grep·판정식 대조)은 저장소 테스트가
아니라 리뷰 시점에 수동 대조한다.

## 확장 방법

- 새 에이전트를 파이프라인에 추가할 때: `agents/`에 정의하고 WORKER.md 프로토콜에 호출
  단계를 끼워 넣는다. `scripts/tests/run.sh`의 `check_agent` 목록에도 추가한다.
- 컴파일 정책 변경(루프 상한·버전 규칙·통과 정의)은 WORKER.md만 고치고, 이 문서의
  유지보수 규칙과 상충하지 않게 한다.
