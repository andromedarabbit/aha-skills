# Instagram 사진 피드 전문가

Instagram 사진 피드의 조회·비교, 실제 캡션 기반 보이스 수집, 사진 1~20장과 공통 캡션 초안, 지정 게시물 read-back을 처리한다. 여러 플랫폼을 함께 다루려면 `social-posting`을 사용한다.

**현재 Instagram 게시 실행은 `INSTAGRAM_UNVERIFIED`로 차단된다.** 게시 코드가 있다는 것과 실제 서비스에서 검증됐다는 것은 다르다. 게시 승인 질문·사진 업로드·Share는 진행하지 않으며 기존 영수증도 차단을 해제하지 않는다.

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
- 기존 초안 게시 요청은 초안을 재사용하고 차단을 보고한다. material·canonical을 다시 쓰지 않는다.
- 사진이 없으면 사진 제공 또는 Instagram 제외를 확인한다. 21장 이상이면 사용자가 최대 20장을 고른다.
- 사진 접근 가능성과 재게시 권리는 별도로 확인한다. 사진 순서·각 alt·공통 방향·원본 비율 유지 의도를 검토한다.

## 지원 범위

| 항목 | 지원 |
| --- | --- |
| 사진 피드 | 사진 1~20장, 공통 캡션 하나, `format: single` |
| 빈 캡션 | 허용. 사진은 필수 |
| 캡션 길이 | 2200 Unicode codepoint 이하인 로컬 초안 정책. 웹 공식 계수 단위로 단정하지 않음 |
| 조회 | 최근 24시간 기본, 기간 변경, 접근 가능한 지정 사진 피드 URL |
| 게시 | `publish.sh`와 직접 post 모두 `INSTAGRAM_UNVERIFIED` |
| 무인 실행 | 읽기·비교·보고만. 기존 영수증이 있어도 게시하지 않음 |

영상·릴스·스토리·DM·댓글 체인·이미지 생성과 자동 편집·자동 분할·절삭·프로필 및 계정 설정 변경은 지원하지 않는다.

## 결과를 읽을 때

- 로그인 계정과 원본 게시자는 별개다. 고정글을 최신 글로 가정하지 않는다.
- 시간 미상은 최근 글로 확정하지 않는다. `partial carousel`과 `coverage.complete:false`는 관찰 누락을 뜻한다.
- 비교의 `new`는 관찰 범위에서 대응 글을 못 찾았다는 뜻이지 전체 이력의 미게시 증명이 아니다.
- read-back은 캡션 일치와 사진 수·순서·alt 확인 범위를 따로 보고한다. 캡션만 맞아도 사진 전체 검증 성공은 아니다.
- `POSTED`에서 URL을 회수하지 못해도 게시 성립이다. `POST_UNKNOWN`·`PARTIAL_POSTED`와 함께 자동 재시도하지 않는다.
- 일반 non-scan 로컬 사진에는 scan 사진과 같은 승인 후 파일 변경 방어가 없다.

## 요구사항과 공통 실행층

ego-browser 0.6.3 이상, Node.js 24 이상, uv 0.4.0 이상, jq 1.6 이상을 사용한다. 새 CLI wrapper·설정·훅은 없으며 같은 카테고리의 `social-posting/scripts/`를 재사용한다. 설치·계정 연결·권한 변경은 별도 확인 없이 자동 실행하지 않는다.

기존 혼합 작업의 다른 플랫폼·초안·전체 계정 매핑·출처·게시 기록은 보존한다. 혼합 게시 요청에서는 Instagram 차단을 알리고 다른 대상만 진행할지 확인한다.

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
