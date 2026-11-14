#!/bin/bash
# Node 테스트를 건너뛰고 성공 처리하지 않는지 실제 러너로 확인한다.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
sandbox="$(mktemp -d)"
trap 'rm -rf "$sandbox"' EXIT
mkdir -p "$sandbox/bin" "$sandbox/home"
for tool in dirname grep basename bash; do
  ln -s "$(command -v "$tool")" "$sandbox/bin/$tool"
done
if out="$(HOME="$sandbox/home" PATH="$sandbox/bin" /bin/bash "$SCRIPT_DIR/run.sh" 2>&1)"; then
  printf '❌ Node 없는 러너가 성공했습니다\n' >&2
  exit 1
fi
if ! grep -q 'node가 없어' <<<"$out"; then
  printf '❌ Node 부재를 명시하지 않았습니다: %s\n' "$out" >&2
  exit 1
fi
printf '✅ runner.test.sh 통과\n'
