# CLAUDE.md

이 파일은 이 저장소의 코드로 작업할 때 Claude Code (claude.ai/code)에 대한 지침을 제공합니다.

## 개요

`aha-skills`는 [anthropics/skills](https://github.com/anthropics/skills) 저장소의 모범 사례를 따르는 Claude Code용 개인 에이전트 스킬(Agent Skills) 모음입니다. 에이전트 스킬은 특화된 워크플로우, 도구, 도메인별 지식으로 Claude Code의 기능을 확장합니다.

검증기·표준 문서·`skill-author`는 사내 저장소에서 이식했습니다. 출처와 의도적 차이는 [docs/UPSTREAM.md](docs/UPSTREAM.md) 참조.

## 개발 명령어

### 검증 및 테스트

```bash
# 스킬 구조 검증
./tools/validate-skill.sh skills/your-category/your-skill

# 프론트매터 형식 확인
./tools/check-frontmatter.sh skills/your-category/your-skill/SKILL.md

# 훅 매처·이벤트 이름·게이트 컨텍스트·훅 경로·본문 경로 검증 (저장소 전체 스캔)
./tools/validate-matchers.sh
./tools/validate-gate-context.sh
./tools/validate-hook-paths.sh
./tools/validate-body-paths.sh

# marketplace.json ↔ skills/ 양방향 정합성 검증
./tools/validate-marketplace.sh

# SKILLS.md 인덱스 생성/재생성
./tools/generate-index.sh

# 전체 스킬 테스트 실행 (CI와 동일)
./tools/run-all-tests.sh

# 로컬에서 pre-commit 훅 설치 및 실행
pre-commit run --all-files

# 검증기 자신의 회귀 테스트 (run-all-tests.sh 는 이걸 돌리지 않는다)
for f in tools/test-*.sh; do bash "$f" || break; done
```

**커밋 전 이 한 줄로 전체 검증합니다:**

```bash
pre-commit run --all-files && ./tools/run-all-tests.sh && git diff --exit-code
```

- `pre-commit run --all-files` — 검증기 8종이 실제 입력으로 돈다
- `./tools/run-all-tests.sh` — 스킬 테스트 스위트가 실제로 발견되고 실행된다
- `git diff --exit-code` — `generate-index.sh`가 드리프트를 만들지 않았고 fixer가 파일을 다시 쓰지 않았다

첫 `pre-commit run`은 실패가 정상입니다 — `end-of-file-fixer`·`trailing-whitespace`는 fixer라서 파일을 고치고 non-zero로 끝납니다. 깨끗해질 때까지 다시 돌리세요.

### 새 스킬 만들기

```bash
# 스킬 생성은 skill-author 스킬로 (/skill-author 또는 "스킬 만들어줘")
# 뼈대만 필요하면 코어 스크립트를 직접 호출
skills/meta-experts/skill-author/scripts/scaffold.sh --help

# 또는 템플릿에서 수동 생성
cp -r skills/meta-experts/skill-author/assets/skill-template skills/your-category/your-skill
```

### Python 개발

```bash
# uv 설치 (미설치 시)
curl -LsSf https://astral.sh/uv/install.sh | sh

# 스킬의 의존성 설치 (requirements.txt 는 스킬별 scripts/ 에 둔다 — 루트에는 없다)
uv pip install -r skills/your-category/your-skill/scripts/requirements.txt

# venv 없이 Python 스크립트 실행
uvx scripts/analyze.py
```

**스킬용 Python 스크립트를 만들 때:**
- 훅에서 독립 실행형 스크립트 실행에는 `uvx` 사용
- 스킬의 `scripts/` 디렉토리에 `requirements.txt` 포함
- Shebang은 `#!/usr/bin/env python3`으로 설정

### Git 워크플로우

```bash
# 기능 브랜치 명명
git checkout -b feature/my-new-skill
git checkout -b fix/something-broken

# 커밋 메시지는 Conventional Commits 따름
git commit -m "feat: add my new skill"
git commit -m "fix: correct hook path"
```

## 아키텍처

### 저장소 구조

```
aha-skills/
├── skills/                    # 카테고리별 모든 에이전트 스킬
│   └── meta-experts/          # 스킬 작성 메타 스킬
│       └── skill-author/      # 새 스킬 생성·판정·검증 (스킬 구조 예시는 아래 '스킬 구조' 참고)
├── tools/                     # 검증 및 유틸리티 스크립트 (15개)
├── docs/                      # 표준 및 모범 사례 + UPSTREAM.md (이식 출처)
├── .github/workflows/         # GitHub Actions 검증 워크플로
└── .claude-plugin/            # 마켓플레이스 등록 메타데이터
```

카테고리는 필요할 때 늘립니다. 새 카테고리를 만들면 `.claude-plugin/marketplace.json`에 플러그인 항목을 추가해야 하고, **`plugins[].name`은 카테고리 디렉토리명과 정확히 같아야 합니다** — `validate-marketplace.sh`가 그 튜플로 양방향 정합성을 검사하므로 다르면 "미등록"과 "유령 등록" 오류가 동시에 납니다.

- 프로젝트 공유 도메인 용어집(엔티티·명명된 프로세스·상태 개념). 코드베이스에 적응하거나 도메인 개념을 논의할 때 참고: @CONCEPTS.md

### 스킬 구조 (중요)

각 스킬 디렉토리에는 다음이 포함됩니다:

**필수 파일:**
- `SKILL.md` - 프론트매터가 포함된 에이전트 설정 (name, description, version, context, agent, language, dependencies, hooks)
- `README.md` - 빠른 시작을 위한 사용자용 문서
- `scripts/` - 훅용 실행 가능한 스크립트 (Bash, Python 등)

**선택 사항이지만 권장:**
- `docs/` - 상세 가이드 (GUIDELINES.md, REFERENCE.md, TROUBLESHOOTING.md 등)
  - 에이전트는 사용자가 명시적으로 요청하지 않는 한 docs/를 읽지 않아야 합니다
  - `docs/INDEX.md`를 사용하여 사용 가능한 문서를 확인하세요

**스크립트 가이드라인:**
- **Shell 스크립트**: 실행 가능 권한 (+x)이 필요하며, pre-commit 훅에 의해 자동으로 설정됩니다
- **Python 스크립트**: 의존성 관리 및 실행을 위해 `uv`/`uvx`를 사용하세요
- **Shebangs**:
  - Shell: `#!/bin/bash` 또는 `#!/usr/bin/env bash`
  - Python: `#!/usr/bin/env python3` 또는 `#!/usr/bin/env -S uvx --from`

**핵심 아키텍처 원칙:** 스킬 실행 중 토큰 사용량을 최소화하기 위해 에이전트에 필수적인 컨텍스트(SKILL.md, scripts/)와 참조 문서(docs/)를 분리하세요.

### 프론트매터 설정

모든 `SKILL.md`는 다음을 포함해야 합니다:

```yaml
---
name: skill-name              # kebab-case, 필수
description: 기능 + 언제 쓰는지(when-to-use)  # 1024자 이내, 필수
dependencies:
  - tool>=version             # 선택적
version: 1.0.0               # 시맨틱 버전닝, 필수
context: fork                # fork (권장) 또는 inline
agent: general-purpose       # context: fork일 때만 필수
background: true             # 선택, context: fork 전용, 기본값 true
language: "korean"           # 필수
hooks:                       # 강력 권장
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(some-cmd *)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/skill-name/script.sh\""
          description: "What this hook does"
---
```

**중요:**
- `description`은 "무엇을 하는지 + 언제 쓰는지(when-to-use 트리거)"를 구체적으로 담으세요. Claude가 여러 스킬 중 올바른 것을 고르는 근거이며, 트리거가 빈약하면 스킬을 안 쓰고 넘어가는 undertrigger가 생깁니다. 공식 한도는 1024자이고, 그 안에서 불필요하게 장황하지 않게 씁니다 (임의의 짧은 글자 수 제한은 두지 않습니다)
- `context`는 취향이 아니라 **상호작용 모델에서 파생**됩니다. `docs/skill-specification.md`의 판정표를 따르세요 — 손으로 고르지 말고 `skill-author`가 판정하게 합니다. 요약하면: 실행 중 사용자에게 물을 일이 없으면 `fork`(격리 이득), 고위험·비가역 게이트가 여러 곳이면 `inline`(서브에이전트는 `AskUserQuestion`을 쓸 수 없으므로)
- `inline`은 "작은 유틸리티 전용"이 아닙니다 — 게이트가 여러 개인 큰 스킬도 `inline`이 맞을 수 있습니다(예: `gitlab-mr-creation` v3.0.0, `jupyterhub-custom-image-rollout`). 다만 inline 본문은 주 대화에 상주하므로 크기가 곧 비용이고, **주 에이전트가 실행할 절차를 참조 문서로 빼는 것은 자기무효**입니다(그 에이전트가 다시 Read해서 같은 토큰이 들어옵니다)
- 훅 경로는 `"bash \"${CLAUDE_PLUGIN_ROOT}/<skill>/scripts/<script>.sh\""` 형태여야 합니다. `${CLAUDE_PLUGIN_ROOT}`는 **카테고리 설치 루트**라서 경로에 카테고리가 들어가지 않습니다 (아래 "훅 경로 규칙" 참고)
- `language` 필드는 필수입니다 (예: 이 저장소의 경우 `"korean"`)
- **`context: fork` 스킬은 `AskUserQuestion`을 쓸 수 없습니다** (모든 서브에이전트 공통). 사용자 확인은 `PENDING_DECISION:` 반환-재개 방식으로, 호출 전 모호성 해소 질문은 `description`에 담습니다 — `docs/frontmatter-reference.md`의 "fork 스킬에서 사용자 확인받기" 참고

### 훅 시스템

Claude Code는 이벤트 기반 자동화를 위해 여러 훅 타입을 지원합니다:

**PreToolUse** - 도구 실행 전 (의존성 설치, 환경 설정)
**PostToolUse** - 도구 실행 후 (로그 파싱, 요약, 검증, 출력 후처리·시크릿 마스킹). 파일 작성 등 특정 동작에만 반응하려면 `if`로 대상을 좁힌다
**PreToolUse vs PostToolUse** - 자동화 실행 시점을 기준으로 선택

> 참고: `PostToolWrite`는 실재하는 이벤트가 아니다(`tools/validate-matchers.sh`가 거부). 출력 후처리는 `PostToolUse` + `if`로 구현한다.

**훅 경로 규칙:** 항상 `${CLAUDE_PLUGIN_ROOT}` 기준으로, 따옴표로 감싸서 쓰세요:

```yaml
# 올바름 — 카테고리는 경로에 들어가지 않는다
command: "bash \"${CLAUDE_PLUGIN_ROOT}/my-skill/scripts/check.sh\""
command: "uv run \"${CLAUDE_PLUGIN_ROOT}/my-skill/scripts/report.py\" --quiet-ok"

# 잘못됨
command: "bash .claude/skills/gitlab-experts/my-skill/scripts/check.sh"  # CWD 상대경로 → 조용히 실행 안 됨
command: "bash \"${CLAUDE_PLUGIN_ROOT}/gitlab-experts/my-skill/scripts/check.sh\""  # 카테고리 중복
command: "bash \"${CLAUDE_SKILL_DIR}/scripts/check.sh\""  # 훅에서는 치환되지 않음
command: "bash ${CLAUDE_PLUGIN_ROOT}/my-skill/scripts/check.sh"  # 따옴표 없음 → 경로에 공백 있으면 깨짐
command: "bash scripts/check.sh"
command: "bash ../../my-skill/scripts/check.sh"
```

`$CLAUDE_PLUGIN_ROOT`는 **플러그인(= 카테고리) 설치 루트**입니다. 실측:

```text
~/.claude/plugins/cache/oh-my-skills/gitlab-experts/<sha>/gitlab-mr-creation/scripts/check-deps.sh
└───────────────────── $CLAUDE_PLUGIN_ROOT ─────────────────────┘└──── 스킬 디렉토리 ────┘
```

**왜 바뀌었나:** 옛 `.claude/skills/...` 형태는 CWD 기준 상대경로여서 플러그인으로 설치된
환경에 존재하지 않는 경로였고(이 저장소에는 `.claude/skills/` 디렉토리 자체가 없습니다),
훅은 경로가 틀려도 **에러 없이 조용히 실행되지 않습니다**. 그 결과 `gitlab-mr-creation`의
Stage 4 승인 영수증 훅이 한 번도 실행되지 않은 채 "승인 게이트가 있다"고 문서화돼 있었습니다.
`tools/validate-hook-paths.sh`가 옛 형태를 오류로 잡습니다.

> 스킬 프론트매터 훅에서 `${CLAUDE_PLUGIN_ROOT}`가 치환된다는 것은 **공식 문서에 없습니다**
> (스킬 프론트매터 훅 자체가 문서화되지 않은 기능입니다). 근거는 Claude Code v2.1.220
> 바이너리의 문자열입니다: `but only ${CLAUDE_PLUGIN_ROOT} is available for skill hooks
> (${CLAUDE_PLUGIN_DATA} is plugin-only).` 공식 문서는 플러그인의 `hooks/hooks.json`
> 문맥에서만 이 변수를 설명합니다.

### SKILL.md 본문 경로 규약

훅과 본문은 **다른 변수**를 씁니다. 바꿔 쓰면 조용히 깨집니다.

| 변수 | 치환되는 곳 | 가리키는 것 | 뒤에 붙는 것 |
|---|---|---|---|
| `${CLAUDE_PLUGIN_ROOT}` | 프론트매터 `hooks:` | 카테고리(플러그인) 루트 | `<skill>/scripts/...` |
| `${CLAUDE_SKILL_DIR}` | SKILL.md **본문**, `allowed-tools` | **스킬 디렉토리 자체** | 바로 `scripts/...` |
| `$SKILL_DIR` | (치환 없음) | 읽는 쪽이 직접 정하는 값 | 바로 `scripts/...` |
| 스크립트 내부 | (치환 없음) | `$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)` 기준 | 자기 위치에서 계산 |

```bash
# 올바름 — 카테고리도 스킬 이름도 붙이지 않고, 따옴표로 감싼다
bash "${CLAUDE_SKILL_DIR}/scripts/preflight.sh"

# 잘못됨
bash .claude/skills/gitlab-experts/my-skill/scripts/x.sh  # CWD 상대경로 → 첫 호출부터 실패
bash "${CLAUDE_SKILL_DIR}/my-skill/scripts/x.sh"          # 스킬 이름 중복
bash "${CLAUDE_PLUGIN_ROOT}/my-skill/scripts/x.sh"        # 본문에서는 치환되지 않음
```

핵심만:

- **본문 결함은 훅 결함보다 시끄럽습니다.** 훅은 경로가 틀리면 조용히 안 돌지만, 본문은
  에이전트가 그 경로로 실제 실행해서 **첫 호출부터 `No such file or directory`로 실패**합니다
- **`${CLAUDE_SKILL_DIR}` 뒤에 카테고리·스킬 이름을 붙이지 않습니다** — 이미 스킬 디렉토리입니다
- **판정 기준은 "누가 읽나"가 아니라 "하네스를 거치나"입니다.** `docs/`·`README.md`·`WORKER.md`는
  누가 읽든 Read 도구로 읽히므로 치환이 없습니다. 거기에 `${CLAUDE_SKILL_DIR}`를 적으면 읽는
  쪽이 그대로 셸에 넘기고 bash가 빈 문자열로 확장해 `bash /scripts/x.sh`로 죽습니다. **딸린
  문서에서는 `$SKILL_DIR`을 쓰고 그 값을 정하는 방법을 문서 안에 한 번 적으세요**
  (2026-07-29에 "docs/는 에이전트가 읽으니 하네스 변수를 쓰라"고 잘못 안내해 8파일 53곳을
  되돌린 적이 있습니다)
- **워커에게 넘길 때는 게이트가 치환된 절대경로를 프롬프트에 실어 보냅니다** — 읽을 문서의
  절대경로와, 그 문서 안의 상대 참조를 풀 **기준 디렉토리** 둘 다. 워커는 변수를 치환받지 못합니다
- **`.claude/skills/`는 예외 없이 오류입니다** — 규약을 설명하는 산문에서도 쓰지 마세요.
  `tools/validate-body-paths.sh`가 CI에서 잡습니다

전체 규약은 [docs/hook-patterns.md](docs/hook-patterns.md)의 "SKILL.md 본문 경로 규약" 참조.

### CI/CD 파이프라인

GitHub Actions: `.github/workflows/validate.yml`. 잡 2개가 병렬로 돕니다.

- `checks` — 검증기 전량 + 검증기 자신의 회귀 테스트 5종. bats 없이 돌아갑니다(검증 스택의 무결성을 서드파티 설치 없이 증명). `generate-index.sh` 실행 후 `git diff --exit-code`로 **인덱스 드리프트도 게이트**합니다
- `tests` — bats 설치 후 `./tools/run-all-tests.sh`

실행 대상: PR, `main` push, 수동 트리거(`workflow_dispatch`).

`feature/*` push 트리거는 의도적으로 두지 않았습니다 — PR이 열린 브랜치에 push하면 이미 `pull_request`가 발동하므로 커밋마다 워크플로가 두 번 돕니다.

의존성은 PyYAML(`astral-sh/setup-uv`)과 bats(`apt`) 둘뿐입니다. `check-frontmatter.sh`는 `CI` 환경변수가 있을 때 YAML 파서가 없으면 **경고가 아니라 에러**를 냅니다 — GitHub Actions는 `CI=true`를 자동 설정하므로 PyYAML을 빼면 "로컬은 초록, CI는 빨강"이 됩니다.

### Pre-commit 훅

모든 커밋 시 자동 실행:
- 표준 YAML, 공백, 머지 충돌, 대용량 파일, 실행파일 shebang 확인
- `generate-skills-index` - SKILLS.md 자동 재생성
- `check-skill-frontmatter` - 프론트매터 형식 검증
- `validate-skill` - 스킬 구조 준수 확인
- `validate-matchers` - 훅 matcher·이벤트 이름 검증
- `validate-hook-paths` - 프론트매터 훅 경로 검증
- `validate-body-paths` - SKILL.md 본문·딸린 문서의 스크립트 경로 검증
- `validate-marketplace` - marketplace.json ↔ skills/ 정합성 검증
- `fix-shell-permissions` - scripts/ 셸 스크립트 실행 권한 부여

`tools/test-*.sh`(검증기 회귀 테스트 5종)는 pre-commit에도 `run-all-tests.sh`에도 들어있지 않습니다 — CI의 `checks` 잡이 명시적으로 호출합니다. 검증기를 고쳤으면 로컬에서 직접 돌리세요.

## 언어 가이드라인

| 콘텐츠 유형 | 언어 |
|--------------|----------|
| 스킬 SKILL.md | 한국어 |
| 스킬 README.md | 한국어 |
| 루트 README.md | 한국어 |
| 루트 CONTRIBUTING.md | 한국어 |
| 코드 주석 | 한국어·영어 모두 허용 (강제하지 않음) |
| 사용자용 메시지 | 한국어 |
| Python 스크립트 | 코드 주석 자유, 메시지 한국어 |
| Shell 스크립트 | 코드 주석 자유, 메시지 한국어 |

## 명명 규칙

- **스킬:** kebab-case (예: `git-commit-helper`, `gitlab-ci-pipeline-doctor`)
- **카테고리:** kebab-case 복수형 (예: `git-experts`, `gitlab-experts`, `java-experts`, `macos-experts`)
- **파일:** 소문자와 하이픈 (예: `check-deps.sh`)
- **디렉토리:** 소문자와 하이픈 (예: `scripts/`, `docs/`)

## 스킬 작업 방법

### 새 스킬 만들 때

1. `skill-author` 스킬 사용 (`/skill-author` 또는 "스킬 만들어줘")
2. 모든 필수 파일이 있는지 확인 (SKILL.md, README.md, scripts/)
3. `context`/`agent`/`background`는 손으로 고르지 말 것 — 상호작용 모델에서 파생됩니다
4. 의존성 설치 및 결과 검증을 위한 훅 추가
5. 커밋 전 `./tools/validate-skill.sh` 실행

### 기존 스킬 수정할 때

1. 스킬이 `context: fork` 또는 `inline` 중 무엇을 사용하는지 확인
   - `fork`이면 `AskUserQuestion`을 쓸 수 없으므로 사용자 확인은 `PENDING_DECISION:` 반환-재개 방식으로 작성
2. 훅 경로는 `${CLAUDE_PLUGIN_ROOT}/<skill>/...` 형태여야 함 (카테고리 없음, 따옴표 필수)
3. 변경 사항 검증을 위해 pre-commit 훅 실행
4. 시맨틱 버전닝을 따르는 버전 번호 업데이트
5. 스킬의 docs/에 있는 CHANGELOG.md 업데이트

### 스킬을 읽을 때

1. 에이전트 설정은 `SKILL.md`부터 시작
2. 사용자용 빠른 시작은 `README.md` 참조
3. 명시적으로 필요한 경우에만 `docs/` 파일 읽기
4. 사용 가능한 문서 확인은 `docs/INDEX.md` 활용

## 테스트 규칙

### 필수 조건

`scripts/`가 있는 스킬은 반드시 `scripts/tests/run.sh`를 포함해야 합니다 (`validate-skill.sh`가 실패로 잡습니다).

이 파일이 없으면 테스트 파일이 아무리 많아도 CI가 발견하지 못합니다 — `run-all-tests.sh`가 찾는 경로가 이것 하나뿐입니다. `confluence-publish`가 실제로 그 상태였습니다(테스트 9개가 전부 통과하는데 아무도 돌리지 않음).

### 프레임워크 선택

| 스크립트 언어 | 프레임워크 | 실행 방법 |
|---------------|-----------|-----------|
| Shell (Bash) | BATS | `bats *.bats` |
| Python | pytest + uv | `uv run pytest` |

### 핵심 원칙

- **Fail-fast**: `set -euo pipefail` — 첫 실패에서 즉시 종료
- **테스트 격리**: `mktemp -d` + `HOME` 재지정으로 환경 오염 방지
- **PATH stub**: 외부 CLI는 가짜 바이너리로 대체해서 테스트
- **CI 자동 연동**: `scripts/tests/run.sh`가 있으면 CI에서 자동 실행 (등록 불필요)

### 명령어

```bash
# 전체 테스트 실행 (CI와 동일)
./tools/run-all-tests.sh

# 개별 스킬 테스트
./skills/your-category/your-skill/scripts/tests/run.sh
```

### 상세 가이드

테스트 작성 패턴, Hook 테스트, Python 테스트 등 상세 내용은 [docs/testing-guide.md](docs/testing-guide.md) 참조.

## 일반적인 패턴

### 의존성 자동 설치 (PreToolUse)

```yaml
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(*gradlew*)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/skill/scripts/check-deps.sh\""
          description: "의존성이 없을 때 설치"
```

### 로그 요약 (PostToolUse)

```yaml
hooks:
  PostToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(glab ci *)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/skill/scripts/summarize-log.sh\""
          description: "CI 로그 요약"
```

### Python 스크립트 실행 (PreToolUse)

```yaml
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(*python*analyze*)"
          command: "uv run \"${CLAUDE_PLUGIN_ROOT}/skill/scripts/analyze.py\""
          description: "Python 분석 스크립트 실행"
```

**참고**: Python 스크립트는 가상 환경 관리 문제를 피하기 위해 `uv run`(또는 `uvx`)을 사용하세요.
인터프리터가 무엇이든 스크립트 경로는 `"${CLAUDE_PLUGIN_ROOT}/<skill>/..."` 형태로 감싸야 합니다.

## 참고

- [스킬 명세](docs/skill-specification.md) - 전체 Agent 스킬 명세
- [프론트매터 참조](docs/frontmatter-reference.md) - 모든 프론트매터 필드
- [훅 패턴](docs/hook-patterns.md) - 9가지 실제 훅 패턴
- [명명 규칙](docs/naming-conventions.md) - 상세 명명 표준
- [한국어 콘텐츠 가이드라인](docs/korean-content-guidelines.md) - 언어 표준
- [테스트 가이드](docs/testing-guide.md) - 테스트 작성 패턴
- [플랫폼 비교](docs/platform-comparison.md) - Claude Code와 다른 에이전트 플랫폼
- [상류 출처](docs/UPSTREAM.md) - 이식 출처·의도적 차이·상류 수정 가져오는 절차
