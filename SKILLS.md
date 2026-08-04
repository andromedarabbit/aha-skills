# 스킬 인덱스

이 저장소에 포함된 모든 스킬의 카테고리별 인덱스입니다.

## meta-experts

### [skill-author](skills/meta-experts/skill-author)

**버전**: 1.2.1

이 저장소(aha-skills)에 새 에이전트 스킬을 추가합니다. 상호작용 모델을 판정해 context/agent/background/WORKER.md를 파생시키고, 저장소 관례(카테고리 kebab-case, language korean, docs/INDEX.md, 훅 matcher 규칙, scripts/tests/run.sh)에 맞는 파일 일습을 만든 뒤 실제 내용까지 채우고 검증기까지 돌립니다. "스킬 만들어줘", "새 스킬 추가해줘", "이 작업을 스킬로 만들자", "/skill-author" 요청이 있을 때, 또는 반복 작업을 스킬로 굳히자는 이야기가 나올 때 사용하세요. skills/ 아래에 새 디렉토리를 만드는 일이면 이 스킬을 쓰세요 — 범용 skill-creator는 이 저장소의 판정표와 검증기를 모르므로 여기서 만든 뒤 평가·트리거 최적화가 필요할 때 넘깁니다. 기존 스킬 수정·리뷰·평가에는 쓰지 않습니다.

- [문서](skills/meta-experts/skill-author/README.md)
- [구현 가이드](skills/meta-experts/skill-author/docs/GUIDELINES.md)
- [레퍼런스](skills/meta-experts/skill-author/docs/REFERENCE.md)



---
*이 파일은 `tools/generate-index.sh`에 의해 자동 생성되었습니다*
