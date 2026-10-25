#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""DMARC 집계 리포트 아카이브를 집계해 markdown 또는 CSV로 출력한다.

입력 계약: 리포트 아카이브(.xml.gz / .zip / .xml)가 담긴 디렉터리, 또는 파일 목록.
  파일명 규약 <submitter>!<domain>!<begin>!<end>.(xml.gz|zip)을 지원하며, 없으면 리포트 본문의 org_name을 쓴다.
출력 계약: stdout에 markdown 집계(기본) 또는 레코드 단위 CSV(--csv).
종료 코드: 0 집계 성공 · 1 리포트 없음 · 2 사용 오류

stdlib만 쓴다. 외부 전송·쓰기 없음(읽기 전용).
"""

import argparse
import csv
import gzip
import sys
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

KST = timezone(timedelta(hours=9))
SUFFIXES = (".gz", ".zip", ".xml")


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
    # 필수 요소가 없으면 즉시 실패한다 — 빈 값으로 넘겨 집계를 왜곡하지 않는다
    found = el.find(tag)
    if found is None:
        raise ValueError(f"필수 요소 누락: {tag}")
    return found


def parse_report(path: Path):
    submitter = path.name.split("!")[0] if "!" in path.name else path.stem
    root = ET.fromstring(extract_xml(path))
    meta = root.find("report_metadata")
    org = (meta.findtext("org_name") if meta is not None else None) or submitter
    for rec in root.iter("record"):
        row = required(rec, "row")
        pe = required(row, "policy_evaluated")
        yield {
            "submitter": org,
            "begin": int(row.findtext("begin") or 0),
            "ip": row.findtext("source_ip") or "-",
            "count": int(row.findtext("count") or 1),
            "spf": pe.findtext("spf") or "-",
            "dkim": pe.findtext("dkim") or "-",
            "header_from": rec.findtext(".//identifiers/header_from") or "-",
        }


def collect_files(args_paths):
    files = []
    for p in args_paths:
        if p.is_dir():
            files.extend(sorted(f for f in p.glob("**/*") if f.suffix in SUFFIXES))
        else:
            files.append(p)
    return files


def load_rows(files):
    rows = []
    for p in files:
        if p.suffix not in SUFFIXES:
            continue
        try:
            rows.extend(parse_report(p))
        except Exception as e:  # 파싱 실패 파일만 건너뛰고 나머지는 계속 집계
            print(f"# 파싱 실패 {p.name}: {e}", file=sys.stderr)
    return rows


def print_markdown(rows):
    nreports = len({(r["submitter"], r["begin"]) for r in rows})
    total = sum(r["count"] for r in rows)
    print(f"## 개요\n\n리포트 {nreports}개 / 레코드 {len(rows)}개 / 메시지 총 {total}통\n")

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
        print("**전부 실패 — 사칭 캠페인 가능성**. 소스 IP가 임대 클라우드 VM인지 whois로 보강한다.")
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

    rows = load_rows(collect_files(args.paths))
    if not rows:
        print("# 리포트 없음", file=sys.stderr)
        return 1

    if args.csv:
        print_csv(rows)
    else:
        print_markdown(rows)
    return 0


if __name__ == "__main__":
    sys.exit(main())
