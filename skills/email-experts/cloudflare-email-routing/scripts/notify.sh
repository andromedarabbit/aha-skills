#!/usr/bin/env bash
# notify.sh - 헬스체크 이상 통지. CF Email Sending 우선, 실패 시 Mailgun API 폴백.
#
# Usage: notify.sh --subject <제목> --body-file <본문 파일>
#
# 필요한 환경변수 (파일에 저장하지 않는다):
#   NOTIFY_FROM      발신 주소 (CF Email Sending이 허용하는 도메인의 주소)
#   NOTIFY_TO        수신 주소
#   MAILGUN_API_KEY  폴백용 (선택)
#   MAILGUN_DOMAIN   폴백용 발신 도메인 (선택)
#
# exit 0  통지 성공 (어느 경로든)
# exit 2  사용 오류·환경 변수 부재
# exit 3  두 경로 모두 실패 — 호출자가 카드를 CRITICAL로 표시한다

set -uo pipefail

SUBJECT=""
BODY_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --subject) SUBJECT="${2:-}"; shift 2 ;;
    --body-file) BODY_FILE="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0" >&2; exit 2 ;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$SUBJECT" && -f "$BODY_FILE" ]] || { echo "사용 오류: --subject 와 --body-file(존재하는 파일)이 필요하다" >&2; exit 2; }
[[ -n "${NOTIFY_FROM:-}" && -n "${NOTIFY_TO:-}" ]] || { echo "환경 오류: NOTIFY_FROM, NOTIFY_TO 필요" >&2; exit 2; }

BODY="$(cat "$BODY_FILE")"

send_cf() {
  command -v cf >/dev/null 2>&1 || return 1
  cf email-sending send \
    --from-address "$NOTIFY_FROM" \
    --to-address "$NOTIFY_TO" \
    --subject "$SUBJECT" \
    --text "$BODY" >/dev/null 2>&1
}

send_mailgun() {
  [[ -n "${MAILGUN_API_KEY:-}" && -n "${MAILGUN_DOMAIN:-}" ]] || return 1
  # 인증 값은 argv에 노출하지 않도록 stdin 설정으로 넘긴다
  printf 'user = "api:%s"\n' "$MAILGUN_API_KEY" | curl -sS --fail -K - \
    "https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages" \
    -F "from=${NOTIFY_FROM}" \
    -F "to=${NOTIFY_TO}" \
    -F "subject=${SUBJECT}" \
    -F "text=${BODY}" >/dev/null 2>&1
}

if send_cf; then
  echo "통지 완료: CF Email Sending"
  exit 0
fi
echo "CF Email Sending 실패 — Mailgun 폴백 시도" >&2

if send_mailgun; then
  echo "통지 완료: Mailgun 폴백"
  exit 0
fi

echo "통지 실패: CF·Mailgun 모두 실패" >&2
exit 3
