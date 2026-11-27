#!/bin/bash
set -euo pipefail
skill_dir="$(cd "$(dirname "$0")/../.." && pwd)"
skill="$skill_dir/SKILL.md"
for text in 'name: git-restic-backup' 'context: inline' 'git rev-parse --show-toplevel' '목적지에 내장 기본값은 없다' '이름을 바꾸거나 폴더를 덧붙이지 않는다' '자동 설치' '실제 SMB 파일시스템' '로컬 경로에 대신 쓰지 않는다' '동명 원본' 'symlink' '종료코드 3' '스냅샷이 없거나' '별도 승인' '--repo' '같은 셸' 'backup --json' '비밀번호 자체는 파일이나 대화에 쓰지 않는다' '실행 직전 재확인' 'Git 공통 디렉터리' '절대 경로 Git 포인터' '서브모듈' 'objects/info/alternates' 'File Provider' '서버 업로드 완료' '다른 계정으로 대신 쓰지 않는다' '`df`가 기반 APFS만' 'check-file-provider.sh' '계정 신원을 증명하지 않는다' '도메인·연결 상태를 식별할 수 없는 경우'; do
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
# File Provider 증거 스크립트 동작 테스트: 임시 HOME + 가짜 fileproviderctl만 사용한다.
chk="$skill_dir/scripts/check-file-provider.sh"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/fp-test.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/home/Library/CloudStorage/ProviderA-user1/Drive/dest" "$tmp/home/Library/CloudStorage/ProviderA-user2/Drive" "$tmp/plain/dest"
cat > "$tmp/bin/fileproviderctl" <<'STUB'
#!/bin/bash
# 가짜: FP_MODE=ok 정상 / reject 항목 없음(비영) / errtext 코드 0이지만 오류 문구 / empty 빈 출력
emit() { # 합성 출력: $1=헤더줄 $2=항목 수 $3=identifier 줄 포함 여부
  echo "$1"; echo "    fileproviderItems =     ("
  for _ in $(seq "$2"); do
    echo "                {"; echo "            filename = \"x\";"
    echo "            isUploaded = 1;"; echo "            isUploading = 0;"
    [ "$3" = no ] || echo "            itemIdentifier = fake;"
    echo "        }"
  done
  echo "    );"; echo "}"
}
H='Evaluating actions against {'
case "${FP_MODE:-ok}" in
  ok) emit "$H" 1 yes ;;
  reject) echo "No item for URL" >&2; exit 1 ;;
  errtext) echo "Error: Error Domain=NSFileProviderErrorDomain Code=-1005" ;;
  empty) : ;;
  warn) echo "unexpected warning" ;;
  warnfirst) echo "warning: x"; emit "$H" 1 yes ;;
  noitems) emit "$H" 0 yes ;;
  noident) emit "$H" 1 no ;;
  twoitems) emit "$H" 2 yes ;;
  newformat) emit "Evaluating v2 {" 1 yes ;;
esac
STUB
chmod +x "$tmp/bin/fileproviderctl"
run_chk() { HOME="$tmp/home" PATH="$tmp/bin:$PATH" FP_MODE="$1" bash "$chk" "$2" "$3" >/dev/null 2>&1; }
expect_ok() { run_chk "$@" || { printf 'File Provider 정상 사례가 중단됨: %s\n' "$*" >&2; exit 1; }; }
expect_stop() { if run_chk "$@"; then printf 'File Provider 위험 사례가 통과함: %s\n' "$*" >&2; exit 1; fi; }
cs="$tmp/home/Library/CloudStorage"
expect_ok ok "$cs/ProviderA-user1/Drive/dest" ProviderA-user1
expect_stop reject "$cs/ProviderA-user1/Drive/dest" ProviderA-user1   # 연결 실패·항목 없음
expect_stop errtext "$cs/ProviderA-user1/Drive/dest" ProviderA-user1
expect_stop empty "$cs/ProviderA-user1/Drive/dest" ProviderA-user1
for m in warn warnfirst noitems noident twoitems newformat; do  # 종료 0이지만 구조가 어긋난 출력
  expect_stop "$m" "$cs/ProviderA-user1/Drive/dest" ProviderA-user1
done
expect_stop ok "$tmp/plain/dest" ProviderA-user1                       # CloudStorage 밖의 같은 이름 일반 폴더
expect_stop ok "$cs/ProviderA-user2/Drive" ProviderA-user1             # 계정 변경
expect_stop ok "$cs/ProviderA-user1/Drive/missing" ProviderA-user1     # 없는 대상
if HOME="$tmp/home" PATH="/usr/bin:/bin" bash "$chk" "$cs/ProviderA-user1/Drive/dest" ProviderA-user1 >/dev/null 2>&1; then
  printf 'fileproviderctl 부재인데 통과함\n' >&2; exit 1
fi
printf '스킬 안전 계약 검사 통과\n'
