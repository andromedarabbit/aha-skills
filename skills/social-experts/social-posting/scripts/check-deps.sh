#!/bin/bash
# check-deps.sh - PreToolUse 훅 (matcher: Bash, if: Bash(*ego-post.mjs*)).
#
# ego-browser CLI는 ego lite 데스크톱 앱에 동반되므로 자동 설치하지 않는다 —
# 부재 시 안내를 출력하고 exit 2로 해당 호출을 차단한다(호출해도 실패할 뿐이라
# 안내가 먼저 닿는 게 낫다). ego-post.mjs는 node로 돌므로 node도 함께 본다.
# ego가 있으면 조용히 통과한다.
#
# 이 훅은 편의 기능이다 — 강제력(승인 digest·하드 제약·계정 가드)은 전부
# publish.sh 안에 있다. 훅이 실패해도 조용히 무시되므로 안전 장치를 맡기지 않는다.
#
# stdin: PreToolUse 이벤트 JSON ({tool_name, tool_input: {command}, ...})

set -uo pipefail

main() {
  # stdin(PreToolUse 이벤트 JSON)은 읽어서 버린다 — 이 훅은 payload 내용을 쓰지 않는다
  cat >/dev/null

  if ! command -v ego-browser >/dev/null 2>&1; then
    cat >&2 <<'EOF'
❌ ego-browser CLI를 찾을 수 없습니다 — ego lite 데스크톱 앱 설치 후 CLI를 설정하세요.
   확인: ego-browser --version
EOF
    exit 2
  fi

  if ! command -v node >/dev/null 2>&1; then
    cat >&2 <<'EOF'
⚠️ node가 없습니다 — ego 실행 계층(ego-post.mjs)이 동작하지 않습니다. node 24 이상을 설치하세요.
EOF
  fi

  exit 0
}

main
