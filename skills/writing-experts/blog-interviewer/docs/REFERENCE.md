# 레퍼런스 — blog-interviewer

## assets 구성

| 파일 | 로드 시점 | 역할 |
| ---- | --------- | ---- |
| `assets/state-schema.md` | 필요 시 | 상태 형식의 유일한 source of truth (이중 계층·holding 큐·게이트 판정식 §4) |
| `assets/question-bank.md` | Stage 1 진입 시 | 검증된 보조 질문 세트 (StoryCorps·JobOps·blog-skills 파생 + 개인화 규칙) |
| `assets/probe-taxonomy.md` | Stage 1 진입 시 | 후속 탐침 유형 어휘 (clarification/elaboration/contrast/감정형) |

## 서브에이전트 호출 계약

세션 종료 시 `blog-distiller`를 호출한다:

```text
Task(subagent_type="blog-distiller")
```

호출 프롬프트에 담을 것 (전부 절대경로 — 플러그인 에이전트는 글 프로젝트 경로를 스스로 모른다):

1. 세션 원문 파일 경로: `<글 폴더>/sessions/YYYY-MM-DD.md`
2. 압축 상태 파일 경로: `<글 폴더>/interview-state.md`

distiller의 임무 계약은 에이전트 정의 `agents/blog-distiller.md`(플러그인 루트)가 source of truth다.

## 상태 파일 구조 요약

압축 상태 `<글 폴더>/interview-state.md`:

- frontmatter: `stage / sessions / last_session / slug / root(글 폴더 절대경로) / created / updated`
- 섹션 9개: 논지·독자 / 재료 주제별 진행 / 인용 가능한 발언(출처=세션 파일 경로) / 감정·패턴 노트 / Holding 큐 / 제안 / 공개 경계 / 아웃라인 표 / 세션 로그(최근 5개 상세)

세션 원문 `<글 폴더>/sessions/YYYY-MM-DD.md`:

- frontmatter: `session / started / ended / topics[]`
- 본문: `### Qn (질문 요지)` + `> 저자 발언 verbatim`

상세는 `assets/state-schema.md` 참조.

## 게이트 판정식 (컴파일러와 동일 문구)

> **Stage 2 완료 = 압축 상태 frontmatter `stage: 2` + `## 아웃라인 표` 섹션이 존재하고 비어 있지 않음(아웃라인 표에 데이터 행 1개 이상).**

## 관련 스킬·에이전트

- `blog-compiler` — 초안 컴파일 게이트 (인터뷰어의 "초안 작성" 선언 후)
- `blog-distiller` — 세션 종료 시 압축 상태 갱신 (Read, Write, Edit)
- `blog-compiler-worker` / `blog-auditor` — blog-compiler가 호출 (이 스킬은 직접 호출하지 않는다)
