#!/bin/bash
# receipt.sh - 게시 승인 영수증 공용 라이브러리.
#
# 영수증은 <job-dir>/receipt.json 하나다. approved_* 세 키(approved_digests,
# approved_at, approved_via)는 record-approval.sh(PostToolUse 훅, matcher:
# AskUserQuestion)만 기록할 수 있다 — 하네스가 실제 AskUserQuestion 호출과
# 사용자 응답을 관측했을 때만 승인이 남는다(oh-my-skills gitlab-mr-creation
# MR !35 사고의 이식). 에이전트는 post-state.sh get으로 읽을 수만 있다.
#
# 승인이 게시를 여는 열쇠이므로 저장 위치가 훅과 CLI에서 같아야 한다:
#   1. SOCIAL_POSTING_RECEIPT 환경변수 (테스트·publish.sh가 사용)
#   2. SOCIAL_POSTING_JOB 환경변수가 가리키는 작업 디렉토리의 receipt.json
#   3. 포인터 파일(${TMPDIR:-/tmp}/social-posting-current-job)이 가리키는
#      작업 디렉토리의 receipt.json — post-state.sh activate가 기록한다
#
# 포인터 파일은 머신 전체에 1개뿐이라 동시에 여러 작업을 진행하면 섞인다.
# 한 번에 한 작업만 활성화해서 쓴다(REFERENCE.md 참고).

receipt_job_dir() {
  if [[ -n "${SOCIAL_POSTING_JOB:-}" ]]; then
    printf '%s\n' "$SOCIAL_POSTING_JOB"
    return 0
  fi
  local pointer="${TMPDIR:-/tmp}/social-posting-current-job"
  if [[ -f "$pointer" ]]; then
    head -1 "$pointer"
    return 0
  fi
  return 1
}

receipt_pointer_path() {
  printf '%s/social-posting-current-job\n' "${TMPDIR:-/tmp}"
}

receipt_path() {
  if [[ -n "${SOCIAL_POSTING_RECEIPT:-}" ]]; then
    printf '%s\n' "$SOCIAL_POSTING_RECEIPT"
    return 0
  fi
  local job
  job="$(receipt_job_dir)" || return 1
  printf '%s/receipt.json\n' "${job%/}"
}

# 영수증 전체를 JSON 1줄로 출력. 없으면 {}.
receipt_read() {
  local p
  p="$(receipt_path)" || return 1
  if [[ -f "$p" ]]; then
    jq -c . "$p" 2>/dev/null || printf '{}'
  else
    printf '{}'
  fi
}

# usage: receipt_get '<jq 경로>'  예) receipt_get '.approved_digests // {}'
receipt_get() {
  receipt_read | jq -r "$1"
}

# usage: receipt_set <key> <string value>
receipt_set() {
  local key="$1" value="$2" p tmp
  p="$(receipt_path)" || return 1
  tmp="$(mktemp)"
  if ! jq --arg k "$key" --arg v "$value" '.[$k] = $v' <(receipt_read) >"$tmp" 2>/dev/null; then
    rm -f "$tmp"
    return 1
  fi
  mkdir -p "$(dirname "$p")"
  mv "$tmp" "$p"
}

# usage: receipt_set_json <key> <json value>  (approved_digests 객체 등)
receipt_set_json() {
  local key="$1" json="$2" p tmp
  p="$(receipt_path)" || return 1
  tmp="$(mktemp)"
  if ! jq --arg k "$key" --argjson v "$json" '.[$k] = $v' <(receipt_read) >"$tmp" 2>/dev/null; then
    rm -f "$tmp"
    return 1
  fi
  mkdir -p "$(dirname "$p")"
  mv "$tmp" "$p"
}

receipt_unset() {
  local key="$1" p tmp
  p="$(receipt_path)" || return 1
  [[ -f "$p" ]] || return 0
  tmp="$(mktemp)"
  if ! jq --arg k "$key" 'del(.[$k])' "$p" >"$tmp" 2>/dev/null; then
    rm -f "$tmp"
    return 1
  fi
  mv "$tmp" "$p"
}

# 파일 sha256 (macOS shasum / Linux sha256sum 둘 다 지원)
hash_file() {
  local f="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$f" | awk '{print $1}'
  else
    shasum -a 256 "$f" | awk '{print $1}'
  fi
}

# 승인 시점 digest와 현재 초안 digest가 일치하는지 (Ready 판정식의 기계 판정)
# usage: receipt_digest_matches <platform>   exit 0 = 일치
receipt_digest_matches() {
  local platform="$1" current approved
  local job
  job="$(receipt_job_dir)" || return 1
  local draft="${job%/}/drafts/${platform}.md"
  [[ -f "$draft" ]] || return 1
  current="$(hash_file "$draft")"
  approved="$(receipt_get ".approved_digests[\"${platform}\"] // \"\"")"
  [[ -n "$approved" && "$approved" == "$current" ]]
}
