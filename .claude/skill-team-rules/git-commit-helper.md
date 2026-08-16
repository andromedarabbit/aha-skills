---
source_hash: e8957540e46c0e5bd53ce839c060b2bc35bff83440523adbb20be472e842cfa9
skill: git-commit-helper
extracted_at: 2026-08-16
sources:
  - CLAUDE.md
---

# aha-skills 커밋 팀 룰

- 커밋 메시지는 Conventional Commits 형식 준수 (`feat:`, `fix:`, `chore:` 등), **한국어**로 작성한다.
- 커밋 전 검증: `pre-commit run --all-files && ./tools/run-all-tests.sh && git diff --exit-code`
- `generate-index.sh`가 SKILLS.md 드리프트를 만들지 않았는지 `git diff --exit-code`로 확인한다.
- 마크다운 코드블록에는 언어를 지정한다.
