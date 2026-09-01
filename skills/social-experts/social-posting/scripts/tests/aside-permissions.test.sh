#!/bin/bash
# aside-permissions.sh — 권한 바인딩 상태·부여·ask 대체·계정 원복·soft-fail 검증.
#
# 회귀(2026-09-01 실측 반영): aside 스키마는 저장 시 browser 규칙의 host 필드를
# 제거한다 — stub도 이 정규화를 흉내 내야 실물 동작을 재현한다. host 포함
# REQUIRED를 그대로 검증하면 부여 후 재조회에서 불일치로 실패한다.
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

# 시작 상태: allow 비어 있고 ask 충돌 2건. browser-modify는 host 포함 형태로 시드한다 —
# 실제 저장 상태(host 소실)와 달라도 canon이 host를 벗겨 REQUIRED(전역)와 일치해야 한다.
# 이 host가 없으면 canon의 host 제거 분기가 무발화가 된다(변이: 필터 제거 시 아래 단언이 red).
cat >"$sandbox/state/permission.json" <<'EOF'
{"rules":{"allow":[],"deny":[],"ask":[{"type":"tool","tool":"twitter.tweet"},{"type":"browser","action":"modify","host":"x.com"}],"default":"allow"},"files":{"outsideRead":"ask","outsideWrite":"ask"},"sandbox":{"enabled":false}}
EOF
echo "u0" >"$sandbox/state/active"

# --- 1. status: 미부여 + ask 충돌 감지 ---
out="$(STUB_STATE="$STUB_STATE" PATH="$sandbox/bin:$PATH" bash "$PERM" status)"
echo "$out" | jq -e '.ok == true and .bound == false and .account == "u0"' >/dev/null || fail "status 기본 필드 불일치: $out"
echo "$out" | jq -e '(.missing | length) == 8 and (.ask_conflicts | length) == 2' >/dev/null || fail "missing/ask_conflicts 탐지 실패: $out"
echo "$out" | jq -e '.default_allow == true' >/dev/null || fail "default_allow 미반영: $out"

# --- 2. grant (--account u1): 부여 + ask 대체 + host 정규화 스키마에서 검증 통과 + 활성 계정 원복 ---
out="$(STUB_STATE="$STUB_STATE" PATH="$sandbox/bin:$PATH" bash "$PERM" grant --account u1)"
echo "$out" | jq -e '.ok == true and .written == true and .verified == true and .account == "u1"' >/dev/null || fail "grant 결과 불일치: $out"
echo "$out" | jq -e '(.ask_replaced | length) == 2 and (.added | length) == 8' >/dev/null || fail "ask 대체/added 불일치: $out"
[[ "$(cat "$sandbox/state/active")" == "u0" ]] || fail "활성 계정이 u0으로 원복되지 않음: $(cat "$sandbox/state/active")"

# --- 3. grant 후 status: bound ---
out="$(STUB_STATE="$STUB_STATE" PATH="$sandbox/bin:$PATH" bash "$PERM" status)"
echo "$out" | jq -e '.bound == true and (.ask_conflicts | length) == 0' >/dev/null || fail "grant 후에도 bound:false: $out"

# --- 4. 재부여: 변경 없음 → written:false ---
out="$(STUB_STATE="$STUB_STATE" PATH="$sandbox/bin:$PATH" bash "$PERM" grant)"
echo "$out" | jq -e '.ok == true and .written == false and .verified == true' >/dev/null || fail "no-op grant 불일치: $out"

# --- 5. 중복 정리: 실패한 첫 grant가 남긴 실제 상태(중복 browser-modify 4개 + 전역 ask 잔존)에서 복구 ---
cat >"$sandbox/state/permission.json" <<'EOF'
{"rules":{"allow":[{"type":"browser","action":"modify"},{"type":"browser","action":"modify"},{"type":"browser","action":"modify"},{"type":"browser","action":"modify"},{"type":"network","url":"https://example.com/*"},{"type":"network","url":"https://example.com/*"}],"deny":[],"ask":[{"type":"browser","action":"modify"}],"default":"allow"},"files":{"outsideRead":"ask","outsideWrite":"ask"},"sandbox":{"enabled":false}}
EOF
out="$(STUB_STATE="$STUB_STATE" PATH="$sandbox/bin:$PATH" bash "$PERM" grant)"
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
if STUB_STATE="$STUB_STATE" PATH="$sandbox/bin:$PATH" bash "$PERM" grant >/dev/null 2>&1; then
  fail "repl 부재 시 grant는 exit 1이어야 한다"
fi

# --- 7. aside 부재 → status ok:false, grant exit 1 ---
out="$(PATH="/usr/bin:/bin" bash "$PERM" status)"
echo "$out" | jq -e '.ok == false and .reason == "aside_not_found"' >/dev/null || fail "aside 부재 status 불일치: $out"
if PATH="/usr/bin:/bin" bash "$PERM" grant >/dev/null 2>&1; then
  fail "aside 부재 시 grant는 exit 1이어야 한다"
fi

echo "✅ aside-permissions.test.sh 통과"
