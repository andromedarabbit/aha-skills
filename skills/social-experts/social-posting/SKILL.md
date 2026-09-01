---
name: social-posting
description: 소셜미디어 포스팅 자동화. X·LinkedIn·Facebook·Bluesky에 올릴 문안을 사용자의 목소리로 쓰고 하드 제약(문자 수·alt text·스레드 규칙)을 기계 검증한 뒤 승인을 받아 aside 브라우저 실행 계층으로 실제 계정에 게시한다. 스레드(X·Bluesky 답글 체인)도 지원한다. `/social-posting` 단독 호출이나 "소셜 포스팅 만들어줘", "블로그 글 X·링크드인에 올릴 문안 만들어줘", "블루스카이 초안 뽑아줘", "이 글 스레드로 변환해줘", "스레드로 뽑아줘" 요청 시 사용. 무엇을 포스팅할지 되묻지 않고 즉시 환경 점검 후 요구사항을 묻는다. 게시 API를 직접 호출하지 않고 aside로만 게시한다. 일반 브라우저 자동화·웹 조사는 aside-browser 스킬 소관이다.
version: 0.5.0
context: inline
language: "korean"
dependencies:
  - aside>=1.26.717
  - uv>=0.4.0
  - jq>=1.6
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(aside *)"
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/social-posting/scripts/check-deps.sh\""
          description: "aside CLI 존재·계정 상태 확인"
  PostToolUse:
    - matcher: "AskUserQuestion"
      hooks:
        - type: command
          command: "bash \"${CLAUDE_PLUGIN_ROOT}/social-posting/scripts/record-approval.sh\""
          description: "게시 승인 응답 관측 시 초안 digest를 영수증에 기록"
---

# 소셜미디어 포스팅 (aside 연동)

X·LinkedIn·Facebook·Bluesky에 올릴 문안을 사용자의 목소리로 쓰고, 검증하고, 승인받아 aside 실행 계층으로 게시한다. **게시 API를 직접 호출하지 않는다** — 글쓰기 판단과 게시 전 검증은 이 스킬이, 게시 실행은 aside가 담당한다.

이 스킬은 `context: inline`이라 주 대화에서 직접 실행된다. "질문"/"확인"/"승인"이라고 적힌 지점에서는 **AskUserQuestion을 호출**해 구조화된 선택 UI로 물어본다. 텍스트로 선택지를 나열하고 사용자 응답을 기다리는 방식은 쓰지 않는다 — 게이트가 대화에 묻혀 놓칠 수 있다. 가까운 확인은 한 AskUserQuestion 호출에 여러 문항으로 묶는다. **각 문항의 선택지는 2~4개** — 1개면 호출 자체가 `Invalid tool parameters`로 거부된다.

## 시작 동작

이 스킬이 호출되면 **인자가 비어 있어도 즉시** preflight를 수집한다. "무엇을 포스팅할까요?" 류의 메타 질문으로 응답하지 않는다 — 스킬 호출 자체가 이미 "소셜미디어 포스팅을 하고 싶다"는 의도다. 대화에 구체적인 요청이 없다는 판단은 이 스킬에서 틀린 판단이다.

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/preflight.sh"
```

출력은 JSON 한 줄이다(항상 exit 0, 실패는 필드에 표시). aside가 없으면 설치 안내를 보여주고 그 자리에서 중단한다.

## 경로 규칙 (vault 독립)

이 스킬은 어떤 절대경로도 하드코딩하지 않는다. 작업 루트는 다음 순서로 확정한다:

1. 호출 인자에 경로가 있으면 그것
2. CWD 또는 상위 디렉토리에 `social/` 폴더가 있으면 그 루트
3. 둘 다 아니면 AskUserQuestion으로 사용자에게 확정

확정된 절대경로는 `job-state.md` frontmatter `root`에 기록해 재개·이동을 탐지한다.

## 작업 공간

```text
<작업 루트>/social/
├── voice-profile.md          # 보이스 프로필 (부트스트랩이 만들고 사용자가 검수)
├── bootstrap-cache/          # 부트스트랩이 수집한 원본 게시물 캐시
└── <job-slug>/               # 게시 작업 1건
    ├── job-state.md
    ├── material.md
    ├── canonical.md
    ├── drafts/               # x.md | linkedin.md | facebook.md | bluesky.md
    └── post-log.md
```

상세 형식의 유일한 source of truth는 `assets/state-schema.md`와 `assets/voice-profile-schema.md`다. 스키마와 다른 표기를 발견하면 그쪽이 틀린 것이다.

## 스테이지

### Stage 0 의존성 확인

PreToolUse 훅이 `aside *` Bash 호출 시 자동으로 check-deps.sh를 돌린다. 명시적으로 호출하지 않는다.

### Stage 1 preflight

위 "시작 동작" 그대로. 결과는 Stage 2의 선택지 재료가 된다. 출력의 `aside.permissions`는 권한 바인딩 상태다 — `bound:false`면 Stage 2에서 일괄 허용 문항이 열린다.

### Stage 2 요구사항 수집·확인 — 입력 게이트

preflight 결과를 바탕으로 **AskUserQuestion 한 번에 묶어** 묻는다:

1. 플랫폼 (multiSelect: X / LinkedIn / Facebook / Bluesky)
2. 계정 — preflight가 수집한 aside 프로필 식별자(`u0`, `u1` …)만 선택지로 노출. 이메일은 넣지 않는다(aside가 무시한다)
3. 소재 유형 (자유 주제 / 기존 문서 재활용 — 문서 후보는 preflight가 제시한 목록에서)
4. 강조점·원하는 반응 (선택 문항)
5. 포스트 목적 — 티저형(궁금증 하나로 흥미를 만들고 링크로 보낸다. 원문 링크 홍보의 권장 기본) / 요약형(논지를 요약해 포스트 자체로 전달한다)
6. Facebook 공개 범위 (facebook 포함 시에만) — 공개 / 친구만 / 기존 설정 유지. 답은 `drafts/facebook.md` frontmatter `visibility`(`public`/`friends`/`keep`)로 기록하고 게시 지시에 반영한다 — 계정 기본값으로 조용히 빠지지 않게 반드시 묻는다

preflight의 `aside.permissions.bound`가 `false`면 위 묶음에 권한 문항을 추가한다 — **지원 사이트 권한 일괄 허용** (허용 / 건너뛰기). "허용"을 고르면 계정 확정 뒤에 부여한다:

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/aside-permissions.sh" grant --account <id>
```

부여는 지원 4개 사이트(x·linkedin·facebook·bluesky)의 allow 규칙을 한 번에 추가하고 같은 모양의 ask 규칙을 allow로 대체한다 — 게시 중 승인 창이 뜨지 않게 첫 사용 시점에 끝내는 게 목적이다. "건너뛰기"해도 진행할 수 있지만, aside 승인 창이 `SOCIAL_ASIDE_TIMEOUT` 창과 충돌해 게시 타임아웃 실패가 될 수 있다.

응답이 확정되면 작업 공간을 만들고 활성화한다:

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/post-state.sh" activate <job-dir>
```

`job-state.md`(frontmatter: stage, root, platforms, accounts, source, status, post_intent)를 작성한다. 이 게이트는 **입력 확인이지 게시 승인이 아니다**.

### Stage 3 소재·근거 수집

기존 문서면 읽어서, 자유 주제면 사용자 대화에서 — 사실·코드·측정치·실패·트레이드오프·사용자의 실제 관점을 `material.md`로 정리한다. 각 항목에 출처를 붙이고, 검증하지 못한 주장은 `질문 필요` 마커를 남긴다. **숫자·고유명사·실제 경험이 부족하면 지어내지 않고 AskUserQuestion으로 질문한다.**

### Stage 4 보이스 프로필 — 검수 게이트

`<작업 루트>/social/voice-profile.md`가 이미 있으면 재사용한다(갱신 여부만 확인). 없으면 부트스트랩을 돌린다:

1. 플랫폼별로 게시물을 수집한다:
   ```bash
   aside exec --account <id> "내 최근 게시물 15~20개 전문을 그대로 반환해줘. 요약·변역·가공 금지"
   ```
2. 원본은 `social/bootstrap-cache/`에 보존한다(재추출 없이 재검수 가능하게)
3. 말투·안티패턴·실제 샘플 3~5개를 추출해 `voice-profile.md` 초안을 만든다. **샘플은 verbatim만 채택**한다 — 요약본을 샘플로 넣지 않는다
4. **검수 게이트**: 프로필 초안(샘플 원문 포함)을 보여주고 이대로 저장 / 샘플 교체 / 항목 수정 중 확인받는다

안티패턴과 금지 주제는 추론만으로 확정하지 않는다 — 반드시 사용자 확인을 거친다.

### Stage 5 canonical 작성

material과 voice profile으로 **하나의 canonical message**(`canonical.md`)를 쓴다. 플랫폼별 문안은 여기서 파생한다. 이후 새 사실이 생기면 플랫폼 파생본보다 canonical을 먼저 갱신한다.

canonical을 쓰기 전 job-state의 `post_intent`를 확인한다. **teaser면 훅 후보 1개 + 링크 유도만** 담고 논지를 재서술하지 않는다 — 요약은 원문의 일이다. 링크가 없는 포스트는 티저가 성립하지 않으므로 요약형으로 취급한다. 훅 후보가 제3자의 부정적 결과(탈락·실패·평가, 익명이어도)를 다루면 **리드 훅 기본값은 논지**(무엇이 잘못됐는지)**로 두고 일화는 후반 뒷받침으로만 쓴다** — 확인 없이 일화를 리드에 세우지 않는다. 일화를 리드로 세우고 싶을 때만 프레이밍(주체·결과 강조 여부)을 AskUserQuestion으로 확인한다. 익명이라도 게시물은 공개적 평가가 된다.

### Stage 6 플랫폼별 파생

canonical을 각 플랫폼 플레이북(`docs/playbook-x.md` 등 4종)에 따라 **별도로 작성**한다. 같은 문장을 복사하지 않는다. 초안 파일 형식(frontmatter, 스레드 경계 `=== POST ===`)은 `assets/state-schema.md`를 따른다.

스레드로 쓸 때는 **x·bluesky만 지원한다** — linkedin·facebook은 네이티브 스레딩이 없어 하드 제약이 거부한다(단일 게시물로 쓴다). 스레드 구조(훅→바디→클로저 3존, 번호 매기기)는 플레이북의 스레드 규칙을 따른다.

### Stage 7 검증

1. **하드 제약(기계 판정)**:
   ```bash
   uv run --with grapheme --with pyyaml "${CLAUDE_SKILL_DIR}/scripts/check-drafts.py" <job-dir>
   ```
   exit 1이면 위반 항목(플랫폼, 항목, 실측값)을 보여주고 Stage 6으로 돌아가 고친다. uv가 없으면 검사 불능 — fail-closed로 게시를 진행할 수 없다
   결과의 `warnings`(플랫폼 간 문형 중복 등)도 함께 표시한다 — 하드 제약과 달리 게시를 차단하지 않는다. 겹친 문형은 차등화하거나, 사실 문장 등 의도적 공유면 확인하고 넘어간다
   기계 경고는 정규화 10자 이상의 베리바트만 잡는다 — **각 플랫폼의 마무리 문장이 같은 문형으로 수렴하지 않았는지는 눈으로 대조**한다. 티저의 압축은 특히 이 수렴을 유도한다
2. **사실 검증**: material.md의 `질문 필요` 마커가 남아 있으면 해결하거나 해당 문구를 초안에서 제거한다. 검증 못한 기술 주장·성능 수치는 게시문에 넣지 않는다
3. **선택 휴리스틱**: 플레이북의 Heuristic 항목은 날짜·근거 붙은 힌트로만 다룬다 — 게시를 차단하지 않는다

### Stage 8 초안 승인 — 승인 게이트

플랫폼별 초안을 **함께 제시**한다. 각 초안 옆에 문자 수(플랫폼 단위)와 하드 제약 통과 상태를 표시한다. AskUserQuestion:

- header: **게시 승인** — 이 문자열이 훅 계약이다. 정확히 이 문구여야 record-approval.sh 훅이 승인을 기록한다
- 선택지: 게시 / 수정 / 취소

"게시" 응답이 오면 PostToolUse 훅이 승인 시점의 초안 sha256과 계정 매핑을 영수증에 기록한다(approved_digests + approved_accounts). **에이전트가 승인을 직접 기록하는 방법은 없다** — `post-state.sh`로는 `approved_*` 키를 set할 수 없다. "수정"이면 Stage 6으로 돌아가 고치고 다시 이 게이트로 온다.

Ready 판정식(기계 판정, publish.sh가 강제한다): **`approved_digests`에 해당 플랫폼이 있고 `drafts/<platform>.md`의 sha256과 일치**

### Stage 9 게시

**직접 `aside exec`를 호출하지 않는다.** 반드시 publish.sh를 경유한다:

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/publish.sh" --job <job-dir> --platform x
```

publish.sh가 게시 직전에 6중 가드를 검사한다 — 승인 플랫폼 여부 · digest 일치 · 하드 제약 재실행 · 계정 매핑 · **승인 시점 계정 스냅샷 일치** · **본문 동결 직후 원본 digest 재검증**. 하나라도 어긋나면 거부한다(실패-닫힘 가드 — 승인 후 초안이나 계정이 바뀌었으면 재승인 필요). 통과하면 **본문만**(frontmatter 제거, media/link는 절대경로·alt 지시로 전달) 동결 파일(0400)에 담아 `aside exec --account <id>`에 **변경·요약 없이 그대로 게시**를 지시하고, 출력에서 게시 URL(`https?://`)을 기계 감지한다 — URL이 없으면 "게시 여부 불명"으로 실패 종료된다. **스레드(`format: thread`)는 세그먼트를 이전 게시물에 대한 답글으로 연결해 하나의 스레드로 게시하도록 지시**하고, 게시 URL이 세그먼트 수만큼 감지되지 않으면 "부분 게시 가능성"으로 실패 종료한다. 대상 플랫폼마다 한 번씩 호출한다.

### Stage 10 게시 후 검증 (read-back)

게시 URL로 본문을 다시 읽어 승인 문구와 일치하는지 확인한다:

- read-back은 repl로 한다: 먼저 `aside account use <id>`로 계정을 전환한다(**repl은 `--account`를 무시한다**), 게시글 URL를 연 뒤 snapshot으로 본문을 읽는다. 액션은 새 snapshot이 예상 상태를 보여주기 전까지 미확정이다
- **스레드는 첫 게시물 URL에서 답글 체인 전체를 확인한다** — 게시물 수·순서·각 본문이 승인 문구와 일치하는지. 게시된 게시물 URL 목록 전체를 `post-log.md`에 남긴다
- **불일치하면 즉시 사용자에게 보고한다** — 플랫폼의 삭제·수정 창이 닫히기 전이다. 조용히 넘기지 않는다
- 결과를 `post-log.md`에 남기고 `post-state.sh set posted_<platform> <url>`로 기록한다(스레드는 첫 게시물 URL)

## 압축(compaction) 대비 재개

승인 이력은 영수증에 있다. 대화가 압축돼 승인 내역이 사라졌으면 `post-state.sh get`(작업 디렉토리에서)으로 복구한다. **절대 이전 승인을 가정하지 않는다** — 영수증이 비어 있으면 Stage 8부터 다시 받는다.

## headless 환경 (AskUserQuestion 없음)

`claude -p` 같은 환경에서는 멈추고 보고한다. 승인을 가정하지 않는다. 텍스트로 선택지를 나열하고 스스로 답을 고르지 않는다. record-approval.sh 훅 경로가 없으면 `approved_*`가 기록되지 않으므로 publish.sh가 구조적으로 거부한다 — 승인 없는 게시는 불가능하다.

## 게시 안전 규칙

- 게시는 되돌릴 수 없다. 모든 게시는 publish.sh의 digest 가드 뒤에서만 일어난다
- 게시 계정은 Stage 2에서 사용자가 지정한 값만 쓴다. 스킬이 임의로 정하지 않는다 — 계정 혼동(개인/사내)이 1순위 사고다
- 검증하지 못한 기술 주장·성능 수치는 게시문에 넣지 않는다

## 문서

- `docs/INDEX.md` — 문서 목록
- `assets/state-schema.md` — 작업 상태 형식의 유일한 SSOT
- `assets/voice-profile-schema.md` — 보이스 프로필 스키마
- `docs/playbook-{x,linkedin,facebook,bluesky}.md` — 플랫폼별 3등급 규칙
