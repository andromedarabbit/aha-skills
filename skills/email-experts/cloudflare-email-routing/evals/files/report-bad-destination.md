# 이메일 주간 보고 — example.com (2026-01-05)

## 헬스체크 (C1~C8)
기준: baseline captured_at=2026-01-01

| 체크 | 항목 | 기대값 | 실제값 | 결과 |
|---|---|---|---|---|
| C1~C8 | 전체 | 정상 | 정상 | ✅ |

요약: 정상 8건 / 이상 0건

## 수신 실패 (최근 7일)
기간: 2025-12-29 00:00 ~ 2026-01-05 00:00 UTC

| 유형 | 이벤트 | 메시지 | 회복 | 미배달 | 대표 사유 | 발신 도메인 상위 3 | 판정 |
|---|---:|---:|---:|---:|---|---|---|
| 인증 거부(Unauthenticated) | 12 | 12 | 0 | 12 | Cannot forward emails that are not authenticated. | mail.example.net | 규칙 분류 |
| 목적지 문제 | 2 | 2 | 0 | 2 | Gmail (550): 5.1.1 The email account that you tried to reach does not exist. | friend.example.com, shop.example.org | 확인 필요 |
