# Changelog

본 스킬의 버전별 변경 사항을 시맨틱 버전닝(MAJOR.MINOR.PATCH) 기준으로 기록합니다.

## 1.2.1 — 2026-08-04

### 추가

- 사내 저장소에서 이식했습니다. 기능 변경은 없고, 저장소 이름을 참조하던 곳만 이 저장소에 맞게 고쳤습니다 — `SKILL.md`의 `description`, `scaffold.sh`의 저장소 판별 실패 메시지와 그 문구를 검사하는 `scaffold.bats`, 플러그인 캐시 경로 예시.
- `scaffold.sh`의 저장소 판별 로직 자체는 손대지 않았습니다. `tools/validate-skill.sh`와 `.claude-plugin/marketplace.json`의 **존재**만 보는 구조 기반 검사라서 저장소 이름과 무관하게 동작합니다.

이식 전 이력은 상류 저장소에 있습니다. 출처와 기준 커밋은 [docs/UPSTREAM.md](../../../../docs/UPSTREAM.md) 참조.
