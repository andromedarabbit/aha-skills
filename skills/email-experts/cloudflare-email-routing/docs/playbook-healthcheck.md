# 플레이북: 헬스체크 (모드 C)

무인 실행 계약이다. 프롬프트 첫 줄이 `무인 실행:`으로 시작하면 이 절차만 따른다. 읽기 전용이며 질문하지 않는다.

## 입력

- `zone`: 점검 대상 도메인 (필수)
- `baseline`: `assets/baseline-schema.json` 형식의 JSON 파일 경로 (필수). 없으면 중단하고 exit 2로 보고한다.

## 실행

```bash
bash "$SKILL_DIR/scripts/healthcheck.sh" --zone <zone> --baseline <baseline.json> --md-out <경로>
echo "EXIT=$?"
```

- 명령은 **정확히 1회** 실행한다. 내부 재시도·이중 실행을 하지 않는다.
- 종료 코드를 `EXIT=$?`로 읽고 아래 표에 따라 행동한다.

## 체크 목록

| ID | 항목 | 판정 |
|---|---|---|
| C1 | `_dmarc` TXT 개수 == 1 | 중복이면 실패 (마법사 회귀) |
| C2 | DMARC 정책 == baseline `dmarc.policy`, `rua=` 존재 | 불일치면 실패 |
| C3 | SPF TXT == baseline `spf` (단일 레코드) | 불일치·중복이면 실패 |
| C4 | `<selector>._domainkey` TXT 존재 (셀렉터는 baseline `dkim.selector`) | 없으면 실패 |
| C5 | MX 집합 == baseline `mx` (정렬 비교) | 불일치면 실패 |
| C6 | Email Routing 활성 + 규칙 수 == baseline `routing.rule_count` | cf 조회 실패는 환경 오류 |
| C7 | 드리프트 요약 — C2~C6 중 기준과 다른 항목 수 | 1개 이상이면 실패 |

## 종료 코드와 통지

```text
exit 0 → 카드 코멘트만: "정상: 7 체크 통과" (통지 없음)
exit 1 → 카드 코멘트 + notify.sh --subject "[email 점검] 이상 N건" --body-file <md>
         → notify.sh exit 0: 완료 기록
         → notify.sh exit 3: 카드 CRITICAL 마킹 (다음 attended 세션에서 처리)
exit 2 → 환경 오류 보고 (dig 체크 결과 포함) + notify.sh 동일 절차
```

`notify.sh`에는 `NOTIFY_FROM`, `NOTIFY_TO`, 선택적으로 `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`이 환경에 있어야 한다. 값이 없으면 exit 2로 실패하고 그 사실을 카드에 적는다. 값을 프롬프트나 카드에 쓰지 않는다.

## 카드 코멘트 형식

```text
[cloudflare-email-routing 월간 점검] YYYY-MM-DD
- C1~C7: ✅/❌/⚠️ (기준: baseline captured_at=YYYY-MM-DD)
- 요약: 정상 N건 / 이상 M건
- exit=N
```

`healthcheck.sh`의 `--md-out` 결과 표를 그대로 붙인다. 항목별 실제값이 카드에 들어가므로, 카드 공개 범위가 넓으면 실제값이 민감하지 않은지 먼저 확인한다.

## 금지

- 쓰기 명령 실행: `cf dns records update|delete`, `cf email-routing enable|disable|settings update`, `cf email-sending send`
- baseline 자동 갱신 — 기준은 사람이 바꾼다
- Gmail 접근
- 실패 항목을 조용히 무시하는 것 — 모든 실패는 카드에 남는다

## 등록 절차 (사람이 수행)

1. `orca automations create --name "email-healthcheck" --trigger "0 9 3 * *" --provider claude --repo <repo> --disabled --prompt "<무인 프롬프트>"`
2. `orca automations run <id>`로 attended 수동 1회 실행 → 카드와 통지 경로 확인
3. 사용자 승인 후 활성화

예시 cron(매월 3일 09:00)은 승인 단계에서 확정한다.
