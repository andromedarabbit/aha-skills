# 상류 출처

이 저장소의 `tools/`·`docs/`·`skills/meta-experts/skill-author`는 별도의 상류 저장소에서
이식했다. (호스트·URL은 기록하지 않는다 — 비공개 주소이고 자동 동기화도 없다)

- **이식 기준 커밋**: `8309d93`
- **이식 일자**: 2026-08-04

## 의도적 차이 (상류와 다르게 유지)

상류와의 diff를 다시 적용할 일이 생기면 충돌은 아래 다섯 곳에서만 난다. 나머지는 깨끗하게 붙는다.

1. **`tools/validate-ci-yaml.sh` + `tools/test-validate-ci-yaml.sh` 미이식**
   GitLab CI 전용 검사기다. `script:` 리스트 항목이 문자열이 아니라 매핑으로 파싱되는
   실패 모드를 잡는데, GitHub Actions의 `run:`은 리스트 항목이 아니라 키 아래 스칼라라서
   그 실패 모드가 존재하지 않는다. 워크플로 의미 검증이 필요해지면 `actionlint`를 쓰세요 —
   GitHub-native 등가물이고 이 검사기가 원리적으로 못 잡던 것까지 잡는다.

2. **`tools/validate-matchers.sh` — 훅 0건 하드페일 완화**
   상류는 `checked == 0`(파싱된 tool matcher 0건) 자체를 실패로 봤다. 훅을 쓰는 스킬이
   항상 여러 개 있는 저장소에서는 그게 곧 "파서가 깨졌다"였기 때문이다.
   이 저장소는 훅 없는 스킬 하나로 시작할 수 있어서 — `skill-author`는 `hooks:`가 없고,
   훅 예제를 품은 `assets/`는 스캔에서 제외된다 — 그 등식이 성립하지 않는다.
   가드의 원래 의도인 "선언했는데 안 잡힌다"를 조건에 그대로 옮겼다:
   `declaring > 0 and checked == 0`. 회귀 테스트 `no-hooks` 케이스가 이 동작을 고정한다.

3. **`.pre-commit-config.yaml` — `validate-hook-paths`·`validate-body-paths` 훅 추가**
   상류는 이 둘을 CI 전용으로 뒀다(여러 플러그인 저장소에서 전체 스캔 시간 때문). 스킬이
   몇 개뿐인 저장소에서는 1초도 안 걸리고, 둘 다 stdlib python3만 쓴다. 이걸 pre-commit에
   넣어야 `pre-commit run --all-files` 한 줄이 진짜 end-to-end 검증이 된다.

4. **CI — GitLab CI → GitHub Actions**
   `.gitlab-ci.yml`·`.gitlab/ci/`를 `.github/workflows/validate.yml`로 대체했다.
   상류 CI의 `yq`(SHA-256 검증 설치)·`bun`(버전 단언) 설치 블록은 옮기지 않았다 —
   이식 대상에 실제 사용처가 0건이고, 필요했던 건 이식하지 않은 다른 스킬들이다.
   남은 외부 의존성은 PyYAML과 bats 둘뿐이다.

5. **`tools/validate-gate-context.sh` — 상류 재구현 추가**
   상류에 있는 검증기(allowed-tools에 `AskUserQuestion`이 있으면 `context: inline`을 강제)가
   이식 시 누락됐다. 상류 접근이 불가능해 기존 검증기 패턴(python3 heredoc + frontmatter
   파싱)에 맞춰 새로 작성했고, pre-commit 훅·CI 스텝·회귀 테스트를 함께 붙였다. 상류에서
   다시 가져올 일이 생기면 이 항목은 차이가 아니라 동기화 대상이 된다.
