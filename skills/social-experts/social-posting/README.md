# social-posting

aside(에이전트 브라우저)를 실행 계층으로 사용해 X·LinkedIn·Facebook·Bluesky에 올릴 문안을 쓰고 승인받아 게시하는 에이전트 스킬.

## 빠른 시작

```text
"소셜 포스팅 만들어줘"  또는  /social-posting
```

호출하면 즉시 환경 점검(aside CLI·계정·워크스페이스) 후, 플랫폼·계정·소재를 묻는다. 이후 다음 순서로 진행된다:

1. 사실·관점 수집 (검증 못한 주장은 "질문 필요" 마커 — 지어내지 않는다)
2. 보이스 프로필 확인 (없으면 부트스트랩)
3. canonical message 작성
4. 플랫폼별 별도 작성 (복사 금지)
5. 하드 제약 기계 검증 (문자 수·alt text 등)
6. 초안 승인 게이트
7. 게시 (publish.sh 가드 → aside)
8. 게시 후 read-back 검증

## 요구 사항

- aside CLI 1.26.717 이상 (로그인된 X·LinkedIn 계정) — Aside 데스크톱 앱 동반
- uv (하드 제약 검사의 grapheme 계산용)
- jq

## 보이스 프로필 부트스트랩

처음 사용하면 aside로 본인 최근 게시물(15~20개)을 읽어 말투·안티패턴·실제 샘플 3~5개를 추출한 보이스 프로필 초안을 만든다. 프로필은 검수 게이트에서 사용자가 확인한 뒤 저장되고, 이후 모든 문안에 적용된다. 원본 게시물은 `social/bootstrap-cache/`에 남아 재추출 없이 재검수할 수 있다. 안티패턴·금지 주제는 추론만으로 확정하지 않는다 — 반드시 검수를 거친다.

## 작업 데이터 위치 (경로 독립)

이 스킬은 어떤 절대경로도 문서에 굽지 않는다. 작업 데이터는 `<작업 루트>/social/` 아래에 살고, 작업 루트는 호출 인자 → CWD 탐색 → 사용자 확인 순서로 확정된다. 상세 레이아웃은 `assets/state-schema.md` 참조.

## 계정 주의

- 게시 계정은 Stage 2에서 aside 프로필 식별자(`u0`, `u1` …)로 지정한다. **이메일은 aside가 무시한다.**
- 개인/사내 계정 혼동이 1순위 사고다 — 기본값으로 조용히 빠지지 않게 반드시 확인하고, publish.sh가 job-state 기재 계정과만 게시한다.
- read-back에 `aside repl`을 쓸 때는 `aside account use <id>`로 먼저 전환한다 (repl은 `--account`를 무시한다).

## Draft → Ready

초안은 `draft`로 태어나고, 승인받으면 Ready가 된다. **Ready 판정식**: `approved_digests`에 해당 플랫폼이 있고 `drafts/<platform>.md`의 sha256과 일치. 승인 후 문안을 고치면 digest가 어긋나 게시가 거부된다 — 다시 승인받아야 한다.

## 스레드 (X·Bluesky)

초안 frontmatter에 `format: thread`를 두고 게시물 사이를 `=== POST ===` 한 줄로 구분하면, 게시 시 각 세그먼트가 **이전 게시물에 대한 답글로 연결된 하나의 스레드**로 게시된다.

- 게시물 2개 이상(X는 25개 이하). 길이 제한은 게시물별로 각각 적용된다 — X는 게시물당 280 가중(twitter-text v3 규칙: 한글·이모지·비라틴은 2로 계산), Bluesky는 300 grapheme.
- **LinkedIn·Facebook은 스레드를 지원하지 않는다**(네이티브 스레딩 없음) — 단일 게시물로 쓴다.
- 게시 성공 신호도 세그먼트 수 기준이다: 게시 URL이 세그먼트 수보다 적으면 "부분 게시 가능성"으로 실패 보고된다.
- 구조 규칙(훅→바디→클로저 3존, 번호 매기기)은 `docs/playbook-x.md`·`docs/playbook-bluesky.md`의 스레드 섹션 참조.

## 게시는 되돌릴 수 없다

- 모든 게시는 `scripts/publish.sh`의 6중 가드(플랫폼·digest·하드 제약·계정·승인 시점 계정 스냅샷·동결 직후 재검증) 뒤에서만 일어난다.
- 승인은 AskUserQuestion 훅만 기록한다 — 에이전트가 승인을 자기 신고하는 경로는 없다.
- 게시 후 read-back에서 문구 불일치가 발견되면 즉시 보고된다 (플랫폼 삭제 창이 닫히기 전에).

## 문제 해결

| 증상 | 원인·해결 |
| --- | --- |
| `aside CLI를 찾을 수 없습니다` | Aside 데스크톱 앱 설치 후 CLI 확인 (`aside --version`) |
| 계정 목록이 비었다 | Aside 앱 실행·로그인 후 `aside account list` |
| 게시가 "재승인 필요"로 거부됐다 | 승인 후 초안이 수정된 것 — 정상 동작이다. Stage 8 승인부터 다시 |
| 하드 제약 검사가 안 돈다 | uv 부재 — fail-closed 동작. uv 설치 후 재시도 |
| 승인했는데 게시가 거부된다 | record-approval.sh 훅이 승인을 못 기록한 것 — Stage 8 게이트의 header가 정확히 `게시 승인`인지 확인 |
| 대화가 압축된 뒤 승인 상태를 모르겠다 | `post-state.sh get`으로 영수증 복구 — 이전 승인을 가정하지 않는다 |

## 상세 문서

- `SKILL.md` — 전체 스테이지 흐름
- `docs/INDEX.md` — 문서 목록
- `assets/state-schema.md` — 작업 상태 형식
- `assets/voice-profile-schema.md` — 보이스 프로필 형식
