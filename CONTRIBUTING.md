# 기여 가이드

## 준비

```bash
git clone https://github.com/andromedarabbit/aha-skills.git
cd aha-skills
pre-commit install
```

`pre-commit install`을 빼먹으면 검증기가 커밋 시점에 돌지 않습니다. CI가 잡아주긴 하지만
로컬에서 1초에 끝나는 걸 push 왕복으로 확인할 이유가 없습니다.

`bats`가 필요합니다 (`brew install bats-core`).

## 작업 흐름

```bash
git checkout -b feature/my-new-skill

# 스킬 작성은 /skill-author 로
# 검증
pre-commit run --all-files && ./tools/run-all-tests.sh && git diff --exit-code

git commit -m "feat: 새 스킬 추가"
```

커밋 메시지는 [Conventional Commits](https://www.conventionalcommits.org/)를 따르고 **한국어**로
씁니다: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `ci:`.

## 새 스킬

`/skill-author`를 쓰세요. 수동으로 만들면 다음을 직접 챙겨야 합니다.

**필수 파일**

- `SKILL.md` — 프론트매터 + 에이전트가 실행할 절차
- `README.md` — 사용자용 빠른 시작
- `scripts/`가 있으면 **`scripts/tests/run.sh`가 반드시 있어야 합니다.** 이 파일이 없으면 테스트 파일이 몇 개든 CI가 발견하지 못합니다 — `run-all-tests.sh`가 찾는 경로는 이것 하나뿐입니다

**프론트매터**

`name`(kebab-case) · `description` · `version`(semver) · `context`(`fork`|`inline`) · `language`.
`context: fork`이면 `agent`도 필요합니다.

`description`은 "무엇을 하는지 + 언제 쓰는지"를 구체적으로 담습니다. Claude가 여러 스킬 중
올바른 것을 고르는 근거이고, 트리거가 빈약하면 스킬을 안 쓰고 넘어갑니다. 한도는 1024자입니다.

`context`는 취향이 아니라 **상호작용 모델에서 파생**됩니다.
[docs/skill-specification.md](docs/skill-specification.md)의 판정표를 따르세요. 요약하면:
실행 중 사용자에게 물을 일이 없으면 `fork`, 고위험·비가역 게이트가 여러 곳이면 `inline`
(서브에이전트는 `AskUserQuestion`을 쓸 수 없으므로).

**경로 규약** — 훅과 본문은 다른 변수를 씁니다. 바꿔 쓰면 조용히 깨집니다.

| 변수 | 치환되는 곳 | 가리키는 것 |
|---|---|---|
| `${CLAUDE_PLUGIN_ROOT}` | 프론트매터 `hooks:` | 카테고리(플러그인) 루트 → 뒤에 `<skill>/scripts/...` |
| `${CLAUDE_SKILL_DIR}` | SKILL.md **본문** | 스킬 디렉토리 자체 → 바로 `scripts/...` |
| `$SKILL_DIR` | (치환 없음) | 딸린 문서에서 쓰고, 값 정하는 법을 문서 안에 한 번 적는다 |

`.claude/skills/...` 형태는 예외 없이 오류입니다. 자세한 내용은
[docs/hook-patterns.md](docs/hook-patterns.md)와 [CLAUDE.md](CLAUDE.md).

## 새 카테고리

`.claude-plugin/marketplace.json`에 플러그인 항목을 추가합니다.
**`plugins[].name`은 카테고리 디렉토리명과 정확히 같아야 합니다** —
`validate-marketplace.sh`가 그 튜플로 양방향 정합성을 검사하므로, 다르면 "미등록"과
"유령 등록" 오류가 동시에 납니다.

`metadata.version`은 있으면 semver여야 합니다.

## 기존 스킬 수정

1. `context`가 `fork`인지 `inline`인지 먼저 확인합니다. `fork`이면 `AskUserQuestion`을 쓸 수 없으니 사용자 확인은 `PENDING_DECISION:` 반환-재개 방식으로 씁니다
2. 시맨틱 버전을 올립니다
3. 스킬의 `docs/CHANGELOG.md`를 갱신합니다
4. 검증을 돌립니다

## 검증기를 고칠 때

회귀 테스트를 함께 붙입니다. `tools/test-*.sh`가 그 자리이고, 각 파일은 `mktemp -d`로 자기
픽스처를 만드는 자립형이라 실제 트리에 의존하지 않습니다.

상류에서 이식한 검증기를 고치는 경우 [docs/UPSTREAM.md](docs/UPSTREAM.md)의
"의도적 차이"에 항목을 추가하세요. 나중에 상류 수정을 가져올 때 충돌 지점이 거기 적힌
곳으로 한정됩니다.

## 언어

| 콘텐츠 | 언어 |
|---|---|
| SKILL.md · README.md · 루트 문서 | 한국어 |
| 사용자용 메시지 | 한국어 |
| 코드 주석 | 한국어·영어 모두 허용 |
| bats `@test` 이름 | **ASCII만** (한글을 쓰면 "unknown test name"으로 테스트가 0개 실행됩니다) |
