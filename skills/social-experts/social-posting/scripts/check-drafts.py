#!/usr/bin/env python3
"""check-drafts.py — 소셜 초안 하드 제약 검사기 (기계 판정) + 게시 페이로드 추출.

Usage:
    uv run --with grapheme --with pyyaml check-drafts.py <job-dir>                # 하드 제약 검사
    uv run --with grapheme --with pyyaml check-drafts.py <job-dir> --platform <p> # 게시 페이로드 JSON

하드 제약(Hard constraint)만 차단한다 — 위반 시 exit 1. 플랫폼 간 문형 중복은 warnings
배열로 알릴 뿐 게시를 차단하지 않는다(convention 등급 — ok·exit code에 영향 없음).
그 외 Convention·Heuristic 규칙은 docs/playbook-*.md 지침이 담당한다. 플랫폼별 단위와
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
THREAD_SUPPORTED = {"x", "bluesky"}  # 답글 체인이 네이티브인 플랫폼만 스레드 지원
THREAD_MAX = {"x": 25}  # X 스레드 게시물 상한. bluesky는 근거 없는 상한을 두지 않는다
ALT_REQUIRED = {"bluesky"}  # 이미지 alt text 필수 플랫폼
HASHTAG_MAX = {"bluesky": 1}
URL_WEIGHT = 23  # X: URL은 길이와 무관하게 23 (transformedURLLength)
DUP_WINDOW = 10  # 플랫폼 간 문형 중복 경고 임계값 (정규화 글자 수)

# X 가중 규칙 — twitter-text v3(config/v3.json, X 공식 카운팅 라이브러리) 화이트리스트 방식:
# 아래 4개 범위의 코드포인트만 weight 100(=1자), 나머지 전부 default 200(=2자).
# 한글·한자·이모지·비라틴 문자가 전부 2로 계산되고, 이모지는 grapheme cluster
# (ZWJ 시퀀스 포함) 1개 = 2다. 근거: https://github.com/twitter/twitter-text config/v3.json
X_LIGHT_RANGES = (
    (0x0000, 0x10FF),  # 라틴·라틴 확장·조합 기호
    (0x2000, 0x200D),  # 공백류·범용 구두점 일부
    (0x2010, 0x201F),  # 하이픈·따옴표
    (0x202F, 0x2037),  # 좁은 공백·프라임
)


class DraftFormatError(Exception):
    """초안 형식이 파싱 불가 — fail-closed 위반으로 취급한다."""


def _grapheme_weight(g: str) -> int:
    """grapheme cluster 1개의 X 가중치 — 구성 코드포인트 전부가 light 범위면 1, 하나라도 밖이면 2."""
    for ch in g:
        cp = ord(ch)
        if not any(lo <= cp <= hi for lo, hi in X_LIGHT_RANGES):
            return 2
    return 1


def x_weighted_length(text: str) -> int:
    """X 가중 길이 — twitter-text v3: URL 23 고정, 나머지는 grapheme별 light(1)/default(2)."""
    total = 0
    pos = 0
    segments = []
    for m in URL_RE.finditer(text):
        segments.append(text[pos : m.start()])
        total += URL_WEIGHT
        pos = m.end()
    segments.append(text[pos:])
    for seg in segments:
        total += sum(_grapheme_weight(g) for g in grapheme.graphemes(seg))
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


def _normalized_body(posts) -> str:
    """게시물 본문 → 중복 비교용 정규화 문자열 (URL·공백·문장부호 제거, 한글·숫자 유지)."""
    text = URL_RE.sub("", "\n".join(posts))
    return re.sub(r"[\W_]+", "", text, flags=re.UNICODE)


def _dup_fragment(a: str, b: str):
    """두 정규화 본문의 공통 10자 연속 구간 — 있으면 그 조각, 없으면 None.

    ponytail: 고정 길이 윈도우 집합 비교(O(n+m))라 표현만 바꾼 패러프레이즈 중복은
    못 잡는다 — 경고는 신호이고 차등화 판단은 Stage 7 에이전트 몫이다.
    """
    if len(a) < DUP_WINDOW or len(b) < DUP_WINDOW:
        return None
    if len(a) > len(b):
        a, b = b, a
    windows = {a[i : i + DUP_WINDOW] for i in range(len(a) - DUP_WINDOW + 1)}
    for i in range(len(b) - DUP_WINDOW + 1):
        w = b[i : i + DUP_WINDOW]
        if w in windows:
            return w
    return None


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

    # format·게시물 수 정합 — 스레드 지원 플랫폼·상한 포함
    fmt = str(meta.get("format") or "single")
    if fmt == "thread":
        if platform not in THREAD_SUPPORTED:
            result["violations"].append(
                f"{platform}은(는) 스레드 게시를 지원하지 않는다 — format: single로 작성하세요"
            )
        if len(posts) < 2:
            result["violations"].append(
                f"스레드(format: thread)인데 게시물이 {len(posts)}개다 — 2개 이상이 필요하다"
            )
        tmax = THREAD_MAX.get(platform)
        if tmax is not None and len(posts) > tmax:
            result["violations"].append(f"스레드 게시물 {len(posts)}개 (상한 {tmax})")
    elif fmt == "single":
        if len(posts) > 1:
            result["violations"].append(
                f"단일 게시물(format: single)인데 게시물이 {len(posts)}개다 — "
                "'=== POST ===' 구분자를 지우거나 format: thread로 쓰세요"
            )
    else:
        result["violations"].append(f"알 수 없는 format: {fmt!r} (single | thread 중 하나)")

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
    bodies = {}
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
        draft_path = os.path.join(drafts_dir, fname)
        report[platform] = check_platform(platform, draft_path)
        try:
            _, posts = parse_draft(draft_path)
            bodies[platform] = _normalized_body(posts)
        except DraftFormatError:
            pass  # 파싱 불가 초안은 하드 위반으로 이미 보고됐다

    # 플랫폼 간 문형 중복 — 경고만 (ok·exit code에 영향 없음)
    warnings = []
    names = sorted(bodies)
    for i, p1 in enumerate(names):
        for p2 in names[i + 1 :]:
            frag = _dup_fragment(bodies[p1], bodies[p2])
            if frag:
                warnings.append({"platforms": [p1, p2], "fragment": frag})

    ok = bool(report) and all(r.get("ok") for r in report.values())
    print(
        json.dumps({"ok": ok, "platforms": report, "warnings": warnings}, ensure_ascii=False)
    )
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
