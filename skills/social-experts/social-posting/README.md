# social-posting

선택한 플랫폼 그룹의 조회·비교·초안·승인·게시를 조정하는 스킬. 단일 플랫폼은 `x-expert`·`facebook-expert`·`bluesky-expert`·`threads-expert`·`linkedin-expert`·`instagram-expert`로 직접 요청할 수 있다. 모든 진입점은 같은 ego 실행층과 승인 가드를 공유한다.

## 빠른 시작

```text
"소셜 포스팅 만들어줘"  또는  /social-posting
```

요청한 동작과 플랫폼부터 구분한다. 조회·비교만 요청하면 결과와 수집 한계를 보고하고 끝낸다. 초안만 요청하면 게시 승인을 요구하지 않는다. 기존 초안 게시는 소재·canonical을 다시 쓰지 않고 해당 대상만 검사한다. 인자가 없으면 게시 의도를 가정하지 않고 동작·대상을 묻는다.

```text
"X 최근 24시간 글만 확인해 줘" → x-expert, 조회 후 종료
"Facebook 글을 X·Bluesky에 맞춰 줘" → social-posting, 두 대상만 준비
"기존 작업에서 X 초안만 게시해 줘" → x-expert, X만 새 승인
```

전체 작성·게시 요청은 다음 순서로 진행한다:

1. 사실·관점 수집 (검증 못한 주장은 "질문 필요" 마커 — 지어내지 않는다)
2. 보이스 프로필 확인 (없으면 부트스트랩)
3. canonical message 작성
4. 플랫폼별 별도 작성 (복사 금지)
5. 하드 제약 기계 검증 (문자 수·alt text 등)
6. 초안 승인 게이트
7. 게시 (publish.sh 가드 → ego-post 실행 계층)
8. 게시 후 read-back 검증

## 요구 사항

- ego lite 데스크톱 앱 + ego-browser CLI 0.6.3 이상 (사용할 플랫폼에 로그인된 프로필 1개)
- node 24 이상 (ego-post.mjs 실행 계층)
- uv (하드 제약 검사의 grapheme 계산용)
- jq

## 최근 글 scan과 후보 비교

최근 글 요청은 기본 최근 24시간이며 기간을 바꿀 수 있다. 대상을 지정하면 그 플랫폼만 읽고, 생략하면 Facebook·Threads·X·Bluesky 중 바인딩된 프로필을 읽는다. LinkedIn 최근 글·permalink scan과 scan 사진 fetch는 지원하지 않는다. 실행 기준 시각·timezone·`since`·`until`을 같은 구간으로 고정한다. 미바인딩·접근 실패·시간 미상과 `coverage.complete:false`의 중단 이유를 함께 보여준다. 사진만 있는 글도 보존한다. `compare`의 `duplicate`·`needs_review`·`new`는 비교 근거이지 자동 선택이나 게시 지시가 아니다. `new`는 관찰 범위 내 대응 글 미발견을 뜻한다.

Facebook 시각은 정상 UI가 받은 Document·GraphQL 응답 중 같은 Story의 ID·permalink·작성자에 연결된 값으로 우선 보강한다. 본문·사진·parent·신원은 DOM 근거를 유지하고, 다른 글의 `creation_time`을 가져오거나 시간 미상을 최근 글로 확정하지 않는다. 수신 응답 보강도 전체 이력 수집을 보장하지 않는다. Facebook 시각·Bluesky 본인 신원·Threads 읽기 추출의 실환경 검증 결과는 오프라인 회귀와 별도로 확인해야 한다.

Bluesky도 정상 UI가 받은 피드 응답의 `record.createdAt`을 같은 게시물 ID·작성자의 DOM 원문 URL에 결합한다. 분 단위 tooltip·상대시간이나 수집 시스템의 `indexedAt`을 게시시각으로 쓰지 않는다. 본문·사진·parent는 DOM 근거를 유지하고 응답을 결합하지 못하면 시각 미상으로 남긴다.

수동 실행은 후보·대상·사진을 선택한 뒤 초안을 준비한다. scan 후보는 게시 직전 AskUserQuestion으로 유사 글과 실제 대상을 확인하고, 사람 승인이 필요한 대상은 별도의 `게시 승인`을 받는다. Instagram private의 정책 허용은 아래처럼 구분한다. Orca는 주기·기간·후보 큐·알림·중복 실행 방지만 관리한다. `assets/orca-scan-prompt.md`가 읽기 전용 전달 프롬프트이며 실제 등록은 별도 승인 대상이다. 기존 무인 scan은 setup·초안 확정·승인·게시·재시도를 하지 않는다.

사진은 접근 가능한 글에서 선택해 재업로드한다. 타인 글의 접근 가능성과 재게시 권리는 구분한다. 사진 상한을 넘으면 관찰 ID·URL·alt를 보고 사용자가 선택한다. scan 사진 파일과 출처 기록은 hash로 검증하며, 실행 전 승인된 바이트의 임시 사본을 만들어 사본만 업로드 경로에 전달한다. 일반 non-scan 로컬 파일은 Instagram에 한해서 같은 읽기 전용 동결 사본을 사용한다. public Instagram 사진은 승인 전에 sha256이 필수이며 사진 바이트·순서·alt 변경은 재승인한다. 다른 플랫폼의 일반 로컬 파일까지 같은 보장을 확대하지 않는다. 사본은 실행 종료 시 정리한다. 반환한 `provenanceSha256`도 초안의 `provenance_sha256`에 기록해 승인에 묶는다. 구계약 scan 초안은 사진 재준비·재승인이 필요하다. MIME·signature·수신 후 10 MiB 검사 통과는 전체 이미지 디코딩·수신 중 상한·실제 업로드 성공을 뜻하지 않는다.

## Instagram 사진 피드

Instagram은 명시적으로 고른 경우에만 조회·비교·보이스 수집·초안·read-back을 처리한다. 기본 scan 네 플랫폼은 바뀌지 않는다. 사진 1~20장과 공통 캡션을 한 피드로 준비하며 빈 캡션은 허용한다. 캡션 2,200 Unicode codepoint는 로컬 정책이고 실제 웹 계수 단위는 미확인이다. 사진 순서·각 alt·원본 출처와 재게시 권리·공통 방향/잘림 의도를 확인한다. 사진이 없으면 제공 또는 대상 제외를 묻는다. 사진을 자동 절삭·분할·생성하지 않고 영상·릴스·스토리·DM·댓글 체인은 다루지 않는다.

게시 기본값은 **private: 기존 친한친구 목록에만 실제 발행**이다. 로컬 초안·나만 보기·비공개 계정의 팔로워 전체 공개가 아니다. 범위 생략은 private이며 명시적 keep은 거부한다. 조회·비교·초안은 게시 권한이 아니며, 명시적 게시 요청 또는 사전에 허용한 게시 작업의 private만 건별 사람 승인을 생략한다. private를 사람이 승인한 것으로 기록하거나 다른 플랫폼의 승인 집합을 바꾸지 않는다.

**public은 공개 계정의 Everyone 대상과 캡션·사진·계정·공개 범위에 결합된 AskUserQuestion 사람 승인이 필요**하다. 승인 후 내용·사진·계정·범위가 바뀌면 재승인한다. publish와 직접 post는 같은 정책을 강제하며 실제 composer의 대상 선택·Share 직전 계정 확인이 불가능하거나 불명·팔로워 공개·요청 불일치면 중단한다. 계정 설정·계정 유형·친한친구 목록은 바꾸지 않고 public으로 대체하지 않는다.

기존 무인 조회 작업은 계속 읽기 전용이다. 사전에 허용한 Instagram 게시 작업은 확정 초안·사진·계정으로 private 정책을 통과하거나 public의 일치하는 사람 승인 영수증이 있어야 한다. 질문이 남으면 수동 세션에 넘기며 public 승인을 스스로 만들지 않는다. 다른 플랫폼의 무인 쓰기 금지는 유지한다.

UI는 **합성 fixture만 검증했으며 실서비스는 미확인**이다. dry-run은 정적 검사이지 실제 UI 범위 확인이나 게시 허가가 아니다. 실계정·사진 업로드·게시 검증은 별도 승인 대상이다. read-back은 captionMatched·media.complete·audience.requested/observed/matched를 구분하며 사후 범위 불명·불일치로 POSTED를 취소·삭제·재게시하지 않는다. 자세한 규칙은 `../instagram-expert/docs/playbook.md`를 따른다.

## 보이스 프로필 부트스트랩

처음 사용하면 ego-post bootstrap으로 본인 최근 게시물(15~20개)을 읽어 말투·안티패턴·실제 샘플 3~5개를 추출한 보이스 프로필 초안을 만든다. 프로필은 검수 게이트에서 사용자가 확인한 뒤 저장되고, 이후 모든 문안에 적용된다. 원본 게시물은 `social/bootstrap-cache/`에 남아 재추출 없이 재검수할 수 있다. 안티패턴·금지 주제는 추론만으로 확정하지 않는다 — 반드시 검수를 거친다.

## 작업 데이터 위치 (경로 독립)

이 스킬은 어떤 절대경로도 문서에 굽지 않는다. 작업 데이터는 `<작업 루트>/social/` 아래에 살고, 작업 루트는 호출 인자 → CWD 탐색 → 사용자 확인 순서로 확정된다. 상세 레이아웃은 `assets/state-schema.md` 참조.

## 계정 주의

- 게시 계정 = ego lite에 로그인된 프로필. Stage 2에서 `ego-post.mjs setup`이 플랫폼별 신원(handle·slug)을 확정하고 사용자가 확인한다. 프로필이 바뀌면 게시가 `EGO_ACCOUNT_MISMATCH`로 차단된다.
- 개인/사내 계정 혼동이 1순위 사고다 — 기본값으로 조용히 빠지지 않게 반드시 확인하고, publish.sh가 job-state 기재 계정과만 게시한다.

## Draft → Ready

사람 승인이 필요한 경로에서 초안은 `draft`로 태어나고, 승인받으면 Ready가 된다. **Ready 판정식**: `approved_digests`에 해당 플랫폼이 있고 `drafts/<platform>.md`의 sha256과 일치. 승인 후 문안·사진·계정·공개 범위를 고치면 다시 승인받아야 한다. Instagram private는 사람 승인 Ready가 아니라 명시적/사전 허용 게시 의도·현재 초안/사진/계정·실제 친한친구 확인에 따른 정책 허용이다.

## 스레드 (X·Bluesky·Threads)

초안 frontmatter에 `format: thread`를 두고 게시물 사이를 `=== POST ===` 한 줄로 구분한다. X·Bluesky의 후속 세그먼트는 **직전 세그먼트의 게시 성공과 확인된 URL**이 모두 있을 때만 그 URL에 답글로 연결한다. URL 미회수·부분 게시·결과 불명에서는 자동 이어쓰기를 멈춘다. Threads는 아래와 같이 게시를 차단한다.

- 게시물 2개 이상(X는 25개 이하). X는 280 weighted(twitter-text v3), Bluesky는 300 grapheme를 게시물별로 검사한다. 사진과 link는 첫 세그먼트에만 붙인다.
- **LinkedIn·Facebook은 스레드를 지원하지 않는다** — 단일 게시물로 쓴다.
- **Threads는 수집·초안만 가능하며 게시는 차단된다.** 전체 UTF-8 500바이트 규칙을 적용하지 않고 codepoint 참고값·`lengthVerified:false`를 표시한다. 별도 실환경 검증 전에는 publish와 직접 post 모두 `THREADS_UNVERIFIED`로 거부한다.
- 게시 성공 신호는 ego-post의 DOM 증거 판정이다: 부분 게시는 `PARTIAL_POSTED`로 실패 보고되고(재시도 금지), URL 회수 실패는 `POSTED`+`urlRecovered:false`로 성공 보고된다(중복 게시 방지).
- `POST_UNKNOWN`은 게시 여부를 확정하지 못한 상태다. 재시도하지 말고 프로필에서 실제 게시 여부부터 확인한다.
- 이전 Aside 버전에서 일괄 허용한 권한은 업데이트로 회수되지 않는다. 별도 승인·회수 절차는 `docs/REFERENCE.md`를 따른다.
- 구조 규칙(훅→바디→클로저 3존, 번호 매기기)은 `docs/playbook-x.md`·`docs/playbook-bluesky.md`의 스레드 섹션 참조.

## 게시는 되돌릴 수 없다

- 모든 게시는 `scripts/publish.sh`의 대상·초안·하드 제약·계정·사진 동결 가드를 거친다. 사람 승인 경로에는 digest와 전체 승인 계정 스냅샷 검사가 추가되며 Instagram private만 사람 영수증 조건에서 분기한다.
- 사람 승인은 AskUserQuestion 훅만 기록한다. 질문에 `게시 대상: x,bluesky`처럼 이번 사람 승인 대상을 표시해야 한다. Instagram은 public만 이 목록에 넣고 private·Threads는 넣지 않는다. 훅은 그 대상의 digest만으로 이전 승인 집합을 교체하고 전체 계정 스냅샷 검사는 유지한다. 혼합 작업의 다른 초안은 승인·수정·삭제하지 않는다. 신규 전문가 진입이나 사람 승인 대상 범위 변경은 새 승인을 받는다.
- 게시 후 read-back에서 문구 불일치가 발견되면 즉시 보고된다 (플랫폼 삭제 창이 닫히기 전에).

## 문제 해결

| 증상 | 원인·해결 |
| --- | --- |
| `ego-browser CLI를 찾을 수 없습니다` | ego lite 데스크톱 앱 설치 후 CLI 확인 (`ego-browser --version`) |
| setup이 `EGO_NEEDS_LOGIN`으로 실패한다 | ego lite에서 해당 플랫폼에 로그인한 뒤 재시도 |
| 게시가 "재승인 필요"로 거부됐다 | 승인 후 초안이 수정된 것 — 정상 동작이다. Stage 8 승인부터 다시 |
| 하드 제약 검사가 안 돈다 | uv 부재 — fail-closed 동작. uv 설치 후 재시도 |
| 승인했는데 게시가 거부된다 | record-approval.sh 훅이 승인을 못 기록한 것 — Stage 8 게이트의 header가 정확히 `게시 승인`인지 확인 |
| 대화가 압축된 뒤 승인 상태를 모르겠다 | `post-state.sh get`으로 영수증 복구 — 이전 승인을 가정하지 않는다 |

## 상세 문서

- `SKILL.md` — 전체 스테이지 흐름
- `docs/INDEX.md` — 문서 목록
- `assets/state-schema.md` — 작업 상태 형식
- `assets/voice-profile-schema.md` — 보이스 프로필 형식
