#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""보고서 마크다운을 메일용 HTML로 바꾼다. 우리가 만드는 보고서의 부분집합만 처리한다:
# · ## 제목, 표, 글머리표(- ), 문단, 인라인 `코드`·**굵게**. 그 밖의 문법은 문단으로 그대로 둔다.

Usage: md_to_html.py <markdown-file>   (HTML 을 stdout 으로)
모든 텍스트는 이스케이프한다. 메일 클라이언트가 <style> 을 지우는 경우가 있어 스타일은 인라인으로 둔다.
"""

import html
import re
import sys

TABLE_STYLE = "border-collapse:collapse;margin:8px 0;font-size:13px"
CELL_STYLE = "border:1px solid #d0d7de;padding:4px 8px;vertical-align:top"
HEAD_STYLE = CELL_STYLE + ";background:#f6f8fa;text-align:left"


def inline(text: str) -> str:
    out = html.escape(text, quote=False)
    out = re.sub(r"`([^`]+)`", r'<code style="background:#f6f8fa;padding:0 3px">\1</code>', out)
    return re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", out)


def split_row(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def aligns(sep: str) -> list[str]:
    return ["right" if c.strip().endswith(":") else "left" for c in split_row(sep)]


def is_sep(line: str) -> bool:
    return bool(re.fullmatch(r"\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?", line.strip()))


def table(rows: list[str]) -> str:
    head, al = split_row(rows[0]), aligns(rows[1])
    parts = [f'<table style="{TABLE_STYLE}"><thead><tr>']
    parts += [f'<th style="{HEAD_STYLE}">{inline(c)}</th>' for c in head]
    parts.append("</tr></thead><tbody>")
    for r in rows[2:]:
        cells = split_row(r)
        parts.append("<tr>")
        for i, c in enumerate(cells):
            a = al[i] if i < len(al) else "left"
            parts.append(f'<td style="{CELL_STYLE};text-align:{a}">{inline(c)}</td>')
        parts.append("</tr>")
    parts.append("</tbody></table>")
    return "".join(parts)


def convert(md: str) -> str:
    lines = md.splitlines()
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        if line.startswith("## "):
            out.append(f'<h2 style="font-size:16px;margin:20px 0 6px">{inline(line[3:])}</h2>')
            i += 1
            continue
        if line.startswith("# "):
            out.append(f'<h1 style="font-size:20px;margin:0 0 12px">{inline(line[2:])}</h1>')
            i += 1
            continue
        if line.lstrip().startswith("|") and i + 1 < len(lines) and is_sep(lines[i + 1]):
            j = i + 2
            while j < len(lines) and lines[j].lstrip().startswith("|"):
                j += 1
            out.append(table(lines[i:j]))
            i = j
            continue
        if line.startswith("- "):
            j = i
            items = []
            while j < len(lines) and lines[j].startswith("- "):
                items.append(f"<li>{inline(lines[j][2:])}</li>")
                j += 1
            out.append("<ul>" + "".join(items) + "</ul>")
            i = j
            continue
        j = i
        para = []
        while j < len(lines) and lines[j].strip() and not lines[j].startswith(("#", "- ", "|")):
            para.append(inline(lines[j]))
            j += 1
        if j == i:  # '#' 이나 '|' 로 시작하지만 위 규칙에 안 맞는 줄은 문단으로 흘린다
            para.append(inline(line))
            j = i + 1
        out.append("<p style=\"margin:6px 0\">" + "<br>".join(para) + "</p>")
        i = j
    body = "\n".join(out)
    return (
        '<html><body style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;'
        f'color:#1f2328;line-height:1.5">\n{body}\n</body></html>\n'
    )


def main() -> int:
    if len(sys.argv) != 2:
        print("사용 오류: md_to_html.py <markdown-file>", file=sys.stderr)
        return 2
    try:
        with open(sys.argv[1], encoding="utf-8") as f:
            md = f.read()
    except OSError as e:
        print(f"사용 오류: {e}", file=sys.stderr)
        return 2
    sys.stdout.write(convert(md))
    return 0


if __name__ == "__main__":
    sys.exit(main())
