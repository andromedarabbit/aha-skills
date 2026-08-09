# skill-author 워커

`SKILL.md` 게이트가 `general-purpose` 에이전트에게 넘기는 실행 본문입니다. 주 대화에 적재되지
않으므로 길어져도 됩니다.

**하는 일**: 뼈대 생성 → 실제 내용 작성 → 검증 → 짧은 보고. 이 중 3번째가 빠지면 검증기가 잡을
결함을 사람이 나중에 발견하게 되고, 2번째가 빠지면 폐기된 마법사와 다를 게 없습니다.

## 입력

Intent Contract 만 받습니다. 원 대화 맥락은 없다고 가정하세요. Contract에 없는 값을 추측해서
채우지 말고, 정말 필요하면 `NEEDS_DECISION`으로 되물으세요.

## 1. 뼈대 생성

`scripts/scaffold.sh`를 호출합니다. **파일을 직접 만들지 마세요** — `interaction` 값에서
`context`/`agent`/`background`/`WORKER.md` 생성 여부를 파생시키는 로직은 이 스크립트 하나에만
있어야 합니다. 손으로 만들면 그 순간 판정 로직이 두 벌이 됩니다.

```bash
skills/meta-experts/skill-author/scripts/scaffold.sh \
  --category <category> \
  --name <name> \
  --description "<description>" \
  --interaction <model> \
  --version <version> \
  [--background false] \
  [--dep 'tool>=version']...
```

먼저 `--dry-run`으로 판정 결과를 확인하고, 기대와 다르면 그대로 진행하지 말고
`NEEDS_DECISION`으로 되물으세요.

스크립트가 만드는 것: `SKILL.md`, `README.md`, `docs/{INDEX,GUIDELINES,REFERENCE}.md`,
`scripts/tests/{run.sh,example.bats}`, 그리고 `gate-worker`면 `WORKER.md`, 의존성을 선언했으면
`scripts/example-hook.sh`.

## 2. 실제 내용 작성

여기가 스크립트 대비 이 스킬의 존재 이유입니다. **placeholder를 남기지 마세요.** Contract의
`goal`·`scope`·`workflow`·`constraints`·`acceptance_criteria`를 근거로 다음을 실제 내용으로
바꿉니다.

### SKILL.md

- `## 개요` — 이 스킬이 해결하는 문제. "무엇을 하는 스킬입니다" 같은 동어반복 금지
- `## 사용 방법` — `workflow`를 실제 단계로. 각 단계에 **왜** 그렇게 하는지를 한 줄씩 붙이세요.
  지시만 나열된 스킬보다 이유가 붙은 스킬이 훨씬 잘 지켜집니다
- `## 예시` — 실행 가능한 명령. 지어낸 값 대신 Contract에 나온 실제 도구·경로를 쓰세요
- 게이트 섹션(`interaction`에 따라 스크립트가 넣어둔 것) — 골격은 그대로 두고 **무엇을 물을지,
  선택지가 무엇인지**를 이 스킬에 맞게 채웁니다
- `constraints`에 담긴 하지 말아야 할 일은 별도 항목으로 남기세요

`description`은 스크립트가 Contract 값을 그대로 넣습니다. 트리거 문구가 약하면(“~할 때 사용”류
발화 예시가 없으면) 여기서 보강하세요 — 이게 스킬이 불릴지 말지를 결정합니다. `scope.out`은
네거티브 트리거("다음은 이 스킬이 아닙니다: ...")로 옮깁니다.

### WORKER.md (gate-worker인 경우)

절차·예시·주의사항은 전부 이쪽에 씁니다. 게이트는 질문과 Contract 구성만 남기고 얇게 유지하세요.

### README.md

사람이 읽는 문서입니다. 실제 사용 예시와 출력, 요구사항, 흔한 문제를 채웁니다. 스크립트가 붙여둔
`## 실행 방식` 절은 파생값이므로 **손대지 마세요.**

### docs/

`GUIDELINES.md`의 "선택 이유"에는 Contract의 `interaction_rationale`을 옮깁니다. 값(`context: ...`)을
다시 적지 마세요 — 프론트매터와 README에 이미 있고, 세 곳에 적으면 갈라집니다. 해당 없는 절
(API·환경 변수 등)은 지웁니다. 빈 템플릿 껍데기를 남기는 것보다 없는 게 낫습니다.

### scripts/

스킬이 실제로 스크립트를 필요로 할 때만 만듭니다. 만들었다면 `scripts/tests/example.bats`를 실제
테스트로 교체하세요. **`@test` 이름은 ASCII로 씁니다** — 한글 이름을 쓰면 bats가
"unknown test name"으로 0개를 실행하면서 통과처럼 보입니다. 스크립트를 안 만들었으면
`example-hook.sh`와 `example.bats`는 지우세요.

훅을 손으로 더 추가한다면 경로는 반드시
`command: "bash \"${CLAUDE_PLUGIN_ROOT}/<skill>/scripts/<x>.sh\""` 형태로 씁니다.
`${CLAUDE_PLUGIN_ROOT}`는 **카테고리 설치 루트**라서 경로에 카테고리가 들어가지 않고,
따옴표는 필수입니다(설치 경로에 공백 가능). CWD 기준 상대경로는 **에러 없이 조용히 실행되지
않습니다** — `./tools/validate-hook-paths.sh`가 잡습니다.

### 본문 경로는 훅과 다른 변수를 씁니다

SKILL.md **본문**에서 스크립트를 부를 때는 `${CLAUDE_SKILL_DIR}`입니다. 하네스가 본문과
`allowed-tools`의 이 변수를 미리 치환합니다. 쓸 형태는 스캐폴딩이 깔아 준 `SKILL.md`의
"스크립트 경로 (먼저 읽을 것)" 절에 이미 들어 있으니 **그 줄을 그대로 재사용**하세요
(원본: `assets/skill-template/SKILL.md`). 손으로 다시 타이핑하면서 틀리는 자리가 아래 두 개입니다.

- 이 변수는 **스킬 디렉토리 자체**입니다 — 뒤에 카테고리도 스킬 이름도 붙이지 마세요. 훅 규약을
  그대로 옮기는 게 가장 흔한 실수입니다
- 따옴표는 필수입니다. 치환된 설치 경로에 공백이 들어갈 수 있습니다
- 훅에 `${CLAUDE_SKILL_DIR}`을 쓰거나 본문에 `${CLAUDE_PLUGIN_ROOT}`를 쓰면 치환되지 않고
  조용히 깨집니다
- 본문 결함은 훅 결함보다 시끄럽습니다: 에이전트가 그 경로로 실제 실행해서 **첫 호출부터**
  `No such file or directory`로 실패합니다. `./tools/validate-body-paths.sh`가 잡습니다
- **`WORKER.md`나 `docs/*.md`·`README.md` 같은 딸린 문서에서 `${CLAUDE_SKILL_DIR}`을 경로로 쓰지
  마세요.** 치환은 본문과 `allowed-tools`에서만 일어나고 딸린 문서는 누가 읽든 Read 도구로 읽히므로
  날문자로 남습니다. 판정 기준은 "에이전트용이냐 사람용이냐"가 아니라 **"하네스를 거치느냐"** 입니다.
  같은 검사기가 딸린 문서의 경로 사용도 오류로 잡습니다(변수 이름만 부르는 언급은 통과)
  - 서브에이전트에 넘길 때는 게이트가 프롬프트에 **치환된 절대경로**를 실어 보내야 하고, 두 개가
    필요합니다 — 읽을 문서의 절대경로와, 그 문서 안의 상대 참조를 풀 **기준 디렉토리**. 두 번째를
    빼먹으면 워커가 자기 CWD 기준으로 `references/*.md`를 찾아 실패합니다
  - 사람이 셸에서 직접 실행할 예시라면 `$SKILL_DIR`을 쓰고, **그 값을 정하는 방법을 같은 문서에
    적으세요**(플러그인 캐시 경로 / 클론 경로 두 가지). 여러 문서가 반복하면 README 한 곳에 두고
    나머지는 링크합니다 — `git-experts/commit-helper`가 그 형태입니다

## 3. 검증

저장소 루트에서 순서대로 돌리고, 실패하면 고친 뒤 다시 돌립니다. 실패를 안고 보고하지 마세요.

```bash
./tools/check-frontmatter.sh skills/<category>/<name>/SKILL.md
./tools/validate-skill.sh skills/<category>/<name>
./tools/validate-matchers.sh
./tools/validate-hook-paths.sh
./tools/validate-body-paths.sh
./tools/validate-marketplace.sh
./tools/generate-index.sh
```

`validate-marketplace.sh`를 빼먹지 마세요. 나머지는 **등록된 경로가 실재하는지**만 보므로,
새 스킬이 `.claude-plugin/marketplace.json`에 누락돼도 전부 통과합니다. 이 검증기가 양방향
(등록↔실재)을 보는 유일한 곳이고 CI·pre-commit에도 걸려 있어서, 여기서 안 돌리면 CI에서 깨집니다.

스킬에 `scripts/`를 만들었으면 테스트도 함께 돌립니다:

```bash
./skills/<category>/<name>/scripts/tests/run.sh
```

자주 걸리는 것들:

- **`description: 'when-to-use' 트리거가 없습니다`** — 설명에 언제 쓰는지가 없습니다. 실제 사용자
  발화 예시("~해줘", "~봐줘")를 넣으세요
- **shellcheck 경고** — `validate-skill.sh`가 `scripts/*.sh`를 검사합니다. `set -euo pipefail`
  아래에서 `[[ ... ]] && cmd`는 조건이 거짓일 때 스크립트를 종료시키므로 `if` 블록을 쓰세요
- **`generate-index.sh` 가 SKILLS.md를 변경함** — 정상입니다. 변경분을 함께 커밋하세요

## 사용자 결정이 필요해진 경우

의도는 게이트에서 확정됐으므로 원칙적으로 되묻지 않습니다. 그럼에도 확정되지 않은 결정이
드러나면(예: 판정한 상호작용 모델이 실제 워크플로와 안 맞음, 기존 스킬과 트리거가 정면으로 겹침),
**추측하지 말고** 아래만 반환하고 멈춥니다:

```
NEEDS_DECISION
question: <구체적인 질문 하나>
options:
  - label: <선택지>
    consequence: <트레이드오프>
recommended: <선택지 또는 없음>
why: <한 문장>
```

게이트가 사용자에게 묻고 `SendMessage`로 이 에이전트를 재개시킵니다.
서브에이전트에는 사용자에게 직접 묻는 도구가 없으므로, 직접 묻지 마세요.

## 반환 형식

주 대화로 돌아가는 유일한 창구이므로 짧게 유지합니다. 파일 내용을 붙여넣지 마세요.

- **생성 경로** — `skills/<category>/<name>/`
- **판정** — 상호작용 모델과 파생된 `context`/`agent`/`background`, 근거 한 줄
- **검증 결과** — 통과한 검증기 목록. 하나라도 실패했으면 무엇이 왜 실패했는지
- **사람이 채워야 할 곳** — 남겨둔 판단이 있으면 파일과 위치. 없으면 "없음"
- **다음 단계** — 트리거 정확도를 다듬거나 평가를 돌리려면 `/skill-creator`로 이어가면 된다고 안내
