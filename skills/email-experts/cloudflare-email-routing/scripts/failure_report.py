#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""failure_report.py - Email Routing Activity log 주간 실패 보고 (읽기 전용).

Usage: failure_report.py --zone <domain> [--days 7] [--md-out <path>] [--events-file <json>]

Activity log(GraphQL emailRoutingAdaptive)를 조회해 실패 이벤트를 사유 유형별 표로 정리한다.
같은 메시지의 재시도는 messageId로 묶고, 그 메시지의 마지막 이벤트가 delivered면 "회복"으로 센다.

토큰: CLOUDFLARE_API_TOKEN(Analytics Read) 이 있으면 그것을, 없으면 cf 로그인 OAuth 토큰을 쓴다
(cf auth whoami 로 갱신한 뒤 읽는다). 값은 출력하지 않는다.

--events-file 은 조회 대신 저장된 이벤트 JSON 배열을 쓴다 (테스트·오프라인 재현용).

exit 0  보고서 생성, 에이전트 판정 후보 없음
exit 1  보고서 생성, 에이전트 판정 후보 있음 (최종 미배달 메시지가 후보 유형에 속함)
exit 2  환경 오류 (토큰 없음, 조회 실패, 응답 한도 도달 등)
"""

import argparse
import collections
import datetime
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from typing import NoReturn

GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql"
QUERY_LIMIT = 10000
OAUTH_CONFIG = "~/Library/Preferences/cloudflare/config/default.json"

# (유형, 에이전트 후보 여부, 상태 일치, 사유 정규식) — 위에서부터 처음 맞는 규칙을 쓴다.
# status 가 None 이면 사유 정규식만 본다. 사유 정규식이 None 이면 status 만 본다.
RULES = [
    ("인증 거부(Unauthenticated)", False, "unauthenticatedForward", None),
    ("인증 거부(검사 실패)", False, None, r"DMARC checks failed|isn't allowed to send email"),
    ("Cloudflare 스팸 차단", False, "spamRejection", None),
    ("수신자 억제(Suppressed)", False, "rejected", None),
    ("Gmail 전송 한도(동일 Message-ID)", False, None, r"4\.7\.28.*same Message-ID"),
    ("Gmail 전송 한도(DKIM 도메인)", False, None, r"4\.7\.28.*DKIM domain"),
    ("Gmail 스팸 전송률 제한", False, None, r"4\.7\.28.*unsolicited mail.*rate limited"),
    ("Gmail 스팸 거절", True, None, r"5\.7\.1.*unsolicited"),
    ("Gmail 도메인 평판 거절", True, None, r"4\.7\.0.*reputation"),
    ("Gmail DMARC 정책 거절", True, None, r"5\.7\.26.*DMARC policy"),
    ("발신 측 불량·연결 오류", False, None, r"IO error|bare CR|missing or invalid address|Parsing error"),
    ("상위 서버 시간 초과", False, None, r"[Tt]imed? ?out|Timeout"),
    ("목적지 문제", True, None, r"5\.1\.1|5\.2\.1|[Uu]ser unknown|mailbox"),
]
UNCLASSIFIED = ("미분류", True)


def classify(status, detail):
    """(유형, 에이전트 후보 여부)"""
    for name, candidate, want_status, pattern in RULES:
        if want_status and status != want_status:
            continue
        if pattern and not re.search(pattern, detail or ""):
            continue
        return name, candidate
    return UNCLASSIFIED


def mask_reason(text):
    """표에 넣는 사유 원문에서 IP·주소·ID·도메인을 가린다."""
    # 모든 Gmail 사유에 붙는 공통 접두어와 안내 URL은 정보가 없어 지운다
    text = re.sub(r"upstream \([^)]*\) (?:temporary )?error: (?:Permanent )?Unknown error: (?:permanent|transient) error ", "Gmail ", text)
    text = re.sub(r"\s*Refer to https?://\S+ for more information\.?", "", text)
    text = re.sub(r"[\w.+-]+@[\w.-]+", "<email>", text)
    text = re.sub(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", "<IP>", text)
    text = re.sub(r"\[[^\]\s]+\s+\d+\]", "[<domain> n]", text)
    text = re.sub(r"email from \S+ is not accepted", "email from <domain> is not accepted", text)
    text = re.sub(r"\b[a-z0-9]{12,}(?:\.\d+)?\b", "<id>", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:120]


def sender_domain(from_header):
    found = re.search(r"@([\w.-]+)", from_header or "")
    return found.group(1).lower() if found else "-"


def message_key(event, index):
    return event.get("messageId") or f"_noid_{index}"


def summarize(events):
    """이벤트 목록(시간 오름차순) -> (유형별 행 목록, 전체 건수 dict)."""
    last_status = {}
    for i, event in enumerate(events):
        last_status[message_key(event, i)] = event["status"]

    groups = collections.OrderedDict()
    for i, event in enumerate(events):
        if event["status"] == "delivered":
            continue
        name, candidate = classify(event["status"], event.get("errorDetail", ""))
        group = groups.setdefault(
            name,
            {"type": name, "candidate": candidate, "events": 0, "messages": set(), "reasons": collections.Counter(), "domains": collections.Counter()},
        )
        group["events"] += 1
        group["messages"].add(message_key(event, i))
        group["reasons"][mask_reason(event.get("errorDetail", ""))] += 1
        group["domains"][sender_domain(event.get("from"))] += 1

    rows = []
    for group in groups.values():
        recovered = sum(1 for m in group["messages"] if last_status[m] == "delivered")
        group["message_count"] = len(group["messages"])
        group["recovered"] = recovered
        group["undelivered"] = group["message_count"] - recovered
        rows.append(group)
    rows.sort(key=lambda g: -g["events"])

    totals = {
        "events": len(events),
        "failed_events": sum(g["events"] for g in rows),
        "messages": len({message_key(e, i) for i, e in enumerate(events)}),
    }
    return rows, totals


def render(zone, start, end, rows, totals):
    lines = [
        f"# 이메일 수신 실패 주간 보고 — {zone}",
        f"기간: {start:%Y-%m-%d %H:%M} ~ {end:%Y-%m-%d %H:%M} UTC",
        "",
        f"전체 이벤트 {totals['events']}건 중 실패 이벤트 {totals['failed_events']}건. "
        "같은 메시지의 재시도가 각각 이벤트로 잡히므로 메시지 수와 회복 수를 함께 본다.",
        "",
    ]
    if not rows:
        lines.append("실패 이벤트 없음.")
        return "\n".join(lines) + "\n"
    lines += [
        "| 유형 | 이벤트 | 메시지 | 회복 | 미배달 | 대표 사유 | 발신 도메인 상위 3 | 판정 |",
        "|---|---:|---:|---:|---:|---|---|---|",
    ]
    for g in rows:
        reason = g["reasons"].most_common(1)[0][0].replace("|", "\\|")
        domains = ", ".join(d for d, _ in g["domains"].most_common(3))
        verdict = "확인 필요" if g["candidate"] and g["undelivered"] > 0 else "규칙 분류"
        lines.append(
            f"| {g['type']} | {g['events']} | {g['message_count']} | {g['recovered']} | {g['undelivered']} | {reason} | {domains} | {verdict} |"
        )
    return "\n".join(lines) + "\n"


def has_candidates(rows):
    return any(g["candidate"] and g["undelivered"] > 0 for g in rows)


def fail(message) -> NoReturn:
    print(f"환경 오류: {message}", file=sys.stderr)
    sys.exit(2)


def read_token():
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    if token:
        return token
    # cf 를 한 번 호출하면 만료된 OAuth 토큰이 갱신된다
    try:
        subprocess.run(["cf", "auth", "whoami"], capture_output=True, timeout=30, check=True)
    except (OSError, subprocess.SubprocessError):
        fail("cf 인증 갱신 실패 — cf auth login 을 하거나 CLOUDFLARE_API_TOKEN(Analytics Read)을 환경변수로 준다")
    try:
        with open(os.path.expanduser(OAUTH_CONFIG)) as f:
            return json.load(f)["oauth_token"]
    except (OSError, KeyError, ValueError):
        fail("cf OAuth 토큰을 읽지 못했다 — CLOUDFLARE_API_TOKEN(Analytics Read)을 환경변수로 준다")


def resolve_zone_tag(zone):
    try:
        out = subprocess.run(["cf", "zones", "list", "--name", zone], capture_output=True, timeout=30, check=True, text=True).stdout
        return next(z["id"] for z in json.loads(out) if z["name"] == zone)
    except (OSError, subprocess.SubprocessError, ValueError, StopIteration, KeyError):
        fail(f"zone 조회 실패: {zone}")


def fetch_events(zone, start, end):
    token = read_token()
    query = """query($z:String!,$f:EmailRoutingAdaptiveFilter_InputObject){viewer{zones(filter:{zoneTag:$z}){
      emailRoutingAdaptive(filter:$f,limit:%d,orderBy:[datetime_ASC]){datetime messageId from status errorDetail}}}}""" % QUERY_LIMIT
    iso = lambda d: d.isoformat().replace("+00:00", "Z")
    body = json.dumps({"query": query, "variables": {"z": resolve_zone_tag(zone), "f": {"datetime_geq": iso(start), "datetime_leq": iso(end)}}}).encode()
    request = urllib.request.Request(GRAPHQL_URL, body, {"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as e:
        fail(f"GraphQL 조회 실패 (HTTP {e.code})")
    except (urllib.error.URLError, OSError, ValueError) as e:
        fail(f"GraphQL 조회 실패 ({type(e).__name__})")
    if payload.get("errors"):
        fail("GraphQL 오류 응답 — 토큰 권한(Analytics Read)을 확인한다")
    events = payload["data"]["viewer"]["zones"][0]["emailRoutingAdaptive"]
    if len(events) >= QUERY_LIMIT:
        fail(f"응답이 한도({QUERY_LIMIT}건)에 닿아 잘렸을 수 있다 — 기간을 줄인다")
    return events


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--zone", required=True)
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--md-out")
    parser.add_argument("--events-file")
    args = parser.parse_args()
    if args.days < 1 or args.days > 31:
        fail("--days 는 1~31 (Activity log 보존 기간)")

    end = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)
    start = end - datetime.timedelta(days=args.days)
    if args.events_file:
        try:
            with open(args.events_file) as f:
                events = json.load(f)
        except (OSError, ValueError):
            fail(f"--events-file 을 읽지 못했다: {args.events_file}")
    else:
        events = fetch_events(args.zone, start, end)

    rows, totals = summarize(events)
    report = render(args.zone, start, end, rows, totals)
    sys.stdout.write(report)
    if args.md_out:
        try:
            with open(args.md_out, "w") as f:
                f.write(report)
        except OSError:
            fail(f"--md-out 쓰기 실패: {args.md_out}")
    sys.exit(1 if has_candidates(rows) else 0)


if __name__ == "__main__":
    main()
