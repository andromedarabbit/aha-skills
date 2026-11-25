#!/bin/bash
set -euo pipefail
skill_dir="$(cd "$(dirname "$0")/../.." && pwd)"
skill="$skill_dir/SKILL.md"
for text in 'name: git-restic-backup' 'context: inline' 'git rev-parse --show-toplevel' '목적지에 내장 기본값은 없다' '이름을 바꾸거나 폴더를 덧붙이지 않는다' '자동 설치' '실제 SMB 파일시스템' '로컬 경로에 대신 쓰지 않는다' '동명 원본' 'symlink' '종료코드 3' '스냅샷이 없거나' '별도 승인' '--repo' '같은 셸' 'backup --json' '비밀번호 자체는 파일이나 대화에 쓰지 않는다' '실행 직전 재확인' 'Git 공통 디렉터리' '절대 경로 Git 포인터' '서브모듈' 'objects/info/alternates'; do
  if ! grep -Fq -- "$text" "$skill"; then
    printf '계약 누락: %s\n' "$text" >&2
    exit 1
  fi
done
if grep -Fq -e 'restic:restic' -e 'restic@magnus-agent-skills' \
  "$skill" "$skill_dir/README.md" "$skill_dir/docs/GUIDELINES.md"; then
  printf '외부 restic 스킬 의존성이 사용 지침에 남아 있습니다.\n' >&2
  exit 1
fi
if grep -Fiq 'workspace' "$skill" "$skill_dir/README.md"; then
  printf 'Workspace 원본 제한 또는 이전 스킬 이름이 사용 지침에 남아 있습니다.\n' >&2
  exit 1
fi
printf '스킬 안전 계약 검사 통과\n'
