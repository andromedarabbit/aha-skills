---
module: writing-experts
date: 2026-08-25
problem_type: architecture_pattern
component: skill-design
severity: low
applies_when: building multi-agent interview or writing skills that must preserve verbatim author voice while producing publishable prose
tags:
  - career-memoir
  - interview-skill
  - two-layer-state
  - verbatim-preservation
  - agent-pipeline
---

# Career Memoir Interview Pipeline: Two-Layer State + Agent Pipeline

## Context

경력 회고 에세이를 쓰려면 인터뷰(재료 수집) → 초안 조립 → 감사 → 윤문이라는 긴 파이프라인이 필요하다. 각 단계에서 서로 다른 실패 모드가 있다: 인터뷰어가 저자의 말을 요약해 버리면 발언이 왜곡되고, 조립 에이전트가 없던 서술을 만들어내면 근거 없는 글이 되며, 윤문이 의미를 바꾸면 최종본이 저자의 것이 아니게 된다.

## Guidance

### 1. 상태를 두 계층으로 나눈다

- **세션 원문** (`sessions/ 디렉터리 내 날짜 파일 (예: sessions/2026-08-16.md)`): 저자 발언의 source of truth. 인터뷰어가 답변을 받을 때마다 append. **수정 금지, 추가만 허용.** pre-commit에서 이 경로를 exclude해 formatter가 원문을 재작성하지 못하게 한다.
- **압축 상태** (`interview-state.md`): 인터뷰 진행에 필요한 요약(Spine, 진행 표, 인용 은행, 패턴 노트). **distiller 서브에이전트가 세션 종료 시에만 갱신.** 인터뷰어는 직접 편집 금지(예외: 세션 로그 1줄, Spine 긴급 갱신).

왜 나누는가: 컨텍스트가 무한히 늘어나는 것을 막으면서 verbatim을 디스크에 보존한다. 압축 상태는 원문이 있으므로 언제든 재생성 가능하다.

### 2. 질문은 검증된 은행에서

질문을 매번 창작하지 않는다. `question-bank.md`에 StoryCorps, Storyworth 등 검증된 인터뷰 방법론에서 파생된 질문을 시기별 8질문(상황·문제·행동·전환점·당시 해석·현재 해석·남긴 것·관통 주제)에 매핑해 둔다. 후속 탐침은 `probe-taxonomy.md`의 4유형(clarification / elaboration / contrast / 감정) 중 하나를 선언하고 쓴다.

### 3. Stage 진행 + 저자 확인 게이트

- Stage 0 (개괄): 계기·성공 시기·정치·아웃사이더 등 핵심 질문 → Spine 확정
- Stage 1 (시기별 심층): 각 시기마다 8질문. 완료 판정은 "그 시기를 동료에게 설명할 수 있는가"
- Stage 2 (형식·주제): 구성 방식, 분량, 공개 경계, 장면표

각 Stage 완료는 저자가 명시적으로 확인해야 한다.

### 4. 시험 초안 비교로 양식 선택

하나의 양식으로 바로 쓰지 않는다. 잘 알려진 모범 글 3~4편을 선정해 각 양식·문체로 풀 초안을 병렬 작성하고 저자가 고르게 한다. 이 프로젝트에서는 Larson(연대기+자기해체), Majors(동기 진화+탈낭만화), Conrod(장면 중심+감정 절제), Tiny Struggles(postmortem 형식) 4편을 병렬 생성했다.

### 5. 감사(audit)로 근거 충실성 검증

초안의 각 서술이 세션 원문에 근거하는지 `auditor` 에이전트가 의미적으로 대조한다. 판정: A(verbatim 근거) / B(해석·재구성) / C(근거 없음) / D(과잉 일반화). C·D는 반드시 고친다. **압축 상태 파일의 인터뷰어 분석 라벨이 저자 발언으로 승격되는 오염 경로**를 특히 감시한다.

### 6. 윤문은 의미 불변 전제

`humanize-korean` 등 윤문 도구는 내용을 한 글자도 바꾸지 않고 문체·리듬만 다듬는다. 저자의 구어 표현·수치·고유명사·직접 발화는 불가침으로 지정한다.

## Why This Matters

각 단계의 실패 모드가 다르므로 각각 다른 방어가 필요하다:

| 단계 | 실패 모드 | 방어 |
|---|---|---|
| 인터뷰 | 발언 요약·왜곡 | verbatim append-only + pre-commit exclude |
| 조립 | 없던 서술 생성 | auditor 근거 대조 |
| 윤문 | 의미 드리프트 | 저자 발화 불가침 + gate |
| 전체 | 컨텍스트 폭발 | 두 계층 상태 |

## When to Apply

- 저자의 목소리가 산출물의 핵심 가치인 글쓰기 (회고, 인터뷰 아티클, 편지)
- 여러 세션에 걸친 대화에서 재료를 수집하는 워크플로우
- 에이전트가 산문을 생성·수정하는 파이프라인에서 근거 충실성이 요구될 때

## Examples

실제 파일 구조:

```
프로젝트 루트/
├── interview-state.md          ← 압축 상태 (distiller 갱신)
├── career-context.md           ← 배경자료 (발언 인용 금지)
├── sessions/
│   ├── 2026-08-16.md          ← 세션 1 원문 (append-only)
│   └── 2026-08-16-2.md        ← 세션 2 원문
├── trial-larson.md             ← 시험 초안 (양식 비교)
├── trial-conrod.md
├── draft-v1.md ~ v4.md        ← 작업 초안
└── 경력회고-최재훈.md          ← 최종본
```

pre-commit에서 세션 원문 보호:

```yaml
# .pre-commit-config.yaml 최상위 exclude
exclude: '...|프로젝트루트/sessions)/'
```

저자 발화 불가침 (윤문 지시):

```
저자 직접 발화("망했다"지 뭐겠어, 공회전, 떡 등)와
수치·고유명사는 한 글자도 바꾸지 않는다.
```
