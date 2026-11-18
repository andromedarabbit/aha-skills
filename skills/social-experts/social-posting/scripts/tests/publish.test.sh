#!/bin/bash
# publish.sh — 게시 가드 검증. digest·플랫폼·계정(ego 신원)·TOCTOU·하드 제약·
# 페이로드 조립·ego 결과 판정(POSTED/PARTIAL/POST_FAILED)이 실제로 막는지.
# SOCIAL_EGO_POST 심(stub)이 stdin 페이로드를 캡처해 검증한다.
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
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

# ego-post 심: payload JSON을 stdin으로 받아 계약(로그 1줄 + 결과 JSON 1줄)을 흉내낸다.
# SOCIAL_EGO_RESULT로 시나리오를 바꾼다(기본: URL 회수 성공 POSTED).
export SOCIAL_EGO_POST="$sandbox/bin/ego-post-stub.sh"
export SOCIAL_EGO_LOG="$sandbox/ego-calls.log"
export SOCIAL_EGO_PAYLOAD="$sandbox/last-payload.json"
mkdir -p "$sandbox/bin"
cat >"$SOCIAL_EGO_POST" <<'EOF'
#!/bin/bash
printf '=== ego-post call ===\n' >>"$SOCIAL_EGO_LOG"
cat >"${SOCIAL_EGO_PAYLOAD:-/dev/null}"
r="${SOCIAL_EGO_RESULT:-}"
if [ -z "$r" ]; then
  r='{"status":"POSTED","urls":["https://stub.example/post/1"],"urlRecovered":true,"identity":"me"}'
fi
printf '%s\n' "$r"
exit "${SOCIAL_EGO_EXIT:-0}"
EOF
chmod +x "$SOCIAL_EGO_POST"

hash_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

ego_call_count() { { cat "$SOCIAL_EGO_LOG" 2>/dev/null || true; } | grep -c "^=== ego-post call ===$" || true; }

make_job() { # $1=dir  $2=platforms  $3=accounts(ego 신원)
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

approve() { # $1=job  $2=platform  $3=accounts 내부(예: "x: me")
  printf '{"approved_digests":{"%s":"%s"},"approved_accounts":"{%s}"}' \
    "$2" "$(hash_of "$1/drafts/$2.md")" "$3" >"$1/receipt.json"
}

payload_field() { jq -r "$1" "$SOCIAL_EGO_PAYLOAD"; }

# --- 1. 승인 정상 → dry-run 통과, 실행은 ego-post 1회 + 페이로드 검증 ---
job="$sandbox/job-ok"
make_job "$job" "x" "x: me"
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
approve "$job" x "x: me"

bash "$PUBLISH" --job "$job" --platform x --dry-run >/dev/null || fail "승인 정상 dry-run이 통과해야 한다"
[ "$(ego_call_count)" = "0" ] || fail "dry-run은 ego 실행 계층을 호출하면 안 된다"

rm -f "$SOCIAL_EGO_LOG"
bash "$PUBLISH" --job "$job" --platform x >/dev/null || fail "승인 정상 실행이 실패했다"
[ "$(ego_call_count)" = "1" ] || fail "ego-post는 정확히 1회 호출되어야 한다"
# 페이로드 검증: 본문은 frontmatter 제거 원문, media 절대경로+alt, link, ego 신원
[ -f "$SOCIAL_EGO_PAYLOAD" ] || fail "심이 payload JSON을 캡처해야 한다"
[ "$(payload_field '.platform')" = "x" ] || fail "payload에 platform이 담겨야 한다"
[ "$(payload_field '.body')" = "스파크 잡을 3배 빠르게 만든 이야기" ] || fail "payload 본문이 초안 원문(frontmatter 제거)이어야 한다"
[ "$(payload_field '.identity')" = "me" ] || fail "job-state 계정(ego 신원 me)이 payload.identity로 전달되어야 한다"
[ "$(payload_field '.media[0].path')" = "$job/plot.png" ] || fail "media 절대경로가 payload에 담겨야 한다"
[ "$(payload_field '.media[0].alt')" = "런타임 그래프" ] || fail "media alt가 payload에 담겨야 한다"
[ "$(payload_field '.link')" = "https://example.com/post" ] || fail "link가 payload에 담겨야 한다"

# --- 1b. payload는 본문을 JSON 데이터로 인라인 전달 — 파일 경로 참조 부재 ---
if grep -q "social-posting-body" "$SOCIAL_EGO_PAYLOAD"; then
  fail "payload에 동결 파일 경로가 남아 있으면 안 된다"
fi

# 혼합 기존 job: X만 승인·게시하며 무관한 Facebook 초안은 검사하지 않는다.
mixed_job="$sandbox/job-mixed"
make_job "$mixed_job" "x, facebook" "x: me, facebook: other"
printf -- '---\nplatform: x\nformat: single\n---\nX만 게시할 본문\n' >"$mixed_job/drafts/x.md"
printf -- '---\nplatform: facebook\nmedia: [\n---\n미완성 Facebook 초안\n' >"$mixed_job/drafts/facebook.md"
selected_json='{"tool_name":"AskUserQuestion","tool_input":{"questions":[{"question":"게시 대상: x","header":"게시 승인"}]},"tool_response":{"answers":{"게시 대상: x":"게시"}}}'
printf '%s' "$selected_json" | SOCIAL_POSTING_JOB="$mixed_job" bash "$SKILL_DIR/scripts/record-approval.sh"
mixed_state_before="$(hash_of "$mixed_job/job-state.md")"
facebook_before="$(hash_of "$mixed_job/drafts/facebook.md")"
before_calls="$(ego_call_count)"
bash "$PUBLISH" --job "$mixed_job" --platform x >/dev/null || fail "무관한 Facebook 초안의 파싱 오류가 X 게시를 막으면 안 된다"
[ "$(ego_call_count)" -eq "$((before_calls + 1))" ] || fail "혼합 job에서도 X만 한 번 실행해야 한다"
[ "$(payload_field '.platform')" = x ] || fail "선택한 X만 실행층에 전달해야 한다"
[ "$(hash_of "$mixed_job/job-state.md")" = "$mixed_state_before" ] || fail "단독 게시 때문에 job 범위를 축소하면 안 된다"
[ "$(hash_of "$mixed_job/drafts/facebook.md")" = "$facebook_before" ] || fail "다른 플랫폼 초안을 수정하거나 삭제하면 안 된다"
printf -- '---\nplatform: facebook\nformat: single\n---\nFacebook 본문\n' >"$mixed_job/drafts/facebook.md"
before_calls="$(ego_call_count)"
if bash "$PUBLISH" --job "$mixed_job" --platform facebook >"$sandbox/unselected-result" 2>&1; then fail "같은 job이어도 표시하지 않은 Facebook 게시는 거부해야 한다"; fi
grep -q '승인 digest' "$sandbox/unselected-result" || fail "선택 범위 밖 게시를 승인 가드에서 거부해야 한다"
[ "$(ego_call_count)" = "$before_calls" ] || fail "미승인 Facebook은 실행층에 도달하면 안 된다"
make_job "$mixed_job" "x, facebook" "x: me, facebook: changed"
if bash "$PUBLISH" --job "$mixed_job" --platform x >"$sandbox/accounts-result" 2>&1; then fail "선택하지 않은 계정 변경도 전체 승인 스냅샷 가드가 막아야 한다"; fi
grep -q '승인 시점 계정 매핑' "$sandbox/accounts-result" || fail "무관한 계정도 기존 전체 스냅샷으로 검사해야 한다"
[ "$(ego_call_count)" = "$before_calls" ] || fail "계정 변경은 실행 전에 거부해야 한다"
make_job "$mixed_job" "x, facebook" "x: me, facebook: other"
legacy_receipt_before="$(hash_of "$mixed_job/receipt.json")"
bash "$PUBLISH" --job "$mixed_job" --platform x --dry-run >/dev/null || fail "같은 범위의 기존 영수증으로 재개할 수 있어야 한다"
[ "$(hash_of "$mixed_job/receipt.json")" = "$legacy_receipt_before" ] || fail "기존 영수증은 재개 시 재작성하거나 삭제하면 안 된다"
expanded_json='{"tool_name":"AskUserQuestion","tool_input":{"questions":[{"question":"게시 대상: x,facebook","header":"게시 승인"}]},"tool_response":{"answers":{"게시 대상: x,facebook":"게시"}}}'
printf '%s' "$expanded_json" | SOCIAL_POSTING_JOB="$mixed_job" bash "$SKILL_DIR/scripts/record-approval.sh"
bash "$PUBLISH" --job "$mixed_job" --platform facebook --dry-run >/dev/null || fail "새 범위의 명시적 승인 뒤 Facebook 게시 가드가 통과해야 한다"

# --- 1c. 동결 파일명은 매 실행 고유하다 (mktemp 접미사 버그 회귀 방지) ---
# macOS BSD mktemp는 XXXXXX 뒤 접미사가 있으면 랜덤화하지 않는다 — 과거 병렬 실행에서
# 서로 다른 플랫폼 본문이 뒤섞여 실제 게시된 사고가 있었다.
path1="$(bash "$PUBLISH" --job "$job" --platform x --dry-run | sed -n 's/.*동결 본문: \([^ ]*\) .*/\1/p')"
path2="$(bash "$PUBLISH" --job "$job" --platform x --dry-run | sed -n 's/.*동결 본문: \([^ ]*\) .*/\1/p')"
[ -n "$path1" ] && [ -n "$path2" ] || fail "dry-run이 동결 본문 경로를 출력해야 한다: $path1 / $path2"
[ "$path1" != "$path2" ] || fail "동결 파일명이 매 실행 달라야 한다 (고정 파일명 = 병렬 실행 충돌): $path1"
case "$path1" in *XXXXXX*) fail "동결 파일명에 리터럴 XXXXXX가 남아 있으면 안 된다: $path1";; esac

# --- 2. digest 불일치 (승인 후 수정) → 가드 2/6 거부 ---
job2="$sandbox/job-tampered"
make_job "$job2" "x" "x: me"
printf -- '---\nplatform: x\nformat: single\n---\n원본 문구\n' >"$job2/drafts/x.md"
approve "$job2" x "x: me"
printf -- '---\nplatform: x\nformat: single\n---\n승인 후 몰래 수정한 문구\n' >"$job2/drafts/x.md"
if bash "$PUBLISH" --job "$job2" --platform x >/dev/null 2>&1; then
  fail "승인 후 수정된 초안은 거부되어야 한다 (실패-닫힘)"
fi

# --- 3. 미승인 플랫폼 → 거부 ---
job3="$sandbox/job-unapproved"
make_job "$job3" "x" "x: me"
printf -- '---\nplatform: x\nformat: single\n---\n본문\n' >"$job3/drafts/x.md"
printf '{}' >"$job3/receipt.json"
if bash "$PUBLISH" --job "$job3" --platform x >/dev/null 2>&1; then
  fail "승인 digest가 없으면 거부되어야 한다"
fi

# --- 4. 대상 밖 플랫폼 → 가드 1 거부 ---
printf -- '---\nplatform: linkedin\nformat: single\n---\n본문\n' >"$job/drafts/linkedin.md"
if bash "$PUBLISH" --job "$job" --platform linkedin >/dev/null 2>&1; then
  fail "platforms에 없는 플랫폼은 가드 1에서 거부되어야 한다"
fi
rm -f "$job/drafts/linkedin.md"

# --- 5. 계정(ego 신원) 미지정 → 거부 ---
job5="$sandbox/job-noaccount"
make_job "$job5" "x" "linkedin: someone"
printf -- '---\nplatform: x\nformat: single\n---\n본문\n' >"$job5/drafts/x.md"
printf '{"approved_digests":{"x":"%s"},"approved_accounts":"{x: me}"}' "$(hash_of "$job5/drafts/x.md")" >"$job5/receipt.json"
if bash "$PUBLISH" --job "$job5" --platform x >/dev/null 2>&1; then
  fail "accounts에 해당 플랫폼 신원이 없으면 거부되어야 한다"
fi

# --- 6. 승인 후 계정 변경 (계정 재타깃) → 가드 5 거부 ---
job6="$sandbox/job-retarget"
make_job "$job6" "x" "x: other-handle"
printf -- '---\nplatform: x\nformat: single\n---\n본문\n' >"$job6/drafts/x.md"
printf '{"approved_digests":{"x":"%s"},"approved_accounts":"{x: me}"}' "$(hash_of "$job6/drafts/x.md")" >"$job6/receipt.json"
if bash "$PUBLISH" --job "$job6" --platform x >/dev/null 2>&1; then
  fail "승인 시점 신원(me)과 현재(other-handle)가 다르면 거부되어야 한다"
fi

# --- 6b. approved_accounts 스냅샷 없음(구계약 승인) → 가드 5 거부 ---
job6b="$sandbox/job-legacy"
make_job "$job6b" "x" "x: me"
printf -- '---\nplatform: x\nformat: single\n---\n본문\n' >"$job6b/drafts/x.md"
printf '{"approved_digests":{"x":"%s"}}' "$(hash_of "$job6b/drafts/x.md")" >"$job6b/receipt.json"
if bash "$PUBLISH" --job "$job6b" --platform x >/dev/null 2>&1; then
  fail "approved_accounts 없는 구계약 승인은 거부되어야 한다"
fi

# --- 7. 하드 제약 위반 (승인 유효) → 가드 3 거부 ---
job7="$sandbox/job-violating"
make_job "$job7" "x" "x: me"
k141="$(printf '가%.0s' $(seq 1 141))"
printf -- '---\nplatform: x\nformat: single\n---\n%s\n' "$k141" >"$job7/drafts/x.md"
approve "$job7" x "x: me"
if bash "$PUBLISH" --job "$job7" --platform x >/dev/null 2>&1; then
  fail "하드 제약 위반(282>280)은 가드 3에서 거부되어야 한다"
fi

# --- 7b. 승인 후 scan media 교체 → 가드 7 거부 ---
job7b="$sandbox/job-media-tampered"
make_job "$job7b" "x" "x: me"
mkdir -p "$job7b/media"
printf 'image-bytes' >"$job7b/media/photo.png"
media_digest="$(hash_of "$job7b/media/photo.png")"
cat >"$job7b/media/$media_digest.provenance.json" <<EOF
{"sourceUrl":"https://cdn.example.test/photo.png","finalUrl":"https://cdn.example.test/photo.png","sourcePostUrl":"https://social.example.test/post/1","publisher":"publisher","observedAt":"2026-11-15T00:00:00Z","alt":"설명","contentType":"image/png","sha256":"$media_digest","bytes":11}
EOF
provenance_digest="$(hash_of "$job7b/media/$media_digest.provenance.json")"
cat >"$job7b/drafts/x.md" <<EOF
---
platform: x
format: single
media:
  - path: ./media/photo.png
    alt: 설명
    source: scan
    sha256: $media_digest
    provenance: ./media/$media_digest.provenance.json
    provenance_sha256: $provenance_digest
---
본문
EOF
approve "$job7b" x "x: me"
bash "$PUBLISH" --job "$job7b" --platform x --dry-run >/dev/null || fail "변조 전 scan 사진은 가드를 통과해야 한다"
cp "$job7b/media/$media_digest.provenance.json" "$sandbox/provenance-original.json"
jq '.publisher = "changed-author"' "$sandbox/provenance-original.json" >"$job7b/media/$media_digest.provenance.json"
before_calls="$(ego_call_count)"
if bash "$PUBLISH" --job "$job7b" --platform x >/dev/null 2>&1; then fail "승인 뒤 출처 변경은 게시 전에 거부해야 한다"; fi
[ "$(ego_call_count)" = "$before_calls" ] || fail "출처 변경 뒤 실행 계층을 호출하면 안 된다"
cp "$sandbox/provenance-original.json" "$job7b/media/$media_digest.provenance.json"
printf 'replacement' >"$job7b/media/photo.png"
if bash "$PUBLISH" --job "$job7b" --platform x >/dev/null 2>&1; then
  fail "승인 뒤 교체한 scan media는 가드 7에서 거부되어야 한다"
fi

# --- 7c. 라이브 신원 확인 중 원본을 바꿔도 승인 사본만 실행하며 성공·실패 뒤 정리한다 ---
cp "$SOCIAL_EGO_POST" "$sandbox/ego-post-original.sh"
export SCAN_ORIGINAL_MEDIA="$job7b/media/photo.png"
export SCAN_ORIGINAL_PROVENANCE="$job7b/media/$media_digest.provenance.json"
export SCAN_OBSERVED="$sandbox/snapshot-observed"
cat >"$SOCIAL_EGO_POST" <<'EOF'
#!/bin/bash
set -euo pipefail
cat >"$SOCIAL_EGO_PAYLOAD"
# 실제 실행층의 라이브 신원 확인이 끝난 뒤 업로드가 원본을 다시 읽는 시점을 재현한다.
printf 'replacement-during-identity-check' >"$SCAN_ORIGINAL_MEDIA"
printf '{"publisher":"replacement"}' >"$SCAN_ORIGINAL_PROVENANCE"
snapshot="$(jq -r '.media[0].path' "$SOCIAL_EGO_PAYLOAD")"
cp "$snapshot" "$SCAN_OBSERVED"
cp "$(dirname "$snapshot")/0.provenance.json" "$SCAN_OBSERVED.provenance.json"
printf '%s\n' "$SOCIAL_EGO_RESULT"
exit "${SOCIAL_EGO_EXIT:-0}"
EOF
for outcome in success failure; do
  printf 'image-bytes' >"$SCAN_ORIGINAL_MEDIA"
  cp "$sandbox/provenance-original.json" "$SCAN_ORIGINAL_PROVENANCE"
  export SOCIAL_EGO_RESULT='{"status":"POSTED","urls":["https://stub.example/post/1"],"urlRecovered":true}'
  export SOCIAL_EGO_EXIT=0
  if [[ "$outcome" == failure ]]; then
    export SOCIAL_EGO_RESULT='{"status":"POST_FAILED","reason":"EGO_NEEDS_LOGIN"}'
    export SOCIAL_EGO_EXIT=1
  fi
  if bash "$PUBLISH" --job "$job7b" --platform x >"$sandbox/freeze-$outcome.log" 2>&1; then
    [[ "$outcome" == success ]] || fail "실행 실패가 성공으로 보고됐다"
  else
    [[ "$outcome" == failure ]] || fail "승인 사본 실행이 실패했다"
  fi
  snapshot="$(payload_field '.media[0].path')"
  [[ "$snapshot" != "$SCAN_ORIGINAL_MEDIA" ]] || fail "scan 사진의 원본 경로를 실행층에 전달하면 안 된다"
  [[ "$(hash_of "$SCAN_OBSERVED")" == "$media_digest" ]] || fail "신원 확인 중 원본이 바뀌어도 승인 bytes만 업로드해야 한다"
  [[ "$(hash_of "$SCAN_OBSERVED.provenance.json")" == "$provenance_digest" ]] || fail "출처도 승인된 동일 스냅샷에 보존해야 한다"
  [[ ! -e "$(dirname "$(dirname "$snapshot")")" ]] || fail "$outcome 뒤 사진·출처 임시디렉터리를 정리해야 한다"
done
cp "$sandbox/ego-post-original.sh" "$SOCIAL_EGO_POST"
unset SCAN_ORIGINAL_MEDIA SCAN_ORIGINAL_PROVENANCE SCAN_OBSERVED SOCIAL_EGO_RESULT SOCIAL_EGO_EXIT

# --- 8. node 부재 & 심 없음 → fail-closed 거부 ---
nouv="$sandbox/nonode"
mkdir -p "$nouv"
ln -s "$(command -v jq)" "$nouv/jq"
ln -s "$(command -v shasum || command -v sha256sum)" "$nouv/" 2>/dev/null || true
if env -u SOCIAL_EGO_POST PATH="$nouv:/usr/bin:/bin" bash "$PUBLISH" --job "$job" --platform x >/dev/null 2>&1; then
  fail "node 부재 시 fail-closed로 거부되어야 한다"
fi

# --- 9. POST_FAILED → exit 1 / PARTIAL_POSTED → exit 1 (이미 게시된 URL 노출) ---
export SOCIAL_EGO_RESULT='{"status":"POST_FAILED","reason":"EGO_NEEDS_LOGIN"}'
if bash "$PUBLISH" --job "$job" --platform x >/dev/null 2>&1; then
  fail "ego-post POST_FAILED는 exit 1이어야 한다"
fi
export SOCIAL_EGO_EXIT=1
export SOCIAL_EGO_RESULT='{"status":"PARTIAL_POSTED","postedCount":1,"urls":["https://stub.example/post/1"],"reason":"EGO_EVIDENCE_MISSING"}'
if bash "$PUBLISH" --job "$job" --platform x >/dev/null 2>&1; then
  fail "부분 게시(PARTIAL_POSTED)는 exit 1이어야 한다"
fi
out="$(bash "$PUBLISH" --job "$job" --platform x 2>&1 || true)"
grep -q "stub.example/post/1" <<<"$out" || fail "부분 게시 메시지에 이미 게시된 URL이 담겨야 한다"
grep -q "재시도 금지" <<<"$out" || fail "부분 게시 메시지에 재시도 금지 지시가 담겨야 한다"
export SOCIAL_EGO_RESULT='{"status":"POST_UNKNOWN","postedCount":0,"urls":[],"reason":"EGO_TIMEOUT"}'
out="$(bash "$PUBLISH" --job "$job" --platform x 2>&1 || true)"
grep -q '재시도 금지' <<<"$out" || fail "결과 불명은 재시도 금지를 명시해야 한다"
if grep -q '게시되지 않았을 가능성이 크다' <<<"$out"; then fail "결과 불명을 미게시로 추정하면 안 된다"; fi
unset SOCIAL_EGO_RESULT SOCIAL_EGO_EXIT

# --- 10. POSTED + URL 회수 실패 → exit 0 + 경고 (중복 게시 재시도 차단) ---
export SOCIAL_EGO_RESULT='{"status":"POSTED","urls":[],"urlRecovered":false,"identity":"me"}'
out="$(bash "$PUBLISH" --job "$job" --platform x 2>&1)" || fail "URL 회수 실패는 게시가 성립했으므로 exit 0이어야 한다"
grep -q "URL 회수에 실패" <<<"$out" || fail "URL 회수 실패 경고가 출력되어야 한다"
unset SOCIAL_EGO_RESULT

# --- 11. 심 출력이 JSON이 아니면(침묵 실패) exit 1 ---
cat >"$SOCIAL_EGO_POST" <<'EOF'
#!/bin/bash
cat >/dev/null
echo "알 수 없는 출력"
exit 0
EOF
if bash "$PUBLISH" --job "$job" --platform x >/dev/null 2>&1; then
  fail "ego-post 출력이 JSON이 아니면 exit 1이어야 한다"
fi

# 심 복구
cat >"$SOCIAL_EGO_POST" <<'EOF'
#!/bin/bash
printf '=== ego-post call ===\n' >>"$SOCIAL_EGO_LOG"
cat >"${SOCIAL_EGO_PAYLOAD:-/dev/null}"
r="${SOCIAL_EGO_RESULT:-}"
if [ -z "$r" ]; then
  r='{"status":"POSTED","urls":["https://stub.example/post/1"],"urlRecovered":true,"identity":"me"}'
fi
printf '%s\n' "$r"
exit "${SOCIAL_EGO_EXIT:-0}"
EOF
chmod +x "$SOCIAL_EGO_POST"

# --- 12. 스레드 게시: 세그먼트 3개 페이로드 + URL 3개 POSTED → exit 0 ---
job12="$sandbox/job-thread"
make_job "$job12" "x" "x: me"
cat >"$job12/drafts/x.md" <<'EOF'
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
touch "$job12/plot.png"
approve "$job12" x "x: me"
export SOCIAL_EGO_RESULT='{"status":"POSTED","urls":["https://stub.example/post/1","https://stub.example/post/2","https://stub.example/post/3"],"urlRecovered":true,"identity":"me"}'
rm -f "$SOCIAL_EGO_LOG"
bash "$PUBLISH" --job "$job12" --platform x >/dev/null || fail "스레드 3세그먼트·URL 3개는 통과해야 한다"
[ "$(payload_field '.format')" = "thread" ] || fail "thread format이 payload에 담겨야 한다"
[ "$(payload_field '.body' | grep -c '=== POST ===')" = "2" ] || fail "동결 페이로드에 스레드 구분자가 유지되어야 한다"
unset SOCIAL_EGO_RESULT

# --- 13. Facebook 공개 범위: visibility가 payload에 그대로 실린다 ---
job13="$sandbox/job-visibility"
make_job "$job13" "facebook" "facebook: me"
printf -- '---\nplatform: facebook\nformat: single\nvisibility: friends\n---\n본문\n' >"$job13/drafts/facebook.md"
approve "$job13" facebook "facebook: me"
export SOCIAL_EGO_RESULT='{"status":"POSTED","urls":["https://stub.example/fb/1"],"urlRecovered":true,"identity":"me"}'
bash "$PUBLISH" --job "$job13" --platform facebook >/dev/null || fail "visibility 게시가 실패했다"
[ "$(payload_field '.visibility')" = "friends" ] || fail "visibility: friends가 payload에 담겨야 한다"
# keep(기본): visibility 없으면 keep으로 직렬화된다 — ego가 계정 기본 설정을 따른다
printf -- '---\nplatform: facebook\nformat: single\n---\n본문\n' >"$job13/drafts/facebook.md"
approve "$job13" facebook "facebook: me"
bash "$PUBLISH" --job "$job13" --platform facebook >/dev/null || fail "keep 게시가 실패했다"
[ "$(payload_field '.visibility')" = "keep" ] || fail "visibility 없음은 keep으로 전달되어야 한다"
unset SOCIAL_EGO_RESULT

# 미검증 Threads는 승인과 테스트 심이 있어도 실행 계층에 도달하지 않는다.
job_threads="$sandbox/job-threads-blocked"
make_job "$job_threads" "threads" "threads: me"
printf -- '---\nplatform: threads\nformat: single\n---\n준비한 본문\n' >"$job_threads/drafts/threads.md"
approve "$job_threads" threads "threads: me"
before_calls="$(ego_call_count)"
if bash "$PUBLISH" --job "$job_threads" --platform threads >"$sandbox/threads-result" 2>&1; then fail "Threads 쓰기는 검증 전 차단돼야 한다"; fi
grep -q 'THREADS_UNVERIFIED' "$sandbox/threads-result" || fail "Threads 차단 이유를 명시해야 한다"
[ "$(ego_call_count)" = "$before_calls" ] || fail "Threads는 테스트 심으로도 게시할 수 없어야 한다"

echo "✅ publish.test.sh 통과"
