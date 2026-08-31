---
name: career-memoir-compiler
description: "인터뷰 기록을 충실한 산문 초안으로 컴파일한다. '회고 초안 만들어', '정리 시작' 같은 요청이 있을 때 사용. 인터뷰 진행은 career-memoir-interviewer 담당 — 이 스킬은 질문하지 않고 대화하지 않는다."
version: "1.0.0"
context: inline
language: "korean"
---

# career-memoir-compiler — 인터뷰 기록 → 산문 초안 컴파일

## 개요

사용자가 "정리 시작"을 선언한 뒤, 인터뷰 기록(세션 원문·압축 상태)을 충실한 산문 초안으로
변환한다. 원칙은 **추출 not 생성** — 초안의 모든 문장은 세션 원문·인용 발언에 근거해야 하고,
컴파일러는 창작하지 않는다.

이 파일은 게이트다. 게이트를 통과하면 컴파일 오케스트레이션(7단계 프로토콜)은
`WORKER.md` 본문을 `general-purpose` 서브에이전트로 실행한다.

## 프로젝트 루트 (vault)

- vault 프로젝트 루트: `/Users/keaton/Workspace/Obsidian/notes/`
- 이 프로젝트 디렉터리: `/Users/keaton/Workspace/Obsidian/notes/초안/경력 회고 에세이/`
  - 압축 상태(Spine·장면표·공개 경계): `interview-state.md`
  - 세션 원문: `sessions/YYYY-MM-DD.md`
  - 초안 산출: `draft-vN.md`

vault를 옮기면 이 문서와 `WORKER.md`를 함께 고친다.

## 트리거와 담당 범위

- 트리거: "회고 초안 만들어", "정리 시작" 등 산문 변환 요청.
- **인터뷰 진행은 career-memoir-interviewer 담당** — 이 스킬은 질문하지 않고 대화하지
  않는다. 인터뷰어의 정리 게이트에서 사용자의 "정리 시작" 선언으로 넘어온다.

## 전제 게이트 (프로토콜 0단계)

두 조건을 모두 확인한다. 어느 하나라도 미완료면 **무엇이 남았는지 보고하고 중단**한다 —
게이트를 통과한 것처럼 컴파일을 시작하지 않는다.

1. **사용자의 명시적 정리 선언** — 이 대화에서 사용자가 "정리 시작"(또는 이에 준하는 명시적
   산문 변환 선언)을 했는가. 없으면 "정리 시작" 선언을 안내하고 중단한다.
2. **Stage 2 완료 신호** — career-memoir-interviewer 스킬의 `assets/state-schema.md`(§4)
   정의 그대로 판정한다:

   > **Stage 2 완료 = 압축 상태 frontmatter `stage: 2` + `## 장면표` 섹션이 존재하고 비어 있지 않음(장면표에 데이터 행 1개 이상).**

   판정 대상 파일: `/Users/keaton/Workspace/Obsidian/notes/초안/경력 회고 에세이/interview-state.md`

   이 판정식은 state-schema.md와 **동일 문구**로 유지해야 한다 — 어느 한쪽에서 문구가
   달라지면 게이트 판정이 갈린다.

미완료 시 보고 예시: "압축 상태 `stage: 1`입니다 — Stage 1(시기별 심층)이 끝나지 않았고
장면표가 없습니다. 인터뷰를 마친 뒤 다시 '정리 시작'을 선언해 주세요."

## 워커 실행 (게이트 통과 시)

`general-purpose` 서브에이전트를 띄워 `WORKER.md` 오케스트레이션을 실행한다.
`${CLAUDE_SKILL_DIR}` 치환은 SKILL.md 본문에서만 일어나므로, 워커 프롬프트에는
**치환된 절대경로 세 개**를 실어 보낸다:

1. 읽어야 할 본문: `${CLAUDE_SKILL_DIR}/WORKER.md`의 절대경로
2. 참조 문서의 기준 디렉토리: `${CLAUDE_SKILL_DIR}`의 절대경로 (WORKER.md가 `docs/`를
   상대경로로 가리키면, 이게 없으면 워커가 **자기 CWD 기준**으로 찾아 실패한다)
3. 상태 스키마: career-memoir-interviewer 스킬 소속 `assets/state-schema.md`의 절대경로.
   이 스킬(career-memoir-compiler)에는 assets/ 사본이 없으므로 형제 경로
   `${CLAUDE_SKILL_DIR}/../career-memoir-interviewer/assets/state-schema.md`를 절대경로로
   풀어 전달한다 — 워커가 형제 디렉토리 홉을 추측하게 두지 않는다

vault 데이터 경로는 위 "프로젝트 루트" 절의 절대경로를 그대로 전달한다.

이 게이트 자신에게 스폰 도구(하네스에 따라 `Task` 또는 `Agent`)가 없다면 이 실행은
서브에이전트 컨텍스트일 가능성이 높다(중첩 스폰 차단 — 플러그인 문제가 아니다).
`SendMessage`로 에이전트 타입 이름을 호출하지 말고, "새 메인 세션에서 이 스킬을 다시
실행"할 것을 안내하고 중단한다.

워커가 `NEEDS_DECISION`을 반환하면(프로토콜 진행 중 예상 못한 결정) `AskUserQuestion`으로
묻고, 새 워커를 만들지 말고 `SendMessage`로 기존 워커를 재개시킨다. 워커가 재감사 상한
초과를 보고하면 그 내용을 사용자에게 그대로 전달하고 거기서 끝낸다 — 자율 판단으로
컴파일을 계속하지 않는다.

## 비-목표

- **윤문·문체 수정·사실 추가 창작 금지** — 문체는 im-not-ai 인계 후 `/humanize-korean`의
  몫이다.
- **구조 변경 제안은 사용자 승인 후에만** — 장면 순서·구성을 자의로 바꾸지 않는다.

## 다음 단계 인계 (im-not-ai)

컴파일이 끝나고 의미·구조가 확정되면 사용자에게 `/ce-doc-review` → `/humanize-korean`
순서 실행을 권고한다(의미 리뷰를 먼저 끝내야 이후 윤문이 무효화되지 않는다).

**윤문은 이 스킬이 직접 수행하지 않는다.**

## 관련 문서

- [사용자 문서](README.md)
- [문서 인덱스](docs/INDEX.md)
- [구현 가이드](docs/GUIDELINES.md)
- [레퍼런스](docs/REFERENCE.md)
