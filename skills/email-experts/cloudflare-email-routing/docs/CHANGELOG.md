# 변경 이력

## 0.1.0 — 2026-10-25

- 최초 릴리스. 모드 4종(인시던트·온보딩·헬스체크·리포트 분석)과 쓰기 게이트 규약.
- `healthcheck.sh` (C1~C7, dig 우선, cf 보조), `dmarc_report.py` (stdlib 집계), `notify.sh` (CF 우선, Mailgun 폴백).
- 기준값은 `assets/baseline-schema.json` 파라미터로만 받는다. 스킬 파일에 실측값을 넣지 않는다.
- 리서치 R1~R10 결과를 `docs/REFERENCE.md` 5절에 기록. R1(Email Sending 활성)은 권한 부족으로 미확정, R9 발송 드라이런은 보류.
