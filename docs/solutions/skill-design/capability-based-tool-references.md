---
module: writing-experts
date: 2026-08-31
problem_type: design_pattern
component: skill-design
severity: low
applies_when: "writing agent skill docs that reference harness tools, delegate work to sub-agents, or must degrade gracefully in spawn-restricted contexts"
symptoms:
  - "에이전트가 문서대로 `Task` 도구를 찾았으나 하네스의 실제 스폰 도구는 `Agent`라 탐색 실패 후 도구 부재로 오진"
  - "스폰 실패를 SendMessage로 재시도해 `No agent named 'X' is reachable` 오류 발생"
  - "스폰 불가 판정 후 파이프라인 단계를 통째로 생략하거나 생성-감사를 같은 컨텍스트에서 자체 수행해 독립성 훼손"
root_cause: "`inadequate_documentation` — 스킬 문서가 하네스별로 이름이 다른 도구를 고유명사처럼 고정 표기해, 에이전트가 도구 존재 여부를 도구명 검색으로 판정하게 만듦"
resolution_type: documentation_update
tags:
  - agent-native
  - tool-reference
  - spawn
  - degraded-environment
  - skill-authoring
---

# 스킬 문서의 도구 지칭은 능력 기반으로 — 하네스별 도구명 고정 표기의 실패

## Context

writing-experts 플러그인의 블로그 파이프라인 스킬(2026-08-26 추가)이 실사용에서 장애를 냈다. 블로그 컴파일
세션이 distiller 서브에이전트를 호출하려 했는데, 그 세션의 도구 집합에는 스폰 프리미티브가 없었다
(서브에이전트 컨텍스트 — 중첩 스폰이 하네스에 의해 차단된 상태). 세션은 ① 문서가 정한 `Task
도구`를 이름으로 검색해 실패하고, ② `SendMessage`로 에이전트 **타입 이름**을 호출해
`No agent named ... reachable` 오류를 받고, ③ "채널이 없다"고 결론 내렸다. 같은 날 벤치마크에서는
문서에 스폰 불가 계약이 없어 다른 런마다 행동이 갈렸다 — 감사 단계를 생략하거나, 생성-감사를 같은
컨텍스트에서 자체 수행해 검증 독립성을 포기하고 확정 경로까지 승격했다.

근본 원인은 스킬 문서의 두 가지 표기 관행이다. **하네스별로 이름이 다른 도구를 고유명사처럼 고정
표기**하면("Task 도구로 호출") 에이전트가 자기 하네스의 실제 도구 이름과 대조하다 실패하고, 지연
도구 검색으로 네이티브 도구 유무를 판정해 도구 부재로 오진한다. **스폰 프리미티브 부재 환경에 대한
행동 계약 부재**는 그 오진 이후의 행동을 문서화되지 않은 자의적 판단에 맡긴다.

## Guidance

`skills/writing-experts/blog-compiler/SKILL.md`의 "스폰 불가 환경" 절과 `WORKER.md`의
"서브에이전트 호출 규칙"에 다음 네 계약을 문서화했고, career-memoir 쌍에도 미러링했다.

1. **능력 기반 도구 지칭** — 도구를 고유명사 대신 능력으로 지칭한다: "스폰 도구(하네스에 따라
   `Task` 또는 `Agent`)로 `subagent_type`을 지정해 호출". 검색이 아니라 능력 매칭으로 도구를
   찾게 한다. 사례로, 이 표기로 바꾼 뒤 벤치마크 런이 실제 스폰 도구를 찾아 진짜 별개 worker·auditor
   서브에이전트로 완전 독립 파이프라인을 수행했다 — "Task" 고정 표기 런은 도구 부재 오진으로
   자체 감사로 흘러갔던 것과 대비된다.
2. **SendMessage 오용 차단** — "SendMessage는 이미 떠 있는 개체용이며 에이전트 타입 이름 호출은
   반드시 실패하고, 그 실패는 채널 없음의 근거가 아니다"를 명시한다. 등록 목록(에이전트 타입 노출)과
   스폰 도구 보유는 별개 축임도 함께 쓴다.
3. **저하 계약 — 역할별로 다르게** — 스폰이 불가하면 worker·distiller는 에이전트 정의 파일을 읽고
   그 계약대로 대리 수행하되 사실을 산출물에 명시한다. **auditor만 예외로 대리 금지**다 — 생성-감사
   분리가 검증 원칙이라, "새 메인 세션에서 감사만 수행"할 것을 안내하고 조립은 wip 임시 경로로
   보존한 채 중단한다(조립을 버리지 않는다).
4. **조건부 인라인 오케스트레이션** — 오케스트레이션 홉(게이트가 general-purpose 워커를 띄워
   WORKER.md를 읽게 하는 구조)의 목적은 주 대화 컨텍스트 보호다. 실행 주체가 이미 스폰된 격리
   컨텍스트면 홉은 순수 오버헤드이므로 직접 수행한다.

성능도 함께 검증했다. 동일 픽스처 벤치마크에서 계약 추가 후 정확성 10/10(before 7/10)을 유지하며,
조건부 인라인 + 근거 앵커 우선 독해(auditor가 각주 인용 위치 ±문맥을 정밀 독해하고 각주 없는 서술만
전수 대조 — `skills/writing-experts/agents/blog-auditor.md` 판정 방법 절)로 조립 구간을 1,048초에서 373초로 줄였다.

## Applicability

모든 서브에이전트 위임형 스킬에 적용한다. 특히: (a) 하네스마다 도구 이름·존재가 다른 환경에 배포되는
스킬, (b) 생성-감사 분리처럼 역할 독립성이 검증의 전제인 파이프라인, (c) 서브에이전트 안에서 스킬이
실행될 수 있는 구조(중첩 실행). 적용 시점은 스킬 작성 시다 — 장애가 나서가 아니라. 기존 스킬의 도구명
고정 표기는 `Task\|SendMessage` 검색으로 발견하고, 저하 계약은 스폰 프리미티브가 실제로 없는 서브에이전트
컨텍스트에서 해당 스킬을 실행해보는 것(자연 재현)으로 검증했다. 역방향 이식 대상: career-memoir 쌍(완료).
