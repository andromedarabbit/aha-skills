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
| 인증 거부(Unauthenticated) | 40 | 31 | 0 | 31 | Cannot forward emails that are not authenticated. | mail.example.net, bulk.example.org, relay.example.com | 규칙 분류 |
| Gmail 스팸 거절 | 3 | 3 | 0 | 3 | Gmail (550): 5.7.1 [<IP>] Gmail has detected that this message is likely unsolicited mail. To reduce the amount of spam sent to Gmail, this message has been blocked. | promo.example.org, newsletter.example.com, billing.example.net | 확인 필요 |
| Gmail DMARC 정책 거절 | 1 | 1 | 0 | 1 | Gmail (550): 5.7.26 Unauthenticated email from <domain> is not accepted due to domain's DMARC policy. | alerts.example.com | 확인 필요 |
| Gmail 전송 한도(동일 Message-ID) | 4 | 2 | 1 | 1 | Gmail (421): 4.7.28 exceeded its quota for sending messages with the same Message-ID. | news.example.org | 규칙 분류 |
| 미분류 | 1 | 1 | 0 | 1 | brand new failure text | - | 확인 필요 |
