#!/bin/bash
# aside-permissions.sh - aside 권한 바인딩(1회 일괄 허용)의 상태 조회·부여.
#
# aside의 게시 권한은 settings.json 최상위 permission 키다(rules.allow/deny/ask + default).
# CLI에 settings 커맨드가 없어 repl의 aside.settings.get/set 으로만 읽고 쓴다
# (MCP는 도구가 repl 하나뿐 — 권한 전용 API는 없다).
#
# 이 스킬이 지원하는 4개 사이트의 필수 allow 규칙(하단 REQUIRED_JSON — 유일한 정의 지점)과
# 대조해 바인딩 상태를 보고하고, Stage 2 게이트에서 사용자가 "일괄 허용"을 고르면 부여한다.
# 부여는 없는 규칙을 추가하고, 같은 모양(정규화 JSON 동일)의 ask/deny 규칙은 allow로 대체한다.
#
# Usage:
#   bash aside-permissions.sh status [--account u0]   # 상태 JSON 1줄, 항상 exit 0 (soft-fail)
#   SOCIAL_PERMISSION_GRANT=1 bash aside-permissions.sh grant  [--account u0]  # 부여 (동의 토큰 필요)
#   bash aside-permissions.sh revoke [--account u0]   # 부여했던 필수 규칙만 회수
#
# grant는 SOCIAL_PERMISSION_GRANT=1 환경변수(Stage 2 '일괄 허용' 동의의 운반체)가
# 없으면 거부한다 — 동의 계약을 산문이 아니라 코드로 강제한다. revoke는 권한을
# 줄이는 방향이라 토큰 없이 허용한다.
#
# 비교는 전부 exact(키 정렬 JSON 동일) 매칭이다. REQUIRED는 host 없는 형태라
# host가 붙은 사용자 소유 ask/deny/allow 규칙(수동 편집·이전 스키마 잔존물)은
# 절대 대체·제거하지 않고 그대로 보존한다 — 모르는 규칙을 파괴하지 않는다.
#
# 주의: repl은 --account를 무시한다. 대상 계정이 활성 계정과 다르면 `aside account use`로
# 전환하고 작업 뒤 원복한다(원복 실패는 결과에 남긴다).
#
# 규칙 문법 (2026-09-01 실측, zod 판별 유니언):
#   {type:'tool', tool:string}
#   {type:'browser', action:'read'|'modify'|'download'}  — host는 지정해도 저장 시 제거됨(전역)
#   {type:'network', url:string}  (와일드카드 *)

set -uo pipefail


# 게시에 필요한 allow 규칙. X만 tool 축이 있다(~/.aside/skills/builtin/x-twitter의
# twitter 글로벌). linkedin·facebook·bluesky는 내장 스킬이 없어 브라우저 경로뿐이다.
# browser 규칙은 aside가 저장 시 host 필드를 제거한다(2026-09-01 실측) — 사이트
# 좁히기 없이 전역으로만 부여 가능하고, 사이트 범위 제어는 network url 패턴뿐이다.
REQUIRED_JSON='[
  {"type":"tool","tool":"twitter.tweet"},
  {"type":"tool","tool":"twitter.reply"},
  {"type":"tool","tool":"twitter.deleteTweet"},
  {"type":"browser","action":"modify"},
  {"type":"network","url":"https://x.com/*"},
  {"type":"network","url":"https://www.linkedin.com/*"},
  {"type":"network","url":"https://www.facebook.com/*"},
  {"type":"network","url":"https://bsky.app/*"}
]'

die() { echo "❌ aside-permissions: $1" >&2; exit 1; }

# 데몬이 멈춰 있어도 스크립트가 걸리지 않게 — timeout이 있으면 20초 상한.
guarded() {
  if command -v timeout >/dev/null 2>&1; then timeout 20 "$@"; else "$@"; fi
}

active_account() {
  guarded aside account status 2>/dev/null | head -1 | grep -oE '\bu[0-9]+' | head -1
}

# repl 출력에서 마커 라인을 꺼낸다(ANSI 제거 후). 실패·부재 → 빈 값.
repl_read() {
  local js='const p = await aside.settings.get("permission"); console.log("PERM_JSON:" + JSON.stringify(p));'
  { guarded aside repl "$js" 2>/dev/null || true; } \
    | sed $'s/\x1b\[[0-9;]*m//g' | grep -oE 'PERM_JSON:.*' | head -1 | cut -d: -f2-
}

# $1 = 새 permission 객체 JSON — JS 객체 리터럴 위치에 직접 삽입한다(문자열 리터럴로
# 감싸지 않는다). 삽입 전 JSON 객체임을 재검증해 이외의 입력이 JS로 새어 들어가지
# 않게 한다(plan 산출물만 오지만 방어는 기록 직전에 한다).
repl_write() {
  local payload="$1"
  printf '%s' "$payload" | jq -e 'type == "object"' >/dev/null 2>&1 \
    || die "repl_write 페이로드가 JSON 객체가 아니다"
  local js='await aside.settings.set("permission", '"$payload"'); const v = await aside.settings.get("permission"); console.log("WRITE_OK:" + JSON.stringify(v));'
  { guarded aside repl "$js" 2>/dev/null || true; } \
    | sed $'s/\x1b\[[0-9;]*m//g' | grep -oE 'WRITE_OK:.*' | head -1 | cut -d: -f2-
}

# plan <mode> <current-json> [new-json] — 비교·병합 로직의 유일한 구현.
# mode: status(상태) | grant(부여 계획) | verify(부여 후 재조회 검증)
plan() {
  local mode="$1" cur="$2" new="${3:-}"
  python3 - "$mode" "$REQUIRED_JSON" "$cur" "$new" <<'PYEOF'
import json, sys

mode, req, cur, new = sys.argv[1], json.loads(sys.argv[2]), json.loads(sys.argv[3]), (json.loads(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] else None)
# exact 매칭 — aside가 저장 시 browser 규칙의 host를 지우므로(2026-09-01 실측) 실제
# 저장 상태는 host 없이 정규화돼 있고, REQUIRED도 host 없는 형태다. host가 붙은
# 규칙은 사용자 소유로 취급해 일치시키지 않는다(대체·제거·dedup 대상 아님).
canon = lambda r: json.dumps(r, sort_keys=True, ensure_ascii=False)
dedup = lambda rules: list({canon(r): r for r in rules}.values())
req_set = {canon(r) for r in req}
rules = cur.get("rules") or {}
allow, ask, deny = rules.get("allow") or [], rules.get("ask") or [], rules.get("deny") or []
have_allow = {canon(r) for r in allow}
hits = lambda lst: [r for r in lst if canon(r) in req_set]

if mode == "status":
    missing = [r for r in req if canon(r) not in have_allow]
    print(json.dumps({
        "bound": not missing and not hits(ask) and not hits(deny),
        "default_allow": rules.get("default") == "allow",
        "missing": missing,
        "ask_conflicts": hits(ask),
        "deny_conflicts": hits(deny),
    }, ensure_ascii=False))
elif mode == "grant":
    print(json.dumps({
        "added": [r for r in req if canon(r) not in have_allow],
        "ask_replaced": hits(ask),
        "deny_replaced": hits(deny),
        "new_permission": {**cur, "rules": {
            "allow": dedup([r for r in allow if canon(r) not in req_set] + req),
            "ask": [r for r in ask if canon(r) not in req_set],
            "deny": [r for r in deny if canon(r) not in req_set],
            **{k: v for k, v in rules.items() if k not in ("allow", "ask", "deny")},
        }},
    }, ensure_ascii=False))
elif mode == "revoke":
    print(json.dumps({
        "removed": hits(allow),
        "new_permission": {**cur, "rules": {
            "allow": [r for r in allow if canon(r) not in req_set],
            **{k: v for k, v in rules.items() if k != "allow"},
        }},
    }, ensure_ascii=False))
elif mode == "verify_revocation":
    na = {canon(r) for r in allow}
    print(json.dumps({"verified": all(canon(r) not in na for r in req)}, ensure_ascii=False))
elif mode == "verify":
    # 검증 소스는 재조회한 현재 상태 — 호출부에서 cur 로 넘긴다(new 는 호환용 fallback)
    nrules = (new or cur).get("rules") or {}
    na = {canon(r) for r in (nrules.get("allow") or [])}
    print(json.dumps({
        "verified": all(canon(r) in na for r in req),
        "ask_conflicts": hits(nrules.get("ask") or []),
        "deny_conflicts": hits(nrules.get("deny") or []),
    }, ensure_ascii=False))
PYEOF
}

cmd="${1:-}"; [[ $# -gt 0 ]] && shift
account=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --account)
      if [[ $# -ge 2 ]]; then account="$2"; shift 2; else shift; fi ;;
    *) shift ;;
  esac
done

case "$cmd" in
  status|grant|revoke) ;;
  *) echo "usage: bash aside-permissions.sh status|grant|revoke [--account u0] (grant는 SOCIAL_PERMISSION_GRANT=1 필요)" >&2; exit 1 ;;
esac

# 동의 토큰 게이트 — grant는 Stage 2 '일괄 허용' 응답의 운반체와 함께만 실행한다.
if [[ "$cmd" == "grant" && "${SOCIAL_PERMISSION_GRANT:-}" != "1" ]]; then
  echo "❌ aside-permissions: grant는 SOCIAL_PERMISSION_GRANT=1(Stage 2 '일괄 허용' 동의) 없이 실행할 수 없다" >&2
  exit 1
fi

command -v aside >/dev/null 2>&1 || {
  if [[ "$cmd" == "status" ]]; then printf '{"ok":false,"reason":"aside_not_found"}\n'; exit 0; fi
  die "aside가 없다 — 권한을 부여할 수 없다"
}

orig_active="$(active_account)"
if [[ -n "$account" && "$account" != "$orig_active" ]]; then
  guarded aside account use "$account" >/dev/null 2>&1 || {
    if [[ "$cmd" == "status" ]]; then printf '{"ok":false,"account":"%s","reason":"account_switch_failed"}\n' "$account"; exit 0; fi
    die "계정 $account 으로 전환 실패"
  }
else
  account="$orig_active"
fi
restore_account() {
  [[ -n "$orig_active" && "$orig_active" != "$account" ]] || return 0
  guarded aside account use "$orig_active" >/dev/null 2>&1 || echo "RESTORE_FAILED:$orig_active"
}

perm_json="$(repl_read)"
if [[ -z "$perm_json" ]]; then
  restore_account >/dev/null
  if [[ "$cmd" == "status" ]]; then printf '{"ok":false,"account":"%s","reason":"aside_settings_read_failed"}\n' "$account"; exit 0; fi
  die "aside 설정 읽기 실패 — aside 앱이 실행 중인지 확인"
fi

if [[ "$cmd" == "status" ]]; then
  restore_account >/dev/null
  st="$(plan status "$perm_json")" || die "상태 계산 실패"
  jq -n -c --arg account "$account" --argjson st "$st" '{ok:true, account:$account} + $st' \
    || die "상태 조립 실패"
  exit 0
fi


# revoke — 부여했던 필수 규칙만 제거(ask/deny·사용자 규칙 불가침). 토큰 불필요(권한 축소 방향).
if [[ "$cmd" == "revoke" ]]; then
  rplan="$(plan revoke "$perm_json")" || { restore_account >/dev/null; die "회수 계획 계산 실패"; }
  rreport="$(printf '%s' "$rplan" | jq -c 'del(.new_permission)')"
  rnew="$(printf '%s' "$rplan" | jq -c '.new_permission')"
  if [[ "$(printf '%s' "$rreport" | jq '.removed | length')" == "0" ]]; then
    restore_account >/dev/null
    jq -n -c --arg account "$account" --argjson r "$rreport" '{ok:true, account:$account, written:false, removed:0}' \
      || die "결과 조립 실패"
    exit 0
  fi
  if [[ -z "$(repl_write "$rnew")" ]]; then
    restore_account >/dev/null
    die "aside 설정 기록 실패 (repl 응답 없음)"
  fi
  rreread="$(repl_read)"
  [[ -n "$rreread" ]] || { restore_account >/dev/null; die "회수 후 재조회 실패 — aside 앱에서 설정을 확인"; }
  rverify="$(plan verify_revocation "$rreread")" || { restore_account >/dev/null; die "회수 검증 계산 실패"; }
  rrestore_msg="$(restore_account)"
  if ! printf '%s' "$rverify" | jq -e '.verified == true' >/dev/null; then
    printf '❌ 회수 검증 실패: %s\n' "$rverify" >&2
    exit 1
  fi
  jq -n -c --arg account "$account" --argjson r "$rreport" '{ok:true, account:$account, written:true, verified:true} + $r' \
    || die "결과 조립 실패"
  if [[ -n "$rrestore_msg" ]]; then
    printf '{"account_restore_failed":"%s"}\n' "${rrestore_msg#RESTORE_FAILED:}"
  fi
  exit 0
fi

# grant — 부여 계획 → (변경 있으면) 기록 → 재조회 검증
gplan="$(plan grant "$perm_json")" || { restore_account >/dev/null; die "부여 계획 계산 실패"; }
report="$(printf '%s' "$gplan" | jq -c 'del(.new_permission)')"
new_perm="$(printf '%s' "$gplan" | jq -c '.new_permission')"
if [[ "$(printf '%s' "$report" | jq '[.added,.ask_replaced,.deny_replaced] | flatten | length')" == "0" ]]; then
  restore_account >/dev/null
  jq -n -c --arg account "$account" --argjson r "$report" '{ok:true, account:$account, written:false, verified:true} + $r' \
    || die "결과 조립 실패"
  exit 0
fi
written="$(repl_write "$new_perm")"
if [[ -z "$written" ]]; then
  restore_account >/dev/null
  die "aside 설정 기록 실패 (repl 응답 없음)"
fi
reread="$(repl_read)"
[[ -n "$reread" ]] || { restore_account >/dev/null; die "부여 후 재조회 실패 — aside 앱에서 설정을 확인"; }
verify="$(plan verify "$reread")" || { restore_account >/dev/null; die "검증 계산 실패"; }
restore_msg="$(restore_account)"
if ! printf '%s' "$verify" | jq -e '.verified == true' >/dev/null; then
  printf '❌ 부여 검증 실패: %s\n' "$verify" >&2
  [[ -n "$restore_msg" ]] && printf '⚠️ %s\n' "$restore_msg" >&2
  exit 1
fi
jq -n -c --arg account "$account" --argjson r "$report" '{ok:true, account:$account, written:true, verified:true} + $r' \
  || die "결과 조립 실패"
if [[ -n "$restore_msg" ]]; then
  printf '{"account_restore_failed":"%s"}\n' "${restore_msg#RESTORE_FAILED:}"
fi
exit 0
