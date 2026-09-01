# REFERENCE — 스크립트·계약 레퍼런스

스크립트 인터페이스와 기계 계약의 빠른 조회표. 상태 파일 형식의 SSOT는 `assets/state-schema.md`다.

> 이 문서에서 `$SKILL_DIR`은 이 스킬의 루트 디렉토리다. SKILL.md 본문에서는 `${CLAUDE_SKILL_DIR}`으로 치환되지만, 이 문서는 에이전트가 Read 도구로 직접 읽으므로 치환이 일어나지 않는다 — 실행 시 값을 정해서 넘겨라.

## 스크립트 인터페이스

| 스크립트 | 호출 | 역할 |
| --- | --- | --- |
| `preflight.sh` | `bash $SKILL_DIR/scripts/preflight.sh` | 환경 스냅샷 JSON 1줄 (항상 exit 0) |
| `check-deps.sh` | PreToolUse 훅 (`if: Bash(aside *)`) | aside 존재·계정 상태 확인 (편의 — 강제력 없음) |
| `post-state.sh` | `bash $SKILL_DIR/scripts/post-state.sh <sub>` | 영수증·활성 작업 관리 |
| `record-approval.sh` | PostToolUse 훅 (matcher: AskUserQuestion) | 승인 digest + 계정 스냅샷 기록 (승인의 유일한 입구) |
| `check-drafts.py` | `uv run --with grapheme --with pyyaml $SKILL_DIR/scripts/check-drafts.py <job-dir>` | 하드 제약 검사 (위반·파싱 불가 exit 1) + 플랫폼 간 문형 중복 경고(`warnings` — 차단 안 함) |
| `check-drafts.py` (페이로드) | 위 명령에 `--platform <p>` 추가 | 게시 페이로드 JSON: 본문(frontmatter 제거)·절대경로 media·link·format·visibility |
| `publish.sh` | `bash $SKILL_DIR/scripts/publish.sh --job <dir> --platform <p>` | 게시 단일 진입점 (6중 가드 후 aside exec, URL 감지) |

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

게시 페이로드: 본문만 `mktemp 0400` 동결(EXIT trap으로 항상 정리 — 템플릿의 `XXXXXX`는 반드시 마지막 문자여야 한다, macOS BSD mktemp는 접미사가 붙으면 랜덤화하지 않는다)하고 **프롬프트에 인라인으로 실어 보낸다** — 파일 경로 전달은 aside exec가 무인 read_file 권한 확인에 무한 정지하는 근본 원인이었다(2026-09-01 실측). 동결 경로는 `SOCIAL_POSTING_FROZEN` 환경변수로 하위 프로세스에 전달된다. media/link는 프롬프트 지시(절대경로·alt 포함 — 미디어 첨부가 있으면 로컬 파일 경로 전달이 필요해 같은 권한 게이트에 걸릴 수 있다는 것이 알려진 제약이다). 성공 신호는 aside 출력의 URL(`https?://`) 기계 감지 — URL 없으면 exit 1 "게시 여부 불명". aside exec는 상한 타임아웃(`SOCIAL_ASIDE_TIMEOUT`초, 기본 120 — 정상 게시는 60초 안에 끝난다)으로 감싸서 무한 정지를 기명 실패로 바꾼다. Facebook 초안의 `visibility`(`public`/`friends`/`keep`)은 게시 지시에 공개 범위 설정으로 반영된다(`keep`이면 지시 없음 — 계정 기본 설정). **스레드(`format: thread`)**는 프롬프트가 세그먼트를 이전 게시물에 대한 **답글로 연결**하도록 지시하고(미디어는 첫 게시물에만), URL 개수 ≥ 세그먼트 수를 요구한다 — 미달이면 exit 1 "부분 게시 가능성". 세그먼트 수는 check-drafts.py의 파싱과 같은 방식(공백 세그먼트 제외)으로 센다.

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

- X weighted 규칙은 X 공식 카운팅 라이브러리 twitter-text v3(`config/v3.json`)에서 온 값이다 — 화이트리스트 4개 범위(`X_LIGHT_RANGES`)만 1로 세고 나머지 전부는 2로 센다(한글 음절 140자가 상한). 플랫폼 정책이 바뀌면 `check-drafts.py` 상수와 플레이북을 함께 갱신한다.
- 스레드 하드 제약: `format: thread`는 세그먼트 2개 이상 + **x·bluesky만 지원**(linkedin·facebook은 거부), X는 게시물 ≤ 25. `format: single`은 세그먼트 정확히 1개. 게시물별 길이·해시태그·alt 검사는 게시물 단위로 각각 적용된다.
- 미디어·alt: Bluesky는 이미지 alt text 필수(하드). 해시태그: Bluesky 0~1개(하드). 미디어 개수 상한: X 4, Bluesky 4, LinkedIn 9(하드). Facebook은 개수 상한을 두지 않는다(근거 불명확한 규칙을 하드로 만들지 않는다).

## 게시 실행 계약 (aside)

- 게시: `aside exec --account <id>`에 동결된 초안 파일 경로를 전달, **변경·요약 없이 그대로 게시** 지시. 직접 exec를 호출하지 않고 publish.sh 경유만.
- 검증(read-back): `aside account use <id>`로 먼저 계정 전환(**repl은 `--account`를 무시한다**), 게시글 URL를 열어 snapshot으로 본문 확인.
- 계정 식별자는 `aside account list`의 프로필 값(`u0`, `u1`)만 쓴다. 이메일은 무시된다.

## 확인된 제약

- 활성 작업 포인터(`${TMPDIR}/social-posting-current-job`)는 머신 전체 1개다 — 동시에 여러 작업을 활성화하면 승인이 섞인다. 한 번에 한 작업만.
- 게시는 되돌릴 수 없다. 모든 게시는 publish.sh의 digest·제약·계정 가드 뒤에서만 일어난다.
