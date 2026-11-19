#!/bin/bash
# social-sync 테스트 러너 — CI(run-all-tests.sh)가 이 경로를 자동 발견한다.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

bash "$HERE/sync-gate.test.sh"
bash "$HERE/register.test.sh"

echo "social-sync: 모든 테스트 통과"
