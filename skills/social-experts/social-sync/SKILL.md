---
name: social-sync
description: X·Facebook·Threads·Bluesky 계정의 글을 상호 동기화하는 orca 정기 자동화. "소셜 동기화 등록해줘", "크로스포스트 자동화 걸어줘", "X에만 올린 글 다른 플랫폼에도 올려줘", "/social-sync", "sync tick", "동기화 승인 대기 게시해줘" 같은 요청 시 사용한다. LLM 없는 precheck 게이트(scripts/sync_gate.py)가 새 글을 찾을 때만 에이전트를 깨우고, tick이 미디어 수집·글자수 초과 스레드 분할 초안까지 준비한 뒤 사용자 승인(social-posting의 "게시 승인" 훅 계약)을 거쳐 게시한다. setup(최초 설정·첫 실행 며칠치 질문)/tick(무인)/approve(승인·게시)/status 모드가 있다. Threads 게시는 실환경 검증 전까지 대상에서 제외한다.
version: 0.1.3
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
5. 첫 동작 확인은 `/social-sync tick`을 제안한다. 아직 스캔한 적이 없으면 tick이 직접 스캔한다. 설정이 이미 있으면 초기화를 멈추고 `status`로 확인한다. 다시 설정한다고 기존 워터마크나 대기열을 지우지 않는다.

## tick 모드 — 무인 처리

**이 세션은 무인이다. 도구로 묻지 않고, 승인 없는 게시를 하지 않고, 마지막 메시지가 보고서다.**

1. wake 선점:

```bash
uv run "${CLAUDE_SKILL_DIR}/scripts/sync_gate.py" tick
```

`WAKE`면 `claim`을 이 실행의 상태 변경 명령에 사용한다. `BUSY`면 다른 실행이 스캔하거나 초안을 준비하는 중이므로 끝낸다. `NO_WAKE`면 `lastScan`의 시각·오류·조회 범위 제한을 확인하고 끝낸다. `ERROR`는 오류 내용을 보고한다. `wake-report`는 조회 전용이며, 스캔이나 선점을 대신하지 않는다.

2. **원본마다 별도 게시 작업 준비** — 각 `posts[]`의 `job` 경로와 `targets`를 그대로 쓴다. 대상은 원본 플랫폼, 미바인딩 계정 및 미검증 Threads를 제외한 목록이다. 대상이 없으면 사유를 보고하고 그 원본은 wake에 남긴다.
   - 사진이 있으면 아래 명령으로 스캔 manifest에 묶인 원본 사진과 출처를 해당 작업에 복사한다. 실패하면 사진 없는 초안을 대기열에 넣지 않는다. `defaultAlt`와 `omitted`는 보고에 쓰고 초안 메타데이터에는 넣지 않는다.

```bash
uv run "${CLAUDE_SKILL_DIR}/scripts/sync_gate.py" prepare-media \
  --claim <claim> --platform <소스> --url <원본 permalink>
```

   - `job-state.md`를 작성한다(frontmatter: `stage: 7`, `slug`, `root`, `created`·`updated`, `platforms: [대상 집합]`, `accounts: {플랫폼: 바인딩 신원}`(flow style), `source: {type: scan, platform, url, scanned_at}`, `status: {<p>: ready}`, `post_intent: summary`).
   - `drafts/<p>.md`를 **원문 그대로** 작성한다(리보이싱하지 않는다). 형식은 social-posting `assets/state-schema.md`를 따른다: frontmatter(`platform`, `format`, `media`에 `source: scan`·`sha256`·`provenance`·`provenance_sha256`) + 본문. 글자수 상한을 넘으면 의미 단위로 `=== POST ===` 세그먼트를 나누고 `format: thread`로 쓴다(X 280 weighted·Bluesky 300 grapheme, 스레드 지원은 X·Bluesky·Threads, X 상한 25). 사진은 플랫폼 상한(X·Bluesky 4장)까지만 붙이고 잘린 분은 보고에 남긴다. Bluesky는 사진마다 alt가 필수다 — 원본 alt가 없으면 `이미지`로 채우고 보고에 표시한다(승인 단계에서 고친다). Facebook은 `visibility`를 생략한다(기존 설정 유지).
   - `mark-pending`이 공용 `check-drafts.py` 검사에 통과한 글만 대기열에 넣는다:

```bash
uv run "${CLAUDE_SKILL_DIR}/scripts/sync_gate.py" mark-pending \
  --claim <claim> --platform <소스> --url <원본 permalink> --job <작업 경로>
```

   - 응답·인용·리트윗으로 확인한 글은 같은 `--claim`, `--platform`, `--url`과 `mark-skipped --reason <사유>`로 기록한다. 실패한 글은 소비하지 않고 다음 글을 처리한다. 소유권 오류가 나면 작업을 멈춘다.

3. **남은 원본 반환** — 실패 등으로 원본이 남았다면 `release-wake --claim <claim>`을 호출한다. 다음 tick이 남은 원본만 새 작업 경로에서 준비한다. 프로세스가 중단돼 선점이 남았다면 `status`의 `wakeClaim`을 확인한다. 이전 실행이 완전히 종료됐음을 사람이 확인한 뒤에만 같은 명령으로 반환한다.
4. **보고** — 승인 대기, 건너뛴 원본, 준비에 실패해 남은 원본을 구분한다. 스캔 오류·조회 범위 제한과 사진 기본 alt·장수 제한도 알린다. 게시하지 않는다.

## approve 모드 — 승인·게시 (대화형)

1. 대기열 확인:

```bash
uv run "${CLAUDE_SKILL_DIR}/scripts/sync_gate.py" status
```

`pendingCount`가 0이면 알리고 끝낸다.
2. 각 `pending[]`의 `readyTargets`만 승인 대상으로 올린다. `review`가 있거나 이미 일부 게시·결과 불명·중단으로 기록된 대상은 재게시하지 않고 사용자에게 확인을 안내한다. 각 작업의 초안(플랫폼·본문·사진·alt·출처)을 보여준다. **작업 활성화** — 승인 훅이 이 포인터를 읽는다:

```bash
printf '%s\n' <작업 경로> > "${TMPDIR:-/tmp}/social-posting-current-job"
```

3. AskUserQuestion으로 승인받는다. **계약 문구를 문자 그대로 쓴다** — header는 정확히 `게시 승인`, question 본문에 정확히 한 줄 `게시 대상: <이 작업에서 게시할 플랫폼 csv>`(예: `게시 대상: x,bluesky`), options `게시`/`수정`/`보류`. 훅이 실제 응답만 영수증(`receipt.json`의 `approved_digests`)으로 기록한다. 에이전트가 영수증을 직접 만드는 방법은 없다.
   - `게시` → 이번에 승인한 각 대상에 아래 명령을 실행한다. 명령이 게시 시도를 먼저 기록한 뒤 기존 `publish.sh`의 승인·계정·초안 검사를 거쳐 게시한다. `publish.sh`를 직접 호출하면 동기화 시도 기록을 건너뛰므로 사용하지 않는다.

```bash
uv run "${CLAUDE_SKILL_DIR}/scripts/sync_gate.py" publish-pending \
  --platform <소스> --url <원본 permalink> --target <p>
```

     `POSTED`는 URL이 없어도 성공이다. `POST_FAILED`와 `GUARD_BLOCKED`만 원인 해결 후 다시 승인받을 수 있다. `PARTIAL_POSTED`, `POST_UNKNOWN`, `IN_PROGRESS`는 중복 게시를 막기 위해 재시도하지 않는다. 운영자가 이미 게시된 것을 확인한 경우에만 `mark-synced --platform <소스> --url <원본 permalink> --target <p> --target-url <게시 URL>`로 기록한다. 조회 또는 결과 확인은 게시 승인을 대신하지 않는다.
   - `수정` → 초안을 고치고 `check-drafts.py` 재검사 → 같은 계약으로 다시 승인받는다(초안이 바뀌면 digest가 바뀌므로 재승인이 필수다).
   - `보류` → 그 작업을 건너뛴다(pending 유지).
4. 한 작업이 끝나면 다음 작업으로 옮겨가며 포인터를 갱신한다. 여러 작업을 동시에 승인하지 않는다.

## status 모드

```bash
uv run "${CLAUDE_SKILL_DIR}/scripts/sync_gate.py" status
bash "${CLAUDE_SKILL_DIR}/scripts/automation-register.sh" --status
```

워터마크, 글 상태, 대기 중인 대상과 결과, 남은 wake, automation 등록 상태를 보고한다. `drift: true`면 기존 자동화의 precheck와 프롬프트를 확인하도록 안내한다. 상태를 초기화하거나 자동화를 중복 등록하지 않는다.

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
- 미처리 wake가 없을 때만 precheck가 브라우저를 연다. 현재 브라우저 스캔은 조회 범위 전체를 확인하지 못할 수 있다. 이 경우 워터마크를 그대로 두므로 다음 스캔에서 일부 글을 다시 읽을 수 있고, 관찰 한도를 넘긴 글은 발견하지 못할 수 있다.
- precheck 스캔은 플랫폼당 최대 120초(시간 초과는 오류로 기록, `--gate` 모드는 6시간에 한 번만 오류 기상).
