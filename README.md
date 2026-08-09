# aha-skills

[Claude Code](https://claude.com/claude-code)용 개인 에이전트 스킬(Agent Skills) 모음입니다.
[anthropics/skills](https://github.com/anthropics/skills)의 모범 사례를 따릅니다.

에이전트 스킬은 특화된 워크플로우·도구·도메인 지식으로 Claude Code를 확장합니다. 이 저장소는
스킬을 담는 곳이면서, **스킬 작성 규약을 실행 가능한 검증기로 강제하는** 곳입니다.

## 설치

```
/plugin marketplace add https://github.com/andromedarabbit/aha-skills.git
```

이후 `/plugin` 패널에서 원하는 카테고리를 설치합니다. 카테고리 하나가 플러그인 하나입니다.

## 수록 스킬

전체 목록은 [SKILLS.md](SKILLS.md)에 자동 생성됩니다.

| 카테고리 | 스킬 | 설명 |
|---|---|---|
| `meta-experts` | [skill-author](skills/meta-experts/skill-author) | 새 스킬을 만들고 저장소 관례에 맞게 검증 |

## 새 스킬 만들기

```
/skill-author
```

또는 "스킬 만들어줘"라고 하면 됩니다. 이 스킬이 상호작용 모델을 판정해
`context`/`agent`/`background`/`WORKER.md`를 파생시키고, 필요한 파일 일습을 만든 뒤 내용까지
채우고 검증기를 돌립니다.

뼈대만 필요하면 스캐폴더를 직접 부를 수 있습니다:

```bash
skills/meta-experts/skill-author/scripts/scaffold.sh --help
```

## 검증

커밋 전 이 한 줄이면 됩니다:

```bash
pre-commit run --all-files && ./tools/run-all-tests.sh && git diff --exit-code
```

- `pre-commit run --all-files` — 검증기 8종이 실제 입력으로 돈다
- `./tools/run-all-tests.sh` — 스킬 테스트 스위트가 실제로 발견되고 실행된다
- `git diff --exit-code` — 인덱스 드리프트와 fixer 재작성이 없다

첫 `pre-commit run`은 실패가 정상입니다 — `end-of-file-fixer`·`trailing-whitespace`는 fixer라서
파일을 고치고 non-zero로 끝납니다. 깨끗해질 때까지 다시 돌리세요.

검증기 자신의 회귀 테스트는 위 명령에 포함되지 않습니다(CI가 담당). 검증기를 고쳤으면:

```bash
for f in tools/test-*.sh; do bash "$f" || break; done
```

### 검증기 목록

| 스크립트 | 검사 대상 |
|---|---|
| `tools/check-frontmatter.sh` | SKILL.md 프론트매터 (필수 필드·semver·description 한도·when-to-use 트리거) |
| `tools/validate-skill.sh` | 스킬 디렉토리 구조 + `shellcheck -x` |
| `tools/validate-matchers.sh` | 훅 matcher·이벤트 이름 (발동 불가능한 matcher 적출) |
| `tools/validate-gate-context.sh` | AskUserQuestion 게이트 컨텍스트 (`allowed-tools`에 있으면 `context: inline` 강제) |
| `tools/validate-hook-paths.sh` | 프론트매터 훅의 스크립트 경로 (`${CLAUDE_PLUGIN_ROOT}` 형태) |
| `tools/validate-body-paths.sh` | SKILL.md 본문·딸린 문서의 스크립트 경로 (`${CLAUDE_SKILL_DIR}` vs `$SKILL_DIR`) |
| `tools/validate-marketplace.sh` | marketplace.json 스키마 + `skills/` 양방향 정합성 |
| `tools/generate-index.sh` | SKILLS.md 재생성 |
| `tools/run-all-tests.sh` | 스킬 테스트 스위트 탐색·실행 |

## 문서

- [CLAUDE.md](CLAUDE.md) — 이 저장소에서 작업할 때의 지침 (가장 먼저 읽을 것)
- [docs/skill-specification.md](docs/skill-specification.md) — Agent Skills 명세
- [docs/frontmatter-reference.md](docs/frontmatter-reference.md) — 프론트매터 필드 전체
- [docs/hook-patterns.md](docs/hook-patterns.md) — 훅 패턴과 경로 규약
- [docs/naming-conventions.md](docs/naming-conventions.md) — 명명 규칙
- [docs/korean-content-guidelines.md](docs/korean-content-guidelines.md) — 한국어 콘텐츠 표준
- [docs/testing-guide.md](docs/testing-guide.md) — 테스트 작성 패턴
- [docs/platform-comparison.md](docs/platform-comparison.md) — 다른 에이전트 플랫폼과의 비교
- [docs/UPSTREAM.md](docs/UPSTREAM.md) — 이식 출처와 의도적 차이

## 기여

[CONTRIBUTING.md](CONTRIBUTING.md) 참조.
