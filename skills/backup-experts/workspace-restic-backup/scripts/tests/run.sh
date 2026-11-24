#!/bin/bash
set -euo pipefail
skill="$(cd "$(dirname "$0")/../.." && pwd)/SKILL.md"
for text in 'context: inline' 'restic:restic' '자동 설치' '실제 SMB 파일시스템' '동명 원본' 'symlink' '종료코드 3' '스냅샷이 없거나' '별도 승인' 'RESTIC_REPOSITORY_FILE' '비밀번호 자체는 파일이나 대화에 쓰지 않는다' '실행 직전 재확인'; do
  if ! grep -Fq "$text" "$skill"; then
    printf '계약 누락: %s\n' "$text" >&2
    exit 1
  fi
done
printf '스킬 안전 계약 검사 통과\n'
