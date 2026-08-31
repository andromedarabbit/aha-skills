---
module: writing-experts
date: 2026-08-31
problem_type: best_practice
component: skill-design
severity: low
applies_when: "authoring skills whose docs promise cross-file invariants — identical gate phrases, frontmatter values, agent names, or section names that other files machine-judge"
symptoms:
  - "문서가 '문구가 어느 한쪽에서 달라지면 게이트 판정이 갈린다'고 경고하는데 그 동기화를 검사하는 코드가 없다"
  - "개명 복제로 에이전트 파일의 frontmatter name이 파일명과 어긋나도 저장소 어느 검증기도 잡지 못한다"
  - "awk 프론트매터 파서가 닫는 구분자 없는 파일을 끝까지 frontmatter로 수집해 본문 필드가 검사를 통과한다"
root_cause: "`inadequate_documentation` — 문서 간 약속이 산문 경고로만 존재하고 기계 검증 계층이 없음"
resolution_type: tooling_addition
tags:
  - skill-authoring
  - test-runner
  - invariant
  - mirror-test
  - gate-formula
---

# 문서 불변식은 산문 약속으로 두지 말고 스킬 러너가 기계 검증하게 한다

## Context

블로그 파이프라인 스킬의 코드 리뷰(2026-08-26, 20파인딩)에서 같은 클래스가 반복됐다. 게이트 판정식은
5개 파일에 복사돼 있고 문서 스스로 "문구가 달라지면 게이트 판정이 갈린다"고 못박았는데, 그 동기화를
검사하는 코드는 없었다. `check_agent`는 frontmatter `name`의 존재만 grep하고 값과 파일명을 대조하지
않아, 개명 누락(`blog-auditor.md` 안에 `career-memoir-auditor` 잔존)을 저장소 어디서도 잡지 못했다.
awk 프론트매터 파서는 닫는 `---`가 없으면 파일 끝까지 수집해 본문의 필드 패턴 줄까지 값으로 삼았다.
이 저장소에는 "문서로만 존재하던 게이트가 조용히 안 돌았던" 전례(훅 경로 사고)가 있어, 이 클래스는
이미 실害을 낸 적이 있다.

이것의 일반형은 미러 테스트 공백이다: 문서 A가 문서 B와의 동기화를 **주장**해도, 그 주장을 확인하는
테스트가 없으면 CI는 초록불이고 드리프트는 첫 실행 실패로만 발견된다.

## Guidance

스킬 문서의 상호 불변식은 **그 스킬의 테스트 러너가 기계 검증한다**. 이 저장소의 구현:
`skills/writing-experts/shared/test-runner.sh` (공용 러너 — 4개 스킬 사본을 래퍼화)가 세 검사를
파라미터로 제공한다.

1. **동일 문구 고정 검사** — 래퍼가 `GATE_PHRASE`(핵심 부분문자열)와 `GATE_FILES`를 export하면
   공용 러너가 `grep -Fq`로 각 파일 존재를 단언한다. 소비자(compiler) 러너가 5곳 전부를, 생산자
   (interviewer) 러너는 자기 3곳만 검사해 책임을 나눈다.
2. **값 대조 검사** — `check_agent`에 delimiter 쌍 검사(닫는 `---` 부재 거부)와 name 값 ↔ 파일명
   대조를 추가한다. tools는 이미 값 대조를 했으므로 name만 빠진 비대칭이었다.
3. **음성 테스트로 검사의 실효성 입증** — 새 검사는 "거짓 통과" 여지를 스스로 점검해야 한다. 판정식을
   일부러 드리프트시키고(name을 일부러 틀리고, delimiter를 지우고) 러너가 실패하는지 확인했다 —
   4/4 감지. 검사 추가 커밋에는 이 음성 테스트 결과가 근거로 따라간다.

설계 기준: **검사 위치는 계약의 소비자 쪽**이다(컴파일러가 판정식을 기계 판정하므로 compiler 러너가
전체를 검사), **공용 로직은 세 번째 사본 임계점에서 추출**한다(러너 4벌 시대를 공용 러너 + 5줄 래퍼로
종료 — 단, 래퍼가 `skills/<카테고리>/<스킬>/scripts/tests/run.sh` 탐색 계약 경로를 유지해야 CI가 여전히 발견한다), **레거시
스킬의 합법적 위반은 opt-in 파라미터로 스코프**한다(career-memoir는 vault 경로 명시가 설계라 경로
독립 검사를 끈다 — agents/ 디렉토리 전체 스캔이 아니라 의존 에이전트 정의만 검사 대상으로 좁힌 것도
같은 이유다).

## Applicability

교차 문서 불변식(동일 문구·이름·섹션명·경로 규약)을 약속하는 모든 스킬에 적용한다. 판정 기준: "이
약속이 어긋났을 때 첫 발견 주체가 CI여야 하는가, 아니면 런타임 실패 사용자여도 되는가" — 전자면 러너
검사 대상이다. 적용 비용은 러너에 grep 몇 줄이지만, 미적용 비용은 "조용히 안 돌았던 게이트"라는
형태로 사용자에게 전가된다. 검증은 반드시 음성 테스트(일부러 깨뜨리기)로 마친다 — 검사 코드의 존재는
검사의 실효성과 다르다.
