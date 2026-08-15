# career-memoir-interviewer

경력 회고 에세이를 위한 저자 인터뷰를 진행하는 대화형 스킬. 한 번에 한 질문을 던지고 패러프레이즈로 확인하며, 저자의 발언을 세션 원문 파일에 verbatim으로 축적한다. 인터뷰어는 **산문을 쓰지 않는다** — 재료를 모으는 역할만 하고, 초안 작성은 `career-memoir-compiler`가 담당한다.

## 무엇을 하나

- 저자(사용자)와의 인터뷰로 회고 에세이 재료를 수집한다.
- 질문-답변을 Stage 0(개괄) → Stage 1(시기별 심층) → Stage 2(형식·주제·장면표) 순으로 진행한다.
- 세션 원문(`sessions/YYYY-MM-DD.md`)과 압축 상태(`interview-state.md`)의 이중 구조로 여러 세션에 걸친 진행을 유지한다.
- 세션 종료 시 `career-memoir-distiller` 서브에이전트가 원문을 압축 상태로 증류한다.

## 언제 쓰나

- 경력 회고 에세이의 재료를 새로 모으거나 이어서 모을 때.
- 산문 작성·정리·초안 생성이 필요할 때는 이 스킬이 아니라 `career-memoir-compiler`를 쓴다.

## 사용 예 (트리거 문구)

```text
경력 회고 인터뷰 시작하자
회고 인터뷰 이어서 진행해줘
인터뷰 이어서
```

세션 흐름 예:

1. "인터뷰 이어서" → 세션 시작 루틴(경력 맥락 로드, 압축 상태 복원, holding 큐 회수, 제안 승인)
2. 워밍업 → 본론(개방형 질문) → 클로징 성찰 질문
3. 세션 종료 → 반사 단계 → distiller 호출 → 다음 세션 예정 질문 1개 예고

## 상호작용 방식

`context: inline` 대화형 스킬이다. 저자와의 질문-답변 루프는 메인 컨텍스트에서 직접 돌고, 세션 종료 정리만 서브에이전트(distiller)로 위임한다.

## 데이터 위치

인터뷰 데이터는 스킬이 아니라 사용자 vault에 산다:

- 프로젝트 루트: `/Users/keaton/Workspace/Obsidian/notes/초안/경력 회고 에세이/`
- 세션 원문: `<루트>/sessions/YYYY-MM-DD.md`
- 압축 상태: `<루트>/interview-state.md`

## 관련 문서

- [문서 인덱스](docs/INDEX.md)
- [구현 가이드](docs/GUIDELINES.md) — 8질문·5태도·세션 운영 규칙 요약
- [레퍼런스](docs/REFERENCE.md) — assets·에이전트·상태 파일 구조
