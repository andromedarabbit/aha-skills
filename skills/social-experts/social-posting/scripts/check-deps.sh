#!/bin/bash
# check-deps.sh - PreToolUse 훅 (matcher: Bash, if: Bash(aside *)).
#
# aside는 Aside 데스크톱 앱에 동반되는 CLI라 자동 설치하지 않는다 — 부재 시
# 안내를 출력하고 exit 2로 해당 aside 호출을 차단한다(호출해도 실패할 뿐이라
# 안내가 먼저 닿는 게 낫다). aside가 있으면 조용히 통과한다.
#
# 이 훅은 편의 기능이다 — 강제력(승인 digest·하드 제약·계정 가드)은 전부
# publish.sh 안에 있다. 훅이 실패해도 조용히 무시되므로 안전 장치를 맡기지 않는다.
#
# stdin: PreToolUse 이벤트 JSON ({tool_name, tool_input: {command}, ...})

set -uo pipefail

main() {
  # stdin(PreToolUse 이벤트 JSON)은 읽어서 버린다 — 이 훅은 payload 내용을 쓰지 않는다
  cat >/dev/null

  if ! command -v aside >/dev/null 2>&1; then
    cat >&2 <<'EOF'
❌ aside CLI를 찾을 수 없습니다 — Aside 데스크톱 앱 설치 후 CLI를 설정하세요.
   문서: https://docs.aside.com
   확인: aside --version
EOF
    exit 2
  fi

  # 계정이 하나도 없으면 게시·부트스트랩이 모두 실패한다 — 미리 알린다 (차단은 안 한다)
  if ! aside account list >/dev/null 2>&1; then
    cat >&2 <<'EOF'
⚠️ aside 계정 목록을 가져올 수 없습니다 — Aside 앱이 실행 중인지, 계정이 로그인돼 있는지 확인하세요.
   확인: aside account list
EOF
  fi

  exit 0
}

main
