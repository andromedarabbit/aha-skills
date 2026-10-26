#!/usr/bin/env bash
# run.sh - cloudflare-email-routing 스크립트 회귀 테스트 (평문 bash 러너, stub PATH 주입).
# 외부 자격증명·네트워크를 쓰지 않는다. dig·cf·curl은 stub으로 대체하고, 응답은 STUB_* 환경변수로 주입한다.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$(cd "$HERE/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/cer-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# 개발자 셸의 Mailgun 자격증명이 테스트에 새어 들어가 실제 발송을 일으키지 않도록 먼저 제거한다
unset MAILGUN_API_KEY MAILGUN_DOMAIN NOTIFY_FROM NOTIFY_TO

PASS=0
FAIL=0
ZONE="example.com"

fail() {
  echo "FAIL: $1" >&2
  FAIL=$((FAIL + 1))
}

pass() {
  echo "ok: $1"
  PASS=$((PASS + 1))
}

# expect_exit <name> <want> <cmd...> — 종료 코드를 검사하고 출력은 $TMP/out 에 남긴다
expect_exit() {
  local name="$1" want="$2"
  shift 2
  local got=0
  "$@" >"$TMP/out" 2>"$TMP/err" || got=$?
  if [[ "$got" == "$want" ]]; then
    pass "$name (exit $got)"
  else
    fail "$name: exit $got, want $want — stderr: $(cat "$TMP/err")"
  fi
}

# expect_bounded_exit <name> <want> <cmd...> — 시간 안에 끝나는지도 본다. 무한 루프 회귀를 잡는다
run_bounded() {
  ("$@" >"$TMP/out" 2>"$TMP/err") &
  local pid=$! n=0 rc=0
  while kill -0 "$pid" 2>/dev/null; do
    sleep 0.2
    n=$((n + 1))
    if (( n > 40 )); then
      kill -9 "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      echo 124
      return 0
    fi
  done
  wait "$pid" || rc=$?
  echo "$rc"
}

expect_bounded_exit() {
  local name="$1" want="$2"
  shift 2
  local got
  got="$(run_bounded "$@")"
  if [[ "$got" == "$want" ]]; then
    pass "$name (exit $got)"
  elif [[ "$got" == 124 ]]; then
    fail "$name: 시간 초과(무한 루프 의심)"
  else
    fail "$name: exit $got, want $want — stderr: $(cat "$TMP/err")"
  fi
}

# expect_contains <name> <needle> — 직전 출력(stdout)에 needle이 있는지
expect_contains() {
  if grep -qF -- "$2" "$TMP/out"; then
    pass "$1"
  else
    fail "$1: '$2' 가 출력에 없다"
  fi
}

# expect_err_contains <name> <needle> — 직전 실행의 stderr에 needle이 있는지
expect_err_contains() {
  if grep -qF -- "$2" "$TMP/err"; then
    pass "$1"
  else
    fail "$1: '$2' 가 stderr에 없다"
  fi
}

# ---- stub: dig. STUB_* 가 설정돼 있으면 그 값을, 아니면 기준과 일치하는 기본값을 낸다 ----
STUB="$TMP/stub"
mkdir -p "$STUB"

cat >"$STUB/dig" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *"+comments"*SOA*) printf ';; ->>HEADER<<- opcode: QUERY, status: %s, id: 1\n' "${STUB_DNS_STATUS:-NOERROR}" ;;
  *"_dmarc."*) printf '%s\n' "${STUB_DMARC-"\"v=DMARC1; p=quarantine; rua=mailto:r@example.com\""}" ;;
  *"_domainkey."*) printf '%s\n' "${STUB_DKIM-"\"v=DKIM1; k=rsa; p=abc\""}" ;;
  *"MX"*) printf '%s\n' "${STUB_MX-$'10 mx1.example.net.\n20 mx2.example.net.'}" ;;
  *"TXT"*) printf '%s\n' "${STUB_SPF-"\"v=spf1 include:_spf.example.net -all\""}" ;;
esac
EOF

# ---- stub: cf (email-routing 조회와 email-sending send만 응답) ----
cat >"$STUB/cf" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *"settings get"*)
    [[ "${STUB_CF_SETTINGS_EXIT:-0}" == 0 ]] || { echo "401 Unauthorized" >&2; exit 1; }
    printf '{"enabled": %s}\n' "${STUB_CF_ENABLED-true}" ;;
  *"rules list-account"*)
    rules="${STUB_CF_RULES-}"
    [[ -n "$rules" ]] || rules='[{"name": "forward-all"}]'
    printf '%s\n' "$rules" ;;
  *"email-sending send"*)
    [[ "${STUB_CF_SEND_EXIT:-0}" == 0 ]] || { echo "error: sending not enabled for this account" >&2; exit 1; }
    echo "sent via cf" >>"${STUB_LOG:-/dev/null}" ;;
  *) exit 1 ;;
esac
EOF

# ---- stub: curl (Mailgun 폴백). 호출 사실만 기록한다 ----
cat >"$STUB/curl" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
echo "curl called" >>"${STUB_LOG:-/dev/null}"
exit "${STUB_CURL_EXIT:-0}"
EOF

chmod +x "$STUB/dig" "$STUB/cf" "$STUB/curl"
export STUB_LOG="$TMP/stub.log"
: >"$STUB_LOG"

# ---- fixture: baseline (example.com 가상 값) ----
cat >"$TMP/baseline.json" <<'EOF'
{
  "zone": "example.com",
  "dmarc": {"policy": "quarantine"},
  "spf": "v=spf1 include:_spf.example.net -all",
  "dkim": {"selector": "selector1"},
  "mx": ["mx2.example.net", "mx1.example.net"],
  "routing": {"enabled": true, "rule_count": 1}
}
EOF

export PATH="$STUB:$PATH"
HC="$SCRIPTS/healthcheck.sh"
NT="$SCRIPTS/notify.sh"
DR="$SCRIPTS/dmarc_report.py"

# ================= 헬스체크 =================

# 기준 일치 → exit 0
expect_exit "헬스체크: 기준 일치" 0 bash "$HC" --zone "$ZONE" --baseline "$TMP/baseline.json"
expect_contains "헬스체크: 요약 라인" "정상 7건 / 이상 0건"

# C1: _dmarc 중복 → 실패
expect_exit "C1: _dmarc 중복이면 실패" 1 env STUB_DMARC=$'"v=DMARC1; p=quarantine; rua=mailto:r@example.com"\n"v=DMARC1; p=none"' bash "$HC" --zone "$ZONE" --baseline "$TMP/baseline.json"
expect_contains "C1: 실패 표시" "❌"

# C2: 정책 불일치, rua 누락 → 실패
expect_exit "C2: 정책이 기준과 다르면 실패" 1 env STUB_DMARC='"v=DMARC1; p=none; rua=mailto:r@example.com"' bash "$HC" --zone "$ZONE" --baseline "$TMP/baseline.json"
expect_contains "C2: 실제 정책이 표에 보인다" "p=none"
expect_exit "C2: rua 누락이면 실패" 1 env STUB_DMARC='"v=DMARC1; p=quarantine"' bash "$HC" --zone "$ZONE" --baseline "$TMP/baseline.json"

# C3: 다중 SPF → 실패. 체인 TXT 조각은 하나의 값으로 이어져 기준과 일치해야 한다
expect_exit "C3: SPF 레코드가 둘이면 실패" 1 env STUB_SPF=$'"v=spf1 include:_spf.example.net -all"\n"v=spf1 -all"' bash "$HC" --zone "$ZONE" --baseline "$TMP/baseline.json"
expect_exit "C3: 조각난 SPF TXT는 같은 값으로 본다" 0 env STUB_SPF='"v=spf1 include:_spf.example.net " "-all"' bash "$HC" --zone "$ZONE" --baseline "$TMP/baseline.json"

# C4: DKIM 셀렉터 없음 → 실패
expect_exit "C4: DKIM 레코드가 없으면 실패" 1 env STUB_DKIM="" bash "$HC" --zone "$ZONE" --baseline "$TMP/baseline.json"

# C5: MX 불일치 → 실패
expect_exit "C5: MX가 기준과 다르면 실패" 1 env STUB_MX=$'10 other.example.net.' bash "$HC" --zone "$ZONE" --baseline "$TMP/baseline.json"

# C6: 비활성은 조회 실패(exit 2)가 아니라 실패(exit 1)다
expect_exit "C6: Email Routing 비활성은 실패로 판정" 1 env STUB_CF_ENABLED=false bash "$HC" --zone "$ZONE" --baseline "$TMP/baseline.json"
expect_contains "C6: 비활성 상태가 표에 보인다" "enabled=false"
expect_exit "C6: 규칙 수 불일치는 실패" 1 env STUB_CF_RULES='[]' bash "$HC" --zone "$ZONE" --baseline "$TMP/baseline.json"
expect_exit "C6: cf 조회 실패는 환경 오류(exit 2)" 2 env STUB_CF_SETTINGS_EXIT=1 bash "$HC" --zone "$ZONE" --baseline "$TMP/baseline.json"

# cf 없음 → 환경 오류, dig 결과는 계속 보고
mkdir -p "$TMP/nocf"
cp "$STUB/dig" "$TMP/nocf/dig"
for tool in bash jq awk sed sort paste grep head tr mktemp cat rm; do
  p="$(command -v "$tool" 2>/dev/null || true)"
  [[ -n "$p" ]] && ln -sf "$p" "$TMP/nocf/$tool"
done
expect_exit "헬스체크: cf 부재는 환경 오류" 2 env PATH="$TMP/nocf" bash "$HC" --zone "$ZONE" --baseline "$TMP/baseline.json"
expect_contains "헬스체크: dig 체크는 계속 보고" "_dmarc TXT 개수"

# 인자 값 누락 → 무한 루프 없이 exit 2
expect_bounded_exit "헬스체크: --zone 값 누락" 2 bash "$HC" --zone
expect_bounded_exit "헬스체크: --baseline 값 누락" 2 bash "$HC" --zone "$ZONE" --baseline

# DNS 실패(SERVFAIL) → 빈 결과를 실패로 판정하지 않고 exit 2
expect_exit "헬스체크: DNS SERVFAIL은 환경 오류" 2 env STUB_DNS_STATUS=SERVFAIL bash "$HC" --zone "$ZONE" --baseline "$TMP/baseline.json"
expect_err_contains "헬스체크: DNS 실패 사유 표시" "DNS 조회 실패"

# --md-out 쓰기 실패 → exit 2
expect_exit "헬스체크: --md-out 쓰기 실패는 exit 2" 2 bash "$HC" --zone "$ZONE" --baseline "$TMP/baseline.json" --md-out "$TMP/no-such-dir/x.md"

# baseline 불량, zone 불일치 → exit 2
echo '{"zone": "example.com"}' >"$TMP/bad.json"
expect_exit "헬스체크: baseline 스키마 불일치" 2 bash "$HC" --zone "$ZONE" --baseline "$TMP/bad.json"
expect_exit "헬스체크: baseline.zone 불일치" 2 bash "$HC" --zone "other.example" --baseline "$TMP/baseline.json"

# 환경 오류도 --md-out 에 사유가 남는다 (알림 본문이 없는 실패 방지)
expect_exit "헬스체크: 환경 오류 + --md-out" 2 bash "$HC" --zone "$ZONE" --baseline "$TMP/bad.json" --md-out "$TMP/md.txt"
if grep -qF "환경 오류" "$TMP/md.txt" 2>/dev/null; then pass "헬스체크: 환경 오류 사유가 md 파일에 남는다"; else fail "헬스체크: md 파일에 환경 오류 사유가 없다"; fi

# ================= 통지 =================

printf '본문\n' >"$TMP/body.txt"

# 값 누락, 필수 환경변수 부재 → exit 2
expect_bounded_exit "통지: --subject 값 누락" 2 bash "$NT" --subject
expect_exit "통지: NOTIFY_* 부재" 2 env -u NOTIFY_FROM -u NOTIFY_TO bash "$NT" --subject "t" --body-file "$TMP/body.txt"

# dry-run: 발송 명령이 실행되지 않는다
: >"$STUB_LOG"
expect_exit "통지: dry-run" 0 env NOTIFY_FROM=a@example.com NOTIFY_TO=b@example.com bash "$NT" --subject "t" --body-file "$TMP/body.txt" --dry-run
expect_contains "통지: dry-run 안내" "dry-run: 발송하지 않는다"
if [[ -s "$STUB_LOG" ]]; then fail "통지: dry-run이 실제로 발송했다"; else pass "통지: dry-run은 발송하지 않았다"; fi

# CF 성공 → exit 0, Mailgun 호출 없음
: >"$STUB_LOG"
expect_exit "통지: CF Email Sending 성공" 0 env NOTIFY_FROM=a@example.com NOTIFY_TO=b@example.com bash "$NT" --subject "t" --body-file "$TMP/body.txt"
if grep -q "curl called" "$STUB_LOG"; then fail "통지: CF 성공인데 Mailgun을 호출했다"; else pass "통지: CF 성공 시 Mailgun을 쓰지 않는다"; fi

# CF 실패 + Mailgun 자격증명 없음 → exit 3, 원인이 stderr에 남는다
expect_exit "통지: 두 경로 모두 실패" 3 env NOTIFY_FROM=a@example.com NOTIFY_TO=b@example.com STUB_CF_SEND_EXIT=1 bash "$NT" --subject "t" --body-file "$TMP/body.txt"
expect_err_contains "통지: CF 실패 원인이 stderr에 남는다" "CF 실패: error: sending not enabled"

# CF 실패 + Mailgun 성공 → exit 0 (폴백)
: >"$STUB_LOG"
expect_exit "통지: Mailgun 폴백 성공" 0 env NOTIFY_FROM=a@example.com NOTIFY_TO=b@example.com STUB_CF_SEND_EXIT=1 MAILGUN_API_KEY=k MAILGUN_DOMAIN=mg.example.com bash "$NT" --subject "t" --body-file "$TMP/body.txt"
expect_contains "통지: 폴백 완료 표시" "Mailgun 폴백"
if grep -q "curl called" "$STUB_LOG"; then pass "통지: 폴백에서 Mailgun을 호출했다"; else fail "통지: 폴백인데 Mailgun을 호출하지 않았다"; fi

# CF 실패 + Mailgun 실패 → exit 3
expect_exit "통지: Mailgun도 실패하면 exit 3" 3 env NOTIFY_FROM=a@example.com NOTIFY_TO=b@example.com STUB_CF_SEND_EXIT=1 STUB_CURL_EXIT=22 MAILGUN_API_KEY=k MAILGUN_DOMAIN=mg.example.com bash "$NT" --subject "t" --body-file "$TMP/body.txt"

# ================= DMARC 집계 =================

mkdir -p "$TMP/rep_ok" "$TMP/rep_mixed" "$TMP/rep_bad" "$TMP/empty"

# 정상 리포트: 기간은 report_metadata/date_range/begin (2026-01-01 KST), 메시지 3통
cat >"$TMP/good.xml" <<'EOF'
<?xml version="1.0"?>
<feedback>
  <report_metadata>
    <org_name>google.com</org_name>
    <date_range><begin>1767225600</begin><end>1767311999</end></date_range>
  </report_metadata>
  <record>
    <row><source_ip>203.0.113.7</source_ip><count>3</count>
      <policy_evaluated><disposition>none</disposition><dkim>fail</dkim><spf>fail</spf></policy_evaluated></row>
    <identifiers><header_from>example.com</header_from></identifiers>
  </record>
</feedback>
EOF
gzip -c "$TMP/good.xml" >"$TMP/rep_ok/google.com!example.com!1767225600!1767311999.xml.gz"
expect_exit "DMARC: 정상 아카이브" 0 python3 "$DR" "$TMP/rep_ok"
expect_contains "DMARC: 기간이 report_metadata에서 와서 날짜가 맞다" "- 2026-01-01: 3통"
expect_contains "DMARC: 리포트 1개로 집계" "리포트 1개"
expect_contains "DMARC: 전부 실패 판별" "사칭 캠페인 후보"
expect_contains "DMARC: 메시지 합계" "메시지 총 3통"

# 부분 실패: 같은 파일의 첫 레코드는 정상, 둘째 레코드는 count 누락 → 파일 전체 제외
cat >"$TMP/partial.xml" <<'EOF'
<?xml version="1.0"?>
<feedback>
  <report_metadata>
    <org_name>yahoo.com</org_name>
    <date_range><begin>1767225600</begin><end>1767311999</end></date_range>
  </report_metadata>
  <record>
    <row><source_ip>198.51.100.9</source_ip><count>5</count>
      <policy_evaluated><disposition>none</disposition><dkim>fail</dkim><spf>fail</spf></policy_evaluated></row>
  </record>
  <record>
    <row><source_ip>198.51.100.10</source_ip>
      <policy_evaluated><disposition>none</disposition><dkim>fail</dkim><spf>fail</spf></policy_evaluated></row>
  </record>
</feedback>
EOF
cp "$TMP/good.xml" "$TMP/rep_mixed/google.xml"
cp "$TMP/partial.xml" "$TMP/rep_mixed/yahoo.xml"
expect_exit "DMARC: 실패 파일이 섞이면 exit 3" 3 python3 "$DR" "$TMP/rep_mixed"
expect_contains "DMARC: 실패 파일은 집계에서 제외된다" "메시지 총 3통"
expect_contains "DMARC: 제외된 파일 이름을 보고" "실패한 파일 1개는 집계에서 제외"
if grep -q "198.51.100" "$TMP/out"; then fail "DMARC: 실패 파일의 앞 레코드가 집계에 섞였다"; else pass "DMARC: 실패 파일의 앞 레코드가 집계에서 빠졌다"; fi

# 실패 파일만 있으면 exit 3 (출력 없음)
cp "$TMP/partial.xml" "$TMP/rep_bad/yahoo.xml"
expect_exit "DMARC: 실패 파일만 있으면 exit 3" 3 python3 "$DR" "$TMP/rep_bad"

# 리포트 없음 → exit 1
expect_exit "DMARC: 리포트 없음" 1 python3 "$DR" "$TMP/empty"

echo
echo "결과: 통과 $PASS / 실패 $FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
