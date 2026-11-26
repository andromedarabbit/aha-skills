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
- 위 어느 것도 아니면 new → 기상. tick이 선점한 글을 대기열로 넘길 때까지 wake를 유지한다.

경로(런타임 확정, 테스트는 SOCIAL_SYNC_* 환경변수로 격리):
    설정  ~/.config/social-sync/config.json
    상태  ~/.local/state/social-sync/state.json
    작업  ~/.local/share/aha-skills/social-sync/jobs/<wake-id>/
"""

import argparse
import fcntl
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

VERSION = "0.1.3"
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
    return posting_scripts() / "ego-post.mjs"


def posting_scripts():
    return Path(__file__).resolve().parents[2] / "social-posting/scripts"


def load_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def write_json(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            json.dump(payload, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


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
    if os.path.lexists(config_path()) or os.path.lexists(state_path()):
        fail("기존 설정 또는 상태가 있어 초기화하지 않았습니다. /social-sync status로 확인하세요")
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
        "targets": targets if targets else SYNC_PLATFORMS,
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
    write_json(state_path(), state)


def respond(payload, code=0):
    print(json.dumps(payload, ensure_ascii=False))
    sys.exit(code)


def targets_for(config, source, bound):
    pool = config.get("targets", []) if config.get("targetsOverride", True) else SYNC_PLATFORMS
    return [p for p in pool if p in SYNC_PLATFORMS and p != source and p in bound
            and (p != "threads" or config.get("threadsVerified"))]


# ── 스캔 ──────────────────────────────────────────────────────────────────

def binding_platforms():
    binding = load_json(binding_path())
    if not binding:
        return None
    identity = binding.get("identity") or {}
    return {p for p, v in identity.items() if v}


def scan_environment():
    missing = [tool for tool in ("node", "ego-browser") if not shutil.which(tool)]
    if missing:
        return None, f"의존성이 없습니다: {','.join(missing)}. ego lite·node를 설치하세요"
    if not ego_post_path().is_file():
        return None, f"ego-post.mjs를 찾지 못했습니다: {ego_post_path()}"
    bound = binding_platforms()
    if bound is None:
        return None, "ego 바인딩이 없습니다. social-posting setup을 먼저 실행하세요"
    return bound, None


def run_scan(platform, since, until, scan_job_dir, timeout):
    ego_post = ego_post_path()
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
    if not isinstance(result, dict) or result.get("status") != "SCAN_DONE":
        return None, f"{platform}: SCAN_DONE 응답이 아닙니다"
    if not isinstance(result.get("coverage"), dict) or not isinstance(result.get("candidates"), list):
        return None, f"{platform}: scan 응답에 coverage 또는 candidates가 없습니다"
    return result, None


def advance_watermark(current, coverage, until):
    if coverage.get("complete") is not True:
        return current
    previous = parse_iso(current)
    observed = parse_iso(coverage.get("observedNewest") or until)
    end = parse_iso(until)
    if previous and observed and end and previous < observed <= end:
        return observed.strftime("%Y-%m-%dT%H:%M:%SZ")
    return current


# ── 분류 ──────────────────────────────────────────────────────────────────

KNOWN_STATUSES = {"synced", "pending", "drafted", "matched", "skipped"}


def valid_candidate(candidate):
    return (
        isinstance(candidate, dict)
        and isinstance(candidate.get("url"), str)
        and candidate["url"].startswith(("https://", "http://"))
        and isinstance(candidate.get("text"), str)
        and isinstance(candidate.get("media", []), list)
    )


def build_posts_index(state):
    known = {}
    for key, post in (state.get("posts") or {}).items():
        known[key] = post.get("status")
    known.update((key, "pending") for key in state.get("pending", {}))
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

def trim_posts(state):
    posts = state.get("posts") or {}
    protected = state.get("pending", {})
    for key, post in sorted(posts.items(), key=lambda item: item[1].get("firstSeen") or ""):
        if len(posts) <= MAX_POSTS:
            break
        if key not in protected and post.get("status") not in {"new", "pending"}:
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


SCAN_LIMITS = {"POST_LIMIT", "SCROLL_STALLED", "TIME_LIMIT"}


def scan(config, state, timeout):
    until = now_iso()
    errors, stop_reasons, candidates = [], {}, {}
    watermarks = state["watermarks"]
    bound, env_error = scan_environment()
    wake_dir = jobs_root().resolve() / uuid.uuid4().hex
    for platform in config["sources"]:
        watermark = watermarks[platform]
        since = watermark["since"]
        result, error = None, env_error
        if not error and platform not in bound:
            error = f"{platform}: 바인딩되지 않은 소스"
        if not error and parse_iso(until) <= parse_iso(since):
            continue
        if not error:
            result, error = run_scan(platform, since, until, wake_dir, timeout)
        if result:
            coverage = result["coverage"]
            stop = coverage.get("stopReason")
            stop_reasons[platform] = stop
            if stop and stop not in SCAN_LIMITS:
                error = f"{platform}: scan 중단 — {stop}"
            for candidate in result["candidates"]:
                if not valid_candidate(candidate):
                    error = error or f"{platform}: 원본 URL 또는 후보 형식이 올바르지 않습니다"
                    continue
                if candidate.get("media"):
                    reference = Path(str(result.get("jobDir") or ""))
                    digest = result.get("manifestDigest")
                    candidate_id = candidate.get("id")
                    if (not reference.is_absolute() or reference.resolve() != reference or
                            reference.parent.parent.parent != wake_dir or reference.parent.parent.name != "scans" or
                            reference.name != platform or not (reference / "scan-manifest.json").is_file() or
                            not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest) or
                            not isinstance(candidate_id, str) or not candidate_id):
                        error = error or f"{platform}: 사진 후보의 scan manifest를 확인하지 못했습니다"
                        continue
                candidates.setdefault((platform, candidate["url"]), {
                    **candidate, "platform": platform, "scanRef": result.get("jobDir"),
                    "manifestDigest": result.get("manifestDigest"),
                })
            if not error:
                watermark["since"] = advance_watermark(since, coverage, until)
        if error:
            errors.append(error)
        watermark.update(lastChecked=until, lastResult=("error" if error else
                         "ok" if coverage.get("complete") is True else "partial"))

    known, pair_urls = build_posts_index(state)
    entries, _ = classify(candidates.values(), known, pair_urls)
    wake_posts = []
    for entry in entries:
        platform, url = entry["platform"], entry["url"]
        key = f"{platform}|{url}"
        existing = state["posts"].get(key) or {}
        status = entry["classification"]
        if status == "known" or key in state.get("pending", {}) or existing.get("status") in KNOWN_STATUSES:
            continue
        state["posts"][key] = {
            "platform": platform, "url": url, "text": entry["text"], "digest": entry["digest"],
            "status": status, "firstSeen": existing.get("firstSeen") or until, "mediaCount": len(entry["media"]),
        }
        if status == "new":
            artifact = candidates[platform, url]
            wake_posts.append({**state["posts"][key], "media": entry["media"], "candidateId": entry["id"],
                               "scanRef": artifact["scanRef"], "manifestDigest": artifact["manifestDigest"]})

    trim_posts(state)
    state["lastScan"] = {"at": until, "errors": errors, "stopReasons": stop_reasons}
    if wake_posts:
        state["lastWake"] = {"dir": str(wake_dir), "ts": until, "posts": wake_posts,
                             "errors": errors, "stopReasons": stop_reasons}
    save_state(state)
    if not wake_posts:
        shutil.rmtree(wake_dir, ignore_errors=True)
    return errors


def outstanding_wake(state):
    wake = state.get("lastWake")
    if not wake:
        return None
    posts = [p for p in wake["posts"] if
             (key := f"{p['platform']}|{p['url']}") not in state.get("pending", {}) and
             state["posts"].get(key, {}).get("status") not in KNOWN_STATUSES]
    if not posts:
        return None
    return {**wake, "posts": posts}


def show_wake(state, wake):
    if not wake:
        respond({"status": "NO_WAKE", "lastScan": state.get("lastScan"), "gateError": state.get("gateError")}, 1)
    respond({"status": "WAKE", **{k: v for k, v in wake.items() if k != "claim"}, "claimed": bool(wake.get("claim"))})


def cmd_scan(args):
    config, state = load_config_or_fail(), load_state_or_fail()
    wake = outstanding_wake(state)
    if wake and wake.get("claim"):
        respond({"status": "BUSY", "reason": "wake 처리 중"}, 1)
    if not wake and (state.get("lastScan") or {}).get("at") != now_iso():
        errors = scan(config, state, args.per_platform_timeout)
        wake = outstanding_wake(state)
        if not wake and errors:
            handle_scan_error(state, errors, args.gate)
    if wake:
        show_wake(state, wake)
    respond({"status": "QUIET", "lastScan": state.get("lastScan")}, 1)


def cmd_wake_report(_args):
    state = load_state_or_fail()
    show_wake(state, outstanding_wake(state))


def cmd_tick(args):
    config, state = load_config_or_fail(), load_state_or_fail()
    wake = outstanding_wake(state)
    if not wake and not state.get("lastScan"):
        errors = scan(config, state, args.per_platform_timeout)
        wake = outstanding_wake(state)
        if not wake and errors:
            handle_scan_error(state, errors, False)
    if not wake:
        show_wake(state, None)
    if wake.get("claim"):
        respond({"status": "BUSY", "reason": "wake 처리 중"}, 1)
    claim = uuid.uuid4().hex
    bound = binding_platforms() or set()
    for item in wake["posts"]:
        key = f"{item['platform']}|{item['url']}"
        item["job"] = str(Path(wake["dir"]) / "draft-jobs" / claim / hashlib.sha256(key.encode()).hexdigest())
        item["targets"] = targets_for(config, item["platform"], bound)
    wake["claim"] = claim
    state["lastWake"] = wake
    save_state(state)
    respond({"status": "WAKE", **wake})


def cmd_status(_args):
    state = load_state_or_fail()
    config = load_json(config_path()) or {}
    counts = {}
    wake = outstanding_wake(state)
    pending = state.get("pending") or {}
    for post in (state.get("posts") or {}).values():
        status = post.get("status") or "unknown"
        counts[status] = counts.get(status, 0) + 1
    print(json.dumps({
        "status": "STATUS",
        "version": VERSION,
        "config": {
            "sources": config.get("sources"),
            "targets": config.get("targets") if config.get("targetsOverride", True) else SYNC_PLATFORMS,
            "threadsVerified": config.get("threadsVerified", False),
        },
        "watermarks": state.get("watermarks"),
        "postCounts": counts,
        "pairsCount": len(state.get("pairs") or []),
        "pendingCount": len(pending),
        "pending": [pending_projection(state, key, item) for key, item in pending.items()],
        "lastScan": state.get("lastScan"),
        "lastWake": wake.get("ts") if wake else None,
        "wakeClaim": wake.get("claim") if wake else None,
        "gateError": state.get("gateError"),
    }, ensure_ascii=False))
    sys.exit(0)


def claim_item(state, args):
    wake = outstanding_wake(state)
    if not wake or wake.get("claim") != args.claim:
        fail("현재 wake의 선점 ID와 일치하지 않습니다")
    key = f"{args.platform}|{args.url}"
    for item in wake["posts"]:
        if (item["platform"], item["url"]) == (args.platform, args.url):
            return wake, key, item
    fail(f"이 wake에 처리할 원본이 없습니다: {key}")


def consume(state, wake, item):
    wake["posts"].remove(item)
    state["lastWake"] = wake if wake["posts"] else None
    save_state(state)


def cmd_release_wake(args):
    state = load_state_or_fail()
    wake = outstanding_wake(state)
    if not wake or wake.get("claim") != args.claim:
        fail("반환할 선점 ID와 현재 wake가 일치하지 않습니다")
    del wake["claim"]
    state["lastWake"] = wake
    save_state(state)
    respond({"status": "RELEASED", "remaining": len(wake["posts"])})


def cmd_prepare_media(args):
    state = load_state_or_fail()
    _, _, item = claim_item(state, args)
    if not item.get("media"):
        respond({"status": "MEDIA_READY", "media": []})
    if not all(item.get(field) for field in ("scanRef", "candidateId", "manifestDigest")):
        fail("레거시 wake의 사진 스캔 근거가 없습니다. 원본을 확인하기 전에는 처리하지 않습니다")
    ref, job = Path(item["scanRef"]), Path(item["job"])
    source_dir, dest_dir = ref.parents[2] / "media", job / "media"
    dest_dir.mkdir(parents=True, exist_ok=True)
    result = []
    for photo in item["media"][:4]:
        payload = {"jobDir": str(ref), "platform": item["platform"], "candidateId": item["candidateId"],
                   "sourceUrl": photo.get("sourceUrl")}
        default_alt = not photo.get("alt")
        if default_alt or sum(m.get("sourceUrl") == photo.get("sourceUrl") for m in item["media"]) > 1:
            payload["altOverride"] = {"manifestDigest": item["manifestDigest"], "mediaId": photo["id"],
                                      "alt": photo.get("alt") or "이미지"}
        try:
            proc = subprocess.run(["node", str(ego_post_path()), "fetch-media"], input=json.dumps(payload),
                                  capture_output=True, text=True, timeout=120)
            fetched = json.loads(proc.stdout)
        except (OSError, subprocess.TimeoutExpired, ValueError):
            fail("사진 수집 실패: 검증된 사진 응답을 받지 못했습니다")
        if proc.returncode or not isinstance(fetched, list) or len(fetched) != 1 or not isinstance(fetched[0], dict):
            fail("사진 수집에 실패했습니다. 원본은 wake에 남아 있습니다")
        media = fetched[0]
        files = {}
        for field in ("path", "provenancePath"):
            src = Path(str(media.get(field) or ""))
            if src.parent != source_dir or src.is_symlink() or not src.is_file():
                fail("사진 또는 출처 경로가 스캔 작업과 일치하지 않습니다")
            dest = dest_dir / src.name
            if dest.is_symlink():
                fail("사진 작업 경로가 심볼릭 링크입니다")
            shutil.copyfile(src, dest)
            files[field] = str(dest.relative_to(job))
        result.append({"path": files["path"], "source": "scan", "sha256": media["sha256"], "alt": media["alt"],
                       "provenance": files["provenancePath"], "provenance_sha256": media["provenanceSha256"],
                       "defaultAlt": default_alt})
    respond({"status": "MEDIA_READY", "media": result, "omitted": len(item["media"]) - len(result)})


def cmd_mark_pending(args):
    state = load_state_or_fail()
    wake, key, item = claim_item(state, args)
    job, targets = Path(item["job"]), item["targets"]
    if args.job != str(job) or not targets or not (job / "job-state.md").is_file() or any(
        not (job / "drafts" / f"{p}.md").is_file() for p in targets
    ):
        fail("선점된 작업 경로에 상태와 대상별 초안이 있어야 합니다")
    validation = subprocess.run(["uv", "run", "-q", "--with", "grapheme", "--with", "pyyaml", "python",
                                 str(posting_scripts() / "check-drafts.py"), str(job)], capture_output=True, text=True)
    if validation.returncode:
        fail(f"초안 검사 실패: {validation.stdout.strip()} {validation.stderr.strip()}")
    post = state["posts"].setdefault(key, {k: item.get(k) for k in ("platform", "url", "text", "digest")})
    post.update(status="pending", job=str(job))
    state.setdefault("pending", {})[key] = {
        "platform": args.platform, "url": args.url, "job": str(job), "at": now_iso(),
        "targets": targets, "outcomes": {},
    }
    consume(state, wake, item)
    respond({"status": "PENDING", "key": key})


def cmd_mark_skipped(args):
    state = load_state_or_fail()
    wake, key, item = claim_item(state, args)
    post = state["posts"].setdefault(key, {k: item.get(k) for k in ("platform", "url", "text", "digest")})
    post.update(status="skipped", skipReason=args.reason)
    consume(state, wake, item)
    respond({"status": "SKIPPED", "key": key})


def pending_projection(state, key, pending):
    job = Path(pending["job"])
    targets = pending.get("targets")
    review = None
    if targets is None:
        siblings = [p for p in state["pending"].values() if p["job"] == str(job)]
        # 이전 버전의 공용 작업 또는 게시 시도 기록은 원본·대상별로 구분할 수 없다.
        receipt = load_json(job / "receipt.json")
        if ((job / "receipt.json").exists() and not isinstance(receipt, dict) or
                any(k.startswith("posted_") for k in (receipt or {})) or len(siblings) != 1 or
                (job / "post-log.md").exists()):
            review = "이전 작업의 게시 기록과 원본을 먼저 확인하세요"
        try:
            header = (job / "job-state.md").read_text(encoding="utf-8").split("---")[1]
            match = re.search(r"^platforms: *\[([^\n\]]*)\] *$", header, re.MULTILINE)
            targets = parse_csv(match[1]) if match else []
        except (OSError, ValueError, IndexError):
            targets = []
        if not valid_sources(targets) or pending["platform"] in targets or "threads" in targets:
            review = "이전 작업의 게시 대상을 확인할 수 없습니다"
    outcomes = pending.get("outcomes", {})
    available = [p for p in targets if outcomes.get(p, {}).get("status") in {None, "POST_FAILED", "GUARD_BLOCKED"}]
    return {**pending, "key": key, "targets": targets, "outcomes": outcomes,
            "readyTargets": [] if review else available, "review": review}


def record_posted(state, key, platform, url, via):
    post = state["posts"][key]
    pairs = state.setdefault("pairs", [])
    pair = next((p for p in pairs if p.get("sourcePlatform") == post["platform"] and
                 p.get("sourceUrl") == post["url"] and p.get("targetPlatform") == platform), None)
    if pair is None:
        pairs.append({"sourcePlatform": post["platform"], "sourceUrl": post["url"], "targetPlatform": platform,
                      "targetUrl": url, "sourceDigest": post.get("digest"), "syncedAt": now_iso(), "via": via})
    elif url and not pair.get("targetUrl"):
        pair["targetUrl"] = url
    pending = state.get("pending", {}).get(key)
    if pending and pending.get("targets") and all(
        pending["outcomes"].get(p, {}).get("status") == "POSTED" for p in pending["targets"]
    ):
        post["status"] = "synced"
        del state["pending"][key]


def cmd_mark_synced(args):
    state = load_state_or_fail()
    key = f"{args.platform}|{args.url}"
    if key not in state["posts"] or args.target not in SYNC_PLATFORMS or args.target == args.platform:
        fail("원본 또는 게시 대상이 올바르지 않습니다")
    pending = state.get("pending", {}).get(key)
    if pending:
        view = pending_projection(state, key, pending)
        if view["review"] or args.target not in view["targets"]:
            fail("이 작업과 게시 대상의 연결을 확인할 수 없습니다")
        pending.update(targets=view["targets"], outcomes=view["outcomes"])
        previous = pending["outcomes"].get(args.target, {})
        pending["outcomes"][args.target] = {**previous, "status": "POSTED"}
    elif not any(p.get("sourcePlatform") == args.platform and p.get("sourceUrl") == args.url and
                 p.get("targetPlatform") == args.target for p in state.get("pairs", [])):
        fail("확인할 게시 시도나 기존 동기화 기록이 없습니다")
    record_posted(state, key, args.target, args.target_url, args.via)
    save_state(state)
    respond({"status": "SYNCED", "key": key})


def cmd_publish_pending(args):
    state = load_state_or_fail()
    key = f"{args.platform}|{args.url}"
    pending = state.get("pending", {}).get(key)
    if not pending or key not in state["posts"]:
        fail("승인 대기 중인 원본이 아닙니다")
    view = pending_projection(state, key, pending)
    if args.target not in view["readyTargets"]:
        fail("게시 가능 대상이 아닙니다. 기존 게시 결과를 먼저 확인하세요")
    pending.update(targets=view["targets"], outcomes=view["outcomes"])
    receipt = load_json(Path(pending["job"]) / "receipt.json")
    approved_at = receipt.get("approved_at") if isinstance(receipt, dict) else None
    previous = pending["outcomes"].get(args.target, {})
    if previous.get("approvedAt") and previous["approvedAt"] == approved_at:
        fail("이전 시도 이후 새 게시 승인이 필요합니다")
    pending["outcomes"][args.target] = {"status": "IN_PROGRESS", "at": now_iso(), "approvedAt": approved_at}
    save_state(state)
    proc = subprocess.run(["bash", str(posting_scripts() / "publish.sh"), "--job", pending["job"],
                           "--platform", args.target], capture_output=True, text=True)
    result = {}
    for line in proc.stdout.splitlines():
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict):
            result = value
    status = result.get("status")
    if status == "POSTED" and proc.returncode == 0:
        pass
    elif status not in {"POST_FAILED", "PARTIAL_POSTED", "POST_UNKNOWN"}:
        status = "GUARD_BLOCKED" if proc.returncode == 1 and not proc.stdout else "POST_UNKNOWN"
    urls = result.get("urls") or []
    pending["outcomes"][args.target].update(status=status, urls=urls, reason=result.get("reason"))
    if status == "POSTED":
        record_posted(state, key, args.target, urls[0] if urls else None, "sync")
    save_state(state)
    respond({"status": status, "target": args.target, "urls": urls, "details": proc.stderr.strip()},
            0 if status == "POSTED" else 2)


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

    p_tick = sub.add_parser("tick", help="첫 스캔 또는 wake 선점")
    p_tick.add_argument("--per-platform-timeout", type=int, default=120)
    p_tick.set_defaults(func=cmd_tick)
    sub.add_parser("wake-report", help="남은 wake를 읽는다").set_defaults(func=cmd_wake_report)
    sub.add_parser("status", help="상태를 JSON으로 출력한다").set_defaults(func=cmd_status)

    def post_command(name, func, *, claim=False, target=False):
        command = sub.add_parser(name)
        command.add_argument("--platform", required=True, choices=SYNC_PLATFORMS)
        command.add_argument("--url", required=True)
        if claim:
            command.add_argument("--claim", required=True)
        if target:
            command.add_argument("--target", required=True, choices=SYNC_PLATFORMS)
        command.set_defaults(func=func)
        return command

    release = sub.add_parser("release-wake", help="남은 wake를 반환한다")
    release.add_argument("--claim", required=True)
    release.set_defaults(func=cmd_release_wake)
    post_command("prepare-media", cmd_prepare_media, claim=True)
    post_command("mark-pending", cmd_mark_pending, claim=True).add_argument("--job", required=True)
    post_command("mark-skipped", cmd_mark_skipped, claim=True).add_argument("--reason", required=True)
    synced = post_command("mark-synced", cmd_mark_synced, target=True)
    synced.add_argument("--target-url")
    synced.add_argument("--via", default="sync")
    post_command("publish-pending", cmd_publish_pending, target=True)

    args = parser.parse_args()
    if args.command in {"wake-report", "status"}:
        args.func(args)
        return
    lock = state_path().resolve().with_name(state_path().name + ".lock")
    lock.parent.mkdir(parents=True, exist_ok=True)
    with lock.open("a") as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            respond({"status": "BUSY", "reason": "다른 동기화 명령 실행 중"}, 1)
        args.func(args)


if __name__ == "__main__":
    main()
