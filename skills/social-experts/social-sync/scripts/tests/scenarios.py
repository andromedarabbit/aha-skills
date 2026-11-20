"""동일한 합성 입력으로 social-sync CLI와 승인 가드를 검증한다."""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent
NOW = "2026-11-20T12:00:00Z"
X = "https://x.com/fixture/status/100"
X2 = "https://x.com/fixture/status/101"
FB = "https://www.facebook.com/fixture/posts/103"
PHOTO = "https://images.example.invalid/p.jpg"


NODE = r'''
import hashlib, json, os, sys, time
from pathlib import Path

config = Path(os.environ['HOME'])
script, command = sys.argv[1:]
assert Path(script).parent.parent.name == 'social-posting' or Path(script).name == 'fixture.mjs'
payload = json.load(sys.stdin)
with (config / 'node.log').open('a') as log:
    log.write(json.dumps([script, command, payload]) + '\n')
fixture = json.loads((config / 'fixture.json').read_text())
if command == 'scan':
    if (config / 'hold').exists():
        deadline = time.monotonic() + 10
        while (config / 'hold').exists() and time.monotonic() < deadline:
            time.sleep(.01)
    platform = payload['platform']
    result = fixture[platform]
    if result == 'bad_json':
        print('not JSON')
        sys.exit(0)
    if result == 'timeout':
        time.sleep(4)
    if result == 'failed':
        sys.exit(1)
    ref = Path(payload['jobDir']) / 'scans' / ('external-' + platform) / platform
    ref.mkdir(parents=True, exist_ok=True)
    posts = [p for p in result['posts'] if payload['since'] <= p['publishedAt'] < payload['until']]
    manifest = {'status': 'SCAN_DONE', 'platform': platform, 'jobDir': str(ref), 'candidates': posts,
                'coverage': {'complete': result.get('complete', False), 'stopReason': result.get('reason', 'POST_LIMIT'),
                             'observedNewest': result.get('newest')}}
    data = json.dumps(manifest).encode()
    (ref / 'scan-manifest.json').write_bytes(data)
    manifest['manifestDigest'] = hashlib.sha256(data).hexdigest()
    print(json.dumps(manifest))
elif command == 'fetch-media':
    ref = Path(payload['jobDir'])
    data = (ref / 'scan-manifest.json').read_bytes()
    manifest = json.loads(data)
    assert manifest['jobDir'] == str(ref)
    candidate = next(p for p in manifest['candidates'] if p['id'] == payload['candidateId'])
    photo = next(p for p in candidate['media'] if p['sourceUrl'] == payload['sourceUrl'])
    alt = photo.get('alt')
    if not alt:
        override = payload['altOverride']
        assert override['manifestDigest'] == hashlib.sha256(data).hexdigest() and override['mediaId'] == photo['id']
        alt = override['alt']
    media = ref.parents[2] / 'media'
    media.mkdir(exist_ok=True)
    content = b'\xff\xd8\xffsynthetic jpeg'
    image_hash = hashlib.sha256(content).hexdigest()
    image = media / f'{image_hash}.jpg'
    image.write_bytes(content)
    provenance = {'sourceUrl': photo['sourceUrl'], 'finalUrl': photo['sourceUrl'], 'sourcePostUrl': candidate['url'],
                  'publisher': 'fixture', 'observedAt': '2026-11-20T12:00:00Z', 'alt': alt, 'contentType': 'image/jpeg',
                  'sha256': image_hash, 'bytes': len(content)}
    serialized = json.dumps(provenance).encode()
    proof_hash = hashlib.sha256(serialized).hexdigest()
    proof = media / f'{image_hash}.{proof_hash}.provenance.json'
    proof.write_bytes(serialized)
    print(json.dumps([{'path': str(image), 'sha256': image_hash, 'alt': alt,
                       'provenancePath': str(proof), 'provenanceSha256': proof_hash}]))
else:
    raise SystemExit('unexpected node subcommand')
'''


DRAFT = r'''
import hashlib, json, shutil, sys
from pathlib import Path

args = sys.argv[1:]
idx = next(i for i, a in enumerate(args) if a.endswith('/check-drafts.py'))
job = Path(args[idx + 1])
def check(platform):
    draft = (job / 'drafts' / f'{platform}.md').read_text()
    _, header, body = draft.split('---', 2)
    media = json.loads(next(line[7:] for line in header.splitlines() if line.startswith('media: ')))
    for m in media:
        file, proof = job / m['path'], job / m['provenance']
        assert hashlib.sha256(file.read_bytes()).hexdigest() == m['sha256']
        assert hashlib.sha256(proof.read_bytes()).hexdigest() == m['provenance_sha256']
    return dict(body=body.strip(), media=media, link=None, format='single', visibility='keep')
if '--platform' in args:
    print(json.dumps(check(args[args.index('--platform') + 1])))
else:
    for p in (job / 'drafts').glob('*.md'):
        check(p.stem)
    print('{}')
'''


def candidate(url, identifier, media=False):
    return {"url": url, "id": identifier, "text": f"합성 원본 {identifier}", "publishedAt": "2026-11-19T09:00:00Z",
            "media": [{"id": "photo-1", "sourceUrl": PHOTO, "alt": None}] if media else []}


class Sandbox:
    def __init__(self, skill, home):
        self.skill, self.home = skill, home
        self.gate = skill / "scripts/sync_gate.py"
        self.posting = skill.parent / "social-posting/scripts"
        self.skill_body = (skill / "SKILL.md").read_text()
        self.modern = '/scripts/sync_gate.py" tick' in self.skill_body
        self.commands = []
        self.bin = home / "bin"
        self.bin.mkdir()
        self.write_exec("node", f"#!{sys.executable}\n{NODE}")
        self.write_exec("ego-browser", "#!/bin/sh\nexit 99\n")
        self.write_exec("orca", "#!/bin/sh\nexit 99\n")
        self.write_exec("publish-stub", '#!/bin/bash\n/bin/cat >/dev/null\nprintf "fixture\\n" >> "$HOME/publish.log"\nprintf "%s\\n" "$STUB_POST_RESULT"\nexit "$STUB_POST_EXIT"\n')
        self.fallback = home / "fixture.mjs"
        self.fallback.touch()
        (home / "binding.json").write_text(json.dumps({"identity": dict(x="fixture", facebook="fixture", bluesky="fixture.bsky.social", threads="fixture")}))
        uv, jq = shutil.which("uv"), shutil.which("jq")
        assert uv and jq, "시험에는 uv와 jq가 필요합니다"
        extra = {}
        if os.environ.get("SOCIAL_SYNC_REAL_DRAFT_CHECK") == "1":
            extra["UV_CACHE_DIR"] = subprocess.check_output([uv, "cache", "dir"], text=True).strip()
        else:
            self.write_exec("uv", f"#!{sys.executable}\n{DRAFT}")
        self.env = {"HOME": str(home), "TMPDIR": str(home), "PATH": os.pathsep.join([str(self.bin), str(Path(uv).parent), str(Path(jq).parent), "/usr/bin", "/bin"]),
                    **extra, "UV_OFFLINE": "1", "UV_PYTHON_DOWNLOADS": "never", "SOCIAL_SYNC_NOW": NOW,
                    "SOCIAL_SYNC_BINDING": str(home / "binding.json"), "SOCIAL_EGO_POST": str(self.bin / "publish-stub"),
                    "STUB_POST_RESULT": '{"status":"POSTED","urls":[],"urlRecovered":false}', "STUB_POST_EXIT": "0"}
        self.state_path = home / ".local/state/social-sync/state.json"
        self.config_path = home / ".config/social-sync/config.json"

    def write_exec(self, name, body):
        path = self.bin / name
        path.write_text(body)
        path.chmod(0o700)

    def fixture(self, **platforms):
        (self.home / "fixture.json").write_text(json.dumps(platforms))

    def state(self):
        return json.loads(self.state_path.read_text())

    def run(self, *args, at=NOW, extra=None):
        proc = subprocess.run([sys.executable, str(self.gate), *args], env={**self.env, "SOCIAL_SYNC_NOW": at, **(extra or {})},
                              capture_output=True, text=True, timeout=45)
        try:
            out = json.loads(proc.stdout)
        except ValueError:
            out = {"stdout": proc.stdout, "stderr": proc.stderr}
        self.commands.append({"args": args, "exit": proc.returncode, "status": out.get("status"), "reason": out.get("reason")})
        return proc.returncode, out

    def call_tick(self):
        return self.run("tick" if self.modern else "wake-report")

    def scans(self):
        log = self.home / "node.log"
        return [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []

    def init(self, sources):
        code, out = self.run("config", "--init", "--sources", sources)
        assert code == 0, out

    def stage(self, item, media=None):
        job = Path(item["job"])
        (job / "drafts").mkdir(parents=True, exist_ok=True)
        targets = item["targets"]
        identities = {"facebook": "fixture", "bluesky": "fixture.bsky.social", "x": "fixture"}
        (job / "job-state.md").write_text("---\nstage: 7\nplatforms: [" + ", ".join(targets) + "]\naccounts: {" +
                                           ", ".join(f"{p}: {identities[p]}" for p in targets) + "}\n---\n")
        for p in targets:
            (job / "drafts" / f"{p}.md").write_text(f"---\nplatform: {p}\nformat: single\nmedia: {json.dumps(media or [], ensure_ascii=False)}\n---\n\n{item['text']}\n")
        return job

    def approve(self, job, targets):
        q = "초안을 게시할까요?\n게시 대상: " + ",".join(targets)
        data = {"tool_name": "AskUserQuestion", "tool_input": {"questions": [{"header": "게시 승인", "question": q}]},
                "tool_response": {"answers": {q: "게시"}}}
        subprocess.run(["/bin/bash", str(self.posting / "record-approval.sh")], input=json.dumps(data), text=True,
                       env={**self.env, "SOCIAL_POSTING_JOB": str(job)}, check=True, capture_output=True)
        assert (job / "receipt.json").is_file()


def checks(name, box):
    scores = []

    def check(text, passed, evidence):
        scores.append(dict(text=text, passed=bool(passed), evidence=str(evidence)))

    box.init("x,facebook,threads,bluesky" if name == "bootstrap" else "x" if name == "concurrency" else "x,facebook")
    if name == "bootstrap":
        box.fixture(x={"posts": [candidate(X, "candidate-not-url", True), candidate(X2, "second", True)]},
                    facebook={"posts": []}, threads={"posts": []}, bluesky={"posts": []})
        _, wake = box.call_tick()
        check("최초 tick이 예약 precheck 없이 소스를 읽고 wake를 돌려준다", wake.get("status") == "WAKE" and len(box.scans()) == 4, wake.get("status"))
        paths = box.scans()
        _, probe = box.run("scan", "--gate", at="2026-11-20T13:00:00Z")
        check("경로 override 없이 형제 social-posting 스크립트를 찾는다", bool(paths) and paths[0][0] == str(box.posting / "ego-post.mjs"), probe.get("reason") or paths[:1])
        items = wake.get("posts", [])
        check("모든 소스를 골라도 원본 외 바인딩 대상이 남는다", bool(items) and items[0].get("targets") == ["facebook", "bluesky"], [p.get("targets") for p in items])
        check("원본 두 건이 독립 초안 경로를 받는다", len({p.get("job") for p in items if p.get("job")}) == 2, [p.get("job") for p in items])
        fetched, queued = [], []
        if box.modern and items:
            for item in items:
                _, result = box.run("prepare-media", "--claim", wake["claim"], "--platform", "x", "--url", item["url"])
                media = result.get("media", [])
                job = box.stage(item, [{k: v for k, v in m.items() if k != "defaultAlt"} for m in media])
                queued.append(box.run("mark-pending", "--claim", wake["claim"], "--platform", "x", "--url", item["url"], "--job", str(job))[0])
                fetched.extend(media)
        check("스캔의 실제 후보 ID·manifest로 두 사진의 파일과 출처를 보존한다",
              bool(items) and items[0].get("candidateId") == "candidate-not-url" and len(fetched) == 2 and
              all(m["defaultAlt"] and len(m["provenance_sha256"]) == 64 for m in fetched), fetched)
        if fetched:
            check_cmd = ["uv", "run", "-q", "--with", "grapheme", "--with", "pyyaml", "python",
                         str(box.posting / "check-drafts.py"), items[0]["job"]]
            proc = subprocess.run(check_cmd, env=box.env, capture_output=True, text=True, timeout=30)
            check("원본별 사진 초안이 검사에 통과해 각각 승인 대기에 들어간다",
                  proc.returncode == 0 and queued == [0, 0] and len(box.state()["pending"]) == 2, proc.stdout + proc.stderr)
        else:
            check("원본별 사진 초안이 검사에 통과해 각각 승인 대기에 들어간다", False, "검사할 사진 초안 없음")
        return scores

    if name == "concurrency":
        box.env["SOCIAL_SYNC_EGO_POST"] = str(box.fallback)
        box.fixture(x={"posts": [candidate(X, "first"), candidate(X2, "second")]})
        hold = box.home / "hold"
        hold.touch()
        proc = subprocess.Popen([sys.executable, str(box.gate), "scan", "--gate"], env=box.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            deadline = time.monotonic() + 5
            while not box.scans() and proc.poll() is None and time.monotonic() < deadline:
                time.sleep(.01)
            _, overlap = box.call_tick()
            _, precheck = box.run("scan", "--gate", "--per-platform-timeout", "1", at="2026-11-20T12:01:00Z")
        finally:
            hold.unlink()
            stdout, _ = proc.communicate(timeout=15)
        initial = json.loads(stdout)
        check("스캔 중 tick과 두 번째 precheck가 브라우저 호출을 늘리지 않는다", overlap.get("status") == precheck.get("status") == "BUSY" and len(box.scans()) == 1, [overlap, precheck])
        box.fixture(x={"posts": []})
        _, retry = box.run("scan", "--gate", at="2026-11-20T13:00:00Z")
        check("후속 정기 실행이 미처리 wake와 사진 경로를 그대로 보존한다", retry.get("dir") == initial.get("dir") and
              len(retry.get("posts", [])) == 2 and len(box.scans()) == 1, retry.get("status"))
        _, wake = box.call_tick()
        _, duplicate = box.call_tick()
        check("동시 또는 연속 tick 한 번만 wake를 선점한다", bool(wake.get("claim")) and duplicate.get("status") == "BUSY", duplicate.get("status"))
        if box.modern and wake.get("posts"):
            item = wake["posts"][0]
            job = box.stage(item)
            params = ["--platform", "x", "--url", X, "--job", str(job), "--claim", wake["claim"]]
            _, queued = box.run("mark-pending", *params)
            box.run("release-wake", "--claim", wake["claim"])
            _, resumed = box.call_tick()
            code, stale = box.run("mark-pending", *params)
            check("부분 준비 후에는 남은 원본만 재개하며 옛 선점 쓰기를 거부한다",
                  queued.get("status") == "PENDING" and [p["url"] for p in resumed.get("posts", [])] == [X2] and code == 2, stale)
            box.run("mark-skipped", "--platform", "x", "--url", X2, "--claim", resumed["claim"], "--reason", "fixture")
            before = box.state()
            code, _ = box.run("config", "--init", "--sources", "x")
            check("설정 재실행이 승인 대기·워터마크를 수정하지 않는다", code == 2 and box.state() == before, code)
            box.fixture(x={"posts": [candidate(X, "first")]})
            box.run("scan", "--gate", at="2026-11-20T14:00:00Z")
            check("재관찰해도 승인 대기 상태를 덮어쓰지 않는다", box.state()["posts"][f"x|{X}"]["status"] == "pending", box.state()["posts"].get(f"x|{X}"))
        else:
            for text in ("부분 준비 후에는 남은 원본만 재개하며 옛 선점 쓰기를 거부한다", "설정 재실행이 승인 대기·워터마크를 수정하지 않는다", "재관찰해도 승인 대기 상태를 덮어쓰지 않는다"):
                check(text, False, "선점 기반 준비 경로 없음")
        return scores

    box.env["SOCIAL_SYNC_EGO_POST"] = str(box.fallback)
    before = box.state()["watermarks"]
    box.fixture(x={"posts": [candidate(X, "first")], "complete": True, "reason": None, "newest": "2026-11-19T10:00:00Z"},
                facebook={"posts": [], "reason": "EGO_PROCESS_FAILED"})
    _, scan = box.run("scan", "--gate")
    watermarks = box.state()["watermarks"]
    check("실패 플랫폼의 워터마크를 유지하면서 다른 플랫폼 글을 반환한다", bool(scan.get("errors")) and
          bool(scan.get("posts")) and watermarks["facebook"]["since"] == before["facebook"]["since"] and
          watermarks["x"]["since"] == "2026-11-19T10:00:00Z", watermarks)
    _, wake = box.call_tick()
    if not box.modern:
        item = {**wake["posts"][0], "job": wake["dir"], "targets": ["facebook", "bluesky"]}
        job = box.stage(item)
        args = ["--platform", "x", "--url", X]
        box.run("mark-pending", *args, "--job", str(job))
        cmd = ["/bin/bash", str(box.posting / "publish.sh"), "--job", str(job), "--platform", "facebook"]
        blocked = subprocess.run(cmd, env=box.env, capture_output=True, text=True)
        check("승인 없는 게시 시도는 실제 게시 실행 계층에 도달하지 않는다", blocked.returncode == 1 and
              not (box.home / "publish.log").exists(), blocked.stderr)
        box.approve(job, item["targets"])
        posted = subprocess.run(cmd, env=box.env, capture_output=True, text=True)
        code, status = box.run("mark-synced", *args, "--target", "facebook")
        check("URL 없는 성공은 기록하고 다른 대상은 대기열에 남긴다", posted.returncode == 0 and code == 0 and
              bool(box.state()["pending"]), {"publisher": posted.stdout, "mark": status})
        box.run("mark-synced", *args, "--target", "facebook", "--target-url", FB)
        _, status = box.run("status")
        check("게시 전 실패만 새 승인 대상으로 남긴다", status.get("pendingCount") == 1, status.get("pendingCount"))
        check("부분 게시와 결과 불명은 재게시하지 않는다", False, "대상별 일부 게시·결과 불명 기록 경로 없음")
        return scores
    item = wake["posts"][0]
    job = box.stage(item)
    args = ["--platform", "x", "--url", X]
    box.run("mark-pending", *args, "--job", str(job), "--claim", wake["claim"])
    _, blocked = box.run("publish-pending", *args, "--target", "facebook")
    check("승인 없는 게시 시도는 실제 게시 실행 계층에 도달하지 않는다", blocked.get("status") == "GUARD_BLOCKED" and not (box.home / "publish.log").exists(), blocked)
    box.approve(job, item["targets"])
    _, posted = box.run("publish-pending", *args, "--target", "facebook")
    _, status = box.run("status")
    check("URL 없는 성공은 기록하고 다른 대상은 대기열에 남긴다", posted.get("status") == "POSTED" and
          status["pending"][0]["readyTargets"] == ["bluesky"] and box.state()["pairs"][0]["targetUrl"] is None, posted)
    _, failed = box.run("publish-pending", *args, "--target", "bluesky", extra={"STUB_POST_RESULT": '{"status":"POST_FAILED","reason":"fixture"}', "STUB_POST_EXIT": "1"})
    _, status = box.run("status")
    check("게시 전 실패만 새 승인 대상으로 남긴다", failed.get("status") == "POST_FAILED" and status["pending"][0]["readyTargets"] == ["bluesky"], failed)
    box.approve(job, ["bluesky"])
    _, partial = box.run("publish-pending", *args, "--target", "bluesky", extra={"STUB_POST_RESULT": '{"status":"PARTIAL_POSTED","urls":["https://bsky.app/profile/fixture/post/1"]}', "STUB_POST_EXIT": "1"})
    count = (box.home / "publish.log").read_text().count("fixture")
    code, retry = box.run("publish-pending", *args, "--target", "bluesky")
    _, status = box.run("status")
    check("부분 게시와 결과 불명은 재게시하지 않는다", partial.get("status") == "PARTIAL_POSTED" and code == 2 and
          not status["pending"][0]["readyTargets"] and (box.home / "publish.log").read_text().count("fixture") == count, retry)
    return scores


def evaluate(skill, case):
    with tempfile.TemporaryDirectory(prefix="sync-fixture-") as home:
        box = Sandbox(skill.resolve(), Path(home))
        observations = checks(case, box)
        return {"case": case, "expectations": observations, "commands": box.commands}


class RegressionTests(unittest.TestCase):
    def test_lifecycle(self):
        for case in ("bootstrap", "concurrency", "failures"):
            with self.subTest(case=case):
                result = evaluate(HERE.parents[1], case)
                failed = [a for a in result["expectations"] if not a["passed"]]
                self.assertEqual(failed, [], result)


if __name__ == "__main__":
    if len(sys.argv) == 1:
        unittest.main()
    parser = argparse.ArgumentParser()
    parser.add_argument("--skill", type=Path, required=True)
    parser.add_argument("--case", choices=("bootstrap", "concurrency", "failures"), required=True)
    args = parser.parse_args()
    print(json.dumps(evaluate(args.skill, args.case), ensure_ascii=False, indent=2))
