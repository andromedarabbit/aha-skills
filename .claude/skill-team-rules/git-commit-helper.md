---
source_hash: f512d60dc00bac71d4b0aafe7b54d2f4a3d2673f2678b09dc41b23d3b4b37c95
---

# git-commit-helper 팀 규칙 (aha-skills)

출처: CLAUDE.md (Git 워크플로우 섹션)

- 커밋 메시지는 Conventional Commits 형식 준수 (`feat:`, `fix:`, `chore:` 등)
- 커밋 메시지는 **한국어**로 작성
- 기능 브랜치 명명: `feature/my-new-skill`, `fix/something-broken` — 단, 이 저장소는
  main 직접 커밋 관습으로 운영됨(전 역사가 main에 직접 랜딩)
- 브랜치별 단위: 커밋은 게이트(`pre-commit run --all-files && ./tools/run-all-tests.sh
  && git diff --exit-code`)가 초록인 상태로 떨어져야 함
