# 레퍼런스

career-memoir-interviewer 스킬이 참조하는 assets, 협업 에이전트, 상태 파일 구조 안내.

## Assets (4종)

스킬 디렉토리 `assets/` 아래에 있다. SKILL.md 본문의 `${CLAUDE_SKILL_DIR}` 치환 경로로 로드한다.

| 파일 | 로드 시점 | 역할 |
| ---- | --------- | ---- |
| `<루트>/career-context.md` (vault — 이 저장소 밖, 개인 정보) | 세션 시작 시 | 경력 맥락(회사·인물·연도 메타데이터). 질문 설계에만 쓰고, 인터뷰로 확인되기 전까지 발언 인용 금지 |
| `state-schema.md` | 필요 시 | 상태 구조의 유일한 source of truth. 이중 계층·holding 큐·제안·불변식 정의 |
| `question-bank.md` | Stage 1 진입 시 | 시기별 심층 인터뷰 보조 질문 세트(검증된 원본에서 출발, 개인화 허용) |
| `probe-taxonomy.md` | Stage 1 진입 시 | 후속 질문(탐침) 4유형 어휘 — clarification / elaboration / contrast / 감정형 — 과 선언 규칙 |

## 협업 에이전트 (플러그인 `agents/`)

이 스킬이 직접 호출하는 것은 distiller뿐이다. compiler-worker·auditor는 compiler 스킬이 호출한다.

| 에이전트 | 도구 | 이 스킬과의 관계 |
| -------- | ---- | ---------------- |
| `career-memoir-distiller` | Read, Write, Edit | 세션 종료 시 인터뷰어가 `Task(subagent_type="career-memoir-distiller")`로 호출. 세션 원문을 읽어 압축 상태를 갱신하고 처리 요약을 반환 |
| `career-memoir-compiler-worker` | Read, Write | compiler 스킬이 산문 변환에 사용. 인터뷰어는 호출하지 않는다 |
| `career-memoir-auditor` | Read, Grep | compiler 스킬의 근거 검증용 읽기 전용 에이전트. 인터뷰어는 호출하지 않는다 |

distiller 호출 규칙:

- 호출 프롬프트에 세션 원문 파일과 압축 상태 파일의 **절대경로**를 전달한다(플러그인 에이전트는 vault 경로를 스스로 모른다).
- distiller는 사용자와 대화할 수 없다 — 판단이 애매한 변경은 상태 파일의 제안 섹션에 남기고 저자가 다음 세션 시작 시 승인/기각한다.
- 세션 원문은 읽기만 한다(수정 금지). 상태 파일만 갱신한다.

## 상태 파일 구조 (개요)

데이터는 vault 프로젝트 루트 `/Users/keaton/Workspace/Obsidian/notes/초안/경력 회고 에세이/` 아래에 산다. 상세 형식·불변식은 `assets/state-schema.md` 참조.

### 세션 원문 계층 — `sessions/YYYY-MM-DD.md`

- 파일명은 세션 **시작일** 기준. 자정 통과 세션은 한 파일 유지, 같은 날 재시작은 `-2` 접미.
- 저자 발언 verbatim + 질문 요지, 시작/종료 시각(frontmatter), 다룬 시기 태그(`periods`).
- 답변마다 append. 한 번 기록된 내용은 수정하지 않는다(추가만 허용).

### 압축 상태 계층 — `interview-state.md`

- frontmatter: `stage`(0|1|2), `sessions`, `last_session`(종료일 — 파일명과 달라도 정상).
- 섹션: Spine / 시기별 진행 / 인용 가능한 발언(출처 세션 파일 경로 표기) / 감정·패턴 노트 / holding 큐(유형[탐침 보관·미응답·실마리]·상태[보관 중·회수 완료·폐기]·회수 조건) / 제안 / 공개 경계 / 세션 로그(최근 5개 상세, 이전 1줄 롤오버) / 장면표(Stage 2).
- Stage 2 완료 신호: frontmatter `stage: 2` + `## 장면표` 섹션이 존재하고 비어 있지 않음(데이터 행 1개 이상).

## 관련 문서

- [사용자 문서](../README.md)
- [구현 가이드](GUIDELINES.md)
