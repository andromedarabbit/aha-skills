#!/bin/bash
# Test runner for this skill.
# Discovered and executed automatically by tools/run-all-tests.sh and CI.
#
# 실제 검증 로직은 플러그인 공용 러너가 담당한다 (리뷰 #2 — 130줄 사본 4벌 종료).
# 이 래퍼는 파라미터만 정의한다. 탐색 계약(이 파일의 경로)은 그대로 유지된다.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export SKILL_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# 이 파이프라인이 의존하는 플러그인 에이전트와 허용 tools (frontmatter 무결성 검사 대상)
export AGENTS='blog-distiller|Read, Write, Edit
blog-compiler-worker|Read, Write
blog-auditor|Read, Grep'

# 경로 독립 회귀: 스킬 문서 + agents/ 정의에 홈 절대경로 하드코딩 금지
export PATH_CHECK=1

# 게이트 판정식 동일 문구 검사: 소비자(compiler)가 판정식 5곳 전부를 검사한다
# (자기 2곳 + 인터뷰어 3곳 — 인터뷰어 러너는 자기 3곳만 담당)
export GATE_PHRASE='`stage: 2` + `## 아웃라인 표` 섹션이 존재하고 비어 있지 않음(아웃라인 표에 데이터 행 1개 이상).'
export GATE_FILES='SKILL.md docs/REFERENCE.md ../blog-interviewer/SKILL.md ../blog-interviewer/assets/state-schema.md ../blog-interviewer/docs/REFERENCE.md'

bash "$SKILL_DIR/../shared/test-runner.sh"
