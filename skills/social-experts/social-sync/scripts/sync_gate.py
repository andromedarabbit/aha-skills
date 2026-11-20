#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""sync_gate.py — social-sync precheck 게이트 (LLM 없음).

orca automation precheck: 소스 플랫폼을 ego-post.mjs scan으로 읽어 동기화 대상 새 글이
있는지 판정한다. 종료 코드는 orca 규약: 0 = 동기화 대상 있음(에이전트 기상),
1 = 없음(조용히), 2 = 오류. `scan --gate`는 오류에도 6시간에 한 번만 기상한다
(gate-error.json — gitlab-mr-autopilot과 같은 규약).

상호 동기화 분류 (이번 틱에 스캔한 소스 후보 대상):
- 리플라이(parentUrl 있음) → skipped — 스레드 후속·답글은 v1 동기화 제외
- pairs(동기화 매핑)·synced·pending·drafted·matched·skipped로 이미 기록된 후보 → known
- 다른 플랫폼 후보와 정규화 텍스트 digest 일치 또는 토큰 유사도 0.6 이상 → matched
  (두 곳 이상에 이미 있는 글 — 수동 크로스포스트 포함 — 동기화 불필요)
- 위 어느 것도 아니면 new → 기상. 새 글의 스캔 산출물(scans/)은 작업 디렉터리로
  승격되고 wake-report로 tick이 회수한다. lastWake은 tick이 mark-pending으로
  new→pending 전이시키기 전까지 유지되며, tick이 누락하면 다음 scan이 재탐지해
  새 스캔 산출물과 함께 다시 wake한다.

Usage:
    sync_gate.py config --init --sources x,facebook,threads,bluesky [--days 7] [--targets x,bluesky]
    sync_gate.py scan [--gate] [--per-platform-timeout 120]
    sync_gate.py wake-report
    sync_gate.py status
    sync_gate.py mark-pending --platform x --url <permalink> --job <dir>
    sync_gate.py mark-synced --platform x --url <permalink> --target bluesky --target-url <url>
    sync_gate.py mark-skipped --platform x --url <permalink> --reason <사유>

경로(런타임 확정, 테스트는 SOCIAL_SYNC_* 환경변수로 격리):
    설정  ~/.config/social-sync/config.json
    상태  ~/.local/state/social-sync/state.json
    작업  ~/.local/share/aha-skills/social-sync/jobs/<wake-id>/
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

VERSION = "0.1.1"
# 동기화 대상 4개 플랫폼. linkedin·instagram은 v1 동기화 범위 밖이다.
SYNC_PLATFORMS = ["x", "facebook", "threads", "bluesky"]
# compareCandidates(ego-post.mjs normalizeText·similarity)와 동일 임계값 — 양쪽을 함께 바꾼다.
SIMILARITY_THRESHOLD = 0.6
ERROR_WAKE_SECONDS = 6 * 3600
MAX_POSTS = 2000  # posts 맵 상한 — 초과 시 firstSeen이 오래된 것부터 버린다

ENV_CONFIG = "SOCIAL_SYNC_CONFIG"
ENV_STATE = "SOCIAL_SYNC_STATE"
ENV_JOBS = "SOCIAL_SYNC_JOBS"
ENV_EGO_POST = "SOCIAL_SYNC_EGO_POST"
ENV_BINDING = "SOCIAL_SYNC_BINDING"
ENV_NOW = "SOCIAL_SYNC_NOW"

USAGE_HINT = "먼저 setup 모드로 config를 초기화하세요: /social-sync setup"


def fail(message, code=2):
    print(json.dumps({"status": "ERROR", "reason": message}, ensure_ascii=False))
    sys.exit(code)


def now_iso():
    override = os.environ.get(ENV_NOW)
    if override:
        return override
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(value):
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None


def home():
    return Path(os.environ.get("HOME") or str(Path.home()))


def config_path():
    return Path(os.environ.get(ENV_CONFIG, home() / ".config/social-sync/config.json"))


def state_path():
    return Path(os.environ.get(ENV_STATE, home() / ".local/state/social-sync/state.json"))


def jobs_root():
    return Path(os.environ.get(ENV_JOBS, home() / ".local/share/aha-skills/social-sync/jobs"))


def binding_path():
    return Path(os.environ.get(ENV_BINDING, home() / ".local/share/aha-skills/social-posting/binding.json"))


def ego_post_path():
    # 같은 카테고리의 sibling 스킬 스크립트. 플러그인 캐시·소스 트리 어디서든 성립한다.
    override = os.environ.get(ENV_EGO_POST)
    if override:
        return Path(override)
    return Path(__file__).resolve().parent.parent / "social-posting/scripts/ego-post.mjs"


def load_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def write_json(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


# ── 텍스트 매칭 (ego-post.mjs normalizeText·similarity 미러링) ────────────

def normalize_text(value):
    lowered = str(value or "").lower().replace("\r", " ").replace("\n", " ")
    lowered = re.sub(r"\s+", " ", lowered)
    lowered = re.sub(r"[^\w\s]", "", lowered, flags=re.UNICODE)
    # JS \p{L}\p{N}과 파이썬 \w의 차이(밑줄·결합 기호)를 흡수한다 — 문자·숫자·공백만 남긴다.
    lowered = "".join(ch for ch in lowered if ch.isalnum() or ch.isspace())
    return lowered.strip()


def similarity(left, right):
    a = set(normalize_text(left).split())
    b = set(normalize_text(right).split())
    if not a or not b:
        return 0.0
    return len(a & b) / max(len(a), len(b))


def digest_of(text):
    return hashlib.sha256(normalize_text(text).encode("utf-8")).hexdigest()


# ── config / state ────────────────────────────────────────────────────────

def parse_csv(value):
    return [item.strip() for item in (value or "").split(",") if item.strip()]


def valid_sources(sources):
    return bool(sources) and all(p in SYNC_PLATFORMS for p in sources) and len(set(sources)) == len(sources)


def cmd_config(args):
    if not getattr(args, "init", False) and not getattr(args, "threads_verified", False):
        fail("--init(초기화) 또는 --threads-verified(검증 플래그)가 필요합니다")
    if getattr(args, "threads_verified", False):
        # Threads 실환경 게시 검증 통과 후 setup이 호출한다 (SKILL.md "Threads 게시 검증" 절).
        config = load_json(config_path())
        if not config or "sources" not in config:
            fail(f"config가 없습니다. {USAGE_HINT}")
        config["threadsVerified"] = True
        write_json(config_path(), config)
        print(json.dumps({"status": "CONFIGURED", "config": config}, ensure_ascii=False))
        sys.exit(0)
    sources = parse_csv(args.sources)
    targets = parse_csv(args.targets) if args.targets else None
    if not valid_sources(sources):
        fail(f"소스가 잘못됐습니다: {args.sources}. 허용: {','.join(SYNC_PLATFORMS)}")
    if targets is not None and not valid_sources(targets):
        fail(f"대상이 잘못됐습니다: {args.targets}. 허용: {','.join(SYNC_PLATFORMS)}")
    if targets and set(targets) & set(sources):
        fail("대상과 소스는 겹치면 안 됩니다")
    if not isinstance(args.days, int) or not (1 <= args.days <= 365):
        fail(f"days는 1~365 사이여야 합니다: {args.days}")
    now = parse_iso(now_iso()) or datetime.now(timezone.utc)
    since = (now - timedelta(days=args.days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    config = {
        "version": 1,
        "sources": sources,
        "targets": targets if targets else [p for p in SYNC_PLATFORMS if p not in sources],
        "firstRunDays": args.days,
        "targetsOverride": bool(targets),
        "threadsVerified": False,
    }
    state = {
        "version": 1,
        "watermarks": {p: {"since": since, "lastChecked": None, "lastResult": None} for p in sources},
        "posts": {},
        "pairs": [],
        "pending": {},
        "lastWake": None,
        "lastScan": None,
        "gateError": None,
    }
    write_json(config_path(), config)
    write_json(state_path(), state)
    print(json.dumps({"status": "CONFIGURED", "config": config, "since": since}, ensure_ascii=False))
    sys.exit(0)


def load_config_or_fail():
    config = load_json(config_path())
    if not config or "sources" not in config:
        fail(f"config가 없습니다. {USAGE_HINT}")
    if not valid_sources(config["sources"]):
        fail("config의 sources가 잘못됐다. setup을 다시 실행하세요")
    return config


def load_state_or_fail():
    state = load_json(state_path())
    if state is None:
        fail(f"state가 없습니다. {USAGE_HINT}")
    return state


def save_state(state):
    state["version"] = 1
    write_json(state_path(), state)


# ── 스캔 ──────────────────────────────────────────────────────────────────

def binding_platforms():
    binding = load_json(binding_path())
    if not binding:
        return None
    identity = binding.get("identity") or {}
    return {p for p, v in identity.items() if v}


def precheck_env(config):
    missing = [tool for tool in ("node", "ego-browser") if not shutil.which(tool)]
    if missing:
        fail(f"의존성이 없습니다: {','.join(missing)}. ego lite·node를 설치하세요")
    bound = binding_platforms()
    if bound is None:
        fail("ego 바인딩이 없습니다. social-posting의 ego-post.mjs setup을 먼저 실행하세요")
    unbound = [p for p in config["sources"] if p not in bound]
    if unbound:
        fail(f"바인딩되지 않은 소스 플랫폼: {','.join(unbound)}. ego-post.mjs setup --platform <p>를 먼저 실행하세요")
    return bound


def run_scan(platform, since, until, scan_job_dir, timeout):
    ego_post = ego_post_path()
    if not ego_post.is_file():
        fail(f"ego-post.mjs를 찾지 못했습니다: {ego_post}")
    payload = {"platform": platform, "since": since, "until": until, "cursor": None, "jobDir": str(scan_job_dir)}
    try:
        proc = subprocess.run(
            ["node", str(ego_post), "scan"],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return None, f"{platform}: scan 시간 초과({timeout}초)"
    if proc.returncode != 0:
        lines = proc.stdout.strip().splitlines() if proc.stdout and proc.stdout.strip() else []
        reason = lines[-1] if lines else (proc.stderr or "").strip()[-300:] or "알 수 없는 오류"
        return None, f"{platform}: scan 실패 — {reason}"
    try:
        result = json.loads(proc.stdout.strip())
    except ValueError:
        try:
            result = json.loads(proc.stdout.strip().splitlines()[-1])
        except (ValueError, IndexError):
            return None, f"{platform}: scan 출력이 JSON이 아닙니다"
    if result.get("status") != "SCAN_DONE":
        return None, f"{platform}: scan 상태 {result.get('status')}"
    return result, None


def advance_watermark(current, coverage, until):
    """complete면 observedNewest(없으면 until), 불완전이면 observedOldest(없으면 until)로 전진.
    단조 보장: 현재 since보다 과거로는 가지 않는다."""
    if coverage.get("complete") is True:
        new_since = coverage.get("observedNewest") or until
    else:
        new_since = coverage.get("observedOldest") or until
    current_dt = parse_iso(current) or datetime.min.replace(tzinfo=timezone.utc)
    new_dt = parse_iso(new_since) or datetime.min.replace(tzinfo=timezone.utc)
    if new_dt > current_dt:
        return new_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    return current


# ── 분류 ──────────────────────────────────────────────────────────────────

KNOWN_STATUSES = {"synced", "pending", "drafted", "matched", "skipped"}


def valid_candidate(candidate):
    return (
        isinstance(candidate, dict)
        and isinstance(candidate.get("url"), str)
        and isinstance(candidate.get("text"), str)
    )


def build_posts_index(state):
    known = {}
    for key, post in (state.get("posts") or {}).items():
        known[key] = post.get("status")
    pair_urls = set()
    for pair in state.get("pairs") or []:
        if pair.get("sourcePlatform") and pair.get("sourceUrl"):
            pair_urls.add(f"{pair['sourcePlatform']}|{pair['sourceUrl']}")
        if pair.get("targetPlatform") and pair.get("targetUrl"):
            pair_urls.add(f"{pair['targetPlatform']}|{pair['targetUrl']}")
    return known, pair_urls


def classify(candidates, known, pair_urls):
    """후보를 new·matched·known·skipped로 분류한다. 반환: (entries, new_entries).
    크로스 매칭은 이번 틱 스캔 안에서만 판정한다 — 매칭되지 못한 수동 크로스포스트는
    matched 기록이 남아 다음 틱에 재기상하지 않는다."""
    entries = []
    undecided = []
    for candidate in candidates:
        platform = candidate.get("platform")
        url = candidate.get("url")
        key = f"{platform}|{url}"
        entry = {
            "platform": platform,
            "url": url,
            "id": candidate.get("id"),
            "text": candidate.get("text"),
            "digest": digest_of(candidate.get("text")),
            "media": [
                {"id": m.get("id"), "sourceUrl": m.get("sourceUrl"), "alt": m.get("alt")}
                for m in (candidate.get("media") or [])
                if isinstance(m, dict)
            ],
            "parentUrl": candidate.get("parentUrl"),
            "classification": None,
            "reason": None,
        }
        if candidate.get("parentUrl"):
            entry["classification"] = "skipped"
            entry["reason"] = "reply"
        elif key in pair_urls or known.get(key) in KNOWN_STATUSES:
            entry["classification"] = "known"
        else:
            undecided.append(entry)
        entries.append(entry)
    for entry in undecided:
        same_elsewhere = any(
            other["digest"] == entry["digest"]
            or similarity(other["text"], entry["text"]) >= SIMILARITY_THRESHOLD
            for other in undecided
            if other["platform"] != entry["platform"]
        )
        entry["classification"] = "matched" if same_elsewhere else "new"
    new_entries = [e for e in undecided if e["classification"] == "new"]
    return entries, new_entries


# ── scan 서브커맨드 ────────────────────────────────────────────────────────

def promote_scratch(scratch, wake_dir):
    try:
        os.replace(scratch, wake_dir)
    except OSError:
        shutil.copytree(scratch, wake_dir)
        shutil.rmtree(scratch)


def trim_posts(state):
    posts = state.get("posts") or {}
    if len(posts) <= MAX_POSTS:
        return
    ordered = sorted(posts.items(), key=lambda kv: kv[1].get("firstSeen") or "")
    for key, _post in ordered[: len(posts) - MAX_POSTS]:
        del posts[key]


def handle_scan_error(state, errors, gate_mode):
    """오류 시 비게이트는 exit 2. --gate는 6시간에 한 번만 WAKE_ERROR로 기상한다."""
    if not gate_mode:
        print(json.dumps({"status": "ERROR", "reason": "; ".join(errors)}, ensure_ascii=False))
        sys.exit(2)
    now = parse_iso(now_iso()) or datetime.now(timezone.utc)
    last = state.get("gateError") or {}
    woke_at = parse_iso(last.get("wokeAt") or "")
    if woke_at and (now - woke_at).total_seconds() < ERROR_WAKE_SECONDS:
        print(json.dumps({"status": "ERROR", "reason": "; ".join(errors)}, ensure_ascii=False))
        sys.exit(2)
    state["gateError"] = {"wokeAt": now_iso(), "errors": errors}
    save_state(state)
    print(json.dumps({"status": "WAKE_ERROR", "reason": "; ".join(errors)}, ensure_ascii=False))
    sys.exit(0)


def cmd_scan(args):
    config = load_config_or_fail()
    state = load_state_or_fail()
    precheck_env(config)

    gate_mode = args.gate
    until = now_iso()
    scan_id = uuid.uuid4().hex
    root = jobs_root()
    root.mkdir(parents=True, exist_ok=True)
    scratch = Path(tempfile.mkdtemp(prefix=".scratch-", dir=str(root)))
    errors = []
    scan_results = []
    for platform in config["sources"]:
        scan_job_dir = scratch / "scans" / scan_id / platform
        scan_job_dir.mkdir(parents=True, exist_ok=True)
        watermark = state["watermarks"].get(platform) or {}
        since = watermark.get("since") or until
        result, error = run_scan(platform, since, until, scan_job_dir, args.per_platform_timeout)
        if error:
            errors.append(error)
        else:
            scan_results.append((platform, result))

    candidates = []
    for platform, result in scan_results:
        for candidate in result.get("candidates") or []:
            if valid_candidate(candidate):
                candidates.append({**candidate, "platform": platform})
    known, pair_urls = build_posts_index(state)
    entries, new_entries = classify(candidates, known, pair_urls)

    for platform, result in scan_results:
        coverage = result.get("coverage") or {}
        previous = state["watermarks"].get(platform) or {}
        state["watermarks"][platform] = {
            "since": advance_watermark(previous.get("since"), coverage, until),
            "lastChecked": until,
            "lastResult": "ok",
        }
    scanned = {p for p, _ in scan_results}
    for platform in config["sources"]:
        if platform not in scanned:
            state["watermarks"].setdefault(platform, {"since": state["watermarks"].get(platform, {}).get("since") or until})["lastResult"] = "error"
            state["watermarks"][platform]["lastChecked"] = until

    media_by_key = {f"{e['platform']}|{e['url']}": e["media"] for e in entries}
    new_posts = []
    for entry in entries:
        key = f"{entry['platform']}|{entry['url']}"
        existing = state["posts"].get(key)
        if entry["classification"] == "new" and existing and existing.get("status") == "new":
            # 이미 new로 기록된 글(미처리 wake) — 새 스캔 산출물로 wake 정보를 갱신한다.
            new_posts.append({**existing, "media": media_by_key.get(key) or []})
            continue
        state["posts"][key] = {
            "platform": entry["platform"],
            "url": entry["url"],
            "text": entry["text"],
            "digest": entry["digest"],
            "status": entry["classification"],
            "firstSeen": (existing or {}).get("firstSeen") or until,
            "mediaCount": len(entry["media"]),
        }
        if entry["classification"] == "new":
            new_posts.append({**state["posts"][key], "media": media_by_key.get(key) or []})

    trim_posts(state)
    state["lastScan"] = {"at": until, "errors": errors}

    if new_posts:
        wake_dir = root / f"{until.replace(':', '').replace('-', '')}-{uuid.uuid4().hex[:6]}"
        promote_scratch(scratch, wake_dir)
        wake_posts = [
            {
                "platform": post["platform"],
                "url": post["url"],
                "text": post["text"],
                "digest": post["digest"],
                "media": post["media"],
                "scanRef": str(wake_dir / "scans" / scan_id / post["platform"]),
            }
            for post in new_posts
        ]
        state["lastWake"] = {"dir": str(wake_dir), "ts": until, "posts": wake_posts}
        save_state(state)
        print(json.dumps({
            "status": "WAKE",
            "dir": str(wake_dir),
            "posts": wake_posts,
            "errors": errors,
            "stopReasons": {p: (r.get("coverage") or {}).get("stopReason") for p, r in scan_results},
        }, ensure_ascii=False))
        sys.exit(0)

    shutil.rmtree(scratch, ignore_errors=True)
    state["lastWake"] = None
    save_state(state)
    if errors:
        handle_scan_error(state, errors, gate_mode)
    print(json.dumps({"status": "QUIET", "errors": errors}, ensure_ascii=False))
    sys.exit(1)


# ── 기타 서브커맨드 ────────────────────────────────────────────────────────

def cmd_wake_report(_args):
    state = load_state_or_fail()
    last_wake = state.get("lastWake")
    if not last_wake:
        print(json.dumps({"status": "NO_WAKE", "lastScan": state.get("lastScan"), "gateError": state.get("gateError")}, ensure_ascii=False))
        sys.exit(1)
    print(json.dumps({"status": "WAKE", **last_wake}, ensure_ascii=False))
    sys.exit(0)


def cmd_status(_args):
    state = load_state_or_fail()
    config = load_json(config_path()) or {}
    counts = {}
    for post in (state.get("posts") or {}).values():
        status = post.get("status") or "unknown"
        counts[status] = counts.get(status, 0) + 1
    print(json.dumps({
        "status": "STATUS",
        "version": VERSION,
        "config": {
            "sources": config.get("sources"),
            "targets": config.get("targets"),
            "threadsVerified": config.get("threadsVerified", False),
        },
        "watermarks": state.get("watermarks"),
        "postCounts": counts,
        "pairsCount": len(state.get("pairs") or []),
        "pendingCount": len(state.get("pending") or {}),
        "lastScan": state.get("lastScan"),
        "lastWake": (state.get("lastWake") or {}).get("ts"),
        "gateError": state.get("gateError"),
    }, ensure_ascii=False))
    sys.exit(0)


def cmd_mark_pending(args):
    state = load_state_or_fail()
    key = f"{args.platform}|{args.url}"
    post = (state.get("posts") or {}).get(key)
    if not post:
        fail(f"알 수 없는 글: {key}. wake-report의 platform·url을 그대로 전달하세요")
    post["status"] = "pending"
    post["job"] = args.job
    state.setdefault("pending", {})[key] = {
        "platform": args.platform,
        "url": args.url,
        "job": args.job,
        "at": now_iso(),
    }
    save_state(state)
    print(json.dumps({"status": "PENDING", "key": key}, ensure_ascii=False))
    sys.exit(0)


def cmd_mark_synced(args):
    state = load_state_or_fail()
    key = f"{args.platform}|{args.url}"
    post = (state.get("posts") or {}).get(key)
    if not post:
        fail(f"알 수 없는 글: {key}")
    pair = {
        "sourcePlatform": args.platform,
        "sourceUrl": args.url,
        "targetPlatform": args.target,
        "targetUrl": args.target_url,
        "sourceDigest": post.get("digest"),
        "syncedAt": now_iso(),
        "via": args.via,
    }
    pairs = state.setdefault("pairs", [])
    duplicate = any(
        p.get("sourcePlatform") == pair["sourcePlatform"]
        and p.get("sourceUrl") == pair["sourceUrl"]
        and p.get("targetPlatform") == pair["targetPlatform"]
        for p in pairs
    )
    if not duplicate:
        pairs.append(pair)
    post["status"] = "synced"
    state.get("pending", {}).pop(key, None)
    save_state(state)
    print(json.dumps({"status": "SYNCED", "key": key}, ensure_ascii=False))
    sys.exit(0)


def cmd_mark_skipped(args):
    state = load_state_or_fail()
    key = f"{args.platform}|{args.url}"
    post = (state.get("posts") or {}).get(key)
    if not post:
        fail(f"알 수 없는 글: {key}")
    post["status"] = "skipped"
    post["skipReason"] = args.reason
    save_state(state)
    print(json.dumps({"status": "SKIPPED", "key": key}, ensure_ascii=False))
    sys.exit(0)


# ── 진입점 ────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="social-sync precheck 게이트 (LLM 없음)")
    sub = parser.add_subparsers(dest="command", required=True)

    p_config = sub.add_parser("config", help="config·state 초기화 (setup 모드에서 호출)")
    p_config.add_argument("--init", action="store_true")
    p_config.add_argument("--sources", required=False)
    p_config.add_argument("--threads-verified", action="store_true")
    p_config.add_argument("--targets", default=None)
    p_config.add_argument("--days", type=int, default=7)
    p_config.set_defaults(func=cmd_config)

    p_scan = sub.add_parser("scan", help="소스 스캔·분류 (precheck)")
    p_scan.add_argument("--gate", action="store_true")
    p_scan.add_argument("--per-platform-timeout", type=int, default=120)
    p_scan.set_defaults(func=cmd_scan)

    sub.add_parser("wake-report", help="마지막 wake 정보를 출력한다").set_defaults(func=cmd_wake_report)
    sub.add_parser("status", help="상태를 JSON 한 줄로 출력한다").set_defaults(func=cmd_status)

    p_pending = sub.add_parser("mark-pending", help="글을 승인 대기로 표시한다")
    p_pending.add_argument("--platform", required=True)
    p_pending.add_argument("--url", required=True)
    p_pending.add_argument("--job", required=True)
    p_pending.set_defaults(func=cmd_mark_pending)

    p_synced = sub.add_parser("mark-synced", help="동기화 매핑을 기록한다")
    p_synced.add_argument("--platform", required=True)
    p_synced.add_argument("--url", required=True)
    p_synced.add_argument("--target", required=True)
    p_synced.add_argument("--target-url", required=True)
    p_synced.add_argument("--via", default="sync")
    p_synced.set_defaults(func=cmd_mark_synced)

    p_skip = sub.add_parser("mark-skipped", help="수동 스킵을 기록한다 (RT·인용 등)")
    p_skip.add_argument("--platform", required=True)
    p_skip.add_argument("--url", required=True)
    p_skip.add_argument("--reason", required=True)
    p_skip.set_defaults(func=cmd_mark_skipped)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
