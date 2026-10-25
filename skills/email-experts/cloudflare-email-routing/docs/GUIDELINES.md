# 운영 가이드라인

이 문서는 `$SKILL_DIR`(= 이 스킬의 설치 디렉터리)의 `docs/` 아래에 있다. 문서 안의 `$SKILL_DIR`은 스킬 호출 시 `${CLAUDE_SKILL_DIR}`로 치환된 절대 경로를 뜻한다.

## 1. 발신 경로별 DMARC 정합 매트릭스

| 발신 경로 | DMARC 정합 | 원리 |
|---|---|---|
| Email Routing 포워딩 | 통과 (SPF+DKIM) | Cloudflare가 envelope을 `cfbounces+...@<domain>`으로 리라이트해 SPF 정합을 맞추고, 자체 DKIM(`cf2024-1`)으로 재서명 |
| 발신 하위도메인(Email Sending, 예: `mail.<domain>`) | 통과 (relaxed) | 하위도메인의 SPF·DKIM이 relaxed 정합으로 통과 |
| Gmail send-as (Gmail SMTP) | **실패** | envelope·DKIM이 gmail.com — 도메인과 무관. `p=none`은 무음, `quarantine`은 수신자 스팸함, `reject`는 거부 |
| Gmail send-as + CF SMTP 릴레이 | 조건부 통과 | Email Sending이 활성인 계정만 `smtp.mx.cloudflare.net:465` 릴레이를 제공. 이 릴레이로 send-as하면 도메인 정합이 맞는다 |

### 정정 사항

- "Gmail send-as는 절대 불가"는 과잉 일반화다. Email Sending 활성 계정은 조건부로 가능하다. 활성 여부는 실행 시 확인한다.
- DMARC 정책 기준값은 **실행 시 실측**으로 확정한다. 정책은 여러 번 바뀔 수 있으므로 스킬에 고정하지 않고 baseline으로 받는다.

## 2. 정책 강화 사다리

```text
p=none  →  관찰 (rua 리포트 수집, 발신 경로 실측)
p=quarantine  →  스팸함 격리 (정상 발신 경로가 전부 정합인지 확인 후)
p=reject  →  거부 (send-as 등 모든 정상 경로 정합 확인 후에만)
```

한 단계씩 올린다. 단계를 올리기 전에 리포트에서 **pass 레코드**가 알려진 발신 경로에서만 나오는지 확인한다. 알려지지 않은 pass는 정합 문제가 아니라 새 발신 경로이므로 먼저 등록한다.

## 3. 마법사 중복 함정

2025-07-11 실측: Cloudflare DMARC 마법사가 기존 `_dmarc` 레코드를 수정(06:54)한 5분 뒤 중복 TXT를 새로 만들었다(06:59). RFC 7489는 `_dmarc` TXT를 1개로 정의하고, 중복 시 리시버별 파서 행동이 달라진다. 실제로 한 리시버는 rua가 없는 쪽을 읽어 리포트 수신이 끊겼다.

- `_dmarc` TXT는 정확히 1개여야 한다. 헬스체크 C1이 이것을 본다.
- 마법사로 DMARC를 수정한 뒤에는 반드시 `dig +short TXT _dmarc.<domain>`으로 개수를 확인한다.
- 중복을 발견하면 rua가 있는 쪽으로 **통합**하고 나머지를 한 건씩 삭제한다(쓰기 게이트 적용).

## 4. send-as decision table

Gmail에서 도메인 주소로 보내려면 세 경로 중 하나를 고른다.

| 선택지 | 조건 | DMARC 정합 | 비고 |
|---|---|---|---|
| (a) 발신 안 함 | 회신·수신만 필요 | 해당 없음 | 가장 단순. 확인 코드만 Email Routing으로 받는다 |
| (b) CF SMTP 릴레이 | Email Sending 활성 | 정합 | `smtp.mx.cloudflare.net:465`, 사용자 `api_token`, 비밀번호는 API 토큰. 토큰은 설정 파일이 아닌 비밀 저장소에 둔다 |
| (c) Mailgun SMTP | 기존 Mailgun 발신 도메인 존재 | 정합 (하위도메인) | 기존 설정이 있으면 유지 |

흐름 (a): Gmail send-as 별칭을 추가하면 Gmail이 확인 코드를 해당 주소로 보낸다. 해당 주소가 Email Routing 규칙으로 Gmail에 포워딩되어 있으면 코드가 도착한다. 이 경로는 발신 정합과 무관하다.

선택 전 확인: 계정의 Email Sending 활성 여부(REFERENCE.md의 R1 항목). 401이 나오면 권한 문제이므로 활성 여부를 판단하지 말고 사용자에게 확인을 요청한다.

## 5. 발신 하위도메인

Email Sending은 하위도메인을 별도 발신 도메인으로 온보딩한다. 온보딩 흐름이 `cf-bounce` MX, SPF, DKIM, DMARC 레코드를 하위도메인에 추가한다(공식 문서: Configure subdomains).

- 기존 발신 하위도메인(예: `mg.`)과 이름이 겹치지 않는지 먼저 확인한다.
- 하위도메인의 DMARC는 상위 도메인 `_dmarc`와 별개다. 상위 `_dmarc` 중복 점검 대상에 포함되지 않는다.
- Email Routing 규칙은 하위도메인에도 만들 수 있다. catch-all은 apex에만 적용된다.
- zone당 Email Routing과 Email Sending을 합쳐 최대 30개 도메인(apex 포함)이다.

## 6. Email Routing 포워딩 패턴

- 주소별 필터 포워딩: 규칙 하나가 주소 하나를 목적지 하나로 보낸다. 리포트 전용 주소(rua)는 별도 규칙으로 분리해 Gmail 필터가 라벨을 붙이게 한다.
- catch-all: 모든 미매칭 주소를 한 목적지로 보낸다. 스팸 유입 시 catch-all이 가장 큰 원인이다. 헬스체크 C6의 규칙 수와 함께 확인한다.
- 목적지 주소는 사전 검증이 필요하다. 미검증 목적지로는 포워딩되지 않는다.
- 인바운드 메일 최대 25 MiB(REFERENCE.md의 한계 표).

## 7. 리포트 메일 처리 원칙

- DMARC 리포트는 기계 메일이다. 개인 메일함이 아니라 필터로 분리하고 인박스를 건너뛰게 한다.
- 리포트 수집 자체는 인터랙티브 작업이다. 무인 경로에 Gmail 접근을 넣지 않는다.
- 리포트 급증은 사칭 캠페인의 신호일 수 있다. 판별은 `playbook-dmarc-analysis.md`를 따른다.

## 8. 범위 판정

| 제품 | 판정 | 이유 |
|---|---|---|
| `cf email-auth` (DMARC 리포트 상태·설정) | 범위 안 — 읽기 전용 조회만 | 리포트 수신 상태 확인에 쓴다. 설정 변경은 쓰기 게이트 |
| `cf email-security` (인바운드 필터링·허용 정책) | 범위 밖 | 수신 스팸 필터 운영은 별도 보안 절차. 이 스킬은 라우팅과 발신 인증만 다룬다 |

## 9. 한계와 미확정 사항

- Email Sending 활성 여부와 할당량은 권한이 있는 토큰으로만 확인된다. 권한이 없으면 "미확인"으로 기록하고 추정하지 않는다.
- 발송 드라이런(통지 경로 검증)은 대화형 게이트에서 승인 후에만 실행한다. 이 스킬 릴리스 시점에는 실행하지 않았다.
- 라우팅 규칙 목록의 JSON 구조는 `cf schema`로 실행 시 확인한다. 헬스체크 스크립트는 배열 길이만 사용한다.
