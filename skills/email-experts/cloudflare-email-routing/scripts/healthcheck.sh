#!/usr/bin/env bash
# healthcheck.sh - 메일 인증·라우팅 헬스체크 C1~C7. 읽기 전용 동사만 쓴다.
#
# Usage: healthcheck.sh --zone <domain> --baseline <json> [--json] [--md-out <path>]
#
# exit 0  정상
# exit 1  이상(체크 실패) — 호출자가 notify.sh로 통지
# exit 2  환경 오류(의존성 부재, baseline 불량, cf 조회 실패 등). --md-out 이 있으면 오류 사유를 그 파일에 남긴다
#
# dig 체크(C1~C5)는 cf 없이 돈다. cf 체크(C6)가 환경 오류면 exit 2로 끝나되 나머지 결과는 그대로 출력한다.

set -uo pipefail

usage() {
  sed -n '2,8p' "$0" >&2
  exit 2
}

ZONE=""
BASELINE=""
AS_JSON=false
MD_OUT=""

# 값을 받는 옵션은 값이 실제로 있어야 한다. 없으면 shift 2가 실패해 루프가 끝나지 않는다.
need_value() {
  [[ $# -ge 2 ]] || { echo "사용 오류: $1 에 값이 필요하다" >&2; usage; }
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --zone) need_value "$@"; ZONE="$2"; shift 2 ;;
    --baseline) need_value "$@"; BASELINE="$2"; shift 2 ;;
    --json) AS_JSON=true; shift ;;
    --md-out) need_value "$@"; MD_OUT="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "알 수 없는 옵션: $1" >&2; usage ;;
  esac
done

[[ -n "$ZONE" && -n "$BASELINE" ]] || usage

# 환경 오류는 stderr와 (지정된 경우) --md-out 양쪽에 남겨야 호출자가 통지 본문을 만들 수 있다
env_fail() {
  echo "환경 오류: $1" >&2
  if [[ -n "$MD_OUT" ]]; then
    printf '# cloudflare-email-routing 점검 — 환경 오류\n\n환경 오류: %s\n' "$1" > "$MD_OUT"
  fi
  exit 2
}

for dep in dig jq; do
  command -v "$dep" >/dev/null 2>&1 || env_fail "$dep 없음"
done

jq -e '.zone and .dmarc.policy and .spf and .dkim.selector and .mx and .routing.rule_count != null' "$BASELINE" >/dev/null 2>&1 \
  || env_fail "baseline 스키마 불일치 (assets/baseline-schema.json 참조)"

[[ "$(jq -r '.zone' "$BASELINE")" == "$ZONE" ]] || env_fail "baseline.zone 과 --zone 이 다르다"

# DNS 자체가 실패하면(SERVFAIL, REFUSED, 응답 없음) 빈 결과가 "레코드 없음"으로 보고되지 않도록 먼저 막는다
dns_status="$(dig +time=3 +tries=2 +noall +comments SOA "$ZONE" 2>/dev/null | grep -o 'status: [A-Z]*' | head -1 || true)"
[[ "$dns_status" == "status: NOERROR" ]] || env_fail "DNS 조회 실패 (${dns_status:-응답 없음}) — 결과를 신뢰할 수 없어 판정하지 않는다"

RESULTS="$(mktemp "${TMPDIR:-/tmp}/ehc.XXXXXX")"
trap 'rm -f "$RESULTS"' EXIT
ENV_ERROR=0

# record <id> <name> <ok|fail|error> <expected> <actual>
record() {
  printf '%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" "$5" >> "$RESULTS"
  if [[ "$3" == "error" ]]; then ENV_ERROR=1; fi
}

# DNS 질의: 타임아웃·재시도를 제한하고, 체인 TXT의 조각("a" "b")은 하나의 값으로 이어 붙인다
dns_txt() { dig +time=3 +tries=2 +short TXT "$1" | sed 's/" "//g; s/"//g'; }

# C1: _dmarc TXT는 정확히 1개
dmarc_raw="$(dns_txt "_dmarc.$ZONE")"
dmarc_count="$(grep -c . <<<"$dmarc_raw" || true)"
if [[ "$dmarc_count" == "1" ]]; then c1=ok; else c1=fail; fi
record C1 "_dmarc TXT 개수" "$c1" "1" "$dmarc_count"

# C2: DMARC 정책 == baseline + rua 존재
dmarc_rec="$(head -1 <<<"$dmarc_raw")"
dmarc_policy="$(grep -oE '(^|;)[[:space:]]*p=[a-z]+' <<<"$dmarc_rec" | head -1 | sed 's/.*p=//')"
expected_policy="$(jq -r '.dmarc.policy' "$BASELINE")"
has_rua=false
grep -q 'rua=' <<<"$dmarc_rec" && has_rua=true
if [[ "$dmarc_policy" == "$expected_policy" && "$has_rua" == true ]]; then c2=ok; else c2=fail; fi
record C2 "DMARC 정책·rua" "$c2" "p=$expected_policy + rua" "p=${dmarc_policy:-none} rua=$has_rua"

# C3: SPF TXT == baseline (단일 레코드)
spf_list="$(dns_txt "$ZONE" | grep '^v=spf1' || true)"
spf_count="$(grep -c . <<<"$spf_list" || true)"
expected_spf="$(jq -r '.spf' "$BASELINE")"
if [[ "$spf_count" == "1" && "$spf_list" == "$expected_spf" ]]; then c3=ok; else c3=fail; fi
record C3 "SPF TXT" "$c3" "$expected_spf" "$spf_list"

# C4: DKIM 셀렉터 TXT 존재
selector="$(jq -r '.dkim.selector' "$BASELINE")"
dkim_present="$(dns_txt "${selector}._domainkey.$ZONE" | grep -c . || true)"
if [[ "$dkim_present" -ge 1 ]]; then c4=ok; else c4=fail; fi
record C4 "DKIM 셀렉터 $selector" "$c4" "존재" "레코드 ${dkim_present}개"

# C5: MX 집합 == baseline
actual_mx="$(dig +time=3 +tries=2 +short MX "$ZONE" | awk '{print $2}' | sed 's/\.$//' | LC_ALL=C sort | paste -sd, -)"
expected_mx="$(jq -r '.mx | map(rtrimstr(".")) | sort | join(",")' "$BASELINE")"
if [[ "$actual_mx" == "$expected_mx" ]]; then c5=ok; else c5=fail; fi
record C5 "MX 집합" "$c5" "$expected_mx" "$actual_mx"

# C6: Email Routing 활성 + 규칙 수 == baseline (cf 의존, 조회 실패는 환경 오류)
expected_rules="$(jq -r '.routing.rule_count' "$BASELINE")"
if ! command -v cf >/dev/null 2>&1; then
  record C6 "Email Routing 상태" error "활성 + 규칙 $expected_rules" "cf 없음"
else
  settings="$(cf email-routing settings get -z "$ZONE" 2>/dev/null || true)"
  # false 를 빈 값으로 바꾸는 // empty 를 쓰지 않는다 — 비활성은 fail 이고 조회 실패와 구분돼야 한다
  enabled="$(jq -r 'if has("enabled") then (.enabled | tostring) else empty end' <<<"$settings" 2>/dev/null || true)"
  # 실제 명령은 rules list-account 다(rules list 는 없다). catch-all 규칙도 배열에 포함된다
  rules="$(cf email-routing rules list-account -z "$ZONE" 2>/dev/null || true)"
  rule_count="$(jq -r 'if type=="array" then length else empty end' <<<"$rules" 2>/dev/null || true)"
  if [[ -z "$enabled" || -z "$rule_count" ]]; then
    record C6 "Email Routing 상태" error "활성 + 규칙 $expected_rules" "cf 조회 실패 또는 응답 형식 불일치 (cf auth whoami 로 인증 확인)"
  elif [[ "$enabled" == "true" && "$rule_count" == "$expected_rules" ]]; then
    record C6 "Email Routing 상태" ok "활성 + 규칙 $expected_rules" "활성 + 규칙 $rule_count"
  else
    record C6 "Email Routing 상태" fail "활성 + 규칙 $expected_rules" "enabled=$enabled 규칙 $rule_count"
  fi
fi

# C7: 드리프트 요약 — C2~C6 중 baseline과 다른 항목 수
drift="$(awk -F'\t' '$1 ~ /^C[2-6]$/ && $3 != "ok" {n++} END {print n+0}' "$RESULTS")"
if [[ "$drift" == "0" ]]; then record C7 "baseline 드리프트" ok "0" "0"; else record C7 "baseline 드리프트" fail "0" "$drift"; fi

fail_count="$(awk -F'\t' '$3 == "fail" {n++} END {print n+0}' "$RESULTS")"
ok_count="$(awk -F'\t' '$3 == "ok" {n++} END {print n+0}' "$RESULTS")"

render_md() {
  echo "# cloudflare-email-routing 점검 — $ZONE"
  echo
  echo "| 체크 | 항목 | 기대값 | 실제값 | 결과 |"
  echo "|---|---|---|---|---|"
  awk -F'\t' '{
    mark = ($3=="ok") ? "✅" : ($3=="fail") ? "❌" : "⚠️"
    printf "| %s | %s | %s | %s | %s |\n", $1, $2, $4, $5, mark
  }' "$RESULTS"
  echo
  echo "요약: 정상 ${ok_count}건 / 이상 ${fail_count}건"
}

if [[ "$AS_JSON" == true ]]; then
  jq -Rn --arg zone "$ZONE" '
    [inputs | split("\t") | {id: .[0], name: .[1], status: .[2], expected: .[3], actual: .[4]}]
    | {zone: $zone, results: .}' < "$RESULTS"
else
  render_md
fi

if [[ -n "$MD_OUT" ]]; then
  if ! render_md > "$MD_OUT"; then
    echo "환경 오류: --md-out 쓰기 실패 ($MD_OUT)" >&2
    exit 2
  fi
fi

if [[ "$ENV_ERROR" == 1 ]]; then exit 2; fi
if [[ "$fail_count" -gt 0 ]]; then exit 1; fi
exit 0
