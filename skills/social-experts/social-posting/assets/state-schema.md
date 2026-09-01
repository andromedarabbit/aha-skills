# 소셜미디어 포스팅 — 상태 스키마

이 문서는 게시 작업 상태 구조를 정의하는 **유일한 source of truth**다. SKILL.md와 docs/REFERENCE.md가 이 문서를 참조하며, 다른 어떤 파일도 상태 형식을 재정의하지 않는다. 스키마와 다른 표기·규칙을 발견하면 그쪽이 틀린 것이고 이 문서를 따른다.

- 이 파일: `assets/state-schema.md` (스킬 루트 기준 상대경로)
- 데이터가 사는 곳(사용자 데이터 — **경로는 런타임에 확정, 이 스킬은 어느 절대경로도 모른다**):
  - 소셜 루트: `<작업 루트>/social/` (호출 인자 → CWD 탐색 → 사용자 확인 순서로 확정)
  - 게시 작업: `<작업 루트>/social/<job-slug>/`
  - 활성 작업 포인터: `${TMPDIR}/social-posting-current-job` (머신 전체 1개 — 한 번에 한 작업만 활성화)

## 0. 상태의 세 주체

| 주체 | 대상 | 책임 |
| ---- | ---- | ---- |
| 에이전트 (주 대화) | job-state.md, material.md, canonical.md, drafts/, post-log.md | 작업 진행 산출물 작성·갱신 |
| record-approval.sh 훅 | receipt.json의 `approved_*` | 승인 사실 기록 (유일한 입구 — 에이전트는 set 불가) |
| publish.sh / 에이전트 | receipt.json의 `posted_*` | 게시 결과 기록 (post-state.sh set) |

## 1. 작업 디렉토리 구성

```text
<작업 루트>/social/
├── voice-profile.md            # 보이스 프로필 (voice-profile-schema.md 참조)
├── bootstrap-cache/            # 부트스트랩 원본 게시물 캐시 (플랫폼별 .md)
└── <job-slug>/                 # 게시 작업 1건 (kebab-case)
    ├── job-state.md            # 압축 상태 + 요구사항 (사람이 읽는 축)
    ├── receipt.json            # 승인·게시 영수증 (머신이 쓰는 축)
    ├── material.md             # 사실·관점·수치·고유명사 + 출처, `질문 필요` 마커
    ├── canonical.md            # canonical message
    ├── drafts/<platform>.md    # 플랫폼별 초안 (x/linkedin/facebook/bluesky)
    └── post-log.md             # 게시 URL·시각·read-back 결과
```

## 2. job-state.md frontmatter

```yaml
stage: 2          # 0(요구사항 확정) ~ 10(게시 후 검증 완료)
slug: my-post     # 작업 슬러그 (폴더명)
root:             # 작업 루트 절대경로 — 재개·이동 탐지용 (런타임에만 기록)
created: YYYY-MM-DD
updated: YYYY-MM-DD
platforms: [x, linkedin]              # flow style 필수 — publish.sh가 파싱한다
accounts: {x: u0, linkedin: u0}       # flow style 필수 — 플랫폼 → aside 프로필 식별자
source: {type: topic, topic: ...}     # 또는 {type: document, path: ...}
status: {x: draft, linkedin: draft}   # draft → ready → posted (사람용 표시)
```

요건:

- `platforms`·`accounts`·`status`는 **한 줄 flow style**(대괄호·중괄호)로 쓴다 — publish.sh가 sed로 파싱한다.
- `accounts` 값은 aside 프로필 식별자(`u0`, `u1`)만 담는다. 이메일은 aside가 무시한다.

## 3. 초안 파일 형식 (drafts/<platform>.md)

```markdown
---
platform: x
format: single            # single | thread
media:                    # 선택. 사용자가 제공한 파일만
  - path: ./image.png
    alt: 대체 텍스트
link: https://example.com # 선택. 본문에 넣을 링크
---

본문 게시 문구.

=== POST ===

(thread일 때만) 두 번째 게시물 문구.
```

요건:

- frontmatter `platform`은 파일명과 같아야 한다(불일치·파싱 불가 형식은 하드 제약 위반 — fail-closed).
- 스레드 경계는 **정확히 `=== POST ===` 한 줄**이다 — check-drafts.py가 이 경계로 게시물을 분리해 길이를 각각 검사한다.
- 본문은 게시 그대로의 문구다. **게시 실행은 본문만 전달된다**(publish.sh가 frontmatter를 제거한 페이로드를 동결하고 media/link는 지시로 전달) — 반면 승인 digest는 **초안 전체 파일**(frontmatter 포함) 기준이라 검증 대상과 게시 대상이 원본 하나로 묶인다.

## 4. receipt.json (영수증)

```json
{
  "approved_digests": {"x": "sha256...", "linkedin": "sha256..."},
  "approved_accounts": "{x: u0, linkedin: u1}",
  "approved_at": "2026-09-01T00:00:00Z",
  "approved_via": "posttooluse-hook",
  "posted_x": "https://x.com/...",
  "posted_x_at": "2026-09-01T00:05:00Z"
}
```

불변식:

- `approved_*` 네 키(digests·accounts·at·via)는 **record-approval.sh 훅만** 기록한다(PostToolUse, matcher: AskUserQuestion, header `게시 승인` 계약). post-state.sh로는 set/unset 불가다.
- `approved_accounts`는 승인 시점 job-state의 accounts flow-map 라인 원문이다 — 승인은 **초안 전체 파일 digest + 계정 매핑**을 함께 묶고, publish.sh가 두 값 모두 현재 상태와 대조한다(계정 재타깃 차단).
- `posted_<platform>`는 게시 성공 후 에이전트가 `post-state.sh set posted_x <url>`로 기록한다. 실패한 게시는 기록하지 않는다.
- 영수증은 활성 작업 하나를 가리킨다 — 동시에 여러 작업을 활성화하면 섞이므로 금지.

## 5. Ready 판정식 (게이트 판정 가능 형태)

publish.sh가 게시 직전에 기계적으로 판정한다.

> **Ready 판정식: `approved_digests`에 해당 플랫폼이 있고 `drafts/<platform>.md`의 sha256과 일치**

하드 제약 통과 여부는 별도로 publish.sh가 check-drafts.py를 재실행해 확인한다(이중 검사). 승인 후 초안이 바뀌면 digest가 어긋나 게시가 거부된다 — 이때는 Stage 8 승인부터 다시 받는다. 이 판정식은 SKILL.md와 docs/REFERENCE.md에서 **동일 문구로** 참조해야 한다 — 문구가 어느 한쪽에서 달라지면 게이트 판정이 갈린다.

## 6. 재개·이동 탐지

- 대화 압축 후 재개: `post-state.sh get`으로 승인 여부를 복구한다. **이전 승인을 가정하지 않는다** — 영수증이 비어 있으면 Stage 8부터 다시.
- 작업 루트 이동: job-state.md frontmatter `root`와 실제 경로가 다르면 사용자에게 확인하고 `root`를 갱신한다.
