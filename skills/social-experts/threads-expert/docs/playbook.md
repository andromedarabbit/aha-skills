# Threads 플레이북

## 현재 지원 범위

수집과 초안 준비만 지원한다. `publish.sh`와 직접 `ego-post.mjs post`는 `THREADS_UNVERIFIED`로 차단한다. selector가 우연히 맞더라도 게시하지 않는다. 해제에는 별도 허가된 test account 검증과 후속 코드 검토가 필요하다.

## 길이와 답글 초안

[Meta Threads Posts](https://developers.facebook.com/documentation/threads/posts)는 500 characters와 이모지 UTF-8 bytes를 설명한다(2026-11-17 확인). 이를 한글을 포함한 전체 본문 UTF-8 500바이트 상한으로 해석하지 않는다. API 설명만으로 웹 UI 카운터 단위도 확정하지 않는다.

검사기는 참고 codepoint와 `lengthVerified:false` 경고를 반환한다. `format: thread`와 `=== POST ===`로 답글 초안을 준비할 수 있지만 길이 검증·실제 게시 성공을 뜻하지 않는다. 사진과 link는 첫 세그먼트에만 둔다.

별도 허가된 비게시 UI 검증에서는 ASCII 500/501, 한글 166/167/500/501, ZWJ 이모지·결합문자·링크의 실제 카운터를 기록한다. 계정 접근·입력·사진 첨부·게시 승인은 서로 구분한다.

## 사진과 출처

원본 글 URL·실제 게시자·관찰 시각·사진 ID·alt를 검토 화면에 표시한다. 접근 가능하다는 이유만으로 재게시 권리가 있다고 보지 않는다. 인증 다운로드·업로드·alt 저장·답글 연결·대상 게시물 read-back은 별도 실환경 검증 대상이다.
