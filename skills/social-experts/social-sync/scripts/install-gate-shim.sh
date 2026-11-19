#!/usr/bin/env bash
# orca automation precheck로 등록할 shim을 설치한다 (gitlab-mr-autopilot과 같은 패턴).
#
# 사용법:
#   (인자 없음)       shim 설치/갱신 + 등록용 명령 출력
#   --print-command   등록용 명령만 출력
#
# 플러그인 설치 경로는 콘텐츠 해시를 포함해 업데이트마다 바뀐다. 그 경로를 orca에
# 직접 등록하면 다음 업데이트에서 깨지므로, 사용자 경로의 shim만 등록하고 shim이
# 매 실행 설치본을 다시 찾는다. 찾은 경로를 힌트로 저장하지 않는다 — 옛 해시에
# 고정돼 새 코드를 영영 안 부르는 사례(voc-event-detect)가 있었다.
#
# env: SOCIAL_SYNC_CONFIG_DIR (기본 ~/.config/social-sync)
set -euo pipefail

CONFIG_DIR="${SOCIAL_SYNC_CONFIG_DIR:-$HOME/.config/social-sync}"
SHIM="$CONFIG_DIR/gate.sh"

case "${1:-}" in
  "") ;;
  --print-command) printf 'bash %s\n' "$SHIM"; exit 0 ;;
  -h | --help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) printf '알 수 없는 인자입니다: %s\n' "$1" >&2; exit 2 ;;
esac

mkdir -p "$CONFIG_DIR"
tmp="$SHIM.tmp"
cat > "$tmp" << 'EOF'
#!/usr/bin/env bash
# social-sync precheck shim — install-gate-shim.sh가 만든다. 손으로 고치지 마라.
# 종료 코드: 0 = 동기화 대상 있음(에이전트 기상), 1 = 없음, 2 = 오류.
set -euo pipefail
cd /
# orca가 precheck를 띄우는 환경은 로그인 셸 PATH를 보장하지 않는다. 호출자 PATH가 먼저다.
export PATH="$PATH:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin"

resolve() {
  if [ -n "${SOCIAL_SYNC_SCRIPT:-}" ] && [ -f "$SOCIAL_SYNC_SCRIPT" ]; then
    printf '%s' "$SOCIAL_SYNC_SCRIPT"; return 0
  fi
  local found
  # 캐시 디렉토리 이름은 해시라 공백이 없다. 옛 해시가 지워지지 않으므로 항상 최신 mtime을 고른다.
  # shellcheck disable=SC2012
  found="$(ls -dt "$HOME"/.claude/plugins/cache/aha-skills/social-experts/*/social-sync/scripts/sync_gate.py 2>/dev/null | head -n 1 || true)"
  [ -n "$found" ] && { printf '%s' "$found"; return 0; }
  found="$HOME/.claude/plugins/marketplaces/aha-skills/skills/social-experts/social-sync/scripts/sync_gate.py"
  [ -f "$found" ] && { printf '%s' "$found"; return 0; }
  return 1
}

script="$(resolve)" || { echo "sync_gate.py 설치본을 찾지 못했습니다 (aha-skills social-experts 플러그인)" >&2; exit 2; }
exec uv run --script "$script" scan --gate
EOF
chmod 700 "$tmp"
mv "$tmp" "$SHIM"
printf 'bash %s\n' "$SHIM"
