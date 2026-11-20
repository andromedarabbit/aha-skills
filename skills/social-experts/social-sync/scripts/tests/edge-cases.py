"""스캔 오류 백오프와 게시 결과를 받지 못한 뒤의 재실행을 검사한다."""

import json
import tempfile
from pathlib import Path

from scenarios import HERE, NOW, X, Sandbox, candidate


def check_scan(box):
    box.init("x")
    since = box.state()["watermarks"]["x"]["since"]
    box.fixture(x="bad_json")
    assert box.run("scan", "--gate")[1]["status"] == "WAKE_ERROR"
    assert box.call_tick()[1]["lastScan"]["errors"]
    assert len(box.scans()) == 1
    assert box.run("scan", "--gate", at="2026-11-20T13:00:00Z")[0] == 2
    box.fixture(x="timeout")
    assert box.run("scan", "--gate", "--per-platform-timeout", "1", at="2026-11-20T19:00:00Z")[1]["status"] == "WAKE_ERROR"
    assert box.state()["watermarks"]["x"]["since"] == since
    box.fixture(x={"posts": [], "reason": "SCROLL_STALLED"})
    assert box.run("scan", "--gate", at="2026-11-20T20:00:00Z")[0] == 1
    _, report = box.run("wake-report")
    assert report["lastScan"]["errors"] == []
    assert box.state()["watermarks"]["x"]["since"] == since
    assert box.state()["watermarks"]["x"]["lastResult"] == "partial"


def check_uncertain_post(box):
    box.init("x")
    box.fixture(x={"posts": [candidate(X, "photo-less")]})
    _, wake = box.call_tick()
    item = wake["posts"][0]
    job = box.stage(item)
    args = ["--platform", "x", "--url", X]
    assert box.run("mark-pending", *args, "--job", str(job), "--claim", wake["claim"])[0] == 0
    box.approve(job, item["targets"])
    _, unknown = box.run("publish-pending", *args, "--target", "facebook", extra={"STUB_POST_RESULT": "lost response", "STUB_POST_EXIT": "1"})
    assert unknown["status"] == "POST_UNKNOWN"
    state = box.state()
    state["pending"][f"x|{X}"]["outcomes"]["bluesky"] = {"status": "IN_PROGRESS", "at": NOW}
    box.state_path.write_text(json.dumps(state))  # publisher가 결과를 기록하기 전에 중단된 파일을 재현한다.
    assert box.run("publish-pending", *args, "--target", "facebook")[0] == 2
    assert box.run("publish-pending", *args, "--target", "bluesky")[0] == 2
    assert (box.home / "publish.log").read_text().splitlines() == ["fixture"]
    assert box.run("status")[1]["pending"][0]["readyTargets"] == []
    assert box.run("mark-synced", *args, "--target", "facebook", "--target-url", "https://example.invalid/verified")[0] == 0
    assert box.run("status")[1]["pendingCount"] == 1
    assert box.run("mark-synced", *args, "--target", "bluesky")[0] == 0
    assert box.run("status")[1]["pendingCount"] == 0


if __name__ == "__main__":
    for check in (check_scan, check_uncertain_post):
        with tempfile.TemporaryDirectory(prefix="sync-edge-") as temp:
            check(Sandbox(HERE.parents[1], Path(temp)))
