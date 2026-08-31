#!/bin/bash
# Test runner for this skill.
# Discovered and executed automatically by tools/run-all-tests.sh and CI.
#
# 실제 검증 로직은 플러그인 공용 러너가 담당한다 (리뷰 #2 — 130줄 사본 4벌 종료).
# 이 래퍼는 파라미터만 정의한다. 탐색 계약(이 파일의 경로)은 그대로 유지된다.
#
# PATH_CHECK 를 끄는 이유: 이 스킬은 vault 절대경로를 문서에 명시하는
# 레거시 설계다(이식 설계 경고 참조). 경로 독립 검사는 blog 스킬에만 적용한다.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export SKILL_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# 이 파이프라인이 의존하는 플러그인 에이전트와 허용 tools (frontmatter 무결성 검사 대상)
export AGENTS='career-memoir-distiller|Read, Write, Edit
career-memoir-compiler-worker|Read, Write
career-memoir-auditor|Read, Grep'

bash "$SKILL_DIR/../shared/test-runner.sh"
