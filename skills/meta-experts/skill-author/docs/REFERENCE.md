# 레퍼런스

## scaffold.sh

스킬 뼈대를 비대화형으로 생성합니다. 상호작용 모델에서 실행 방식을 파생시키는 유일한 구현입니다.

```bash
skills/meta-experts/skill-author/scripts/scaffold.sh [options]
```

### 필수 옵션

| 옵션 | 설명 |
|---|---|
| `--category <cat>` | 카테고리. kebab-case |
| `--name <name>` | 스킬 이름. kebab-case |
| `--description <desc>` | 무엇을 하는지 + 언제 쓰는지. 1024자 이내, 줄바꿈 불가 |
| `--interaction <model>` | `none` \| `dialog` \| `highrisk` \| `gate-worker` \| `plan-apply` \| `resume` |

### 선택 옵션

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `--version <ver>` | `1.0.0` | 시맨틱 버전 |
| `--dep <spec>` | 없음 | 의존성. 반복 가능. 하나라도 있으면 훅 블록과 `example-hook.sh`가 함께 생성됨 |
| `--background false` | 없음 | `context: fork`로 파생되는 모델에서만 허용 |
| `--root <path>` | 자동 계산 | 저장소 루트. 테스트 격리용 |
| `--dry-run` | off | 파일을 만들지 않고 판정 결과만 출력 |
| `--force` | off | 대상 디렉토리가 이미 있어도 진행 |
| `-h`, `--help` | | 도움말 |

### 상호작용 모델 → 파생 결과

| `--interaction` | `context` | `agent` | `WORKER.md` | 본문 게이트 섹션 |
|---|---|---|---|---|
| `none` | `fork` | `general-purpose` | 없음 | 주의사항 |
| `dialog` | `inline` | 없음 | 없음 | `AskUserQuestion` 직접 호출 |
| `highrisk` | `inline` | 없음 | 없음 | `AskUserQuestion` 직접 호출 |
| `gate-worker` | `inline` | 없음 | **생성** | 의도 확정 + Intent Contract + 워커 실행 |
| `plan-apply` | `fork` | `general-purpose` | 없음 | 계획 산출 (읽기 전용) |
| `resume` | `fork` | `general-purpose` | 없음 | `PENDING_DECISION` 반환-재개 |

`background`는 어떤 모델에서도 자동으로 붙지 않습니다. `--background false`를 명시할 때만
프론트매터에 나타납니다. `true`는 플랫폼 기본값이라 적지 않으며, 명시하면 거부됩니다.

### 생성되는 파일

```
skills/<category>/<name>/
├── SKILL.md                      프론트매터는 파생값, 본문은 템플릿 + 게이트 섹션
├── WORKER.md                     gate-worker 인 경우에만
├── README.md                     템플릿 산문 + "실행 방식" 절(파생값)
├── docs/
│   ├── INDEX.md
│   ├── GUIDELINES.md             skills/meta-experts/skill-author/assets/skill-template/GUIDELINES.md
│   └── REFERENCE.md              skills/meta-experts/skill-author/assets/skill-template/REFERENCE.md
└── scripts/
    ├── example-hook.sh           의존성을 선언한 경우에만
    └── tests/
        ├── run.sh                범용 러너. 그대로 복사됨
        └── example.bats
```

`docs/`로 내려가는 문서는 상대 링크가 함께 보정됩니다(`](README.md)` → `](../README.md)`,
루트 문서의 `](GUIDELINES.md)` → `](docs/GUIDELINES.md)`).

### 종료 코드

| 코드 | 의미 |
|---|---|
| 0 | 성공 (`--dry-run` 포함) |
| 2 | 인자 오류 — 필수 누락, 잘못된 값, 형식 위반, 대상 디렉토리 중복 |

### 검증 규칙

- 카테고리·이름: `^[a-z0-9-]+$`
- 버전: `^[0-9]+\.[0-9]+\.[0-9]+$`
- 설명: 1024자 이내, 줄바꿈 불가 (프론트매터 한 줄이라서)
- `--background`: `false`만 허용, `context: fork`인 모델에서만
- `--interaction`: 여섯 값 중 하나
- `skills/meta-experts/skill-author/assets/skill-template/`이 없으면 즉시 실패

## 환경

| 항목 | 값 |
|---|---|
| 셸 | bash 3.2 이상 |
| 템플릿 원본 | `skills/meta-experts/skill-author/assets/skill-template/` |
| 테스트 프레임워크 | BATS |

## 참고

- [사용자 문서](../README.md)
- [구현 가이드](GUIDELINES.md)
