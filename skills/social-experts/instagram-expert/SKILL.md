---
name: instagram-expert
description: "Instagram 사진 피드의 최근 글·지정 permalink 조회·비교, 실제 캡션 기반 보이스 수집, 사진 1~20장과 공통 캡션 초안·read-back을 담당한다. /instagram-expert, \"Instagram 최근 사진 확인해줘\", \"인스타 캡션 초안만 써줘\", \"Instagram에 이 사진들 올려줘\" 요청 시 사용한다. 게시 요청은 기본 private(기존 친한친구)이며 public만 건별 사람 승인을 요구한다. 실제 UI 대상을 확인하지 못하면 게시하지 않는다. 영상·릴스·스토리·DM·댓글·이미지 생성과 편집·프로필 설정 변경은 지원하지 않는다. 여러 플랫폼 묶음은 social-posting이 담당한다."
version: "1.1.0"
context: inline
language: "korean"
dependencies:
  - "ego-browser>=0.6.3"
  - "node>=24"
  - "uv>=0.4.0"
  - "jq>=1.6"
---

# Instagram 사진 피드 전문가

## 개요와 지원 경계

Instagram 하나에서 최근 사진 피드·지정 permalink 조회, 비교, 실제 캡션 기반 bootstrap, 사진·캡션 초안, 지정 게시물 read-back을 처리한다. 플랫폼은 **`instagram`로 고정**이며 인자로 바꾸지 않는다. 여러 플랫폼 요청은 `social-posting` 조정자로 보낸다. 다른 전문가를 일괄 로드하거나 선택하지 않은 플랫폼을 실행하지 않는다.

사진 **1~20장 + 공통 캡션 하나**, `format: single`만 지원한다. 캡션은 비어도 된다. 텍스트만 게시, 영상·릴스·스토리·DM·댓글 답글 체인, 사진 생성·자동 편집·자동 분할·절삭, 프로필·계정 설정 변경은 지원하지 않는다. 캡션 **2200 Unicode codepoint** 이하는 로컬 초안 정책이며 Instagram 웹의 공식 계수 단위를 확인했다는 뜻이 아니다.

**private는 기존 친한친구 목록에만 실제 발행**한다. 로컬 초안·나만 보기·비공개 계정의 팔로워 전체 공개가 아니다. **visibility 생략은 private**, **명시적 keep은 거부**하며 private/public 외 값도 거부한다. 조회·비교·초안은 게시 권한이 아니다. 명시적 게시 요청 또는 사전에 허용한 게시 작업의 private만 건별 사람 승인을 생략하며, 사람이 승인한 것으로 기록하지 않는다. public은 공개 계정과 Everyone 대상의 실제 UI 증거 및 내용·사진·계정·범위에 결합된 AskUserQuestion 사람 승인이 필요하다.

`publish.sh`와 직접 post **양 경로 모두** 같은 정책을 강제한다. 실제 composer에서 대상을 선택·재확인할 수 없거나 불명·팔로워 공개·다른 계정이면 Share 전에 중단한다. 계정 설정·계정 유형·친한친구 목록을 변경하지 않는다. private 불가를 public으로 대체하지 않는다. UI 프로토콜은 **합성 fixture만 검증했으며 실서비스는 미확인**이다. 오프라인 통과·dry-run은 실제 범위 확인이나 게시 허가가 아니며, 실환경 검증은 계정·사진·허용 동작을 별도 승인받아야 한다.

## 사용자 확인과 무인 실행

질문은 주 대화에서 `AskUserQuestion`으로 한다. 사진·권리·보이스·수정 피드백·계정을 필요한 시점에 확인하며, 문항당 선택지는 2~4개, 한 호출은 최대 4문항이다. 질문을 서브에이전트에 넘기거나 텍스트 답변을 최종 승인으로 바꾸지 않는다.

**headless·unattended에서도 기존 조회 전용 자동화는 읽기·비교·보고만** 한다. 조회 작업·기존 영수증에 게시 권한을 소급 부여하지 않는다. 명시적 게시 요청 또는 사전에 허용한 게시 작업은 확정된 초안·사진·계정으로 private 정책 검사를 통과할 때만 한 번 실행한다. public은 해당 내용·사진·계정·범위와 일치하는 사람 승인 영수증이 있어야 하며, 없으면 승인 대기로 보고하고 종료한다. setup·사진 선택·권리·초안 검수가 필요하면 수동 세션으로 넘기고 스스로 확정하지 않는다. 바인딩이 없으면 누락을 보고한다. 설치·Orca 등록·권한 변경을 자동 실행하지 않는다.

## 경로와 재개

공통 실행층은 같은 설치 루트의 sibling `social-posting`이다. 하네스가 치환하는 `${CLAUDE_SKILL_DIR}`는 이 전문가 디렉터리 자체다. 아래 따옴표와 `../social-posting`을 유지해 공백 설치 경로와 다른 CWD에서도 같은 실행층을 사용한다.

- 상태·초안·scan·로그 정본: `${CLAUDE_SKILL_DIR}/../social-posting/assets/state-schema.md`
- 보이스 형식: `${CLAUDE_SKILL_DIR}/../social-posting/assets/voice-profile-schema.md`
- Instagram 문안·사진 규칙: `${CLAUDE_SKILL_DIR}/docs/playbook.md` — 초안 작성·검사에 필요한 때만 읽는다.

작업 루트는 호출 인자 → CWD 또는 상위의 `social/` → AskUserQuestion 순으로 확정한다. 사용자 절대경로를 굽지 않는다. 기존 작업이면 job-state.md의 root·platforms·accounts·source·post_intent, 대상 초안, receipt.json, post-log.md를 먼저 복구한다. root 이동은 확인받는다. **혼합 job의 다른 플랫폼·다른 초안·전체 계정 매핑·출처·posted 기록을 축소·수정·삭제하지 않는다.** 활성 작업과 브라우저 TaskSpace는 하나이므로 호출을 순차로 한다.

## 1. 요청 동작부터 분기

동작이 모호하면 AskUserQuestion으로 **조회·비교 / 초안 / 기존 초안 게시 / 기타 작업**을 확인한다. 이미 확정한 값은 다시 묻지 않으며 조회를 게시 의도로 바꾸지 않는다.

- **조회·비교만**: 2절 수행 후 보고하고 종료한다. material·canonical·초안을 만들거나 게시 승인을 요구하지 않는다.
- **초안만**: 4 → 5절 후 종료한다. 제공된 소재·보이스로 충분하면 **setup·bootstrap을 강제하지 않는다**.
- **기존 초안 게시**: 기존 drafts/instagram.md를 재사용하고 **material·canonical을 다시 쓰지 않는다**. 5절의 대상 검사 후 6절에서 private 정책 허용 또는 public 사람 승인을 확인한다.
- **bootstrap만**: 3절 계정 확인 → 4절 실제 캡션 수집·보이스 검수 후 종료한다. 게시 작업을 만들지 않는다.
- **read-back만**: 지정 URL과 확인할 캡션·사진 구성을 받아 7절만 수행하고 종료한다.
- **전체 작성·게시**: 4 → 5절로 초안을 준비한 뒤 6절의 정책에 따라 게시한다. 요청하지 않은 scan·bootstrap은 강제하지 않는다.

## 2. 최근 사진 피드·지정 permalink 조회와 비교

네트워크 읽기가 필요할 때만 preflight로 CLI·바인딩을 확인한다. ego-browser가 없으면 설치 안내 후 중단하며 자동 설치하지 않는다. 바인딩 없음·접근 실패를 빈 피드로 숨기지 않는다. 수동 실행에서 계정 연결이 필요하면 확인받고 3절을 수행한다.

```bash
bash "${CLAUDE_SKILL_DIR}/../social-posting/scripts/preflight.sh"
printf '%s' '{"platform":"instagram","since":"<timezone 포함 시작>","until":"<고정 종료>","cursor":null,"jobDir":"<게시 작업 절대경로>"}' \
  | node "${CLAUDE_SKILL_DIR}/../social-posting/scripts/ego-post.mjs" scan
```

기간 생략은 최근 24시간이다. 실행 시작의 timezone 포함 until을 한 번 고정해 `[since, until)`을 쓴다. 특정 글은 같은 입력에 접근 가능한 사진 피드 `postUrl` 하나를 추가한다. 타인 피드 전체는 탐색하지 않는다. 로그인 신원 `me`·identity와 **원본 실제 게시자 publisher는 별개**다. publisher를 로그인 계정으로 대신 채우지 않는다.

프로필 고정글을 최신순으로 가정하지 않는다. 동일 게시물 컨테이너의 URL·게시자·캡션·시각·사진 순서를 연결한다. 댓글·추천 글·아바타·영상 썸네일은 제외한다. 빈 캡션 사진 글도 보존한다. 시간 미상은 `UNKNOWN_TIME`·review로 남기며 최근 글로 확정하지 않는다. `partial carousel`은 관찰 사진 일부이며 전체 사진 목록이 아니다. `coverage.complete:false`, stopReason·limitations와 누락 범위를 보고한다.

manifestPath·manifestDigest·반환 jobDir를 보존하고 manifest를 편집하지 않는다. 입력 jobDir는 게시 작업 루트, 반환 jobDir는 `scans/<scan-id>/instagram/`다. fetch에는 반환 경로를 쓴다. 조회만 요청했다면 후보·기간·불완전 범위를 보고하고 **여기서 종료**한다.

비교는 원본을 candidate, 대상 scan의 candidates와 시간 미상 review를 existing에 넣고, coverage를 그대로 전달한다.

```bash
printf '%s' '{"candidate":{"id":"<원본 ID>","url":"<원본 URL>","text":"<원문>"},"existing":[],"targetPlatform":"instagram","coverage":{"complete":false},"postLog":[]}' \
  | node "${CLAUDE_SKILL_DIR}/../social-posting/scripts/ego-post.mjs" compare
```

빈 existing·postLog는 실제 관찰·기록으로 채운다. postLog는 확인된 원본 URL·대상·상태·URL만 `[{sourceUrl, platform, status, urls}]`로 투영한다. `new`는 **관찰 범위 내 대응 글 미발견**이지 전체 이력의 미게시 증명이 아니다. 유사 재작성은 needs_review로 남기고 parent 관계를 추측하지 않는다. 비교만이면 보고 후 종료한다. 후속 초안까지 요청했을 때만 원본 후보 ID·URL·실제 게시자·시각·사진 목록을 보여주고 AskUserQuestion으로 선택받는다.

## 3. 필요한 경우에만 계정 확인

bootstrap·수동 조회의 바인딩 설정 또는 게시 계정 확인이 필요할 때만 Instagram을 라이브 setup한다. 계정이 이미 확정된 무인 게시 작업에서는 setup으로 대상을 새로 정하지 않는다.

```bash
bash "${CLAUDE_SKILL_DIR}/../social-posting/scripts/preflight.sh"
node "${CLAUDE_SKILL_DIR}/../social-posting/scripts/ego-post.mjs" setup --platform instagram --force
```

관찰된 로그인 신원을 보여주고 AskUserQuestion으로 **이 계정으로 진행 / 계정 변경 후 다시 확인 / 취소**를 받는다. 사용자가 로그인 계정을 바꾼 후 다시 setup한다. binding·job accounts·라이브 신원 불일치는 `EGO_ACCOUNT_MISMATCH`로 멈춘다. 계정 확인은 게시 승인이 아니며 원본 게시자 확인을 대신하지 않는다.

## 4. 소재·보이스·공통 캡션 준비

파일을 쓰기 전 공유 state-schema·voice-profile-schema를 읽고 작업 루트를 확정한다. 초안 작업을 새로 만드는 경우에만 스키마대로 job-state.md·material.md·canonical.md·drafts/instagram.md·post-log.md를 만든다. platforms·accounts·status는 한 줄 flow style이다. 기존 작업·다른 초안·출처·게시 기록은 보존한다. 활성 작업 복구가 필요하면 다음을 순차 호출한다. bootstrap만이면 게시 작업을 생성·활성화하지 않는다.

```bash
bash "${CLAUDE_SKILL_DIR}/../social-posting/scripts/post-state.sh" activate <job-dir>
bash "${CLAUDE_SKILL_DIR}/../social-posting/scripts/post-state.sh" get
```

소재가 필요한 경우만 기존 문서·대화의 사실·수치·사용자 관점·출처를 material.md에 정리한다. 모르는 경험·숫자는 지어내지 않고 확인하거나 뺀다. 기존 voice-profile.md·제공된 보이스로 충분하면 bootstrap을 생략한다. 부족하면 AskUserQuestion **샘플 제공 / bootstrap 수집 / 취소**로 묻는다. bootstrap을 선택하면 3절 후 최대 20개 원문을 수집한다.

```bash
node "${CLAUDE_SKILL_DIR}/../social-posting/scripts/ego-post.mjs" bootstrap --platform instagram --count 20
```

원본 text·url·time은 social/bootstrap-cache/에 보존한다. 실제 캡션만 보이스 근거로 쓰고 UI 라벨·댓글·추천 글·생성 캡션을 샘플로 섞지 않는다. 빈 캡션을 말투 자료로 만들어 채우지 않는다. 실제 샘플 3~5개는 **verbatim**이며 부족하면 부족하다고 보고한다. 보이스·샘플을 보여주고 AskUserQuestion **이대로 저장 / 샘플 교체 / 항목 수정**으로 검수한다. bootstrap만 요청했으면 여기서 종료한다.

새 문안만 material·voice로 canonical.md를 만든 뒤 캡션을 작성한다. 새 사실은 canonical부터 반영한다. teaser 목적이면 훅 1개와 링크 유도만 쓰고 논지를 요약하지 않는다. 링크 없는 글은 summary다. Instagram 캡션의 URL을 클릭 가능한 링크라고 약속하거나 프로필 링크를 변경하지 않는다. 기존 초안 게시에서는 이 단계를 건너뛴다.

## 5. 사진 선택·초안 검사

공유 state-schema의 **기존 body·media 필드**를 사용한다. drafts/instagram.md는 platform: instagram, format: single이며 사진 1~20장에 공통 캡션 하나다. 별도 캡션 필드·스레드 세그먼트를 만들지 않는다. 빈 캡션도 유효하다. 본문 링크와 link 키는 중복시키지 않는다.

사진이 없으면 AskUserQuestion으로 **사진 제공 / Instagram 제외 / 취소**를 묻고 제공 전에는 확정하지 않는다. 여러 대상에서는 Instagram 제외가 다른 작업 삭제를 뜻하지 않는다. 21장 이상이면 최대 20장을 **사용자가 선택**하게 하며 자동 절삭·분할하지 않는다. 영상·지원하지 않는 항목이 섞이면 알리고 제거·교체를 확인한다. 이미지를 임의 생성·변환하지 않는다.

사용자가 **각 사진 ID·원본 출처·재게시 권리·선택 순서·각 사진의 alt·공통 방향·원본 비율 유지 의도**를 확인해야 한다. 접근 가능성이 재게시 권리는 아니다. alt가 없으면 관찰한 사진에 맞는 설명을 제안하고 확인받는다. 순서·alt·잘림 결정이 남으면 확정 초안으로 취급하지 않는다. 모바일 비율 안내를 웹 하드 제약으로 옮기지 않는다. UI에서 의도한 잘림을 재현할 수 없거나 미리보기가 다르면 Share 전에 중단·재검수한다.
로컬 사진은 sourcePath 절대경로와 alt를 전달해 작업 media/로 보관하고 반환 path·alt·sha256을 초안에 쓴다. public 사진의 sha256은 사람 승인 전에 필수이며, 승인 뒤 바이트가 바뀌면 다시 준비·승인한다. 출처·권리·순서는 material·로그에 보존한다.

```bash
printf '%s' '{"jobDir":"<게시 작업 절대경로>","media":[{"sourcePath":"<로컬 사진 절대경로>","alt":"<사진 설명>"}]}' \
  | node "${CLAUDE_SKILL_DIR}/../social-posting/scripts/materialize-media.mjs"
```

scan 사진은 사용자가 고른 후보·사진 ID·URL만 준비한다. 누락 alt를 보완할 때만 `altOverride: {manifestDigest, mediaId, alt}`를 추가하고 manifest 자체는 바꾸지 않는다.

```bash
printf '%s' '{"jobDir":"<scan 반환 절대경로>","platform":"instagram","candidateId":"<후보 ID>","sourceUrl":"<관찰 사진 URL>"}' \
  | node "${CLAUDE_SKILL_DIR}/../social-posting/scripts/ego-post.mjs" fetch-media
```

관리 영수증의 manifest digest·로그인 신원·후보·사진 URL을 대조한다. 반환 path·sha256·provenancePath·provenanceSha256을 초안 path·sha256·provenance·provenance_sha256과 source: scan에 연결한다. 구계약 출처 digest가 없으면 다시 준비한다. MIME·signature·수신 후 10 MiB 검사는 전체 디코딩·다운로드 중 제한을 뜻하지 않는다.

대상 초안 하나만 검사한다. exit 1 또는 uv 부재면 중단하고 고친다. 다른 플랫폼의 미완성 초안을 이유로 이 초안을 막지 않는다.

```bash
uv run "${CLAUDE_SKILL_DIR}/../social-posting/scripts/check-drafts.py" <job-dir> --platform instagram
```

기계 검사와 별도로 사실·금지 주제·플레이북 권고·사진 결정을 확인한다. 휴리스틱을 하드 제약으로 승격하지 않는다. **초안만 요청했으면 검사 결과·남은 질문·요청 범위를 보고하고 여기서 종료**한다.

## 6. private 정책 허용·public 사람 승인과 게시

scan 원본·사진에서 시작하거나 compare가 needs_review이면 **최종 승인과 별도의 AskUserQuestion**으로 원본·유사 후보 URL·본문 근거·실제 게시자·대상을 보여주고 **계속 진행 / 초안 수정 / 이번에는 건너뛰기**를 확인한다. private의 건별 승인 생략도 필요한 사진·권리·유사 후보 확인을 대신하지 않는다. 필요한 확인이 끝나지 않은 무인 작업은 보고 후 중단한다.

확정 초안의 계정·캡션 전체·로컬 계수 길이·사진 수·순서·alt·출처·권리·방향·공개 범위·검사 결과를 함께 보여준다. **private는 추가 게시 승인 질문을 열지 않는다.** public만 다음 AskUserQuestion을 열며 텍스트 답변·임의 승인 필드로 대신하지 않는다.

- header: **게시 승인**
- question: **`게시 대상: instagram`** 한 줄과 실제 내용·사진 구성·계정·공개 범위 public을 포함한다.
- 선택지: 게시 / 수정 / 취소

공통 훅만 public의 초안 digest와 **전체 approved_accounts 스냅샷**을 기록한다. 사람이 승인한 내용·사진·계정·범위가 바뀌면 재승인한다. 신규 전문가 진입이나 사람 승인 대상 범위 변경도 새 승인이 필요하다. 새 사람 승인은 이전 승인 집합을 교체하지만 private 실행은 다른 플랫폼의 승인·전체 계정 매핑·게시 기록을 바꾸지 않는다. approved_*를 직접 쓰지 않는다. 혼합 요청의 X 등 다른 플랫폼에는 기존 사람 승인 정책을 유지하며 Threads 쓰기 차단도 유지한다.

public 및 기존 사람 승인 경로의 Ready 판정식은 다음과 같다.

Ready 판정식: **`approved_digests`에 해당 플랫폼이 있고 `drafts/<platform>.md`의 sha256과 일치**

Instagram private 판정식: 명시적 게시 요청 또는 사전에 허용한 게시 작업이고, 현재 초안·사진·계정이 검증되며 Share 직전 실제 친한친구 대상이 확인됨

private는 위 정책 허용이지 사람 승인 Ready가 아니다. **authorization: policy**로 구분하고, public만 **authorization: human_approval**로 기록한다. 공통 실행층은 하드 제약·현재 job 대상·계정·binding·라이브 신원·초안 동결 검사를 모두 유지한다. **모든 Instagram 사진**을 읽기 전용 사본으로 동결하고 payload media에 sha256을 넣는다. scan 사진은 기존 manifest·사진 hash·출처 digest 검사도 유지한다. public은 승인한 사진 바이트만 허용한다. 일반 non-scan 로컬 사진도 Instagram에서는 이 동결 대상이며 다른 플랫폼의 보장을 확대했다고 설명하지 않는다.

```bash
bash "${CLAUDE_SKILL_DIR}/../social-posting/scripts/publish.sh" --job <job-dir> --platform instagram
```

단일 피드는 Bash timeout 300000ms로 순차 전경 호출한다. 직접 post도 `SOCIAL_POSTING_JOB` 또는 기존 활성 포인터의 job·초안·전체 accounts를 검증한다. public은 사람 승인 receipt까지 검증하고 payload의 body/link/format/visibility·사진 순서/alt/hash/실제 바이트를 초안과 대조한 뒤 다시 동결한다. private는 사람 승인 receipt를 쓰지 않는다. 맥락 없는 직접 post·승인 불리언·직접 브라우저 게시로 우회하지 않는다.

업로드 뒤 사진 수·순서·각 alt·공통 캡션·원본 비율 의도·라이브 신원·다른 채널 동시 공유 꺼짐을 확인하고 실제 대상을 Share 직전에 다시 확인한다. private는 기존 친한친구, public은 공개 계정의 Everyone이어야 하며 재현·관찰할 수 없는 단계는 Share 전에 중단한다. Share는 단 한 번이다. 결과 audience는 requested(private/public), beforeShare(close_friends/public/unknown), **afterShare: unknown**, authorization(policy/human_approval)으로 구분한다. 게시 후 범위 검증과 혼동하지 않는다.

이전 실행 기록이나 후속 검증 결과가 있으면 상태를 그대로 보존한다.

- `POSTED` + urlRecovered:true: 확인된 URL로 read-back한다.
- `POSTED` + urlRecovered:false: **게시 성립**이다. URL 미회수여도 **재시도 금지**이며 URL 수동 확인을 기다린다.
- `PARTIAL_POSTED`: postedCount·확인 URL을 보고하고 자동 재시도·이어쓰기를 하지 않는다.
- `POST_UNKNOWN`: 실제 결과 확인 전 재시도 금지다.
- `POST_FAILED`: 게시 클릭 전 실패다. 원인을 보고하고 초안·사진·계정·공개 범위·필요한 사람 승인을 다시 확인한다.

## 7. 지정 게시물 read-back·기록

read-back만이면 원본 초안을 다시 쓰거나 setup·게시·업로드로 돌아가지 않는다. 확인된 지정 URL과 실제 캡션을 받는다. URL 없는 POSTED는 URL을 확인할 때까지 기다리고 추측한 URL을 쓰지 않는다.

```bash
printf '%s' '{"urls":["<게시 URL>"],"bodies":["<실제 공통 캡션; 빈 문자열 허용>"],"visibility":"private"}' \
  | node "${CLAUDE_SKILL_DIR}/../social-posting/scripts/ego-post.mjs" readback
```

URL·bodies 배열은 같은 길이·같은 순서다. link가 실제 캡션에 추가되었다면 함께 넣는다. 전체 페이지·댓글·추천 글이 아니라 **대상 URL의 게시물 캡션만** 비교한다. 빈 캡션도 대상 게시물 존재를 확인해야 하며 빈 문자열이 어디에나 포함된다는 이유로 성공 처리하지 않는다.

**캡션 일치와 사진 수·순서·alt 확인을 구분**한다. 기존 urls/bodies 입력은 유지하며 선택 `visibility: private|public`만 더할 수 있다. 사진 비교용 새 입력 필드는 만들지 않는다. **captionMatched**, **media.complete**, **audience.requested**·**audience.observed**(close_friends/public/unknown)·**audience.matched**(true/false/null)를 따로 보고한다. 사진 일부만 관찰하거나 alt를 확인하지 못하면 미확인으로 남기며, 캡션 matched:true를 전체 검증 성공으로 읽지 않는다. 범위 불명·불일치나 조회 실패는 이미 성립한 POSTED를 취소하지 않는다. 보고하되 자동 삭제·공개 범위 변경·재게시 근거로 쓰지 않는다.

요청한 작업의 post-log.md에 원본 URL·대상 instagram·기존 게시 상태·확인 URL·캡션 결과·사진별 확인 범위를 기록한다. 조회 성공을 게시 성공으로 바꾸거나 기존 posted 기록을 덮어쓰지 않는다. 기존 조회 전용 무인 작업에서는 조회 결과만 보고하며 게시 의도로 바꾸지 않는다.

## 문서

[문서 목록](docs/INDEX.md) · [플레이북](docs/playbook.md) · [빠른 시작](README.md)
