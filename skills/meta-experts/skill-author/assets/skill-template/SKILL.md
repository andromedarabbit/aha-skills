---
name: skill-name
# Description 작성 가이드:
# - "무엇을 하는지 + 언제 쓰는지(when-to-use 트리거)"를 함께 적으세요
# - Claude가 올바른 스킬을 고르는 근거입니다. 트리거가 빈약하면 스킬을 안 쓰고 넘어갑니다
# - 공식 한도는 1024자. 그 안에서 불필요하게 장황하지 않게
description: '무엇을 하는 스킬인지 + 언제 사용하는지 (예: "...를 처리합니다. ...할 때 사용")'
dependencies:
  - tool-name>=version
version: 1.0.0

# context / agent / background 선택은 docs/skill-specification.md 의 "Context 선택" 판단표를 따르세요.
# 요약: 실행 중 사용자에게 물어야 하면 inline, 아니면 fork.
#       fork 서브에이전트는 AskUserQuestion 을 쓸 수 없습니다.
# agent 는 context: fork 일 때만 씁니다. 게이트가 있으면 반드시 general-purpose
# (Explore/Plan 은 one-shot 이라 SendMessage 재개가 안 됩니다).
context: fork
agent: general-purpose

language: "korean"

# Hooks: 이벤트 기반 자동화 (Claude Code 고유 기능)
# PreToolUse: 도구 실행 전 (의존성 체크, 자동 설치, 환경 검증)
# PostToolUse: 도구 실행 후 (결과 파싱, 로그 요약, 시크릿 마스킹·출력 후처리)
# matcher는 도구 이름(Bash, Edit 등)만 매칭한다. 명령 내용은 if로 거른다
#
# 훅 경로는 반드시 ${CLAUDE_PLUGIN_ROOT} 기준으로 쓴다 (본문은 다른 변수를 쓴다 — 아래 참고):
#   - ${CLAUDE_PLUGIN_ROOT} 는 플러그인(= 카테고리) 설치 루트다.
#     → 경로에 **카테고리를 넣지 않는다**. `${CLAUDE_PLUGIN_ROOT}/<skill>/scripts/...`
#   - 따옴표는 필수다. 설치 경로에 공백이 들어갈 수 있다
#   - ${CLAUDE_SKILL_DIR} 는 훅에서 치환되지 않는다 (본문·allowed-tools 전용)
#   - CWD 기준 상대경로는 플러그인 설치 환경에서 조용히 실행되지 않는다 → 금지
hooks:
  PreToolUse:
    # 예: glab 명령 실행 전 자동 설치
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(glab *)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/skill-name/scripts/script-name.sh\""
          description: "이 훅이 하는 일에 대한 설명"

  # PostToolUse:
  #   # 예: CI 로그 자동 요약
  #   - matcher: "Bash"
  #     hooks:
  #       - type: command
  #         if: "Bash(glab ci *)"
  #         command: "bash \"${CLAUDE_PLUGIN_ROOT}/skill-name/scripts/summarize-log.sh\""
  #         description: "로그 요약"
---

# skill-name 스킬

## 개요

이 스킬의 목적과 기능을 설명합니다.

## 스크립트 경로 (먼저 읽을 것)

이 스킬의 스크립트는 `${CLAUDE_SKILL_DIR}` 아래에 있습니다. 하네스가 SKILL.md 를 넘겨줄 때 이
변수를 **스킬 디렉토리 절대경로로 미리 치환**하므로, 아래 형태를 그대로 실행하면 됩니다.

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/<script>.sh"
```

- 뒤에 카테고리나 스킬 이름을 덧붙이지 마세요 — 이 변수가 **이미 스킬 디렉토리 자체**입니다
- 따옴표는 필수입니다. 치환된 설치 경로에 공백이 들어갈 수 있습니다
- CWD 기준 상대경로로 부르지 마세요. 플러그인으로 설치된 환경에는 그 경로가 없어서 첫 호출부터
  `No such file or directory` 로 실패합니다
- 프론트매터 `hooks:` 는 `${CLAUDE_PLUGIN_ROOT}` 규약을 씁니다 — **본문과 훅의 변수가 다릅니다**
- `WORKER.md` 나 `docs/*.md` 같은 딸린 문서 안에서는 `${CLAUDE_SKILL_DIR}` 를 쓰지 마세요.
  치환은 본문과 `allowed-tools` 에서만 일어나므로, 서브에이전트에 넘길 때는 **치환된 절대경로**를
  프롬프트에 실어 보내야 합니다

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

## 주의사항

사용 시 주의할 점을 설명합니다.

## 관련 문서

- [사용자 문서](README.md)
- [구현 가이드](GUIDELINES.md)
