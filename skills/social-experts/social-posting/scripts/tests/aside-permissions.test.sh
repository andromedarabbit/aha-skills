#!/bin/bash
# aside-permissions.sh — 권한 바인딩 상태·부여·ask 대체·계정 원복·soft-fail 검증.
#
# 회귀(2026-09-01 실측 반영): aside 스키마는 저장 시 browser 규칙의 host 필드를
# 제거한다 — stub도 이 정규화를 흉내 낸다. 비교는 exact 매칭: host가 붙은 사용자
# 규칙은 대체·제거되지 않고 보존된다. grant는 SOCIAL_PERMISSION_GRANT=1 토큰 필요.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PERM="$SKILL_DIR/scripts/aside-permissions.sh"

sandbox="$(mktemp -d)"
trap 'rm -rf "$sandbox"' EXIT
fail() { echo "❌ $1" >&2; exit 1; }

mkdir -p "$sandbox/bin" "$sandbox/state"

# aside stub — account status/use, repl 읽기/쓰기를 파일 스토어로 흉내낸다.
# 쓰기 시 실물 aside처럼 browser 규칙의 host를 제거해 정규화한다.
cat >"$sandbox/bin/aside" <<'EOF'
#!/bin/bash
normalize() {
  python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    for lst in (d.get("rules") or {}).values():
        if isinstance(lst, list):
            for r in lst:
                if isinstance(r, dict) and r.get("type") == "browser":
                    r.pop("host", None)
    print(json.dumps(d, separators=(",", ":")))
except Exception:
    pass'
}
case "$1" in
  account)
    case "$2" in
      status) echo "* $(cat "$STUB_STATE/active")  tester@example.com  signed in" ;;
      use) echo "$3" >"$STUB_STATE/active"; exit 0 ;;
    esac ;;
  repl)
    arg="$*"
    if [[ "$arg" == *'settings.set'* ]]; then
      payload="$(printf '%s' "$arg" | sed -n 's/.*settings.set("permission", \(.*\)); const.*/\1/p' | normalize)"
      printf '%s' "$payload" >"$STUB_STATE/permission.json"
      echo "WRITE_OK:$payload"
    else
      echo "PERM_JSON:$(cat "$STUB_STATE/permission.json")"
    fi ;;
esac
exit 0
EOF
chmod +x "$sandbox/bin/aside"
export STUB_STATE="$sandbox/state"

# 시작 상태: allow 비어 있고 ask에 (a) 필수 규칙과 exact 일치하는 twitter.tweet,
# (b) host가 붙은 사용자 소유 browser-modify를 시드한다 — (b)는 exact 매칭에서
# 충돌이 아니므로 grant가 절대 대체·제거하지 않아야 한다(사용자 규칙 불가침).
cat >"$sandbox/state/permission.json" <<'EOF'
{"rules":{"allow":[],"deny":[],"ask":[{"type":"tool","tool":"twitter.tweet"},{"type":"browser","action":"modify","host":"x.com"}],"default":"allow"},"files":{"outsideRead":"ask","outsideWrite":"ask"},"sandbox":{"enabled":false}}
EOF
echo "u0" >"$sandbox/state/active"

# --- 1. status: 미부여 + ask 충돌 감지 ---
out="$(STUB_STATE="$STUB_STATE" PATH="$sandbox/bin:$PATH" bash "$PERM" status)"
echo "$out" | jq -e '.ok == true and .bound == false and .account == "u0"' >/dev/null || fail "status 기본 필드 불일치: $out"
echo "$out" | jq -e '(.missing | length) == 8 and (.ask_conflicts | length) == 1' >/dev/null || fail "missing/ask_conflicts 탐지 실패: $out"
echo "$out" | jq -e '.default_allow == true' >/dev/null || fail "default_allow 미반영: $out"

# --- 2. grant (--account u1, 토큰): 부여 + exact 대체만 + 검증 통과 + 활성 계정 원복 ---
out="$(STUB_STATE="$STUB_STATE" SOCIAL_PERMISSION_GRANT=1 PATH="$sandbox/bin:$PATH" bash "$PERM" grant --account u1)"
echo "$out" | jq -e '.ok == true and .written == true and .verified == true and .account == "u1"' >/dev/null || fail "grant 결과 불일치: $out"
echo "$out" | jq -e '(.ask_replaced | length) == 1 and (.added | length) == 8' >/dev/null || fail "ask 대체/added 불일치: $out"
[[ "$(cat "$sandbox/state/active")" == "u0" ]] || fail "활성 계정이 u0으로 원복되지 않음: $(cat "$sandbox/state/active")"
# 사용자 소유 browser ask 규칙은 grant 후에도 ask 목록에 남아야 한다 (exact 외 엔트리 불가침).
# 주의: aside 저장 정규화(stub이 흉내)가 host를 벗겨 저장하므로 남는 형태는 host 없는 것 —
# 보존 계약은 "엔트리를 제거하지 않는다"이지 저장 형태를 보장하는 게 아니다.
python3 - "$sandbox/state/permission.json" <<'PYEOF' || fail "사용자 browser ask 규칙이 제거됨"
import json, sys
ask = json.load(open(sys.argv[1]))["rules"]["ask"]
bm = [r for r in ask if r.get("type") == "browser" and r.get("action") == "modify"]
assert len(bm) == 1, f"사용자 browser ask 규칙 소실/중복: {ask}"
assert not any(r.get("tool") == "twitter.tweet" for r in ask), "exact 교체 대상이 남음"
PYEOF

# --- 3. 저장 정규화 수렴: host가 벗겨진 사용자 ask는 이제 exact 충돌 → 재grant로 수렴 ---
# 첫 grant는 계획 시점에서 exact인 twitter.tweet만 대체한다. 남은 사용자 browser ask는
# 저장 정규화로 host가 벗겨져 다음 status에서 exact 충돌로 나타난다 — 보수적 exact
# 매칭은 자기수렴한다: 재grant(동의)가 그것을 allow로 바꾸고 bound가 닫힌다.
out="$(STUB_STATE="$STUB_STATE" PATH="$sandbox/bin:$PATH" bash "$PERM" status)"
echo "$out" | jq -e '.bound == false and (.ask_conflicts | length) == 1' >/dev/null || fail "저장 정규화 후 exact 충돌 1건이어야 한다: $out"
out="$(STUB_STATE="$STUB_STATE" SOCIAL_PERMISSION_GRANT=1 PATH="$sandbox/bin:$PATH" bash "$PERM" grant)"
echo "$out" | jq -e '.ok == true and .verified == true and (.ask_replaced | length) == 1' >/dev/null || fail "수렴 grant 실패: $out"
out="$(STUB_STATE="$STUB_STATE" PATH="$sandbox/bin:$PATH" bash "$PERM" status)"
echo "$out" | jq -e '.bound == true and (.ask_conflicts | length) == 0' >/dev/null || fail "수렴 후에도 bound:false: $out"

# --- 4. 재부여: 변경 없음 → written:false ---
out="$(STUB_STATE="$STUB_STATE" SOCIAL_PERMISSION_GRANT=1 PATH="$sandbox/bin:$PATH" bash "$PERM" grant)"
echo "$out" | jq -e '.ok == true and .written == false and .verified == true' >/dev/null || fail "no-op grant 불일치: $out"

# --- 5. 중복 정리: 실패한 첫 grant가 남긴 실제 상태(중복 browser-modify 4개 + 전역 ask 잔존)에서 복구 ---
cat >"$sandbox/state/permission.json" <<'EOF'
{"rules":{"allow":[{"type":"browser","action":"modify"},{"type":"browser","action":"modify"},{"type":"browser","action":"modify"},{"type":"browser","action":"modify"},{"type":"network","url":"https://example.com/*"},{"type":"network","url":"https://example.com/*"}],"deny":[],"ask":[{"type":"browser","action":"modify"}],"default":"allow"},"files":{"outsideRead":"ask","outsideWrite":"ask"},"sandbox":{"enabled":false}}
EOF
out="$(STUB_STATE="$STUB_STATE" SOCIAL_PERMISSION_GRANT=1 PATH="$sandbox/bin:$PATH" bash "$PERM" grant)"
echo "$out" | jq -e '.ok == true and .written == true and .verified == true' >/dev/null || fail "중복 상태 복구 grant 실패: $out"
python3 - "$sandbox/state/permission.json" <<'PYEOF' || fail "중복 제거/ask 청소 불일치"
import json, sys
rules = json.load(open(sys.argv[1]))["rules"]
allow = rules.get("allow") or []
bm = [r for r in allow if r == {"type": "browser", "action": "modify"}]
assert len(bm) == 1, f"browser-modify 중복 잔존: {len(bm)}개"
ex = [r for r in allow if r == {"type": "network", "url": "https://example.com/*"}]
assert len(ex) == 1, f"필수 아닌 동일 규칙(network example.com) dedup 미적용: {len(ex)}개"
assert not [r for r in (rules.get("ask") or []) if r.get("type") == "browser"], "전역 browser ask 잔존"
PYEOF

# --- 5b. 토큰 없는 grant → exit 1 (동의 계약 코드 강제) ---
if STUB_STATE="$STUB_STATE" PATH="$sandbox/bin:$PATH" bash "$PERM" grant >/dev/null 2>&1; then
  fail "토큰 없는 grant는 exit 1이어야 한다"
fi

# --- 5c. revoke: 부여했던 필수 규칙만 회수 → status bound:false ---
out="$(STUB_STATE="$STUB_STATE" PATH="$sandbox/bin:$PATH" bash "$PERM" revoke)"
echo "$out" | jq -e '.ok == true and .written == true and .verified == true and (.removed | length) == 8' >/dev/null || fail "revoke 결과 불일치: $out"
out="$(STUB_STATE="$STUB_STATE" PATH="$sandbox/bin:$PATH" bash "$PERM" status)"
echo "$out" | jq -e '.bound == false and (.missing | length) == 8' >/dev/null || fail "revoke 후 bound:false+missing 8이어야 한다: $out"
# revoke 후 재부여(토큰)로 다시 bound 복구되는지 — 왕복 무결성
out="$(STUB_STATE="$STUB_STATE" SOCIAL_PERMISSION_GRANT=1 PATH="$sandbox/bin:$PATH" bash "$PERM" grant)"
echo "$out" | jq -e '.ok == true and .verified == true' >/dev/null || fail "revoke 후 재부여 실패: $out"

# --- 6. repl 응답 없음 → status soft-fail(exit 0), grant fail-fast(exit 1) ---
cat >"$sandbox/bin/aside" <<'EOF'
#!/bin/bash
case "$1" in
  account)
    case "$2" in
      status) echo "* u0  tester@example.com  signed in" ;;
      use) exit 0 ;;
    esac ;;
esac
exit 0
EOF
chmod +x "$sandbox/bin/aside"
if out="$(STUB_STATE="$STUB_STATE" PATH="$sandbox/bin:$PATH" bash "$PERM" status)" \
  && ! echo "$out" | jq -e '.ok == false' >/dev/null; then
  fail "repl 부재 시 status는 ok:false + exit 0이어야 한다: $out"
fi
if STUB_STATE="$STUB_STATE" SOCIAL_PERMISSION_GRANT=1 PATH="$sandbox/bin:$PATH" bash "$PERM" grant >/dev/null 2>&1; then
  fail "repl 부재 시 grant는 exit 1이어야 한다"
fi

# --- 7. aside 부재 → status ok:false, grant exit 1 ---
out="$(PATH="/usr/bin:/bin" bash "$PERM" status)"
echo "$out" | jq -e '.ok == false and .reason == "aside_not_found"' >/dev/null || fail "aside 부재 status 불일치: $out"
if PATH="/usr/bin:/bin" bash "$PERM" grant >/dev/null 2>&1; then
  fail "aside 부재 시 grant는 exit 1이어야 한다"
fi

echo "✅ aside-permissions.test.sh 통과"
