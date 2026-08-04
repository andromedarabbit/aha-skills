# 상류 출처

이 저장소의 `tools/`·`docs/`·`skills/meta-experts/skill-author`는 사내 저장소 `oh-my-skills`에서
이식했습니다. (호스트·URL은 기록하지 않습니다 — 사내 주소입니다)

- **이식 기준 커밋**: `8309d93`
- **이식 일자**: 2026-08-04

## 의도적 차이 (상류와 다르게 유지)

상류에서 수정 사항을 가져올 때 충돌은 아래 네 곳에서만 납니다. 나머지는 깨끗하게 붙습니다.

1. **`tools/validate-ci-yaml.sh` + `tools/test-validate-ci-yaml.sh` 삭제**
   GitLab CI 전용 검사기입니다. `script:` 리스트 항목이 문자열이 아니라 매핑으로 파싱되는
   실패 모드를 잡는데, GitHub Actions의 `run:`은 리스트 항목이 아니라 키 아래 스칼라라서
   그 실패 모드가 존재하지 않습니다. 워크플로 의미 검증이 필요해지면 `actionlint`를 쓰세요 —
   GitHub-native 등가물이고 이 검사기가 원리적으로 못 잡던 것까지 잡습니다.

2. **`tools/validate-matchers.sh` — 훅 0건 하드페일 완화**
   상류는 `checked == 0`(파싱된 tool matcher 0건) 자체를 실패로 봤습니다. 훅을 쓰는 스킬이
   항상 여러 개 있는 저장소에서는 그게 곧 "파서가 깨졌다"였기 때문입니다.
   이 저장소는 훅 없는 스킬 하나로 시작할 수 있어서 — `skill-author`는 `hooks:`가 없고,
   훅 예제를 품은 `assets/`는 스캔에서 제외됩니다 — 그 등식이 성립하지 않습니다.
   가드의 원래 의도인 "선언했는데 안 잡힌다"를 조건에 그대로 옮겼습니다:
   `declaring > 0 and checked == 0`. 회귀 테스트 `no-hooks` 케이스가 이 동작을 고정합니다.

3. **`.pre-commit-config.yaml` — `validate-hook-paths`·`validate-body-paths` 훅 추가**
   상류는 이 둘을 CI 전용으로 뒀습니다(19플러그인 저장소에서 전체 스캔 시간 때문). 스킬이
   몇 개뿐인 저장소에서는 1초도 안 걸리고, 둘 다 stdlib python3만 씁니다. 이걸 pre-commit에
   넣어야 `pre-commit run --all-files` 한 줄이 진짜 end-to-end 검증이 됩니다.

4. **CI — GitLab CI → GitHub Actions**
   `.gitlab-ci.yml`·`.gitlab/ci/`를 `.github/workflows/validate.yml`로 대체했습니다.
   상류 CI의 `yq`(SHA-256 검증 설치)·`bun`(버전 단언) 설치 블록은 옮기지 않았습니다 —
   이식 대상에 실제 사용처가 0건이고, 필요했던 건 이식하지 않은 다른 스킬들입니다.
   남은 외부 의존성은 PyYAML과 bats 둘뿐입니다.

## 상류 수정 가져오기

`git submodule`·`git subtree`는 쓰지 않습니다. submodule URL은 저장소에 커밋되므로 사내
호스트명이 공개되고, GitHub Actions 러너는 그 호스트에 도달하지 못해 checkout이 실패합니다.
subtree pull은 상류 커밋 메타데이터(작성자·MR 번호·사내 장애를 서술한 커밋 본문)를 이 저장소
히스토리로 그대로 옮깁니다. 평문 diff에는 그 메타데이터가 없습니다.

```bash
# 사내 체크아웃에서
git -C <work-checkout> fetch origin
git -C <work-checkout> diff 8309d93..origin/main -- tools/ docs/ > /tmp/upstream.patch

# 이 저장소에서 — 먼저 읽고, 그 다음 적용
git apply --stat /tmp/upstream.patch      # 무엇이 바뀌는지 먼저 본다
git apply --3way /tmp/upstream.patch      # 충돌은 위 네 곳에만 난다
```

적용 후 이 문서의 기준 커밋을 갱신하고 검증을 돌리세요:

```bash
pre-commit run --all-files && ./tools/run-all-tests.sh && git diff --exit-code
```

## 아직 남은 정리 작업

`docs/*.md` 7개는 **사내 참조를 그대로 둔 채 verbatim 이식**했습니다. `git.baemin.in`·
`wcr.baemin.in`·사내 스킬 이름(`skills/gitlab-experts/...`)·`glab` 예시가 ~132곳 남아 있습니다.
검증기 중 마크다운 링크 유효성을 보는 것은 없으므로 이 정리는 CI를 깨뜨리지 않습니다 —
순수 품질 작업입니다. **저장소를 공개로 전환하기 전에 정리하세요.**

`CONCEPTS.md`도 상류 내용(룰 바인딩 — 사내 스킬의 도메인 용어집) 그대로입니다.
`CLAUDE.md`가 `@CONCEPTS.md`로 import하고 있어서 파일 자체는 있어야 합니다.
