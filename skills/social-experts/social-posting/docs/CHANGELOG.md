# CHANGELOG — social-posting

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
