#!/usr/bin/env python3
"""check-drafts.py — 소셜 초안 하드 제약 검사기 (기계 판정).

Usage:
    uv run --with grapheme --with pyyaml check-drafts.py <job-dir>

각 플랫폼 하드 제약(Hard constraint)만 검사한다 — 위반 시 exit 1.
Convention·Heuristic 규칙은 docs/playbook-*.md 지침이 담당하며 이 검사가
게시를 차단하지 않는다. 플랫폼별 단위와 근거는 docs/REFERENCE.md 참조.

출력(JSON): 플랫폼별 {ok, unit, counts, violations} + 전체 ok.
uv·의존성 부재 시 검사 불능으로 exit 1 (fail-closed — 게시 차단이 안전한 방향).
"""

import json
import os
import re
import sys
import unicodedata

try:
    import grapheme
    import yaml
except ImportError as exc:  # fail-closed
    print(
        f"검사 불능: 의존성이 없습니다 ({exc}). "
        "uv run --with grapheme --with pyyaml 로 실행하세요.",
        file=sys.stderr,
    )
    sys.exit(1)

THREAD_SEP = "=== POST ==="
URL_RE = re.compile(r"https?://\S+")
HASHTAG_RE = re.compile(r"#[^\s#]+")

# 하드 제약 상수 — 플랫폼 정책이 바뀌면 docs/REFERENCE.md·플레이북과 함께 갱신
LIMITS = {
    "x": {"unit": "weighted", "max": 280, "media_max": 4},
    "bluesky": {"unit": "grapheme", "max": 300, "media_max": 4},
    "linkedin": {"unit": "codepoint", "max": 3000, "media_max": 9},
    "facebook": {"unit": "codepoint", "max": 63206, "media_max": None},
}
ALT_REQUIRED = {"bluesky"}  # 이미지 alt text 필수 플랫폼
HASHTAG_MAX = {"bluesky": 1}
URL_WEIGHT = 23  # X: URL은 길이와 무관하게 23


def _char_weight(ch: str) -> int:
    return 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1


def x_weighted_length(text: str) -> int:
    """X 가중 길이 — URL은 23 고정, 동아시아 전각(W/F) 글자는 2."""
    total = 0
    pos = 0
    for m in URL_RE.finditer(text):
        total += sum(_char_weight(c) for c in text[pos : m.start()])
        total += URL_WEIGHT
        pos = m.end()
    total += sum(_char_weight(c) for c in text[pos:])
    return total


def measure(text: str, unit: str) -> int:
    if unit == "weighted":
        return x_weighted_length(text)
    if unit == "grapheme":
        return grapheme.length(text)
    return len(text)  # codepoint


def parse_draft(path: str):
    """초안 파일 → (frontmatter dict, 게시물 문자열 리스트)."""
    with open(path, encoding="utf-8") as f:
        raw = f.read()
    meta = {}
    body = raw
    if raw.startswith("---\n"):
        fm_end = raw.find("\n---\n", 3)
        if fm_end != -1:
            meta = yaml.safe_load(raw[4:fm_end]) or {}
            body = raw[fm_end + len("\n---\n") :]
    posts = [p.strip("\n") for p in body.split(f"\n{THREAD_SEP}\n")]
    posts = [p for p in posts if p.strip()]
    return meta, posts


def check_platform(platform: str, draft_path: str) -> dict:
    result = {"ok": True, "counts": [], "violations": []}
    name = os.path.basename(draft_path)[: -len(".md")]
    if name != platform:
        result["violations"].append(
            f"frontmatter platform({platform})이 파일명({name})과 다릅니다"
        )
    meta, posts = parse_draft(draft_path)
    limits = LIMITS[platform]
    result["unit"] = limits["unit"]

    for i, post in enumerate(posts, 1):
        n = measure(post, limits["unit"])
        result["counts"].append(n)
        if n > limits["max"]:
            result["violations"].append(
                f"게시물 {i}: {n} {limits['unit']} (상한 {limits['max']})"
            )
        if platform in HASHTAG_MAX:
            tags = len(HASHTAG_RE.findall(post))
            if tags > HASHTAG_MAX[platform]:
                result["violations"].append(
                    f"게시물 {i}: 해시태그 {tags}개 (상한 {HASHTAG_MAX[platform]})"
                )

    media = meta.get("media") or []
    media_max = limits["media_max"]
    if media_max is not None and len(media) > media_max:
        result["violations"].append(f"미디어 {len(media)}개 (상한 {media_max})")
    if platform in ALT_REQUIRED:
        for item in media:
            item = item or {}
            if not str(item.get("alt", "")).strip():
                result["violations"].append(
                    f"미디어 {item.get('path', '?')}: alt text가 없습니다"
                )
    result["ok"] = not result["violations"]
    return result


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: check-drafts.py <job-dir>", file=sys.stderr)
        return 1
    job = sys.argv[1].rstrip("/")
    drafts_dir = os.path.join(job, "drafts")
    if not os.path.isdir(drafts_dir):
        print(f"초안 디렉토리가 없습니다: {drafts_dir}", file=sys.stderr)
        return 1

    report = {}
    for fname in sorted(os.listdir(drafts_dir)):
        if not fname.endswith(".md"):
            continue
        platform = fname[: -len(".md")]
        if platform not in LIMITS:
            report[platform] = {
                "ok": False,
                "violations": [f"알 수 없는 플랫폼: {platform}"],
            }
            continue
        report[platform] = check_platform(platform, os.path.join(drafts_dir, fname))

    ok = bool(report) and all(r.get("ok") for r in report.values())
    print(json.dumps({"ok": ok, "platforms": report}, ensure_ascii=False))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
