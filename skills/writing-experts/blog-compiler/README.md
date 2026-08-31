# blog-compiler

블로그 글 인터뷰 기록을 충실한 산문 초안으로 컴파일하는 게이트 스킬. 원칙은 **추출 not 생성** — 초안의 모든 문장이 세션 원문·인용 발언에 근거해야 하고, 근거 없는 서술은 `blog-auditor` 독립 감사가 걸어낸다.

## 무엇을 하나

- 사용자의 "초안 작성" 선언 + Stage 2 완료 신호(아웃라인 표 확정)를 확인한다(전제 게이트).
- 게이트 통과 시 `WORKER.md` 7단계 프로토콜을 서브에이전트로 실행한다:
  1. 상태 로드 (논지·독자·아웃라인 표·공개 경계)
  2. `blog-compiler-worker` — 아웃라인 섹션 단위 조립 + 근거 각주
  3. `blog-auditor` — 독립 충실성 감사 (3단계 판정)
  4. 근거 없는 문장 교정 (삭제 또는 기록 내 근거로 대체)
  5. 재감사 (루프 상한 2회)
  6. `drafts/draft-vN.md` 저장 (N은 감사 통과 확정 시 증가)
  7. 윤문(`/ce-doc-review` → `/humanize-korean`) 인계 안내

## 언제 쓰나

- 블로그 글 인터뷰가 Stage 2(아웃라인)까지 끝나고 초안이 필요할 때.
- 인터뷰 진행은 `blog-compiler`가 아니라 `blog-interviewer` 담당.
- 경력 회고 초안은 `career-memoir-compiler` 담당.

## 사용 예 (트리거 문구)

```text
블로그 초안 만들어
초안 작성 시작
```

## 데이터 위치 (경로 독립)

특정 vault·저장소에 묶이지 않는다. 글 프로젝트 폴더는 호출 인자·현재 디렉토리 탐색·사용자 확인으로 확정한다:

- 압축 상태: `<글 폴더>/interview-state.md`
- 세션 원문: `<글 폴더>/sessions/YYYY-MM-DD.md`
- 초안: `<글 폴더>/drafts/draft-vN.md`

## 관련 문서

- [문서 인덱스](docs/INDEX.md)
- [구현 가이드](docs/GUIDELINES.md) — 게이트·7단계 프로토콜 설계 근거
- [레퍼런스](docs/REFERENCE.md) — 에이전트 호출 계약·판정식
