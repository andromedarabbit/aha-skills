---
name: linkedin-expert
description: "LinkedIn 전용 기존 bootstrap, 단일 글·기존 사진 게시, read-back만 지원한다. 본문 3000 codepoint 이하, 사진 9장 이하, format: single만 지원한다. /linkedin-expert, \"LinkedIn 글 준비해줘\", \"LinkedIn 초안만 써줘\" 요청 시 사용. 여러 플랫폼의 묶음 작업은 social-posting이 담당한다. 무인 실행은 읽기·비교·보고만 한다."
version: "1.0.0"
context: inline
language: "korean"
dependencies:
  - "ego-browser>=0.6.3"
  - "node>=24"
  - "uv>=0.4.0"
  - "jq>=1.6"
---

# LinkedIn 전문가

## 개요와 지원 경계

LinkedIn 하나의 요청 동작만 수행한다. 기존 bootstrap, 단일 글·기존 사진 게시, read-back만 지원한다. 본문 3000 codepoint 이하, 사진 9장 이하, format: single만 지원한다.
여러 플랫폼을 함께 요청하면 `social-posting` 조정자로 보낸다. 다른 플랫폼 전문가를 일괄 로드하거나 실행하지 않는다. 플랫폼은 **`linkedin`로 고정**이며 인자로 바꾸지 않는다.

## 사용자 확인과 무인 실행

질문과 최종 승인은 주 대화가 `AskUserQuestion`으로 수행한다. 계정·소재·사진 선택·보이스 검수·수정 피드백을 필요한 시점에 묻는다. 문항당 선택지는 2~4개, 한 호출은 최대 4문항이다. 질문을 서브에이전트에 넘기거나 텍스트 선택지로 승인을 대신하지 않는다.
**headless·unattended·AskUserQuestion 없음에서는 읽기·비교·보고만 한다. 기존 영수증이 있어도 setup·초안 확정·검수·승인·게시·재시도하지 않는다.** Orca 등록·권한 변경도 하지 않는다.

## 경로와 재개

공통 실행층은 같은 설치 루트의 sibling `social-posting`이다. 경로에 공백이 있어도 아래 따옴표를 유지한다.

- 작업 상태·초안·scan·로그 형식: `${CLAUDE_SKILL_DIR}/../social-posting/assets/state-schema.md`
- 보이스 형식: `${CLAUDE_SKILL_DIR}/../social-posting/assets/voice-profile-schema.md`
- 플랫폼 규칙: `${CLAUDE_SKILL_DIR}/docs/playbook.md` — 문안 작성·검사 때 필요한 규칙만 읽는다.

작업 루트는 호출 인자 → CWD 또는 상위의 `social/` → AskUserQuestion 순서로 확정한다. 사용자 절대경로를 굽지 않는다. 기존 작업이면 `job-state.md`의 root·platforms·accounts·source·post_intent와 대상 초안, `receipt.json`, `post-log.md`부터 복구한다. root가 이동했으면 확인받는다. **혼합 job의 다른 플랫폼·다른 초안·계정·출처·게시 기록을 축소·수정·삭제하지 않는다.** 활성 작업과 브라우저 TaskSpace는 하나이므로 작업·브라우저 호출은 순차로 한다.

## 1. 요청 동작부터 분기

인자가 비었거나 동작이 모호하면 게시 의도를 가정하지 말고 AskUserQuestion으로 조회 / 초안 / 기존 초안 게시 / 기타 작업을 확인한다. 대화에서 이미 확정한 값은 다시 묻지 않는다.

- **조회·비교만**: 2절만 수행하고 종료한다. material·canonical·초안을 만들거나 게시 승인을 요구하지 않는다.
- **초안만**: 4절에서 필요한 소재·보이스만 확인하고 5절까지 수행한 뒤 종료한다. 제공된 소재·보이스로 충분하면 **setup·bootstrap을 강제하지 않는다**.
- **기존 초안 게시**: 기존 `drafts/linkedin.md`를 재사용한다. **material·canonical을 다시 쓰지 않는다**. 3절의 계정 확인 → 5절 검사 → 6절로 간다.
- **bootstrap만**: 3절의 계정 확인 후 4절의 수집·보이스 검수만 하고 종료한다.
- **read-back만**: 승인된 본문과 지정 URL을 받아 7절만 수행하고 종료한다.
- **전체 작성·게시**: 3 → 4 → 5 → 6 → 7절을 수행한다. 요청하지 않은 scan은 강제하지 않는다.

## 2. 비지원 조회 경계

LinkedIn의 **최근 글 scan·지정 permalink scan·scan 사진 fetch는 비지원**이다. 요청받으면 그 사실을 보고하고 종료한다. bootstrap을 최근 글 조회의 대체물로 사용하거나 다른 스킬·API로 몰래 우회하지 않는다. 메시지·인맥·InMail·후속 연락은 이 스킬의 기능이 아니다. 이미 제공된 원문을 읽어 LinkedIn 초안으로 바꾸는 것은 가능하지만 새 조회 기능이라고 부르지 않는다.

## 3. 필요한 경우에만 계정·작업 확인

게시 또는 bootstrap에서는 preflight 뒤 선택한 LinkedIn만 라이브 setup한다. 기존 바인딩도 재확인한다.

```bash
bash "${CLAUDE_SKILL_DIR}/../social-posting/scripts/preflight.sh"
node "${CLAUDE_SKILL_DIR}/../social-posting/scripts/ego-post.mjs" setup --platform linkedin --force
```

관찰된 신원을 보여주고 AskUserQuestion으로 **이 계정으로 진행 / 계정 변경 후 다시 확인 / 취소**를 받는다. 다른 계정이면 사용자가 로그인 계정을 바꾼 후 setup을 다시 한다. 바인딩·job accounts·라이브 신원이 맞지 않으면 `EGO_ACCOUNT_MISMATCH`로 멈춘다. 계정 확인은 게시 승인이 아니다.

상태 파일을 쓰기 전 공유 state-schema를 읽는다. 게시 작업을 새로 만드는 경우에만 `social/<job-slug>/`에 스키마대로 job-state.md·material.md·canonical.md·drafts/linkedin.md·post-log.md를 두며, 기존 작업은 재사용한다. platforms·accounts·status는 한 줄 flow style, source·post_intent는 원본과 목적을 유지한다. bootstrap만 수행할 때는 게시 작업·material·canonical·초안을 만들거나 활성화하지 않는다. 게시할 작업이 확정되면 다음으로 활성화한다.

```bash
bash "${CLAUDE_SKILL_DIR}/../social-posting/scripts/post-state.sh" activate <job-dir>
bash "${CLAUDE_SKILL_DIR}/../social-posting/scripts/post-state.sh" get
```

## 4. 소재·보이스·문안 준비

초안만 요청해 3절을 건너뛰었어도, 상태·초안 파일을 쓰기 전 공유 state-schema와 voice-profile-schema를 읽고 작업 루트를 확정한다. 새 초안 작업만 스키마대로 생성하고 기존 작업은 보존한다. 문안 준비를 요청했을 때만 기존 문서·대화의 사실·수치·실패·트레이드오프·사용자 관점과 출처를 material.md로 정리한다. 모르는 숫자·고유명사·경험은 지어내지 않고 AskUserQuestion으로 확인한다. `질문 필요`는 해결하거나 게시문에서 뺀다.

기존 voice-profile.md는 재사용한다. 제공된 보이스·샘플로 충분하면 bootstrap을 생략한다. 보이스가 부족하면 사용자에게 샘플 제공 / bootstrap 수집 / 취소 중 묻는다. bootstrap을 선택하면 먼저 3절의 계정 확인을 거친다. bootstrap 요청에서만 다음으로 최대 20개 원문을 수집한다.

```bash
node "${CLAUDE_SKILL_DIR}/../social-posting/scripts/ego-post.mjs" bootstrap --platform linkedin --count 20
```

원본 text·url·time은 `social/bootstrap-cache/`에 보존하고 공유 voice-profile-schema를 따른다. 실제 샘플 3~5개는 **verbatim**만 쓴다. 말투·안티패턴·금지 주제는 추측해 확정하지 않는다. 프로필과 샘플을 보여주고 AskUserQuestion **이대로 저장 / 샘플 교체 / 항목 수정**으로 검수한다. bootstrap만 요청했으면 여기서 종료한다.

새 문안은 material·voice로 canonical.md를 만든 뒤 LinkedIn 문안을 별도 작성한다. 새 사실은 canonical부터 갱신한다. post_intent가 teaser이고 링크가 있으면 **훅 1개 + 링크 유도만** 쓰고 논지를 요약하지 않는다. 링크 없는 글은 summary다. 제3자의 실패·탈락·평가 일화는 논지를 먼저 쓰고 후반 근거로 둔다. 일화를 리드로 쓸 때만 프레이밍을 별도로 확인한다. 기존 초안 게시 경로에서는 이 단계를 건너뛴다.

## 5. 사진·초안 검사

플레이북과 공유 state-schema에 따라 drafts/linkedin.md의 platform·format·본문을 작성한다. `link`가 본문에 있으면 별도 link 키를 비워 중복을 막는다. 사진·link는 첫 세그먼트에만 둔다. 기존 bootstrap, 단일 글·기존 사진 게시, read-back만 지원한다. 본문 3000 codepoint 이하, 사진 9장 이하, format: single만 지원한다.

사진은 공개 여부보다 로그인 브라우저에서 **접근 가능**한지를 확인하되 접근 가능성이 **재게시 권리**를 뜻하지는 않는다. 타인 사진은 출처·사용 권한을 별도로 확인한다. 상한 9장을 넘으면 사진 ID·URL·alt를 보여주고 상한 내 ID를 사용자가 선택한다. 앞의 몇 장을 조용히 택하지 않는다. alt가 없으면 관찰된 이미지에 맞는 설명을 보완한다.

기존 로컬 사진은 절대 sourcePath와 alt를 전달해 작업 media/로 보관한다. 반환 path·alt를 초안에 쓰며 원본 출처를 material·로그에 보존한다.

```bash
printf '%s' '{"jobDir":"<게시 작업 절대경로>","media":[{"sourcePath":"<로컬 사진 절대경로>","alt":"<사진 설명>"}]}' \
  | node "${CLAUDE_SKILL_DIR}/../social-posting/scripts/materialize-media.mjs"
```

대상 초안 하나만 검사한다. exit 1 또는 uv 부재면 중단하고 고친다. 다른 플랫폼의 미완성 초안을 이 게시의 차단 조건으로 삼지 않는다.

```bash
uv run "${CLAUDE_SKILL_DIR}/../social-posting/scripts/check-drafts.py" <job-dir> --platform linkedin
```

기계 검사와 별도로 사실·금지 주제·플레이북의 권고를 확인한다. 휴리스틱은 근거·날짜가 있는 참고이며 하드 제약으로 승격하지 않는다. **초안만 요청했으면 검사 결과와 남은 질문을 보고하고 여기서 종료**한다.

## 6. 별도 유사 후보 확인 → 최종 게시 승인 → 게시

job source 또는 초안 media가 scan에서 왔거나 scan 후보에서 시작했거나 compare가 `needs_review`면 **최종 승인과 별도의 AskUserQuestion**으로 원본·유사 후보 URL·본문 근거·원본 플랫폼·실제 대상 LinkedIn을 제시하고 **계속 진행 / 초안 수정 / 이번에는 건너뛰기**를 받는다. 유사도만으로 자동 제외·자동 게시하지 않는다. 계속 진행일 때만 다음 승인 질문으로 간다.

최종 검토에 계정·실제 본문 전체·세그먼트 순서·길이(플랫폼 단위)·선택 사진 ID·alt·원본 출처·검사 결과를 표시한다. **전문가 신규 진입 또는 대상 범위 변경에서는 기존 영수증이 있어도 새로 승인**받는다. 혼합 job 전체를 승인하지 않는다. AskUserQuestion의 계약은 다음과 같다.

- header: **게시 승인**
- question에는 다음 **독립된 한 줄**을 정확히 포함한다.

```text
게시 대상: linkedin
```

- options: **게시 / 수정 / 취소**

수정이면 초안을 고쳐 검사하고 다시 승인받는다. 취소이면 종료한다. PostToolUse의 공통 record-approval.sh 훅만 해당 대상의 approved_digests와 **전체 approved_accounts 스냅샷**을 기록한다. 새 승인은 이전 승인 집합을 교체한다. 에이전트는 approved_*를 직접 쓰거나 다른 계정 매핑을 축소하지 않는다.

Ready 판정식: **`approved_digests`에 해당 플랫폼이 있고 `drafts/<platform>.md`의 sha256과 일치**

직접 ego-browser 또는 ego-post post로 게시하지 않는다. 공통 publish 경로를 **순차 전경 호출**한다. 하네스 Bash의 timeout은 **single 300000ms / thread 600000ms**로 명시한다.

```bash
bash "${CLAUDE_SKILL_DIR}/../social-posting/scripts/publish.sh" --job <job-dir> --platform linkedin
```

승인 대상·digest·하드 제약·계정 매핑·전체 승인 계정 스냅샷·본문 동결 후 원본 digest·scan 사진과 출처 동결 사본 digest의 기존 가드를 유지한다. 실행 계층은 라이브 신원도 binding과 대조한다. 변경·불일치 시 멈추고 재승인하며 가드를 우회하지 않는다. scan 사진·출처는 검증한 임시 사본만 실행 계층으로 전달하고 종료 시 정리한다. **일반 non-scan 로컬 사진에는 같은 승인 후 파일 변경 방어가 없으므로 동일한 동결 보장이라고 설명하지 않는다.**

DOM 증거에 따른 상태를 그대로 보고한다.

- `POSTED` + urlRecovered:true: URL로 확인한다.
- `POSTED` + urlRecovered:false: 게시 성립이다. URL 미회수여도 **재시도 금지**이며 프로필에서 URL 수동 확인을 기다린다.
- `PARTIAL_POSTED`: postedCount·확인 URL을 보고하고 **자동 재시도·이어쓰기 금지**.
- `POST_UNKNOWN`: 실제 결과 확인 전 **재시도 금지**.
- `POST_FAILED`: 게시 클릭 전 실패다. 원인과 초안·계정·승인을 재확인한다.

## 7. 지정 게시물별 read-back·기록

```bash
printf '%s' '{"urls":["<게시 URL>"],"bodies":["<해당 세그먼트 실제 본문>"]}' \
  | node "${CLAUDE_SKILL_DIR}/../social-posting/scripts/ego-post.mjs" readback
```

URL·bodies 배열은 같은 길이·같은 순서다. 첫 세그먼트의 실제 link도 포함하며 회수된 모든 URL에 해당 본문을 대응한다. 전체 페이지 텍스트가 아니라 **대상 URL의 게시물 본문만** 비교한다. matched:false는 즉시 보고한다. read-back 실패를 새 게시로 고치지 않는다. URL 없는 POSTED는 URL을 확인한 뒤 read-back하며 추측한 URL을 쓰지 않는다.

post-log.md에 원본 URL·대상 linkedin·상태·확인된 게시 URL 전체·read-back 결과를 남긴다. 성공 URL을 확인했을 때만 `post-state.sh set posted_linkedin <url>`로 기록한다(스레드는 첫 URL). 상태 쓰기도 호출 직후 순차로 한다. 부분·불명은 성공으로 바꾸거나 재시도하지 않는다. 재개 시 get으로 영수증·게시 기록을 확인하고 이전 승인을 가정하지 않는다.

## 문서

[문서 목록](docs/INDEX.md) · [플레이북](docs/playbook.md) · [빠른 시작](README.md)
