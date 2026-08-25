---
created: 2026-08-16T00:42
updated: 2026-08-25T18:54
---
# Research Findings — 경력 회고 에세이 스킬 선정

조사일: 2026-08-16. 리서치 결정: 웹 조사 2건 병렬 실행(오픈소스 스킬 탐색, 인터뷰 집필 에이전트 사례). 로컬 자산 분석은 사용자가 생략 선택(spec 배경에 요약된 내용으로 충분).

검증(테스트) 접근법: 별도 리서치는 생략. 이 프로젝트의 확립된 검증 패턴은 **시험 인터뷰**(세션 1에서 이미 사용 — "시험 인터뷰 — 스킬 검증 겸 Stage 0 개괄")이며, 아래 조사의 "시험 챕터 게이트"(Gotham Ghostwriters 관행)와 같은 맥락이다. 스킬 변경 시 동일 방식으로 재검증한다.

---

## 1. 오픈소스 스킬 탐색 결과

조사 범위: GitHub 코드/저장소 검색(`filename:SKILL.md` + memoir/autobiography/career retrospective/oral history 등), `anthropics/skills` 공식 저장소 전체 스캔, 스킬 애그리게이터(aiagentivo), 대형 스킬 컬렉션(pm-claude-skills, openclaw-master-skills 등). 일부 WebSearch 쿼리 실패는 GitHub API 검색으로 보완했고, 모든 후보는 실제 파일 열람으로 확인.

### 결론 요약

**로컬 `career-memoir-interviewer`를 대체할 정확히 일치하는 스킬은 없었다.** "경력 회고 + 인터뷰 중심 + 장기 세션 연속성 + 감정 질문" 네 축을 모두 만족하는 오픈소스는 없고, 각 축마다 가장 앞선 것이 서로 다른 저장소에 흩어져 있다. 공식 `anthropics/skills`(17개)에도 memoir/career 계열은 없다.

### 후보 상세

#### 1.1 memoir-dialectic — 구조·연속성 관점 최강후보

- 저장소: https://github.com/0gsd/enough (스킬: https://github.com/0gsd/enough/blob/main/defaults/skills/memoir-dialectic/SKILL.md)
- 라이선스 Apache-2.0 / 스타 4, 2026-04 생성, 2026-08-15 업데이트("very much beta" 개인 프로젝트)
- 로컬 LLM 기반 "개인 언어 시스템"(enough)의 기본 탑재 스킬. "에이전트가 묻고, 사용자가 답하고, 에이전트가 파일로 정리한다. **폴더가 곧 메모리다.** 사용자가 몇 주·몇 년 떠나 있다가도 이어서 할 수 있다."
- 평가: 인터뷰 중심 ✓(다세션, 사용자가 "정리해라" 전까지 초안 안 씀) / 감정 질문 △(감각 프로브·후퇴 신호 처리는 있음, 명시적 감정 질문 약함) / 연속성 ✓✓(PLAN-01 인테이크·민감주제·목소리·프레이밍 / PLAN-NN 주제별 10KB 상한 / INDEX / NOTES 브레인덤프 verbatim / MEMOIR-OUTLINE / MEMOIR-DRAFT-NN) / 회고 원칙 △(아웃라인 체크포인트의 "간극·모순 목록 해소"뿐) / 한국어 ✖(SKILL.md 짧아 번역 이식 쉬움)
- 로컬 대비 **우위**: 문서 기반 상태 구조(폴더=메모리), 목소리 보존 규칙(초안 전 사용자 원문 PLAN 문서들 먼저 읽기), 개정 이력 주석("rev 2: tightened opening, removed Aunt Beth"), 문서 롤오버(PLAN-08로 연속). **열위**: 경력 특화 없음, 회고 윤리 원칙 없음, 성숙도 낙후

#### 1.2 memoir-story-capture — 질문 설계 관점 최고

- 저장소: https://github.com/mohitagw15856/pm-claude-skills (스킬: https://github.com/mohitagw15856/pm-claude-skills/blob/main/skills/memoir-story-capture/SKILL.md)
- 라이선스 MIT / 스타 1,284, Anthropic 공식 플러그인 디렉터리 등재, 2026-08-15 업데이트(1,098개 스킬 컬렉션)
- 본인 또는 부모/조부모의 삶을 "기념품(keepsake)"으로 남기는 스킬. 사실·연도가 아닌 진짜 기억을 여는 질문 세트, 다회 세션 플랜, 장별·주제별 구조화, 감정 후속 프로브, 최종 형태 옵션.
- 평가: 인터뷰 ✓(다중 이완된 세션, 녹음 권장) / 감정 질문 ✓(고난·희망·후회·기쁨 카테고리 + 감정 후속 프로브) / 연속성 ✖(상태 파일 없음 — 질문 세트+세션 플랜이 스킬의 output) / 회고 원칙 ✖(가족사 보존 지향) / 한국어 ✖
- 로컬 대비 **우위**: 질문 은행 카테고리 설계(차용 가치). **열위**: 상태·루프 없음, 경력 특화 없음

#### 1.3 memorist-agent — 실행 채널 관점 참고

- 저장소: https://github.com/LeoYeAI/openclaw-master-skills/blob/main/skills/memorist-agent/SKILL.md (컬렉션 스타 2,119, 미러 성격 — 개별 스킬 라이선스 미확인)
- 가족 구성원 생애 이야기를 적응형 인터뷰로 수집해 회고록 장으로 편집. 영어+중국어, 로컬 우선, 릴레이/메신저 자동응답 모드, `/setup /interview /stories /compile /export`, 엔티티 맵.
- 평가: 인터뷰 ✓, 감정 △, 연속성 ✓(로컬 스토어), 회고 원칙 ✖, 한국어 ✖. OpenClaw 런타임 종속. **로컬 대비 열위** 전반, "메신저로 나레이터와 장기 대화" 채널 발상만 참고.

#### 1.4 openclaw "memoir"(중국어 원작) — 2단계 설계만 차용 가치

- 소스: https://aiagentivo.com/skills/openclaw-skills-memoir (애그리게이터). 원본 GitHub 경로는 404 — 미러(Lord1Egypt/awesome-skill-forge)로 실재만 확인.
- 回忆录 스킬. **采集期(수집기)** — 회당 주제 1개, 개방형 질문, 쉬운 주제부터(유년기→학교→경력→가족→중대 결정→인생 성찰), `memory/YYYY-MM-DD.md` 저장, "피하고 싶은 주제는 누르지 말고 '사용자가 언급 안 함'으로 기록" 규칙. **总结期(정리기)** — 사용자가 "정리해도 된다"고 선언해야만 편성 시작.
- 평가: 인터뷰 ✓, 감정 △, 연속성 ✓, 회고 원칙 ✖, 한국어 ✖(중국어). "정리는 사용자 선언으로만 시작" 게이트와 주제 난이도 순서는 로컬에 없는 좋은 관점.

#### 1.5 JobOps `change-one-thing` — 경력 회고 렌즈 관점 유일후보

- 저장소: https://github.com/reggiechan74/JobOps (스킬: https://github.com/reggiechan74/JobOps/blob/main/plugins/jobops/skills/change-one-thing/SKILL.md)
- 라이선스 MIT / v2.16.0, 커밋 314개, 활발(커리어 관리 플러그인 모음)
- "시간여행 연습" — 과거 커리어에서 단 하나를 바꾼다면? "당신이 정말로 [전 직장]을 떠난 이유는?" 돌직구 인터뷰, 반사실 시나리오 표(부·위험·개인생 영향), 위험조정 기댓값 점수화, "다른 행동 vs 다른 사람이 되는 것" 검사, "지금도 할 수 있는 것"으로 마무리.
- 평가: 인터뷰 ✓(단발) / 감정 ✓(번아웃·관계·후회 정면 질문) / 연속성 ✖(JobOps 자체에 커리어 인벤토리 YAML 개념은 있음) / 회고 원칙 ✓✓(결과와 대가 계산, 나비효과, 다축 평가·대가 명시와 공명. 단 산문을 쓰지 않음) / 한국어 ✖
- **Stage 0 인터뷰 질문 은행에 반사실·대가 질문을 보강하는 소스로 최적.**

#### 1.6 기타 (차용 가치 제한적)

| 스킬 | 위치 | 라이선스 | 비고 |
| --- | --- | --- | --- |
| memoir-writer (craft 가이드) | https://github.com/FerroxLabs/wayland | Apache-2.0 | Mary Karr 등 craft 독서 목록, 진실 vs 이야기·윤리·정서적 거리. 인터뷰·상태 없음 |
| authentic-interview-to-essay-conversion | https://github.com/ECNU-ICALK/AutoSkill | 미확인 | 인터뷰 Q&A 원문 → 목소리 유지 1인칭 에세이 변환. 변환 단계만, 영어 |
| writing-dna-discovery | https://github.com/majiayu000/claude-skill-registry | 미확인 | 인터뷰 기반 필자 목소리 발견("그들이 절대 안 쓰는 표현", AI 패턴 억제) |
| bookstrap `genres/memoir` | https://github.com/mikkelkrogsholm/bookstrap | 미확인 | 장르 컨벤션 가이드. 인터뷰 없음 |

### 종합 판단

1. **대체 불필요**: 네 축을 동시에 만족하는 스킬이 없으므로 로컬 `career-memoir-interviewer`가 여전히 최적. 특히 회고 원칙(실패 미화 금지, 개인 실수/구조 문제 구분)을 설계에 넣은 스킬은 발견하지 못했다.
2. **차용할 아이디어**:
   - memoir-dialectic: 폴더=메모리 구조(PLAN-NN/INDEX/NOTES), 아웃라인 체크포인트의 "간극·모순 목록 제시", 목소리 보존 규칙, 문서별 rev 주석
   - openclaw memoir: "정리 단계는 사용자 선언으로만 시작" 게이트, 주제 난이도 순서, 미응답 항목 명시 기록
   - JobOps change-one-thing: 반사실·대가·번아웃 질문 은행 추가
   - AutoSkill: 인터뷰 기록→산문 변환을 별도 후처리 단계로 분리
3. **검증 한계**: pm-claude-skills(MIT)·JobOps(MIT)·enough(Apache-2.0)·wayland(Apache-2.0) 라이선스 확인. memorist-agent·AutoSkill·writing-dna-discovery·bookstrap은 미확인 — 도입 전 확인 필요. openclaw 원작 memoir은 원본 404로 미러·애그리게이터로만 확인.

---

## 2. 인터뷰 집필 에이전트 사례 조사 결과

조사 방법: WebSearch 장애로 z-ai 검색 + WebFetch/webReader 병행. 수집 실패 분리 보고 — nature.com 논문 본문 미회수(스니펫 4평가축만 인용), Medium 부분 페이월, mediacopilot.substack 페이월 미회수, StoryCorps 원문은 webReader로 전문 회수 성공.

### 2.1 AI 회고록/생애사 인터뷰 제품

**Storyworth** — https://welcome.storyworth.com/what-is-storyworth , 질문 가이드 https://welcome.storyworth.com/blog/a-complete-guide-to-storyworths-questions
- 주 1회 이메일 질문 1개 × 1년. 질문은 "제안"이며 교체·수정 가능. 13개 카테고리 질문 라이브러리 + Personalized Questions(약력 메타데이터로 맞춤 질문 생성). 유료 플랜은 전화 기반 guided interviewer.
- 이식: (a) 질문 큐를 세션 사이 상태로 유지, 매번 1개만 꺼내 씀 — 우리 상태 파일과 같은 패턴의 검증된 상용례. (b) "실제 삶에 맞춘 질문 > 일반적 질문" 원칙 명문화. (c) 약력 메타데이터(지명·인물·연도) 기반 질문 개인화 스텝.

**Remento** — https://help.remento.co/en/articles/8365873-what-is-remento-and-how-does-it-work
- 주 1회 프롬프트 → 클릭 2번 음성·영상 녹음 → Speech-to-Story 산문화 → QR로 원본 음성 연결. 각 녹음은 자완결 유닛(세션 간 연결 없음).
- 이식: (a) 원본 보존 + 가공본 이원화 — "윤문본이 사실을 왜곡했을 때 원발언으로 소급 검증" 기준과 직결. (b) 저마찰 캡처 최적화 대신 내러티브 연속성을 포기한다는 반면교사 — 경력 회고엔 연속성이 본질이므로 이런 단발형은 탈락 근거.

**Memoir (memoir.bot)** — https://memoir.bot/ai-memoir , https://memoir.bot/how-it-works
- 개요 없이 말로 시작 → AI가 "디테일·날짜·느낌" 후속 질문 → 세션 간 이야기 연결해 주제별 챕터 자동 정렬 + running life summary 유지. 후속 질문 verbatim 예: *"What finally gave you the courage to speak to her — and what was the very first thing you said?"* — 직전 발언의 구체적 지점에 닻을 내리는 이중 질문.
- 이식: (a) 후속 질문이 "방금 나온 구체적 명사·사건"을 인용하며 두 겹(결정 계기+최초 행동)을 파고드는 패턴 — "패러프레이즈 선행"에 "인용 앵커링" 하위 규칙 추가 가능. (b) 세션별 산출물 외에 요약 상태(챕터 단위)를 별도 갱신하는 이중 상태 구조.

**Tell Mel** — https://tellmel.ai/howitworks
- AI가 전화를 걸어 인터뷰, 통화를 챕터로 고스트라이팅. 구매자가 인물·장소·질문 시드를 사전 제공, 통화별 미리보기→승인→공유 루프.
- 이식: (a) **인터뷰 시작 전 시드 제출이 품질의 전제**. (b) 세션 산출물마다 저자 승인 게이트.

**Legacium** — https://www.legacium.app/blog/remento-alternative
- 고정 질문 없이 "공유된 내용의 감정적 에너지"를 따라 깊이 조절. 세션 4의 아버지 언급을 세션 14의 결정적 논쟁과 연결하는 교차 세션 메모리. 20+ 문체 프로필, 감정 지형 타임라인.
- 이식: (a) 감정적 에너지가 있는 주제 감지 시 우선 심화 — 탐침 우선순위 규칙으로 승격 가능. (b) 상태 파일의 "미해결 실마리(open threads)" 회수 패턴.

**Life-Story.AI / Memoirji** — https://memoirji.com/blog/life-story-ai-interviewer-role
- AI 인터뷰어 "Lisa"가 질문 생성 + 가족이 Interviewer 뷰에서 질문 주입. 운영 권장: 주 2질문(그 주 주제 1 + 후속 심화 1, 그리고 "Lisa가 자연히 도달하지 않는 영역" 1). 좋은 질문 기준: 구체적 이름·사건·연도·감각 앵커·사물. 자기검증: "저자가 답을 거부해도 받아들일 수 있는 질문인가?"
- 이식: (a) AI의 질문 습관이 빠뜨리는 영역 의도적 할당 쿼터. (b) "거부 가능성 수용" 자기검증 — 후보 질문 생성 직후 필터로 즉시 이식 가능.

**StoriedLife** — https://storiedlife.ai/ai-memoirs/
- 프롬프트에서 멈추지 않고 자연스러운 왕복 대화로 "프롬프트만으로는 안 나오는 것" 발굴.
- 이식: "단일 프롬프트 수집 vs 대화 발굴" 대립축을 평가 어휘로.

### 2.2 구술사(oral history) 인터뷰 방법론

**StoryCorps Great Questions** — https://storycorps.org/participate/great-questions/
- 20년 축적 검증 질문 세트, 17개 카테고리. 경력 회고에 직접 쓸 만한 것: "What have been some of the happiest moments in your life? The saddest?", "Who has been the biggest influence on your life? What lessons did that person teach you?", "How has your life been different than what you'd imagined?", "What are you proudest of?", "When in life have you felt most alone?", "Do you have any regrets?", "What did you think you were going to be when you grew up?", "What lessons has your work life taught you?", "Are there funny stories your family tells about you?"
- 이식: 질문 생성 근거로 "검증된 질문 원본 목록" 참조 파일 제공 — 창작 의존 대신 이 세트에서 출발해 개인화(Hallucination 방지).

**StoryCorps "Tips for a Great Conversation" 10팁** — https://storycorps.org/participate/tips-for-a-great-conversation/
- (1) 질문 미리 계획해 상대에게 사전 공유, (2) 워밍업 질문, (3) 예/아니오 불가 질문("Tell me about…", "What was it like when…"), (4) 후속 3인자 **"And then what happened?" / "How did that make you feel?" / "What were you thinking in that moment?"**, (5) 질문 목록은 가이드일 뿐 — 옆길로 새면 따라가고 나중에 리다이렉트, (6) 인터뷰어 자신의 이야기 공유(상호성), (7) 미래 청자 위한 맥락 세팅("Who was Uncle Steve?"), (8) 감각 디테일 유도("What did your kitchen smell like?"), (9) 시간 의식 — 마지막에 성찰 질문("What legacy would you like to leave?"), (10) 편안하게.
- 이식: (a) 후속 3인자 표준 탐침 세트. (b) 다음 세션 예정 질문 사전 공개 패턴. (c) 세션 구조 템플릿화(워밍업→본론→클로징 성찰). (d) "옆길 허용+나중에 회귀"는 미해결 실마리와 짝.

**탐침(probe) 분류법** — https://www.koji.so/docs/probing-and-follow-up-questions , https://listenlabs.ai/articles/7-step-qualitative-interview-guide/
- 탐침 3유형: **clarification**(모호한 진술 해소) / **elaboration**(얇은 답변 확장) / **contrast**(대안 비교로 추론 노출). 인터뷰 구조: 라포 → 개방형 6-8개 → 클로징 탐침. 침묵 활용. "탐침은 스크립트가 아니라 유형 카드". 충분히 판 판정: **"그 사람의 경험을 동료에게 설명할 수 있다면"**. 체계적 탐침이 테마 풍부도를 상향(수치는 원문 검증 권장).
- 이식: (a) 탐침 3유형을 후속 질문 선택지 프레임으로 — 에이전트가 탐침 유형을 선언하게. (b) "동료에게 설명 가능" 완료 판정 기준 즉시 이식.

### 2.3 AI 인터뷰어 프롬프트 패턴

**Flipped Interaction Pattern** — https://www.vanderbilt.edu/generative-ai/prompt-patterns/ , https://papers.ssrn.com/sol3/Delivery.cfm/6149407.pdf?abstractid=6149407&mirid=1
- AI가 질문자가 되어 필요한 정보를 다 모을 때까지 묻는 메타 패턴. 사전 결정 항목: 질문 개수/중단 시점, 원하는 정보, 각 답변 후 할 행동.
- 이식: 우리 "한 번에 한 질문"은 이 패턴의 특수 사례. **질문 총량 예산과 종료 조건** 명시 여부 점검 항목 추가.

**Ruben Hassid "I can be you."** — https://ruben.substack.com/p/youre-just-a-text-file
- 100개 질문 자기 인터뷰(음성 받아쓰기 90-120분 — "voice is faster and more honest") → 2만 단어 덤프 → 같은 대화에서 압축 프롬프트로 "about me" 파일 → 이후 매 턴 재독해 비용 제거. 핵심 명령: **"ONE question at a time. Wait for my response."** / **"Push back on vague answers."** "모호함은 프롬프트를 살아남지 못한다".
- 이식: (a) **raw 인터뷰 기록과 압축 상태 파일의 2단 계층** — 요약만 담으면 디테일이 세션 사이에 증발. (b) 구체성 부족 시 되묻기(push back) 규칙. (c) 음성 입력이 정직성을 높인다는 반복 언급.

**4O4 "Memoir by Interview"** — https://medium.com/@4O4/memoir-by-interview-how-im-using-ai-to-finally-tell-my-story-056b74c6566f
- 10년 중독 회고록을 AI 인터뷰로 95% 초안까지. 후속 질문 verbatim: **"You mentioned feeling relieved when they arrested you. Can you say more about that?"**(직전 발언의 감정 단어 인용). "AI의 질문은 천천히 갈 수 있게, 어려운 진실을 맴돌 수 있게, 쉬게 허락해줬다". 세션마다 전체를 서사로 반사(reflect back)해 확정.
- 이식: (a) "감정 단어 인용 + say more" 감정 탐구 문형. (b) **세션 끝 반사 단계** — 질문 간 패러프레이즈와 구분되는 별도 단계. (c) "천천히, 맴돌기, 휴식 허용" 페이싱 안전 규칙.

**Edify Content** — https://edifycontent.com/blog/how-to-use-ai-to-ghostwrite-for-you-in-your-words
- AI에게 인터뷰어 역할 → 한 번에 한 질문 + smart follow-ups → 받아쓰기 → 구조화 초안 → 사람이 톤 조정. 원칙: **"AI의 가치는 생성이 아니라 추출(extraction)이다"** — 저자 목소리인 이유는 "본인 단어로 만들어졌기 때문".
- 이식: (a) "추출 not 생성" 원칙 상단 선언. (b) 저자 발화 verbatim 보존 요구사항.

### 2.4 AI 고스트라이팅 인터뷰 사례

**Gotham Ghostwriters 관행** — https://gothamghostwriters.com/hire-a-ghostwriter-2/
- CEO 회고록: 18개월, 관계자 인터뷰 75회+, 원시 인터뷰에서 장면 구축, 반복 초안 라운드, 정식 계약 전 **시험 챕터(trial piece)**. 고스트라이터 검증 기준: 목소리 캡처·인터뷰 구조화·개정 주기 설명 능력.
- 이식: (a) 시험 챕터 게이트 — 전체 착수 전 소 섹션 1개로 평가(우리 시험 인터뷰와 같은 맥락, 정식 평가 축으로 승격). (b) 인터뷰→장면 구축 단계의 명시적 존재 평가 항목화.

**LLM 후속 질문 연구** — https://arxiv.org/html/2509.12709v1 (17명 Wizard-of-Oz), 평가기준 논문 https://www.nature.com/articles/s41598-026-46517-7 (본문 미회수, 스니펫)
- GPT-4o 실시간 후속 질문(1-3개/인터랙션). 가치: 보완·심화·턴 연결·버퍼(생각할 공간)·인지 부하 감소. 위험: **삽입 타이밍 실패(최대 약점)**, 흐름 이탈, 민감 맥락 유해 질문. 완화: **"raise hand"**(질문 전 허락 요청), **"holding"**(타이밍 안 맞는 좋은 질문 보관), 키워드 큐, 인간 최종 게이트키퍼.
- Nature 계열 평가기준(스니펫): 후속 질문 4평가축 — **benevolence(선의) / necessity(필요성) / context-awareness(맥락 인지) / openness(개방성)**.
- 이식: (a) 4평가축을 후속 질문 채점표로 차용. (b) holding 큐 — 타이밍 안 맞는 좋은 질문 상태 파일 보관. (c) 타이밍 실패가 최대 위험 — "지금 물어야 하나" 판정 규칙.

### 2.5 평가 기준 보강 제안 (18항목)

1. **탐침 유형 명시성** — clarification/elaboration/contrast(혹은 감정 탐구형) 라벨링 (Koji, StoryCorps)
2. **인용 앵커링** — 직전 발언의 구체적 명사·감정 단어·사진 인용 (memoir.bot, 4O4)
3. **후속 질문 4평가축 채점** — benevolence/necessity/context-awareness/openness (Nature 계열)
4. **타이밍·페이싱 규칙** — 저자 피로·민감도에 따른 탐침 미루기 (arXiv, 4O4)
5. **Holding 큐** — 좋지만 지금 아닌 질문 보관·회수 (arXiv, Legacium)
6. **이중 상태 구조** — 세션 원문(verbatim)과 압축 요약 분리 (Hassid, memoir.bot)
7. **구체성 강제 규칙** — 모호한 답변 push back (Hassid, Edify)
8. **세션 내 3단 구조** — 워밍업→본론→클로징 성찰 + 다음 세션 질문 사전 공개 (StoryCorps, ListenLabs)
9. **완료 판정 기준** — "동료에게 설명 가능한가" 외부화 기준 (Koji)
10. **표준 후속 3인자 내장** — "And then what happened?" / "How did that make you feel?" / "What were you thinking?" (StoryCorps)
11. **검증된 질문 세트 기반** — StoryCorps Great Questions 출발 + 약력 메타데이터 개인화 (StoryCorps, Storyworth)
12. **감각·맥락 유도 질문** — 미래 독자 맥락 세팅, 감각 디테일 (StoryCorps, Memoirji)
13. **거부 가능성 자기검증** — "저자가 거부해도 받아들일 질문인가" 필터 (Memoirji)
14. **추출 not 생성 선언** — 저자 발화에서 조립, 원본 보존 (Edify, Remento)
15. **AI가 안 묻는 영역 쿼터** — 모델 질문 습관 밖 영역 의도 배정 (Memoirji)
16. **세션 종료 반사 단계** — 전체 서사 반사가 패러프레이즈와 구분 (4O4)
17. **시험 챕터 게이트** — 전체 착수 전 소단위 산출물 평가 (Gotham)
18. **질문 예산·종료 조건 명시** — 세션/프로젝트 총량과 종료 조건 (Flipped Interaction)

**대조축 한 줄 요약**: 성공 사례는 공통적으로 **"연속성(교차 세션 메모리) + 적응형 탐침 + 저자 발화 보존"**을 갖췄고(Remento가 의도적으로 포기한 축), 실패 양상은 **"단발 프롬프트 수집(generic → 미완결)"**과 **"삽입 타이밍 실패"**로 수렴한다.
