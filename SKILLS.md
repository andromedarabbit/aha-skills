# 스킬 인덱스

이 저장소에 포함된 모든 스킬의 카테고리별 인덱스입니다.

## meta-experts

### [skill-author](skills/meta-experts/skill-author)

**버전**: 1.2.1

이 저장소(aha-skills)에 새 에이전트 스킬을 추가합니다. 상호작용 모델을 판정해 context/agent/background/WORKER.md를 파생시키고, 저장소 관례(카테고리 kebab-case, language korean, docs/INDEX.md, 훅 matcher 규칙, scripts/tests/run.sh)에 맞는 파일 일습을 만든 뒤 실제 내용까지 채우고 검증기까지 돌립니다. "스킬 만들어줘", "새 스킬 추가해줘", "이 작업을 스킬로 만들자", "/skill-author" 요청이 있을 때, 또는 반복 작업을 스킬로 굳히자는 이야기가 나올 때 사용하세요. skills/ 아래에 새 디렉토리를 만드는 일이면 이 스킬을 쓰세요 — 범용 skill-creator는 이 저장소의 판정표와 검증기를 모르므로 여기서 만든 뒤 평가·트리거 최적화가 필요할 때 넘깁니다. 기존 스킬 수정·리뷰·평가에는 쓰지 않습니다.

- [문서](skills/meta-experts/skill-author/README.md)
- [구현 가이드](skills/meta-experts/skill-author/docs/GUIDELINES.md)
- [레퍼런스](skills/meta-experts/skill-author/docs/REFERENCE.md)


## social-experts

### [social-posting](skills/social-experts/social-posting)

**버전**: 0.1.1

소셜미디어 포스팅 자동화. X·LinkedIn·Facebook·Bluesky에 올릴 문안을 사용자의 목소리로 쓰고 하드 제약(문자 수·alt text)을 기계 검증한 뒤 승인을 받아 aside 브라우저 실행 계층으로 실제 계정에 게시한다. `/social-posting` 단독 호출이나 "소셜 포스팅 만들어줘", "블로그 글 X·링크드인에 올릴 문안 만들어줘", "블루스카이 초안 뽑아줘", "이 글 SNS용으로 변환해줘" 요청 시 사용. 무엇을 포스팅할지 되묻지 않고 즉시 환경 점검 후 요구사항을 묻는다. 게시 API를 직접 호출하지 않고 aside로만 게시한다. 일반 브라우저 자동화·웹 조사는 aside-browser 스킬 소관이다.

- [문서](skills/social-experts/social-posting/README.md)
- [구현 가이드](skills/social-experts/social-posting/docs/GUIDELINES.md)
- [레퍼런스](skills/social-experts/social-posting/docs/REFERENCE.md)


## writing-experts

### [blog-compiler](skills/writing-experts/blog-compiler)

**버전**: 0.1.0

블로그 글 인터뷰 기록을 충실한 산문 초안으로 컴파일한다. '블로그 초안 만들어', '초안 작성 시작' 같은 요청이 있을 때 사용. 인터뷰 진행은 blog-interviewer 담당 — 이 스킬은 질문하지 않고 대화하지 않는다. 경력 회고 초안은 career-memoir-compiler 담당.

- [문서](skills/writing-experts/blog-compiler/README.md)
- [구현 가이드](skills/writing-experts/blog-compiler/docs/GUIDELINES.md)
- [레퍼런스](skills/writing-experts/blog-compiler/docs/REFERENCE.md)

### [blog-interviewer](skills/writing-experts/blog-interviewer)

**버전**: 0.1.0

블로그 글을 위한 저자 인터뷰를 진행한다. 한 번에 한 질문, 패러프레이즈 선행, 캘리브레이션 체크, 세션 원문 축적과 holding 큐로 세션 간 연속성 유지. 블로그 글 인터뷰 시작, 글 소재 인터뷰, 블로그 인터뷰 이어서 같은 요청이 있을 때 사용. 산문 작성·초안 생성은 blog-compiler 담당. 경력 회고 에세이 인터뷰는 career-memoir-interviewer 담당.

- [문서](skills/writing-experts/blog-interviewer/README.md)
- [구현 가이드](skills/writing-experts/blog-interviewer/docs/GUIDELINES.md)
- [레퍼런스](skills/writing-experts/blog-interviewer/docs/REFERENCE.md)

### [career-memoir-compiler](skills/writing-experts/career-memoir-compiler)

**버전**: 1.0.0

인터뷰 기록을 충실한 산문 초안으로 컴파일한다. '회고 초안 만들어', '정리 시작' 같은 요청이 있을 때 사용. 인터뷰 진행은 career-memoir-interviewer 담당 — 이 스킬은 질문하지 않고 대화하지 않는다.

- [문서](skills/writing-experts/career-memoir-compiler/README.md)
- [구현 가이드](skills/writing-experts/career-memoir-compiler/docs/GUIDELINES.md)
- [레퍼런스](skills/writing-experts/career-memoir-compiler/docs/REFERENCE.md)

### [career-memoir-interviewer](skills/writing-experts/career-memoir-interviewer)

**버전**: 1.1.0

경력 회고 에세이를 위한 저자 인터뷰를 진행한다. 한 번에 한 질문, 패러프레이즈 선행, 감정·고민 명시 질문, 세션 원문 축적과 holding 큐로 세션 간 연속성 유지. 경력 회고 인터뷰, 회고 인터뷰 시작, 인터뷰 이어서 같은 요청이 있을 때 사용. 산문 작성·정리·초안 생성은 career-memoir-compiler 담당.

- [문서](skills/writing-experts/career-memoir-interviewer/README.md)
- [구현 가이드](skills/writing-experts/career-memoir-interviewer/docs/GUIDELINES.md)
- [레퍼런스](skills/writing-experts/career-memoir-interviewer/docs/REFERENCE.md)



---
*이 파일은 `tools/generate-index.sh`에 의해 자동 생성되었습니다*
