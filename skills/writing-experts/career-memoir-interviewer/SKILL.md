---
name: career-memoir-interviewer
description: "경력 회고 에세이를 위한 저자 인터뷰를 진행한다. 한 번에 한 질문, 패러프레이즈 선행, 감정·고민 명시 질문, 세션 원문 축적과 holding 큐로 세션 간 연속성 유지. 경력 회고 인터뷰, 회고 인터뷰 시작, 인터뷰 이어서 요청으로 호출. 산문 작성·정리·초안 생성은 career-memoir-compiler 담당."
version: "1.0.0"
context: inline
language: "korean"
---

# career-memoir-interviewer 스킬

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

## 사용자 확인

inline 스킬이므로 `AskUserQuestion` 을 직접 호출할 수 있습니다. 무엇을 물을지와
선택지를 여기에 적으세요.

## 관련 문서

- [사용자 문서](README.md)
- [문서 인덱스](docs/INDEX.md)
- [구현 가이드](docs/GUIDELINES.md)
