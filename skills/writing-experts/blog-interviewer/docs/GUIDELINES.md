# 구현 가이드 — blog-interviewer

`career-memoir-interviewer`(v1.1.0)의 골격을 복제해 블로그 글용으로 적응한 스킬이다. 일반화된 설계 원칙은 `docs/solutions/skill-design/career-memoir-interview-pipeline.md`(저장소 루트)를, 상태 형식은 `assets/state-schema.md`를 따른다.

## 아키텍처

- **이중 계층 상태**: 세션 원문(verbatim append-only) = source of truth / 압축 상태(distiller만 갱신). 컨텍스트 폭발을 막으면서 근거를 디스크에 보존한다.
- **질문은 검증된 은행에서**: 매번 창작하지 않고 `question-bank.md`(StoryCorps·JobOps·blog-skills 파생)에서 출발해 개인화한다.
- **Stage 진행 + 저자 확인 게이트**: Stage 0(주제·독자·논지) → 1(재료 인터뷰) → 2(형식·아웃라인). 컴파일 게이트는 state-schema §4의 판정식으로 기계 판정한다.

## career-memoir 대비 차이 (적응 포인트)

| 항목 | career-memoir | blog-interviewer |
| ---- | ------------- | ---------------- |
| 데이터 경로 | vault 절대경로 하드코딩 (스테일 위험) | **런타임 확정** — 인자/CWD/질문, frontmatter `root`에 기록 |
| 기본 축 | 시기(period) × 8질문(상황~관통 주제) | 재료 주제 × 8질문(사건~한계) |
| Stage 0 산출 | Spine(필수 사건) | 논지(thesis)·독자 |
| Stage 2 산출 | 장면표 | 아웃라인 표(근거 컬럼 포함) |
| 세션 규모 | 수 주 (다수 세션) | 1~3세션 전제, 구조는 동일 |
| 인터뷰 기법 | 감정 질문 스킵 금지 | + **캘리브레이션 체크**(주제 마무리마다), **마무리 질문 3종**(Stage 2 종료 직전) — blog-skills(MIT) 차용 |
| 배경 자료 | `career-context.md` 필수 | `context.md` 선택 — 있으면 질문 설계에만 |

캘리브레이션 체크·마무리 질문 3종은 JacquesBronk/blog-skills의 인터뷰 기법에서 왔다 (차용 경계는 `assets/question-bank.md` 참조).

## context 선택 근거

`docs/skill-specification.md` 판정표 2행 — 여러 라운드의 자유형 대화가 스킬의 핵심 상호작용이라 `inline`이 맞다. 서브에이전트는 `AskUserQuestion`을 못 쓰므로 인터뷰 루프를 위임할 수 없다. 세션 종료 정리(distiller)만 대화 불가 작업이라 서브에이전트로 분리했다.

## 경로 독립 규칙 (핵심 제약)

- SKILL.md·README·docs·에이전트 정의 어디에도 절대경로를 굽지 않는다. 경로 예시는 `<작업 루트>/<글-슬러그>/` 표기만 쓴다.
- 글 프로젝트 폴더는 압축 상태 frontmatter `root`에 기록해 재개·이동 탐지에 쓴다.
- 에이전트 호출 프롬프트에는 항상 절대경로를 실어 보낸다 (플러그인 에이전트는 경로를 스스로 모른다).

## 테스트

`scripts/tests/run.sh`은 플러그인 공용 러너(`skills/writing-experts/shared/test-runner.sh`)를 호출하는 래퍼다 — 4개 스킬이 같은 러너 로직을 복제하던 것을 공용화했다. 이 스킬의 래퍼가 켜는 검증:

1. 플러그인 `agents/` frontmatter 무결성 — blog-distiller/blog-compiler-worker/blog-auditor 3종의 필드 존재 + delimiter 쌍 + **name 값 대조** + tools 허용목록 일치. 저장소 검증기는 스킬 디렉터리 기준이라 플러그인 루트 `agents/`를 안 보므로 이 검사가 유일한 자동 계층이다 (컨벤션: 검증 수단을 하나 더 확보).
2. 경로 독립성 회귀 — 스킬 문서 + 의존 에이전트 정의에서 홈 디렉토리 절대경로 패턴(`/Use`+`rs/`)이 없음을 grep으로 확인한다.
3. 게이트 판정식 동일 문구 검사 — 판정식 핵심 문구가 이 스킬의 3곳(자기 SKILL.md·state-schema·REFERENCE)에 존재 (compiler 러너가 5곳 전부를 검사한다).
4. bats·pytest·shell 통합 테스트가 있으면 실행 (현재 없음 — 0개 스위트 통과 금지 규칙은 위 검사들이 채운다).
