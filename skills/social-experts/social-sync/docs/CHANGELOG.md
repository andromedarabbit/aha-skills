# Changelog

## 0.1.2 (2026-11-20)

- 최초 수동 tick에서도 스캔하며, 플러그인 설치 위치에서 공용 스크립트를 찾는다. 반복 설정은 이전 상태를 덮지 않는다.
- 예약 스캔과 tick을 직렬화하고, 미처리 wake와 승인 대기 상태를 보존한다. 글마다 초안 작업을 나누고 사진은 스캔 후보 ID와 검증된 출처에서 가져온다.
- 범위를 확인하지 못한 스캔의 워터마크를 유지한다. 게시 결과를 대상별로 기록하며 일부 게시·결과 불명·중단을 자동 재시도하지 않는다.

## 0.1.1 (2026-11-20)

- wake가 없을 때 `NO_WAKE`와 마지막 스캔 결과를 반환해 미스캔과 스캔 오류를 구분한다.

## 0.1.0 (2026-11-19)

- 최초 버전. X·Facebook·Threads·Bluesky 상호 크로스포스트 동기화.
- LLM 없는 precheck 게이트(`sync_gate.py scan --gate`, exit 0/1/2 + 6시간 오류 기상 백오프).
- 플랫폼별 워터마크·글 상태·동기화 매핑(pairs)·승인 대기 큐(pending) 상태.
- gate shim(`~/.config/social-sync/gate.sh`)과 orca automation 등록 스크립트(항상 `--disabled`).
- setup / tick / approve / status 모드. 게시는 social-posting 승인 훅 계약("게시 승인"/"게시")을 재사용.
- Threads는 실환경 게시 검증 전까지 대상 제외(`threadsVerified`).
