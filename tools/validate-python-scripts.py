#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"   # tomllib
# dependencies = []
# ///
"""스킬 파이썬 진입점의 의존성 선언을 검사한다 — "반쪽 상태"만 잡는다.

── 이 검사가 존재하는 이유 ─────────────────────────────────────────────
`#!/usr/bin/env python3` 로 시작하는 스크립트는 서드파티 패키지를 설치해 주지 않는다.
`# /// script` (PEP 723) 블록에 의존성을 적어 놓아도 셔뱅이 `python3` 면 그 선언은 아무 일도
하지 않는다. 실행하는 사람이 직접 pip 로 깔아야 하고, 안 깔았으면 ImportError 다.
`#!/usr/bin/env -S uv run --script` 셔뱅이면 실행 시 uv 가 선언된 의존성을 알아서 설치한다.

저장소의 `scripts/` 진입점 73개 중 uv 방식 26개, `python3` 셔뱅 47개였고 문서(skill-specification.md,
CLAUDE.md)도 `python3` + requirements.txt 를 안내하고 있어 에이전트가 후자를 따라 했다.
가령 어떤 스킬의 `check_figures.py` 는 `markdown-it-py` 를 선언만 해 놓고
셔뱅은 `python3` 인 반쪽 상태였다.

── 잡는 것 (진입점 = 셔뱅이 있거나 실행 비트가 있는 scripts/ 아래 .py) ────
  R1. 셔뱅이 uv 가 아닌데 서드파티 import 가 있다.
  R2. 셔뱅이 uv 가 아닌데 `# /// script` 블록이 있다 (선언만 하고 설치는 안 되는 상태).
  R3. 셔뱅이 `uv run --script` 인데 `# /// script` 블록이 없거나 블록에 `dependencies` 가 없다.
  R4. 탈출 주석에 사유가 없다.

표준 라이브러리만 쓰는 `python3` 스크립트는 통과시킨다. 기존 스크립트를 건드리지 않고,
오탐으로 검증기가 꺼지는 것을 막기 위해서다.

── 한계 ───────────────────────────────────────────────────────────────
import 이름과 배포판 이름이 달라(`yaml` ↔ `pyyaml`) 선언한 dependencies 가 import 를 전부
덮는지는 검사하지 않는다. "선언이 아예 없는 상태"만 잡는다.

── 탈출구 ─────────────────────────────────────────────────────────────
첫 20줄 안에 `# uv-script: exempt — <사유>` 를 적는다. sys.path 조작으로 import 하거나
uv 를 쓸 수 없는 실행 환경(예: Airflow worker 안)용이다. 사유가 없으면 R4 로 실패한다.

── 사용법 ─────────────────────────────────────────────────────────────
  validate-python-scripts.py <파일>...   # 인자로 받은 파일만 검사, 위반이 있으면 종료 코드 1
  validate-python-scripts.py             # 저장소 전체 훑기 — 위반을 출력만 하고 항상 0 (현황 파악용)
"""
from __future__ import annotations

import ast
import re
import subprocess
import sys
import tomllib
from pathlib import Path

SKIP_PARTS = {"tests", "__tests__", "evals"}
SKIP_NAME = re.compile(r"^(__init__|conftest|test_.*|.*_test|.*\.test)\.py$")
EXEMPT = re.compile(r"#\s*uv-script:\s*exempt\b\s*(?:[—–-]+\s*(?P<reason>\S.*)?)?$")
UV_SHEBANG = "uv run --script"
# PEP 723 참조 구현의 정규식
SCRIPT_BLOCK = re.compile(r"(?m)^# /// script$\s(?P<body>(?:^#(?: .*)?$\s)+?)^# ///$")
STDLIB = sys.stdlib_module_names


def is_candidate(path: Path) -> bool:
    if path.suffix != ".py" or SKIP_NAME.match(path.name):
        return False
    parts = path.parts
    return "scripts" in parts and not SKIP_PARTS.intersection(parts)


def scripts_root(path: Path) -> Path:
    parts = path.parts
    return Path(*parts[: parts.index("scripts") + 1])


def local_names(path: Path) -> set[str]:
    # 실행 시 import 되는 건 스크립트 자기 디렉토리(sys.path[0])와 scripts/ 최상위뿐이다.
    # scripts/tests/yaml.py 같은 중첩 파일은 최상위 `import yaml` 을 만들지 않는다.
    names: set[str] = set()
    for base in {path.parent, scripts_root(path)}:
        names.update(p.stem for p in base.glob("*.py"))
        names.update(p.name for p in base.iterdir() if p.is_dir())
    return names


def repo_module_names(path: Path) -> set[str]:
    """저장소의 모든 `skills/*/*/scripts` 모듈 이름. `sys.path.insert` 로 다른 스킬의 모듈을 불러오는
    스크립트(다른 스킬의 모듈을 sys.path.insert 로 가져오는 사례)를 서드파티로 오판하지 않기 위해 로컬로 본다."""
    skills = next((p for p in path.resolve().parents if p.name == "skills"), None)
    if skills is None:
        return set()
    names: set[str] = set()
    for scripts in skills.glob("*/*/scripts"):
        names.update(p.stem for p in scripts.glob("*.py"))
        names.update(p.name for p in scripts.iterdir() if p.is_dir())
    return names


def deps_are_empty(body: str) -> bool:
    return tomllib.loads(_block_toml(body)).get("dependencies") == []


def third_party_imports(tree: ast.AST, local: set[str]) -> list[str]:
    mods: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            mods.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            mods.add(node.module.split(".")[0])
    return sorted(m for m in mods if m not in STDLIB and m not in local)


def _block_toml(body: str) -> str:
    """PEP 723 블록 본문에서 `# ` 접두사를 벗긴 TOML 문자열."""
    return "\n".join(line[2:] if line.startswith("# ") else line[1:] for line in body.splitlines())


def deps_are_string_list(body: str) -> bool:
    """블록 본문의 `# ` 접두사를 벗겨 TOML 로 파싱하고 dependencies 가 문자열 리스트인지 본다.
    키 이름만 보면 `dependencies = "pyyaml"` 도 통과하는데 uv 는 TOML 오류로 실행을 거부한다."""
    try:
        deps = tomllib.loads(_block_toml(body)).get("dependencies")
    except tomllib.TOMLDecodeError:
        return False
    return isinstance(deps, list) and all(isinstance(d, str) for d in deps)


def check(path: Path) -> list[str]:
    if not is_candidate(path):
        return []
    src = path.read_text(encoding="utf-8")
    lines = src.splitlines()
    first = lines[0] if lines else ""
    has_shebang = first.startswith("#!")
    if not has_shebang and not path.stat().st_mode & 0o111:
        return []  # 라이브러리 모듈

    for lineno, line in enumerate(lines[:20], 1):
        m = EXEMPT.search(line)
        if not m:
            continue
        if m.group("reason"):
            return []
        return [f"{path}:{lineno}: R4 — 탈출 주석에 사유가 없습니다. `# uv-script: exempt — <사유>` 형태로 적으세요"]

    is_uv = UV_SHEBANG in first
    block = SCRIPT_BLOCK.search(src)
    has_block = block is not None
    has_deps = block is not None and deps_are_string_list(block.group("body"))
    out: list[str] = []
    if is_uv and not has_deps:
        out.append(
            f"{path}:1: R3 — uv 셔뱅인데 `# /// script` 블록이 없거나 블록의 `dependencies` 가 없거나 문자열 리스트가 아닙니다"
            "(표준 라이브러리만 쓰면 `[]`, 값은 문자열 리스트여야 합니다). "
            '`# requires-python = ">=3.10"` 와 `# dependencies = [...]` 를 담은 블록을 두세요'
        )
    if is_uv and has_deps and deps_are_empty(block.group("body")):
        try:
            tree = ast.parse(src)
        except SyntaxError as e:
            return out + [f"{path}:{e.lineno or 1}: 구문 오류로 검사할 수 없습니다 — {e.msg}"]
        third = third_party_imports(tree, local_names(path) | repo_module_names(path))
        if third:
            out.append(
                f"{path}:1: R3 — dependencies = [] 인데 서드파티 import({', '.join(third)})가 있습니다. "
                "`# dependencies = [...]` 에 해당 패키지를 선언하세요"
            )
    if not is_uv and has_block:
        out.append(
            f"{path}:1: R2 — `# /// script` 로 의존성을 선언했지만 셔뱅이 uv 가 아니라 설치되지 않습니다. "
            "첫 줄을 `#!/usr/bin/env -S uv run --script` 로 바꾸세요"
        )
    if not is_uv:
        try:
            tree = ast.parse(src)
        except SyntaxError as e:
            return [f"{path}:{e.lineno or 1}: 구문 오류로 검사할 수 없습니다 — {e.msg}"]
        third = third_party_imports(tree, local_names(path))
        # 블록이 있으면 R2 가 이미 이 파일을 잡았다
        if third and not has_block:
            out.append(
                f"{path}:1: R1 — 서드파티 import({', '.join(third)})가 있는데 셔뱅이 uv 가 아닙니다. "
                "첫 줄을 `#!/usr/bin/env -S uv run --script` 로 바꾸고 `# /// script` 블록에 dependencies 를 선언하세요"
            )
    return out


def repo_files() -> list[Path]:
    out = subprocess.check_output(["git", "ls-files", "skills/*.py"], text=True)
    return [Path(p) for p in out.split()]


def main(argv: list[str]) -> int:
    scan_all = not argv
    files = repo_files() if scan_all else [Path(a) for a in argv]
    violations = [v for f in files for v in check(f)]
    for v in violations:
        print(f"❌ {v}", file=sys.stderr)
    if scan_all:
        print(f"ℹ️  전체 훑기: 위반 {len(violations)}건 (현황 파악용이라 실패 처리하지 않습니다)")
        return 0
    if violations:
        return 1
    print("✅ 파이썬 스크립트 의존성 선언 검사 통과")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
