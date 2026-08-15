---
name: career-memoir-compiler
description: "인터뷰 기록을 충실한 산문 초안으로 컴파일한다. 회고 초안 만들어, 정리 시작 요청으로 호출. 인터뷰 진행은 career-memoir-interviewer 담당 — 질문하지 않고 대화하지 않는다."
version: "1.0.0"
context: inline
language: "korean"
---

# career-memoir-compiler 스킬

## 개요

이 스킬의 목적과 기능을 설명합니다.

## 스크립트 경로 (먼저 읽을 것)

이 스킬의 스크립트는 `${CLAUDE_SKILL_DIR}` 아래에 있습니다. 하네스가 SKILL.md 를 넘겨줄 때 이
변수를 **스킬 디렉토리 절대경로로 미리 치환**하므로, 아래 형태를 그대로 실행하면 됩니다.

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/<script>.sh"
```

- 뒤에 카테고리(`writing-experts`)나 스킬 이름을 덧붙이지 마세요 — 이 변수가 이미 스킬 디렉토리입니다
- 따옴표는 필수입니다. 치환된 설치 경로에 공백이 들어갈 수 있습니다
- CWD 기준 상대경로로 부르지 마세요. 플러그인으로 설치된 환경에는 그 경로가 없어서 첫 호출부터
  `No such file or directory` 로 실패합니다
- 프론트매터 `hooks:` 는 `${CLAUDE_PLUGIN_ROOT}` 규약을 씁니다 — **본문과 훅의 변수가
  다릅니다.** 서로 바꿔 쓰면 치환되지 않고 조용히 깨집니다

## 사용 방법

스킬을 사용하는 방법을 단계별로 설명합니다:

1. 단계 1
2. 단계 2
3. 단계 3

## 예시

사용 예시를 보여줍니다:

```bash
# 예시 명령
command argument
```

## 1. 의도 확정 (게이트)

조사·탐색을 시작하기 **전에**, 필요한 것만 `AskUserQuestion` 으로 묻습니다.
이미 대화에서 알 수 있는 값은 묻지 말고 채운 뒤 확인만 받으세요. 게이트는 얇게 유지합니다.

## 2. Intent Contract 구성

답변을 아래로 압축합니다. 원 대화나 중간 추론은 옮기지 않습니다.

```yaml
goal: 사용자가 달성하려는 결과
scope:
  in: [포함]
  out: [제외]
constraints: [기술·정책·호환성]
acceptance_criteria: [완료 판정 기준]
decisions:
  - question: 확정한 선택
    answer: 사용자 답
```

## 3. 워커 실행

`general-purpose` 에이전트를 띄우면서 `${CLAUDE_SKILL_DIR}/WORKER.md` 를 읽고 따르라는
지시와 Contract 만 전달합니다. 탐색 로그·파일 읽기·중간 추론은 전부 워커에 남고,
주 대화에는 워커의 짧은 최종 요약만 돌아옵니다.

**워커 프롬프트에는 치환된 절대경로 두 개를 실어 보냅니다.** `${CLAUDE_SKILL_DIR}` 치환은
SKILL.md 본문과 `allowed-tools` 에서만 일어나므로, 워커가 Read 로 읽는 `WORKER.md` 안에서는
이 변수가 날문자로 남습니다:

1. 읽어야 할 본문: `${CLAUDE_SKILL_DIR}/WORKER.md` 의 절대경로
2. 참조 문서의 기준 디렉토리: `${CLAUDE_SKILL_DIR}` 의 절대경로 (WORKER.md 가 `docs/` 나
   `scripts/` 를 상대경로로 가리키면, 이게 없으면 워커가 **자기 CWD 기준**으로 찾아 실패합니다)

워커가 `NEEDS_DECISION` 을 반환하면(의도 확정 단계에서 예상하지 못한 결정) 여기서
`AskUserQuestion` 으로 묻고, 새 워커를 만들지 말고 `SendMessage` 로 기존 워커를
재개시킵니다.

## 관련 문서

- [사용자 문서](README.md)
- [문서 인덱스](docs/INDEX.md)
- [구현 가이드](docs/GUIDELINES.md)
