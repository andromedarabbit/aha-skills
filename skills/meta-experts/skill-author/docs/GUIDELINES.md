# 구현 가이드라인

`skill-author` 스킬을 수정·확장할 때 참고하는 문서입니다.

## 아키텍처

```
게이트 (SKILL.md, inline)          주 대화
  ├─ 대화에서 값 추론
  ├─ AskUserQuestion 으로 남은 것만 확인
  └─ Intent Contract 로 압축
        │
        ▼  Contract 만 전달
워커 (WORKER.md, general-purpose)   서브에이전트
  ├─ scripts/scaffold.sh  ← 뼈대 + 실행 방식 파생
  ├─ 실제 내용 작성
  ├─ 저장소 검증기 실행
  └─ 짧은 요약 반환
        │
        ▼  요약만
      주 대화
```

## 왜 게이트 + 워커인가

판단표를 이 스킬 자신에게 적용한 결과입니다.

1. 실행 중 물어야 하는가 → **예** (카테고리·이름·설명·상호작용 모델)
2. 여러 라운드 자유 서술형 대화가 핵심인가 → **아니오**
3. 고위험·비가역 게이트가 여러 곳인가 → **아니오** (파일 생성은 되돌릴 수 있습니다)
4. 그 질문을 조사 전에 확정할 수 있는가 → **예** → `gate-worker`

2번에서 걸리지 않는 이유를 분명히 해둡니다. 인터뷰가 여러 라운드일 수는 있지만 `dialog` 갈래는
**대화와 실행이 뒤섞이는** 경우를 말합니다(`de-work`의 장별 제안→작성→피드백→수정). 여기서는
인터뷰가 끝난 **뒤에** 생성이 시작되므로 의도를 앞에서 확정할 수 있습니다.

## 4번의 "질문"은 입력이지 승인이 아니다

판정 순서가 4번(사전 확정 가능 → `gate-worker`)을 5번(비가역 → `plan-apply`)보다 먼저 묻기 때문에,
승인 질문을 4번에 넣으면 비가역 갈래로 가지 못하고 `gate-worker`로 빠져나갑니다. 그러면 승인이 Intent
Contract에 미리 담기고, 워커는 무엇이 바뀌는지 사용자에게 보여주기 **전에** 승인을 얻은 상태로 쓰기를
실행합니다.

`add-team-member`를 판정표에 걸어보면 바로 드러납니다. "alice를 review-team에 추가할까요?"는
사용자가 준 인자에서 그대로 나오는 문장이라 4번이 "예"처럼 보이지만, 그 승인은 권한을 실제로
바꾸는 비가역 결정입니다.

그래서 4번은 **실행에 필요한 입력**(대상 기간·계정·범위·이름·태그)만 봅니다. 승인은 그 지점까지
진행한 뒤 워커가 `NEEDS_DECISION`으로 되묻습니다 —
`deploy-prod-cluster`가 입력 7개는 게이트에서 받고 prod 쓰기 승인만 Step 4 dry-run
뒤로 미루는 방식이 이 구분의 참조 구현입니다.

## 판정 로직은 한 곳에만

`interaction` → `context`/`agent`/`background`/`WORKER.md` 파생은 **`scripts/scaffold.sh`에만**
있습니다. 문서(`docs/skill-specification.md`)는 표로 설명하고, 스크립트가 그 표를 집행합니다.

워커가 파일을 직접 만들면 안 되는 이유가 이것입니다. 편해 보이지만 그 순간 판정 로직이 두 벌이
되고, 한쪽만 고쳐지는 건 시간 문제입니다. 이 저장소는 같은 실수를 이미 겪었습니다 — 해시 계산
로직이 두 스크립트에 각각 구현돼 값이 갈리면서 영구 재추출 루프가 났습니다.

같은 이유로 템플릿 원본도 `skills/meta-experts/skill-author/assets/skill-template/` 하나뿐입니다. 폐기된
`template/create-skill.sh`는 `TEMPLATE_DIR`을 정의해놓고 정작 heredoc으로 따로 생성해서,
템플릿이 두 벌인 채 이미 갈라져 있었습니다.

## scaffold.sh 확장

새 필드를 프론트매터에 추가할 때:

1. 인자 파싱에 플래그 추가
2. 검증 추가 — 잘못된 조합은 즉시 실패시킵니다(`--background`가 `inline`에서 거부되는 방식)
3. 파생 블록에서 값 계산
4. `scripts/tests/scaffold.bats`에 케이스 추가 — 참·거짓 양쪽 모두
5. 여섯 갈래 전부 생성해 `check-frontmatter.sh` + `validate-skill.sh` 통과 확인

새 상호작용 모델을 추가할 때는 위 다섯 가지에 더해 `docs/skill-specification.md`의 판단표,
`SKILL.md` 게이트의 판정 순서, `README.md`의 모델 표를 함께 고쳐야 합니다.

## 주의할 점

- **`set -euo pipefail` 아래에서 `[[ ... ]] && cmd`를 쓰지 마세요.** 조건이 거짓이면 목록 전체가
  0이 아닌 값을 반환해 스크립트가 종료됩니다. `if` 블록을 쓰세요. 이 스크립트를 처음 쓸 때 실제로
  밟은 함정입니다.
- **bats `@test` 이름은 ASCII로.** 한글을 쓰면 "unknown test name"으로 0개가 실행되면서 통과처럼
  보입니다.
- **`--root`는 테스트 전용이 아닙니다.** 테스트가 실제 `skills/` 트리를 건드리지 않게 하는
  장치이므로, 테스트를 추가할 때 반드시 격리된 루트를 넘기세요.
- **스크립트 위치에서 무엇도 역산하지 마세요.** 이 스킬은 플러그인으로 배포되면
  `~/.claude/plugins/cache/<마켓>/<카테고리>/<해시>/<스킬>/`에 놓이고, 저장소는 그 조상이
  아닙니다. 처음엔 `$SCRIPT_DIR/../../../..`로 저장소 루트를 잡았다가 설치본에서 통째로
  깨졌습니다(템플릿을 못 찾고 죽음). 지금은 템플릿은 **스킬 안**(`assets/`)에서, 대상 저장소는
  **`git rev-parse --show-toplevel`**로 찾습니다.
- **검증기·테스트가 이걸 못 잡습니다.** BATS가 항상 `--root`를 주입하고 검증기는 체크아웃에서만
  돌기 때문입니다. 그래서 `scaffold.bats`에 스킬을 다른 위치로 복사해 실행하는 케이스를 뒀습니다.
  배포 경로를 건드리면 그 케이스를 반드시 함께 보세요.

## 테스트

```bash
./skills/meta-experts/skill-author/scripts/tests/run.sh
```

`scaffold.bats`가 검사하는 것: 여섯 갈래의 파생 결과, `gate-worker`에서만 `WORKER.md`가 나오는지,
`--background` 조합 검증, 의존성 유무에 따른 훅 블록, 필수 파일 일습, placeholder 치환,
`--dry-run`, 덮어쓰기 가드, 입력 검증 6종.

## 참고

- [사용자 문서](../README.md)
- [레퍼런스](REFERENCE.md)
- [스킬 명세](../../../../docs/skill-specification.md)
- [프론트매터 참조](../../../../docs/frontmatter-reference.md)
