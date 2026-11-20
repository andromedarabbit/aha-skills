#!/bin/bash
# sync_gate.py 정규화·유사도·분류 단위 검사.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYNC_GATE="$HERE/../sync_gate.py"

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
