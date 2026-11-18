---
name: social-posting
description: 선택한 소셜미디어 그룹의 조회·교차 비교·초안·승인·게시를 조정한다. "Facebook 글을 X와 Bluesky에 맞춰줘", "선택한 플랫폼만 준비해줘", "최근 글 확인해서 다른 곳에도 올려줘", "/social-posting" 요청할 때 사용한다. 단일 플랫폼 작업도 호환하며 전용 x-expert·facebook-expert·bluesky-expert·threads-expert·linkedin-expert·instagram-expert로 직접 요청할 수 있다. 요청한 동작만 수행하고 기존 초안 게시에 재작성을 강제하지 않는다. 최근 글은 Facebook·Threads·X·Bluesky의 기본 최근 24시간(기간 변경 가능), LinkedIn scan은 비지원이다. X·Bluesky 답글 체인·사진을 지원한다. Instagram 사진 피드 조회·비교·캡션/사진 초안을 지원하며 Instagram·Threads 게시는 실환경 미검증으로 차단한다. 유사 후보 확인과 최종 게시 승인은 별도이며 표시한 대상만 승인한다. 무인 실행은 수집·비교·보고만 한다.
version: 0.13.0
context: inline
language: "korean"
dependencies:
  - ego-browser>=0.6.3
  - node>=24
  - uv>=0.4.0
  - jq>=1.6
---

# 소셜미디어 포스팅 (ego lite 연동)

선택한 플랫폼의 공통 소재·교차 비교·문안 묶음·승인을 조정한다. **게시 API를 직접 호출하지 않는다.** 실행·상태·사진·승인 가드는 이 스킬의 공통 스크립트를 재사용하며 전문가마다 복사하지 않는다. 기존 단일 플랫폼 요청도 계속 처리한다.

이 스킬은 `context: inline`이라 주 대화에서 직접 실행된다. "질문"/"확인"/"승인"이라고 적힌 지점에서는 **AskUserQuestion을 호출**해 구조화된 선택 UI로 물어본다. 텍스트로 선택지를 나열하고 사용자 응답을 기다리는 방식은 쓰지 않는다 — 게이트가 대화에 묻혀 놓칠 수 있다. 가까운 확인은 한 AskUserQuestion 호출에 여러 문항으로 묶는다. **각 문항의 선택지는 2~4개** — 1개면 호출 자체가 `Invalid tool parameters`로 거부된다.

## 시작 동작: 요청한 동작·대상만 선택

대화에서 확정된 동작·플랫폼을 먼저 읽는다. 인자가 없거나 동작이 모호하면 AskUserQuestion으로 **조회·비교 / 초안 / 기존 초안 게시 / 기타 작업**을 묻는다. 플랫폼은 별도 문항으로 받는다. 스킬 호출만으로 게시 의도를 가정하지 않는다.

- **조회·비교만**: Stage 1·1.5에서 선택 플랫폼만 관찰·비교하고 한계와 함께 보고한 뒤 종료한다. 초안·canonical·보이스 수집·게시 승인을 요구하지 않는다.
- **초안만**: 제공된 소재·보이스를 재사용해 Stage 3·5·6·7을 수행하고 종료한다. 부족한 정보만 묻고 setup·bootstrap을 강제하지 않는다. 사진이 필요하면 Stage 1.5의 사진 준비·권리 확인만 적용한다.
- **기존 초안 게시**: 기존 작업·대상 초안·계정·영수증·게시 기록을 복구한다. material·canonical을 다시 쓰지 않는다. Stage 2의 계정 확인 → 대상별 Stage 7 검사 → Stage 8·9·10으로 간다.
- **bootstrap만**: 선택 플랫폼의 계정 확인·Stage 4 수집과 보이스 검수 후 종료한다. 게시 작업을 만들거나 활성화하지 않는다.
- **readback만**: 지정 URL과 승인 본문으로 Stage 10만 수행하고 종료한다.
- **전체 작성·게시**: 필요한 Stage를 순서대로 수행한다. 요청하지 않은 scan은 강제하지 않는다.

단일 플랫폼은 해당 전문가를 직접 사용할 수 있다. 복수 요청에서는 전문가 SKILL 본문 여섯 개를 일괄 로드하지 않고 아래 **선택한 플레이북만** 읽는다. 질문·계정 선택·최종 승인은 주 대화가 담당한다. 질문 없는 작성·비교를 위임할 때는 해당 문서 절대경로와 상대 참조를 풀 기준 디렉터리, 선택 플랫폼·동작·산출물만 전달한다. 워커에게 브라우저·작업 활성화·승인·게시를 맡기지 않는다.

| 플랫폼 | 전문가 플레이북 | 기존 지원 범위 |
| --- | --- | --- |
| X | `${CLAUDE_SKILL_DIR}/../x-expert/docs/playbook.md` | 최근·permalink scan, bootstrap, 단일·답글 체인·사진·readback |
| Facebook | `${CLAUDE_SKILL_DIR}/../facebook-expert/docs/playbook.md` | 최근·permalink scan, bootstrap, 단일·사진·공개 범위·readback |
| Bluesky | `${CLAUDE_SKILL_DIR}/../bluesky-expert/docs/playbook.md` | 최근·permalink scan, bootstrap, 단일·답글 체인·사진·readback |
| Threads | `${CLAUDE_SKILL_DIR}/../threads-expert/docs/playbook.md` | 최근·permalink scan, bootstrap, 초안만; 쓰기 차단 |
| LinkedIn | `${CLAUDE_SKILL_DIR}/../linkedin-expert/docs/playbook.md` | 기존 bootstrap·단일·사진·readback; 최근 글·permalink scan·scan 사진 fetch 비지원 |
| Instagram | `${CLAUDE_SKILL_DIR}/../instagram-expert/docs/playbook.md` | 명시 선택한 사진 피드 최근·permalink scan, bootstrap, 캡션·사진 초안·readback; 쓰기 차단 |

Instagram은 기본 scan 집합에 자동 추가하지 않는다. 게시 요청에 포함됐으면 `INSTAGRAM_UNVERIFIED`와 차단 상태를 먼저 알리고 최종 게시 승인 집합에 넣지 않는다. 혼합 요청에서 Instagram을 조용히 빼고 나머지를 게시하지 않는다. 다른 대상만 진행할지는 AskUserQuestion으로 확인한다. 기존 초안·platforms·전체 accounts·출처·게시 기록은 그대로 보존한다.

브라우저 읽기·계정 확인·게시가 필요할 때만 preflight를 수집한다. 초안 작성만으로 환경 점검을 강제하지 않는다.

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/preflight.sh"
```

출력은 JSON 한 줄이다(항상 exit 0, 실패는 필드에 표시). ego-browser가 없으면 브라우저 작업은 설치 안내 후 중단한다.

이전 Aside 기반 버전에서 권한 일괄 허용을 썼다면 플러그인 업데이트로 기존 자동 허용이 회수되지 않는다고 알린다. 회수를 원할 때만 계정별 기존 규칙을 조회해 대상 규칙을 보여주고 별도 승인을 받는다. 승인한 규칙만 삭제한 뒤 재조회하며, 다른 용도의 규칙·ask·deny·기본값은 건드리지 않는다. 미회수 상태를 숨기지 않는다. 상세 절차는 사용자가 요청할 때만 `docs/REFERENCE.md`의 "Aside에서 이관할 때 기존 권한 회수"를 읽는다.

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
    ├── drafts/               # x.md | linkedin.md | facebook.md | bluesky.md | threads.md | instagram.md
    └── post-log.md
```

상세 형식의 유일한 source of truth는 `assets/state-schema.md`와 `assets/voice-profile-schema.md`다. 스키마와 다른 표기를 발견하면 그쪽이 틀린 것이다.

## 스테이지

### Stage 0 의존성 확인

PreToolUse 훅이 `*ego-post.mjs*` Bash 호출 시 자동으로 check-deps.sh를 돌린다. 명시적으로 호출하지 않는다.

### Stage 1 preflight

위 "시작 동작" 그대로. 결과는 Stage 2의 선택지 재료가 된다. 출력의 `ego.binding`은 플랫폼별 신원 바인딩 상태다 — 바인딩 안 된 플랫폼은 Stage 2에서 setup을 돌려 신원을 확정한다. `ego.available`이 false면(ego-browser CLI 부재) 설치 안내 후 중단한다.

### Stage 1.5 최근 글 scan — 수동·Orca 공통

최근 글 요청에 플랫폼이 명시되면 그 플랫폼만 관찰한다. 생략하면 기본 Facebook·Threads·X·Bluesky 중 바인딩된 플랫폼을 대상으로 한다. LinkedIn scan은 비지원으로 보고하고 다른 스킬·API로 우회하지 않는다. 기간을 생략하면 최근 24시간이다. 실행 시작 시 timezone이 있는 `until`을 한 번 고정하고 `since`를 계산해 모든 플랫폼에 같은 `[since, until)`을 전달한다. 명시 기간이 있으면 그 구간을 쓴다. 바인딩되지 않은 플랫폼과 접근 실패는 빈 결과로 숨기지 않는다. 무인 실행에서는 setup하지 않고 누락 플랫폼을 보고한다.

플랫폼별 `ego-post.mjs scan` 산출물과 manifest 경로·digest를 보존한다. 입력 `jobDir`는 게시 작업 루트이고 결과의 `jobDir`는 `scans/<scan-id>/<platform>/`다. 후속 fetch에는 반환 경로를 쓴다.

```bash
printf '%s' '{"platform":"x","since":"<timezone 포함 시작>","until":"<고정 종료>","cursor":null,"jobDir":"<게시 작업 절대경로>"}' \
  | node "${CLAUDE_SKILL_DIR}/scripts/ego-post.mjs" scan
```

사용자가 특정 타인 글을 지정하면 같은 scan 입력에 검증할 플랫폼 게시물 `postUrl`을 더한다. 타인 피드 전체는 탐색하지 않는다. 사진 전용 글도 후보로 유지한다. 시간을 읽지 못한 글은 시간 미상 검토 항목이지 최근 글로 확정한 후보가 아니다. `coverage.complete:false`이면 중단 이유를 함께 보여준다. `compare`의 `new`는 **관찰 범위 내 대응 글 미발견**이며 전체 이력의 미게시 증명이 아니다. 확인된 parent 관계의 답글 묶음과 `post-log.md`의 게시 결과도 비교 근거로 사용한다. 의미가 비슷한 재작성은 사용자 검토 대상으로 남긴다.

Facebook은 정상 UI가 받은 Document·GraphQL 응답에서 **동일 Story의 ID·permalink·작성자에 연결된 시각**을 우선 보강한다. 본문·사진·parent·신원은 기존 DOM 관찰 근거를 유지한다. 다른 글이나 중첩 인용의 `creation_time`은 쓰지 않으며 결합하지 못한 시각은 미상으로 남긴다. 수신 응답을 읽었다고 전체 이력 수집이 완료된 것은 아니다. 네 플랫폼의 실제 selector·신원·시각 동작은 별도 읽기 전용 실측으로 확인하며, 오프라인 회귀 통과와 구분해 보고한다.

Bluesky는 같은 글의 시각 링크로 원문 URL을 식별하고, 정상 UI가 받은 피드 응답의 게시물 ID·작성자가 일치할 때만 `record.createdAt`을 결합한다. 분 단위 tooltip·상대시간·`indexedAt`·인용 글의 시각으로 대신하지 않는다. 본문·사진·parent는 DOM 관찰을 유지하며 결합 불가는 시각 미상이다.

Instagram은 명시적으로 선택했을 때만 사진 피드를 관찰한다. 고정글을 최신순으로 가정하지 않고, 캡션·작성자·정확한 시각·사진을 같은 게시물 컨테이너에 연결한다. carousel은 실제 관찰한 슬라이드만 보존하고 누락을 추측하지 않는다. 댓글·추천 글·아바타·영상 썸네일을 원본 근거로 쓰지 않는다. 로그인 신원과 원본 게시자를 구분하며 접근 실패·DOM 미인식을 빈 조회 성공으로 보고하지 않는다. 실제 UI는 미검증이다.

`compare`에는 원본 scan 후보를 `candidate`, 대상의 `candidates`와 시간 미상 `review`를 `existing`으로 넣고 `targetPlatform`·대상 `coverage`를 함께 전달한다. `post-log.md`에 원본 URL·대상 플랫폼·상태·게시 URL이 확인된 기록만 `postLog: [{sourceUrl, platform, status, urls}]`로 투영한다. 원본 연결을 추측하지 않는다.

수동 조회·비교만 요청했으면 여기서 산출물·한계를 보고하고 종료한다. 교차 게시용 초안까지 요청했으면 원본 후보 ID·URL·게시자·시각·사진 목록과 대상 플랫폼별 비교 근거를 보여주고 AskUserQuestion으로 후보와 대상을 고른다. 원본 관찰 플랫폼과 게시 대상 집합은 구분한다. Facebook 원본을 X·Bluesky로 옮기면 Facebook 문안은 만들지 않는다. 그 뒤 필요한 계정 확인·사진 준비·초안 작성으로 이어간다. scan에서 시작한 모든 후보는 Stage 8에서 유사 후보 확인을 별도로 거친다.

사진은 공개 여부가 아니라 로그인한 브라우저에서 접근 가능한지를 기준으로 준비한다. 타인 글의 접근 가능성은 재게시 권리를 뜻하지 않으므로 출처와 사용 권한을 확인한다. 사진 상한을 넘으면 각 사진의 관찰 ID·원본 URL·alt를 보여주고 사용자에게 상한 내 ID를 선택받는다. 앞의 몇 장을 조용히 택하지 않는다. alt가 없으면 이미지 설명을 보완하고 관찰된 이미지에 연결한다. manifest를 직접 수정하지 않는다.

`fetch-media`는 manifest digest 영수증과 후보·이미지·바인딩 신원을 검증한다. 선택한 사진마다 `{jobDir: <반환 scan 경로>, platform, candidateId, sourceUrl}`을 JSON stdin으로 전달한다. alt를 보완할 때는 `altOverride: {manifestDigest, mediaId, alt}`를 더한다. 같은 후보의 관찰 ID·원본 URL·digest를 함께 대조하며 다른 사진에 설명을 붙이지 않는다. 파일은 게시 작업 루트의 `media/`에 보관한다. 결과의 `path`·`sha256`·`provenancePath`·`provenanceSha256`을 초안에 `source: scan`, `sha256`, `provenance`, `provenance_sha256`으로 기록한다. 출처와 alt도 승인 대상이다. 구계약 초안에 `provenance_sha256`이 없으면 사진을 다시 준비하고 재승인한다. MIME·이미지 signature·수신 후 10 MiB 상한 검사는 전체 이미지 디코딩이나 다운로드 중 용량 제한을 뜻하지 않는다.

Orca는 실행 주기·기간 설정·후보 큐·알림·중복 실행 방지만 소유한다. `assets/orca-scan-prompt.md`를 전달 프롬프트로 사용한다. unattended 실행은 수집·비교·보고만 하고 setup·초안 확정·승인·게시·재시도·automation 등록이나 변경을 하지 않는다. 실제 selector·인증 다운로드·업로드는 별도 실환경 검증 대상이다.

### Stage 2 요구사항 수집·확인 — 입력 게이트

preflight 결과를 바탕으로 **선택한 플랫폼만 신원을 확인한다**. 대화에서 이미 확정한 동작·대상·목적은 다시 묻지 않는다. 아래 입력 게이트는 게시·bootstrap·전체 작성 중 필요한 경우에만 쓰며, 조회·기존 소재로 초안 작성에는 강제하지 않는다. AskUserQuestion은 호출당 최대 4문항, 문항당 선택지 2~4개로 나눈다:

1. 첫 호출: 플랫폼은 선택지가 4개를 넘지 않도록 X / LinkedIn / Facebook / Bluesky와 Threads / Instagram / 없음으로 나눈 두 문항으로 묻고, 소재 유형(자유 주제 / 기존 문서 재활용), 포스트 목적(티저형 / 요약형)을 함께 묻는다. 원문 링크 홍보는 티저형을 권장한다
2. 선택된 플랫폼만 setup으로 라이브 신원을 확정한다(기존 바인딩도 갱신). 플랫폼 선택 전에 setup하지 않는다:

   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/ego-post.mjs" setup --platform <p> --force
   ```

   setup은 읽기 전용 프로필 확인이다(입력·게시 없음). 다음 호출의 계정 문항은 플랫폼별 신원을 함께 보여주고 **이 계정으로 진행 / 계정 변경 후 다시 확인 / 취소**로 묻는다. 다른 계정을 원하면 사용자가 ego lite에서 로그인 계정을 바꾼 뒤 setup을 다시 실행한다. 게시 시에는 신원 불일치를 `EGO_ACCOUNT_MISMATCH`로 차단한다
3. 같은 확인 호출에 강조점·원하는 반응(필요할 때만), Facebook 공개 범위(facebook 선택 시 필수: 공개 / 친구만 / 기존 설정 유지)를 묶는다. 공개 범위는 `drafts/facebook.md` frontmatter `visibility`(`public`/`friends`/`keep`)로 기록한다

게시용 작업이 필요할 때만 기존 작업을 재사용하거나 새 작업을 만들고 활성화한다. 기존 혼합 job의 platforms·다른 초안·계정·출처·게시 기록을 자동 축소·수정·삭제하지 않는다. bootstrap-only는 작업을 만들거나 활성화하지 않는다:

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/post-state.sh" activate <job-dir>
```

`job-state.md`(frontmatter: stage, root, platforms, accounts, source, status, post_intent)를 작성한다. 이 게이트는 **입력 확인이지 게시 승인이 아니다**.

### Stage 3 소재·근거 수집

기존 문서면 읽어서, 자유 주제면 사용자 대화에서 — 사실·코드·측정치·실패·트레이드오프·사용자의 실제 관점을 `material.md`로 정리한다. 각 항목에 출처를 붙이고, 검증하지 못한 주장은 `질문 필요` 마커를 남긴다. **숫자·고유명사·실제 경험이 부족하면 지어내지 않고 AskUserQuestion으로 질문한다.**

### Stage 4 보이스 프로필 — 검수 게이트

`<작업 루트>/social/voice-profile.md`가 이미 있으면 재사용한다. 제공한 보이스·샘플로 충분하면 수집하지 않는다. 부족할 때만 사용자에게 샘플 제공 / bootstrap 수집 / 취소를 묻고 bootstrap 선택 시 아래를 수행한다:

1. 플랫폼별로 게시물을 수집한다(바인딩된 ego 신원의 프로필에서 고정 스크립트가 원문을 모은다):
   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/ego-post.mjs" bootstrap --platform <p> --count 20
   ```
2. 원본(게시물 text·url·time)은 `social/bootstrap-cache/`에 보존한다(재추출 없이 재검수 가능하게)
3. 말투·안티패턴·실제 샘플 3~5개를 추출해 `voice-profile.md` 초안을 만든다. **샘플은 verbatim만 채택**한다 — 요약본을 샘플로 넣지 않는다
4. **검수 게이트**: 프로필 초안(샘플 원문 포함)을 보여주고 이대로 저장 / 샘플 교체 / 항목 수정 중 확인받는다

안티패턴과 금지 주제는 추론만으로 확정하지 않는다 — 반드시 사용자 확인을 거친다.

### Stage 5 canonical 작성

material과 voice profile으로 **하나의 canonical message**(`canonical.md`)를 쓴다. 플랫폼별 문안은 여기서 파생한다. 이후 새 사실이 생기면 플랫폼 파생본보다 canonical을 먼저 갱신한다.

canonical을 쓰기 전 job-state의 `post_intent`를 확인한다. **teaser면 훅 후보 1개 + 링크 유도만** 담고 논지를 재서술하지 않는다 — 요약은 원문의 일이다. 링크가 없는 포스트는 티저가 성립하지 않으므로 요약형으로 취급한다. 훅 후보가 제3자의 부정적 결과(탈락·실패·평가, 익명이어도)를 다루면 **리드 훅 기본값은 논지**(무엇이 잘못됐는지)**로 두고 일화는 후반 뒷받침으로만 쓴다** — 확인 없이 일화를 리드에 세우지 않는다. 일화를 리드로 세우고 싶을 때만 프레이밍(주체·결과 강조 여부)을 AskUserQuestion으로 확인한다. 익명이라도 게시물은 공개적 평가가 된다.

### Stage 6 플랫폼별 파생

canonical을 시작 동작 표의 **선택한 전문가 플레이북만** 참고해 플랫폼별로 별도 작성한다. 같은 문장을 복사하지 않는다. 초안 파일 형식(frontmatter, 스레드 경계 `=== POST ===`)은 `assets/state-schema.md`를 따른다. 기존 초안 게시 요청은 canonical·소재를 다시 쓰지 않고 그 초안을 검사한다.

답글 게시 체인은 **X·Bluesky**에서 지원한다. Facebook·LinkedIn은 `format: single`로 작성한다. 길이 상한을 넘으면 문장 중간이 아니라 의미 단위로 `=== POST ===` 세그먼트를 만들고 `format: thread`로 전환한다. X는 280 weighted, Bluesky는 300 grapheme이며 `check-drafts.py`가 첫 세그먼트의 link까지 포함해 재검증한다. 사진과 link는 첫 세그먼트에만 붙인다. 후속 답글은 **직전 세그먼트의 게시 성공과 확인된 URL**이 모두 있을 때만 그 URL에 연결한다. URL 미회수·부분 게시·결과 불명에서는 자동 이어쓰기를 멈추고 확인된 결과를 보고한다. 스레드 구조는 해당 플레이북을 따른다.

Threads는 수집·초안 준비만 가능하다. 전체 본문 UTF-8 500바이트 규칙을 적용하지 않는다. 검사기의 codepoint는 참고값이며 `lengthVerified:false`다. 웹 UI 길이·사진·답글·read-back을 별도 허가로 검증하기 전에는 `publish.sh`와 직접 `ego-post.mjs post` 모두 `THREADS_UNVERIFIED`로 차단한다. 일반 payload나 환경변수로 해제하지 않는다.

Instagram은 사진 1~20장과 공통 캡션의 `format: single` 피드만 준비한다. 빈 캡션은 허용하지만 사진 없는 텍스트·영상·릴스·스토리·댓글 답글 체인은 거부한다. 캡션 2,200 Unicode codepoint는 링크·개행을 포함한 로컬 초안 정책이며 공식 웹 계수 확인값이 아니다. 사진 상한을 넘으면 사용자가 고르며 자동 절삭·분할하지 않는다. 사진 순서·각 alt·출처·재게시 권리·공통 방향과 원본 비율 유지 의도를 AskUserQuestion으로 확인한다. 원본에 사진이 없으면 사진 제공 또는 Instagram 제외를 묻고 임의 이미지를 만들지 않는다. 캡션 없는 글은 보이스 문장으로 만들지 않는다.

Instagram 게시 프로토콜과 read-back 코드는 합성 fixture에서만 검증한다. publish와 직접 post 모두 `INSTAGRAM_UNVERIFIED`를 유지하며 우회 옵션·환경변수를 안내하지 않는다. 실제 DOM·첨부·게시 검증, 검증용 차단 코드 변경과 일반 차단 해제는 각각 별도 승인이다. 일반 non-scan 사진의 승인 후 변경 방어는 이번에 추가하지 않았으며 차단 해제 전에 재검토한다.

### Stage 7 검증

1. **선택 대상별 하드 제약(기계 판정)**:
   ```bash
   uv run "${CLAUDE_SKILL_DIR}/scripts/check-drafts.py" <job-dir> --platform <p>
   ```
   선택한 각 대상에 실행한다. 다른 플랫폼의 미완성 초안 때문에 이 대상을 차단하지 않는다. 선택 그룹의 초안 묶음이 모두 준비됐을 때는 기존 전체 검사(`uv run "${CLAUDE_SKILL_DIR}/scripts/check-drafts.py" <job-dir>`)도 사용해 문형 경고를 확인한다. 혼합 기존 작업에 범위 밖 미완성 초안이 있으면 전체 검사를 게시 조건으로 삼지 않고 선택한 문안끼리 눈으로 대조한다.
   exit 1이면 위반 항목(플랫폼, 항목, 실측값)을 보여주고 Stage 6으로 돌아가 고친다. uv가 없으면 검사 불능 — fail-closed로 게시를 진행할 수 없다
   결과의 `warnings`(플랫폼 간 문형 중복 등)도 함께 표시한다 — 하드 제약과 달리 게시를 차단하지 않는다. 겹친 문형은 차등화하거나, 사실 문장 등 의도적 공유면 확인하고 넘어간다
   기계 경고는 정규화 10자 이상의 베리바트만 잡는다 — **각 플랫폼의 마무리 문장이 같은 문형으로 수렴하지 않았는지는 눈으로 대조**한다. 티저의 압축은 특히 이 수렴을 유도한다
2. **사실 검증**: material.md의 `질문 필요` 마커가 남아 있으면 해결하거나 해당 문구를 초안에서 제거한다. 검증 못한 기술 주장·성능 수치는 게시문에 넣지 않는다
3. **선택 휴리스틱**: 플레이북의 Heuristic 항목은 날짜·근거 붙은 힌트로만 다룬다 — 게시를 차단하지 않는다

### Stage 8 초안 승인 — 승인 게이트

이번에 게시할 플랫폼의 초안만 **함께 제시**한다. 같은 작업의 다른 초안·계정·기록은 수정하거나 삭제하지 않는다. 각 초안 옆에 계정·실제 본문·세그먼트 순서·문자 수(플랫폼 단위)·선택 사진 ID·alt·원본 출처·하드 제약 통과 상태를 표시한다. scan 후보에서 시작했거나 `compare`가 `needs_review`를 돌렸다면, 승인 게이트 전에 별도 AskUserQuestion으로 유사 후보의 URL·본문 근거·원본 플랫폼과 실제 게시 대상 플랫폼을 보여준다. 선택지는 **계속 진행 / 초안 수정 / 이번에는 건너뛰기**로 두며, 유사도만으로 자동 skip·자동 게시하지 않는다. 계속 진행을 택했을 때만 다음 AskUserQuestion을 연다:

- header: **게시 승인** — 정확히 이 문구를 쓴다
- question: **`게시 대상: x,bluesky`** 한 줄을 포함한다. 쉼표로 구분한 소문자 이름만 쓰며 공백·중복 없이 실제로 보여준 게시 대상과 일치시킨다. 허용 대상은 x·linkedin·facebook·bluesky이고 작업 `platforms`의 부분집합이어야 한다. Threads·Instagram은 승인 대상에서 제외하고 초안 준비·게시 차단 상태만 알린다
- 선택지: 게시 / 수정 / 취소

정확히 "게시" 응답이 오면 PostToolUse 훅이 **질문에 표시한 대상만** 초안 sha256으로 기록하고, `approved_digests`의 이전 승인 집합을 교체한다. 전체 계정 매핑 `approved_accounts`와 기존 `posted_*` 기록은 보존한다. 대상 누락·빈 목록·중복·미지원 이름·작업 범위 밖·초안 누락이면 새 승인을 기록하지 않는다. 기존 영수증을 지우지 않되 신규 전문가로 진입하거나 게시 대상 범위를 바꾸면 새 범위로 승인을 다시 받는다. **에이전트가 승인을 직접 기록하는 방법은 없다** — `post-state.sh`로는 `approved_*` 키를 set할 수 없다. "수정"이면 Stage 6으로 돌아가 고치고 다시 이 게이트로 온다.

Ready 판정식(기계 판정, publish.sh가 강제한다): **`approved_digests`에 해당 플랫폼이 있고 `drafts/<platform>.md`의 sha256과 일치**

### Stage 9 게시

**직접 ego-browser CLI를 호출하지 않는다.** 반드시 publish.sh를 경유한다:

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/publish.sh" --job <job-dir> --platform x
```

publish.sh가 게시 직전에 7중 가드를 검사한다 — 승인 플랫폼 여부 · digest 일치 · 하드 제약 재실행 · 계정(ego 신원) 매핑 · **승인 시점 계정 스냅샷 일치** · **본문 동결 직후 원본 digest 재검증** · **scan 사진·출처 사본의 승인 digest 검증**. scan 사진과 출처는 실행 전 전용 임시 사본으로 동결하고 그 사본만 실행 계층에 전달한다. 검사 이후 원본이 바뀌어도 업로드할 바이트는 바뀌지 않으며 사본은 실행 종료 시 정리한다. 하나라도 어긋나면 거부한다(실패-닫힘 가드 — 승인 후 초안이나 계정이 바뀌었으면 재승인 필요). 통과하면 check-drafts 페이로드 JSON(본문·media 절대경로+alt·link·visibility)에 가드 4의 ego 신원을 실어 **ego-post.mjs(ego 고정 스크립트 실행 계층)**에 넘긴다 — ego-post가 라이브 프로필 신원을 binding과 대조해 계정 재타깃을 한 번 더 차단하고, composer 입력·정확한 readback·미디어 첨부(프리뷰 확인 후, 게시 클릭 전 fail-closed)·Facebook 공개범위·스레드 답글 체인을 수행한다. **게시 성공 신호는 ego-post의 DOM 증거 판정이다**(출력 URL 감지가 아니다):

- `POSTED` + `urlRecovered:true` → 게시 URL 회수 완료, exit 0
- `POSTED` + `urlRecovered:false` → **게시는 성립했다** — exit 0과 함께 큰 경고로 프로필 URL 확인을 지시한다. URL 회수 실패로 재시도하면 중복 게시가 된다
- `PARTIAL_POSTED` → 일부 세그먼트 게시 확정, exit 1 — `postedCount`와 회수된 URL을 보고하며 **재시도 금지**
- `POST_UNKNOWN` → 클릭 이후 결과를 확정하지 못했거나 실행 응답이 유실됨, exit 1 — **재시도 금지**. 프로필에서 실제 게시 여부부터 확인한다
- `POST_FAILED` → 게시 클릭 전 실패, exit 1. 원인을 해결하고 초안·계정·승인 상태를 재확인한다

대상 플랫폼마다 한 번씩 **순차 전경 호출**로 실행한다(병렬 금지 — aside 시절 병렬은 자연어 실행 지연 흡수용이었고 ego는 전부 브라우저 UI라 경합만 남는다. 실측 2026-09-01: 브라우저+브라우저 조합 wall 422초·상한 초과). **하네스 Bash 도구의 기본 타임아웃(120초)이 ego-post 상한(세그먼트×60초+120초, 최대 570초)보다 짧다 — 반드시 timeout 파라미터를 늘려 호출한다**(single ≈ 300000ms, thread ≈ 600000ms). 한 플랫폼의 실패는 나머지를 중단하지 않고(bulkhead) 전 플랫폼의 종료 코드·출력을 보고한 뒤 Stage 10으로 간다. `posted_*` 기록(`post-state.sh set`)은 플랫폼별 호출 직후 순차로 한다.

### Stage 10 게시 후 검증 (read-back)

게시 URL로 본문을 다시 읽어 승인 문구와 일치하는지 확인한다:

```bash
printf '%s' '{"urls":["<게시 URL 목록>"],"bodies":["<세그먼트 본문 순서>"]}' \
  | node "${CLAUDE_SKILL_DIR}/scripts/ego-post.mjs" readback
```

- URL과 본문 배열은 같은 길이·같은 순서로 제공한다. 첫 세그먼트는 실제로 덧붙인 `link`까지 포함한다. 대상 URL에 해당하는 게시물 본문만 비교하며 전체 페이지 텍스트로 대신하지 않는다
- read-back은 플랫폼 간에도 순차로 실행한다(TaskSpace 하나를 공유하므로 직렬이 단순하다). 결과 `matched:false`가 있으면 **즉시 사용자에게 보고한다** — 플랫폼의 삭제·수정 창이 닫히기 전이다. 조용히 넘기지 않는다
- **스레드는 회수된 URL 전체를 배열로 넘겨 세그먼트별 일치를 확인한다**. 게시된 게시물 URL 목록 전체를 `post-log.md`에 남긴다
- Instagram read-back은 캡션 일치와 관찰한 사진 수·순서·alt를 구분해 보고한다. 사진을 전부 관찰하지 못했거나 대조할 승인 구성이 없으면 전체 검증 완료로 표현하지 않는다. 빈 캡션도 사진 근거 없이 일치 처리하지 않는다
- 결과를 `post-log.md`에 남긴다. scan 기반 작업은 원본 URL·대상 플랫폼·상태(`POSTED`·`PARTIAL_POSTED`·`POST_UNKNOWN`·`POST_FAILED`)·확인된 게시 URL 전체·read-back 결과를 함께 기록해 다음 비교에 쓴다. 부분 게시와 불명 결과는 재시도하지 않는다. 성공 URL이 확인되면 `post-state.sh set posted_<platform> <url>`로 기록한다(스레드는 첫 게시물 URL). `urlRecovered:false`로 URL을 못 얻었으면 프로필에서 게시물을 찾아 확정한 뒤 기록한다

## 압축(compaction) 대비 재개

재개할 때는 기존 job-state의 root·platforms·accounts·source·post_intent, 대상 초안·scan manifest·post-log부터 확인한다. 실제 작업이 확정된 뒤 activate하고 `post-state.sh get`으로 영수증을 복구한다. **절대 이전 승인을 가정하지 않는다.** 영수증이 비었거나 본문·계정·대상 범위가 바뀌면 Stage 8에서 다시 승인받는다. 동일 작업·범위 재개는 현재 digest·전체 계정 스냅샷·게시 기록을 대조하며, POSTED·부분·불명 결과는 재시도 허가로 읽지 않는다.

## headless 환경 (AskUserQuestion 없음)

`claude -p` 같은 headless·unattended 환경은 수집·비교·보고만 한다. 기존 영수증이 남아 있어도 setup·초안 확정·검수·승인·게시·재시도를 하지 않는다. 질문이 필요하면 그 사실과 수동 세션에 넘길 경로·후보·계정·한계를 보고하고 종료한다. 텍스트 선택지로 스스로 승인하지 않는다. 훅이 없어서 새 영수증을 만들지 못한 경우에도 게시하지 않는다.

## 게시 안전 규칙

- 게시는 되돌릴 수 없다. 모든 게시는 publish.sh의 digest 가드 뒤에서만 일어난다
- 게시 계정은 Stage 2에서 사용자가 지정한 값만 쓴다. 스킬이 임의로 정하지 않는다 — 계정 혼동(개인/사내)이 1순위 사고다
- 검증하지 못한 기술 주장·성능 수치는 게시문에 넣지 않는다

## 문서

- `docs/INDEX.md` — 문서 목록
- `assets/state-schema.md` — 작업 상태 형식의 유일한 SSOT
- `assets/voice-profile-schema.md` — 보이스 프로필 스키마
- `docs/playbook-{x,linkedin,facebook,bluesky,threads}.md` — 플랫폼별 3등급 규칙
