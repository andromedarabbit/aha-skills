# Changelog

이 저장소의 변경 사항을 기록합니다. 버전은 `.claude-plugin/marketplace.json`의
`metadata.version`을 따릅니다.

## 0.1.0 — 2026-08-04

### 추가됨

- 저장소 초기화. 검증기 13종·표준 문서 7종·`skill-author` 스킬을 사내 저장소에서 이식했습니다. 출처와 기준 커밋은 [docs/UPSTREAM.md](docs/UPSTREAM.md) 참조
- `meta-experts` 카테고리와 `skill-author` 스킬
- pre-commit 훅 14개 (검증기 7종 + 표준 훅 6종 + 셸 권한 보정)
- GitHub Actions 검증 워크플로 (`checks`·`tests` 두 잡)

### 변경됨 (상류 대비)

- `tools/validate-ci-yaml.sh`와 그 회귀 테스트를 이식하지 않았습니다 — GitLab CI 전용 검사기이고, GitHub Actions에는 이 검사기가 잡는 실패 모드가 없습니다
- `tools/validate-matchers.sh`의 훅 0건 하드페일을 완화했습니다. 상류는 `checked == 0` 자체를 실패로 봤는데, 훅 없는 스킬 하나로 시작하는 저장소에서는 첫 실행부터 빨간불이 됩니다. 가드의 원래 의도인 "선언했는데 안 잡힌다"로 조건을 좁혔고 회귀 테스트를 붙였습니다
- `validate-hook-paths`·`validate-body-paths`를 pre-commit에 추가했습니다 (상류는 CI 전용)
