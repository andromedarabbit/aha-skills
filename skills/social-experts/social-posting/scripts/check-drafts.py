#!/usr/bin/env python3
"""check-drafts.py — 소셜 초안 하드 제약 검사기 (기계 판정) + 게시 페이로드 추출.

Usage:
    uv run --with grapheme --with pyyaml check-drafts.py <job-dir>                # 하드 제약 검사
    uv run --with grapheme --with pyyaml check-drafts.py <job-dir> --platform <p> # 게시 페이로드 JSON

하드 제약(Hard constraint)만 검사한다 — 위반 시 exit 1. Convention·Heuristic 규칙은
docs/playbook-*.md 지침이 담당하며 이 검사가 게시를 차단하지 않는다. 플랫폼별 단위와
근거는 docs/REFERENCE.md 참조.

파서는 fail-closed다: frontmatter가 --- 로 시작하는데 닫는 구분자가 없거나, 매핑이
아니거나, media 항목이 매핑이 아니면 모두 위반으로 취급한다 (BOM은 읽기 시점에 제거).

--platform 모드는 publish.sh가 소비한다: 본문(frontmatter 제거, 스레드 구분자 유지)과
media(작업 디렉토리 기준 절대경로)·link·format을 JSON으로 출력한다. 승인 digest는
초안 전체 파일 기준이므로 페이로드와 별개로 유지된다.

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


class DraftFormatError(Exception):
    """초안 형식이 파싱 불가 — fail-closed 위반으로 취급한다."""


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


def _split_raw(raw: str):
    """원문 -> (frontmatter dict, 본문 문자열). fail-closed 파싱의 단일 구현."""
    if raw.startswith("---"):
        first_line = raw.split("\n", 1)[0]
        if first_line != "---":
            raise DraftFormatError(
                f"frontmatter 시작 구분자가 '---'와 정확히 일치하지 않습니다: {first_line!r}"
            )
        fm_end = raw.find("\n---\n", 3)
        if fm_end == -1:
            raise DraftFormatError("frontmatter가 닫는 구분자 없이 끝납니다")
        meta = yaml.safe_load(raw[4:fm_end])
        if meta is None:
            meta = {}
        if not isinstance(meta, dict):
            raise DraftFormatError("frontmatter가 매핑(key: value) 형식이 아닙니다")
        return meta, raw[fm_end + len("\n---\n") :]
    return {}, raw


def parse_draft(path: str):
    """초안 파일 -> (frontmatter dict, 게시물 문자열 리스트)."""
    with open(path, encoding="utf-8-sig") as f:  # BOM은 제거하고 읽는다
        raw = f.read()
    meta, body = _split_raw(raw)
    posts = [p.strip("\n") for p in body.split(f"\n{THREAD_SEP}\n")]
    posts = [p for p in posts if p.strip()]
    return meta, posts


def _media_items(meta: dict):
    """media 목록 정규화 — 매핑이 아닌 항목은 DraftFormatError (fail-closed)."""
    media = meta.get("media") or []
    if not isinstance(media, list):
        raise DraftFormatError("media가 리스트 형식이 아닙니다")
    items = []
    for item in media:
        if not isinstance(item, dict):
            raise DraftFormatError("media 항목이 'path:'/'alt:' 매핑이 아닙니다")
        items.append(item)
    return items


def check_platform(platform: str, draft_path: str) -> dict:
    result = {"ok": True, "counts": [], "violations": []}
    name = os.path.basename(draft_path)[: -len(".md")]
    try:
        meta, posts = parse_draft(draft_path)
        media = _media_items(meta)
    except DraftFormatError as e:
        result["violations"].append(f"초안 형식 오류(fail-closed): {e}")
        result["ok"] = False
        return result

    # frontmatter platform 필드는 파일명과 같아야 한다 (파일명끼리 비교하는 죽은 검사가 아니라
    # 실제 frontmatter 값을 읽는다)
    if meta and meta.get("platform") != name:
        result["violations"].append(
            f"frontmatter platform({meta.get('platform')!r})이 파일명({name})과 다릅니다"
        )

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

    media_max = limits["media_max"]
    if media_max is not None and len(media) > media_max:
        result["violations"].append(f"미디어 {len(media)}개 (상한 {media_max})")
    if platform in ALT_REQUIRED:
        for item in media:
            if not str(item.get("alt", "")).strip():
                result["violations"].append(
                    f"미디어 {item.get('path', '?')}: alt text가 없습니다"
                )
    result["ok"] = not result["violations"]
    return result


def payload_for(platform: str, job: str) -> dict:
    """게시 페이로드 — 본문(frontmatter 제거) + 절대경로 media + link + format."""
    draft = os.path.join(job, "drafts", f"{platform}.md")
    with open(draft, encoding="utf-8-sig") as f:
        meta, body = _split_raw(f.read())
    media = _media_items(meta)
    resolved = []
    for item in media:
        p = str(item.get("path", ""))
        if p and not os.path.isabs(p):
            p = os.path.normpath(os.path.join(job, p))
        resolved.append({"path": p, "alt": str(item.get("alt", ""))})
    return {
        "platform": platform,
        "format": str(meta.get("format") or "single"),
        "body": body.strip("\n"),
        "media": resolved,
        "link": str(meta.get("link") or ""),
    }


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print("usage: check-drafts.py <job-dir> [--platform <p>]", file=sys.stderr)
        return 1
    job = args[0].rstrip("/")

    if "--platform" in args:
        platform = args[args.index("--platform") + 1]
        if platform not in LIMITS:
            print(f"알 수 없는 플랫폼: {platform}", file=sys.stderr)
            return 1
        try:
            print(json.dumps(payload_for(platform, job), ensure_ascii=False))
            return 0
        except DraftFormatError as e:
            print(f"초안 형식 오류(fail-closed): {e}", file=sys.stderr)
            return 1

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
