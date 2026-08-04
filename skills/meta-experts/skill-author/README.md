# skill-author

이 저장소에 새 에이전트 스킬을 추가하는 스킬. 상호작용 모델을 판정해 실행 방식을 파생시키고,
저장소 관례에 맞는 파일 일습을 만든 뒤 실제 내용까지 채우고 검증기를 돌립니다.

## 개요

새 스킬을 만들 때 매번 반복되는 세 가지를 대신합니다.

1. **실행 방식 판정** — `context`/`agent`/`background`/`WORKER.md` 여부는 손으로 고르는 값이
   아니라 "실행 중 사용자에게 물어야 하는가"에서 파생되는 값입니다. 이걸 잘못 고르면 스킬이
   조용히 망가집니다 — 대표적으로 `fork` 스킬 본문에 "AskUserQuestion으로 묻는다"라고 적으면
   서브에이전트에는 그 도구가 없어서 아무 일도 일어나지 않습니다.
2. **저장소 관례** — 카테고리 kebab-case, `language: "korean"`, `docs/INDEX.md`, 훅 `matcher`는
   도구 이름만 매칭, `scripts/`가 있으면 `scripts/tests/run.sh`. 경로 변수는 훅과 본문이
   다릅니다 — 훅은 `"${CLAUDE_PLUGIN_ROOT}/<skill>/..."`(카테고리 없음), 본문은
   `${CLAUDE_SKILL_DIR}` 바로 뒤에 스킬 내부 경로(카테고리도 스킬 이름도 없음). 둘 다 따옴표 필수.
   딸린 문서(`docs/`·`README.md`·`WORKER.md`)는 치환을 받지 못하므로 또 다릅니다.
3. **검증** — 만든 직후 저장소 검증기를 돌려서 통과 상태로 넘깁니다.

앞의 대화형 마법사(`template/create-skill.sh`)를 대체합니다. 그 스크립트는 TTY 전용이라
Claude Code에서 직접 쓸 수 없었고, 문맥과 무관하게 9개 항목을 순서대로 물었습니다.

## 사용 방법

```
/skill-author
```

또는 그냥 "GitLab CI 로그 요약하는 스킬 만들어줘"처럼 말하면 됩니다. 대화에서 알 수 있는 값은
추론해서 채우고 확인만 받으므로, 보통 질문 한두 번으로 끝납니다.

### 동작 방식

이 스킬은 **게이트 + 워커** 구조입니다(저장소의 첫 사례).

- **게이트**(`SKILL.md`, `context: inline`) — 의도를 확정하고 Intent Contract로 압축
- **워커**(`WORKER.md`) — 생성·작성·검증을 서브에이전트에서 수행

덕분에 템플릿 본문과 검증기 출력이 주 대화에 쌓이지 않고, 짧은 요약만 돌아옵니다.

## 범용 skill-creator와의 관계

경쟁이 아니라 분담입니다.

| | `skill-creator` (범용) | `skill-author` (이 스킬) |
|---|---|---|
| 대상 | 임의 위치의 스킬 | 이 저장소 관례를 따르는 스킬 |
| 상호작용 모델 판정 | 모름 | 담당 |
| 저장소 검증기 연동 | 없음 | 담당 |
| 평가 루프·트리거 최적화 | 담당 | 위임 |

**새 스킬을 만들 때는 이 스킬을, 만든 뒤 트리거 정확도를 다듬거나 평가를 돌릴 때는
`/skill-creator`를** 쓰세요.

## 상호작용 모델

`docs/skill-specification.md`의 "Context 선택" 판단표를 그대로 씁니다.

| 모델 | 조건 | 파생 결과 |
|---|---|---|
| `none` | 실행 중 상호작용 없음 | `context: fork` |
| `dialog` | 여러 라운드 자유 서술형 대화가 핵심 | `context: inline` |
| `highrisk` | 고위험·비가역 게이트가 여러 곳 | `context: inline` |
| `gate-worker` | 조사 **전에** 의도 확정 가능 | `context: inline` + `WORKER.md` |
| `plan-apply` | 조사 의존 + 비가역 | `context: fork` (계획 산출 전용) |
| `resume` | 조사 의존 + 가역 | `context: fork` + 반환-재개 |

## 직접 실행

생성만 필요하면 코어 스크립트를 직접 부를 수 있습니다. 대화형 프롬프트가 없어 CI나 다른
스크립트에서도 씁니다.

```bash
skills/meta-experts/skill-author/scripts/scaffold.sh \
  --category gitlab-experts \
  --name gitlab-ci-log-digest \
  --description 'CI 로그를 요약합니다. "CI 왜 깨졌어" 요청이 있을 때 사용하세요.' \
  --interaction none \
  --dep 'glab>=1.38.0'
```

`--dry-run`으로 판정 결과만 먼저 볼 수 있습니다. 전체 옵션은 `--help` 또는
[docs/REFERENCE.md](docs/REFERENCE.md)를 보세요.

## 요구사항

- `bash` 3.2 이상 (macOS 기본 bash에서 동작)
- 테스트 실행 시 `bats`
- `skills/meta-experts/skill-author/assets/skill-template/` — 생성 원본. 이 디렉토리가 없으면 스크립트가 즉시 실패합니다

## 문제 해결

**생성된 스킬이 `check-frontmatter.sh`에서 떨어집니다**
설명에 "언제 쓰는지"가 없을 때 나는 오류입니다. 실제 사용자 발화 예시를 설명에 넣으세요.

**`--background false`가 거부됩니다**
`context: fork`로 파생되는 모델(`none`/`plan-apply`/`resume`)에서만 의미가 있습니다.
`inline`인 스킬은 애초에 주 대화에서 동기로 돕니다.

**이미 있는 스킬을 다시 만들려니 거부됩니다**
의도한 동작입니다. 덮어쓰려면 `--force`를 쓰되, 기존 내용이 사라진다는 점을 확인하세요.

## 추가 정보

- [문서 인덱스](docs/INDEX.md)
- [구현 가이드](docs/GUIDELINES.md)
- [레퍼런스](docs/REFERENCE.md)
- [Context 선택 판단표](../../../docs/skill-specification.md)
