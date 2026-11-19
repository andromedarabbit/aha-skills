# 소셜미디어 포스팅 — 상태 스키마

이 문서는 게시 작업 상태 구조를 정의하는 **유일한 source of truth**다. SKILL.md와 docs/REFERENCE.md가 이 문서를 참조하며, 다른 어떤 파일도 상태 형식을 재정의하지 않는다. 스키마와 다른 표기·규칙을 발견하면 그쪽이 틀린 것이고 이 문서를 따른다.

- 이 파일: `assets/state-schema.md` (스킬 루트 기준 상대경로)
- 데이터가 사는 곳(사용자 데이터 — **경로는 런타임에 확정, 이 스킬은 어느 절대경로도 모른다**):
  - 소셜 루트: `<작업 루트>/social/` (호출 인자 → CWD 탐색 → 사용자 확인 순서로 확정)
  - 게시 작업: `<작업 루트>/social/<job-slug>/`
  - 활성 작업 포인터: `${TMPDIR}/social-posting-current-job` (머신 전체 1개 — 한 번에 한 작업만 활성화)

## 0. 상태의 세 주체

| 주체 | 대상 | 책임 |
| ---- | ---- | ---- |
| 에이전트 (주 대화) | job-state.md, material.md, canonical.md, drafts/, post-log.md | 작업 진행 산출물 작성·갱신 |
| record-approval.sh 훅 | receipt.json의 `approved_*` | 승인 사실 기록 (유일한 입구 — 에이전트는 set 불가) |
| publish.sh / 에이전트 | receipt.json의 `posted_*` | 게시 결과 기록 (post-state.sh set) |

## 1. 작업 디렉토리 구성

```text
<작업 루트>/social/
├── voice-profile.md            # 보이스 프로필 (voice-profile-schema.md 참조)
├── bootstrap-cache/            # 부트스트랩 원본 게시물 캐시 (플랫폼별 .md)
└── <job-slug>/                 # 게시 작업 1건 (kebab-case)
    ├── job-state.md            # 압축 상태 + 요구사항 (사람이 읽는 축)
    ├── receipt.json            # 승인·게시 영수증 (머신이 쓰는 축)
    ├── material.md             # 사실·관점·수치·고유명사 + 출처, `질문 필요` 마커
    ├── canonical.md            # canonical message
    ├── media/                  # materialize-media.mjs가 보관한 local media (선택)
    ├── scans/<scan-id>/<platform>/ # 플랫폼별 읽기 전용 관찰 산출물
    │   └── scan-manifest.json   # 후보·검토 목록·관찰 범위
    ├── drafts/<platform>.md    # 플랫폼별 초안 (x/linkedin/facebook/bluesky/threads/instagram)
    └── post-log.md             # 게시 URL·시각·read-back 결과
```

## 2. job-state.md frontmatter

```yaml
stage: 2          # 0(요구사항 확정) ~ 10(게시 후 검증 완료)
slug: my-post     # 작업 슬러그 (폴더명)
root:             # 작업 루트 절대경로 — 재개·이동 탐지용 (런타임에만 기록)
created: YYYY-MM-DD
updated: YYYY-MM-DD
platforms: [x, linkedin]              # flow style 필수 — publish.sh가 파싱한다
accounts: {x: <ego 신원>, linkedin: <ego 신원>}  # flow style 필수 — 플랫폼 → ego 바인딩 신원(setup이 확정한 handle·slug)
source: {type: topic, topic: ...}     # 또는 {type: document, path: ...}
# scan 후보에서 시작했을 때: {type: scan, platform: x, candidate_id: ..., url: ..., scanned_at: ...}
status: {x: draft, linkedin: draft}   # draft → ready → posted (사람용 표시)
post_intent: teaser                   # teaser | summary — Stage 2 포스트 목적 (선택 키)
```

요건:

- `platforms`·`accounts`·`status`는 **한 줄 flow style**(대괄호·중괄호)로 쓴다 — publish.sh가 sed로 파싱한다.
- `instagram`도 작업·초안·계정 키로 인식한다. 기존 작업이나 영수증을 강제 이전하지 않으며 다른 플랫폼의 초안·전체 계정 매핑·게시 기록을 보존한다. 기본 scan 대상은 기존 X·Facebook·Bluesky·Threads 네 플랫폼이고 Instagram은 명시적으로 선택한다.
- `accounts` 값은 ego 바인딩 신원만 담는다 — `ego-post.mjs setup`이 기록한 신원 문자열(X handle·LinkedIn slug 등). publish.sh가 이 값을 페이로드 `identity`로 실어 ego-post가 binding과 대조한다(불일치 = 계정 재타깃 → 게시 거부).
- `post_intent`는 `teaser` 또는 `summary`만 담는다. 없으면 `summary`로 취급한다(기존 작업 호환). Stage 5 canonical이 이 값을 읽어 티저형(훅 1개 + 링크 유도만)과 요약형을 구분한다.

## 3. 초안 파일 형식 (drafts/<platform>.md)

```markdown
---
platform: x
format: single            # single | thread
media:                    # 선택
  - path: ./image.png
    alt: 대체 텍스트
    # scan에서 수집한 파일이면 다음 네 필드가 모두 필수
    source: scan
    sha256: <64자리 소문자 hex>
    provenance: ./media/<image-sha256>.<provenance-sha256>.provenance.json
    provenance_sha256: <출처 파일의 64자리 소문자 hex>
link: https://example.com # 선택. 본문에 넣을 링크
visibility: public        # 선택. Facebook: public | friends | keep(기본), Instagram: private(기본) | public
---

본문 게시 문구.

=== POST ===

(thread일 때만) 두 번째 게시물 문구.
```

요건:

- frontmatter `platform`은 파일명과 같아야 한다(불일치·파싱 불가 형식은 하드 제약 위반 — fail-closed).
- 스레드 경계는 **정확히 `=== POST ===` 한 줄**이다 — check-drafts.py가 이 경계로 게시물을 분리해 길이를 각각 검사한다.
- `visibility`는 선택 키다. Facebook은 기존대로 `public`=공개, `friends`=친구만, `keep`=기존 설정 유지·기본값을 쓴다. Stage 2에서 사용자에게 반드시 묻고 답을 기록하며 공개 범위는 Convention 등급이다. Instagram은 **키를 생략한 경우만 `private`**로 정규화한다. `private`는 로컬 초안이나 나만 보기가 아니라 기존 친한친구 대상 실게시 요청이고, `public`은 전체 공개 요청이다. 명시적인 `keep`·빈 값·알 수 없는 값은 하드 제약 위반으로 거부하며 계정 기본 설정으로 대신하지 않는다. 다른 플랫폼의 기존 기본값과 동작은 바꾸지 않는다.
- `format`과 게시물 수는 정합해야 한다: `single`은 게시물 정확히 1개, `thread`는 **2개 이상**(하드 제약 — 어긋나면 fail-closed).
- `source: scan` 미디어는 `path`·`provenance`가 게시 작업의 `media/` 아래 일반 파일이어야 한다. `sha256`은 이미지 파일, `provenance_sha256`은 출처 파일의 SHA-256이다. 출처의 이미지 hash·bytes·alt도 대조한다. 같은 이미지의 여러 원본 출처는 별도 파일로 보존한다. 승인 뒤 파일·alt·출처 변경은 게시를 거부한다. 실행 전에 사진·출처를 전용 임시 사본으로 복사하고 사본의 승인 digest를 다시 대조한다. 실행 계층은 검증된 사본 경로만 읽으며 실행 종료 시 사본을 정리한다. 동결 뒤 원본이 바뀌어도 승인되지 않은 원본 바이트를 업로드하지 않는다. 구계약 초안은 사진을 다시 준비하고 재승인한다.
- Instagram은 `format: single` 사진 피드 하나만 준비한다. `media` 배열 순서가 사진 순서이며 JPEG·PNG·WebP 확장자의 사진 경로 1~20개와 각각 비어 있지 않은 문자열 `alt`가 필수다. 이 형식 목록은 로컬 초안 정책이며 실제 파일의 정지 이미지 여부나 웹 업로드 지원을 입증하지 않는다. 텍스트 단독·영상·GIF·릴스·스토리·답글 체인은 지원하지 않고 자동 자르기·분할·변환하지 않는다. `body`는 공통 캡션이며 빈 문자열도 허용한다. 기존 페이로드의 `body`·`media` 배열을 그대로 쓰고 별도 캡션 필드를 만들지 않는다.
- Instagram `public` 초안은 `source: scan` 여부와 관계없이 각 사진의 현재 바이트와 일치하는 64자리 소문자 hex `sha256`이 필수다. 승인 전에 사진 해시를 초안에 기록해 전체 초안 digest에 결합한다. 게시용 페이로드의 `--freeze-media` 경로는 `private`·`public` 모두 일반 로컬 사진까지 전용 임시 사본으로 동결하고, 사본 경로·사진 순서·alt·사본 바이트의 `sha256`을 전달한다. 사진은 비어 있지 않은 일반 파일이어야 하며 심볼릭 링크·FIFO·디렉터리를 거부한다. 초안에 사진 해시가 있으면 동결 사본과도 일치해야 한다. 동결 뒤 원본 경로나 바이트가 바뀌어도 실행층은 검증된 사본만 읽는다. 다른 플랫폼의 일반 로컬 사진 경로 계약은 유지한다.
- Instagram 캡션은 본문에 덧붙는 `link`와 줄바꿈까지 합쳐 2,200 Unicode codepoint 이하로 검사한다. 이는 **로컬 초안 정책**이고 실제 웹 UI의 계수 단위는 미검증이다. 검사 결과는 `lengthVerified: false`와 경고를 포함한다. 비율·잘림은 이 검사로 확인하지 않는다.
- Instagram은 두 게시 진입점(`publish.sh`·직접 `ego-post.mjs post`)에서 같은 private/public 정책을 적용한다. 명시적 게시 요청 또는 사전에 허용한 게시 작업의 private만 건별 추가 사람 승인을 생략하며, 기존 친한친구 대상이 실제 composer에서 선택·확인되어야 한다. public은 공개 계정·실제 전체 공개 대상과 내용/사진/계정/범위에 결합된 사람 승인 영수증이 필요하다. 실제 대상 불명·불일치·팔로워 공개는 Share 전에 거부하며 계정 설정·친한친구 목록을 변경하거나 public으로 대체하지 않는다. UI 선택자는 합성 fixture만 검증했으며 실환경 지원은 미확인이다. dry-run은 정적 검사이고 실제 대상 확인이나 게시 허가가 아니다.
- Instagram 게시 결과에는 `audience: {requested, beforeShare, afterShare, authorization}`을 덧붙인다. `requested`는 private/public, 게시가 성립한 `beforeShare`는 close_friends/public이고 성립하지 않은 결과는 unknown이다. `afterShare`는 별도 사후 확인 전 unknown이며 `authorization`은 policy/human_approval로 구분한다. read-back 입력은 기존 `{urls,bodies}`에 Instagram 전용 `visibility`를 선택적으로 받을 수 있다. 결과의 `captionMatched`, `media.complete`, `audience: {requested, observed, matched}`는 별개다. 대상 게시물에 범위 근거가 없으면 observed=unknown·matched=null이며, 명시된 근거가 요청과 다르면 matched=false다. 캡션 일치나 일부 사진 관찰을 전체 사진/alt/공개 범위 확인으로 승격하지 않는다. 사후 범위 불명·불일치는 이미 성립한 POSTED를 실패로 바꾸거나 자동 삭제·재게시·범위 변경할 근거가 아니다.
- 스레드 초안은 x·bluesky·threads에서 준비할 수 있다. 실제 답글 게시는 X·Bluesky만 지원한다. LinkedIn·Facebook의 `format: thread`는 거부한다. X 스레드는 게시물 25개 이하다. Threads는 길이·사진·답글·read-back 실환경 검증 전까지 `THREADS_UNVERIFIED`로 차단한다.
- 스레드 게시는 각 세그먼트를 **직전 게시 성공과 URL이 모두 확인된 게시물에 대한 답글로 연결**한다(ego-post 고정 스크립트가 수행). URL 미회수·부분 게시·결과 불명에서는 자동 이어쓰기를 하지 않는다. 흩어진 게시물 N개가 아니라 하나의 답글 체인이어야 하며, 게시 성공은 ego-post의 DOM 증거 판정이다(부분 게시는 `PARTIAL_POSTED`, 클릭 후 결과 불명은 `POST_UNKNOWN`으로 실패 종료하며 둘 다 재시도 금지다. URL 회수 실패는 `POSTED`+`urlRecovered:false`로 성공 종료한다).
- 본문은 게시 그대로의 문구다. **게시 실행은 페이로드 JSON(body·media 절대경로+alt·link·visibility·identity)으로 전달된다**(publish.sh가 frontmatter를 제거해 조립, ego-post가 소비) — 반면 승인 digest는 **초안 전체 파일**(frontmatter 포함) 기준이라 검증 대상과 게시 대상이 원본 하나로 묶인다. `link` 키가 있으면 ego-post가 첫 세그먼트 끝에 링크를 한 줄 덧붙인다 — 본문에 이미 링크가 있으면 `link` 키를 비워라(중복 방지).

## 4. receipt.json (영수증)

```json
{
  "approved_digests": {"x": "sha256...", "linkedin": "sha256..."},
  "approved_accounts": "{x: my-handle, linkedin: my-slug}",
  "approved_at": "2026-09-01T00:00:00Z",
  "approved_via": "posttooluse-hook",
  "posted_x": "https://x.com/...",
  "posted_x_at": "2026-09-01T00:05:00Z"
}
```

불변식:

- `approved_*` 네 키(digests·accounts·at·via)는 **record-approval.sh 훅만** 기록한다(PostToolUse, matcher: AskUserQuestion, header `게시 승인`·정확한 답변 `게시` 계약). post-state.sh로는 set/unset 불가다.
- 승인 질문은 `게시 대상: x,bluesky` 형식의 한 줄을 포함한다. 목록은 x·linkedin·facebook·bluesky·public인 instagram 중 비어 있지 않은 중복 없는 집합이며 job `platforms`의 부분집합이어야 한다. 쉼표 외 공백이나 미지원 이름·Threads·private인 Instagram·존재하지 않는 초안이 있거나 대상 줄이 없거나 여러 개면 요청 전체를 거부하고 기존 영수증도 바꾸지 않는다. Instagram public은 승인 전에 사진 바이트와 초안의 sha256도 검사한다. Instagram·X 혼합 작업에서 X만 표시해 승인하면 X digest만 기록하되 Instagram을 포함한 전체 계정 snapshot과 기존 게시 기록은 보존한다. private 실행은 승인 집합을 교체하거나 사람 승인 키를 생성하지 않는다.
- `approved_digests`는 질문에 표시한 대상의 초안 전체 파일 SHA-256만 담는다. 새 승인은 이전 집합과 병합하지 않고 교체한다. 승인 범위를 좁혀도 기존 job·다른 초안·전체 계정 매핑·`posted_*` 기록은 축소하거나 삭제하지 않는다. 구영수증은 그대로 보존하되 신규 전문가 진입이나 게시 범위 변경은 새 승인을 요구한다.
- `approved_accounts`는 승인 시점 job-state의 accounts flow-map 라인 원문이다 — 승인은 **초안 전체 파일 digest + 계정 매핑**을 함께 묶고, publish.sh가 두 값 모두 현재 상태와 대조한다(계정 재타깃 차단).
- `posted_<platform>`는 게시 성공 후 에이전트가 `post-state.sh set posted_x <url>`로 기록한다. 실패한 게시는 기록하지 않는다.
- 영수증은 활성 작업 하나를 가리킨다 — 동시에 여러 작업을 활성화하면 섞이므로 금지.

## 5. Ready 판정식 (게이트 판정 가능 형태)

사람 승인이 필요한 public과 기존 플랫폼은 publish.sh가 게시 직전에 기계적으로 판정한다.

> **Ready 판정식: `approved_digests`에 해당 플랫폼이 있고 `drafts/<platform>.md`의 sha256과 일치**

Instagram private 판정식: 명시적 게시 요청 또는 사전에 허용한 게시 작업이고, 현재 초안·사진·계정이 검증되며 Share 직전 실제 친한친구 대상이 확인됨

private는 이 정책 허용으로 분기하며 사람 승인 Ready로 기록하지 않는다. 대상·계정·하드 제약·초안/사진 동결·실행 직전 변경 검사는 유지한다. 직접 post도 현재 작업(기존 `SOCIAL_POSTING_JOB` 또는 활성 포인터)의 초안·계정과 실제 전달한 본문/링크/공개 범위·사진 hash/순서/alt/바이트를 대조한다. public은 같은 작업의 훅 영수증과 전체 계정 snapshot도 재검증한다. 호출자가 넣은 `approved`·`verified` 표식은 승인 근거가 아니다. 실행할 사진은 이 검사를 통과한 새 동결 사본으로 고정한다.

하드 제약 통과 여부는 별도로 publish.sh가 check-drafts.py의 `--platform`으로 **현재 게시할 대상만** 재실행해 확인한다(이중 검사). 무관한 플랫폼의 미완성 초안은 이 게시를 막지 않는다. 전체 초안 비교·문형 경고는 검토 단계에서 별도로 제공한다. 승인 후 초안이 바뀌면 digest가 어긋나 게시가 거부된다 — 이때는 Stage 8 승인부터 다시 받는다. 이 판정식은 SKILL.md와 docs/REFERENCE.md에서 **동일 문구로** 참조해야 한다 — 문구가 어느 한쪽에서 달라지면 게이트 판정이 갈린다.

## 6. 재개·이동 탐지

- 대화 압축 후 재개: `post-state.sh get`으로 승인 여부를 복구한다. **이전 승인을 가정하지 않는다** — 사람 승인이 필요한 경로에서 영수증이 비어 있으면 Stage 8부터 다시 진행한다. Instagram private도 게시 의도·현재 대상·계정·초안·사진을 복구하고 실제 친한친구 범위를 새로 확인한다. 조회·초안 작업이나 기존 scan 전용 자동화에 게시 권한을 소급하지 않는다.
- 작업 루트 이동: job-state.md frontmatter `root`와 실제 경로가 다르면 사용자에게 확인하고 `root`를 갱신한다.

## 7. 최근 글 관찰 산출물

- `scan` 입력은 `platform`, `cursor: null`과 선택적인 `since`·`until`·`jobDir`다. 기간은 둘 다 생략하면 호출 시각 기준 최근 24시간, 지정하면 timezone offset이 있는 ISO 시각 두 개를 사용한다. `since`는 포함하고 `until`은 제외한다. 여러 플랫폼은 호출자가 같은 기간을 고정해 전달한다.
- 저장할 때 `jobDir` 입력은 게시 작업 루트의 절대경로다. scan은 `<게시 작업>/scans/<자동 생성 scan-id>/<platform>`에 저장하고 실제 디렉터리 `jobDir`·manifest 파일 `manifestPath`·원문 SHA-256 `manifestDigest`를 반환한다. 같은 루트에서 플랫폼별 조회를 반복해도 이전 결과를 덮어쓰지 않는다. `fetch-media`에는 반환된 `jobDir`를 전달한다.
- `scan-manifest.json`은 `SCAN_DONE` 결과를 보관한다. `candidates`는 기간 안의 글, `review`는 시각을 확인하지 못한 글(`reason: UNKNOWN_TIME`)이다. 사진만 있는 글도 보존한다. `publisher`는 관찰한 실제 게시자이며 확인하지 못하면 `null`이다. 로그인 신원인 최상위 `identity`로 대신 채우지 않는다.
- 후보는 `id`, `url`, `text`, `publishedAt`, `publisher`, `media: [{id, sourceUrl, alt}]`를 갖는다. 관찰 결과에 명시된 `parentUrl`은 보존하되 연속된 글이나 비슷한 본문만으로 관계를 추측하지 않는다. 원본 alt가 없으면 `null`로 유지한다. 시간 미상은 `publishedAt: null`이며 최근 글이라고 단정하지 않는다. 게시물 URL로 중복을 제거한다. URL 미상은 같은 페이지 세션의 DOM 노드에 부여한 `observationId`를 `id`로 재사용해 반복 집계를 막으며, 본문이 같아도 다른 노드는 합치지 않는다. 관찰 ID는 세션 사이의 게시물 식별자로 쓰지 않는다. X·Bluesky의 부모 permalink가 명시된 노드에서만 `parentUrl`을 수집하고 manifest까지 보존한다. X·Threads 사진은 첨부 컨테이너 안에서 수집하며 프로필·장식·중첩 인용 이미지는 제외한다. 실제 DOM 셀렉터의 동작은 별도 검증 대상이다.
- Facebook 게시시각은 정상 UI의 수신 Document·GraphQL 응답에서 같은 Story의 ID·permalink·작성자로 결합한 값으로 우선 보강한다. 본문·사진·parent·신원의 DOM 근거는 유지한다. 다른 글이나 중첩 인용의 `creation_time`은 쓰지 않고 결합 불가 시 `publishedAt: null`·`UNKNOWN_TIME`을 유지한다. 응답 해석·본문 회수 실패로 기존 글을 지우거나 전체 수집 완료로 승격하지 않는다.
- Bluesky는 같은 feedItem의 시각 링크로 원문 URL을 식별하고, 정상 UI가 받은 피드 응답의 직계 `post.record.createdAt`만 같은 게시물 ID·작성자에 결합한다. URI의 repo DID와 실제 작성자를 대조하며 인용·재게시 사유의 시각, `indexedAt`, 분 단위 tooltip·상대시간은 게시시각으로 채택하지 않는다. DOM 본문·사진·parent를 유지하고 결합하지 못하면 `publishedAt: null`·`UNKNOWN_TIME`이다.
- `coverage`는 `requestedSince`, `requestedUntil`, `referenceTime`, `timezone: UTC`, `observedOldest`, `observedNewest`, `observedCount`, `unknownTimeCount`, `complete`, `stopReason`, `limitations`를 갖는다. 시각은 UTC로 정규화하며 요청 구간의 offset도 보존한다. 관찰 방식의 limitation은 Facebook·Bluesky가 `DOM_WITH_PASSIVE_RESPONSE_TIME_WHEN_AVAILABLE`, 나머지는 `PROFILE_DOM_ONLY`다. 전자는 수신 응답의 게시시각 보강이 가능한 경로라는 뜻이지 실제 보강 성공이나 수집 완전성을 뜻하지 않는다.
- `stopReason`은 `POST_LIMIT`(최대 50건), `SCROLL_STALLED`(스크롤 후 새 글 없음), `TIME_LIMIT`(관찰 시간 상한) 또는 접근·실행 실패 코드다. 접근 실패 전 읽은 글은 보존한다. DOM과 수신 응답의 관찰만으로 전체 이력의 끝을 검증할 수 없으므로 `complete: false`, `nextCursor: null`을 유지한다. 고정글·시간 역전·빈 화면은 수집 완료의 근거가 아니다.
- manifest의 원문 SHA-256은 스킬 관리 상태 디렉터리의 별도 영수증에 경로와 함께 보관한다. `fetch-media`는 digest·플랫폼·로그인 신원·후보·사진 URL을 대조한다. manifest를 편집하면 사진 수집이 거부된다. 이 영수증은 게시 승인 영수증이 아니다.
- 선택적인 `postUrl`은 X·Facebook·Bluesky·Threads의 검증된 HTTPS 게시물 URL 또는 Instagram의 `https://www.instagram.com/p/<shortcode>` 사진 피드 URL 하나다(LinkedIn 단건 관찰은 지원하지 않는다). 바인딩된 로그인 신원과 실제 게시자는 별개로 보존하며 지정 URL과 일치하는 글만 관찰한다. 타인 피드 전체 탐색·이미지 임의 URL 입력은 지원하지 않는다.
- `fetch-media` 입력은 `{jobDir, platform, candidateId, sourceUrl}`이다. `jobDir`는 scan이 반환한 디렉터리다. 누락·수정 alt는 선택적인 `altOverride: {manifestDigest, mediaId, alt}`로 받는다. digest와 후보 안의 사진 ID·URL을 모두 대조하고 manifest는 바꾸지 않는다. 사진 ID는 후보 안의 순서 문자열(`"1"`, `"2"`, …)이며 후보 ID·manifest digest와 함께 식별한다.
- 사진과 출처는 scan 디렉터리에서 세 단계 위인 게시 작업 루트의 `media/`에 보관한다. 결과는 `path`, `sha256`, `bytes`, `alt`, `provenancePath`, `provenanceSha256`, `provenance`다. `observedAt`은 원본 scan 관찰 시각이다. HTTPS만 내려받으며 `redirect: error`, `credentials: same-origin`을 요청하고 다른 origin의 최종 응답은 거부한다. SDK의 실제 옵션 적용·인증 다운로드는 실환경 검증 대상이고 10 MiB는 수신 후 검사다.

## 8. 대응 후보 비교와 게시 기록

`compare`는 `{candidate, existing}`을 유지하며 선택적인 `targetPlatform`, `coverage`, `postLog`를 받는다. scan의 `candidates`와 시간 미상 `review`를 그대로 `candidate`·`existing`에 넘길 수 있다. 각 항목에서 `id`, `url`, `text`, 관찰된 `parentUrl`만 비교에 쓴다. URL 미상은 빈 문자열로 유지하되 빈 URL끼리 또는 빈 정규화 본문끼리는 동일 글로 판정하지 않는다.

`post-log.md`에서 확인한 기록은 에이전트가 다음 필드로 투영한다. 기록 파일 전체를 스크립트가 자동 파싱하지 않는다.

```json
{"sourceUrl":"https://x.com/me/status/1","platform":"bluesky","status":"POSTED","urls":["https://bsky.app/profile/me/post/1"]}
```

원본 URL·대상 플랫폼이 같은 `POSTED` 기록에 URL이 있을 때만 대응 게시 근거로 쓴다. `PARTIAL_POSTED`·`POST_UNKNOWN`은 `needs_review`이며 재시도 근거가 아니다. 기존 기록에 원본 URL이 없으면 추측해 연결하지 않는다.

결과는 `decision: duplicate|needs_review|new`, ID 목록 `evidence`, 종류·ID·URL을 담는 `details`, 대상 `targetPlatform`, 입력 `coverage`, `absenceMeaning: NOT_FOUND_IN_OBSERVED_SCOPE`다. 확인된 parent 연결의 비분기 답글만 묶고 답글 묶음의 본문 일치는 검토 근거로 남긴다. coverage가 없거나 불완전해도 미발견을 미게시 확정으로 승격하지 않는다. 이 결과는 게시 승인·자동 제외 권한이 아니다.
