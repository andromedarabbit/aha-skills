# 실행·검증 원칙

## 실행 경계

실행 입력은 [사용자 문서](../README.md)를 따릅니다. 일반 입구는 `scripts/reply.mjs`뿐이며 인증 모듈이나 벤더 CLI를 승인 가드 대신 직접 실행하지 않습니다.
무인 단계는 scan 한 번과 결과 반환만 허용합니다. 연결·질문·승인 생성·전송·등록 변경을 하지 않습니다.
계정·인증·형식·승인 불일치는 실패로 종료하며 다른 프로필·브라우저·전역 CLI로 우회하지 않습니다.
실계정·키체인 접근과 외부 쓰기는 각각 해당 동의가 필요합니다.

## 로컬 검증

README의 방법으로 `SKILL_DIR`을 정한 뒤 실행합니다. 배포 번들을 포함한 테스트에는 npm 설치가 필요하지 않습니다.

```bash
bash "$SKILL_DIR/scripts/tests/run.sh"
```

- Node 내장 테스트는 임시 HOME·합성 SQLite 쿠키 DB·키체인 대역·fetch 대역을 사용합니다. 실제 LinkedIn·Aside·키체인·Orca를 호출하지 않습니다.
- 벤더 CLI 자체에서 429·5xx·연결 종료·timeout·redirect·응답 읽기 실패의 POST 횟수와 stdin 본문을 검사합니다.
- 실제 형식의 PostToolUse payload로 승인 결합을 검사하고 동시 전송·POST 전후 크래시·같은 대화의 새 job 우회를 검사합니다.
- 문서 계약 검사는 승인 문구·무인 프롬프트·훅 등록의 불일치를 탐지합니다. 문자열 검사만으로 대화형 동작이나 설치 호환성을 입증하지 않습니다.
- 계정은 직접 miniProfile과 관측한 `/me`의 `data["*miniProfile"]`·`included` 참조 형식을 지원합니다. 참조와 entityUrn이 정확히 일치하는 항목 하나만 허용하며, 두 형식의 혼합·중복·미해결 참조·이름 누락은 거부합니다. 전송 직전에도 같은 계정 파서와 동일한 인증 env를 사용합니다. 대화·메시지는 명시한 legacy 객체만 지원하며 미지원 구조·동일 시각 최신 이벤트·불명 발신자·중복 ID는 검토 필요 또는 오류입니다.

## UI 실행기 준비 상태

정상 입구 `reply.mjs`의 수동 `inspect`·`setup`(transport `ego-ui/1`)은 ego 관측 경로입니다(Aside `aside-ui/1`은 동결). setup은 1단계에서 `/in/me`만 관측해 계정 slug·내 프로필 ID를 확보하고, 승인 응답에 `/messaging/` 접속의 부수 스레드 개방 설명을 담아 동의 뒤 확인 단계에서 구조 fingerprint까지 확보합니다. ego 관측 기록(`ego-obs-`)은 대화 이름·해시·시각만 저장하며 메시지 원문은 저장하지 않습니다. 상세 개방에 성공한 항목의 기록은 대화 UUID 키로 승격되고 이름 키 기록은 제거됩니다. 상세 개방은 입력 `detailOpenCap`(기본 10·최대 25)으로 제한하며 초과분은 개방 없이 `OPEN_CAP_EXCEEDED` 검토 필요로 반환합니다. 최근 이벤트 입증은 스레드 본문과 목록 미리보기의 정규화 접두 대조로 하며 실패 시 후보에서 제외합니다. ego 실패의 락 보존은 의도된 정책이지만, 공식 종료 증거(ego 프로세스 부재·operation.json의 ownerPid 종료 확인)와 별도 사용자 동의 하에 해당 `ego-profile-*` 락만 수동 정리하는 절차를 허용합니다. 명시된 UI `scan`은 인증·상태·ego 접근 전에 `UI_NOT_ACTIVATED`로 종료하며, scan 파이프라인(fingerprint 검사→필터 발견→lazy append 목록 순회→검토 필요 반환과 `ego-obs-` 네임스페이스 관측 기록)은 합성 검증까지 완료돼 G2 통과 뒤 가드 교체 한 줄로 활성화한다. 활성 전까지 항목은 상세 개방 없이 확정하지 않는다. setup은 온보딩 절차로 `/in/me`·`/messaging/` 관측에서 계정 slug·내 프로필 ID·구조 fingerprint를 확보하고 재관측 일치 시에만 binding을 저장합니다. `/messaging/` 접속의 부수 스레드 개방(읽음 영향 미확정)은 승인 설명에 명시하며 동의 없이는 진행하지 않습니다. 기존 `setup`·빈 입력 `scan`·`prepare`·`send`는 여전히 `linkedincli/1`입니다. binding·job·승인 영수증에 실행 경로 버전을 결합하며 다른 경로로 fallback하지 않습니다. 버전 없는 연결은 `NEEDS_SETUP`, 실행 경로가 다른 미사용 승인은 `APPROVAL_REQUIRED`로 중단합니다. 기존 `sending`·`unknown`·Aside 락(`ui-profile-*`)과 ego 락(`ego-profile-*`)은 보존합니다.

`inspect`는 Page 라벨 없는 스페이스 관리 Page 발견과 명시한 Page의 전체 snapshot만 지원합니다. 상세 열기·입력·클릭·API 호출은 없습니다. 실행 파일은 절대경로로 지정하고 스킬 전용 TaskSpace 이름을 명시합니다. 발견 결과에서 사용자가 확인한 관리 Page만 사용하며 첫 Page를 자동 선택하지 않습니다. `EGO_SPACE_NAME_IN_USE`는 사용자 소유 스페이스 충돌로 claim·listTaskSpaces 없이 종료하고, 관측 라운드에서 `finish`·`handOff`를 호출하지 않습니다. 이 인자 전달과 관측 성공은 LinkedIn 계정 확인의 증거가 아닙니다. `accountVerified:false`·`bindingSaved:false`를 반환하며 관측 원문은 상태에 저장하지 않습니다. UI 시험 중 구형 setup·인증 모듈·벤더 CLI로 넘어가지 않습니다.

- CLI에는 코드가 아니라 고정 작업을 보내고 target ID는 JSON 데이터로 삽입합니다. 메시지 본문·임의 코드·selector는 받지 않습니다.
- shell 없이 stdin을 사용하고 인증 토큰·debug·다른 daemon 주소·Node 설정을 상속하지 않습니다. CI 환경변수만으로 권한창 없는 실행을 보장하지 않습니다.
- credentials 없는 정확한 HTTPS `www.linkedin.com` origin의 `/messaging`·`/messaging/` 하위 경로를 허용하며 query·fragment만으로 제외하지 않습니다. 독립 REPL에 같은 URL 판정 함수를 전달하고 snapshot 전후에도 검사합니다. 발견 응답은 target ID·origin·목록/하위 경로 구분만 허용하며 원문 URL은 반환·저장·이동에 쓰지 않습니다. 탭·ref·page 변수를 호출 사이에 재사용하지 않습니다.
- snapshot 전체를 반환하며 자르거나 후보·전송 결과로 해석하지 않습니다. stdout·stderr는 각각 2 MiB, 부모 대기는 125초로 제한합니다. 원시 stderr는 버리고 UTF-8·JSON·응답 스키마를 검증합니다.
- 관측 전에 ego 실행 파일·TaskSpace 이름 해시의 디렉터리 락을 원자적으로 획득합니다. 새 락에는 작업 종류·시도 ID·시작 시각·로컬 PID만 기존 durable 쓰기로 기록하고 자식 실행 전에 디렉터리도 fsync합니다. 메타데이터 실패 시 자식을 시작하지 않고 락을 남깁니다. Page 라벨은 락 키에 넣지 않아 값 변경으로 우회할 수 없습니다. 무인 inspect와 잘못된 입력은 상태 쓰기 전에 거부합니다.
- 로그인·1Password는 사용자 전용입니다. 스킬은 1Password CLI·확장·브라우저 비밀번호를 읽거나 입력하지 않습니다. 로그인 필요 판정은 (a) 관측 최종 URL이 로그인·세션 만료 계열 경로(`/login`·`/authwall`·`/checkpoint` 등)이거나 (b) snapshot에 인증 폼 역할 구조가 관측될 때 `EGO_NEEDS_LOGIN`이며, 판정 불명은 `EGO_OUTCOME_UNKNOWN`입니다. 무인 회차는 `EGO_NEEDS_LOGIN` 반환 후 즉시 종료하며 재시도·`handOff`를 하지 않습니다. ego 앱 미실행·서비스 도달 실패로 추정되는 자식 실패는 `EGO_CONNECT_FAILED`로 보고하되 앱 미실행으로 단정하지 않습니다.
- 성공한 관측 뒤에만 ego 락을 해제합니다. timeout·크래시·출력 불명은 `EGO_OUTCOME_UNKNOWN`이며 알려진 대상/URL/형식 오류에서도 보수적으로 락을 남깁니다. SessionEnd·새 target·새 job·시간 경과로 해제하거나 탈취하지 않습니다. 자동 재시도하지 않으며 CLI 종료를 브라우저 작업 취소로 보지 않습니다.
- 실패는 원문 없는 `reason`으로 spawn·입출력·timeout·종료·연결 실패·출력 크기·UTF-8·JSON·스키마·스페이스·Page·URL·snapshot 단계를 구분합니다(`EGO_*`). ce-debug에서 확인한 오류 합침을 반복하지 않기 위해 허용 코드 목록을 어댑터와 runner 양쪽에 명시적으로 나열합니다. 이 코드는 과거 결과 불명의 원인을 소급하지 않으며 브라우저 작업 종료 증거도 아닙니다. 기존 빈 락은 소유 불명이고 공식 종료 증거와 별도 복구 동의 없이는 새 UI 호출을 차단합니다. 자동 해제 명령은 추가하지 않습니다.
- 실제 계층·선택 상태·읽음 부작용·안정적 ID를 관측하기 전에는 필터·기간·중복·미응답 경로를 활성화하지 않습니다. Focused의 읽음 전체와 Unread의 실제 부모 범위를 구별합니다. 조회 기능은 사용자 지정 기간을 지원하도록 구현하며 최근 2주는 이번 테스트 기준일 뿐 기본값·고정 기간·최대 조회 기간이 아닙니다. 실행·출력 제한으로 요청 기간을 다 확인하지 못해도 기간을 임의로 줄이지 않습니다. 정상 종료가 확인된 자료는 확인한 범위·남은 범위·중단 사유와 함께 `partial`로 보고하고, 브라우저 작업 종료가 불명이면 `UI_OUTCOME_UNKNOWN`과 락 유지가 우선입니다. 아직 UI 형식을 추측한 parser나 사용되지 않는 조회 정책 모듈은 만들지 않았습니다.
- 테스트는 합성 실행 파일이 stdin의 실제 작업을 VM의 페이지 대역에서 실행합니다. 실제 Aside stdout 포장·selector·식별자 호환성이나 사이트 부작용을 입증하지 않습니다. 실제 연결·목록 관측에 대한 별도 동의 전에는 실행하지 않습니다.

## 고정 CLI

출처는 `bcharleson/linkedincli`의 `88f775ef95c5b8ad1d3b6d1056f94ef92282b8bb`, 패키지는 `@bcharleson/linkedincli` 0.1.6(MIT)입니다.
`vendor/linkedincli/upstream`에 변경하지 않은 빌드 입력과 lock을 보존합니다. `safe-send.patch`는 쓰기 재시도 제거·stdin 본문을, `aside-cookies.patch`는 Chrome reader의 Aside 읽기 어댑터·공통 Cookie 헤더 생성·env 전달·import 시 CLI 실행 방지를 담당합니다.
Aside 어댑터는 기존 프로필 경계·읽기 전용 snapshot·DB 버전별 host digest·v10/v11 복호화 검사를 유지합니다. 원래 Chrome 경로의 전체 DB 복제·느슨한 도메인 검색·digest 추정은 Aside에서 실행하지 않습니다. API client와 요청 구성은 바꾸지 않습니다.
전체 헤더는 인증 자식이 생성한 `LINKEDIN_COOKIE_HEADER`로 고정 CLI 자식에만 전달하며 상속한 값은 폐기합니다. 필수 두 쿠키와의 일치·중복 이름·이름과 값의 헤더 안전성·64 KiB 상한을 검증합니다. 결과 비밀 검사는 모든 전달 쿠키에 적용하고 종료 시 참조를 정리합니다. JS 문자열의 완전한 삭제는 보장하지 않습니다.
upstream의 `redirect: manual`을 유지합니다. 요청 구성과 메시징 명령은 upstream 것을 사용하며 별도 Voyager client는 만들지 않습니다.
필요한 전체 CLI 소스만 보존하고 upstream의 테스트·개발 문서는 복제하지 않습니다. 포함된 다른 명령은 스킬 runner가 허용하지 않습니다.

`provenance.json`은 소스·lock·라이선스·패치·빌드·산출물 해시를 기록합니다. `scripts/cli.mjs`는 provenance 자체 해시와 각 파일 해시를 검증한 뒤 고정 자식을 실행합니다.
인증·Chrome import·debug·대체 HTTP transport·Node preload 설정을 상속하지 않습니다. 추가 CA 파일의 절대경로를 가리키는 기존 `NODE_EXTRA_CA_CERTS`만 인증 자식과 최종 CLI 자식까지 전달해 Node가 시작 시 읽도록 합니다. 경로를 고정하거나 인증서를 복사·설치하지 않으며 `NODE_OPTIONS`·프록시·`NODE_TLS_REJECT_UNAUTHORIZED`는 계속 제외합니다. 새 버전은 자동 갱신하지 않습니다.

다음 재현 빌드는 Node 24와 npm이 필요하며 lock의 의존성을 네트워크에서 받습니다. 소스 빌드·실행을 허가받은 유지보수 때만 사용합니다.
임시 디렉토리에서 `npm ci --ignore-scripts`와 고정 esbuild를 사용하고 산출물 해시가 기존 기록과 일치해야 저장합니다.

```bash
node "$SKILL_DIR/vendor/linkedincli/build.mjs"
```

출처·패치·의존성·번들이 바뀌면 해시 검증과 실제 산출물의 단일 POST 테스트를 다시 수행해야 합니다.

## 실환경 검증 — 별도 허가 필요

합성 테스트만으로 다음 검사를 통과했다고 보고하지 않습니다.

1. 선택한 Aside 프로필의 최초 수동 setup 전에 macOS 창에서 ‘항상 허용’을 선택하도록 안내합니다. 비밀번호는 OS 창에서만 입력하며, 공유 실행기 osascript에 해당 항목의 지속 접근을 허용하는 범위도 설명합니다. 스크립트는 버튼·ACL을 조작하지 않습니다.
2. 승인 직후 별도 helper의 UI 금지 조회를 통과해야 `/me`로 진행합니다. 표시된 실제 계정을 사용자에게 확인받은 뒤 UI 금지로 계정을 재조회하고 binding을 저장합니다. 취소·거절·일회 허용·timeout과 이후 키체인 잠금·권한 변경은 중단 사유입니다. 무인 실행에서 UI를 허용하거나 다른 키체인 도구로 대체하지 않습니다.
3. 허가된 read-only scan으로 `/me`·대화 목록·메시지 형식을 확인합니다. 원시 응답은 저장소에 저장하지 않고 식별자·본문을 합성 값으로 바꾼 fixture만 남깁니다.
4. 설치·업데이트 허가 후 새 세션에서 스킬과 PostToolUse·SessionEnd 훅 로드를 확인합니다.
5. Orca 등록·검증 실행은 일정·provider·workspace·prompt·활성 여부·run 범위의 동의 후에만 수행합니다.
6. 실제 회신은 사용자가 지정한 기존 대화와 정확한 본문으로 별도 전송 승인 후에만 수행하고 LinkedIn 화면에서 도착을 확인합니다.

2026-11-08 Personal(`Default`) 재로그인 후 두 쿠키 검사와 키체인의 승인용·UI 금지 조회가 통과했습니다. `/me`의 필드 이름과 자료형만 관측했으며 원시 응답이나 인증값은 저장하지 않았습니다. 관측한 계정 참조 형식을 합성 값으로 재현해 파서와 전송 직전 계정 검사를 수정했습니다. 수정 후 실제 재검증은 키체인 두 단계 뒤 CLI의 `AUTH_ERROR`로 중단됐습니다. 승인 직후 UI 없는 키체인 접근은 확인했지만 계정 연결·장기 지속 접근·대화 응답 호환성은 미검증입니다. binding·대화 조회·Orca 연동·실전 회신은 미실행이며 운영 가능 또는 전체 완료로 보고하지 않습니다. 이후 브라우저 로그인 영향에 대한 우려로 실계정 API·쿠키·키체인 접근을 중단했습니다. 전체 Cookie 헤더 전환은 합성 환경에서만 검증하며 인증 오류나 브라우저 로그아웃과의 인과관계는 확인하지 못했습니다.

2026-11-09 사용자 요청으로 읽기 테스트를 재개했습니다. 진단에서 Default 프로필 23개 쿠키의 복호화와 전체 헤더 생성을 확인했고, 사용자는 같은 시점에 Aside 브라우저가 로그인 상태라고 확인했습니다. 배포 CLI 진단의 `/me`는 `Session redirected by LinkedIn`(`AUTH_ERROR`)으로 중단됐고, 같은 헤더를 사용한 별도 요청은 상태 302에 Location이 요청과 동일한 URL이었습니다. 이 관측만으로 세션 만료·TLS 지문·사내 프록시 중 원인을 확정할 수 없습니다. 302는 해당 진단 요청에서 TLS 연결이 성립했다는 뜻이지, 정상 진입점의 자식 프로세스와 인증서 설정까지 같다는 증거는 아닙니다. TLS 지문 차단으로 단정했던 기록을 정정합니다. 탐지 회피 우회는 추가하지 않으며 upstream의 옵트인 curl-impersonate도 활성화하지 않습니다.

같은 날 로컬 설정 확인에서 기존 `NODE_EXTRA_CA_CERTS`가 사내 CA 파일을 가리키지만 스킬의 세 단계 환경 필터가 이를 제외한다는 사실을 확인했습니다. 네트워크 없는 Node 24.16.0 비교에서 이 변수의 전달 여부에 따라 사내 CA의 기본 신뢰 목록 포함 여부가 달랐습니다. 1.2.1은 기존 CA 경로를 자식 환경에 전달하도록 수정합니다. CA 누락은 확인했지만 앞선 인증 오류의 원인인지는 미확인입니다. 수정 후 사용자 허가로 정상 진입점의 `scan`을 실행해 `NEEDS_SETUP`을 확인했고, Default 프로필의 `setup`은 `CLI_FAILED`로 중단됐습니다. 계정 확인·binding 저장·대화 조회에는 도달하지 못했습니다. 이 일반 오류 코드만으로 인증서 검증 실패·HTTP 인증 오류·다른 CLI 실패를 구분할 수 없습니다. 추가 재시도와 별도 HTTP 진단은 하지 않았습니다. 추가 진단도 일반 진입점만 사용하며 인증 모듈·벤더 CLI 직접 호출과 비밀의 파일 저장은 허용하지 않습니다.
