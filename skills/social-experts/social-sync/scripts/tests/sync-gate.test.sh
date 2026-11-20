#!/bin/bash
# sync_gate.py 회귀 테스트 — stub PATH + mktemp 격리 (저장소 전례 패턴).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYNC_GATE="$HERE/../sync_gate.py"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/social-sync-gate-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

fail() { echo "❌ $1" >&2; exit 1; }
assert_contains() { grep -qF -- "$3" <<<"$2" || fail "$1 — [$3] 이(가) 없음"; }

# stub: node가 실행할 가짜 ego-post.mjs — fixture를 그대로 출력하거나 실패한다
STUB_BIN="$WORK/bin"
mkdir -p "$STUB_BIN"
: > "$STUB_BIN/ego-browser" && chmod +x "$STUB_BIN/ego-browser"  # precheck_env 통과용
cat > "$STUB_BIN/stub-ego-post.mjs" << 'EOF'
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
let input = '';
process.stdin.on('data', c => { input += c; });
process.stdin.on('end', () => {
  if (process.env.STUB_SCAN_FAIL === '1') {
    process.stderr.write('stub failure\n');
    process.exit(1);
  }
  process.stdout.write(readFileSync(process.env.STUB_SCAN_FIXTURE, 'utf8') + '\n');
});
EOF

BINDING="$WORK/binding.json"
cat > "$BINDING" << 'EOF'
{"transport": "ego-post/1", "identity": {"x": "me", "facebook": "me", "threads": "me", "bluesky": "me.bsky.social"}}
EOF

# run_gate <exit_code 기대> <stdout 파일> <args...> — 격리 env로 게이트를 돌린다
run_gate() {
  local expected="$1" out="$2"; shift 2
  set +e
  env HOME="$WORK" PATH="$STUB_BIN:$PATH" \
    SOCIAL_SYNC_CONFIG="$WORK/config.json" SOCIAL_SYNC_STATE="$WORK/state.json" \
    SOCIAL_SYNC_JOBS="$WORK/jobs" SOCIAL_SYNC_BINDING="$BINDING" \
    SOCIAL_SYNC_EGO_POST="$STUB_BIN/stub-ego-post.mjs" \
    "$@" >"$out" 2>"$WORK/stderr"
  local actual=$?
  set -e
  [[ "$actual" == "$expected" ]] || fail "exit $expected 기대, 실제 $actual: $* (stderr: $(head -2 "$WORK/stderr" 2>/dev/null))"
}

# gate_tool <exit_code 기대> <stdout 파일> <env 추가...> -- <args...> — env 추가를 지원한다
gate_tool() {
  local expected="$1" out="$2"; shift 2
  local extra_env=""
  while [[ "${1:-}" != "--" ]]; do extra_env="$extra_env $1"; shift; done
  shift
  set +e
  env HOME="$WORK" PATH="$STUB_BIN:$PATH" \
    SOCIAL_SYNC_CONFIG="$WORK/config.json" SOCIAL_SYNC_STATE="$WORK/state.json" \
    SOCIAL_SYNC_JOBS="$WORK/jobs" SOCIAL_SYNC_BINDING="$BINDING" \
    SOCIAL_SYNC_EGO_POST="$STUB_BIN/stub-ego-post.mjs" \
    $extra_env "$@" >"$out" 2>"$WORK/stderr"
  local actual=$?
  set -e
  [[ "$actual" == "$expected" ]] || fail "exit $expected 기대, 실제 $actual: $* (stderr: $(head -2 "$WORK/stderr" 2>/dev/null))"
}

init_env() { # 소스 집합을 받아 config/state를 초기화한다
  gate_tool 0 /dev/null -- uv run --script "$SYNC_GATE" config --init --sources "$1" --days 7
}

fixture() { # fixture <파일> <플랫폼> <candidates JSON> <coverage JSON>
  cat > "$1" << EOF
{"status": "SCAN_DONE", "platform": "$2", "identity": "me", "candidates": $3,
 "review": [], "coverage": $4,
 "jobDir": "/tmp/fixture", "manifestPath": "/tmp/fixture/scan-manifest.json", "manifestDigest": "x"}
EOF
}

NEW_COVERAGE='{"complete": true, "observedNewest": "2026-11-19T10:00:00Z", "observedOldest": "2026-11-19T09:00:00Z", "stopReason": null}'
INCOMPLETE_COVERAGE='{"complete": false, "observedNewest": "2026-11-19T10:00:00Z", "observedOldest": "2026-11-19T08:00:00Z", "stopReason": "POST_LIMIT"}'
X_URL="https://x.com/me/status/100"

# ── 1. config init ──
init_env "x,bluesky"
jq -e '.targets == ["facebook","threads"]' < "$WORK/config.json" >/dev/null || fail "config init: 기본 대상 파생 오류"
jq -e '.watermarks.x.since and .watermarks.bluesky.since' < "$WORK/state.json" >/dev/null || fail "config init: 워터마크 초기화 누락"
gate_tool 2 "$WORK/out" -- uv run --script "$SYNC_GATE" config --init --sources x,linkedin --days 7
gate_tool 2 "$WORK/out" -- uv run --script "$SYNC_GATE" config --init --sources x --days 0

# ── 2. 정규화·유사도·분류 단위 (ego-post.mjs 미러링) ──
python3 - "$SYNC_GATE" << 'PYEOF'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("sync_gate", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
assert mod.normalize_text("안녕하세요!! Hello, World.") == "안녕하세요 hello world", mod.normalize_text("안녕하세요!! Hello, World.")
assert mod.similarity("새 글을 올렸습니다 오늘", "새 글을 올렸습니다 오늘!") == 1.0
assert mod.similarity("가나다", "라마바") < 0.6
assert mod.similarity("x y z", "") == 0.0
candidates = [
    {"platform": "x", "url": "https://x.com/a", "text": "양쪽에 올린 같은 문구 입니다", "id": "1", "media": []},
    {"platform": "bluesky", "url": "https://bsky.app/b", "text": "양쪽에 올린 같은 문구 입니다!", "id": "2", "media": []},
    {"platform": "x", "url": "https://x.com/c", "text": "x에만 있는 고유 글", "id": "3", "media": []},
]
entries, new_entries = mod.classify(candidates, {}, set())
by_key = {f"{e['platform']}|{e['url']}": e["classification"] for e in entries}
assert by_key["x|https://x.com/a"] == "matched", by_key
assert by_key["bluesky|https://bsky.app/b"] == "matched", by_key
assert by_key["x|https://x.com/c"] == "new", by_key
entries, _ = mod.classify([{"platform": "x", "url": "https://x.com/r", "text": "답글", "id": "4", "media": [], "parentUrl": "https://x.com/a"}], {}, set())
assert entries[0]["classification"] == "skipped", entries
known, pair_urls = mod.build_posts_index({"posts": {"x|https://x.com/c": {"status": "pending"}}, "pairs": [{"sourcePlatform": "x", "sourceUrl": "https://x.com/d", "targetPlatform": "bluesky", "targetUrl": "https://bsky.app/d"}]})
entries, _ = mod.classify([{"platform": "x", "url": "https://x.com/c", "text": "x에만 있는 고유 글", "id": "5", "media": []}, {"platform": "x", "url": "https://x.com/d", "text": "pairs 기록 글", "id": "6", "media": []}], known, pair_urls)
by_key = {f"{e['platform']}|{e['url']}": e["classification"] for e in entries}
assert by_key["x|https://x.com/c"] == "known", by_key
assert by_key["x|https://x.com/d"] == "known", by_key
print("정규화·유사도·분류 OK")
PYEOF

# ── 3. scan: 새 글 → wake (exit 0), wake dir 승격, 완전 커버리지 워터마크 ──
init_env "x"
rm -rf "$WORK/jobs"
fixture "$WORK/fixture-x.json" x \
  '[{"id":"c1","url":"'$X_URL'","text":"안녕하세요 새 글입니다","publishedAt":"2026-11-19T09:30:00Z","media":[{"id":"m1","sourceUrl":"https://img.example/p.jpg","alt":"사진"}]}]' \
  "$NEW_COVERAGE"
gate_tool 0 "$WORK/out" STUB_SCAN_FIXTURE="$WORK/fixture-x.json" -- uv run --script "$SYNC_GATE" scan --gate
assert_contains "scan wake 상태" "$(cat "$WORK/out")" '"status": "WAKE"'
jq -e '.posts | length == 1' < "$WORK/state.json" >/dev/null || fail "scan wake: posts 기록 누락"
WAKE_DIR="$(jq -r '.lastWake.dir' < "$WORK/state.json")"
[[ -d "$WAKE_DIR/scans" ]] || fail "scan wake: 스캔 산출물 승격 누락"
jq -e --arg d "$WAKE_DIR" '.lastWake.posts[0].scanRef | startswith($d)' < "$WORK/state.json" >/dev/null || fail "scan wake: scanRef 경로 오류"
jq -e '.watermarks.x.since == "2026-11-19T10:00:00Z"' < "$WORK/state.json" >/dev/null || fail "완전 커버리지: 워터마크는 observedNewest"

# ── 4. 재스캔: 미처리 new는 다시 wake, mark-pending 후엔 quiet ──
gate_tool 0 "$WORK/out" STUB_SCAN_FIXTURE="$WORK/fixture-x.json" -- uv run --script "$SYNC_GATE" scan --gate
gate_tool 0 "$WORK/out" -- uv run --script "$SYNC_GATE" mark-pending --platform x --url "$X_URL" --job "$WAKE_DIR"
jq -e '.pending | length == 1' < "$WORK/state.json" >/dev/null || fail "mark-pending: pending 기록 누락"
gate_tool 1 "$WORK/out" STUB_SCAN_FIXTURE="$WORK/fixture-x.json" -- uv run --script "$SYNC_GATE" scan --gate
assert_contains "quiet 출력" "$(cat "$WORK/out")" "QUIET"

# ── 5. 불완전 커버리지: 워터마크는 observedOldest로 (겹치게) ──
init_env "x"
rm -rf "$WORK/jobs"
fixture "$WORK/fixture-inc.json" x \
  '[{"id":"c9","url":"https://x.com/me/status/900","text":"불완전 커버리지의 고유 글","publishedAt":"2026-11-19T09:00:00Z","media":[]}]' \
  "$INCOMPLETE_COVERAGE"
gate_tool 0 "$WORK/out" STUB_SCAN_FIXTURE="$WORK/fixture-inc.json" -- uv run --script "$SYNC_GATE" scan --gate
jq -e '.watermarks.x.since == "2026-11-19T08:00:00Z"' < "$WORK/state.json" >/dev/null || fail "불완전 커버리지: 워터마크는 observedOldest"

# ── 6. mark-synced 멱등 + pending 정리 ──
init_env "x"
rm -rf "$WORK/jobs"
gate_tool 0 "$WORK/out" STUB_SCAN_FIXTURE="$WORK/fixture-x.json" -- uv run --script "$SYNC_GATE" scan --gate
gate_tool 0 "$WORK/out" -- uv run --script "$SYNC_GATE" mark-pending --platform x --url "$X_URL" --job "$WAKE_DIR"
gate_tool 0 "$WORK/out" -- uv run --script "$SYNC_GATE" mark-synced --platform x --url "$X_URL" --target bluesky --target-url "https://bsky.app/profile/me/post/9l"
gate_tool 0 "$WORK/out" -- uv run --script "$SYNC_GATE" mark-synced --platform x --url "$X_URL" --target bluesky --target-url "https://bsky.app/profile/me/post/9l"
[[ "$(jq '.pairs | length' < "$WORK/state.json")" == "1" ]] || fail "mark-synced: 중복 pair 기록"
[[ "$(jq '.pending | length' < "$WORK/state.json")" == "0" ]] || fail "mark-synced: pending 미정리"
jq -e '[.posts[] | select(.status == "synced")] | length == 1' < "$WORK/state.json" >/dev/null || fail "mark-synced: 상태 전이 누락"

# ── 7. 오류 백오프: --gate는 첫 오류에 한 번 기상, 6시간 내 재기상 없음 ──
init_env "x"
rm -rf "$WORK/jobs"
gate_tool 0 "$WORK/out" SOCIAL_SYNC_NOW="2026-11-19T12:00:00Z" STUB_SCAN_FAIL=1 -- uv run --script "$SYNC_GATE" scan --gate
assert_contains "오류 기상" "$(cat "$WORK/out")" "WAKE_ERROR"
gate_tool 2 "$WORK/out" SOCIAL_SYNC_NOW="2026-11-19T13:00:00Z" STUB_SCAN_FAIL=1 -- uv run --script "$SYNC_GATE" scan --gate
gate_tool 0 "$WORK/out" SOCIAL_SYNC_NOW="2026-11-19T20:00:00Z" STUB_SCAN_FAIL=1 -- uv run --script "$SYNC_GATE" scan --gate
assert_contains "6시간 후 재기상" "$(cat "$WORK/out")" "WAKE_ERROR"
# 비게이트 스캔은 오류를 항상 exit 2로 올린다
gate_tool 2 "$WORK/out" SOCIAL_SYNC_NOW="2026-11-19T21:00:00Z" STUB_SCAN_FAIL=1 -- uv run --script "$SYNC_GATE" scan
gate_tool 1 "$WORK/out" -- uv run --script "$SYNC_GATE" wake-report
jq -e '.status == "NO_WAKE" and (.lastScan.errors | length > 0)' < "$WORK/out" >/dev/null || fail "wake-report: 스캔 오류 누락"

# ── 8. wake-report ──
init_env "x"
rm -rf "$WORK/jobs"
gate_tool 1 "$WORK/out" -- uv run --script "$SYNC_GATE" wake-report
jq -e '.status == "NO_WAKE" and .lastScan == null' < "$WORK/out" >/dev/null || fail "wake-report: 스캔 전 NO_WAKE 상태 누락"
fixture "$WORK/fixture-empty.json" x '[]' "$NEW_COVERAGE"
gate_tool 1 "$WORK/out" STUB_SCAN_FIXTURE="$WORK/fixture-empty.json" -- uv run --script "$SYNC_GATE" scan --gate
gate_tool 1 "$WORK/out" -- uv run --script "$SYNC_GATE" wake-report
jq -e '.status == "NO_WAKE" and .lastScan.at != null' < "$WORK/out" >/dev/null || fail "wake-report: 스캔 후 NO_WAKE 상태 누락"
gate_tool 0 "$WORK/out" STUB_SCAN_FIXTURE="$WORK/fixture-x.json" -- uv run --script "$SYNC_GATE" scan --gate
gate_tool 0 "$WORK/out" -- uv run --script "$SYNC_GATE" wake-report
assert_contains "wake-report 본문" "$(cat "$WORK/out")" '"status": "WAKE"'
gate_tool 0 "$WORK/out" -- uv run --script "$SYNC_GATE" status
assert_contains "status 출력" "$(cat "$WORK/out")" '"status": "STATUS"'

echo "sync-gate.test.sh 통과"
