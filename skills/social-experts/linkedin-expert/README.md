# linkedin-expert

LinkedIn 하나의 기존 지원 기능만 처리한다. 기존 bootstrap, 단일 글·기존 사진 게시, read-back만 지원한다. 본문 3000 codepoint 이하, 사진 9장 이하, format: single만 지원한다.

## 빠른 시작

- `/linkedin-expert LinkedIn 초안만 써줘` — 제공된 소재·보이스로 충분하면 setup·bootstrap 없이 초안을 검사한다.
- `/linkedin-expert 기존 작업의 LinkedIn 초안만 게시해줘` — 다른 플랫폼 초안은 보존하고 LinkedIn만 새로 승인한다.

최근 글 scan·지정 permalink scan·scan 사진 fetch·후속 연락은 지원하지 않는다.

여러 플랫폼 묶음은 `/social-posting`을 사용한다. 무인 실행은 읽기·비교·보고만 하며 기존 승인 영수증으로 게시하지 않는다.

## 요구사항과 경로

ego-browser>=0.6.3, node>=24, uv>=0.4.0, jq>=1.6. 공통 실행층은 sibling social-posting을 재사용하므로 social-experts 카테고리의 디렉터리 구조를 유지한다. 별도 CLI·설정 파일·계정 저장소는 없다.

셸에서 직접 검사하려면 `SKILL_DIR`을 이 전문가의 실제 설치 디렉터리 절대경로로 정한다. 플러그인 캐시의 `social-experts/<설치 버전>/linkedin-expert` 또는 이 저장소의 `skills/social-experts/linkedin-expert` 디렉터리다. CWD와 무관하게 따옴표를 유지한다.

```bash
bash "$SKILL_DIR/scripts/tests/run.sh"
```

작업 상태·보이스 스키마는 `$SKILL_DIR/../social-posting/assets/`에 있다. 사용자 작업 루트는 실행 때 확정하며 기존 job·다른 초안·로그는 자동으로 줄이거나 지우지 않는다.

## 결과와 주의사항

요청한 동작의 관찰·초안·검사·상태와 한계를 보고한다. 접근 가능성과 재게시 권리는 별개다. 계정·출처·선택 사진·alt를 확인한다. URL 없는 POSTED·부분 게시·결과 불명은 자동 재시도하지 않는다. 실제 서비스 UI·사진 업로드·게시 검증은 오프라인 연결 테스트와 다르다.

[플레이북](docs/playbook.md) · [문서 목록](docs/INDEX.md)

## 실행 방식

- 상호작용 모델: `dialog` — 자유형 대화가 핵심 → context: inline
- `context: inline`

판정 근거는 [Context 선택 판단표](../../../docs/skill-specification.md)를 따릅니다.
