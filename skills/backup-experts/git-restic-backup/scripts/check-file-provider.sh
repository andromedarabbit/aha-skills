#!/usr/bin/env bash
# File Provider 목적지의 읽기 전용 증거 확인. 쓰기·인증·설치 없음.
# 사용: check-file-provider.sh <대상 경로> <사용자가 승인한 CloudStorage 도메인 디렉터리 이름>
# 종료코드 0 = 아래 증거 충족, 그 외 = 중단. 신규 대상이 아직 없으면 기존 상위 경로를 넘긴다. 계정 신원 자체는 증명하지 않는다(사용자 확인이 별도로 필요).
set -euo pipefail
fail() { printf '중단: %s\n' "$1" >&2; exit 2; }
[ "$#" -eq 2 ] || fail '인자: <대상 경로> <승인한 도메인 디렉터리 이름>'
command -v fileproviderctl >/dev/null 2>&1 || fail 'fileproviderctl을 찾을 수 없어 File Provider 증거를 확인할 수 없다'
root="$(cd "$HOME/Library/CloudStorage" 2>/dev/null && pwd -P)" || fail 'CloudStorage 디렉터리를 확인할 수 없다'
# 없는 마지막 디렉터리는 허용하지 않는다: 존재하는 항목만 증거 대상이다.
target="$(cd "$1" 2>/dev/null && pwd -P)" || fail '대상 경로가 없거나 물리 경로를 확인할 수 없다'
case "$target/" in
  "$root/$2/"*) ;;
  *) fail '대상의 물리 경로가 승인한 CloudStorage 도메인 아래에 있지 않다' ;;
esac
[ -d "$root/$2" ] || fail '승인한 도메인 디렉터리가 없다'
if ! out="$(fileproviderctl evaluate "$target" 2>&1)"; then
  fail 'File Provider가 이 경로를 항목으로 인식하지 않는다(일반 폴더이거나 연결되지 않음)'
fi
# 출력 형식은 문서화된 계약이 아니다(macOS 버전에 따라 바뀔 수 있음). 2026-11 실측 구조만 보수적으로 요구하고, 하나라도 어긋나면 중단한다.
first="$(printf '%s\n' "$out" | sed -n '1p')"
[ "$first" = 'Evaluating actions against {' ] || fail '예상한 평가 출력 형식이 아니다(첫 줄 불일치 또는 경고 출력)'
case "$out" in
  *'No item for URL'*|*NSFileProviderErrorDomain*|*'Error:'*) fail 'File Provider 평가가 오류를 반환했다' ;;
esac
printf '%s\n' "$out" | grep -Eq '^    fileproviderItems = +\($' || fail 'fileproviderItems 블록이 없다'
[ "$(printf '%s\n' "$out" | grep -Ec '^ +itemIdentifier = ')" -eq 1 ] || fail '평가된 항목이 정확히 하나가 아니다(빈 items 포함)'
for key in isUploaded isUploading filename; do
  printf '%s\n' "$out" | grep -Eq "^ +$key = " || fail "필수 필드 $key 가 없다(형식 변경 가능)"
done
printf 'File Provider 항목 인식 확인(제공자·계정 신원은 미증명, 출력 형식은 비계약 실측 기준)\n'
