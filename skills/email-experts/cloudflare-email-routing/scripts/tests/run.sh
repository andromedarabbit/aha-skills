#!/usr/bin/env bash
# run.sh - cloudflare-email-routing 스크립트 회귀 테스트 (평문 bash 러너, stub PATH 주입).
# 외부 자격증명·네트워크를 쓰지 않는다. dig·cf·curl은 stub으로 대체한다.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$(cd "$HERE/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/cer-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

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

# expect_contains <name> <needle> — 직전 출력에 needle이 있는지
expect_contains() {
  if grep -qF -- "$2" "$TMP/out"; then
    pass "$1"
  else
    fail "$1: '$2' 가 출력에 없다"
  fi
}

# ---- stub: dig (DNS 응답을 환경변수로 주입) ----
STUB="$TMP/stub"
mkdir -p "$STUB"

cat >"$STUB/dig" <<'EOF'
#!/usr/bin/env bash
# 인자로 질의 종류를 구분해 fixture 응답을 낸다
case "$*" in
  *"_dmarc."*) printf '%s\n' "${STUB_DMARC:-"\"v=DMARC1; p=quarantine; rua=mailto:r@example.com\""}" ;;
  *"_domainkey."*) printf '%s\n' "\"v=DKIM1; k=rsa; p=abc\"" ;;
  *"MX"*) printf '10 mx1.example.net.\n20 mx2.example.net.\n' ;;
  *"TXT"*) printf '%s\n' "\"v=spf1 include:_spf.example.net -all\"" ;;
esac
EOF

# ---- stub: cf (email-routing 조회만 응답) ----
cat >"$STUB/cf" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *"settings get"*) echo '{"enabled": true}' ;;
  *"rules list"*) echo '[{"name": "forward-all"}]' ;;
  *"email-sending send"*) exit "${STUB_CF_SEND_EXIT:-0}" ;;
  *) exit 1 ;;
esac
EOF

chmod +x "$STUB/dig" "$STUB/cf"

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

# 1) 전부 일치 → exit 0
expect_exit "헬스체크: 기준 일치" 0 bash "$HC" --zone "$ZONE" --baseline "$TMP/baseline.json"
expect_contains "헬스체크: 요약 라인" "정상 7건 / 이상 0건"

# 2) _dmarc 중복 → C1 실패, exit 1
expect_exit "헬스체크: _dmarc 중복이면 실패" 1 env STUB_DMARC=$'"v=DMARC1; p=quarantine; rua=mailto:r@example.com"\n"v=DMARC1; p=none"' bash "$HC" --zone "$ZONE" --baseline "$TMP/baseline.json"
expect_contains "헬스체크: C1 실패 표시" "❌"

# 3) cf 없음 → C6 환경 오류, exit 2 (dig 결과는 계속 출력)
mkdir -p "$TMP/nocf"
cp "$STUB/dig" "$TMP/nocf/dig"
expect_exit "헬스체크: cf 부재는 환경 오류" 2 env PATH="$TMP/nocf:/usr/bin:/bin" bash "$HC" --zone "$ZONE" --baseline "$TMP/baseline.json"
expect_contains "헬스체크: dig 체크는 계속 보고" "_dmarc TXT 개수"

# 4) baseline 불량 → exit 2
echo '{"zone": "example.com"}' >"$TMP/bad.json"
expect_exit "헬스체크: baseline 스키마 불일치" 2 bash "$HC" --zone "$ZONE" --baseline "$TMP/bad.json"

# 5) 통지: 환경변수 부재 → exit 2
printf '본문\n' >"$TMP/body.txt"
expect_exit "통지: NOTIFY_* 부재" 2 env -u NOTIFY_FROM -u NOTIFY_TO bash "$SCRIPTS/notify.sh" --subject "t" --body-file "$TMP/body.txt"

# 6) 통지: CF 성공 → exit 0
expect_exit "통지: CF Email Sending 성공" 0 env NOTIFY_FROM=a@example.com NOTIFY_TO=b@example.com STUB_CF_SEND_EXIT=0 bash "$SCRIPTS/notify.sh" --subject "t" --body-file "$TMP/body.txt"

# 7) 통지: CF 실패 + Mailgun 미설정 → exit 3
expect_exit "통지: 두 경로 모두 실패" 3 env NOTIFY_FROM=a@example.com NOTIFY_TO=b@example.com STUB_CF_SEND_EXIT=1 bash "$SCRIPTS/notify.sh" --subject "t" --body-file "$TMP/body.txt"

# 8) DMARC 집계: 합성 XML(gzip) fixture → exit 0, 개요 출력
mkdir -p "$TMP/reports"
cat >"$TMP/report.xml" <<'EOF'
<?xml version="1.0"?>
<feedback>
  <report_metadata><org_name>google.com</org_name></report_metadata>
  <record>
    <row><source_ip>203.0.113.7</source_ip><count>3</count>
      <policy_evaluated><disposition>none</disposition><dkim>fail</dkim><spf>fail</spf></policy_evaluated>
      <identifiers><header_from>example.com</header_from></identifiers></row>
  </record>
</feedback>
EOF
gzip -c "$TMP/report.xml" >"$TMP/reports/google.com!example.com!1767225600!1767311999.xml.gz"
expect_exit "DMARC 집계: 합성 아카이브" 0 python3 "$SCRIPTS/dmarc_report.py" "$TMP/reports"
expect_contains "DMARC 집계: 전부 실패 판별" "사칭 캠페인"
expect_contains "DMARC 집계: 메시지 합계" "메시지 총 3통"

# 9) DMARC 집계: 빈 디렉터리 → exit 1
mkdir -p "$TMP/empty"
expect_exit "DMARC 집계: 리포트 없음" 1 python3 "$SCRIPTS/dmarc_report.py" "$TMP/empty"

echo
echo "결과: 통과 $PASS / 실패 $FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
