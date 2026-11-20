---
skill: git-commit-helper
source_hash: 646a420ee5ed886f80bf05d5008752e8fc197b8d6e493fa899f415940a8d52df
generated_at: 2026-11-15
sources:
  - CLAUDE.md
---

# git-commit-helper 팀 규칙

## 명시된 규칙 — CLAUDE.md

- 커밋 메시지는 Conventional Commits를 따른다. 예: `feat: add my new skill`, `fix: correct hook path`.
- 작업 브랜치 이름의 예: `feature/my-new-skill`, `fix/something-broken`.
- 커밋 전 `pre-commit run --all-files && ./tools/run-all-tests.sh && git diff --exit-code`로 전체 검증한다. fixer가 파일을 수정해 실패하면 깨끗해질 때까지 pre-commit을 다시 실행한다.

## 최근 커밋에서 관찰한 관습 — git log

- 제목과 본문은 대체로 한국어이며, 제목에 `fix(social-posting):`처럼 스코프를 사용한다.
- 최근 커밋에는 `Co-Authored-By: Claude Code <noreply@anthropic.com>` 푸터가 있다. 실제 attribution은 현재 세션의 지시를 따른다.
