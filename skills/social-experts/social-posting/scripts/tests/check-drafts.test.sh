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

echo "✅ check-drafts.test.sh 통과"
