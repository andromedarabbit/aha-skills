---
created: 2026-08-16T07:55
updated: 2026-08-25T18:54
---
# Plan Addendum — aha-skills 저장소 전환 (rev 3 방향)

작성: 2026-08-16. `claude-plan.md`(rev 2)의 파일 배치를 **aha-skills 저장소 + Claude Code 플러그인 구조**로 전환하는 부록. 원계획의 내용 요구사항(8질문·5태도·검증 스텁·프로토콜)은 그대로 유효하고, 이 문서가 **대상 경로와 배포 방식**을 대체한다. 사용자 결정 3건: ① 카테고리 `writing-experts`(신규) ② 서브에이전트는 **플러그인 agents/ 등록(Claude Code 중심)** ③ 기존 `~/.claude/skills/career-memoir-interviewer`는 검증 후 삭제.

## 1. 대상 저장소와 브랜치

- 저장소: `~/Workspace/Personal/aha-skills` (main, clean에서 시작)
- 브랜치: `feature/career-memoir-skills` — 저장소 CLAUDE.md 관례(feature branch + conventional commits, 한국어)
- vault(이 저장소)는 계속 main + Obsidian Git 자동 백업 — 7단계 vault 작업만 여기서 발생

## 2. 최종 파일 레이아웃

```
aha-skills/
├── .claude-plugin/marketplace.json                  # ~ writing-experts 엔트리 추가
└── skills/writing-experts/                          # 신규 카테고리 = 신규 플러그인
    ├── .claude-plugin/plugin.json                   # name: writing-experts (+skills 배열) — agents/ 자동 발견의 확실한 경로
    ├── agents/                                      # Claude Code 플러그인 에이전트 (선택 B)
    │   ├── career-memoir-distiller.md               #   tools: Read, Write, Edit
    │   ├── career-memoir-compiler-worker.md         #   tools: Read, Write
    │   └── career-memoir-auditor.md                 #   tools: Read, Grep  (읽기 전용 하드 제한)
    ├── career-memoir-interviewer/
    │   ├── SKILL.md                                 # 상호작용: dialog(inline) — 재작성
    │   ├── README.md · docs/{INDEX,GUIDELINES,REFERENCE}.md · scripts/tests/{run.sh,example.bats}  # scaffold 생성
    │   └── assets/
    │       ├── career-context.md                    # 기존 ~/.claude에서 이관
    │       ├── state-schema.md                      # 원계획 1단계 산출물
    │       ├── question-bank.md                     # 2단계
    │       └── probe-taxonomy.md                    # 3단계
    └── career-memoir-compiler/
        ├── SKILL.md                                 # 상호작용: gate-worker — 정리 게이트
        ├── WORKER.md                                # 컴파일 오케스트레이션 본문 (scaffold가 gate-worker용 생성)
        ├── README.md · docs/… · scripts/tests/…
        └── (산출 draft는 vault `초안/경력 회고 에세이/draft-vN.md` — 스킬이 쓰는 데이터는 vault에)
```

**경로 대응표** (원계획 → 신규):

| 원계획 경로 | 신규 경로 |
| --- | --- |
| `~/.claude/skills/career-memoir-interviewer/references/state-schema.md` | `skills/writing-experts/career-memoir-interviewer/assets/state-schema.md` |
| `references/question-bank.md` | `assets/question-bank.md` |
| `references/probe-taxonomy.md` | `assets/probe-taxonomy.md` |
| `~/.claude/skills/career-memoir-compiler/SKILL.md` | `skills/writing-experts/career-memoir-compiler/SKILL.md`(+`WORKER.md`) |
| `~/.claude/agents/career-memoir-{distiller,compiler-worker,auditor}.md` | `skills/writing-experts/agents/*.md` (플러그인 노출) |
| vault 상태/sessions/draft | 변경 없음 |

## 3. Claude Code 중심 서브에이전트 규칙 (선택 B 확정)

1. **정의 형식**: `<plugin>/agents/*.md`, frontmatter는 `name`·`description`(한국어, 트리거 설명)·`tools`(쉼표 목록 — 하드 제한)·(선택) `model`. humanize-korean 플러그인 선례와 동일.
2. **도구 제한**: distiller `Read, Write, Edit` / compiler-worker `Read, Write` / auditor `Read, Grep`. 명시하지 않은 도구는 쓸 수 없다 — 원계획의 "auditor 읽기 전용 강제"가 하드 제약으로 실현된다.
3. **호출 규칙**: 스킬 본문에서 `Task(subagent_type="career-memoir-distiller" 등)`으로 호출. 호출 프롬프트에는 **파일 절대경로를 명시** 전달한다(플러그인 캐시 경로가 세션마다 달라질 수 있으므로 vault 프로젝트 경로는 항상 절대경로).
4. **네임스페이스**: 설치 시 `writing-experts:career-memoir-*` 스킬, 에이전트는 플러그인 소속으로 노출. 에이전트 이름 자체는 전역 유니크하게(`career-memoir-*` 접두로 충분).
5. **오케스트레이션 중첩**: compiler는 SKILL.md(게이트) → WORKER.md(오케스트레이션, general-purpose로 실행) → 그 안에서 플러그인 에이전트(compiler-worker·auditor) Task 호출. 중첩 dispatch는 표준 동작.
6. **검증 공백 대응**: 저장소 검증기는 스킬 디렉터리 기준이라 `agents/`를 안 본다 — 각 스킬의 `scripts/tests/run.sh`에 **에이전트 frontmatter 무결성 검사**(존재·name/tools 필드·도구 허용목록 준수)를 넣어 보완한다.

## 4. 저장소 관례 준수 사항

- **scaffold.sh로 뼈대 생성** (직접 파일 만들기 금지 — 판정 로직 단일화):
  - `scaffold.sh --category writing-experts --name career-memoir-interviewer --description "…" --interaction dialog`
  - `scaffold.sh --category writing-experts --name career-memoir-compiler --description "…" --interaction gate-worker`
- **marketplace.json**에 writing-experts 엔트리 추가(source `./skills/writing-experts`, skills 배열 2개). `skills/writing-experts/.claude-plugin/plugin.json`도 생성(agents 자동 발견 경로 확정).
- **검증**: 커밋 전 `pre-commit run --all-files && ./tools/run-all-tests.sh && git diff --exit-code` + `tools/validate-skill.sh` 개별 스킬.
- **INDEX**: `tools/generate-index.sh` 재생성(드리프트 없음 확인).
- **커밋**: 한국어 conventional commits, 논리 단위별 (`feat: …`).

## 5. 배포·전환 절차 (신규, 원계획 7단계 앞에 삽입)

1. feature branch에 전부 커밋 → main 병합(또는 사용자 승인 후).
2. 플러그인 갱신(`claude plugin update` 또는 재설치) 후 `writing-experts:career-memoir-*` 스킬·에이전트 노출 확인.
3. 노출 확인 뒤 **구 standalone 삭제**: `~/.claude/skills/career-memoir-interviewer/` (사용자 승인 완료).
4. 원계획 7단계(vault 마이그레이션 + dry-run)는 **새 플러그인 에이전트로** 실행 — dry-run이 곧 배포 검증을 겸한다.

## 6. 원계획에서 변경되는 검증 스텁

- 4단계 검증 7(distiller frontmatter tools=Read/Write/Edit) → 플러그인 agents/ 파일로 동일 기준 적용
- 5·6단계의 "Task 도구 호출 방식" → `subagent_type` 지정 호출로 문구 대체
- 7단계 "스킬 로드성" → 플러그인 설치·노출 확인으로 대체(경로 실재 + marketplace 정합성 검증기가 커버)
- 그 외(원문 추기 빈도, 감사 의미 판정, 인용 16개 손실 0, dry-run 통과 기준)는 전부 그대로

## 7. 사후 조치 (2026-08-16)

- 개인 경력 정보(회사명·내부 수치·실명 경로)가 공개 저장소에 push된 사실을 발견 →
  career-context.md를 vault로 회수, 스킬은 vault 절대경로 참조로 변경(plugin 0.1.1).
- **git 히스토리 재작성 실행** (사용자 승인): `git filter-repo`로 career-context.md 전체
  이력 제거 + 민감어 5종(두나무·앤서스랩·싸이월드·리니지2·저자 발언 1건) 치환.
  main force push(`755de66`→`9d48646`), fresh clone 검증으로 전 커밋 0건 확인.
- 백업(재작성 전 원본 이력): `~/Workspace/Personal/aha-skills-backup-20260816.git` —
  확인 후 삭제 권장. GitHub 서버측 캐시(SHA 직접 접근)는 support 요청 필요.
