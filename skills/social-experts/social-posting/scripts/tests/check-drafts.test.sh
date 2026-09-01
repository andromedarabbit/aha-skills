#!/bin/bash
# check-drafts.py — 하드 제약 검사기 검증. 가중 길이·grapheme·alt·스레드·fail-closed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHECK="$SKILL_DIR/scripts/check-drafts.py"

sandbox="$(mktemp -d)"
trap 'rm -rf "$sandbox"' EXIT

fail() { echo "❌ $1" >&2; exit 1; }

if ! command -v uv >/dev/null 2>&1; then
  echo "❌ 오류: uv 가 없습니다 — 하드 제약 검사(grapheme 계산)를 실행할 수 없습니다" >&2
  echo "      설치: curl -LsSf https://astral.sh/uv/install.sh | sh" >&2
  exit 1
fi

run_check() { uv run -q --with grapheme --with pyyaml python "$CHECK" "$1"; }
post_count() { uv run -q --with grapheme --with pyyaml python "$CHECK" "$1" | jq -r ".platforms.$2.counts[0]"; }

# --- 1. 정상 초안 → exit 0 ---
job="$sandbox/job-ok"; mkdir -p "$job/drafts"
cat >"$job/drafts/x.md" <<'EOF'
---
platform: x
format: single
---
스파크 잡 하나를 3배 빠르게 만들었다. 비결은 코드가 아니라 파티션 수였다.
EOF
cat >"$job/drafts/bluesky.md" <<'EOF'
---
platform: bluesky
format: single
media:
  - path: ./plot.png
    alt: 파티션 수별 런타임 그래프
---
재미있는 트레이드오프를 찾았다.
EOF
run_check "$job" >/dev/null || fail "정상 초안이 exit 0이어야 한다"

# --- 2. X 가중 길이: 한글 140자 = 280 (통과), 141자 = 282 (실패) ---
job2="$sandbox/job-x"; mkdir -p "$job2/drafts"
k140="$(printf '가%.0s' $(seq 1 140))"
k141="$(printf '가%.0s' $(seq 1 141))"
printf -- '---\nplatform: x\nformat: single\n---\n%s\n' "$k140" >"$job2/drafts/x.md"
[ "$(post_count "$job2" x)" = "280" ] || fail "한글 140자의 weighted 길이는 280이어야 한다"
printf -- '---\nplatform: x\nformat: single\n---\n%s\n' "$k141" >"$job2/drafts/x.md"
if run_check "$job2" >/dev/null 2>&1; then fail "한글 141자(282)는 상한 초과 — exit 1이어야 한다"; fi

# --- 3. X URL은 23 고정 ---
k100="$(printf '가%.0s' $(seq 1 100))"
printf -- '---\nplatform: x\nformat: single\n---\n%s https://example.com/very/long/path\n' "$k100" >"$job2/drafts/x.md"
# 100*2 + 1(공백) + 23 = 224
[ "$(post_count "$job2" x)" = "224" ] || fail "URL 23 고정 가중이 적용되지 않았다: $(post_count "$job2" x)"

# --- 4. Bluesky grapheme: ZWJ 이모지 가족 1개 = grapheme 1 ---
job4="$sandbox/job-bs"; mkdir -p "$job4/drafts"
emoji="$(printf '👨‍👩‍👧‍👦%.0s' $(seq 1 10))"  # 10 graphemes (ZWJ 결합)
printf -- '---\nplatform: bluesky\nformat: single\n---\n%s\n' "$emoji" >"$job4/drafts/bluesky.md"
[ "$(post_count "$job4" bluesky)" = "10" ] || fail "ZWJ 이모지는 grapheme 단위로 10이어야 한다: $(post_count "$job4" bluesky)"

# --- 5. Bluesky alt 없는 미디어 → 실패 ---
cat >"$job4/drafts/bluesky.md" <<'EOF'
---
platform: bluesky
format: single
media:
  - path: ./plot.png
---
본문
EOF
if run_check "$job4" >/dev/null 2>&1; then fail "alt 없는 미디어는 exit 1이어야 한다"; fi

# --- 6. Bluesky 해시태그 2개 → 실패 ---
cat >"$job4/drafts/bluesky.md" <<'EOF'
---
platform: bluesky
format: single
---
이런 #스파크 #파티션 트레이드오프
EOF
if run_check "$job4" >/dev/null 2>&1; then fail "해시태그 2개는 exit 1이어야 한다"; fi

# --- 7. 스레드: 게시물별 길이 각각 검사 ---
job7="$sandbox/job-thread"; mkdir -p "$job7/drafts"
cat >"$job7/drafts/x.md" <<EOF
---
platform: x
format: thread
---
$k140

=== POST ===

$k141
EOF
# run_check는 위반 감지 시 exit 1 — pipefail이 대입문까지 죽이지 않게 || true
counts="$({ run_check "$job7" || true; } | jq -c '.platforms.x.counts')"
[ "$counts" = "[280,282]" ] || fail "스레드 게시물별 카운트가 [280,282]이어야 한다: $counts"
if run_check "$job7" >/dev/null 2>&1; then fail "스레드 2번째 게시물 초과 — exit 1이어야 한다"; fi

# --- 8. 의존성 부재 → fail-closed (uv 없는 python 직접 실행) ---
if python3 "$CHECK" "$job" >/dev/null 2>&1; then
  # 로컬에 grapheme/yaml이 이미 깔려 있으면 이 검증은 의미 없다 — 스킵 아님, 다른 방식으로 확인
  python3 -c 'import grapheme, yaml' 2>/dev/null || fail "의존성 부재 시 exit 1이어야 한다"
fi

# --- 9. 파싱 불가 frontmatter → fail-closed 위반 (닫는 구분자 공백 변형) ---
job9="$sandbox/job-malformed"; mkdir -p "$job9/drafts"
cat >"$job9/drafts/bluesky.md" <<'EOF'
---
platform: bluesky
format: single
media:
  - path: ./plot.png
---
본문
EOF
if run_check "$job9" >/dev/null 2>&1; then
  fail "닫는 구분자 불일치('--- ' 공백)는 파싱 실패로 exit 1이어야 한다"
fi

# --- 10. UTF-8 BOM + frontmatter → fail-closed (제거 후 파싱, alt 검사 활성) ---
job10="$sandbox/job-bom"; mkdir -p "$job10/drafts"
printf '\xef\xbb\xbf---\nplatform: bluesky\nformat: single\nmedia:\n  - path: ./p.png\n---\n본문\n' >"$job10/drafts/bluesky.md"
if run_check "$job10" >/dev/null 2>&1; then
  fail "BOM + alt 없는 미디어는 exit 1이어야 한다 (BOM 우회 차단)"
fi
printf '\xef\xbb\xbf---\nplatform: bluesky\nformat: single\n---\n본문\n' >"$job10/drafts/bluesky.md"
run_check "$job10" >/dev/null || fail "BOM이 있어도 정상 frontmatter면 통과해야 한다"

# --- 11. frontmatter platform 불일치 → 위반 (죽은 검사 수정의 실증) ---
job11="$sandbox/job-mismatch"; mkdir -p "$job11/drafts"
printf -- '---\nplatform: linkedin\nformat: single\n---\n본문\n' >"$job11/drafts/x.md"
violations="$({ run_check "$job11" || true; } | jq -r '.platforms.x.violations[]')"
grep -q "다릅니다" <<<"$violations" || fail "frontmatter platform 불일치가 위반으로 잡혀야 한다: $violations"
if run_check "$job11" >/dev/null 2>&1; then fail "platform 불일치는 exit 1이어야 한다"; fi

# --- 12. 미디어 개수 상한(X 5개 > 4) → exit 1 ---
job12="$sandbox/job-mediamax"; mkdir -p "$job12/drafts"
{ printf -- '---\nplatform: x\nformat: single\nmedia:\n'; for i in 1 2 3 4 5; do printf '  - path: ./m%d.png\n    alt: a\n' "$i"; done; printf -- '---\n본문\n'; } >"$job12/drafts/x.md"
if run_check "$job12" >/dev/null 2>&1; then fail "X 미디어 5개(상한 4)는 exit 1이어야 한다"; fi

# --- 13. 미지원 플랫폼 → exit 1 ---
job13="$sandbox/job-unknown"; mkdir -p "$job13/drafts"
printf -- '---\nplatform: twitter\nformat: single\n---\n본문\n' >"$job13/drafts/twitter.md"
if run_check "$job13" >/dev/null 2>&1; then fail "미지원 플랫폼(twitter)은 exit 1이어야 한다"; fi

# --- 14. --platform 페이로드 모드: 본문만 + 절대경로 media + link ---
job14="$sandbox/job-payload"; mkdir -p "$job14/drafts"
cat >"$job14/drafts/x.md" <<'EOF'
---
platform: x
format: thread
media:
  - path: ./plot.png
    alt: 파티션 수별 런타임 그래프
link: https://example.com/run
---
첫 게시물 훅

=== POST ===

두 번째 게시물
EOF
payload="$(uv run -q --with grapheme --with pyyaml python "$CHECK" "$job14" --platform x)"
echo "$payload" | jq -e '.body == "첫 게시물 훅\n\n=== POST ===\n\n두 번째 게시물"' >/dev/null || fail "페이로드 body가 본문만(스레드 구분자 유지) 담아야 한다: $payload"
echo "$payload" | jq -e --arg p "$job14/plot.png" '.media[0].path == $p and .media[0].alt == "파티션 수별 런타임 그래프"' >/dev/null || fail "페이로드 media가 절대경로·alt를 담아야 한다: $payload"
echo "$payload" | jq -e '.link == "https://example.com/run" and .format == "thread"' >/dev/null || fail "페이로드 link·format이 담겨야 한다: $payload"

echo "✅ check-drafts.test.sh 통과"
