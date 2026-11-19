# Instagram 사진 피드 전문가

Instagram 사진 피드의 조회·비교, 실제 캡션 기반 보이스 수집, 사진 1~20장과 공통 캡션 초안, 지정 게시물 read-back을 처리한다. 여러 플랫폼을 함께 다루려면 `social-posting`을 사용한다.

**Instagram 게시 기본값은 private, 즉 기존 친한친구 목록에만 실제 발행이다.** 로컬 초안·나만 보기·비공개 계정 팔로워 전체 공개가 아니다. 명시적 게시 요청이나 사전에 허용한 게시 작업의 private만 건별 사람 승인을 생략한다. 조회·비교·초안은 게시 권한이 아니다. public은 공개 계정의 Everyone 대상과 캡션·사진·계정·범위에 결합된 AskUserQuestion 사람 승인이 필요하다. 범위 생략은 private이며 명시적 keep은 거부한다.

실제 composer의 대상·계정을 확인하지 못하거나 팔로워 공개·요청 불일치면 Share 전에 중단한다. 계정 설정·계정 유형·친한친구 목록을 자동 변경하지 않고 public으로 대체하지 않는다. **UI는 합성 fixture만 검증했으며 실서비스는 미확인**이다. dry-run은 정적 검사일 뿐 게시 허가가 아니다. 실계정·사진 업로드·게시 검증은 대상과 허용 동작의 별도 승인이 필요하다.

## 사용 예시

```text
/instagram-expert Instagram 최근 24시간 사진 피드만 확인해줘.
/instagram-expert 이 permalink의 캡션과 사진을 확인해줘.
/instagram-expert 이 사진 3장으로 인스타 캡션 초안만 써줘. 보이스는 첨부한 샘플을 써줘.
/instagram-expert Instagram 실제 캡션으로 보이스만 수집해줘.
/instagram-expert 이 URL의 캡션과 사진 구성을 초안과 비교해줘.
```

- 조회만 요청하면 초안·게시 작업으로 넘어가지 않는다. 기본 기간은 최근 24시간이다.
- 소재·보이스가 충분하면 초안 작성에 setup·bootstrap을 강제하지 않는다.
- 기존 초안 게시 요청은 초안을 재사용하고 private/public 정책으로 검사한다. material·canonical을 다시 쓰지 않는다.
- 사진이 없으면 사진 제공 또는 Instagram 제외를 확인한다. 21장 이상이면 사용자가 최대 20장을 고른다.
- 사진 접근 가능성과 재게시 권리는 별도로 확인한다. 사진 순서·각 alt·공통 방향·원본 비율 유지 의도를 검토한다.

## 지원 범위

| 항목 | 지원 |
| --- | --- |
| 사진 피드 | 사진 1~20장, 공통 캡션 하나, `format: single` |
| 빈 캡션 | 허용. 사진은 필수 |
| 캡션 길이 | 2200 Unicode codepoint 이하인 로컬 초안 정책. 웹 공식 계수 단위로 단정하지 않음 |
| 조회 | 최근 24시간 기본, 기간 변경, 접근 가능한 지정 사진 피드 URL |
| 게시 | publish와 직접 post에 같은 정책. private는 실제 친한친구, public은 사람 승인과 실제 Everyone 확인 |
| 무인 실행 | 기존 조회 전용 작업은 읽기만. 허용된 Instagram 게시 작업은 private 정책 또는 일치하는 public 사람 승인 필요 |

영상·릴스·스토리·DM·댓글 체인·이미지 생성과 자동 편집·자동 분할·절삭·프로필 및 계정 설정 변경은 지원하지 않는다.

## 결과를 읽을 때

- 로그인 계정과 원본 게시자는 별개다. 고정글을 최신 글로 가정하지 않는다.
- 시간 미상은 최근 글로 확정하지 않는다. `partial carousel`과 `coverage.complete:false`는 관찰 누락을 뜻한다.
- 비교의 `new`는 관찰 범위에서 대응 글을 못 찾았다는 뜻이지 전체 이력의 미게시 증명이 아니다.
- read-back은 captionMatched·media.complete·audience.requested/observed/matched를 구분한다. 관찰 범위는 close_friends/public/unknown이며 범위 불명·불일치도 이미 성립한 POSTED의 취소·삭제·재게시 근거가 아니다.
- private 결과는 authorization: policy, public은 authorization: human_approval이다. private를 사람이 승인한 것으로 기록하지 않는다.
- `POSTED`에서 URL을 회수하지 못해도 게시 성립이다. `POST_UNKNOWN`·`PARTIAL_POSTED`와 함께 자동 재시도하지 않는다.
- public 사진은 승인 전 sha256이 필수다. 모든 Instagram 사진은 읽기 전용 사본으로 동결하며 승인 후 내용·사진·계정·범위 변경은 재승인한다. scan 출처 digest 검사도 유지한다.

## 요구사항과 공통 실행층

ego-browser 0.6.3 이상, Node.js 24 이상, uv 0.4.0 이상, jq 1.6 이상을 사용한다. 새 CLI wrapper·설정·훅은 없으며 같은 카테고리의 `social-posting/scripts/`를 재사용한다. 설치·계정 연결·권한 변경은 별도 확인 없이 자동 실행하지 않는다.

기존 혼합 작업의 다른 플랫폼·초안·전체 계정 매핑·출처·게시 기록은 보존한다. private 실행은 다른 플랫폼의 승인 집합을 교체하지 않으며, public 사람 승인 훅은 전체 계정 스냅샷을 유지한다. Threads 쓰기 차단과 다른 플랫폼의 승인 정책은 바꾸지 않는다.

## 로컬 연결 검사

`SKILL_DIR`는 이 전문가의 실제 절대경로다. 클론을 사용하면 클론 루트에서 다음으로 확정한다.

```bash
SKILL_DIR="$(pwd)/skills/social-experts/instagram-expert"
bash "$SKILL_DIR/scripts/tests/run.sh"
```

플러그인 설치본은 설치 목록에서 현재 로드한 `social-experts` 설치 루트를 확인하고, 그 아래 `instagram-expert` 디렉터리를 `SKILL_DIR` 절대경로로 지정한다. 경로에 공백이 있어도 따옴표를 유지한다. 캐시의 임의 해시나 가장 최근 디렉터리를 자동 선택하지 않는다.

이 검사는 전문가 문서의 연결·지원 경계·공통 Ready 문구만 확인한다. 브라우저·사진 다운로드·업로드·게시를 검증하지 않는다. 실제 실행 절차는 [SKILL.md](SKILL.md)에 있다.

## 실행 방식

- 상호작용 모델: `dialog` — 자유형 대화가 핵심 → context: inline
- `context: inline`

판정 근거는 이 전문가에 포함된 [설계 가이드](docs/GUIDELINES.md)를 따릅니다.

## 문서

- [문서 목록](docs/INDEX.md)
- [Instagram 문안·사진 규칙](docs/playbook.md)
- [변경 이력](docs/CHANGELOG.md)
