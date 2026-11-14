# REFERENCE — 스크립트·계약 레퍼런스

스크립트 인터페이스와 기계 계약의 빠른 조회표. 상태 파일 형식의 SSOT는 `assets/state-schema.md`다.

> 이 문서에서 `$SKILL_DIR`은 이 스킬의 루트 디렉토리다. SKILL.md 본문에서는 `${CLAUDE_SKILL_DIR}`으로 치환되지만, 이 문서는 에이전트가 Read 도구로 직접 읽으므로 치환이 일어나지 않는다 — 실행 시 값을 정해서 넘겨라.

## 스크립트 인터페이스

| 스크립트 | 호출 | 역할 |
| --- | --- | --- |
| `preflight.sh` | `bash $SKILL_DIR/scripts/preflight.sh` | 환경 스냅샷 JSON 1줄 (항상 exit 0) |
| `ego-post.mjs` | `node $SKILL_DIR/scripts/ego-post.mjs <setup\|bootstrap\|post\|readback>` | ego lite 실행 계층 — 신원 바인딩·부트스트랩·게시·read-back (실패도 JSON 1줄 + exit 1) |
| `check-deps.sh` | PreToolUse 훅 (`if: Bash(*ego-post.mjs*)`) | ego-browser·node 존재 확인 (편의 — 강제력 없음) |
| `post-state.sh` | `bash $SKILL_DIR/scripts/post-state.sh <sub>` | 영수증·활성 작업 관리 |
| `record-approval.sh` | PostToolUse 훅 (matcher: AskUserQuestion) | 승인 digest + 계정 스냅샷 기록 (승인의 유일한 입구) |
| `check-drafts.py` | `uv run $SKILL_DIR/scripts/check-drafts.py <job-dir>` | 하드 제약 검사 (위반·파싱 불가 exit 1) + 플랫폼 간 문형 중복 경고(`warnings` — 차단 안 함) |
| `check-drafts.py` (페이로드) | 위 명령에 `--platform <p>` 추가 | 게시 페이로드 JSON: 본문(frontmatter 제거)·절대경로 media·link·format·visibility |
| `publish.sh` | `bash $SKILL_DIR/scripts/publish.sh --job <dir> --platform <p>` | 게시 단일 진입점 (6중 가드 후 ego-post 실행, DOM 증거 판정) |

## post-state.sh 서브커맨드

```text
activate <job-dir>    작업 디렉토리 생성 + 활성 포인터 기록
get [<key>]           영수증 전체(JSON) 또는 값 하나 — approved_*, posted_* 만 조회 가능
set <key> <value>     posted_<platform> 만 기록 가능 (posted_*_at 자동 동반)
unset <key>           posted_<platform> 만 무효화 가능
digest <platform>     현재 drafts/<platform>.md의 sha256 출력
ready <platform>      Ready 판정식 판정 — 일치하면 exit 0
clear                 영수증 삭제
```

**approved_\*는 post-state.sh로 기록할 수 없다.** record-approval.sh 훅(PostToolUse, matcher: AskUserQuestion)만 lib/receipt.sh를 직접 호출해 기록한다.

## ego 바인딩 (ego-post.mjs setup)

ego lite에는 권한 엔진이 없다 — 안전장치는 승인 영수증·digest 가드·ego-post의 신원 대조가 전부다. 계정은 **ego lite에 로그인된 프로필 1개**이고, setup이 플랫폼별 신원을 확정해 바인딩 파일에 기록한다.

- 바인딩 파일: `<상태 디렉토리>/social-posting/binding.json` (`$SOCIAL_EGO_STATE_DIR` 오버라이드, 기본 `$HOME/.local/share/aha-skills/social-posting/` — 경로는 런타임에 확정). 내용: `{transport:"ego-post/1", executable, taskSpaceName:"social-posting-skill", egoVersion, identity:{x:<handle>, linkedin:<slug>, …}}`
- `setup --platform <p> [--force]`: 실행파일 발견(`SOCIAL_EGO_EXECUTABLE` → PATH의 `ego-browser`) 후 읽기 전용 프로필 확인으로 신원을 얻어 기록한다. 이미 바인딩된 플랫폼은 재호출 없이 `cached:true`로 돌려준다(`--force`로 재측정)
- TaskSpace 이름은 `social-posting-skill` 1개(순차 게시) — 사용자 소유 스페이스 침입·claim·양도 계열 ego API는 고정 스크립트에서 일절 호출하지 않는다(테스트가 정규식으로 강제)
- ego-post `post`는 게시 전에 **라이브 프로필 신원과 바인딩을 대조**한다 — 불일치면 `EGO_ACCOUNT_MISMATCH`로 게시 전 차단(계정 재타깃 방지의 실행 계층 사본)

## Aside에서 이관할 때 기존 권한 회수

ego로 전환하거나 플러그인을 업데이트해도 이전 Aside 계정의 자동 허용 규칙은 지워지지 않는다. 특히 `browser: modify`는 사이트 한정이 아닌 전역 권한이다. 기존 버전의 권한 일괄 허용을 썼다면 다음을 별도로 처리한다:

1. 허용을 부여했던 Aside 계정별로 현재 권한을 조회한다. 조회와 변경은 Aside 스킬의 설정 절차를 따른다
2. 이 스킬이 추가했던 `rules.allow` 항목을 확인한다: tool `twitter.tweet`, `twitter.reply`, `twitter.deleteTweet`; browser `modify`; network `https://x.com/*`, `https://www.linkedin.com/*`, `https://www.facebook.com/*`, `https://bsky.app/*`
3. 삭제 대상 계정과 규칙을 사용자에게 보여주고 **권한 회수 승인을 받은 뒤에만** 해당 항목을 제거한다. 다른 작업에서 필요한 규칙이나 `ask`·`deny`·기본 정책은 바꾸지 않는다. 다른 스킬도 쓰는 규칙이면 유지 여부를 사용자에게 확인한다
4. 다시 조회해 승인한 규칙이 제거됐는지 확인한다. Aside를 쓸 수 없거나 승인을 받지 못하면 회수하지 않았다고 보고한다. ego 바인딩 성공을 권한 회수 완료로 간주하지 않는다

Aside는 이관 정리에만 필요하며 새 게시 경로의 의존성이 아니다. 이 저장소의 업데이트는 사용자 설정을 자동 변경하지 않는다.

## Ready 판정식

> **`approved_digests`에 해당 플랫폼이 있고 `drafts/<platform>.md`의 sha256과 일치**

publish.sh는 게시 직전 이 판정식을 강제하고(동결 직후 원본 재검증 포함), 하드 제약(check-drafts.py)도 재실행한다(이중 검사). 승인 digest는 초안 전체 파일 기준이고 게시 페이로드는 본문만 담는다 — 검증 대상과 게시 대상이 원본 하나로 묶인다.

## publish.sh 6중 가드

1. 플랫폼이 job-state platforms 안에 있는가
2. 승인 digest 존재·일치 (Ready 판정식)
3. 하드 제약 재실행 (check-drafts.py)
4. 계정은 job-state accounts 기재값만
5. 승인 시점 계정 스냅샷(`approved_accounts`)과 현재 accounts 일치 — 승인 후 계정 변경 거부
6. 본문 동결 직후 원본 전체 digest 재검증 — 검사→동결 사이 변경(TOCTOU) 거부

게시 페이로드: check-drafts 페이로드 JSON(본문·절대경로 media+alt·link·visibility)에 가드 4의 ego 신원(`identity`)을 실어 ego-post.mjs `post`의 **stdin**으로 전달한다. 본문은 `mktemp 0400` 동결 파일로도 남는다(EXIT trap 정리 — `XXXXXX`는 반드시 마지막 문자, macOS BSD mktemp는 접미사가 붙으면 랜덤화하지 않는다) audit 증거로, 경로는 `SOCIAL_POSTING_FROZEN`으로 하위 프로세스에 전달된다. `SOCIAL_EGO_POST` 환경변수가 있으면 ego-post 대신 그 스크립트를 호출한다(테스트 심 — payload JSON stdin / 결과 JSON stdout / exit 0|1 계약). **성공 신호는 ego-post의 DOM 증거 판정이다**: `POSTED`+`urlRecovered:true` → exit 0·URL 회수 완료, `POSTED`+`urlRecovered:false` → **exit 0 + 경고**(게시는 성립 — 재시도는 중복 게시), `PARTIAL_POSTED` → exit 1(`postedCount`와 회수된 URL 노출·재시도 금지), `POST_UNKNOWN` → exit 1(클릭 후 결과 또는 실행 응답 불명·재시도 금지·프로필 확인), `POST_FAILED` → exit 1(게시 클릭 전 실패). exit 1이어도 JSON 결과를 보존한다. ego-post는 자체 상한 타임아웃(세그먼트×60초+120초, 최대 570초)으로 자식을 정리하므로 publish.sh에 감시 루프가 없다 — **호출측(하네스 Bash)은 타임아웃을 늘려야 한다**(single ≈300초, thread ≈600초). Facebook `visibility`(`public`/`friends`/`keep`)은 ego-post가 composer의 공개범위 메뉴로 반영한다(`keep`이면 계정 기본 설정). **스레드(`format: thread`)**는 세그먼트를 이전 게시물에 대한 **답글로 연결**하고(미디어는 첫 게시물에만), 부분 게시는 `PARTIAL_POSTED`로 실패한다. 세그먼트 수는 check-drafts.py 파싱과 같은 방식(공백 세그먼트 제외)으로 센다.

## 훅 계약 (record-approval.sh)

- 이벤트: PostToolUse, matcher: `AskUserQuestion`
- 인식 조건: `tool_input.questions` 중 header가 **정확히 `게시 승인`** 인 문항의 답변이 **정확히 `게시`** 일 때만 승인으로 기록
- 기록 내용: 활성 작업 `drafts/*.md` 전부의 sha256 → `approved_digests` 객체, 승인 시점 accounts 라인 → `approved_accounts`
- Stage 8의 질문 문구는 이 계약을 지켜야 한다 — header를 바꾸면 훅이 승인을 못 본다

## 문자 수 단위 (하드 제약)

| 플랫폼 | 단위 | 상한 | 비고 |
| --- | --- | --- | --- |
| X | weighted | 280 | twitter-text v3 규칙 — 라틴 등 일부 범위만 1, 한글·한자·이모지·비라틴은 2. URL은 23 고정 |
| Bluesky | grapheme | 300 | 유니코드 grapheme cluster 단위 (자소 결합·ZWJ 이모지 포함) |
| LinkedIn | codepoint | 3000 | |
| Facebook | codepoint | 63206 | |

- 길이는 실행 시 첫 세그먼트에 붙이는 줄바꿈과 `link`까지 포함해 검사한다. 나머지 세그먼트에는 `link`를 중복 계산하지 않는다.
- X weighted 규칙은 X 공식 카운팅 라이브러리 twitter-text v3(`config/v3.json`)에서 온 값이다 — 화이트리스트 4개 범위(`X_LIGHT_RANGES`)만 1로 세고 나머지 전부는 2로 센다(한글 음절 140자가 상한). 플랫폼 정책이 바뀌면 `check-drafts.py` 상수와 플레이북을 함께 갱신한다.
- 스레드 하드 제약: `format: thread`는 세그먼트 2개 이상 + **x·bluesky만 지원**(linkedin·facebook은 거부), X는 게시물 ≤ 25. `format: single`은 세그먼트 정확히 1개. 게시물별 길이·해시태그·alt 검사는 게시물 단위로 각각 적용된다.
- 미디어·alt: Bluesky는 이미지 alt text 필수(하드). 해시태그: Bluesky 0~1개(하드). 미디어 개수 상한: X 4, Bluesky 4, LinkedIn 9(하드). Facebook은 개수 상한을 두지 않는다(근거 불명확한 규칙을 하드로 만들지 않는다).

## 게시 실행 계약 (ego lite)

- 게시: publish.sh가 ego-post.mjs `post`에 페이로드 JSON을 stdin으로 전달 — ego-post가 고정 스크립트(ego-browser `nodejs` 서브커맨드, 스크립트 stdin 주입·JSON 1줄 회수·스트림 2MiB 상한)로 composer 입력·미디어 첨부(`setInputFiles`+프리뷰 확인, 게시 클릭 전 fail-closed)·공개범위·게시 버튼 1회 클릭·DOM 증거 폴링·프로필 퍼마링크 회수(최선)를 수행한다. ego-browser CLI를 직접 호출하지 않고 publish.sh(게시)·ego-post.mjs(setup·bootstrap·readback) 경유만.
- 검증(read-back): `ego-post.mjs readback`에 `{urls:[…], bodies:[…]}` JSON을 stdin으로 전달 — 게시글 URL과 대응하는 게시물 노드의 본문을 비교한다. 전체 페이지의 다른 글·인용문이 일치하더라도 성공으로 보지 않는다. URL과 본문 배열은 같은 길이·같은 순서로 제공하며 첫 세그먼트 본문에는 실제로 덧붙인 링크도 포함한다.
- 계정 신원은 바인딩 파일의 플랫폼별 신원 문자열만 쓴다(이메일 아님). `link` 키가 있으면 ego-post가 첫 세그먼트 끝에 링크를 한 줄 덧붙인다(중복 방지 — 본문에 이미 있으면 `link` 키를 비워둔다).

## 확인된 제약

- 플랫폼 DOM 셀렉터(X·LinkedIn·Facebook·Bluesky composer·퍼마링크)는 첫 실측 전 보수적 추정이다 — 실패는 전부 기명 코드(`EGO_COMPOSER_NOT_FOUND` 등)로만 갈린다. 첫 실환경 실행은 측정으로 취급해 셀렉터를 교정한다
- 순차 게시는 의도다: ego 경로는 전부 브라우저 UI라 병렬이 경합만 만든다(aside 시절 실측 2026-09-01: 브라우저+브라우저 조합 wall 422초·상한 초과 사망)

- 활성 작업 포인터(`${TMPDIR}/social-posting-current-job`)는 머신 전체 1개다 — 동시에 여러 작업을 활성화하면 승인이 섞인다. 한 번에 한 작업만.
- 게시는 되돌릴 수 없다. 모든 게시는 publish.sh의 digest·제약·계정 가드 뒤에서만 일어난다.
