# 명명 규칙

이 문서는 Agent Skills의 파일, 디렉토리, 변수 명명 규칙을 설명합니다.

## 스킬 이름

### 규칙

- **소문자**: 항상 소문자만 사용
- **하이픈 구분**: 단어 사이를 하이픈(`-`)으로 연결
- **간결명**: 기능을 명확히 설명하되 간단하게
- **동사 포함**: 스킬이 수행하는 동작을 포함

### 예시

```bash
# 올바름
commit-helper
ci-log-doctor
pr-reviewer
cost-analyzer
brew-formula

# 잘못됨
GitCommitHelper               # 대문자 사용
git_commit_helper             # 밑줄 사용
gitcommithelper               # 구분 없음
git-commit                    # 기능을 명확히 설명하지 않음
commit-helper                 # 도메인(git) 누락
```

## 디렉토리 구조

```
skills/
└── {category}/          # 카테고리 (소문자, 하이픈 구분)
    └── {skill-name}/    # 스킬 이름 (소문자, 하이픈 구분)
        ├── SKILL.md
        ├── README.md
        ├── GUIDELINES.md
        ├── REFERENCE.md      # 선택적
        ├── TROUBLESHOOTING.md # 선택적
        └── scripts/          # 헬퍼 스크립트
            ├── check-deps.sh
            └── analyze.sh
```

## 카테고리 명명

카테고리는 기술 영역이나 도메인을 기준으로 분류합니다.

### 표준 카테고리

| 카테고리 | 설명 | 예시 스킬 |
|---------|------|-----------|
| `ci-experts` | CI/CD 전문가 | ci-log-doctor |
| `meta-experts` | 메타 스킬 | skill-author |
| `java-experts` | Java 개발 | java-refactor |
| `doc-experts` | 문서 작성 | doc-review |

### 카테고리 명명 규칙

```bash
# 올바름
ci-experts
meta-experts
java-experts
doc-experts

# 잘못됨
DevelopmentTechnical       # 카멜케이스
development_technical      # 밑줄 사용
dev-technical             # 약어 사용
```

## 파일 명명

### 스킬 파일

| 파일 | 명명 | 필수 |
|------|------|------|
| 스킬 정의 | `SKILL.md` | ✅ |
| 사용자 문서 | `README.md` | ✅ |
| 구현 가이드 | `GUIDELINES.md` | ✅ |
| 레퍼런스 | `REFERENCE.md` | ❌ |
| 문제 해결 | `TROUBLESHOOTING.md` | ❌ |

### Shell 스크립트

```bash
# 올바름
check-deps.sh
analyze-ci-config.sh
install-gh.sh

# 잘못됨
checkDeps.sh           # 카멜케이스
check_deps.sh          # 밑줄 사용
CHECK-DEPS.SH          # 대문자
```

### Python 스크립트

```bash
# 올바름
analyze-logs.py
format-output.py
install-dependencies.py

# 잘못됨
analyzeLogs.py         # 카멜케이스
analyze_logs.py        # 밑줄 사용
ANALYZE-LOGS.PY        # 대문자
```

### 스크립트 작성 가이드라인

```bash
# 올바름
check-deps.sh
analyze-ci-config.sh
install-gh.sh

# 잘못됨
checkDeps.sh           # 카멜케이스
check_deps.sh          # 밑줄 사용
CHECK-DEPS.SH          # 대문자
```

## 변수 명명

### Shell 스크립트

```bash
# 상수 (대문자, 밑줄 구분)
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly MAX_RETRIES=3

# 지역 변수 (소문자, 밑줄 구분)
local pipeline_id="$1"
local job_name="test"

# 함수 (소문자, 밑줄 구분)
check_dependencies() {
    ...
}

analyze_pipeline() {
    ...
}
```

### 프롬프트 변수

```yaml
# 스킬 내에서 사용하는 변수 (소문자, 밑줄 구분)
{{pipeline_id}}
{{project_path}}
{{job_name}}
```

## 함수 명명

### Shell 함수

```bash
# 동사-명사 형식
check_dependencies() { ... }
install_tool() { ... }
analyze_logs() { ... }

# 파이프라인 처리
format_output | display_results
```

## 훅 명명

### 훅 파일

```bash
# 기능 기반 명명
scripts/check-deps.sh       # 의존성 확인
scripts/analyze-config.sh   # 설정 분석
scripts/install-tool.sh     # 도구 설치
```

### 훅 설명

```yaml
# 명확한 설명
description: "gh가 설치되어 있는지 확인합니다"
description: "CI 설정 파일을 분석하고 문제를 찾습니다"

# 모호한 설명 (피하세요)
description: "체크합니다"
description: "분석"
```

## Git 커밋 메시지

Conventional Commits 형식을 따릅니다:

```
<type>: <description>

[optional body]

[optional footer]
```

### 타입

| 타입 | 설명 |
|------|------|
| `feat` | 새로운 기능 |
| `fix` | 버그 수정 |
| `docs` | 문서만 변경 |
| `style` | 코드 형식 |
| `refactor` | 코드 리팩토링 |
| `test` | 테스트 추가/수정 |
| `chore` | 빌드/도구 변경 |

### 예시

```
feat: ci-log-doctor 스킬 추가

gh CLI를 사용해 CI 파이프라인 로그를 분석하고
실패 원인을 진단하는 스킬을 추가했습니다.

Closes #123
```

## 버전 명명

시맨틱 버전을 따릅니다:

```
MAJOR.MINOR.PATCH

예: 2.0.0
```

| 요소 | 설명 | 예시 |
|------|------|------|
| MAJOR | 하위 호환 불가 변경 | 2.0.0 → 3.0.0 |
| MINOR | 하위 호환 기능 추가 | 2.0.0 → 2.1.0 |
| PATCH | 하위 호환 버그 수정 | 2.0.0 → 2.0.1 |

## 스크립트 작성 가이드라인

### Shell 스크립트

- **실행 권한**: 모든 `.sh` 파일은 자동으로 실행 권한(+x)이 부여됩니다 (pre-commit 훅)
- **Shebang**: `#!/bin/bash` 또는 `#!/usr/bin/env bash` 사용
- **ShellCheck**: [ShellCheck](https://www.shellcheck.net/) 통과 필수

### Python 스크립트

- **패키지 관리자**: `uv` 사용 강력 권장
- **실행 방식**: `uvx`로 standalone 실행 권장
- **Shebang**: `#!/usr/bin/env python3` 또는 `#!/usr/bin/env -S uvx --from`

#### uv 사용 예시

```bash
# 프로젝트 의존성 관리
uv venv
uv pip install -r requirements.txt

# 스크립트 실행 (venv 없이)
uvx script.py
uvx --from package-name script
```

#### 훅에서 Python 실행

```yaml
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(*python*analyze*)"
          command: "uvx \"${CLAUDE_PLUGIN_ROOT}/my-skill/scripts/analyze.py\""
          description: "Python 스크립트 실행"
```

**이유**:
- 빠른 의존성 해결
- 일관된 환경 관리
- venv 없이 실행 가능

## 약어 피하기

명확성을 위해 약어 사용을 피하세요:

```bash
# 올바름
ci-log-doctor
rollout-custom-image

# 피하세요 (내부 팀에서만 사용할 경우)
ci-doc                  # ci-log-doctor
image-rollout           # rollout-custom-image
```

## 참고

- [스킬 명세](skill-specification.md)
- [프론트매터 레퍼런스](frontmatter-reference.md)
- [훅 패턴](hook-patterns.md)
