#!/bin/bash
# automation-register.sh·install-gate-shim.sh 회귀 테스트 — stub orca + 격리 CONFIG_DIR.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REGISTER="$HERE/../automation-register.sh"
SHIM_INSTALL="$HERE/../install-gate-shim.sh"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/social-sync-register-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

fail() { echo "❌ $1" >&2; exit 1; }
assert_contains() { grep -qF -- "$3" <<<"$2" || fail "$1 — [$3] 이(가) 없음"; }

CONFIG_DIR="$WORK/config"
# stub orca: 호출 인자를 기록하고 요청에 맞는 JSON을 반환한다
cat > "$WORK/orca" << EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$WORK/orca.log"
case "\$1 \$2" in
  "automations create")
    echo '{"ok": true, "result": {"automation": {"id": "a1"}}}' ;;
  "automations list")
    if [[ -f "$WORK/registered" ]]; then
      echo '{"result": [{"id": "a1", "name": "social-sync", "enabled": false, "trigger": "0 * * * *"}]}'
    else
      echo '{"result": []}'
    fi ;;
  "automations show")
    if [[ -n "\${STUB_ORCA_SHOW:-}" ]]; then
      echo "\$STUB_ORCA_SHOW"
    else
      echo '{"result": {"prompt": "/social-sync tick", "precheck": "bash $CONFIG_DIR/gate.sh"}}'
    fi ;;
  *) echo "stub: 알 수 없는 호출 \$*" >&2; exit 1 ;;
esac
EOF
chmod +x "$WORK/orca"

export SOCIAL_SYNC_ORCA="$WORK/orca"
export SOCIAL_SYNC_CONFIG_DIR="$CONFIG_DIR"

# ── 1. shim 설치 ──
OUT="$(bash "$SHIM_INSTALL")"
[[ -f "$CONFIG_DIR/gate.sh" ]] || fail "shim이 설치되지 않았다"
assert_contains "shim 내용" "$(cat "$CONFIG_DIR/gate.sh")" "scan --gate"
assert_contains "등록 명령 출력" "$OUT" "bash $CONFIG_DIR/gate.sh"
[[ "$(bash "$SHIM_INSTALL" --print-command)" == "bash $CONFIG_DIR/gate.sh" ]] || fail "--print-command 출력 오류"

# ── 2. 등록: 항상 --disabled, precheck·프롬프트·타임아웃 고정 ──
OUT="$(bash "$REGISTER" --create --workspace "path:/tmp/somewhere" --trigger "*/30 * * * *")"
assert_contains "create 응답" "$OUT" '"id": "a1"'
LOG="$(cat "$WORK/orca.log")"
assert_contains "orca 인자" "$LOG" "--disabled"
assert_contains "orca 인자" "$LOG" "--precheck bash $CONFIG_DIR/gate.sh"
assert_contains "orca 인자" "$LOG" "--precheck-timeout 600"
assert_contains "orca 인자" "$LOG" "--prompt /social-sync tick"
assert_contains "orca 인자" "$LOG" "--trigger */30 * * * *"
assert_contains "orca 인자" "$LOG" "--workspace path:/tmp/somewhere"
touch "$WORK/registered"

# ── 3. status: 등록됨·drift 판정 ──
OUT="$(bash "$REGISTER" --status)"
assert_contains "status 등록됨" "$OUT" '"registered": true'
assert_contains "status drift 없음" "$OUT" '"drift": false'
# 등록 내용이 스킬과 다르면 drift를 보고한다
OUT="$(STUB_ORCA_SHOW="{\"result\": {\"prompt\": \"/옛-프롬프트\", \"precheck\": \"bash $CONFIG_DIR/gate.sh\"}}" bash "$REGISTER" --status)"
assert_contains "status drift 감지" "$OUT" '"drift": true'

# ── 4. 미등록 상태 ──
rm -f "$WORK/registered"
OUT="$(bash "$REGISTER" --status)"
assert_contains "미등록 보고" "$OUT" '"registered": false'

# ── 5. shim은 설치본이 없으면 오류로 끝난다(조용한 실패 금지) ──
set +e
HOME="$WORK/empty-home" bash "$CONFIG_DIR/gate.sh" >/dev/null 2>&1
code=$?
set -e
[[ "$code" == "2" ]] || fail "설치본 부재 시 exit 2 기대 (실제 $code)"

echo "register.test.sh 통과"
