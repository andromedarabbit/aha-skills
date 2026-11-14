# CHANGELOG — social-posting

## 0.9.2 (2026-11-14)

- 테스트용 ego 응답 stub이 stdin을 끝까지 소비한 뒤 출력·종료하도록 수정한다. Linux에서 입력 파이프가 먼저 닫혀 `EGO_STDIN_FAILED`로 실패하던 경합을 제거한다
- 큰 stdin 입력과 조기 입력 단절 회귀 테스트를 추가한다. 실제 실행 계층의 입력 오류 차단과 `POST_UNKNOWN` 계약은 유지한다
- macOS·Node 26 및 Linux·Node 24에서 회귀를 검증한다. 실제 플랫폼 게시 동작은 변경하지 않는다

## 0.9.1 (2026-11-14)

- 게시 확정 수와 URL 회수를 분리하고, 클릭 후 결과 불명은 `POST_UNKNOWN`으로 보고해 재시도를 막는다. exit 1의 부분 게시 JSON도 publish.sh가 보존한다
- Facebook 숫자 프로필 ID, X 신원 폴링, PATH 실행파일 발견, X·Bluesky 절대 URL 답글 체인을 수정한다
- URL은 전체 정규화 본문이 일치하는 후보 하나일 때만 회수한다. 같은 도입부의 과거 글과 중복 후보를 거부해 잘못된 답글 부모 선택을 막는다
- LinkedIn 대체 에디터의 성공 판정, 미디어 alt 적용·검증, 대상 게시물 단위 read-back을 보강한다
- 최종 본문의 링크까지 길이를 검사하고 Node 누락 시 테스트 러너를 즉시 실패시킨다. 실제 주입 스크립트와 실패 경로의 회귀 테스트를 추가한다
- Stage 2를 플랫폼 선택 후 신원 확인 순서로 나누고, 이전 Aside 자동 허용 권한의 별도 승인·회수 절차를 명시한다. 사용자 설정은 자동 변경하지 않는다
- 실계정 게시·미디어 UI 실측은 수행하지 않았다. 플랫폼 DOM 셀렉터는 실환경 확인이 필요하다

## 0.9.0 (2026-11-14)

- 게시 실행 계층을 aside → **ego lite(ego-browser)**로 교체 — `ego-post.mjs`(setup·bootstrap·post·readback 고정 스크립트 실행 계층) 신설. 게시 성공 판정을 aside 출력 URL 감지에서 **ego DOM 증거 판정**으로 반전: `POSTED`+`urlRecovered:false`는 게시 성립으로 exit 0(중복 게시 재시도 차단), 부분 게시는 `PARTIAL_POSTED` exit 1(재시도 금지)
- 계정 모델 단순화: aside 프로필(u0/u1)·권한 rules 엔진 제거 → ego lite 로그인 프로필 1개 + 플랫폼별 신원 바인딩(`binding.json`). 게시 전 라이브 신원 대조(`EGO_ACCOUNT_MISMATCH`)로 계정 재타깃 이중 차단
- 병렬 게시 폐지 — 플랫폼별 순차 전경 호출(ego는 전부 브라우저 UI, 병렬 경합 실측 손해). 감시 루프 삭제(ego-post 자체 상한 타임아웃, 세그먼트×60초+120초·최대 570초)
- `aside-permissions.sh`·권한 일괄 허용 문항 삭제(ego에 권한 엔진 없음 — 승인 영수증·6중 가드가 안전장치). preflight `aside.*` 블록 → `ego.*`(binding 포함). 훅 매처 `Bash(aside *)` → `Bash(*ego-post.mjs*)`
- 테스트: `ego-post.test.mjs` 24건(프로세스 계약·CLI end-to-end·금지 API 스캔) 신설, publish/preflight 테스트를 `SOCIAL_EGO_POST` 심 계약으로 재작성
- **플랫폼 DOM 셀렉터는 첫 실측 전 보수적 추정** — 첫 실환경 게시는 측정으로 취급해 기명 실패 코드로 셀렉터를 교정한다

## 0.8.0 (2026-10)

(엔트리 누락 분 백필) 인프라 현대화 — 훅 등록을 카테고리 hooks.json으로 이관(frontmatter 훅 미발동 실측 수용), 파이썬 진입점을 uv 스크립트(PEP 723) 방식으로 전환. 게시 기능 변화 없음 — 세부는 git history(7c990e0·fef97ce) 참조

## 0.7.0 (2026-09-02)

- grant에 동의 토큰(`SOCIAL_PERMISSION_GRANT=1`) — Stage 2 '일괄 허용' 동의를 산문 계약이 아니라 코드로 강제
- 비교를 exact 매칭으로 통일 — host가 붙은 사용자 소유 ask/deny/allow 규칙을 절대 대체·제거하지 않고 보존
- `revoke` 서브커맨드 — 부여했던 필수 규칙만 회수(ask/deny·사용자 규칙 불가침)
- `receipt_set`/`receipt_set_json`에 mkdir 락 — 병렬 게시의 `posted_*` 기록이 lost update 되지 않게
- `repl_write` 페이로드 객체 재검증 — JS 삽입 방어
- 브라우저+브라우저 병렬 미실측 해소(2026-09-01 실측: 이득 없음)·network↔browser 제한 미검증을 문서화

## 0.6.0 (2026-09-01)

- 플랫폼별 병렬 게시(실행 형태·종료 코드 회수 계약 포함), `SOCIAL_ASIDE_TIMEOUT` 기본 420초, 동의 문구에 전역 browser 부여 명시, Stage 10 read-back 순차 경계
- grant 정규화 수정 — aside가 저장 시 browser 규칙의 `host`를 제거하는 실측 스키마에 맞춤

## 0.5.0 (2026-09-01)

- aside 권한 1회 일괄 허용 바인딩(`aside-permissions.sh`·preflight `aside.permissions`·Stage 2 동의 문항)
