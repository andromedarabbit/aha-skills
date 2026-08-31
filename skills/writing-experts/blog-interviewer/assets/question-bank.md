# 질문 은행 (Stage 1 보조 질문)

인터뷰어 스킬(`blog-interviewer`)의 Stage 1(재료 인터뷰)에서 쓰는 검증된
보조 질문 세트. 질문을 매번 창작하지 않고 검증된 원본에서 출발해 개인화한다(환각·저질 질문 방지).

## 사용 규칙

- 이 은행의 질문은 제안이며 교체·수정 가능하다(Storyworth 원칙 — 원문 번역이 아니라 방식 참고, §개인화 규칙 참조).
- 8질문 흐름이 우선이고 이 은행은 보조다. 세션당 사용 개수 정량 쿼터는 없다 — 커버리지 갭은
  holding 큐가 담당한다.
- 타이밍이 안 맞는 좋은 질문은 상태 파일의 holding 큐로 보관한다(상세는 `assets/state-schema.md` 소관).
- 후속 질문(탐침 3유형, 표준 후속 3인자 "그다음에 무슨 일이 있었나/어떤 기분이었나/무슨 생각을 했나")은
  `assets/probe-taxonomy.md` 소관 — 이 파일은 개방형 기본 질문과 정형 문형만 담는다.

## 기준: 재료 주제별 8질문 (대응 관계의 축)

이 은행은 8질문을 대체하지 않고 보조한다. 모든 보조 질문은 아래 번호에 매핑된다.

1. 사건 — 실제로 무슨 일이 있었나 (구체적 장면·시점)
2. 문제 — 왜 그것이 문제였나
3. 시도 — 나는 무엇을 했나
4. 결과 — 어떻게 됐나 (수치·산출물·반응)
5. 반전 — 무엇이 예상과 달랐나
6. 주장 — 그래서 독자에게 무엇을 말하고 싶은가
7. 반론 — 이 주장에 회의적인 사람은 뭐라고 할까
8. 한계 — 이 주장이 통하지 않는 경우는 무엇인가

## StoryCorps 파생 세트 (8개)

- **출처**: StoryCorps Great Questions — https://storycorps.org/participate/great-questions/
  (질문 원문은 번역해 쓰고 영어 원문을 인용으로 병기한다.)
- Working / Anyone 계열에서 블로그 글(일·경험에 대한 글)에 적합한 항목을 선별했다.
- 각 항목 표기: 한국어 번역 → 영어 원문 인용(카테고리) → 보강하는 8질문 번호.

1. 어떻게 지금 일을 시작하게 됐는지 이야기해주세요.
> "Tell me about how you got into your line of work."
   (Working) — 1번 보강.
2. 직장 인생에서 특히 좋아하는 이야기가 있나요?
> "Do you have any favorite stories from your work life?"
   (Working) — 1번/5번 보강.
3. 가장 자랑스러운 것은 무엇인가요?
> "What are you proudest of?"
   (Anyone) — 4번/6번 보강.
4. 후회되는 일이 있나요?
> "Do you have any regrets?"
   (Anyone) — 5번/8번 보강.
5. 인생이 상상했던 것과 어떻게 달랐나요?
> "How has your life been different than what you'd imagined?"
   (Anyone) — 5번 보강.
6. 인생에 가장 큰 영향을 준 사람은 누구인가요? 그 사람이 가르쳐준 교훈은 무엇이었나요?
> "Who has been the biggest influence on your life? What lessons did that person teach you?"
   (Anyone) — 1번/5번 보강. 이야기의 인물 축을 연다.
7. 일하는 인생에서 배운 교훈은 무엇인가요?
> "What lessons has your work life taught you?"
   (Working) — 6번/8번 보강.
8. 지금 무엇이든 할 수 있다면 무엇을 하겠어요? 왜인가요?
> "If you could do anything now, what would you do? Why?"
   (Working) — 8번 보강. 본인의 현재 판단 범위를 묻는 형태로만 쓴다(소설화 방지, §반사실 참조).

## 반사실·대가 문형 — 8질문 5번·8번 옆에 배치

- **출처**: JobOps `change-one-thing` 스킬(MIT) — 저장소 https://github.com/reggiechan74/JobOps ,
  스킬 파일 https://github.com/reggiechan74/JobOps/blob/main/plugins/jobops/skills/change-one-thing/SKILL.md .
  원문을 번역 수록하는 게 아니라 "단 하나를 바꾼다면 / 얻은 것·잃은 것·희생한 것"의
  트레이드오프 문형 스타일을 자체 서술한다.
- **배치 규칙**: 이 문형들은 8질문의 **5번(반전)과 8번(한계) 옆**에 보조 질문으로 꺼낸다.
- **소설화 방지**: 가정의 소설화를 유도하지 않는다. "안 했다면 어떻게 됐을까"류 추측을 강요하지 않고
  본인의 판단·기억 범위를 묻는다.

5번(반전) 옆:

- 그때 다른 선택지가 있었다고 생각하시나요? 왜 이 쪽을 고르셨나요?
- 그 시도에서 얻은 것과 잃은 것을 저울에 올리면 어느 쪽으로 기웠나요?

8번(한계) 옆:

- 이 접근이 안 통했던 순간이 실제로 있었나요? 그때는 무엇이 달랐나요?
- 이 주장에 회의적인 말을 실제로 들어본 적이 있나요? 무엇이라고 했나요?

## 캘리브레이션 체크 문형 — 재료 주제 마무리마다

- **출처**: blog-skills `create-article` 스킬(MIT) — 저장소 https://github.com/JacquesBronk/blog-skills ,
  스킬 `create-article`의 SKILL.md (3~4개 충분한 답변 후 캘리브레이션 체크 관행).
  원문 번역이 아니라 문형 스타일을 자체 서술한다.
- **용도**: 인터뷰가 아웃라인을 끌고 가지 않게 하는 안전장치. 인터뷰에서 나온 것이 곧 글이므로,
  방향이 어긋났다고 판단되면 즉시 확인한다.

- "지금까지 들은 바로는 이 글은 결국 <X>에 관한 글인데, 맞나요?"
- "제가 놓친 축이 있나요? 지금까지 들은 것 중 글에 못 들어갈 것 같은 이야기도 있나요?"

## 마무리 질문 3종 — Stage 2 종료 직전 1회

- **출처**: blog-skills `create-article` 스킬(MIT, 위와 같은 저장소). 원문 번역이 아니라 문형을 자체 서술한다.
- SKILL.md 본문(마무리 질문 3종 절)과 동일 문구다 — 이 파일이 정형 문구의 원본이다.

1. 이 글의 핵심 메시지를 한 문장으로 말하면?
2. 시간이 없어 절반으로 줄인다면 무엇을 빼고, 대신 무엇을 더 강조할까?
3. 이 글에 절대 싣지 말아야 할 정보는? (사내 식별자·실명·내부 수치·비공식 발언 — 답은 공개 경계에 반영)

## 독자 관점 문형 — 6번·7번 옆에 배치

- **출처**: 자체(스펙 2026-08-26 질문 태도 5번 "구체적 독자 전제"의 실행 문형).
- `<독자 상>`에는 Stage 0에서 확정한 구체적 독자를 넣는다.

- 이 글을 처음 만나는 <독자 상>이 제일 먼저 궁금해할 것은 무엇일까요? — 6번 보강
- 독자가 이 글을 읽고 다음날 실제로 해볼 수 있는 것은 무엇일까요? — 6번/8번 보강 (takeaway)
- <독자 상>이 이 주장에 반대한다면, 어떤 근거로 반대할까요? — 7번 보강

## 개인화 규칙과 예시

- **방식 출처**: Storyworth Personalized Questions — https://welcome.storyworth.com/what-is-storyworth ,
  질문 가이드 https://welcome.storyworth.com/blog/a-complete-guide-to-storyworths-questions
  (질문 원문 번역이 아니라 개인화 **방식** 참고다.)
- **원칙**: 실제 경험에 맞춘 질문 > 일반적 질문. `<글 폴더>/context.md`(선택 — 저자가 배경 자료를 둔 경우)의
  프로젝트명·기술·연도 메타데이터로 이 은행의 일반 질문을 구체화해서 꺼낸다.
- **변환 형식** (실제 질문은 context.md를 읽고 그 자리에서 만든다 — 여기엔 개인 경험을 적지 않는다):
  - 일반 "가장 자랑스러운 성과는?" → 개인화 "`<프로젝트>`에서 `<산출물>`을 끝냈을 때, 무엇이 가장 자랑스러웠나요?"
  - 일반 "어떻게 시작하게 됐나?" → 개인화 "`<기술>`을 `<시작 계기>`에서 처음 접했을 때, 무엇이 궁금했나요?"
- **경고**: `context.md`는 "인터뷰에서 확인되기 전까지 발언 인용 금지 — 질문 설계에만 쓴다"가
  전제인 파일이다. 개인화는 질문을 구체화하는 용도일 뿐, 사실을 아는 척하거나 인용 가능 발언으로
  기록하는 데 써서는 안 된다.

## 라이선스와 차용 경계

**직접 복사 금지(라이선스 미확인 4건)** — 발상만 자체 서술하고 원문 복사·번역 수록을 하지 않는다:

- memorist-agent — https://github.com/LeoYeAI/openclaw-master-skills/blob/main/skills/memorist-agent/SKILL.md
- AutoSkill — https://github.com/ECNU-ICALK/AutoSkill
- writing-dna-discovery — https://github.com/majiayu000/claude-skill-registry
- bookstrap — https://github.com/mikkelkrogsholm/bookstrap

이 4개 이름은 위 "직접 복사 금지" 목록에만 등장하며 질문 원문 출처로 쓰지 않는다.

**허용 차용**:

- StoryCorps — 질문 원문 번역·영어 병기(파생 세트 전체).
- JobOps(MIT) — 반사실·대가 문형 스타일.
- blog-skills(MIT) — 캘리브레이션 체크·마무리 질문 문형 스타일.
- Storyworth — 개인화 방식 참고(질문 원문 아님).

**내부 출처 표기**: 자체 작성 문형은 "출처: 자체(스펙 2026-08-26)"로 표기한다. 이 문서의 모든 질문·문형은
위 넷 중 하나 또는 내부 출처에 귀속되어야 하며, 출처 없는 질문을 새로 추가하지 않는다.
