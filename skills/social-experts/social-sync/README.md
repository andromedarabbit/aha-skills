# social-sync

X·Facebook·Threads·Bluesky 중 한 곳에만 올라온 글을 나머지 플랫폼으로 자동 동기화하는 orca 정기 자동화 스킬입니다.

## 동작 방식

1. **precheck(토큰 0)** — orca automation이 주기적으로 LLM 없는 게이트(`scripts/sync_gate.py scan --gate`)를 돌립니다. 게이트는 ego-browser로 소스 플랫폼을 읽고, 마지막 확인 시점(워터마크)부터 지금까지의 새 글을 찾습니다. 새 글이 없으면 조용히 건너뜁니다(비용 0).
2. **tick(에이전트 기상)** — 새 글이 있을 때만 에이전트가 깨어나 사진 수집(`fetch-media`)·글자수 초과 스레드 분할까지 초안을 준비하고 보고합니다. **게시는 하지 않습니다.**
3. **approve(사람 승인)** — `/social-sync approve`로 대기 초안을 승인하면 social-posting의 승인 훅 영수증 경유로 게시됩니다. 초안은 원문 그대로이며 승인 전에 수정할 수 있습니다.

## 빠른 시작

```bash
/social-sync setup   # 소스 플랫폼·첫 실행 며칠·주기를 묻고 automation을 --disabled로 등록
```

설정 데이터는 `~/.config/social-sync/config.json`, 동기화 상태는 `~/.local/state/social-sync/state.json`에 있습니다.

## 요구 사항

- ego lite(ego-browser CLI) + node 24+ — social-posting과 동일
- uv, jq
- orca CLI (automation 등록)
- social-posting의 ego 바인딩(`ego-post.mjs setup` 완료 상태)

## 제약

- Threads는 실환경 게시 검증 전까지 동기화 대상에서 제외됩니다.
- 리플라이·인용·리트윗·스레드 후속 글은 동기화하지 않습니다.
- 무인 세션은 절대 게시하지 않습니다 — 게시는 항상 사람 승인을 거칩니다.

상세 동작은 SKILL.md를, 상태·초안 형식은 `../social-posting/assets/state-schema.md`를 참고하세요.
