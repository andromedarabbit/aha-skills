---
created: 2026-08-26
updated: 2026-08-26
---
# Research Findings — 인터뷰 기반 블로그 글쓰기 스킬 선정

조사일: 2026-08-26. 방법: 웹 검색(CCS WebSearch — Brave/DuckDuckGo), GitHub 저장소 검색(`search_repositories`), 후보 README·SKILL.md 원문 열람(WebFetch), 로컬 자산 분석(career-memoir 스킬 구조 탐색, vault blog policy 검토).

선행 연구와의 관계: 2026-08-16 경력회고 스킬 선정 조사(`2026-08-15-writing-experts-career-memoir-research.md`)는 **memoir/회고 축**을 조사했다(memoir-dialectic, memoir-story-capture, memorist-agent 등). 이번 조사는 **블로그 글쓰기 축**이며, memoir 계열 후보는 "블로그 글" 담당이 아니어서 이번 평가 대상에서 다시 다루지 않는다.

---

## 1. 오픈소스 스킬 탐색 결과

### 결론 요약

**인터뷰 기반 블로그 글쓰기 스킬은 사실상 존재하지 않는다.** 유일하게 "interview-driven drafting"을 표방하는 저장소가 하나 있으나 0★ 개인 프로젝트로, 상태 관리·멀티 세션·한글이 전부 없다. 반면 인기 있는 블로그 스킬(1.9k★ claude-blog)은 인터뷰가 아니라 주제 기반 자동생성("user is never the first reviewer")으로 요구사항과 정반대 철학이다. **자체구현 확정.**

### 후보 상세

#### 1.1 JacquesBronk/blog-skills — 유일한 인터뷰 기반 후보

- 저장소: https://github.com/JacquesBronk/blog-skills (스킬: `.claude/skills/create-article/SKILL.md`)
- 라이선스 MIT / 스타 0, 포크 0, 커밋 2개, 2026-06 생성 — 사실상 신규 개인 프로젝트
- 구조: `/create-article`(인터뷰 기반 초안) + `/create-article-image`(ComfyUI + FLUX 표지 생성). GitHub 이슈 번호를 입력으로 받아 정적 블로그 마크다운 초안 작성. 6단계: 이슈 조회 → 슬러그/파일 생성 → 브리핑 → 인터뷰 → 초안 작성 → 핸드오프
- 인터뷰 기법 (원문 확인, **차용할 아이디어**):
  - 한 번에 한 질문만 ("Do NOT bulk-ask"), 답변을 기다린 후 후속 질문
  - 고정 오프닝: "What's the real story here — the incident, the experiment, the moment this became a lesson?"
  - 아웃라인 섹션마다 집중 질문 1개
  - 3~4개 충분한 답변 후 **캘리브레이션 체크**: "So the article is really about X… Does that track?" — 학습 내용 피드백 + 아웃라인 조정
  - **마무리 질문 3종**: 핵심 교훈 한 줄 / 서두르면 뺄 내용(오히려 강조할 것) / 절대 싣지 말아야 할 정보(클라이언트명 등)
  - "the outline is a scaffold. What the user actually said in the interview is the article" — 이야기 없는 섹션은 잘라내거나 병합
  - 인터뷰 중 "check X" 요청에 웹 검색·로컬 파일 즉시 조사, 날짜 정확성(포스트 날짜 이전에 존재한 제품/버전만 언급), 보안·익명화 규칙
- 평가: 인터뷰 기반 ✓ / 한국어 ✖ / 상태 관리·멀티 세션 ✖ (재개 지원은 기존 더미 초단 파일 재사용뿐) / 근거 감사 ✖ / ComfyUI·`gh` CLI 의존 결합
- 결론: **코드가 아니라 기법을 차용한다**

#### 1.2 AgriciDaniel/claude-blog — 인기 있지만 요구사항과 불일치

- 저장소: https://github.com/AgriciDaniel/claude-blog (활동은 AI-Marketing-Hub/claude-blog)
- 라이선스 MIT / 스타 1.9k, 포크 308
- 주제만 받아 생성(`/blog write <topic>`), 100점 루브릭 90점 미만 게시 차단·최대 3회 자동 반복. SEO/AI 인용 최적화 중심, 32스kill·테스트 252개 대형 스위트
- 평가: 인터뷰 기반 ✖ (인간은 첫 리뷰어가 아님), 한국어 명시 없음(custom 로케일 가능성만)
- 결론: **철학이 정반대라 도입 대상 아님**

#### 1.3 그 외 — 모두 인터뷰 패러다임 아님

- **anthropics/skills 공식 17종**: 인터뷰형 글쓰기 스킬 없음 (office/design/web/writing/devtool 5카테고리)
- **CrewAI/Ollama 블로그 멀티에이전트, OpenClaw 자율 블로거, jordan-jakisa/blogger**: 자율 생성(키워드→SEO 글) — 프레임워크·SaaS형이고 저자 인터뷰 없음
- **한글권**: 알파블로그·가제트 등 SEO 자동생성 SaaS뿐, 오픈소스 부재
- **obra/superpowers brainstorming**: 소크라틱 질문 → 플랜 설계용. 블로그 글쓰기 아님

## 2. 로컬 자산 분석

### career-memoir 스킬 (골격 제공)

`skills/writing-experts/` 탐색 결과, 블로그 스킬에 그대로 이식 가능한 자산:

- **이중 계층 상태**: 세션 원문(`sessions/YYYY-MM-DD.md`, verbatim append-only) + 압축 상태(`interview-state.md`, distiller만 갱신) — 컨텍스트 폭발 방지와 근거 보존을 동시에 달성
- **에이전트 3종 분업**: distiller(Read/Write/Edit), compiler-worker(Read/Write), auditor(Read/Grep — 읽기 전용 강제가 정체성). 호출 프롬프트 절대경로 계약·fail fast·대화 불가 규칙
- **게이트 판정식 동일 문구 양방향 고정**: state-schema §4 ↔ compiler SKILL.md
- **재사용/교체 구분**: probe-taxonomy(도메인 무관) 복제. 8질문·5태도·Spine·장면표·시기 구조는 블로그용(thesis·독자·아웃라인 표)으로 교체. question-bank는 블로그 주제용 재구성
- **교훈**: SKILL.md에 vault 경로를 하드코딩했다가 vault 이동 후 스테일 — 블로그 스킬은 작업 루트를 런타임에 결정

### vault blog policy (참고만, 의존하지 않음)

`Workflows/policy/writing-policy.blog.md`: thesis 합의 → 구조 → 초안 → 품질 → 저장·발행. `source_strategy: topic-or-draft`로 인터뷰 단계가 비어 있다. 스킬은 vault와 독립이므로 이 정책을 참조하지 않고, thesis-우선·takeaway 구조 같은 정신만 채널 무관 기본값으로 반영한다.

## 3. 결정

**자체구현.** 근거:

1. 인터뷰 기반 후보가 사실상 전무하다 (1.1이 유일, 이식하면 상태 관리·한글·감사를 전부 새로 붙여야 해 사실상 재작성)
2. 검증된 자체 골격이 이미 있고 재사용 지점이 문서화돼 있다
3. vault 독립 요구사항은 어차피 어떤 외부 스킬로도 직접 충족되지 않는다

차용 목록(blog-skills): 캘리브레이션 체크, 마무리 질문 3종(핵심 메시지/뺄 것/절대 싣지 말 것), "인터뷰가 곧 글" 원칙, 한 번에 한 질문(경력회고에도 이미 있는 규칙).
