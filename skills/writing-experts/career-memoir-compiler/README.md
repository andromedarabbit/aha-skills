# career-memoir-compiler

인터뷰 기록을 충실한 산문 초안으로 컴파일한다. 회고 초안 만들어, 정리 시작 요청으로 호출. 인터뷰 진행은 career-memoir-interviewer 담당 — 질문하지 않고 대화하지 않는다.

## 개요

경력 회고 인터뷰(career-memoir-interviewer)가 끝난 뒤, 사용자가 "정리 시작"을 선언하면
세션 원문과 압축 상태를 산문 초안으로 변환한다. 원칙은 **추출 not 생성** — 초안의 모든
문장은 인터뷰 기록에 근거해야 하고, 컴파일러는 창작·윤문하지 않는다.

두 단 구조다:

- `SKILL.md` — 게이트. 정리 선언과 Stage 2 완료 신호를 확인하고 통과 시 워커에 넘긴다.
- `WORKER.md` — 오케스트레이션 본문. general-purpose 서브에이전트가 7단계 프로토콜
  (조립 → 감사 → 교정 → 재감사 → 저장 → 인계)을 실행한다.

## 사용 방법

1. 인터뷰가 Stage 2(형식·주제)까지 끝나고 사용자가 "정리 시작"(또는 "회고 초안 만들어")을
   선언한다.
2. 게이트가 두 조건을 확인한다 — 명시적 정리 선언, Stage 2 완료 신호(압축 상태
   frontmatter `stage: 2` + 비어 있지 않은 장면표). 미완료면 무엇이 남았는지 보고하고
   중단한다.
3. 통과하면 컴파일 파이프라인이 자동으로 돈다:
   - compiler-worker 서브에이전트가 세션 원문에서 목소리를 파악해 장면 단위로 초안 조립
   - auditor 서브에이전트가 문장별 근거 충실성 감사 (worker와 별개 — 독립성)
   - 근거 없는 문장은 교정(삭제 또는 기록 내 근거로 대체) 후 재감사 1회 — 루프 상한 2회,
     초과 시 사용자 보고 후 중단
4. 통과하면 `초안/경력 회고 에세이/draft-vN.md` 로 저장한다. 버전 규칙은
   "N은 감사 통과 확정 시 증가, 교정 라운드는 같은 버전 내 수정".
5. 마지막에 im-not-ai 인계를 안내한다 — 의미·구조 확정 후 `/ce-doc-review` →
   `/humanize-korean` 순서. 윤문은 이 스킬이 직접 수행하지 않는다.

### 사용 예시

```text
사용자: 정리 시작
→ 게이트: interview-state.md 확인 (stage: 2 + 장면표 8행) → 통과
→ 워커: compiler-worker 조립 → auditor 감사 → 근거 없음 2건 → 교정 → 재감사 통과
→ 산출: draft-v2.md + 조립·감사 요약 + im-not-ai 인계 안내
```

## 요구사항

- aha-skills 플러그인(writing-experts) 설치 — 스킬과 플러그인 에이전트
  (`career-memoir-compiler-worker`, `career-memoir-auditor`)가 함께 노출된다.
- vault 데이터가 실재해야 한다:
  `/Users/keaton/Workspace/Obsidian/notes/초안/경력 회고 에세이/` 아래
  `interview-state.md`(stage: 2 + 장면표)와 `sessions/*.md`.
- 이 스킬에는 런타임 스크립트·훅이 없다. 동작의 전부가 지시문(마크다운)이다.

## 문제 해결

### 게이트에서 중단한다

정리 선언이 없거나 Stage 2 완료 신호가 없으면 정상 동작이다. 보고된 남은 작업을
인터뷰어(career-memoir-interviewer)로 마친 뒤 다시 시도한다.

### 서브에이전트가 파일을 못 찾는다

호출 프롬프트에 절대경로가 누락된 것이다. 상태 파일·세션 원문 목록·장면표·초안 저장
경로는 항상 절대경로로 전달한다(플러그인 에이전트는 vault 경로를 스스로 모른다).

### 재감사 상한(2회)을 초과했다

사용자에게 남은 문장과 교정 시도 내역을 보고하고 중단한다. 자율 판단으로 루프를
늘리지 않는다 — 남은 문장은 사용자가 직접 판단해 삭제하거나 인터뷰를 보충한다.

## 추가 정보

- [문서 인덱스](docs/INDEX.md)
- [구현 가이드](docs/GUIDELINES.md)
- [레퍼런스](docs/REFERENCE.md)

## 실행 방식

- 상호작용 모델: `gate-worker` — 의도를 앞에서 확정 가능 → 게이트(inline) + 워커(WORKER.md)
- `context: inline`

판정 근거는 [Context 선택 판단표](../../../docs/skill-specification.md)를 따립니다.
