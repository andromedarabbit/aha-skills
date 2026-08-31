# 레퍼런스 — blog-compiler

## 파일 레이아웃

```text
blog-compiler/
├── SKILL.md      # 게이트 — 전제 2조건 판정, 워커 실행 지시
├── WORKER.md     # 7단계 오케스트레이션 (general-purpose가 Read로 실행)
├── README.md
├── docs/         # INDEX.md, GUIDELINES.md, REFERENCE.md (이 파일)
└── scripts/tests/run.sh
```

## 전제 게이트 판정식

state-schema §4(blog-interviewer)와 **동일 문구**:

> **Stage 2 완료 = 압축 상태 frontmatter `stage: 2` + `## 아웃라인 표` 섹션이 존재하고 비어 있지 않음(아웃라인 표에 데이터 행 1개 이상).**

## 워커 호출 계약

게이트가 워커 프롬프트에 실어 보내는 값 (전부 필수):

1. `WORKER.md` 절대경로 — 읽어야 할 본문
2. 스킬 디렉토리 절대경로 — WORKER.md의 상대 참조를 풀 기준
3. blog-interviewer 스킬의 `assets/state-schema.md` 절대경로 — 상태 형식의 source of truth (blog-compiler에는 assets/ 사본이 없다)
4. 글 프로젝트 폴더 절대경로 — 상태 파일·세션 원문·초안 저장 위치
5. 세션 원문 경로 목록 — `<글 폴더>/sessions/*.md` (워커·auditor의 재탐색 방지)

오케스트레이션은 주 대화 실행 시에만 스폰하고, 이미 격리된 컨텍스트(서브에이전트)에서는
직접 `WORKER.md` 프로토콜을 수행한다 — 홉의 목적은 주 대화 컨텍스트 보호다 (SKILL.md
"워커 실행" 참조).

## 서브에이전트 호출 계약 (WORKER.md가 실행)

| 에이전트 | tools | 입력 (절대경로) | 산출 |
| -------- | ----- | -------------- | ---- |
| `blog-compiler-worker` | Read, Write | 상태 파일, 세션 원문 목록, 아웃라인 표 위치, 초안 임시 저장 경로(wip) | 임시 draft 파일(wip) + 조립 보고(응답 텍스트) |
| `blog-auditor` | Read, Grep | 초안 경로, 세션 원문 목록, 상태 파일 경로 | 감사 보고서(응답 텍스트 — Write 없음) |

- auditor의 통과 정의: **근거 없음 판정 0건 + 공개 경계 위반 0건 (연결문 제외)**
- 교정 루프 상한: 초기 감사 1 + 재감사 1 = 2회

## NEEDS_DECISION 반환 포맷

워커가 확정되지 않은 결정에 마주하면:

```text
NEEDS_DECISION
question: <구체적인 질문 하나>
options:
  - label: <선택지>
    consequence: <트레이드오프>
recommended: <선택지 또는 없음>
why: <한 문장>
```

게이트가 `AskUserQuestion`으로 묻고 `SendMessage`로 기존 워커를 재개시킨다.

## 관련 스킬·에이전트

- `blog-interviewer` — 인터뷰 진행 (이 스킬의 입력을 만든다)
- `blog-distiller` — 인터뷰어 세션 종료 시 압축 상태 갱신 (이 스킬은 호출하지 않는다)
