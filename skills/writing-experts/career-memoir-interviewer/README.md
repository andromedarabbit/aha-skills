# career-memoir-interviewer

경력 회고 에세이를 위한 저자 인터뷰를 진행한다. 한 번에 한 질문, 패러프레이즈 선행, 감정·고민 명시 질문, 세션 원문 축적과 holding 큐로 세션 간 연속성 유지. 경력 회고 인터뷰, 회고 인터뷰 시작, 인터뷰 이어서 요청으로 호출. 산문 작성·정리·초안 생성은 career-memoir-compiler 담당.

## 개요

이 스킬이 무엇인지, 어떤 문제를 해결하는지 설명합니다.

## 사용 방법

### 기본 사용법

```bash
# 기본 예시
command argument
```

### 옵션

| 옵션 | 설명 |
|------|------|
| `--option` | 옵션 설명 |

## 사용 예시

### 예시 1: 기본 사용

```bash
command --option value
```

결과:
```
출력 결과
```

### 예시 2: 고급 사용

```bash
command --advanced-option
```

## 요구사항

- 필요한 도구 1: 버전
- 필요한 도구 2: 버전

## 문제 해결

### 일반적인 문제

**문제**: 설명

**해결**: 해결 방법

## 추가 정보

- [구현 가이드](docs/GUIDELINES.md)
- [레퍼런스](docs/REFERENCE.md)

## 훅이 실행되지 않을 때

1. **matcher 확인** — `matcher`는 도구 이름(`Bash`, `Edit` 등)만 매칭합니다. 명령 내용으로
   거르려면 `if: "Bash(gh *)"`를 씁니다. `matcher: "Bash.*gh.*"`처럼 쓰면 영영 발동하지 않습니다.
2. **경로 확인** — `command`는 `"bash \"${CLAUDE_PLUGIN_ROOT}/<skill>/scripts/<script>.sh\""`
   형태여야 합니다. `${CLAUDE_PLUGIN_ROOT}`는 카테고리 설치 루트라서 경로에 카테고리를 다시
   넣으면 안 되고, CWD 기준 상대경로는 조용히 실행되지 않습니다. 훅에서
   `${CLAUDE_SKILL_DIR}`은 치환되지 않습니다.
3. **권한 확인** — 스크립트에 실행 권한이 있는지 확인합니다.

```bash
chmod +x skills/writing-experts/career-memoir-interviewer/scripts/*.sh
```

## 스크립트가 `No such file or directory`로 실패할 때

훅이 아니라 **SKILL.md 본문**의 경로 문제입니다. 본문에서는 `${CLAUDE_SKILL_DIR}`을 쓰고,
뒤에 카테고리나 스킬 이름을 붙이지 않습니다 — 이 변수가 이미 스킬 디렉토리 자체입니다. 쓸 형태는
`SKILL.md`의 "스크립트 경로 (먼저 읽을 것)" 절에 그대로 있습니다.

CWD 기준 상대경로는 플러그인으로 설치된 환경에 존재하지 않아 첫 호출부터 실패합니다.

이 README처럼 **딸린 문서**에서는 `${CLAUDE_SKILL_DIR}`을 경로로 쓸 수 없습니다 — 치환은 SKILL.md
본문과 `allowed-tools`에서만 일어나고, 딸린 문서는 누가 읽든 Read 도구로 읽혀 날문자로 남습니다.
사람이 셸에서 직접 돌릴 예시는 `$SKILL_DIR`을 쓰고, 그 값을 정하는 방법을 문서에 함께 적으세요:

```bash
# 플러그인으로 설치했다면 (경로 해시는 설치 시점마다 다릅니다)
SKILL_DIR=$(ls -d ~/.claude/plugins/cache/aha-skills/<category>/*/<career-memoir-interviewer> | tail -1)

# 이 저장소를 클론해 쓴다면
SKILL_DIR=<clone 경로>/skills/<category>/<career-memoir-interviewer>

bash "$SKILL_DIR/scripts/<script>.sh"
```

## 실행 방식

- 상호작용 모델: `dialog` — 자유형 대화가 핵심 → context: inline
- `context: inline`

판정 근거는 [Context 선택 판단표](../../../docs/skill-specification.md)를 따릅니다.
