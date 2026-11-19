# 변경 이력

## 1.13.0 — 2026-11-19

- **read에 원문 전체 읽기(`fullText: true`)를 추가한다.** 사용자가 특정 메시지 원문을 명시적으로 요청한 수동 회차에서만 행당 자르기를 끄고 원문 그대로 반환한다 — 기존에는 `maxEventChars` 상한 1,000자에서 잘렸다. DOM·캡처 두 경로 모두 적용되고 교차 검증도 전체 원문 기준이다. `maxEventChars`와 함께 줄 수 없고 무인 회차는 거부한다. 검증 상한(20,000자)을 넘는 원문은 조용히 자르지 않고 `EGO_SCHEMA_INVALID`로 멈춘다.
- scan은 행당 300자 고정 상한을 그대로 유지하고, 원문은 기존과 같이 stdout·세션에만 흐르며 저장하지 않는다. 1,000자 초과 메시지 회귀 테스트(DOM·캡처·미저장·무인 차단)를 추가했다.

## 1.12.0 — 2026-11-16

검토 가능성·전송 계약·read 관측 보강과 scan 수신 응답 관측 계층을 함께 담는다.

첫 실환경 검토·전송 회차(2026-11-15)의 실측으로 검토 가능성과 전송 계약을 보강한다.

- **검토 필요 항목도 seg 기록을 승격한다**: LATEST_EVENT_UNPROVEN으로 검토 필요가 된 스레드도 개방 성공 시 threadSeg를 기록해 read로 본문 확인이 가능하다(Ayman 실측).
- **전송 계약을 블록 구조 대조로 교체한다**: 이 편집기는 문단을 `<p>` 블록으로 만들어 innerText 줄바꿈 수가 입력과 달라진다(빈 줄 1개 → innerText `\n` 5개 실측). 본문 삽입은 문단별 네이티브 insertText + 문단 경계 Shift+Enter로 하고, composer 상태·잔여본문 정리·readback을 모두 블록 배열 대 본문 줄 배열의 정확 대조로 바꾼다. 다중 문단 전송을 실환경에서 실증했다(Jane).
- **UNKNOWN을 read 확인 관측으로 보강한다**: 증거 폴링이 늦은 렌더를 놓치면 전송 동작 뒤에도 UNKNOWN이 나온다(Jane 실측 — 실제로는 성공). SEND_UNKNOWN에서 자식 종료가 확인된 경우에 한해 같은 락 안에서 read 1회로 최신 자기 발신·본문 일치를 확인해 `verification`을 덧붙인다. 재전송이 아니라 관측이며 ledger 규칙은 유지된다.
- **read에 messengerMessages 캡처 경로를 추가한다**: 가상화 렌더링 한계(최신분만 렌더)를 넘기 위해 스레드 페이지가 자체 요청한 엔드포인트를 performance API로 관측해 같은 세션에서 재호출한다 — URL 합성 없음, 응답 원문 저장 없음. 비공식 API 응답 읽기라 수동 호출에서만 사용하고 unattended는 dom으로 강제하며, 마지막 이벤트를 DOM과 교차 검증해 일치할 때만 채택하고 실패·불일치는 DOM으로 폴백한다. 사용자 동의 조항을 SKILL.md에 명시했다.
- **추출의 블록 경계 공백을 복원한다**: textContent 직렬화가 문단 경계 공백을 유실해 proofMatch 접두 입증 실패(Ayman 실측)와 전송 증거 본문 대조 실패(Jane UNKNOWN 실측)가 났다 — openThread·readThread·send 증거 추출 세 곳 모두 블록별 텍스트를 공백으로 이어 붙인다.
- **추출 전 행 수 안정화 대기를 둔다**: 1행이 보이자마자 추출하면 늦게 렌더된 이전 메시지를 누락한다(Jane read 실측 — 1건 반환, 실제 2행) — read는 3틱, scan 상세 개방은 2틱 행 수 안정화 뒤 추출한다.
- read의 `auto`는 캡처 시도와 DOM 폴백으로 스레드에 두 번 직행한다(기존 직행 테스트 기대 갱신). 스텁에 native fetch·focus·keyboard·performance 관측과 행 수 시퀀스를 추가했다(375건 통과).

scan에 **수신 응답 관측 계층**을 추가해 상세 개방 없이 판정을 끝낼 수 있게 한다.

- **수신 응답 관측(티어 A)**: 목록 자식 안에서 `page.cdp('Network.enable')` → `/messaging/` 1회 접속 → `page.events()` 버퍼의 `Network.responseReceived`/`loadingFinished`에서 페이지가 스스로 수신한 messaging API 응답만 골라 `Network.getResponseBody`로 본문을 읽고 자식 안에서 파싱한다. 응답 원문은 자식 밖으로 나가지 않고 요약(uuid·발신자·프리뷰 대조용 본문)만 반환된다. 방향 판정은 발신자 식별자(`miniProfile.publicIdentifier`·urn의 ACoAAA)를 binding의 소유자 slug·프로필 ID와 대조하는 방식이다 — 서버가 방향 필드를 주지 않기 때문이다. 입증 규칙은 상세 계층과 동일(정규화 본문 ↔ 목록 프리뷰 접두 대조)이고, 이름 일치 1건이 1차 매칭이며 정확히 1건일 때만 캡처한다.
- **계약**: 관측은 페이지가 이미 받은 응답만 읽는다 — 새 요청·재요청·쿼리 식별자·해시 고정·쿠키 접근 없음. 응답 형식이 불명이면 관측 0건으로 기존 상세 개방 계층(DOM 증명)에 폴백하며 신규 실패 코드는 없다. 진단은 `coverage.capturedCount`로 한다.
- **coverage**: `capturedCount` 추가, completeness 조건에 캡처 해소 포함. 캡처 후보는 payload 유래 `events`(≤12개)를 인라인으로 실어 반환하며 threadSeg 승격이 없어 `read`는 `EGO_THREAD_NOT_OBSERVED`다 — 후보 초안 작성은 인라인 이벤트로 충분하다.
- **계기**: baseline 실측(2026-11-16, 목록 11건)에서 scan 126초·개방 10회·partial이 구조화됐다. 스레드마다 새 ego 자식+전체 리로드가 상수 비용이었다.
- **목록 순회 조기 종료**: 기존 안정 조건(`total === items.length`)은 LinkedIn이 행을 계속 갱신하는 실환경에서 발동하지 않아 목록 단계가 매번 순회 예산(100초)을 전부 태웠다. 캡처 계층이 켜져 있으면 payload가 순회 근거가 되고, 행 개수가 두 뷰 연속 동일하면 순회 완료(`complete: true`)로 본다. 캡처가 꺼져 있으면 기존 규칙 그대로다.
- **실측(2026-11-16, ego-browser 0.6.3.14, 목록 11건)**: 개선 전 126.1초(2회 동일)·개방 10회·`OPEN_CAP_EXCEEDED`·partial → 개선 후 17.6초/16.6초·개방 5회(캡처 6건 해소)·상한 초과 해소·`complete: true`. 후보 집합(이름+UUID 4건) 양방향 parity 확인. 잔여 개방 5건은 InMail 발신자(urn에 ACoAAA 없음)와 프리뷰 미입증분 — 후속 개선 여지.
- **가독 판정 승격(2026-11-17)**: InMail 제목형 프리뷰는 스레드 버블에 렌더되지 않아(read 실측: 렌더 이벤트 1건이 내 발신 "예 감사합니다!"뿐) 접두 입증이 구조적으로 실패하고, 해당 스레드가 매 회차 `LATEST_EVENT_UNPROVEN` 검토 필요로 영구 남았다. 접두 입증 실패여도 렌더된 마지막 버블 내용이 읽혔으면(`lastEventReadable`) DOM 발신자 판정으로 answered/후보를 확정하고, `LATEST_EVENT_UNPROVEN`은 내용 미가독(빈 버블·반응 이벤트)에만 남긴다. 검증 scan(2026-11-17): 검토 필요 2건 → 0건, answered 4→6, 완전성 partial → complete.
- **페이로드 실측 형태**: 대화 uuid는 `conversationUrl`의 스레드 seg(2-+base64url) 디코딩(DOM 계층과 동일 규칙), 방향은 `sender.entityUrn`의 ACoAAA vs binding 프로필 ID, 본문은 `body.text`, 표시 이름은 소유자를 제외한 참가자의 `participantType.member` 이름. 첫 구현의 범용 walker 가정(events 배열·conversationUrn·miniProfile.publicIdentifier)은 공개 자료 기반 추정과 달랐다 — 진단 스크립트로 실측해 교정했다.

## 1.11.0 — 2026-11-15

첫 실환경 전송 실측(2026-11-15, ego-browser 0.6.3.14)과 LinkedIn 마크업 변화로 발견한 결함들을 교정하고 전송 경로를 재작성한다.

- **스레드 URL seg base64 패딩 허용**: LinkedIn이 스레드 seg에 패딩(`=`)을 붙이기 시작했다(2026-11-15 실측 — `2-…XzEwMA==`). 디코더는 애초 패딩을 허용했지만 검증 정규식 3곳(openEgoThread·readEgoThread·read 기록 검증)이 `=`를 거절해 상세 개방·read가 전부 `EGO_SCHEMA_INVALID`로 실패했다. `/^2-[A-Za-z0-9_-]{2,254}={0,2}$/`로 고쳤다.
- **전송 삽입 경로를 네이티브 키보드로 교체**: `execCommand('insertText')`는 비신뢰 이벤트라 LinkedIn 에디터 모델이 등록하지 않았다(2026-11-15 실측 — DOM에는 텍스트가 보이지만 전송 UI가 렌더되지 않는 상태). 네이티브 `page.focus` + `page.keyboard.insertText`(신뢰 입력)로 바꿨다.
- **전송 동작을 Enter 키로 교체**: 이 UI 변형에는 전송 버튼이 없다 — composer 힌트가 "Press Enter to Send"다(2026-11-15 사용자 실측). 전송 버튼 탐색·클릭을 Enter 1회로 바꾸고, 전송 동작 이전 실패는 `BLOCKED`(재준비 가능), 이후 불명은 `UNKNOWN` 유지.
- **승인 본문 잔여분 정리**: 이전 시도가 BLOCKED로 끝나 composer에 남은 승인된 본문과 정확히 일치하는 잔여분만은 네이티브 키보드(전체선택→삭제)로 정리한 뒤 진행한다. 그 외 내용은 덮지 않는 기존 원칙 유지.
- **스캔·read 실패 사유 노출**: scan의 상세 개방 실패 시 review 사유에 `error.reason`(EGO_SCHEMA_INVALID vs EGO_JSON_INVALID 등)까지 포함해 원인 구분이 가능해졌다.
- 테스트 stub에 네이티브 입력 API(focus·keyboard.press·insertText)를 추가하고 잔여분 정리 경로 테스트를 새로 뒀다(367건 전부 통과, 실환경 전송 1건 `SENT` 실증).

## 1.10.0 — 2026-11-15

- **대화 전체 읽기(`read`)를 추가한다.** `--mode manual read`는 scan이 승격한 UUID 키 기록의 관측 `threadSeg`(스레드 URL 경로 세그먼트)로 `/messaging/thread/<seg>/`에 직행해 렌더된 메시지 이벤트 전체를 추출한다. 목록 클릭 순회가 없어 무관한 스레드 개방·읽음 부작용이 없고, URL 합성도 하지 않는다. 입력 `{"transport":"ego-ui/1","executable":"...","taskSpaceName":"...","conversationUuid":"..."}`(선택 `maxEventChars` 기본 300·범위 40–1000, `maxEvents` 기본 12·범위 1–50). 기록에 seg가 없거나 구형 기록이면 `EGO_THREAD_NOT_OBSERVED`로 종료한다 — read는 scan 뒤에 온다. 실패 시 관측 락 유지·성공 시 해제는 scan과 동일하다.
- scan의 상세 개방이 같은 개방 1회에서 렌더된 이벤트(발신자·버블 본문) 전체를 추출해 **입증된 후보에만** `events`로 덧붙인다(행당 300자·최신 12개 고정 상한 — 토큰 최소화). answered·미입증 스레드는 이벤트 없이 식별자·해시 기록만 유지한다. 개방 횟수·읽음 영향은 변하지 않는다.
- 이벤트 본문은 stdout·세션에만 흐른다. `conversations/` 기록은 기존 최소 저장 규칙을 유지하며 `threadSeg`는 본문이 아닌 URL 경로 식별자로 추가된다. 이력 범위는 DOM 렌더분이며 스킬은 스크롤하지 않는다 — 완전성은 `renderedCount`·`returnedCount`·`truncatedFromOldest`로 보고할 뿐 전체 이력을 주장하지 않는다.

## 1.9.0 — 2026-11-14

- **승인된 본문의 ego UI 전송(U5)을 추가한다.** ego 연결의 `prepare`는 브라우저를 건드리지 않고 job·승인 질문을 만든다(입력에 `conversationName` 추가 — 질문과 승인 영수증 결합에 포함). `send`는 대화 락 안에서 ego 스킬 락을 얻고 고정 전송 호출을 한 번 실행한다: 대화 개방(URL 스레드 UUID 일치 검증) → 전송 직전 마지막 이벤트가 상대 발신인지 재검증 → 빈 composer 확인 → 본문 삽입(execCommand insertText) → 공백 정규화 없는 정확한 readback → 전송 버튼 1회 클릭 → 새 자기 발신 이벤트·본문 일치로 증명.
- 결과 사유를 세 갈래로 구분한다: 클릭 이전 실패는 `BLOCKED`(ledger 제거·job stale — 재준비 허용), 클릭 뒤 증거 부족(`SEND_UNKNOWN`)과 부모 수준 작업 종료 불명은 `UNKNOWN`(ledger 유지, 후자는 관측 락 유지).
- 승인 영수증을 transport·binding(executable·taskSpaceName)·conversationName에 결합하고, 승인 훅이 ego job도 기록하도록 확장한다. legacy 영수증 결합 불변.
- 실환경 전송은 G3(지정 대화·정확한 본문·입력 부작용 설명·개별 전송 승인) 전에는 실행하지 않는다.

## 1.8.1 — 2026-11-14

첫 실환경 setup·scan 실측(2026-11-14, ego-browser 0.6.3.14)에서 발견한 결함들을 교정한다.

- **발신자 판정 메커니즘 교체(1.8.0의 data-event-urn 대조 반증)**: 스레드 이벤트의 `data-event-urn` 프로필 세그먼트는 메시지 발신자가 아니라 수신함 소유자(나)였다. 발신자 판정을 마지막 메시지 행의 `msg-s-event-listitem--other` 클래스 유무로 교체한다(상대 발신 → `candidates`, 부재 → answered 제외). 기록은 `lastSenderKind`(other/self)로 남긴다.
- **ego CLI 스크립트 계약 실측 반영**: 파이프 스크립트는 sloppy CJS eval로 돌아 `await (`로 시작하면 ReferenceError로 자식이 죽는다 — 모든 고정 스크립트를 IIFE + `.catch` 형태로 바꾼다. 스크립트 콘솔 출력은 stderr로 우회된다 — 페이로드 채널을 "stdout 우선, 없으면 stderr 줄 단위(공지 외 정확히 한 줄 JSON)"로 확장한다.
- **openThread 실측 교정**: `/messaging/` 전환 직후 목록 미렌더(NO_LIST)·자동 개방 스레드의 URL 래스를 폴링으로 처리하고, 스레드 seg의 `2-` 접두사를 벗겨 UUID를 디코딩하며, 목록 행은 li 대신 `conversation-listitem__link` 래퍼를 클릭한다. 이벤트 textContent의 헤더·이모지 액션 바 정크를 떼고 버블 본문만 입증 대조한다. 반응(emoji)이 마지막 이벤트인 스레드는 `LATEST_EVENT_UNPROVEN` 검토 필요로 남는다.
- **acquireIdentity 실측 교정**: `/in/me`의 id는 `com.linkedin.sdui.profile.card.ref<ACoAAA…><섹션명>` 형태라 탐욕 실행이 섹션 접미사(Topcard 등)를 삼킨다 — 전 실행의 최장 공통 접두사(30–40자)로 참 profileId를 추출하고, 리다이렉트·렌더 대기를 추가한다.
- 목록 파서가 헤딩 없는 행·"Load more conversations" 버튼 행을 항목으로 세는 결함을 고치고, DOM 행 인덱스를 항목에 보존해 클릭 정렬을 보장한다. 테스트 stub을 큐 기반에서 evaluate 대상별 셀렉터 디스패치로 재설계해 폴링 코드와의 정렬 결함을 제거한다.

## 1.8.0 — 2026-11-14

- scan의 상세 계층을 구현한다: 목록 항목 클릭 개방(입력 `detailOpenCap`, 기본 10·최대 25) → 스레드 `data-event-urn` 발신자 ID를 binding profileId와 대조 → 일치는 answered 제외, 불일치는 `candidates`. 마지막 이벤트 텍스트와 목록 미리보기의 접두 대조로 최신성을 입증하며 실패는 `LATEST_EVENT_UNPROVEN` 검토 필요로 남긴다.
- 개방 성공분의 관측 기록을 대화 UUID 키로 승격해 동명 표시 이름 충돌을 해소한다. 상한 초과분은 `OPEN_CAP_EXCEEDED`로 미개방 반환한다.

## 1.7.0 — 2026-11-14

- G2 실측(2026-11-14)을 반영해 scan(ego-ui/1)을 활성화한다: 구조 fingerprint 강제 일치, 필터 발견, lazy append 목록 순회, 관측 기록(이름·해시·시각만), 전 항목 검토 필요 반환. 상세 개방은 별도 동의 범위로 남는다.
- setup의 /in/me 다리에 SPA 리다이렉트 대기·렌더 대기·ACoAAA 추출(앵커드 우선·빈도 다수결·길이 30–40 검증)을 추가한다. 즉시 읽기로 slug "me" 오획득과 접미사 오염을 방지한다(실측 발견).
- 필터 토글 실측: Unread 클릭 시 목록 재렌더 확인, 재클릭으로 해제, 배지 카운트 불변(읽음 부작용 미관측).

## 1.6.0 — 2026-11-13

- 온보딩 setup(`ego-ui/1`)을 활성화한다: 한 번의 승인 절차로 `/in/me`·`/messaging/` 관측에서 계정 slug·내 프로필 ID(`ACoAAA…`)·화면 구조 fingerprint를 확보하고, 재관측 일치 시에만 binding을 저장한다. `/messaging/` 접속의 부수 스레드 개방(읽음 영향 미확정)을 승인 설명에 명시하며 동의 없이는 진행하지 않는다.
- setup의 관측 실패(ACoAAA 미관측·로그인 화면·fingerprint 불일치 등)는 단계별 `EGO_*` 사유로 구분하고 락을 보존한다.
- 구형 binding이 저장된 상태에서 구형 경로는 `NEEDS_SETUP`으로 안내한다(transport 검사 순서 정리).
- `scan`은 여전히 `UI_NOT_ACTIVATED`다. G2 관측(필터 의미론·상세 개방·읽음 영향 측정)이 선행된다.

## 1.5.0 — 2026-11-13

- UI 실행 계층을 Aside REPL에서 ego-browser 고정 스크립트(`ego-ui/1`)로 전환한다. `inspect`는 스킬 전용 TaskSpace의 관리 Page 발견(`PAGES_OBSERVED`)과 지정 Page의 전체 snapshot(`OBSERVED`)을 지원하고, Aside `inspect`는 동결한다.
- ce-debug에서 확인한 오류 합침을 교정한다: 스페이스·탭 목록·Page 발견·URL·로그인·snapshot·형식 단계마다 고유 `EGO_*` 사유 코드를 반환한다.
- 관측 락을 ego 네임스페이스(`ego-profile-<실행 파일·스페이스 해시>`)로 분리한다. 기존 Aside 락과 구형 `sending`·`unknown` 상태는 보존하며 ego binding에서도 계속 차단한다.
- 로그인·1Password는 사용자 전용 계약으로 명문화한다. 로그인 필요는 `EGO_NEEDS_LOGIN`, ego 실행 환경 실패는 `EGO_CONNECT_FAILED`로 구분하고 무인 회차는 해당 사유로 종료한다.
- `UI_NOT_ACTIVATED` 가드를 aside·ego 양쪽 transport에 적용한다. UI 기반 조회·회신·Orca 연동은 여전히 미활성이며 활성 조건은 계획의 G0–G4 게이트를 따른다.

## 1.4.1 — 2026-11-09

- 조회 기능의 사용자 지정 기간 지원과 이번 최근 2주 테스트 기준을 구분하도록 문서를 정정했습니다. 2주는 기본값·고정 기간·최대 조회 기간이 아닙니다.
- 실행·출력 제한으로 요청 기간을 다 확인하지 못하면 기간을 임의로 줄이지 않고 확인한 범위·남은 범위·중단 사유를 보고하도록 명시했습니다. 정상 종료가 확인된 부분 조회와 브라우저 작업 종료 불명·락 유지도 구별합니다.
- 실행 코드·보호 테스트는 변경하지 않았으며 UI 기간 조회는 여전히 미구현·미활성입니다. 실환경 접근·기존 락 진단·해제는 하지 않았습니다.

## 1.4.0 — 2026-11-09

- 메시지 탭 발견에서 정확한 HTTPS origin의 `/messaging`·`/messaging/` 하위 경로와 query·fragment를 허용합니다. 원문 URL 대신 target ID·origin·목록/하위 경로 구분만 반환하며 유사 경로·다른 origin/포트·credentials·로그인 화면은 계속 거부합니다. snapshot도 같은 경계를 전후 검사합니다.
- 결과 불명에 원문 없는 실패 단계 `reason`을 추가했습니다. spawn·입출력·timeout·종료·출력 크기·UTF-8·JSON·스키마와 상태 기록을 구별하되 브라우저 작업 종료로 간주하지 않으며 락은 유지합니다. 과거 결과 불명의 원인을 소급해서 확정하지 않습니다.
- 새 관측 락에 작업 종류·시도 ID·시작 시각·로컬 PID만 durable하게 기록합니다. 동시 inspect·부모 강제 종료·늦은 자식 완료·기존 빈 락의 재진입 차단을 합성 프로세스로 검증합니다. 자동 해제·TTL 탈취·복구 명령은 만들지 않았습니다.
- 명시된 UI setup/scan을 인증·상태·UI 접근 전에 `UI_NOT_ACTIVATED`로 차단합니다. 구형 인증으로 넘어가지 않으며 기존 승인·sending·unknown 보호는 유지합니다.
- Focused/Unread 우선·다른 관측 선택지·기간 조회와 남은 활성화 조건을 문서화했습니다. 실제 계정/대화 ID·필터 계층·읽음 영향이 미확인이라 UI binding·필터 선택·기간 순회·중복·미응답 판정은 구현·활성화하지 않았습니다. 실제 Aside·계정·키체인·Orca·기존 락에 접근하지 않았고 전송·설치·등록·Git 공개 작업도 하지 않았습니다.

## 1.3.0 — 2026-11-09

- 정상 `reply.mjs --mode manual inspect`에 Aside UI 관측 입구를 추가했습니다. target이 없으면 정확한 목록 URL의 탭 ID만 발견하고, 사용자가 확인한 target을 넣으면 전체 snapshot을 관측합니다. 계정 확인·binding 저장·미응답 판정·상세 열기·입력·전송은 하지 않습니다.
- 관측을 host·Aside account·profile ID별로 직렬화하며 성공 뒤에만 락을 해제합니다. 오류·출력 불명·timeout에서는 락을 남기고 target·실행 파일 변경이나 발견 단계로 돌아가도 재호출하지 못하게 합니다. 구형 binding·sending·unknown·락은 변경하지 않습니다.
- 무인 inspect와 추가 본문·임의 코드 등 잘못된 입력을 UI·인증·상태 쓰기 전에 거부합니다. 출력 상한 검사가 일반 timeout에 기대지 않는지도 합성 실행 파일로 검사합니다.
- 사용자 시험 절차와 별도 실계정 관측 동의, 원문 보존 범위, 오류 뒤 재시도 금지를 문서화했습니다. 실제 Aside stdout·계정/대화 ID·읽음 영향은 미검증이며 scan·prepare·send의 UI 전환과 회신·정기 등록 활성화는 아직 완료하지 않았습니다.

## 1.2.2 — 2026-11-09

- 현행 구형 실행 경로를 `linkedincli/1`로 명시하고 binding·수동 job·승인 질문·영수증에 결합했습니다. 버전 없는 연결과 다른 실행 경로의 연결·승인은 인증이나 전송 전에 거부합니다. 자동 이관·인증 fallback은 하지 않습니다.
- 구형 `sending`·`unknown`·남은 락은 보존하며 SessionEnd나 새 job으로 우회하지 못하게 회귀 테스트를 추가했습니다. 구형 pending job의 단기 본문 정리는 유지합니다.
- Aside UI 전환 준비로 내부 snapshot 실행기를 추가했습니다. 명시한 프로필·target·LinkedIn 목록 URL을 확인하고 고정 REPL 작업을 shell 없이 stdin으로 전달합니다. 입력/출력 스키마, UTF-8, 각각 2 MiB 출력 상한, REPL 120초에 종료 여유를 둔 부모 125초 상한을 검사하며 오류 원문·stderr는 노출하지 않습니다. 새 실행기는 일반 입구에 연결하지 않았고 상세 열기·입력·전송을 구현하지 않았습니다.
- 합성 실행 파일·페이지 대역을 포함한 스킬 테스트 218개가 통과했습니다. 실제 Aside·LinkedIn·키체인·Orca는 호출하지 않았습니다. 실제 UI 출력·식별자·읽음 영향·전송 증거·무인 호환성은 미검증이며 UI 전환 또는 운영 가능 판정이 아닙니다.

## 1.2.1 — 2026-11-09

- 기존 `NODE_EXTRA_CA_CERTS`를 인증 자식과 최종 CLI 자식까지 전달하도록 세 단계 환경 필터를 수정했습니다. 인증서 경로를 고정하거나 신뢰 저장소를 바꾸지 않으며, Node preload·프록시·인증서 검증 비활성화 설정 차단은 유지합니다.
- 동일 URL 302를 TLS 지문 차단으로 단정했던 기록을 정정했습니다. 사내 CA 상속 누락은 확인했지만 실제 인증 오류와의 인과관계는 미확인입니다.
- CA 전달 누락의 실패를 재현한 뒤 수정했습니다. 정상 진입점부터 최종 배포 CLI의 시작 시 CA 로드와 승인된 합성 POST 1회를 검사하며, CA 미설정과 위험한 환경변수 차단도 유지합니다. 저장소 9개 테스트 스위트·변경 파일 pre-commit·인덱스 재생성 안정성 검사가 통과했습니다. 여기까지는 실계정·쿠키·키체인 접근 없는 합성 검증입니다.
- 이후 사용자가 허가한 실환경 검증에서 정상 `scan`은 `NEEDS_SETUP`, Default 프로필의 정상 `setup`은 `CLI_FAILED`로 중단됐습니다. 계정 확인·binding 저장·대화 조회에는 도달하지 못했습니다. 일반 오류 코드만으로 인증서·HTTP 인증·그 밖의 CLI 실패를 구분할 수 없어 원인은 미확인입니다. 추가 재시도·별도 HTTP 진단·전송은 하지 않았습니다.

## 1.2.0 — 2026-11-08

- 원래 CLI의 Chrome reader에 Aside 읽기 어댑터를 연결해 공통 쿠키 결과·전체 Cookie 헤더 생성 경로를 재사용합니다. 두 인증 쿠키 외에 유효한 LinkedIn 부가 쿠키도 전달하도록 읽기 범위를 넓혔습니다.
- 기존 읽기 전용 snapshot·정확한 도메인·v10/v11·DB 버전별 host digest 검사는 유지합니다. 부가 쿠키의 만료·다른 경로·partition은 제외하고 중복 이름·잘못된 이름·헤더 주입·복호화 실패는 중단합니다. 선택 도메인의 128개 행과 64 KiB 헤더 상한을 넘으면 중단합니다.
- 고정 CLI의 import 시 실행을 막고, 전체 헤더를 격리한 자식 env로 전달합니다. 모든 전달 쿠키의 결과 비밀 검사를 추가했으며 `/me`와 POST에 동일한 쿠키 묶음을 사용하는 계약은 유지했습니다.
- 코드 리뷰에서 확인된 결함 하나를 고쳤습니다. 전송 명령은 키체인·계정 확인·POST의 최악 경우(약 22초)가 15초·16초 예산을 넘어 느린 정상 전송이 결과 불명과 대화 영구 차단으로 끝날 수 있었고, 인증 자식 30초·부모 31초의 전송 전용 예산으로 분리했습니다. 승인 절차의 135초·136초와 조회의 기존 15초·16초는 유지합니다.
- 원본 upstream을 보존하고 `aside-cookies.patch`·빌드 입력·배포 번들·provenance 해시를 갱신했습니다. 합성 DB와 실제 배포 CLI를 연결해 부가 쿠키 전달·비밀 차단·승인·계정 변경·단일 POST를 검증했으며 스킬 테스트 177개와 저장소 9개 스위트가 통과했습니다. 기존 npm 캐시만 사용하는 오프라인 재현 빌드와 추적·신규 파일의 pre-commit 검사도 통과했습니다.
- 전체 Cookie 헤더 전환은 실계정 API·쿠키·키체인 접근을 중단한 상태에서 합성 검증했습니다. 이 변경이 실제 `AUTH_ERROR`나 브라우저 로그인 문제를 해결했다는 증거는 없습니다. 사용자 요청으로 재개한 2026-11-09 읽기 진단에서 23개 쿠키의 복호화·전체 헤더 생성을 확인했고, 배포 CLI 진단은 `AUTH_ERROR`, 별도 요청은 동일 URL 302를 반환했습니다. 사용자는 같은 시점에 Aside 브라우저가 로그인 상태라고 확인했습니다. 이 결과만으로 TLS 지문 차단이나 세션 만료를 확정할 수 없으며 원인은 미확인입니다. 대화 조회·회신·Orca 등록·커밋·푸시는 수행하지 않았습니다.

## 1.1.1 — 2026-11-08

- 실제 `/me`에서 관측한 `data["*miniProfile"]`·`included` 참조 형식을 지원합니다. 정확한 entityUrn 일치 항목 하나만 선택하며, 미해결·중복·다른 URN·이름 누락·직접 객체와의 혼합은 거부합니다.
- 전송 직전 계정 확인도 같은 파서를 사용합니다. 인증 쿠키를 다시 읽지 않고 `/me`와 전송에 동일한 env를 사용하는 계약은 유지했습니다.
- 합성 계정·인증·배포 CLI 연결 테스트에서 실패를 먼저 확인한 뒤 수정했으며, 스킬 테스트 164개가 통과했습니다. 기존 직접 miniProfile 응답과 계정 변경 시 POST 0회 검사도 유지했습니다.
- 재로그인 후 쿠키 검사·키체인 승인용 조회·별도 UI 금지 재조회와 `/me` 구조 확인에 성공했습니다. 수정 후 실제 재검증은 CLI의 `AUTH_ERROR`로 중단됐으며 계정 확인·binding 저장·대화 조회·전송·Orca 등록은 미실행입니다.

## 1.1.0 — 2026-11-08

- 최초 수동 `setup`에만 macOS 인증 UI를 허용하고 사용자가 ‘항상 허용’을 선택하도록 안내합니다. 스크립트는 버튼을 누르거나 키체인 ACL을 직접 수정하지 않습니다.
- 승인 직후 별도 helper에서 UI 금지로 재조회합니다. 일회 허용·취소·거절·timeout이면 LinkedIn 조회와 binding 저장 전에 중단합니다. 계정 확인 단계와 일반 조회·전송·무인 실행의 UI 금지는 유지합니다.
- 승인 창은 최대 120초, 인증 자식은 135초, 부모는 136초로 제한합니다. 일반 helper 2초·인증 자식 15초·부모 16초 제한은 유지합니다.
- JXA 분기·UI 금지 재조회·무인 위조 차단·승인 실패·실제 배포 CLI까지의 합성 연결 테스트를 추가했습니다. 공유 실행기 osascript의 영구 접근 범위를 문서에 명시했습니다.
- Node 24 스킬 테스트 150개, 저장소 9개 스위트와 pre-commit 검사를 통과했습니다. 실제 setup은 키체인 두 단계 후 계정 정규화의 `UNSUPPORTED_RESPONSE`에서 중단됐고, 추가 진단은 Personal(`Default`)의 `li_at` 누락으로 키체인·CLI 실행 전에 `NEEDS_AUTH`로 끝났습니다. 재로그인 후 `/me` 구조와 지속 접근 검증이 필요하며 계정 정규화는 아직 변경하지 않았습니다. binding·대화 조회·전송·Orca 등록은 수행하지 않았습니다.

## 1.0.2 — 2026-11-08

- JXA의 CoreFoundation 상수를 Objective-C 객체로 변환해 키체인 조회 조건이 하나로 뭉개지던 `errSecParam(-50)` 오류를 수정했습니다. 조건 7개를 확인하고 반환된 CFData도 NSData로 변환합니다.
- LAContext 외에 helper 프로세스의 `SecKeychainSetUserInteractionAllowed(false)`를 적용해 기존 파일 기반 키체인도 인증 UI를 금지합니다. 설정 실패 시 조회하지 않습니다.
- JXA 브리지와 UI 금지 순서·설정 실패·키체인 오류의 비밀 비노출을 합성 테스트로 검증합니다. 수정 후 실제 조회는 `errSecAuthFailed(-25293)`에서 중단돼 사용자 통제하의 키체인 상태·접근 제어 확인이 필요합니다.

## 1.0.1 — 2026-11-08

- 빈 `top_frame_site_key`의 일반 쿠키를 `has_cross_site_ancestor=1`이라는 이유로 거부하던 검사를 수정했습니다. Chromium은 partition key가 없는 쿠키도 이 값을 1로 저장합니다.
- 실제 partition key와 `is_partitioned` 검사는 유지했습니다. DB 23·24의 ancestor 0·1 복호화와 partition flag 검사를 추가하고, 실제 CLI 연결 합성 테스트도 ancestor 1을 사용하도록 바꿨습니다.
- 플러그인 업데이트와 새 세션의 스킬·카테고리 훅 로드, SessionEnd 훅 실행을 확인했습니다. 실제 연결은 쿠키 검사 뒤 UI 금지 키체인 helper의 종료 코드 1로 중단됐으며 계정·대화 조회와 binding 저장은 수행하지 못했습니다.

## 1.0.0 — 2026-11-08

- 수동 연결·조회·초안 검토·개별 승인·기존 대화 회신과 Orca 무인 조회 절차를 추가했습니다.
- 고정 linkedincli 소스·lock·MIT 라이선스·최소 패치·재현 빌드·실행 산출물과 해시 검증을 포함했습니다. 쓰기 재시도를 제거하고 본문을 stdin으로 전달합니다.
- Aside의 선택된 프로필에서 두 인증 쿠키만 read-only로 읽고 복호화하는 인증 자식과 UI 금지 키체인 helper를 추가했습니다.
- 실제 계정 확인 후 binding 저장, 미응답 후보·검토 필요 분류와 부분 조회 범위를 구현했습니다.
- 실제 질문 응답 훅의 session·challenge·정확한 본문 결합, 대화 락, durable sending 기록과 결과 불명 후 재전송 차단을 구현했습니다.
- 최종 인증 자식이 동일한 쿠키로 승인 계정을 확인한 뒤 전송하도록 수정했습니다. 마지막 대화 조회 뒤 계정이 바뀌면 POST가 0회인지 실제 CLI까지 연결한 합성 회귀 테스트로 확인했습니다.
- 단기 본문을 완료·취소·새 prepare·SessionEnd 때 삭제하고 기존 게시 승인 훅과 상태를 분리했습니다.
- Orca 선택 등록·동의·기존 항목 확인·생성 결과 재조회와 같은 결과 세션에서 새 수동 승인으로 이어가는 절차를 추가했습니다.
- marketplace·카테고리 훅·Node 24 CI·인덱스에 연결하고 합성 인증·네트워크·승인·크래시 테스트를 추가했습니다.
- 실제 Aside·키체인 UI 금지·LinkedIn 응답 호환성, 설치·실전 회신·Orca 등록은 미검증입니다.
