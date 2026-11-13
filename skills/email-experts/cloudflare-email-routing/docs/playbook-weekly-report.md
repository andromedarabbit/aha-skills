# 플레이북: 주간 실패 보고 (모드 E)

`$SKILL_DIR`은 이 스킬의 설치 디렉터리(`docs/` 상위)다. 호출 시 `${CLAUDE_SKILL_DIR}`에 해당하는 절대 경로로 바꿔 넣고 실행한다.

무인 계약이다. 읽기 전용이고 질문하지 않는다. 한 주 동안 Email Routing으로 들어온 메일 중 실패한 건을 사유 유형별 표로 보고한다. Unauthenticated를 포함한 실패 전체가 대상이다.

## 데이터 출처

Cloudflare Activity log와 같은 데이터인 GraphQL `emailRoutingAdaptive`(수신 이벤트)다. Gmail에는 접근하지 않는다. 토큰은 `CLOUDFLARE_API_TOKEN`(Analytics Read)이 있으면 그것을, 없으면 `cf` 로그인 OAuth 토큰을 쓴다. 둘 다 안 되면 환경 오류로 끝나며, 값을 프롬프트나 카드에 쓰지 않는다.

메시지 단위 판정: 같은 메시지의 재시도가 이벤트로 따로 잡힌다. `messageId`로 묶어, 마지막 이벤트가 `delivered`이면 "회복", 아니면 "미배달"이다. (`isLastEvent`는 라우팅 데이터에서 항상 0이라 쓰지 않는다.)

## 모드 스위치

orca precheck에 `weekly-precheck.sh`를 건다. `--mode`가 스위치다.

| `--mode` | 동작 | 에이전트 |
|---|---|---|
| `cli` | 헬스체크와 실패 표를 만들어 `NOTIFY_TO`로 발송하고 끝낸다 | 띄우지 않는다 |
| `agent` | 판정이 필요한 건이 있을 때만 에이전트를 띄운다. 없으면 `cli`와 같이 발송하고 끝낸다 | 판정이 필요할 때만 |

판정이 필요한 건은 둘 중 하나다: 후보 유형(아래 표)의 **미배달** 메시지가 있거나, 헬스체크 이상·조회 오류가 있다. 통지 발송이 실패하면 어느 모드든 에이전트를 띄워 카드에 남기게 한다.

```bash
bash "$SKILL_DIR/scripts/weekly-precheck.sh" --zone <zone> --baseline <baseline.json> --mode cli|agent [--dry-run]
```

종료 코드는 orca precheck 계약이다: `0` 에이전트 실행, `1` 스킵, `2` 사용 오류. 보고서는 `${XDG_CACHE_HOME:-~/.cache}/cloudflare-email-routing/weekly-<zone>.md`에 남는다.

## 분류 규칙

사유 문구(`errorDetail`)와 상태로 위에서부터 처음 맞는 규칙을 쓴다. 규칙은 `scripts/failure_report.py`의 `RULES`가 정본이다.

| 유형 | 판정 후보 | 설명 |
|---|---|---|
| 인증 거부(Unauthenticated) | 아니오 | Cloudflare가 인증 안 된 메일의 전달을 거부 |
| 인증 거부(검사 실패) | 아니오 | DMARC·SPF 검사 실패 |
| Cloudflare 스팸 차단 | 아니오 | Cloudflare 스팸 판정 |
| 수신자 억제(Suppressed) | 아니오 | 반복 반송·스팸 신고로 억제된 주소 |
| Gmail 전송 한도(동일 Message-ID·DKIM 도메인) | 아니오 | 일시 제한, 재시도됨 |
| Gmail 스팸 전송률 제한 | 아니오 | 일시 제한, 재시도됨 |
| **Gmail 스팸 거절** | **예** | `5.7.1 ... unsolicited` — Gmail이 스팸으로 판정해 차단 |
| **Gmail 도메인 평판 거절** | **예** | `4.7.0 ... low reputation of the sending domain` |
| **Gmail DMARC 정책 거절** | **예** | `5.7.26` — 발신 도메인 DMARC 정책에 따른 거절 |
| 발신 측 불량·연결 오류 | 아니오 | 연결 중단, From 헤더 누락 등 |
| 상위 서버 시간 초과 | 아니오 | |
| **목적지 문제** | **예** | `5.1.1`류 수신자 오류 |
| **미분류** | **예** | 규칙에 없는 새 사유 |

## 표 형식

`유형 | 이벤트 | 메시지 | 회복 | 미배달 | 대표 사유 | 발신 도메인 상위 3 | 판정`. 사유는 IP·주소·ID·도메인을 가린 요약이다. 주소 전체와 제목은 표에 넣지 않는다(도메인까지만). `판정`은 규칙 분류이면 "규칙 분류", 후보 유형의 미배달이 있으면 "확인 필요"다.

## 에이전트 단계 (agent 모드에서 깨어났을 때)

1. 보고서 경로를 읽는다. 프롬프트의 `카드:` 줄이 결과 카드 대상이다(`playbook-healthcheck.md`의 카드 규약과 같다).
2. "확인 필요" 행만 판정한다. 근거는 표의 발신 도메인·사유와 읽기 전용 `dig`(예: 발신 도메인의 `_dmarc` TXT)뿐이다. 본문이 없으므로 본문을 추측하지 않는다.
   - Gmail 스팸 거절: 발신 도메인이 정상 서비스로 보이는지 / 스팸으로 보이는지 / 판단 보류. 정상 서비스로 보이면 "정상 메일 오탐 의심"으로 표시한다. 우리 쪽에서 고칠 수 있는 설정은 없다.
   - Gmail 도메인 평판 거절: 발신 도메인 평판 문제이므로 대개 정상 차단이다.
   - Gmail DMARC 정책 거절: 발신 도메인이 `p=reject`·`quarantine`이면 포워딩으로 SPF가 깨져 거절될 수 있다는 점을 적는다.
   - 목적지 문제: 헬스체크 C8과 목적지 주소 검증 상태를 함께 본다. 수정은 사람이 한다.
   - 미분류: 사유 원문(마스킹된 것)을 인용하고 새 규칙 후보로 제안한다. 규칙 추가는 사람이 한다.
3. 판정 열이 덧붙은 최종 표로 새 본문 파일을 만들고 `notify.sh`로 `NOTIFY_TO`에 **1건만** 발송한다. `precheck`는 이 모드에서 발송하지 않았다.
4. 확신이 없으면 "판단 보류"라고 쓴다. 근거 없는 판정을 채우지 않는다.

## 금지

- DNS·라우팅 쓰기 명령, `cf email-sending send` 직접 호출
- Gmail 접근, 메일 본문 조회
- 토큰·`NOTIFY_*` 값을 출력하거나 카드에 쓰는 것
- 실패 항목을 조용히 빼는 것 — Unauthenticated를 포함해 전부 표에 남긴다

## 무인 프롬프트 예시

```text
무인 실행: 이 프롬프트는 주간 보고 모드(E)만 수행한다. 질문하지 않는다.
zone: <도메인>
baseline: <운영자 설정 디렉터리>/<도메인>.json
절차: docs/playbook-weekly-report.md 의 "에이전트 단계"를 따른다. 보고서는 precheck 가 만든 weekly-<도메인>.md 다.
판정이 필요한 행만 판정해 notify.sh 로 NOTIFY_TO 에게 1건만 보낸다. DNS·라우팅 쓰기와 Gmail 접근은 하지 않는다.
카드: 이 worktree의 orca 코멘트. 표와 판정 요약을 남긴다.
```

## 등록 절차 (사람이 수행)

```bash
orca automations edit <id> --precheck 'bash <스킬 경로>/scripts/weekly-precheck.sh --zone <도메인> --baseline <baseline.json> --mode agent' --precheck-timeout 180 --trigger '0 9 * * 1' --timezone Asia/Seoul
```

`orca automations run`은 precheck를 건너뛰므로, precheck는 위 명령을 셸에서 직접 실행해 확인한다. precheck 환경에 `NOTIFY_FROM`·`NOTIFY_TO`(발송 수단에 따라 `NOTIFY_SENDER`·`MAILGUN_*`)가 전달되는지도 확인한다.
