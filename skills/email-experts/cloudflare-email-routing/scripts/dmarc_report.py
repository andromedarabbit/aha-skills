#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""DMARC 집계 리포트 아카이브를 집계해 markdown 또는 CSV로 출력한다.

입력 계약: 리포트 아카이브(.xml.gz / .zip / .xml)가 담긴 디렉터리, 또는 파일 목록.
  파일명 규약 <submitter>!<domain>!<begin>!<end>.(xml.gz|zip)을 지원하며, 없으면 리포트 본문의 org_name을 쓴다.
  기간(begin)은 리포트 본문의 report_metadata/date_range/begin에서만 읽는다.
출력 계약: stdout에 markdown 집계(기본) 또는 레코드 단위 CSV(--csv).
종료 코드: 0 집계 성공 · 1 리포트 없음 · 2 사용 오류 · 3 일부 파일 실패(성공한 파일만 집계하고 실패 목록을 보고)

파일 단위로 전부 성공하거나 전부 제외한다. 필수 요소가 없는 파일은 부분 집계에 섞이지 않는다.
stdlib만 쓴다. 외부 전송·쓰기 없음(읽기 전용).
"""

import argparse
import csv
import gzip
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

KST = timezone(timedelta(hours=9))
SUFFIXES = (".gz", ".zip", ".xml")
SAFE_CHARS = re.compile(r"[^A-Za-z0-9._@:\- ]")


def safe(text: str) -> str:
    # 리포트 본문은 신뢰하지 않는 입력이다. 출력에 들어가는 문자열은 허용 문자만 남기고 길이를 자른다
    return SAFE_CHARS.sub("?", text)[:64]


def extract_xml(path: Path) -> str:
    if path.name.endswith(".gz"):
        with gzip.open(path, "rt", errors="replace") as f:
            return f.read()
    if path.name.endswith(".zip"):
        with zipfile.ZipFile(path) as z:
            name = next(n for n in z.namelist() if n.endswith(".xml"))
            return z.read(name).decode("utf-8", errors="replace")
    return path.read_text(errors="replace")


def required(el, tag: str) -> ET.Element:
    # 필수 요소가 없으면 즉시 실패한다 — 빈 값이나 기본값으로 집계를 왜곡하지 않는다
    found = el.find(tag)
    if found is None:
        raise ValueError(f"필수 요소 누락: {tag}")
    return found


def required_int(el, tag: str) -> int:
    text = (required(el, tag).text or "").strip()
    if not text.isdigit():
        raise ValueError(f"정수가 아닌 값: {tag}={text!r}")
    return int(text)


def parse_report(path: Path) -> list:
    submitter = path.name.split("!")[0] if "!" in path.name else path.stem
    root = ET.fromstring(extract_xml(path))
    meta = required(root, "report_metadata")
    begin = required_int(required(meta, "date_range"), "begin")
    org = (meta.findtext("org_name") or "").strip() or submitter
    rows = []
    for rec in root.iter("record"):
        row = required(rec, "row")
        pe = required(row, "policy_evaluated")
        rows.append({
            "submitter": safe(org),
            "begin": begin,
            "ip": safe(required(row, "source_ip").text or "-"),
            "count": required_int(row, "count"),
            "spf": safe(required(pe, "spf").text or "-"),
            "dkim": safe(required(pe, "dkim").text or "-"),
        })
    return rows


def collect_files(args_paths):
    files = []
    for p in args_paths:
        if p.is_dir():
            files.extend(sorted(f for f in p.glob("**/*") if f.suffix in SUFFIXES))
        else:
            files.append(p)
    return files


def load_rows(files):
    """반환: (집계된 레코드, 실패한 파일 이름 목록). 실패 파일의 레코드는 하나도 섞이지 않는다."""
    rows, failed = [], []
    for p in files:
        if p.suffix not in SUFFIXES:
            continue
        try:
            file_rows = parse_report(p)
        except Exception as e:  # 파일 단위 all-or-nothing
            print(f"# 파싱 실패 {p.name}: {e}", file=sys.stderr)
            failed.append(p.name)
            continue
        rows.extend(file_rows)
    return rows, failed


def print_markdown(rows, failed):
    nreports = len({(r["submitter"], r["begin"]) for r in rows})
    total = sum(r["count"] for r in rows)
    print(f"## 개요\n\n리포트 {nreports}개 / 레코드 {len(rows)}개 / 메시지 총 {total}통")
    if failed:
        print(f"실패한 파일 {len(failed)}개는 집계에서 제외했다: {', '.join(safe(n) for n in failed)}")
    print()

    print("## 날짜별 (KST)\n")
    daily = Counter()
    for r in rows:
        daily[datetime.fromtimestamp(r["begin"], tz=KST).strftime("%Y-%m-%d")] += r["count"]
    for d in sorted(daily):
        print(f"- {d}: {daily[d]}통")

    print("\n## submitter별\n")
    subs = Counter()
    for r in rows:
        subs[r["submitter"]] += r["count"]
    for s, c in subs.most_common():
        print(f"- {s}: {c}통")

    print("\n## 소스 IP별 (상위 30)\n")
    ips = Counter()
    for r in rows:
        ips[r["ip"]] += r["count"]
    for ip, c in ips.most_common(30):
        print(f"- {ip}: {c}통")

    print("\n## 인증결과 분포\n")
    for (s, d), c in Counter((r["spf"], r["dkim"]) for r in rows).most_common():
        print(f"- spf={s} dkim={d}: {c}레코드")

    print("\n## 판별\n")
    fails = sum(r["count"] for r in rows if r["spf"] == "fail" and r["dkim"] == "fail")
    ratio = fails / total if total else 0
    if ratio == 1.0:
        print("**전부 실패 — 사칭 캠페인 후보**. envelope_from과 소스 IP(임대 클라우드 여부)를 함께 확인해 판정한다. 정상 발신 경로의 전면 실패도 여기에 걸릴 수 있다.")
    elif fails == 0:
        print("**전부 통과 — 정상 발신 경로 문제 없음**.")
    else:
        print(f"**혼재({ratio:.0%} 실패) — 정상 발신 경로의 정합 문제 가능성**. pass 레코드 IP가 알려진 발신 경로인지 확인한다.")


def print_csv(rows):
    writer = csv.DictWriter(sys.stdout, fieldnames=list(rows[0].keys()))
    writer.writeheader()
    writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description="DMARC 집계 리포트 아카이브 집계 (읽기 전용)")
    parser.add_argument("paths", nargs="+", type=Path, help="리포트 디렉터리 또는 파일")
    parser.add_argument("--csv", action="store_true", help="markdown 대신 레코드 단위 CSV 출력")
    args = parser.parse_args()

    rows, failed = load_rows(collect_files(args.paths))
    if not rows and not failed:
        print("# 리포트 없음", file=sys.stderr)
        return 1

    if rows:
        if args.csv:
            print_csv(rows)
        else:
            print_markdown(rows, failed)

    if failed:
        print(f"# 파싱 실패 파일 {len(failed)}개 — 종료 코드 3", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
