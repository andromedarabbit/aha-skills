#!/bin/bash
# publish.sh — 게시 가드 검증. digest·플랫폼·계정(바인딩 포함)·TOCTOU·하드 제약·
# 페이로드 분리·URL 감지 가드가 실제로 막는지. aside stub은 동결 파일을 읽어 검증한다.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PUBLISH="$SKILL_DIR/scripts/publish.sh"

sandbox="$(mktemp -d)"
cleanup() { rm -rf "$sandbox"; }
trap cleanup EXIT
export TMPDIR="$sandbox/tmp"
mkdir -p "$TMPDIR"

fail() { echo "❌ $1" >&2; exit 1; }

if ! command -v uv >/dev/null 2>&1; then
  echo "❌ 오류: uv 가 없습니다 — 하드 제약 재실행 검증을 실행할 수 없습니다" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "❌ 오류: jq 가 없습니다" >&2
  exit 1
fi

# aside stub: 호출 로그 + SOCIAL_POSTING_FROZEN 동결 파일을 캡처한다
# (publish.sh가 프롬프트에 파일 경로 대신 본문을 인라인으로 전달하므로 경로는 env로 전달된다)
mkdir -p "$sandbox/bin"
export SOCIAL_ASIDE_LOG="$sandbox/aside-calls.log"
export SOCIAL_ASIDE_PAYLOAD="$sandbox/last-payload.md"
cat >"$sandbox/bin/aside" <<'EOF'
#!/bin/bash
printf '=== aside call ===\n%s\n' "$*" >>"$SOCIAL_ASIDE_LOG"
f="${SOCIAL_POSTING_FROZEN:-}"
[ -n "$f" ] && [ -f "$f" ] && { rm -f "$SOCIAL_ASIDE_PAYLOAD"; cp "$f" "$SOCIAL_ASIDE_PAYLOAD"; }
echo "게시 완료: https://stub.example/post/1"
exit 0
EOF
chmod +x "$sandbox/bin/aside"
export PATH="$sandbox/bin:$PATH"

hash_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

aside_call_count() { { cat "$SOCIAL_ASIDE_LOG" 2>/dev/null || true; } | grep -c "^=== aside call ===$" || true; }

make_job() { # $1=dir  $2=platforms  $3=accounts
  mkdir -p "$1/drafts"
  cat >"$1/job-state.md" <<EOF
---
stage: 8
slug: t
platforms: [$2]
accounts: {$3}
status: {$2: draft}
---
EOF
}

approve() { # $1=job  $2=accounts 내부(예: "x: u0") — 승인 영수증(digest+계정 스냅샷) 작성.
  # approved_accounts는 훅이 job-state에서 캡처하는 flow-map 원문 라인(중괄호 포함) 기준
  printf '{"approved_digests":{"x":"%s"},"approved_accounts":"{%s}"}' \
    "$(hash_of "$1/drafts/x.md")" "$2" >"$1/receipt.json"
}

# --- 1. 승인 정상 → dry-run 통과(페이로드 요약), 실행은 exec 1회 + 페이로드 본문만 ---
job="$sandbox/job-ok"
make_job "$job" "x" "x: u0"
cat >"$job/drafts/x.md" <<'EOF'
---
platform: x
format: single
media:
  - path: ./plot.png
    alt: 런타임 그래프
link: https://example.com/post
---
스파크 잡을 3배 빠르게 만든 이야기
EOF
touch "$job/plot.png"
approve "$job" "x: u0"

bash "$PUBLISH" --job "$job" --platform x --dry-run >/dev/null || fail "승인 정상 dry-run이 통과해야 한다"
[ "$(aside_call_count)" = "0" ] || fail "dry-run은 aside를 호출하면 안 된다"

rm -f "$SOCIAL_ASIDE_LOG"
bash "$PUBLISH" --job "$job" --platform x >/dev/null || fail "승인 정상 실행이 실패했다"
[ "$(aside_call_count)" = "1" ] || fail "aside exec는 정확히 1회 호출되어야 한다"
last_call="$(sed -n '/^=== aside call ===$/,$p' "$SOCIAL_ASIDE_LOG" | tail -n +2)"
grep -q -- "--account u0" <<<"$last_call" || fail "job-state 계정(u0)으로 호출해야 한다"
grep -q "그대로" <<<"$last_call" || fail "변경 금지 지시가 프롬프트에 담겨야 한다"
# 페이로드 검증: 동결 파일은 본문만(frontmatter 제거), media는 절대경로 지시로 전달
[ -f "$SOCIAL_ASIDE_PAYLOAD" ] || fail "stub이 동결 파일을 캡처해야 한다"
grep -q "스파크 잡을" "$SOCIAL_ASIDE_PAYLOAD" || fail "동결 파일에 본문이 담겨야 한다"
if head -1 "$SOCIAL_ASIDE_PAYLOAD" | grep -q '^---'; then
  fail "동결 파일에 frontmatter가 남아 있으면 안 된다"
fi
if grep -q "platform: x" "$SOCIAL_ASIDE_PAYLOAD"; then
  fail "frontmatter 메타데이터가 게시 페이로드에 섞였다"
fi
grep -qF "$job/plot.png" <<<"$last_call" || fail "media 절대경로가 프롬프트에 명시되어야 한다"

# --- 1b. 프롬프트는 본문을 인라인으로 전달한다 — 파일 경로 참조 부재 (무인 read_file 정지 회피) ---
# 근본 원인(2026-09-01 실측): aside exec가 프롬프트의 TMPDIR 파일 경로를 read_file하다
# 무인 권한 확인에 무한 정지했다. 본문이 프롬프트에 직접 담기면 read_file이 일어나지 않는다.
grep -q "스파크 잡을" <<<"$last_call" || fail "게시 프롬프트에 동결 본문이 인라인으로 담겨야 한다"
if grep -q "social-posting-body" <<<"$last_call"; then
  fail "게시 프롬프트에 동결 파일 경로가 남아 있으면 안 된다 (aside read_file 정지 원인)"
fi
grep -q "게시 텍스트 시작" <<<"$last_call" || fail "인라인 본문에 시작/끝 구분 마커가 있어야 한다"

# --- 1c. 동결 파일명은 매 실행 고유하다 (mktemp 접미사 버그 회귀 방지) ---
# macOS BSD mktemp는 XXXXXX 뒤 접미사가 있으면 랜덤화하지 않는다 — 과거 병렬 실행에서
# 서로 다른 플랫폼 본문이 뒤섞여 실제 게시된 사고가 있었다.
path1="$(bash "$PUBLISH" --job "$job" --platform x --dry-run | sed -n 's/.*동결 본문: \([^ ]*\) .*/\1/p')"
path2="$(bash "$PUBLISH" --job "$job" --platform x --dry-run | sed -n 's/.*동결 본문: \([^ ]*\) .*/\1/p')"
[ -n "$path1" ] && [ -n "$path2" ] || fail "dry-run이 동결 본문 경로를 출력해야 한다: $path1 / $path2"
[ "$path1" != "$path2" ] || fail "동결 파일명이 매 실행 달라야 한다 (고정 파일명 = 병렬 실행 충돌): $path1"
case "$path1" in *XXXXXX*) fail "동결 파일명에 리터럴 XXXXXX가 남아 있으면 안 된다: $path1";; esac
grep -q "런타임 그래프" <<<"$last_call" || fail "media alt가 프롬프트에 명시되어야 한다"
grep -q "https://example.com/post" <<<"$last_call" || fail "link가 프롬프트에 명시되어야 한다"

# --- 2. digest 불일치 (승인 후 수정) → 가드 2/6 거부 ---
job2="$sandbox/job-tampered"
make_job "$job2" "x" "x: u0"
printf -- '---\nplatform: x\nformat: single\n---\n원본 문구\n' >"$job2/drafts/x.md"
approve "$job2" "x: u0"
printf -- '---\nplatform: x\nformat: single\n---\n승인 후 몰래 수정한 문구\n' >"$job2/drafts/x.md"
if bash "$PUBLISH" --job "$job2" --platform x >/dev/null 2>&1; then
  fail "승인 후 수정된 초안은 거부되어야 한다 (실패-닫힘)"
fi

# --- 3. 미승인 플랫폼 → 거부 ---
job3="$sandbox/job-unapproved"
make_job "$job3" "x" "x: u0"
printf -- '---\nplatform: x\nformat: single\n---\n본문\n' >"$job3/drafts/x.md"
printf '{}' >"$job3/receipt.json"
if bash "$PUBLISH" --job "$job3" --platform x >/dev/null 2>&1; then
  fail "승인 digest가 없으면 거부되어야 한다"
fi

# --- 4. 대상 밖 플랫폼 → 가드 1 거부 (선조기 '초안 없음'이 대신 죽지 않게 초안 생성) ---
printf -- '---\nplatform: linkedin\nformat: single\n---\n본문\n' >"$job/drafts/linkedin.md"
if bash "$PUBLISH" --job "$job" --platform linkedin >/dev/null 2>&1; then
  fail "platforms에 없는 플랫폼은 가드 1에서 거부되어야 한다"
fi
rm -f "$job/drafts/linkedin.md"

# --- 5. 계정 미지정 → 거부 ---
job5="$sandbox/job-noaccount"
make_job "$job5" "x" "linkedin: u1"
printf -- '---\nplatform: x\nformat: single\n---\n본문\n' >"$job5/drafts/x.md"
printf '{"approved_digests":{"x":"%s"},"approved_accounts":"{x: u0}"}' "$(hash_of "$job5/drafts/x.md")" >"$job5/receipt.json"
if bash "$PUBLISH" --job "$job5" --platform x >/dev/null 2>&1; then
  fail "accounts에 해당 플랫폼 계정이 없으면 거부되어야 한다"
fi

# --- 6. 승인 후 계정 변경 (계정 재타깃) → 가드 5 거부 ---
job6="$sandbox/job-retarget"
make_job "$job6" "x" "x: u1"
printf -- '---\nplatform: x\nformat: single\n---\n본문\n' >"$job6/drafts/x.md"
printf '{"approved_digests":{"x":"%s"},"approved_accounts":"{x: u0}"}' "$(hash_of "$job6/drafts/x.md")" >"$job6/receipt.json"
if bash "$PUBLISH" --job "$job6" --platform x >/dev/null 2>&1; then
  fail "승인 시점 계정(u0)과 현재(u1)가 다르면 거부되어야 한다"
fi

# --- 6b. approved_accounts 스냅샷 없음(구계약 승인) → 가드 5 거부 ---
job6b="$sandbox/job-legacy"
make_job "$job6b" "x" "x: u0"
printf -- '---\nplatform: x\nformat: single\n---\n본문\n' >"$job6b/drafts/x.md"
printf '{"approved_digests":{"x":"%s"}}' "$(hash_of "$job6b/drafts/x.md")" >"$job6b/receipt.json"
if bash "$PUBLISH" --job "$job6b" --platform x >/dev/null 2>&1; then
  fail "approved_accounts 없는 구계약 승인은 거부되어야 한다"
fi

# --- 7. 하드 제약 위반 (승인 유효) → 가드 3 거부 ---
job7="$sandbox/job-violating"
make_job "$job7" "x" "x: u0"
k141="$(printf '가%.0s' $(seq 1 141))"
printf -- '---\nplatform: x\nformat: single\n---\n%s\n' "$k141" >"$job7/drafts/x.md"
approve "$job7" "x: u0"
if bash "$PUBLISH" --job "$job7" --platform x >/dev/null 2>&1; then
  fail "하드 제약 위반(282>280)은 가드 3에서 거부되어야 한다"
fi

# --- 8. uv 부재 → fail-closed 거부 ---
nouv="$sandbox/nouv"
mkdir -p "$nouv"
ln -s "$(command -v jq)" "$nouv/jq"
ln -s "$(command -v shasum || command -v sha256sum)" "$nouv/" 2>/dev/null || true
cp "$sandbox/bin/aside" "$nouv/aside"
if PATH="$nouv:/usr/bin:/bin" bash "$PUBLISH" --job "$job" --platform x >/dev/null 2>&1; then
  fail "uv 부재 시 fail-closed로 거부되어야 한다"
fi

# --- 9. aside 실패 / URL 미반환(침묵 실패) → exit 1 ---
cat >"$sandbox/bin/aside" <<'EOF'
#!/bin/bash
echo "aside 오류" >&2
exit 1
EOF
if bash "$PUBLISH" --job "$job" --platform x >/dev/null 2>&1; then
  fail "aside 실행 실패 시 exit 1이어야 한다"
fi
cat >"$sandbox/bin/aside" <<'EOF'
#!/bin/bash
echo "게시했음 (URL 없음)"
exit 0
EOF
if bash "$PUBLISH" --job "$job" --platform x >/dev/null 2>&1; then
  fail "URL 미반환(침묵 실패) 시 exit 1이어야 한다"
fi

# --- 10. 스레드 게시: 답글 체인 지시 + 세그먼트 수만큼 URL ---
cat >"$sandbox/bin/aside" <<'EOF'
#!/bin/bash
printf '=== aside call ===\n%s\n' "$*" >>"$SOCIAL_ASIDE_LOG"
# 동결 파일은 0400이라 cp가 대상 모드까지 물려받는다 — 재캡처를 위해 먼저 지운다
f="${SOCIAL_POSTING_FROZEN:-}"
if [ -n "$f" ] && [ -f "$f" ]; then rm -f "$SOCIAL_ASIDE_PAYLOAD"; cp "$f" "$SOCIAL_ASIDE_PAYLOAD"; fi
printf '1/3 https://stub.example/post/1\n2/3 https://stub.example/post/2\n3/3 https://stub.example/post/3\n'
exit 0
EOF
job10="$sandbox/job-thread"
make_job "$job10" "x" "x: u0"
cat >"$job10/drafts/x.md" <<'EOF'
---
platform: x
format: thread
media:
  - path: ./plot.png
    alt: 런타임 그래프
---
첫 게시물 훅

=== POST ===

두 번째 게시물

=== POST ===

세 번째 게시물(클로저)
EOF
touch "$job10/plot.png"
approve "$job10" "x: u0"
rm -f "$SOCIAL_ASIDE_LOG"
bash "$PUBLISH" --job "$job10" --platform x >/dev/null || fail "스레드 3세그먼트·URL 3개는 통과해야 한다"
last_call="$(sed -n '/^=== aside call ===$/,$p' "$SOCIAL_ASIDE_LOG" | tail -n +2)"
grep -q "답글로" <<<"$last_call" || fail "thread 프롬프트에 답글 체인 지시가 담겨야 한다"
grep -q "하나의 스레드" <<<"$last_call" || fail "thread 프롬프트에 스레드 연결 지시가 담겨야 한다"
grep -q "첫 게시물에만 첨부" <<<"$last_call" || fail "thread+미디어는 첫 게시물 첨부 지시가 담겨야 한다"
# 동결 페이로드는 구분자를 유지한 본문만
grep -q "=== POST ===" "$SOCIAL_ASIDE_PAYLOAD" || fail "동결 파일에 스레드 구분자가 유지되어야 한다"

# --- 11. 스레드 부분 게시: URL이 세그먼트 수보다 적으면 exit 1 ---
cat >"$sandbox/bin/aside" <<'EOF'
#!/bin/bash
echo "게시 완료: https://stub.example/post/1 https://stub.example/post/2"
exit 0
EOF
if bash "$PUBLISH" --job "$job10" --platform x >/dev/null 2>&1; then
  fail "세그먼트 3개인데 URL 2개면 부분 게시 가능성 — exit 1이어야 한다"
fi

# --- 12. single 회귀: single 프롬프트에는 답글 지시가 없다 ---
cat >"$sandbox/bin/aside" <<'EOF'
#!/bin/bash
printf '=== aside call ===\n%s\n' "$*" >>"$SOCIAL_ASIDE_LOG"
echo "게시 완료: https://stub.example/single/1"
exit 0
EOF
rm -f "$SOCIAL_ASIDE_LOG"
bash "$PUBLISH" --job "$job" --platform x >/dev/null || fail "single 정상 게시가 실패했다"
last_call="$(sed -n '/^=== aside call ===$/,$p' "$SOCIAL_ASIDE_LOG" | tail -n +2)"
if grep -q "답글로" <<<"$last_call"; then
  fail "single 프롬프트에는 답글 체인 지시가 없어야 한다"
fi

# --- 13. aside exec 무한 정지는 상한 타임아웃으로 기명 실패한다 ---
# 과거(2026-09-01) 무인 read_file 권한 정지가 수 분~15분 이상 프로세스를 물고 있었다.
cat >"$sandbox/bin/aside" <<'EOF'
#!/bin/bash
sleep 8
echo "게시 완료: https://stub.example/late/1"
exit 0
EOF
if SOCIAL_ASIDE_TIMEOUT=2 bash "$PUBLISH" --job "$job" --platform x >/dev/null 2>&1; then
  fail "타임아웃 내 완료 못 한 aside exec는 exit 1이어야 한다"
fi

# --- 14. Facebook 공개 범위: visibility가 게시 지시에 반영된다 (keep이면 지시 없음) ---
# 테스트 13의 sleep stub은 로그를 남기지 않으므로 여기서 로깅 stub을 다시 설치한다
cat >"$sandbox/bin/aside" <<'EOF'
#!/bin/bash
printf '=== aside call ===\n%s\n' "$*" >>"$SOCIAL_ASIDE_LOG"
echo "게시 완료: https://stub.example/fb/1"
exit 0
EOF
job14="$sandbox/job-visibility"
make_job "$job14" "facebook" "facebook: u0"
printf -- '---\nplatform: facebook\nformat: single\nvisibility: friends\n---\n본문\n' >"$job14/drafts/facebook.md"
printf '{"approved_digests":{"facebook":"%s"},"approved_accounts":"{facebook: u0}"}' \
  "$(hash_of "$job14/drafts/facebook.md")" >"$job14/receipt.json"
rm -f "$SOCIAL_ASIDE_LOG"
bash "$PUBLISH" --job "$job14" --platform facebook >/dev/null || fail "visibility 게시가 실패했다"
last_call="$(sed -n '/^=== aside call ===$/,$p' "$SOCIAL_ASIDE_LOG" | tail -n +2)"
grep -q "친구'만 보도록" <<<"$last_call" || fail "visibility: friends는 공개 범위 지시가 프롬프트에 담겨야 한다"
# keep(기본): visibility 없으면 지시가 없다 — 계정 기본 설정을 조용히 따린다
printf -- '---\nplatform: facebook\nformat: single\n---\n본문\n' >"$job14/drafts/facebook.md"
printf '{"approved_digests":{"facebook":"%s"},"approved_accounts":"{facebook: u0}"}' \
  "$(hash_of "$job14/drafts/facebook.md")" >"$job14/receipt.json"
rm -f "$SOCIAL_ASIDE_LOG"
bash "$PUBLISH" --job "$job14" --platform facebook >/dev/null || fail "keep 게시가 실패했다"
last_call="$(sed -n '/^=== aside call ===$/,$p' "$SOCIAL_ASIDE_LOG" | tail -n +2)"
if grep -q "공개 범위" <<<"$last_call"; then
  fail "visibility가 없으면(keep) 공개 범위 지시가 없어야 한다"
fi

echo "✅ publish.test.sh 통과"
