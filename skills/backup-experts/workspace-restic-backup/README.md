# workspace-restic-backup

선택한 Workspace Git 저장소를 SMB에 원본별 독립 restic 저장소로 수동 백업합니다. 기본적으로 숨김 파일과 민감정보도 포함합니다.

## 사용 방법

`/backup-experts:workspace-restic-backup`을 호출하거나 “Workspace 저장소 백업해줘”라고 요청하세요. 최초 설정, 범위, 신규 저장소 초기화는 각각 확인합니다. 백업 성공은 복원 성공의 증거가 아닙니다.

## 요구사항과 문제 해결

restic, 1Password CLI, 접근 가능한 SMB 마운트와 `restic:restic` 스킬이 필요합니다. 범용 스킬이 없으면 `restic@magnus-agent-skills` 설치를 별도 승인한 뒤 사용자가 진행해야 합니다. 이 스킬은 설치하지 않습니다. 해당 외부 스킬의 설치와 호출은 검증되지 않았습니다.

마운트·인증 실패, 빈 기존 저장소, 원본 불일치 또는 잠금이 생기면 중단합니다. 자동 초기화·잠금 해제·삭제는 하지 않습니다. 설정은 `~/.claude/skill-team-rules/workspace-restic-backup.md`에 비밀번호 없이 개인적으로 관리합니다.

## 실행 방식

- 상호작용 모델: `highrisk` — 고위험·비가역 게이트 다수 → context: inline
- `context: inline`

판정 근거는 [Context 선택 판단표](../../../docs/skill-specification.md)를 따릅니다.
