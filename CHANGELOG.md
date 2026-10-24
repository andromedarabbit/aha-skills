# Changelog

이 저장소의 변경 사항을 기록합니다. 버전은 `.claude-plugin/marketplace.json`의
`metadata.version`을 따릅니다.

## 0.2.0 — 2026-10-24

### 변경됨

- **코드 리뷰 발견 전건 적용.** 독립 교차모델 심사를 포함한 7렌즈 리뷰가 낸 12건 중 맞는 발견을 모두 고쳤다: (1) run-all-tests의 공유 bats 라벨 슬래시가 로그 경로를 깨뜨려 스위트가 미실행·통과로 집계되던 결함 + 빈 SUITES 배열이 bash 3.2에서 크래시하던 결함(회귀 테스트 3케이스 추가), (2) CI checks에 validate-python-scripts 단계 추가 — "검증기 전량" 주장을 참으로, (3) skill-author 템플릿·scaffold·표준 문서 4종에 남아 발동 불가 frontmatter `hooks:`를 가르치던 예시를 hooks.json 형식으로 일괄 전환하고 validate-skill이 frontmatter 훅을 경고하도록 전환, (4) hooks.json 검증 확장 3곳의 회귀 테스트 신설(validate-matchers 7케이스·validate-hook-paths 5케이스), (5) check-drafts.py 실행 비트 부여·requirements.txt 제거(의존성 단일 출처), (6) 회귀 테스트 10종 등 문서 수치 정정, (7) frontmatter 훅 실측의 재현 절차를 UPSTREAM.md에 기록
- **훅 등록 경로를 frontmatter `hooks:`에서 카테고리 `hooks/hooks.json`으로 전환**. frontmatter 훅 선언은 하네스에서 발동되지 않는다(상류 2026-10-08 실측, 본 저장소 프로브 재현 2026-10-24 — 같은 조건에서 frontmatter 훅 미발동, hooks.json 훅 발동). 이 버그로 social-posting의 승인 영수증 훅이 발동하지 않고 있었으므로 hooks.json으로 이관했다
- `validate-skill`이 hooks/hooks.json 참조를 훅 정의로 인정하고, `validate-matchers`가 hooks.json의 이벤트·matcher를 검증하며, `validate-hook-paths`가 hooks.json의 command 경로를 검증한다 (validate-skill·validate-matchers는 상류 수정 이식, hook-paths는 자체 확장)
- social-posting을 0.8.0으로 올렸다 (훅 이관)
- **Python 진입점 의존성 표준을 PEP 723(uv 스크립트) 방식으로 전환**. `tools/validate-python-scripts.py`와 회귀 테스트를 상류에서 이식해 pre-commit에 등록했고, python3 셔뱅 + 서드파티 import인 "반쪽 상태"를 잡는다. CLAUDE.md·skill-specification의 uvx+requirements.txt 안내를 정정했고 social-posting의 check-drafts.py를 uv 스크립트로 마이그레이션했다
- `run-all-tests.sh`를 스위트 단위 병렬 실행(TEST_JOBS, 기본 4)으로 바꾸고 회귀 테스트를 붙였다 (상류 개념 이식·적응)
- 잔존 사내 참조 3곳을 보편화했다 (record-approval.sh·receipt.sh·docs/solutions)

## 0.1.0 — 2026-08-04

### 추가됨

- 저장소 초기화. 검증기 15종·표준 문서 7종·`skill-author` 스킬을 상류 저장소에서 이식했습니다. 출처와 기준 커밋은 [docs/UPSTREAM.md](docs/UPSTREAM.md) 참조
- `meta-experts` 카테고리와 `skill-author` 스킬
- pre-commit 훅 15개 (검증기 8종 + 표준 훅 6종 + 셸 권한 보정)
- GitHub Actions 검증 워크플로 (`checks`·`tests` 두 잡)

### 변경됨 (상류 대비)

- `tools/validate-ci-yaml.sh`와 그 회귀 테스트를 이식하지 않았습니다 — GitLab CI 전용 검사기이고, GitHub Actions에는 이 검사기가 잡는 실패 모드가 없습니다
- `tools/validate-matchers.sh`의 훅 0건 하드페일을 완화했습니다. 상류는 `checked == 0` 자체를 실패로 봤는데, 훅 없는 스킬 하나로 시작하는 저장소에서는 첫 실행부터 빨간불이 됩니다. 가드의 원래 의도인 "선언했는데 안 잡힌다"로 조건을 좁혔고 회귀 테스트를 붙였습니다
- `validate-hook-paths`·`validate-body-paths`를 pre-commit에 추가했습니다 (상류는 CI 전용)
