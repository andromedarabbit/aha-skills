---
name: cloudflare-email-routing
description: Cloudflare Email Routing + Gmail 조합의 운영 계층 — 라우팅 설정 검수, 메일 인증(SPF·DKIM·DMARC) 진단, DMARC 집계 리포트 분석, 스푸핑 인시던트 대응, 월간 헬스체크를 다룬다. 트리거 — "DMARC 리포트 분석", "DMARC 리포트 급증", "스푸핑 메일 분석", "_dmarc 중복", "SPF/DKIM 확인", "이메일 라우팅 설정", "catch-all 점검", "도메인 메일 건강검진", "Cloudflare 이메일 라우팅", "send-as 정합". 인자가 없으면 대화 문맥으로 모드(인시던트·온보딩·헬스체크·리포트 분석)를 판별하고, 판별이 안 되면 한 번만 묻는다. 부정 라우팅 — Gmail 메일함 정리·라벨링은 gmail-triage 소관, Cloudflare API 일반 참조는 cloudflare 플러그인 소관이다. 특정 도메인의 현재 값과 기준선은 이 스킬이 알지 못하며 호출자가 baseline JSON 파라미터로 넘긴다.
version: 0.1.0
context: inline
language: "korean"
dependencies:
  - cf>=1.0.0-beta
  - dig
  - jq>=1.6
  - uv>=0.4.0
---

# Cloudflare 이메일 라우팅 운영

Cloudflare Email Routing으로 받은 메일을 Gmail 등 목적지로 포워딩하고, 같은 도메인의 발신 인증(SPF·DKIM·DMARC)을 함께 운영하는 절차를 다룬다. `cf` CLI와 공식 문서가 API 참조라면, 이 스킬은 **판단 기준·절차·쓰기 게이트**를 담는다.

이 스킬은 `context: inline`이다. 쓰기 게이트마다 사용자 승인이 필요하므로 주 대화에서 직접 실행하고, 질문은 AskUserQuestion으로 묻는다.

## 무인 실행 규칙

프롬프트 첫 줄에 `무인 실행:`으로 시작하는 선언이 있으면 **헬스체크 모드만** 실행한다. 읽기 전용 점검과 카드 코멘트 게시까지만 하고, 질문하지 않으며, DNS·라우팅 쓰기 명령(`cf dns records update`·`delete`·`cf email-routing` 변경)을 실행하지 않는다. 발송은 `notify.sh`를 통해 수신처가 `NOTIFY_TO`(운영자 본인 주소)인 이상 알림 1건으로만 허용한다. 무인 실행이 장애를 알릴 수 있어야 하므로 이 예외는 의도된 것이다. 임의 수신처로의 `cf email-sending send` 직접 호출은 금지한다. 절차는 `${CLAUDE_SKILL_DIR}/docs/playbook-healthcheck.md`를 따른다. 무인 경로는 Gmail에 의존하지 않는다.

## 모드 판별

| 모드 | 신호 | 성격 | 절차 |
|---|---|---|---|
| A. 인시던트 대응 | 스푸핑 리포트 도착, 리포트 급증, 사칭 의심 | 쓰기 포함 (게이트 필수) | 아래 "모드 A" |
| B. 온보딩·검수 | 새 도메인 라우팅 설정, 라우팅 규칙 감사, send-as 설정 | 쓰기 포함 (게이트 필수) | 아래 "모드 B" |
| C. 헬스체크 | 월간 점검, "건강검진", 무인 실행 | 읽기 전용, 질문 없음 | `docs/playbook-healthcheck.md` |
| D. 리포트 분석 | DMARC 집계 리포트 아카이브 분석 | 읽기 전용, 수집은 인터랙티브 | `docs/playbook-dmarc-analysis.md` |

모드를 판별할 수 없으면 AskUserQuestion으로 한 번만 묻는다. 선택지는 위 네 모드로 제시한다.

## 입력 — baseline 파라미터

도메인별 기준값(DMARC 정책, SPF 값, DKIM 셀렉터, MX 집합, 라우팅 규칙 수)은 스킬에 없다. 호출자가 `assets/baseline-schema.json` 형식의 JSON을 파라미터로 넘긴다. baseline이 없으면 모드 C·D는 중단하고 baseline을 요청한다. 모드 A·B는 현재 값을 먼저 조회해 사용자에게 보여주고 기준을 함께 확정한다.

## 안전 규칙 — 쓰기 게이트

모든 쓰기는 다음 순서를 지킨다. 스푸핑 대응처럼 급한 상황에서도 생략하지 않는다.

1. **현재값 표시** — 대상 레코드·규칙을 `cf ... get` 또는 `cf dns records list`로 조회해 보여준다.
2. **바꿀 값 표시** — 변경 후 값을 전후 비교로 보여준다. `cf dns records update`는 `--dry-run`으로 먼저 검증한다.
3. **승인** — AskUserQuestion으로 승인을 받는다. 승인 범위는 이번 한 번의 변경으로 한정한다.
4. **단일 레코드 연산** — 한 번에 레코드 하나만 바꾼다. 여러 레코드를 묶어 일괄 변경하지 않는다.
5. **재조회 검증** — 변경 후 같은 조회를 다시 해서 기대값과 일치하는지 확인한다.

다음은 금지다.

- 무인 실행에서 DNS·라우팅 쓰기 명령 실행, 또는 `NOTIFY_TO` 외 수신처로의 발송
- 승인 없이 `cf dns records delete` 또는 `--force` 사용
- Email Routing 활성·비활성 토글(`cf email-routing enable|disable`)을 승인 없이 실행
- 발송 테스트(`cf email-sending send`)를 승인 없이 실행 — 발송은 외부로 나가는 행위다

## 모드 A — 인시던트 대응 (스푸핑 리포트)

1. **분석**: 리포트 아카이브가 있으면 모드 D 절차로 집계한다. 없으면 현재 `_dmarc` 레코드와 `dig` 결과만 확인한다.
2. **판별**: 전 레코드가 SPF·DKIM 모두 fail이고 소스 IP가 임대 클라우드 VM에 흩어져 있으며 envelope_from이 무관한 도메인이면 **사칭 캠페인**이다. 일부 pass가 섞이면 정상 발신 경로의 정합 문제(ESP 미설정 등)를 먼저 의심한다. 두 경우를 섞지 않는다.
3. **중복 점검**: `_dmarc` TXT가 2개 이상이면 헬스체크 C1 위반이다. 마법사가 만든 중복일 가능성이 높다(GUIDELINES의 "마법사 중복 함정"). 이 경우 rua가 있는 쪽으로 통합하는 변경을 게이트에 올린다.
4. **정책 강화 검토**: 정책 강화(`none → quarantine → reject`)는 **발신 경로 정합을 실측한 뒤에만** 제안한다. Gmail send-as를 쓰는 도메인은 reject 전에 send-as 정합(GUIDELINES의 decision table)을 확인한다.
5. **쓰기 게이트**: 위 안전 규칙 1~5를 거쳐 레코드 하나씩 변경한다.
6. **Gmail 필터**: 리포트 메일 필터(`subject:"Report domain:"`)는 이 스킬이 직접 만들지 않는다. 사용자에게 필터 조건을 안내하고 Gmail 설정은 사용자가 한다.

## 모드 B — 온보딩·검수

1. **현재 라우팅 상태**: `cf email-routing settings get`, `cf email-routing addresses list`, `cf email-routing rules list-account`로 활성 여부, 목적지 주소, 규칙을 조회한다. 목록 출력 형식은 `cf schema`로 확인한다.
2. **DNS 상태**: `dig`로 MX·SPF·DKIM·DMARC를 확인하고 `cf email-routing dns get`으로 Cloudflare가 요구하는 레코드와 대조한다.
3. **검수 체크리스트**: `docs/GUIDELINES.md`의 정합 매트릭스와 send-as decision table로 발신 경로를 분류한다.
4. **보고**: 불일치는 항목별로 현재값·기대값·조치안을 표로 정리한다. 조치는 쓰기 게이트를 거쳐 하나씩 실행한다.
5. **발신 하위도메인**: 발신용 하위도메인 온보딩은 `cf-bounce` MX·SPF·DKIM·DMARC 레코드를 추가한다. 기존 `mg.` 같은 발신 하위도메인과 충돌하지 않는지 먼저 확인한다.

## 모드 C·D — 절차 위임

- 모드 C(헬스체크): `${CLAUDE_SKILL_DIR}/docs/playbook-healthcheck.md`를 읽고 `${CLAUDE_SKILL_DIR}/scripts/healthcheck.sh`를 실행한다. 스크립트가 결정론으로 판정하고 에이전트는 I/O만 한다.
- 모드 D(리포트 분석): `${CLAUDE_SKILL_DIR}/docs/playbook-dmarc-analysis.md`를 읽는다. 리포트 수집(Gmail 접근)은 인터랙티브 전용이고, 집계는 `${CLAUDE_SKILL_DIR}/scripts/dmarc_report.py <아카이브 디렉터리>`가 한다.

`docs/` 파일은 이 스킬이 실행 중에 Read로 읽는다. 그 문서 안의 명령은 스킬 디렉터리를 자리표시자로 쓰므로, 실행 전에 이 스킬의 절대 경로로 바꿔 넣는다.

## 통지

헬스체크 이상 시 `${CLAUDE_SKILL_DIR}/scripts/notify.sh`로 알린다. 우선순위는 CF Email Sending이고, 실패하면 Mailgun API로 폴백한다. 둘 다 실패하면 exit 3이며, 호출자가 카드를 CRITICAL로 표시한다. `--dry-run`으로 실제 발송 없이 명령과 자격증명 상태를 확인할 수 있다. CF Email Sending 활성 여부가 확인되기 전에는 Mailgun 자격증명이 사실상 필요하다. 필요한 값은 환경변수(`NOTIFY_FROM`, `NOTIFY_TO`, `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`)로만 받으며 파일에 저장하지 않는다.

## 결과 보고 형식

모든 모드의 끝에는 같은 순서로 보고한다.

1. **판정** — 정상 / 이상 / 환경 오류 중 하나를 맨 앞에 쓴다.
2. **근거** — 실행한 조회 명령과 기대값·실제값 표. 추정으로 채우지 않는다.
3. **변경** — 실행한 쓰기 명령과 재조회 결과. 쓰기가 없었으면 "변경 없음"이라고 쓴다.
4. **미확정** — 권한 부족(401), 조회 실패, 확인하지 못한 항목을 따로 적는다. 확인하지 않은 항목을 정상으로 표시하지 않는다.

## 보안·개인정보

- 이 스킬의 어떤 파일에도 실제 도메인·메일 주소·API 키·정책 실측값을 넣지 않는다. 예시는 `example.com`을 쓴다.
- 리포트 분석 결과에는 소스 IP와 submitter가 포함되므로, 외부 공유 전에 마스킹 여부를 사용자에게 확인한다.
- 자격증명 유출이나 교체가 의심되면 `#support-정보보안`으로 안내한다.

## 참조 문서

- `${CLAUDE_SKILL_DIR}/docs/GUIDELINES.md` — 정합 매트릭스, 정책 강화 사다리, 마법사 중복 함정, send-as decision table, 발신 하위도메인, 한계
- `${CLAUDE_SKILL_DIR}/docs/REFERENCE.md` — cf 치트시트, dig 원라이너, 리포트 XML 필드, 공식 문서 URL
- `${CLAUDE_SKILL_DIR}/docs/playbook-healthcheck.md` — 헬스체크 계약(체크 C1~C7, exit code, 통지 트리)
- `${CLAUDE_SKILL_DIR}/docs/playbook-dmarc-analysis.md` — 리포트 수집·파싱·판별 절차
- `${CLAUDE_SKILL_DIR}/assets/baseline-schema.json` — baseline 파라미터 스키마
- `${CLAUDE_SKILL_DIR}/docs/INDEX.md` — 문서 목록
