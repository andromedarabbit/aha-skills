# 스킬 테스트 가이드

이 문서는 aha-skills 저장소에서 에이전트 스킬의 스크립트를 테스트하는 베스트 프랙티스를 정리합니다.

## 테스트 계층 개요

```
Layer 4: Agent Behavior    LLM이 스킬을 올바르게 트리거하는지    (promptfoo — 미래 도입)
Layer 3: Integration       스크립트 + 실제 외부 툴 연동           (CI 제외가 일반적)
Layer 2: Smoke/Scenario    스크립트 + stub 외부 툴               ← 이 저장소의 주력
Layer 1: Unit              순수 함수, 파서, 변환 로직            (Python/Bash 단위 테스트)
```

Layer 1+2를 탄탄하게 유지하는 것이 현실적인 목표입니다. Layer 3/4는 비용과 비결정성 때문에 별도 판단이 필요합니다.

---

## 진입점 표준: `scripts/tests/run.sh`

모든 스킬의 테스트 진입점은 `scripts/tests/run.sh`입니다. 디스커버리 스크립트(`tools/run-all-tests.sh`)가 이 파일을 자동 탐색하여 실행합니다.

```bash
#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SKILL_NAME="$(basename "$SKILL_DIR")"

echo "=== $SKILL_NAME tests ==="

# BATS 테스트
if compgen -G "$SCRIPT_DIR/*.bats" >/dev/null 2>&1; then
  bats "$SCRIPT_DIR"/*.bats
fi

# Python 테스트 (__tests__/ 디렉토리 호환)
TESTS_DIR="$SKILL_DIR/scripts/__tests__"
if compgen -G "$TESTS_DIR/test_*.py" >/dev/null 2>&1 || \
   compgen -G "$TESTS_DIR/*.test.py" >/dev/null 2>&1; then
  if command -v uv >/dev/null 2>&1; then
    uv run pytest "$TESTS_DIR" -v
  else
    echo "⚠️  uv not found — skipping Python tests"
  fi
fi

# Shell 통합 테스트
for test_file in "$SCRIPT_DIR"/*.test.sh "$TESTS_DIR"/*.test.sh; do
  [ -f "$test_file" ] || continue
  echo "  Running $(basename "$test_file")..."
  bash "$test_file"
done
```

**핵심 규약:**
- `set -euo pipefail` — fail-fast. 첫 실패에서 종료
- BATS → Python → Shell 순서로 탐지/실행
- uv가 없으면 Python 테스트는 경고만 출력하고 skip (CI 이미지 대응)

---

## BATS 베스트 프랙티스

[BATS](https://github.com/bats-core/bats-core)는 Shell 스크립트의 표준 테스트 프레임워크입니다.

### 기본 구조

```bash
#!/usr/bin/env bats

setup() {
  TEST_DIR="$(mktemp -d)"
  cd "$TEST_DIR"
  # 테스트 환경 초기화
}

teardown() {
  rm -rf "$TEST_DIR"
}

@test "정상 입력 → 성공 종료" {
  run bash "$SCRIPT_UNDER_TEST" --flag value
  [ "$status" -eq 0 ]
  [[ "$output" == *"expected text"* ]]
}

@test "잘못된 입력 → 에러 메시지와 함께 실패" {
  run bash "$SCRIPT_UNDER_TEST" --invalid
  [ "$status" -eq 1 ]
  [[ "$output" == *"ERROR"* ]]
}
```

### 핵심 원칙

| 원칙 | 설명 |
|------|------|
| `run` 사용 | `set -e`의 영향을 받지 않고 exit code + output 캡처 |
| 테스트 격리 | `setup()`에서 mktemp, `teardown()`에서 rm -rf |
| HOME 재지정 | `HOME="$TEST_DIR"` — 실제 환경 오염 방지 |
| PATH stub | 외부 명령을 가짜로 대체해 격리된 테스트 |

### PATH stub 패턴

외부 CLI를 실제로 호출하지 않고 테스트하는 방법:

```bash
setup() {
  TEST_DIR="$(mktemp -d)"
  SBIN="$TEST_DIR/bin"
  mkdir -p "$SBIN"

  # gh stub: 호출 기록만 남기고 성공 반환
  cat >"$SBIN/gh" <<'STUB'
#!/usr/bin/env bash
echo "gh $*" >> "$TEST_DIR/calls.log"
exit 0
STUB
  chmod +x "$SBIN/gh"

  export PATH="$SBIN:$PATH"
  export HOME="$TEST_DIR"
}
```

### 실제 예시 (이 저장소)

- `skills/git-experts/commit-rule/scripts/tests/detect-rule-status.bats` — 해시 계산, 캐시 상태 검증
- `skills/git-experts/shared/tests/hash-drift-guard.bats` — 두 스크립트 간 일관성 검증
- `skills/publish-experts/publish-doc/scripts/__tests__/install-cli.test.sh` — PATH stub + 다양한 CLI 설치 시나리오

---

## Python 테스트 (uv + pytest)

### 실행 방법

```bash
# 의존성 포함 직접 실행
uv run pytest scripts/__tests__/ -v

# 또는 script 헤더로 의존성 명시
uv run --script scripts/__tests__/test_my_module.py
```

### 하이픈이 있는 파일 import

```python
import importlib.util
import pathlib

TARGET = pathlib.Path(__file__).parent.parent / "my-script.py"
spec = importlib.util.spec_from_file_location("my_script", TARGET)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def test_process_returns_expected():
    assert module.process("input") == "expected"
```

### 실제 예시 (이 저장소)

- `skills/publish-experts/publish-doc/scripts/__tests__/test_normalize_strikethrough.py` — 텍스트 정규화 단위 테스트
- `skills/publish-experts/publish-doc/scripts/__tests__/test_normalize_nested_lists.py` — 중첩 리스트 정규화 단위 테스트

---

## Hook 테스트 패턴

Claude Code의 PreToolUse/PostToolUse 훅은 JSON 이벤트를 stdin으로 받습니다.

### JSON 이벤트 주입

```bash
# 안전한 JSON 생성 (이스케이핑 문제 방지)
make_event() {
  python3 -c "
import json, sys
print(json.dumps({
  'tool_name': 'Bash',
  'tool_input': {'command': sys.argv[1]}
}))" "$1"
}

@test "정상 명령어 → PASS (exit 0)" {
  run bash "$HOOK_SCRIPT" <<< "$(make_event 'gh run list')"
  [ "$status" -eq 0 ]
}

@test "위험한 명령어 → BLOCK (exit 2)" {
  run bash "$HOOK_SCRIPT" <<< "$(make_event 'rm -rf /')"
  [ "$status" -eq 2 ]
}
```

### Hook 테스트 체크리스트

| 케이스 | 설명 |
|--------|------|
| PASS | 정상 입력 → exit 0 |
| BLOCK | 악의적/위험 입력 → exit 2 |
| 무관한 툴 | 다른 tool_name → PASS (false positive 방지) |
| 우회 시도 | subshell, `bash -c`, eval, command substitution |
| 복합 명령어 | `&&` 체인에서 모든 인자 검사 |
| 빈 stdin | 파싱 불가 케이스에서 크래시 없음 |

---

## 디렉토리 규약

| 위치 | 용도 | 비고 |
|------|------|------|
| `scripts/tests/` | BATS + shell 통합 테스트 | 권장 |
| `scripts/tests/run.sh` | 테스트 진입점 | 필수 |
| `scripts/__tests__/` | Python 테스트 (기존 호환) | `tests/`로 장기 통일 예정 |

---

## CI 연동

### 자동 실행

`scripts/tests/run.sh`가 있는 스킬은 CI에서 자동으로 테스트가 실행됩니다. 별도 등록 불필요.

### 실행 제외

CI 환경에서 실행할 수 없는 테스트(외부 인증 필요 등)는 스킬 루트에 `.ci-skip-test` 파일을 생성합니다:

```bash
# 스킬 루트에 마커 생성 (파일 내용이 사유로 출력됨)
echo "requires external API credentials" > skills/my-category/my-skill/.ci-skip-test
```

### 로컬 전체 실행

```bash
./tools/run-all-tests.sh
```

---

## 테스트 작성 시 흔한 실수

| 실수 | 문제 | 해결 |
|------|------|------|
| `set -e` + 수동 비교 | exit 1이 스크립트 자체를 종료 | BATS `run` 명령 사용 |
| PATH 오염 | stub이 다음 테스트로 누출 | 각 케이스마다 새 sandbox |
| JSON 이스케이핑 | `"` 중첩 문제 | `python3 -c "import json; ..."` |
| stub 우선순위 | 실제 명령이 먼저 잡힘 | `PATH="$SBIN:$PATH"` (앞에 끼움) |
| 실제 HOME 오염 | `~/.config` 생성됨 | `HOME="$(mktemp -d)"` 재지정 |

---

## 후속 작업 (TODO)

- [ ] 기존 테스트 없는 스킬에 테스트 추가 (java-experts, doc-experts, brew-formula, office-experts)
- [ ] CI 이미지에 uv/Python 추가 (배포 이미지)
- [x] ~~CI 이미지에 perl 추가~~ — **이미지가 아니라 스크립트를 고쳐서 해결**했다(2026-07-27). CI 이미지(`ci-runner:latest`, RHEL 계열 최소 perl 5.32)에는 `Encode`는 있지만 **`open.pm` 프래그마가 없다.** `publish-doc`의 `normalize-output` / `normalize-format`이 `use open`을 쓰다가 perl이 `Can't locate open.pm`으로 죽었고, 하필 그 exit 2가 두 스크립트에서 "패턴 발견"·"게시 차단"을 뜻해 의존성 문제가 판정 결과로 둔갑했다. `binmode`(빌트인) + 3-arg open의 `:utf8`(PerlIO 코어)로 바꿔 모듈 의존을 없앴고, 지금은 두 스위트 40케이스가 CI에서 실제로 돈다.

  교훈으로 남길 것: **모듈이 있는지 없는지를 정황으로 추론하지 말고 환경이 직접 말하게 하라.** 처음엔 exit 2만 보고 "Encode가 없다"고 단정했다가 한 번 헛수고했다. `__tests__/lib/perl-capability.sh`가 perl 경로·버전·`binmode`·`3-arg :utf8`·`open.pm`·`Encode`를 각각 찍고, 못 쓰는 환경이면 이유와 함께 스위트를 건너뛴다(실패로 두면 "환경 미비"와 "스크립트 깨짐"이 구분되지 않는다). 지금 CI에서는 이 장치가 발동하지 않는다 — 안전망으로만 남아 있다.
- [x] publish-doc에 `scripts/tests/run.sh` 생성 (기존 `__tests__/` 연결) — 2026-07-27. 통과하는 테스트 9개가 CI에서 한 번도 실행되지 않고 있었다. 같은 회차에 `diagnose-cost-surge`(pytest 15개)·`analyze-job-resources`(bats 22개)에도 러너를 추가해, `validate-skill.sh`의 러너 검사를 경고 → **실패**로 승격했다.
- [ ] `scripts/__tests__/` → `scripts/tests/` 디렉토리 통일 마이그레이션
- [ ] promptfoo 기반 에이전트 동작 테스트 도입 검토
