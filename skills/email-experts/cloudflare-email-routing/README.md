# cloudflare-email-routing

Cloudflare Email Routing과 Gmail을 함께 쓰는 도메인의 메일 운영을 돕는 스킬이다. 라우팅 설정 검수, SPF·DKIM·DMARC 진단, DMARC 집계 리포트 분석, 스푸핑 인시던트 대응, 월간 헬스체크를 다룬다.

## 빠른 시작

```text
이메일 라우팅 설정 검수해줘          → 모드 B (온보딩·검수)
DMARC 리포트 분석해줘                → 모드 D (리포트 분석, 리포트 디렉터리 필요)
스푸핑 메일 분석해줘                 → 모드 A (인시던트 대응)
도메인 메일 건강검진 해줘            → 모드 C (헬스체크, baseline JSON 필요)
```

## 준비물

- `cf` CLI (beta) 설치와 `cf auth login` — 쓰기와 라우팅 조회에 필요
- `dig`, `jq`, `uv`
- 헬스체크용 baseline JSON — `assets/baseline-schema.json`을 복사해 실측값을 채운다. 저장소에 커밋하지 않는다.
- 알림을 받으려면 `NOTIFY_FROM`, `NOTIFY_TO` 환경변수 (선택: `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`)

## 스크립트 직접 실행

```bash
# 헬스체크 (읽기 전용)
bash scripts/healthcheck.sh --zone example.com --baseline ~/baselines/example.com.json --md-out /tmp/hc.md

# DMARC 집계
uv run --script scripts/dmarc_report.py ~/dmarc-reports/

# 테스트
bash scripts/tests/run.sh
```

## 설계 원칙

- 스킬 파일에 실제 도메인·주소·정책값을 넣지 않는다. 기준값은 항상 파라미터다.
- 쓰기는 "현재값 → 바꿀 값 → 승인 → 단일 레코드 변경 → 재조회" 순서를 거친다.
- 무인 실행은 읽기 전용 헬스체크만 한다. Gmail에 의존하지 않는다.

## 관련 스킬

- `gmail-triage` — Gmail 메일함 정리
- `cloudflare` 플러그인 — Cloudflare API 일반 참조

자세한 절차는 `SKILL.md`와 `docs/INDEX.md`를 본다.
