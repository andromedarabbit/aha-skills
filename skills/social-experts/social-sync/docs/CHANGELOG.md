# Changelog

## 0.1.0 (2026-11-19)

- 최초 버전. X·Facebook·Threads·Bluesky 상호 크로스포스트 동기화.
- LLM 없는 precheck 게이트(`sync_gate.py scan --gate`, exit 0/1/2 + 6시간 오류 기상 백오프).
- 플랫폼별 워터마크·글 상태·동기화 매핑(pairs)·승인 대기 큐(pending) 상태.
- gate shim(`~/.config/social-sync/gate.sh`)과 orca automation 등록 스크립트(항상 `--disabled`).
- setup / tick / approve / status 모드. 게시는 social-posting 승인 훅 계약("게시 승인"/"게시")을 재사용.
- Threads는 실환경 게시 검증 전까지 대상 제외(`threadsVerified`).
