#!/bin/bash
# validate-python-scripts.py 회귀 테스트.
#
# 검증기가 **잡아야 할 것을 잡고, 잡아선 안 될 것을 놓아주는지** 둘 다 본다.
# 후자가 더 중요하다 — 표준 라이브러리 전용 스크립트나 라이브러리 모듈을 오류로 잡으면
# 팀이 검증기를 끄게 된다.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VALIDATOR="$SCRIPT_DIR/validate-python-scripts.py"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

failures=0

expect() {
  local label="$1" want="$2"
  shift 2
  local got=0
  "$VALIDATOR" "$@" >/dev/null 2>&1 || got=$?
  if [ "$got" -eq "$want" ]; then
    printf "${GREEN}✅ %s${NC}\n" "$label"
  else
    printf "${RED}❌ %s — exit %d 를 기대했는데 %d${NC}\n" "$label" "$want" "$got"
    failures=$((failures + 1))
  fi
}

# expect_rule <라벨> <규칙id> <파일> — 종료 코드 1 이면서 stderr 에 그 규칙 id 가 있어야 통과한다.
# 종료 코드만 보면 다른 규칙(R1 등)이 대신 잡아도 통과해, 해당 규칙이 고장 나도 못 알아챈다.
expect_rule() {
  local label="$1" rule="$2" file="$3" got=0 out
  out=$("$VALIDATOR" "$file" 2>&1 >/dev/null) || got=$?
  if [ "$got" -eq 1 ] && printf '%s' "$out" | grep -q " $rule "; then
    printf "${GREEN}✅ %s${NC}\n" "$label"
  else
    printf "${RED}❌ %s — exit 1 과 %s 를 기대했는데 exit %d: %s${NC}\n" "$label" "$rule" "$got" "$out"
    failures=$((failures + 1))
  fi
}

# write_py <상대경로> — stdin 을 $TMP/skills/c/s/<상대경로> 에 쓰고 경로를 출력한다
write_py() {
  local path="$TMP/skills/c/s/$1"
  mkdir -p "$(dirname "$path")"
  cat >"$path"
  echo "$path"
}

UV='#!/usr/bin/env -S uv run --script'
BLOCK=$'# /// script\n# requires-python = ">=3.10"\n# dependencies = ["pyyaml"]\n# ///'

# ── 잡아야 한다 ────────────────────────────────────────────────────────
f=$(write_py scripts/a.py <<EOF
#!/usr/bin/env python3
import yaml
EOF
)
expect_rule "R1 python3 셔뱅 + 서드파티 import" R1 "$f"

f=$(write_py scripts/b.py <<EOF
#!/usr/bin/env python3
$BLOCK
import json
EOF
)
expect_rule "R2 python3 셔뱅 + script 블록 (선언만 하고 설치 안 됨)" R2 "$f"

f=$(write_py scripts/c.py <<EOF
$UV
import json
EOF
)
expect_rule "R3 uv 셔뱅 + 블록 없음" R3 "$f"

f=$(write_py scripts/d.py <<'EOF'
#!/usr/bin/env python3
# uv-script: exempt
import yaml
EOF
)
expect_rule "R4 사유 없는 탈출 주석" R4 "$f"

f=$(write_py scripts/c2.py <<EOF
$UV
# /// script
# requires-python = ">=3.10"
# ///
import json
EOF
)
expect_rule "R3 uv 셔뱅 + 블록은 있으나 dependencies 없음" R3 "$f"

f=$(write_py scripts/c3.py <<EOF
$UV
# /// script
# requires-python = ">=3.11"
# dependencies = "pyyaml"
# ///
import json
EOF
)
expect_rule "R3 dependencies 가 문자열이면 uv 가 거부하므로 잡는다" R3 "$f"

f=$(write_py scripts/c4.py <<EOF
$UV
# /// script
# requires-python = ">=3.11"
# dependencies = [
# ///
import json
EOF
)
expect_rule "R3 dependencies 가 TOML 문법 오류" R3 "$f"

f=$(write_py scripts/c5.py <<EOF
$UV
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
import requests
EOF
)
expect_rule "R3 dependencies = [] 인데 서드파티 import" R3 "$f"

mkdir -p "$TMP/skills/c/other/scripts"
: >"$TMP/skills/c/other/scripts/sibling_skill_mod.py"
f=$(write_py scripts/c6.py <<EOF
$UV
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
import sibling_skill_mod
EOF
)
expect "다른 스킬의 scripts/ 모듈은 서드파티가 아니다 (dependencies = [])" 0 "$f"

f=$(write_py scripts/tests/yaml.py <<'EOF'
X = 1
EOF
)
f=$(write_py scripts/nested_local.py <<'EOF'
#!/usr/bin/env python3
import yaml
EOF
)
expect_rule "R1 중첩 tests/yaml.py 는 로컬 모듈로 인정하지 않는다" R1 "$f"

f=$(write_py scripts/d2.py <<'EOF'
#!/usr/bin/env python3
# uv-script: exempt —
import json
EOF
)
expect_rule "R4 대시만 있고 사유가 없는 탈출 주석" R4 "$f"

f=$(write_py scripts/bad_syntax.py <<'EOF'
#!/usr/bin/env python3
x = = 1
EOF
)
expect "구문 오류 파일은 검사할 수 없다고 실패한다" 1 "$f"

out=$("$VALIDATOR" "$TMP/skills/c/s/scripts/a.py" 2>&1 || true)
case "$out" in
  *"scripts/a.py:1: R1"*"uv run --script"*) printf "${GREEN}✅ 위반 메시지에 경로와 고치는 방법이 있다${NC}\n" ;;
  *) printf "${RED}❌ 위반 메시지 형식이 다르다: %s${NC}\n" "$out"; failures=$((failures + 1)) ;;
esac

# ── 놓아줘야 한다 ──────────────────────────────────────────────────────
f=$(write_py scripts/e.py <<EOF
$UV
$BLOCK
import yaml
EOF
)
expect "uv 셔뱅 + 블록 + 서드파티" 0 "$f"

f=$(write_py scripts/f.py <<'EOF'
#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
EOF
)
expect "python3 셔뱅 + 표준 라이브러리만" 0 "$f"

f=$(write_py scripts/lib_mod.py <<'EOF'
import yaml
EOF
)
expect "셔뱅·실행 비트 없는 라이브러리 모듈" 0 "$f"

write_py scripts/helper.py <<'EOF' >/dev/null
X = 1
EOF
mkdir -p "$TMP/skills/c/s/scripts/pkg"
: >"$TMP/skills/c/s/scripts/pkg/__init__.py"
f=$(write_py scripts/g.py <<'EOF'
#!/usr/bin/env python3
import helper
from pkg import thing
EOF
)
expect "같은 scripts/ 안 형제 모듈 import 는 서드파티가 아니다" 0 "$f"

f=$(write_py scripts/tests/t.py <<'EOF'
#!/usr/bin/env python3
import yaml
EOF
)
expect "tests/ 아래 파일은 대상이 아니다" 0 "$f"

f=$(write_py scripts/h.py <<'EOF'
#!/usr/bin/env python3
# uv-script: exempt — Airflow worker 안에서 실행돼 uv 가 없다
import yaml
EOF
)
expect "사유 있는 탈출 주석" 0 "$f"

f=$(write_py scripts/x.sh <<'EOF'
#!/bin/bash
echo hi
EOF
)
expect ".sh 파일이 인자로 와도 무시" 0 "$f"

f=$(write_py outside/i.py <<'EOF'
#!/usr/bin/env python3
import yaml
EOF
)
expect "scripts/ 밖 파일은 대상이 아니다" 0 "$f"

f=$(write_py scripts/j.py <<'EOF'
import yaml
EOF
)
chmod +x "$f"
expect "셔뱅 없이 실행 비트만 있으면 진입점으로 본다 (R1)" 1 "$f"

# ── 인자 없는 전체 훑기는 위반이 있어도 0 ──────────────────────────────
if (cd "$SCRIPT_DIR/.." && "$VALIDATOR" >/dev/null 2>&1); then
  printf "${GREEN}✅ 인자 없는 전체 훑기는 항상 0${NC}\n"
else
  printf "${RED}❌ 인자 없는 전체 훑기가 실패했다${NC}\n"
  failures=$((failures + 1))
fi

printf '────────────────────────────────────\n'
if [ "$failures" -eq 0 ]; then
  printf "${GREEN}✅ 회귀 테스트 전부 통과${NC}\n"
  exit 0
fi
printf "${RED}❌ %d 개 실패${NC}\n" "$failures"
exit 1
