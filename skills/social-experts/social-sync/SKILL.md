---
name: social-sync
description: X·Facebook·Threads·Bluesky 계정의 글을 상호 동기화하는 orca 정기 자동화. "소셜 동기화 등록해줘", "크로스포스트 자동화 걸어줘", "X에만 올린 글 다른 플랫폼에도 올려줘", "/social-sync", "sync tick", "동기화 승인 대기 게시해줘" 같은 요청 시 사용한다. LLM 없는 precheck 게이트(scripts/sync_gate.py)가 새 글을 찾을 때만 에이전트를 깨우고, tick이 미디어 수집·글자수 초과 스레드 분할 초안까지 준비한 뒤 사용자 승인(social-posting의 "게시 승인" 훅 계약)을 거쳐 게시한다. setup(최초 설정·첫 실행 며칠치 질문)/tick(무인)/approve(승인·게시)/status 모드가 있다. Threads 게시는 실환경 검증 전까지 대상에서 제외한다.
version: 0.1.1
context: inline
language: "korean"
dependencies:
  - ego-browser>=0.6.3
  - node>=24
  - uv>=0.4.0
  - jq>=1.6
---

# social-sync — 소셜 크로스포스트 주기 동기화

X·Facebook·Threads·Bluesky 중 한 곳에만 올라온 글을 나머지 플랫폼으로 동기화한다. 읽기·게시·승인 가드는 `../social-posting`의 공통 스크립트를 재사용하고, 이 스킬은 **주기 확인(wake)·동기화 상태·승인 대기 큐**만 추가한다.

**무인 원칙.** tick 모드는 사람 없이 돌므로 `AskUserQuestion`을 절대 호출하지 않는다. 판단이 필요한 것은 보고로 남기고 approve 모드(대화형)로 넘긴다. setup·approve만 묻는다.

## 모드 라우팅

인자에서 모드를 읽는다: `setup` / `tick` / `approve` / `status`. 인자가 없으면 AskUserQuestion으로 설정 / 승인·게시 / 상태 확인 중 묻는다. tick은 인자 없는 호출에서도 절대 선택지로 만들지 않는다(사람이 있는 세션에서 호출됐다는 뜻이므로 status를 기본 제안한다).

## 경로·데이터

이 스킬은 어떤 저장소 절대경로도 모른다. 스크립트는 `${CLAUDE_SKILL_DIR}/scripts/`, social-posting 공용 스크립트는 `${CLAUDE_SKILL_DIR}/../social-posting/scripts/`로 부른다. 사용자 데이터는 런타임 경로를 따른다:

```text
~/.config/social-sync/config.json            # 소스·대상·주기·threadsVerified
~/.local/state/social-sync/state.json        # 워터마크·글 상태·pairs·pending·lastWake
~/.local/share/aha-skills/social-sync/jobs/<wake-id>/   # 게시 작업 (social-posting 작업 구조 그대로)
${TMPDIR}/social-posting-current-job         # 승인 훅이 쓰는 활성 작업 포인터 (기계 전체 1개)
```

## setup 모드 — 최초 설정

1. **선행 확인.** ego 바인딩이 있어야 한다: `jq -r '.identity' "$HOME/.local/share/aha-skills/social-posting/binding.json"`. 없으면 social-posting의 setup 안내와 함께 중단한다. orca CLI가 없으면 등록 단계에서 실패 안내와 함께 중단한다.
2. **한 번의 AskUserQuestion에 세 문항**:
   - 소스 플랫폼 (multiSelect: X / Facebook / Threads / Bluesky, 기본 4개 전부 — 상호 동기화)
   - 첫 실행 며칠치를 훑을지 (7일 / 3일 / 14일 — 이후는 마지막 확인 시점부터 이어진다)
   - 확인 주기 (매시간 / 30분 / 2시간)
3. 설정 초기화와 shim·등록:

```bash
uv run "${CLAUDE_SKILL_DIR}/scripts/sync_gate.py" config --init --sources <선택 플랫폼 csv> --days <며칠>
bash "${CLAUDE_SKILL_DIR}/scripts/install-gate-shim.sh"
bash "${CLAUDE_SKILL_DIR}/scripts/automation-register.sh" --create \
  --workspace "path:$PWD" --trigger "<주기 cron: 매시간 0 * * * * / 30분 */30 * * * * / 2시간 0 */2 * * *>"
```

4. **마지막 문항 — 정확히 header `automation 활성화`, options `켠다`/`켜지 않는다`**: `automation \`<id>\`` 본문과 함께 물은 뒤 "켠다"일 때만 `orca automations edit <id> --enabled --json`을 실행한다. 등록은 항상 `--disabled`로 돼 있어 여기서 켜기 전에는 아무 일도 일어나지 않는다.
5. 첫 동작 확인을 제안한다: `orca automations run <id> --json`(precheck 우회 즉시 실행) → 세션에서 `/social-sync tick`이 돌았는지 `orca automations runs --id <id> --json`으로 본다.

## tick 모드 — 무인 처리

**이 세션은 무인이다. 도구로 묻지 않고, 승인 없는 게시를 하지 않고, 마지막 메시지가 보고서다.**

1. wake 회수와 분기:

```bash
uv run "${CLAUDE_SKILL_DIR}/scripts/sync_gate.py" wake-report
```

`status`가 `NO_WAKE`(exit 1)면 `lastScan`을 확인하고 끝낸다. `lastScan`이 null이면 아직 스캔하지 않아 새 글 유무를 모른다고 보고한다. `lastScan.errors`가 비어 있지 않으면 오류를 보고한다. 그 외에는 마지막 스캔 시각과 처리할 wake가 없음을 보고한다. `ERROR`면 오류 내용을 보고하고 끝낸다.

2. **글마다 게시 작업 준비** — 모든 새 글을 하나의 작업 디렉터리(wake-report의 `dir`)로 만든다:
   - 대상 플랫폼 = `config.targets`에서 이 글의 소스 플랫폼을 뺀 집합. `config.threadsVerified`가 `false`면 Threads를 뺀다. 바인딩(`$HOME/.local/share/aha-skills/social-posting/binding.json`의 `identity`)에 없는 플랫폼도 뺀다.
   - 사진이 있으면 `fetch-media`로 작업 `media/`에 수집한다(scan 산출물 경로 `scanRef`를 `jobDir`로 전달):

```bash
printf '%s' '{"jobDir":"<scanRef>","platform":"<p>","candidateId":"<id>","sourceUrl":"<미디어 URL>"}' \
  | node "${CLAUDE_SKILL_DIR}/../social-posting/scripts/ego-post.mjs" fetch-media
```

   - `job-state.md`를 작성한다(frontmatter: `stage: 7`, `slug`, `root`, `created`·`updated`, `platforms: [대상 집합]`, `accounts: {플랫폼: 바인딩 신원}`(flow style), `source: {type: scan, platform, url, scanned_at}`, `status: {<p>: ready}`, `post_intent: summary`).
   - `drafts/<p>.md`를 **원문 그대로** 작성한다(리보이싱하지 않는다). 형식은 social-posting `assets/state-schema.md`를 따른다: frontmatter(`platform`, `format`, `media`에 `source: scan`·`sha256`·`provenance`·`provenance_sha256`) + 본문. 글자수 상한을 넘으면 의미 단위로 `=== POST ===` 세그먼트를 나누고 `format: thread`로 쓴다(X 280 weighted·Bluesky 300 grapheme, 스레드 지원은 X·Bluesky·Threads, X 상한 25). 사진은 플랫폼 상한(X·Bluesky 4장)까지만 붙이고 잘린 분은 보고에 남긴다. Bluesky는 사진마다 alt가 필수다 — 원본 alt가 없으면 `이미지`로 채우고 보고에 표시한다(승인 단계에서 고친다). Facebook은 `visibility`를 생략한다(기존 설정 유지).
   - 검사:

```bash
uv run -q --with grapheme --with pyyaml python "${CLAUDE_SKILL_DIR}/../social-posting/scripts/check-drafts.py" <작업 경로>
```

   - 검사 통과 글만 대기열에 올린다:

```bash
uv run "${CLAUDE_SKILL_DIR}/scripts/sync_gate.py" mark-pending --platform <소스> --url <원본 permalink> --job <작업 경로>
```

   - 응답·인용·리트윗으로 보이는 글(`parentUrl` 있음 등)은 게시 대상에서 빼고 `mark-skipped --reason <사유>`로 기록한다.

3. **마지막 메시지 = 보고서**: 승인 대기 N건(소스·원문 요약·대상·작업 경로), 스킵 목록과 사유, 주의(alt 기본값·사진 절삭·커버리지 `stopReason` 제한)를 남긴다. 게시하지 않는다.

## approve 모드 — 승인·게시 (대화형)

1. 대기열 확인:

```bash
uv run "${CLAUDE_SKILL_DIR}/scripts/sync_gate.py" status
```

`pendingCount`가 0이면 알리고 끝낸다.
2. pending의 `job`별로 묶어 처리한다. 각 작업마다 초안(플랫폼·본문·사진·alt·출처)을 요약해 보여준다. **작업 활성화** — 승인 훅이 이 포인터를 읽는다:

```bash
printf '%s\n' <작업 경로> > "${TMPDIR:-/tmp}/social-posting-current-job"
```

3. AskUserQuestion으로 승인받는다. **계약 문구를 문자 그대로 쓴다** — header는 정확히 `게시 승인`, question 본문에 정확히 한 줄 `게시 대상: <이 작업에서 게시할 플랫폼 csv>`(예: `게시 대상: x,bluesky`), options `게시`/`수정`/`보류`. 훅이 실제 응답만 영수증(`receipt.json`의 `approved_digests`)으로 기록한다. 에이전트가 영수증을 직접 만드는 방법은 없다.
   - `게시` → 대상마다 게시한다(스레드 이어쓰기 포함, ego-post 고정 스크립트가 처리):

```bash
bash "${CLAUDE_SKILL_DIR}/../social-posting/scripts/publish.sh" --job <작업 경로> --platform <p>
```

     성공 URL로 매핑을 기록한다(URL 미회수면 값 없이):

```bash
uv run "${CLAUDE_SKILL_DIR}/scripts/sync_gate.py" mark-synced --platform <소스> --url <원본 permalink> --target <p> --target-url <게시 URL>
```

     게시 결과는 작업 `post-log.md`에 남긴다. 실패한 플랫폼은 결과와 함께 보고하고 pending에 남긴다(다음 승인에서 재시도).
   - `수정` → 초안을 고치고 `check-drafts.py` 재검사 → 같은 계약으로 다시 승인받는다(초안이 바뀌면 digest가 바뀌므로 재승인이 필수다).
   - `보류` → 그 작업을 건너뛴다(pending 유지).
4. 한 작업이 끝나면 다음 작업으로 옮겨가며 포인터를 갱신한다. 여러 작업을 동시에 승인하지 않는다.

## status 모드

```bash
uv run "${CLAUDE_SKILL_DIR}/scripts/sync_gate.py" status
bash "${CLAUDE_SKILL_DIR}/scripts/automation-register.sh" --status
```

워터마크·글 상태 집계·pairs 수·pending 수와 automation 등록 상태(drift 포함)를 함께 보고한다. `drift: true`면 등록된 precheck·프롬프트가 현재 스킬과 다르므로 setup을 다시 돌리라고 안내한다.

## Threads 게시 검증 (사용자 입회 필수)

`config.threadsVerified`가 `false`인 동안 Threads는 게시 대상에서 빠진다. 검증 절차:

1. 사용자와 함께 social-posting 경로로 Threads 실제 게시 1회를 시도한다(`ego-post.mjs post`는 `THREADS_UNVERIFIED` 가드로 막혀 있어, 검증은 사용자가 명시적으로 게시를 요청한 세션에서 가드 해제 전에는 불가능하다 — 아래 2의 코드 변경과 **함께** 단계를 밟는다).
2. 통과하면 세 곳을 함께 해제한다: `social-posting/scripts/ego-post.mjs`의 `THREADS_UNVERIFIED` 가드, `social-posting/scripts/publish.sh`의 Threads 거부(usage 플랫폼 목록 포함), `social-posting/scripts/record-approval.sh`의 승인 대상 정규식. 그리고 `check-drafts.py`의 Threads 주석과 social-posting 문서의 "Threads 게시 차단" 문단을 갱신한다.
3. 마지막으로 검증 플래그를 켠다:

```bash
uv run "${CLAUDE_SKILL_DIR}/scripts/sync_gate.py" config --threads-verified
```

실패하면 플래그를 쓰지 않고, 막힌 지점(길이·사진·답글·read-back)을 보고한다. 검증 전에는 어느 쪽도 Threads로 게시하지 않는다.

## 제약·한계

- **무인 게시 없음**: 게시는 반드시 approve 모드의 사람 승인(훅 영수증)을 거친다. tick은 초안까지만 만든다.
- 리플라이·인용·리트윗과 스레드 후속 글은 v1 동기화 대상이 아니다(소스 스레드는 첫 글만 동기화된다).
- 매칭은 이번 틱 스캔 안에서 정규화 텍스트 digest·토큰 유사도 0.6 이상으로 한다 — 비슷한 문구의 다른 글을 오탐(matched)할 수 있다. 승인 단계에서 잡아낸다.
- precheck는 매 틱 실제 브라우저(ego)를 띄운다 — 맥이 잠자면 그 틱은 건너뛰고, 다음 틱이 이어서 훑는다(워터마크가 이어준다).
- precheck 스캔은 플랫폼당 최대 120초(시간 초과는 오류로 기록, `--gate` 모드는 6시간에 한 번만 오류 기상).
