# 스킬 인덱스

이 저장소에 포함된 모든 스킬의 카테고리별 인덱스입니다.

## email-experts

### [cloudflare-email-routing](skills/email-experts/cloudflare-email-routing)

**버전**: 0.5.0

Cloudflare Email Routing + Gmail 조합의 운영 계층 — 라우팅 설정 검수, 메일 인증(SPF·DKIM·DMARC) 진단, DMARC 집계 리포트 분석, 스푸핑 인시던트 대응, 월간 헬스체크, 주간 수신 실패 보고를 다룬다. 트리거 — "메일 수신 실패 보고", "주간 이메일 실패 표", "DMARC 리포트 분석", "DMARC 리포트 급증", "스푸핑 메일 분석", "_dmarc 중복", "SPF/DKIM 확인", "이메일 라우팅 설정", "catch-all 점검", "도메인 메일 건강검진", "Cloudflare 이메일 라우팅", "send-as 정합". 인자가 없으면 대화 문맥으로 모드(인시던트·온보딩·헬스체크·리포트 분석·주간 보고)를 판별하고, 판별이 안 되면 한 번만 묻는다. 부정 라우팅 — Gmail 메일함 정리·라벨링은 gmail-triage 소관, Cloudflare API 일반 참조는 cloudflare 플러그인 소관이다. 특정 도메인의 현재 값과 기준선은 이 스킬이 알지 못하며 호출자가 baseline JSON 파라미터로 넘긴다.

- [문서](skills/email-experts/cloudflare-email-routing/README.md)
- [구현 가이드](skills/email-experts/cloudflare-email-routing/docs/GUIDELINES.md)
- [레퍼런스](skills/email-experts/cloudflare-email-routing/docs/REFERENCE.md)


## meta-experts

### [skill-author](skills/meta-experts/skill-author)

**버전**: 1.2.1

이 저장소(aha-skills)에 새 에이전트 스킬을 추가합니다. 상호작용 모델을 판정해 context/agent/background/WORKER.md를 파생시키고, 저장소 관례(카테고리 kebab-case, language korean, docs/INDEX.md, 훅 matcher 규칙, scripts/tests/run.sh)에 맞는 파일 일습을 만든 뒤 실제 내용까지 채우고 검증기까지 돌립니다. "스킬 만들어줘", "새 스킬 추가해줘", "이 작업을 스킬로 만들자", "/skill-author" 요청이 있을 때, 또는 반복 작업을 스킬로 굳히자는 이야기가 나올 때 사용하세요. skills/ 아래에 새 디렉토리를 만드는 일이면 이 스킬을 쓰세요 — 범용 skill-creator는 이 저장소의 판정표와 검증기를 모르므로 여기서 만든 뒤 평가·트리거 최적화가 필요할 때 넘깁니다. 기존 스킬 수정·리뷰·평가에는 쓰지 않습니다.

- [문서](skills/meta-experts/skill-author/README.md)
- [구현 가이드](skills/meta-experts/skill-author/docs/GUIDELINES.md)
- [레퍼런스](skills/meta-experts/skill-author/docs/REFERENCE.md)


## social-experts

### [bluesky-expert](skills/social-experts/bluesky-expert)

**버전**: 1.0.0

Bluesky 전용 최근 글·지정 permalink 조회, bootstrap, 단일 글·답글 체인·사진 게시, read-back. 게시물당 300 grapheme, 사진 4장 이하·alt 필수, 게시물별 해시태그 0~1개. /bluesky-expert, "Bluesky 글 준비해줘", "Bluesky 초안만 써줘" 요청 시 사용. "Bluesky 최근 글 확인해줘"도 처리한다. 여러 플랫폼의 묶음 작업은 social-posting이 담당한다. 무인 실행은 읽기·비교·보고만 한다.

- [문서](skills/social-experts/bluesky-expert/README.md)
- [구현 가이드](skills/social-experts/bluesky-expert/docs/GUIDELINES.md)

### [facebook-expert](skills/social-experts/facebook-expert)

**버전**: 1.0.0

Facebook 전용 최근 글·지정 permalink 조회, bootstrap, 단일 글·사진 게시·공개 범위, read-back. 본문 63206 codepoint 이하, format: single만 지원하며 사진 수의 하드 상한은 없다. /facebook-expert, "Facebook 글 준비해줘", "Facebook 초안만 써줘" 요청 시 사용. "Facebook 최근 글 확인해줘"도 처리한다. 여러 플랫폼의 묶음 작업은 social-posting이 담당한다. 무인 실행은 읽기·비교·보고만 한다.

- [문서](skills/social-experts/facebook-expert/README.md)
- [구현 가이드](skills/social-experts/facebook-expert/docs/GUIDELINES.md)

### [instagram-expert](skills/social-experts/instagram-expert)

**버전**: 1.1.0

Instagram 사진 피드의 최근 글·지정 permalink 조회·비교, 실제 캡션 기반 보이스 수집, 사진 1~20장과 공통 캡션 초안·read-back을 담당한다. /instagram-expert, "Instagram 최근 사진 확인해줘", "인스타 캡션 초안만 써줘", "Instagram에 이 사진들 올려줘" 요청 시 사용한다. 게시 요청은 기본 private(기존 친한친구)이며 public만 건별 사람 승인을 요구한다. 실제 UI 대상을 확인하지 못하면 게시하지 않는다. 영상·릴스·스토리·DM·댓글·이미지 생성과 편집·프로필 설정 변경은 지원하지 않는다. 여러 플랫폼 묶음은 social-posting이 담당한다.

- [문서](skills/social-experts/instagram-expert/README.md)
- [구현 가이드](skills/social-experts/instagram-expert/docs/GUIDELINES.md)

### [linkedin-expert](skills/social-experts/linkedin-expert)

**버전**: 1.0.0

LinkedIn 전용 기존 bootstrap, 단일 글·기존 사진 게시, read-back만 지원한다. 본문 3000 codepoint 이하, 사진 9장 이하, format: single만 지원한다. /linkedin-expert, "LinkedIn 글 준비해줘", "LinkedIn 초안만 써줘" 요청 시 사용. 여러 플랫폼의 묶음 작업은 social-posting이 담당한다. 무인 실행은 읽기·비교·보고만 한다.

- [문서](skills/social-experts/linkedin-expert/README.md)
- [구현 가이드](skills/social-experts/linkedin-expert/docs/GUIDELINES.md)

### [linkedin-followup](skills/social-experts/linkedin-followup)

**버전**: 1.13.0

LinkedIn 최근 미응답 대화를 확인·요약하고 답장 초안을 다듬어 승인 후 기존 대화에 회신한다(링크드인 팔로업 루프). "LinkedIn 팔로업 확인해줘", "LinkedIn 답장 안 한 메시지 확인해줘", "회신 초안 써줘", "LinkedIn 정기 확인 등록해줘" 요청할 때 사용한다. Orca 정기 확인 등록을 선택적으로 지원하며 게시물·새 대화·연결 수락은 다루지 않는다.

- [문서](skills/social-experts/linkedin-followup/README.md)
- [구현 가이드](skills/social-experts/linkedin-followup/docs/GUIDELINES.md)

### [social-posting](skills/social-experts/social-posting)

**버전**: 0.14.0

선택한 소셜미디어 그룹의 조회·교차 비교·초안·승인·게시를 조정한다. "Facebook 글을 X와 Bluesky에 맞춰줘", "선택한 플랫폼만 준비해줘", "최근 글 확인해서 다른 곳에도 올려줘", "/social-posting" 요청할 때 사용한다. 단일 플랫폼 작업도 호환하며 전용 x-expert·facebook-expert·bluesky-expert·threads-expert·linkedin-expert·instagram-expert로 직접 요청할 수 있다. 요청한 동작만 수행하고 기존 초안 게시에 재작성을 강제하지 않는다. 최근 글은 Facebook·Threads·X·Bluesky의 기본 최근 24시간(기간 변경 가능), LinkedIn scan은 비지원이다. X·Bluesky 답글 체인·사진을 지원한다. Instagram 사진 피드는 기본 private(기존 친한친구) 정책 허용과 public 사람 승인을 구분하며 실제 UI 대상 불명이면 중단한다. Threads 게시는 차단한다. 유사 후보 확인과 최종 게시 승인은 별도다. 기존 무인 scan은 읽기 전용이며 사전 허용한 Instagram 게시 작업만 정책에 따라 실행한다.

- [문서](skills/social-experts/social-posting/README.md)
- [구현 가이드](skills/social-experts/social-posting/docs/GUIDELINES.md)
- [레퍼런스](skills/social-experts/social-posting/docs/REFERENCE.md)

### [social-sync](skills/social-experts/social-sync)

**버전**: 0.1.0

X·Facebook·Threads·Bluesky 계정의 글을 상호 동기화하는 orca 정기 자동화. "소셜 동기화 등록해줘", "크로스포스트 자동화 걸어줘", "X에만 올린 글 다른 플랫폼에도 올려줘", "/social-sync", "sync tick", "동기화 승인 대기 게시해줘" 같은 요청 시 사용한다. LLM 없는 precheck 게이트(scripts/sync_gate.py)가 새 글을 찾을 때만 에이전트를 깨우고, tick이 미디어 수집·글자수 초과 스레드 분할 초안까지 준비한 뒤 사용자 승인(social-posting의 "게시 승인" 훅 계약)을 거쳐 게시한다. setup(최초 설정·첫 실행 며칠치 질문)/tick(무인)/approve(승인·게시)/status 모드가 있다. Threads 게시는 실환경 검증 전까지 대상에서 제외한다.

- [문서](skills/social-experts/social-sync/README.md)
- [구현 가이드](skills/social-experts/social-sync/docs/GUIDELINES.md)

### [threads-expert](skills/social-experts/threads-expert)

**버전**: 1.0.0

Threads 전용 최근 글·지정 permalink 조회, bootstrap, 초안 준비만 지원한다. 길이는 참고 codepoint와 lengthVerified:false로 보고한다. 게시·게시 승인·read-back 검증으로 진행하지 않는다. /threads-expert, "Threads 글 준비해줘", "Threads 초안만 써줘" 요청 시 사용. "Threads 최근 글 확인해줘"도 처리한다. 여러 플랫폼의 묶음 작업은 social-posting이 담당한다. 무인 실행은 읽기·비교·보고만 한다.

- [문서](skills/social-experts/threads-expert/README.md)
- [구현 가이드](skills/social-experts/threads-expert/docs/GUIDELINES.md)

### [x-expert](skills/social-experts/x-expert)

**버전**: 1.0.0

X 전용 최근 글·지정 permalink 조회, bootstrap, 단일 글·답글 체인·사진 게시, read-back. 게시물당 280 weighted, 사진 4장 이하, 체인 게시물 2~25개. /x-expert, "X 글 준비해줘", "X 초안만 써줘" 요청 시 사용. "X 최근 글 확인해줘"도 처리한다. 여러 플랫폼의 묶음 작업은 social-posting이 담당한다. 무인 실행은 읽기·비교·보고만 한다.

- [문서](skills/social-experts/x-expert/README.md)
- [구현 가이드](skills/social-experts/x-expert/docs/GUIDELINES.md)


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
