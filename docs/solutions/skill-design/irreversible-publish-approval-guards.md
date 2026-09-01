---
title: 비가역 게시 자동화의 승인 가드 — 다중 바인딩·페이로드 정합·기계 성공 신호
date: 2026-09-01
category: skill-design
module: social-experts/social-posting
problem_type: design_pattern
component: skill-design
severity: high
applies_when:
  - 에이전트가 되돌릴 수 없는 외부 동작(게시·배포·전송·결제)을 자동화할 때
  - 사용자 승인을 거친 후 실행 계층(외부 CLI·브라우저 에이전트)에 위임할 때
  - 승인 시점과 실행 시점 사이에 사람 개입 없는 시간차가 존재할 때
tags: [approval-gate, irreversible-action, toctou, payload-fidelity, agent-safety]
---

# 비가역 게시 자동화의 승인 가드 — 다중 바인딩·페이로드 정합·기계 성공 신호

## Context

social-posting 스킬(social-experts, 2026-09)은 aside 브라우저 에이전트로 소셜미디어에 글을 게시한다. 게시는 되돌릴 수 없는 외부 공개 행위라 "사용자 승인을 받는다"는 산문 계약 위에 스크립트 가드를 설계했다. 그런데 다중 리뷰어 + 독립 크로스모델(codex) 리뷰가 산문 계약이 지켜졌음에도 뚫리는 경로 3가지를 찾았다:

1. **계정 재타깃** — 승인 영수증이 초안 내용(sha256 digest)만 증명했다. 승인 후 job-state의 계정 매핑을 바꾸면(개인 u0 -> 사내 u1) digest는 여전히 일치하고 게시는 승인되지 않은 계정으로 향한다.
2. **검사-동결 TOCTOU** — digest 검사와 하드 제약 검사가 원본 파일에서 끝난 뒤 동결 복사가 일어났다. 그 사이 창에서 원본이 바뀌면 승인되지 않은 내용이 게시된다.
3. **stand-in 가드 불일치** — 검증·승인은 초안 파일의 frontmatter를 메타데이터로 다루지만 게시 실행("파일을 그대로 게시")은 파일 전체를 텍스트로 취급했다. 미디어 첨부는 검증만 통과하고 실행 계층에 전달되지 않았다.

## Guidance

비가역 동작의 승인 가드는 네 가지를 갖춘다. 전부 스크립트가 강제한다 — 훅은 실패해도 조용히 무시되므로 강제력을 맡기지 않는다(실제 구현: `skills/social-experts/social-posting/scripts/publish.sh`의 6중 가드, 커밋 `d8831e8`).

**1. 승인 기록 경로는 하네스 목격 유일.** 승인 사실은 실제 AskUserQuestion 도구 호출을 관측한 PostToolUse 훅만 영수증에 기록한다. 상태 CLI에서는 `approved_*` 키 set 자체가 거부된다(`post-state.sh`) — 에이전트의 자기 신고 경로를 원천 차단.

**2. 승인은 동작의 전체 매개변수를 묶는다(다중 바인딩).** digest(콘텐츠)만으로는 부족하다. 게시 대상의 모든 매개변수 중 실행 시점에 다시 읽는 값 — 계정·플랫폼·채널 — 을 승인 시점에 스냅샷으로 영수증에 남기고 실행 직전 대조한다. 하나라도 어긋나면 "재승인 필요"로 거부한다.

```yaml
approved_digests: {x: "<sha256>"}     # 콘텐츠
approved_accounts: "{x: u0}"           # 계정 매핑 — 훅만 기록
```

**3. 검증 아티팩트와 실행 페이로드를 의식적으로 정합시킨다.** 실행 계층에 넘기는 것과 검증한 것이 같은지 자문한다. 게시 페이로드는 본문만 담고(frontmatter 제거), 미디어·링크는 절대경로·alt 지시로 명시 전달한다 — 반면 승인 digest는 **원본 전체 파일** 기준을 유지해 "검증된 원본"과 "게시된 파생물"이 하나의 원본으로 묶이게 한다. 동결 직후 원본을 다시 해싱해 승인 digest와 비교하면 검사-동결 사이 TOCTOU도 같이 닫힌다.

**4. 성공 신호는 기계 감지다.** 실행 계층(자연어 에이전트)의 exit code는 성공을 증명하지 않는다. 스크립트가 출력에서 결과의 존재 증거(게시 URL `https?://`)를 grep하고, 없으면 "게시 여부 불명"으로 실패 종료한다. 침묵 실패가 사용자에게 도달하는 기계 경로를 만드는 것이 목적이다.

## Why This Matters

3가지 구멍은 모두 "승인을 받았다"는 산문 계약을 지킨 채 발생했다 — 가드가 존재하는 것과 가드가 승인을 묶는 것은 다르다. 계정 재타깃은 승인 대상(문구)과 실행 매개변수(계정)가 분리된 데서, TOCTOU는 검사와 사용 사이의 시간차에서, 페이로드 불일치는 검증 계층과 실행 계층의 추상화 차이에서 나온다. 다중 바인딩·재해싱·페이로드 분리는 각각 다른 축을 묶는다 — 하나로 다른 둘을 대체할 수 없다.

## When to Apply

- 에이전트가 외부 부수효과(게시·배포·메시지 전송·결제)를 일으키는 모든 스킬
- 실행을 자연어 에이전트·외부 CLI에 위임하는 구조 (exit code가 성공을 증명하지 않는 환경)
- 승인 시점과 실행 시점 사이에 다른 프로세스·사용자가 상태를 바꿀 수 있는 모든 흐름

## Examples

실행 직전 가드의 실제 순서(`publish.sh` 요약):

```bash
# 2. 승인 digest 존재·일치 → 3. 하드 제약 재실행 → 4. 계정은 job-state 기재값만
# 5. 승인 시점 계정 스냅샷과 대조 (계정 재타깃 차단)
approved_accounts="$(receipt_get '.approved_accounts // ""')"
[[ "$approved_accounts" == "$accounts_line" ]] || die "승인 후 계정이 변경됨 — 재승인 필요"
# 6. 본문 동결 직후 원본 전체를 다시 해싱 (TOCTOU 차단)
current_digest="$(hash_file "$DRAFT")"
[[ "$approved_digest" == "$current_digest" ]] || die "검사 후 초안 변경 감지 — 재승인 필요"
# 성공 신호: aside 출력에서 게시 URL 기계 감지, 없으면 exit 1 "게시 여부 불명"
```

가드가 실제로 막는지는 **변이 테스팅**으로 증명했다 — 가드를 삭제한 뒤에도 테스트가 통과하면 그 테스트는 가드를 실증하지 않는 것이다(리뷰가 이를 잡았고, stub이 동결 페이로드를 읽어 검증하도록 재작성했다).

## Related

- `machine-checked-doc-invariants.md` — 문서 불변식의 기계 검증. 이 문서는 그 원칙을 "동작 가드"로 확장한다
- `career-memoir-interview-pipeline.md` — 비가역 단계 앞의 기계 강제 게이트 패턴 (state SSOT + 복구)
- 구현: `skills/social-experts/social-posting/scripts/{publish.sh, record-approval.sh, post-state.sh, lib/receipt.sh}` (커밋 `d8831e8`)
