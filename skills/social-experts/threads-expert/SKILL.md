---
name: threads-expert
description: "Threads 전용 최근 글·지정 permalink 조회, bootstrap, 초안 준비만 지원한다. 길이는 참고 codepoint와 lengthVerified:false로 보고한다. 게시·게시 승인·read-back 검증으로 진행하지 않는다. /threads-expert, \"Threads 글 준비해줘\", \"Threads 초안만 써줘\" 요청 시 사용. \"Threads 최근 글 확인해줘\"도 처리한다. 여러 플랫폼의 묶음 작업은 social-posting이 담당한다. 무인 실행은 읽기·비교·보고만 한다."
version: "1.0.0"
context: inline
language: "korean"
dependencies:
  - "ego-browser>=0.6.3"
  - "node>=24"
  - "uv>=0.4.0"
  - "jq>=1.6"
---

# Threads 전문가

## 개요와 지원 경계

Threads 하나의 요청 동작만 수행한다. 최근 글·지정 permalink 조회, bootstrap, 초안 준비만 지원한다. 길이는 참고 codepoint와 lengthVerified:false로 보고한다. 게시·게시 승인·read-back 검증으로 진행하지 않는다.
여러 플랫폼을 함께 요청하면 `social-posting` 조정자로 보낸다. 다른 플랫폼 전문가를 일괄 로드하거나 실행하지 않는다. 플랫폼은 **`threads`로 고정**이며 인자로 바꾸지 않는다.

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
- **기존 초안 게시·전체 작성 후 게시**: `THREADS_UNVERIFIED`를 먼저 설명한다. 사용자가 원하면 기존 초안을 보존해 초안 준비·검사까지만 한다. 기존 초안은 material·canonical을 다시 쓰지 않는다.
- **bootstrap만**: 3절의 계정 확인 후 4절의 수집·보이스 검수만 하고 종료한다.
- **게시 후 read-back 검증**: 비지원임을 보고하고 종료한다. 지정 permalink의 읽기 전용 관찰은 2절로 구분한다.
- **전체 초안 작성**: 필요한 3 → 4 → 5절만 수행한다. 요청하지 않은 scan은 강제하지 않는다.

## 2. 최근 글·지정 permalink 조회와 비교

네트워크 읽기가 필요할 때만 preflight로 CLI·바인딩을 확인한다. ego-browser가 없으면 설치 안내 후 중단한다. 조회 대상은 바인딩된 **threads 계정 하나**이며 바인딩 없음·접근 실패를 빈 결과로 숨기지 않는다. 무인 실행에서는 setup하지 않고 누락을 보고한다. 수동 실행에서 새 바인딩이 필요하면 사용자에게 확인하고 3절로 간다.

```bash
bash "${CLAUDE_SKILL_DIR}/../social-posting/scripts/preflight.sh"
printf '%s' '{"platform":"threads","since":"<timezone 포함 시작>","until":"<고정 종료>","cursor":null,"jobDir":"<게시 작업 절대경로>"}' \
  | node "${CLAUDE_SKILL_DIR}/../social-posting/scripts/ego-post.mjs" scan
```

기간 생략은 최근 24시간이다. 실행 시작의 timezone 포함 `until`을 한 번 고정하고 `since`를 계산해 `[since, until)`을 쓴다. 특정 글은 동일 JSON에 검증할 `postUrl` 하나를 추가한다. 타인 피드 전체는 탐색하지 않는다. 게시자와 로그인 신원을 구분한다. 사진 전용 글도 보존하며 시간 미상 `review`를 최근 글로 확정하지 않는다. `coverage.complete:false`와 stopReason·limitations를 보고한다. 전체 이력이 아닌 관찰 범위다.

scan 결과의 manifestPath·manifestDigest·반환 jobDir를 보존한다. 입력 jobDir는 게시 작업 루트, 반환 jobDir는 `scans/<scan-id>/threads/`다. 후속 fetch는 반드시 반환 경로를 쓴다. manifest를 직접 수정하지 않는다.

비교는 원본 후보를 `candidate`, 대상 scan의 `candidates`와 시간 미상 `review`를 `existing`, 대상 coverage를 `coverage`로 전달한다. targetPlatform은 `threads` 하나다.

```bash
printf '%s' '{"candidate":{"id":"<원본 ID>","url":"<원본 URL>","text":"<원문>"},"existing":[],"targetPlatform":"threads","coverage":{"complete":false},"postLog":[]}' \
  | node "${CLAUDE_SKILL_DIR}/../social-posting/scripts/ego-post.mjs" compare
```

예시의 빈 existing·postLog를 실제 관찰·기록으로 채운다. 확인된 parent 관계만 묶으며 연결을 추측하지 않는다. post-log에서 확인된 원본 URL·대상·상태·URL 목록만 `postLog: [{sourceUrl, platform, status, urls}]`로 투영한다. `new`는 **관찰 범위 내 대응 글 미발견**이지 전체 이력의 미게시 증명이 아니다. 유사한 재작성은 검토 대상으로 남긴다. 조회·비교만 요청했으면 결과·한계를 보고하고 **여기서 종료**한다. 후속 문안 준비까지 요청했을 때만 후보 ID·URL·실제 게시자·시각·사진 목록을 보여주고 AskUserQuestion으로 원본 후보를 선택받는다. 대상 플랫폼은 이 전문가 하나로 유지한다.

## 3. 필요한 경우에만 계정·작업 확인

bootstrap 또는 읽기용 바인딩을 사용자가 요청한 경우에만 preflight 뒤 선택한 Threads만 라이브 setup한다. 게시 요청 때문에 setup하지 않는다. 기존 바인딩도 재확인한다.

```bash
bash "${CLAUDE_SKILL_DIR}/../social-posting/scripts/preflight.sh"
node "${CLAUDE_SKILL_DIR}/../social-posting/scripts/ego-post.mjs" setup --platform threads --force
```

관찰된 신원을 보여주고 AskUserQuestion으로 **이 계정으로 진행 / 계정 변경 후 다시 확인 / 취소**를 받는다. 다른 계정이면 사용자가 로그인 계정을 바꾼 후 setup을 다시 한다. 바인딩·job accounts·라이브 신원이 맞지 않으면 `EGO_ACCOUNT_MISMATCH`로 멈춘다. 계정 확인은 게시 승인이 아니다.

상태 파일을 쓰기 전 공유 state-schema를 읽는다. 게시 작업을 새로 만드는 경우에만 `social/<job-slug>/`에 스키마대로 job-state.md·material.md·canonical.md·drafts/threads.md·post-log.md를 두며, 기존 작업은 재사용한다. platforms·accounts·status는 한 줄 flow style, source·post_intent는 원본과 목적을 유지한다. bootstrap만 수행할 때는 게시 작업·material·canonical·초안을 만들거나 활성화하지 않는다. 기존 작업 복구가 필요할 때만 다음으로 활성화한다.

```bash
bash "${CLAUDE_SKILL_DIR}/../social-posting/scripts/post-state.sh" activate <job-dir>
bash "${CLAUDE_SKILL_DIR}/../social-posting/scripts/post-state.sh" get
```

## 4. 소재·보이스·문안 준비

초안만 요청해 3절을 건너뛰었어도, 상태·초안 파일을 쓰기 전 공유 state-schema와 voice-profile-schema를 읽고 작업 루트를 확정한다. 새 초안 작업만 스키마대로 생성하고 기존 작업은 보존한다. 문안 준비를 요청했을 때만 기존 문서·대화의 사실·수치·실패·트레이드오프·사용자 관점과 출처를 material.md로 정리한다. 모르는 숫자·고유명사·경험은 지어내지 않고 AskUserQuestion으로 확인한다. `질문 필요`는 해결하거나 게시문에서 뺀다.

기존 voice-profile.md는 재사용한다. 제공된 보이스·샘플로 충분하면 bootstrap을 생략한다. 보이스가 부족하면 사용자에게 샘플 제공 / bootstrap 수집 / 취소 중 묻는다. bootstrap을 선택하면 먼저 3절의 계정 확인을 거친다. bootstrap 요청에서만 다음으로 최대 20개 원문을 수집한다.

```bash
node "${CLAUDE_SKILL_DIR}/../social-posting/scripts/ego-post.mjs" bootstrap --platform threads --count 20
```

원본 text·url·time은 `social/bootstrap-cache/`에 보존하고 공유 voice-profile-schema를 따른다. 실제 샘플 3~5개는 **verbatim**만 쓴다. 말투·안티패턴·금지 주제는 추측해 확정하지 않는다. 프로필과 샘플을 보여주고 AskUserQuestion **이대로 저장 / 샘플 교체 / 항목 수정**으로 검수한다. bootstrap만 요청했으면 여기서 종료한다.

새 문안은 material·voice로 canonical.md를 만든 뒤 Threads 문안을 별도 작성한다. 새 사실은 canonical부터 갱신한다. post_intent가 teaser이고 링크가 있으면 **훅 1개 + 링크 유도만** 쓰고 논지를 요약하지 않는다. 링크 없는 글은 summary다. 제3자의 실패·탈락·평가 일화는 논지를 먼저 쓰고 후반 근거로 둔다. 일화를 리드로 쓸 때만 프레이밍을 별도로 확인한다. 기존 초안 게시 경로에서는 이 단계를 건너뛴다.

## 5. 사진·초안 검사

플레이북과 공유 state-schema에 따라 drafts/threads.md의 platform·format·본문을 작성한다. `link`가 본문에 있으면 별도 link 키를 비워 중복을 막는다. 초안의 format: thread와 `=== POST ===` 구분은 준비할 수 있다. 사진·link는 첫 세그먼트에만 둔다. 최근 글·지정 permalink 조회, bootstrap, 초안 준비만 지원한다. 길이는 참고 codepoint와 lengthVerified:false로 보고한다. 게시·게시 승인·read-back 검증으로 진행하지 않는다.

사진은 공개 여부보다 로그인 브라우저에서 **접근 가능**한지를 확인하되 접근 가능성이 **재게시 권리**를 뜻하지는 않는다. 타인 사진은 출처·사용 권한을 별도로 확인한다. 근거 없는 사진 상한을 새로 만들지 않는다. 선택 사진 ID·URL·alt는 사용자가 확인한다. alt가 없으면 관찰된 이미지에 맞는 설명을 보완한다.

기존 로컬 사진은 절대 sourcePath와 alt를 전달해 작업 media/로 보관한다. 반환 path·alt를 초안에 쓰며 원본 출처를 material·로그에 보존한다.

```bash
printf '%s' '{"jobDir":"<게시 작업 절대경로>","media":[{"sourcePath":"<로컬 사진 절대경로>","alt":"<사진 설명>"}]}' \
  | node "${CLAUDE_SKILL_DIR}/../social-posting/scripts/materialize-media.mjs"
```

scan 사진은 후보·이미지 ID·원본 URL을 선택하고 다음 입력을 쓴다. alt 보완 시에만 `altOverride: {manifestDigest, mediaId, alt}`를 더하며 같은 후보의 digest·사진 ID·URL을 대조한다.

```bash
printf '%s' '{"jobDir":"<scan 반환 절대경로>","platform":"threads","candidateId":"<후보 ID>","sourceUrl":"<관찰 사진 URL>"}' \
  | node "${CLAUDE_SKILL_DIR}/../social-posting/scripts/ego-post.mjs" fetch-media
```

관리 영수증의 manifest digest와 바인딩 신원이 검증되어야 한다. 반환 path·sha256·provenancePath·provenanceSha256을 초안의 path·sha256·provenance·provenance_sha256과 `source: scan`에 연결한다. 출처·alt도 승인 대상이다. 구계약의 provenance_sha256이 없으면 사진을 다시 준비하고 출처·alt를 다시 검토한다. Threads 게시 승인은 받지 않는다. MIME·signature·수신 후 10 MiB 검사는 전체 디코딩이나 다운로드 중 제한을 뜻하지 않는다.

대상 초안 하나만 검사한다. exit 1 또는 uv 부재면 중단하고 고친다. 다른 플랫폼의 미완성 초안을 이 게시의 차단 조건으로 삼지 않는다.

```bash
uv run "${CLAUDE_SKILL_DIR}/../social-posting/scripts/check-drafts.py" <job-dir> --platform threads
```

기계 검사와 별도로 사실·금지 주제·플레이북의 권고를 확인한다. 휴리스틱은 근거·날짜가 있는 참고이며 하드 제약으로 승격하지 않는다. **초안만 요청했으면 검사 결과와 남은 질문을 보고하고 여기서 종료**한다.

## 6. Threads 쓰기 차단

`publish.sh`와 직접 `ego-post.mjs post` **양 경로 모두 THREADS_UNVERIFIED**다. 초안은 준비할 수 있지만 게시 승인 질문을 열거나 게시를 시도하지 않는다. 길이·사진·답글·read-back의 실환경 검증이 완료됐다고 주장하지 않는다. 전체 본문 UTF-8 500바이트 규칙을 만들지 않는다. 일반 payload·환경변수·다른 스킬로 차단을 우회하지 않는다. 해제는 별도 허가된 test account 검증과 후속 코드 검토의 작업이다.

## 문서

[문서 목록](docs/INDEX.md) · [플레이북](docs/playbook.md) · [빠른 시작](README.md)
