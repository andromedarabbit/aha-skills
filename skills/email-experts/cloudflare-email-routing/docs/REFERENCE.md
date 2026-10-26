# 참조

`$SKILL_DIR`은 이 스킬의 설치 디렉터리다(`docs/` 상위). 실행 명령에서는 `${CLAUDE_SKILL_DIR}`를 쓴다.

## 1. cf CLI 치트시트 (beta, npm `cf`)

### 인증

```bash
cf auth whoami     # 상태 확인
cf auth login      # 브라우저 OAuth (대화형 — 사용자가 직접 실행)
```

인증 만료 시 `cf auth login`을 안내한다. 에이전트가 대신 로그인하지 않는다.

### 명령 탐색

- 모르는 명령은 `cf cli search "<작업 설명>"`. 검색어에 도메인·ID·주소를 넣지 않는다(cf 내장 가이던스).
- 옵션은 `<명령> --help`. API 요청 형태는 `cf schema <명령>`.
- 공식 문서는 `cf docs search "<질문>"`.

### Email Routing (검증됨)

```bash
cf email-routing settings get -z <zone>      # enabled, status 등
cf email-routing settings update|apply       # 쓰기 — 게이트 필수
cf email-routing addresses list -z <zone>    # 목적지 주소
cf email-routing rules list -z <zone>        # 규칙 목록 (배열)
cf email-routing dns get -z <zone>           # 필요한 MX·TXT 레코드 세트
cf email-routing enable|disable -z <zone>    # 쓰기 — 승인 필요
```

`cf email-routing rules list`가 배열을 준다는 가정은 헬스체크 스크립트 C6에서 `jq`로 검사한다. 배열이 아니면 C6은 "조회 실패(환경 오류)"로 보고한다.

### Email Sending (권한 의존)

```bash
cf email-sending limits get                  # 계정 한도 — 401이면 권한 부족
cf email-sending subdomains list -z <zone>   # 발신 하위도메인 — 401이면 권한 부족
cf email-sending send --from-address <a> --to-address <b> --subject <s> --text <본문>
cf email-sending send --dry-run ...          # 검증만, 발송 안 함
```

발송 플래그는 `cf schema email-sending.send`로 확인했다. `--dry-run`은 사전 검증에 쓴다. **실제 발송은 승인 후에만 한다.**

### DNS

```bash
cf zones list --name <domain>                        # zone ID 조회 (JSON 배열)
cf dns records list -z <zone-id> --name _dmarc.<domain>   # 이름은 FQDN으로 준다
cf dns records update <id> -z <zone-id> --body '{"name":"...","type":"TXT","content":"\"...\""}' --dry-run
cf dns records delete <id> -z <zone-id> --force    # 쓰기 — 승인 필요
```

- `--name`은 FQDN(`_dmarc.<domain>`)으로 줘야 결과가 나온다. 짧은 이름(`_dmarc`)은 빈 배열을 준다.
- `update`는 확인 프롬프트가 없으므로 `--dry-run`으로 먼저 검증한다.
- TXT 값은 따옴표 포함 문자열로 온다. update 시 `\"`로 이스케이프를 유지한다. 255자를 넘는 TXT는 분할이 필요할 수 있다.

### Email auth / security

```bash
cf email-auth dmarc-reports get       # DMARC 리포트 상태 (읽기)
cf email-auth dmarc-reports edit      # 설정 변경 — 게이트
cf email-security ...                 # 범위 밖 (GUIDELINES 8절)
```

## 2. dig 원라이너 (cf 인증 불필요)

```bash
dig +short TXT <domain>                      # SPF 포함 TXT
dig +short TXT _dmarc.<domain>               # DMARC
dig +short TXT cf2024-1._domainkey.<domain>  # Email Routing DKIM 셀렉터 (도메인별 상이할 수 있음)
dig +short MX <domain>
dig +short NS <domain>
dig +short TXT _dmarc.<domain> @<권한 NS>    # 캐시 우회
```

## 3. 리포트 XML 필드

DMARC 집계 리포트(RFC 7489 Appendix C)에서 쓰는 필드:

| 경로 | 의미 |
|---|---|
| `report_metadata/org_name` | 리포트를 보낸 리시버 |
| `report_metadata/date_range/begin`, `end` | 집계 기간(UTC epoch) |
| `record/row/source_ip` | 메일을 보낸 서버 IP |
| `record/row/count` | 해당 IP의 메시지 수 |
| `record/row/policy_evaluated/spf`, `dkim` | 정책 평가 결과 (pass/fail) |
| `record/identifiers/header_from` | From 헤더의 도메인 |
| `record/auth_results/spf|dkim` | 원본 인증 결과(도메인·셀렉터 포함) |

파일명 규약: `<submitter>!<domain>!<begin>!<end>.(xml.gz|zip)`. `dmarc_report.py`는 규약이 없어도 `org_name`으로 동작한다.

## 4. 한계 (공식 문서 기준, 확인일 2026-10-25)

| 항목 | 값 | 출처 |
|---|---|---|
| Email Routing 라우팅 규칙 | 도메인당 200개 | Email Service 한계 문서 |
| 목적지 주소 | 계정당 200개(모든 도메인 공유) | 같음 |
| 인바운드 메일 크기 | 25 MiB | 같음 |
| Reply References | 100개 | 같음 |
| zone당 도메인 (Routing + Sending 합계) | 30개(apex 포함) | Configure subdomains |
| 발신 수신자 | 1통당 50명 | Email Sending 한계 |
| 발신 메일 크기 | 5 MiB (목적지 주소 전용은 25 MiB) | 같음 |
| 헤더 크기 | 16 KB | 같음 |

발신 일일 한도는 계정 상태에 따라 자동 조정된다. 실측은 `cf email-sending limits get`으로 확인하며 권한이 필요하다.

## 5. 리서치 결과 R1~R10 (2026-10-25 프로브)

| 항목 | 결과 | 상태 |
|---|---|---|
| R1 Email Sending 활성·한도 | `limits get`과 `subdomains list`가 401(권한 부족). 활성 여부 미확정 | 미확정 — 권한 있는 토큰으로 재확인 필요 |
| R2 발신 하위도메인 온보딩 | `cf-bounce` MX·SPF·DKIM·DMARC 추가. zone당 30개 | 확정 (공식 문서) |
| R3 Email Routing 하위 동사 | `addresses`·`rules`·`settings`·`dns`·`enable`·`disable` 확인. `rules list`·`settings get` 실측 조회 성공 | 확정 |
| R4 ARC | Email Service는 ARC를 지원한다고 공식 문서에 명시 (postmaster 문서) | 확정 |
| R5 한계 | 규칙 200/도메인, 목적지 200/계정, 인바운드 25 MiB | 확정 |
| R6 send-as 검증 | GUIDELINES 4절 decision table로 정리. 조건부 정합은 R1 결과에 의존 | 흐름 확정, 활성 여부 미확정 |
| R7 `_dmarc` 현재값 | 레코드 개수와 정책을 cf API(FQDN 이름)와 dig로 대조하는 절차를 확인했다. 실측값은 문서에 두지 않고 baseline으로만 보관한다 | 확정 (절차). 값은 문서 밖에 둔다 |
| R8 email-auth·email-security | `email-auth`는 DMARC 리포트 조회 등, `email-security`는 인바운드 보안 정책 | 판정 완료 (GUIDELINES 8절) |
| R9 통지 드라이런 | 실행하지 않음 (브리프 지시) | 보류 — 대화형 게이트에서 승인 후 실행 |
| R10 리포트 Gmail 접근 | 인터랙티브 전용으로 확정. `dmarc_report.py` I/O 계약 확정 | 확정 |

## 6. 공식 문서 URL

- Email Routing 한계: https://developers.cloudflare.com/email-service/platform/limits/
- Email Routing 주소·규칙: https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/
- 하위도메인 구성: https://developers.cloudflare.com/email-service/configuration/subdomains/
- 도메인 구성·잠금 레코드: https://developers.cloudflare.com/email-service/configuration/domains/
- 이메일 인증(SPF·DKIM·DMARC): https://developers.cloudflare.com/email-service/concepts/email-authentication/
- 포스트마스터·ARC: https://developers.cloudflare.com/email-service/reference/postmaster/
- SMTP 릴레이 예제: https://developers.cloudflare.com/email-service/examples/email-sending/smtp/
- 이메일 레코드 설정: https://developers.cloudflare.com/dns/manage-dns-records/how-to/email-records/
- RFC 7489 (DMARC), RFC 7208 (SPF)
