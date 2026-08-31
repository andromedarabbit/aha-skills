# REFERENCE — 스크립트·계약 레퍼런스

스크립트 인터페이스와 기계 계약의 빠른 조회표. 상태 파일 형식의 SSOT는 `assets/state-schema.md`다.

> 이 문서에서 `$SKILL_DIR`은 이 스킬의 루트 디렉토리다. SKILL.md 본문에서는 `${CLAUDE_SKILL_DIR}`으로 치환되지만, 이 문서는 에이전트가 Read 도구로 직접 읽으므로 치환이 일어나지 않는다 — 실행 시 값을 정해서 넘겨라.

## 스크립트 인터페이스

| 스크립트 | 호출 | 역할 |
| --- | --- | --- |
| `preflight.sh` | `bash $SKILL_DIR/scripts/preflight.sh` | 환경 스냅샷 JSON 1줄 (항상 exit 0) |
| `check-deps.sh` | PreToolUse 훅 (`if: Bash(aside *)`) | aside 존재·계정 상태 확인 (편의 — 강제력 없음) |
| `post-state.sh` | `bash $SKILL_DIR/scripts/post-state.sh <sub>` | 영수증·활성 작업 관리 |
| `record-approval.sh` | PostToolUse 훅 (matcher: AskUserQuestion) | 승인 digest 기록 (승인의 유일한 입구) |
| `check-drafts.py` | `uv run --with grapheme --with pyyaml $SKILL_DIR/scripts/check-drafts.py <job-dir>` | 하드 제약 검사 (위반 exit 1) |
| `publish.sh` | `bash $SKILL_DIR/scripts/publish.sh --job <dir> --platform <p>` | 게시 단일 진입점 (가드 후 aside exec) |

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

publish.sh가 게시 직전 이 판정식을 강제하고, 하드 제약(check-drafts.py)도 재실행한다(이중 검사).

## 훅 계약 (record-approval.sh)

- 이벤트: PostToolUse, matcher: `AskUserQuestion`
- 인식 조건: `tool_input.questions` 중 header가 **정확히 `게시 승인`** 인 문항의 답변이 **정확히 `게시`** 일 때만 승인으로 기록
- 기록 내용: 활성 작업 `drafts/*.md` 전부의 sha256 → `approved_digests` 객체
- Stage 8의 질문 문구는 이 계약을 지켜야 한다 — header를 바꾸면 훅이 승인을 못 본다

## 문자 수 단위 (하드 제약)

| 플랫폼 | 단위 | 상한 | 비고 |
| --- | --- | --- | --- |
| X | weighted | 280 | URL은 23으로 고정, CJK 계열 글자는 2로 가중 |
| Bluesky | grapheme | 300 | 유니코드 grapheme cluster 단위 (자소 결합·ZWJ 이모지 포함) |
| LinkedIn | codepoint | 3000 | |
| Facebook | codepoint | 63206 | |

- X weighted 규칙은 aside 설계 문서가 아니라 실제 X 동작에서 온 값이다 — 플레이북에 근거를 표기하고, 플랫폼 정책이 바뀌면 `check-drafts.py` 상수와 플레이북을 함께 갱신한다.
- 미디어·alt: Bluesky는 이미지 alt text 필수(하드). 해시태그: Bluesky 0~1개(하드). 미디어 개수 상한: X 4, Bluesky 4, LinkedIn 9(하드). Facebook은 개수 상한을 두지 않는다(근거 불명확한 규칙을 하드로 만들지 않는다).

## 게시 실행 계약 (aside)

- 게시: `aside exec --account <id>`에 동결된 초안 파일 경로를 전달, **변경·요약 없이 그대로 게시** 지시. 직접 exec를 호출하지 않고 publish.sh 경유만.
- 검증(read-back): `aside account use <id>`로 먼저 계정 전환(**repl은 `--account`를 무시한다**), 게시글 URL를 열어 snapshot으로 본문 확인.
- 계정 식별자는 `aside account list`의 프로필 값(`u0`, `u1`)만 쓴다. 이메일은 무시된다.

## 확인된 제약

- 활성 작업 포인터(`${TMPDIR}/social-posting-current-job`)는 머신 전체 1개다 — 동시에 여러 작업을 활성화하면 승인이 섞인다. 한 번에 한 작업만.
- 게시는 되돌릴 수 없다. 모든 게시는 publish.sh의 digest·제약·계정 가드 뒤에서만 일어난다.
