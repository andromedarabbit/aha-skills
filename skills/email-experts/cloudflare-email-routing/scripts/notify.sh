#!/usr/bin/env bash
# notify.sh - 헬스체크 이상 통지. 발송 수단은 cf(CF Email Sending) · himalaya · mailgun 중 하나를 고른다.
#
# Usage: notify.sh --subject <제목> --body-file <본문 파일> [--dry-run]
#
# 필요한 환경변수 (파일에 저장하지 않는다):
#   NOTIFY_FROM              발신 주소
#   NOTIFY_TO                수신 주소 (운영자 본인 주소로만 둔다 — 무인 통지의 수신처)
#   NOTIFY_SENDER            발송 수단: cf | himalaya | mailgun. 비우면 mailgun 을 쓴다 (himalaya 는 자동 선택하지 않는다)
#   NOTIFY_CF_ENABLED        1 이면 NOTIFY_SENDER 를 비웠을 때 cf 를 먼저 쓴다 (기존 호환, 유료)
#   NOTIFY_HIMALAYA_ACCOUNT  himalaya 계정 이름 (비우면 기본 계정)
#   MAILGUN_API_KEY          mailgun 발송용
#   MAILGUN_DOMAIN           mailgun 발신 도메인
#
# 순서: NOTIFY_SENDER 가 있으면 그것, 없으면 NOTIFY_CF_ENABLED=1 일 때 cf. 마지막은 항상 mailgun.
# --dry-run 은 실제 발송 없이 순서와 명령만 출력한다.
#
# exit 0  통지 성공 (어느 경로든) 또는 dry-run 완료
# exit 2  사용 오류·환경 변수 부재
# exit 3  모든 경로 실패 — 호출자가 카드를 CRITICAL로 표시한다

set -uo pipefail

SUBJECT=""
BODY_FILE=""
DRY_RUN=false

need_value() {
  [[ $# -ge 2 ]] || { echo "사용 오류: $1 에 값이 필요하다" >&2; exit 2; }
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --subject) need_value "$@"; SUBJECT="$2"; shift 2 ;;
    --body-file) need_value "$@"; BODY_FILE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) sed -n '2,20p' "$0" >&2; exit 2 ;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$SUBJECT" && -f "$BODY_FILE" ]] || { echo "사용 오류: --subject 와 --body-file(존재하는 파일)이 필요하다" >&2; exit 2; }
[[ -n "${NOTIFY_FROM:-}" && -n "${NOTIFY_TO:-}" ]] || { echo "환경 오류: NOTIFY_FROM, NOTIFY_TO 필요" >&2; exit 2; }

case "${NOTIFY_SENDER:-}" in
  ""|cf|himalaya|mailgun) ;;
  *) echo "사용 오류: NOTIFY_SENDER 는 cf|himalaya|mailgun 중 하나여야 한다" >&2; exit 2 ;;
esac

BODY="$(cat "$BODY_FILE")"

# 발송 순서를 공백으로 구분한 문자열로 만든다. 배열은 빈 상태의 확장이 bash 3.2 의 set -u 에 걸리므로 쓰지 않는다
ORDER=""
if [[ -n "${NOTIFY_SENDER:-}" ]]; then
  ORDER="$NOTIFY_SENDER"
elif [[ "${NOTIFY_CF_ENABLED:-0}" == 1 ]]; then
  ORDER=cf
fi
case " $ORDER " in
  *" mailgun "*) ;;
  *) ORDER="${ORDER:+$ORDER }mailgun" ;;
esac

# 실패 원인은 버리지 않고 마지막 줄만 호출자에게 보여준다 (인증·권한 오류 식별용)
send_cf() {
  command -v cf >/dev/null 2>&1 || { echo "CF: cf 명령 없음" >&2; return 1; }
  local err
  # 발송 호출에도 시간 상한을 둔다 (CF_TIMEOUT_SECS, 기본 60초). 초과는 실패로 보고 다음 경로로 넘어간다
  err="$(perl -e 'alarm shift; exec @ARGV' "${CF_TIMEOUT_SECS:-60}" cf email-sending send \
    --from-address "$NOTIFY_FROM" \
    --to-address "$NOTIFY_TO" \
    --subject "$SUBJECT" \
    --text "$BODY" 2>&1 >/dev/null)" && return 0
  echo "CF 실패: $(tail -1 <<<"$err")" >&2
  return 1
}

# 로컬 himalaya 로 보낸다. 메시지는 stdin 으로 넘기고, 제목은 UTF-8 RFC 2047 로 인코딩한다
send_himalaya() {
  command -v himalaya >/dev/null 2>&1 || { echo "himalaya: 명령 없음" >&2; return 1; }
  local enc err
  enc="=?UTF-8?B?$(printf '%s' "$SUBJECT" | base64 | tr -d '\n')?="
  err="$(printf 'From: %s\nTo: %s\nSubject: %s\nMIME-Version: 1.0\nContent-Type: text/plain; charset=UTF-8\nContent-Transfer-Encoding: 8bit\n\n%s\n' \
    "$NOTIFY_FROM" "$NOTIFY_TO" "$enc" "$BODY" \
    | himalaya message send ${NOTIFY_HIMALAYA_ACCOUNT:+-a "$NOTIFY_HIMALAYA_ACCOUNT"} 2>&1 >/dev/null)" && return 0
  echo "himalaya 실패: $(tail -1 <<<"$err")" >&2
  return 1
}

send_mailgun() {
  [[ -n "${MAILGUN_API_KEY:-}" && -n "${MAILGUN_DOMAIN:-}" ]] || { echo "Mailgun: MAILGUN_API_KEY/MAILGUN_DOMAIN 없음" >&2; return 1; }
  # 인증 값은 argv에 노출하지 않도록 stdin 설정으로 넘긴다. 연결·전체 시간에 상한을 둔다
  printf 'user = "api:%s"\n' "$MAILGUN_API_KEY" | curl -sS --fail --connect-timeout 10 --max-time 30 -K - \
    "https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages" \
    -F "from=${NOTIFY_FROM}" \
    -F "to=${NOTIFY_TO}" \
    --form-string "subject=${SUBJECT}" \
    --form-string "text=${BODY}" >/dev/null
}

if [[ "$DRY_RUN" == true ]]; then
  echo "dry-run: 발송하지 않는다"
  echo "  순서: $ORDER"
  echo "  cf: cf email-sending send --from-address <NOTIFY_FROM> --to-address <NOTIFY_TO> --subject \"$SUBJECT\" --text <본문 ${#BODY}자>"
  echo "  himalaya: himalaya message send${NOTIFY_HIMALAYA_ACCOUNT:+ -a $NOTIFY_HIMALAYA_ACCOUNT} (메시지는 stdin)"
  echo "  mailgun: MAILGUN_API_KEY=$([[ -n "${MAILGUN_API_KEY:-}" ]] && echo 설정 || echo 없음), MAILGUN_DOMAIN=$([[ -n "${MAILGUN_DOMAIN:-}" ]] && echo 설정 || echo 없음)"
  exit 0
fi

for s in $ORDER; do
  ok=0
  case "$s" in
    cf) send_cf && ok=1 ;;
    himalaya) send_himalaya && ok=1 ;;
    mailgun) send_mailgun && ok=1 ;;
  esac
  if [[ $ok -eq 1 ]]; then
    echo "통지 완료: $s"
    exit 0
  fi
  echo "$s 실패 — 다음 경로 시도" >&2
done

echo "통지 실패: 모든 경로 실패" >&2
if command -v himalaya >/dev/null 2>&1; then
  echo "힌트: 로컬 himalaya 가 설치돼 있다. 사용자 승인 후 NOTIFY_SENDER=himalaya 로 다시 실행한다" >&2
fi
exit 3
