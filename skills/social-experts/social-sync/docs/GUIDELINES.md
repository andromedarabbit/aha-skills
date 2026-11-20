# social-sync 운영 지침

## 무인 원칙이 최우선이다

tick 모드는 사람 없이 돌아간다. 이 원칙을 깨는 변경(무인 게시, 무인 질문)은 하지 않는다. 게시는 항상 approve 모드의 사람 승인 — social-posting의 "게시 승인" 훅 계약 — 을 거친다. 이 계약 문구(header `게시 승인`, 답변 `게시`, question의 `게시 대상: <csv>` 한 줄)를 임의로 바꾸면 훅이 영수증을 기록하지 못하고 publish.sh가 실패-닫힘으로 거부한다.

## 상태 전이는 게이트 스크립트로만

`tick`에서 wake를 선점하고, `mark-pending`으로 원본을 대기열에 넣는다. 게시는 `publish-pending`이 기존 가드를 호출해 대상별 시도와 결과를 기록한다. 결과가 불명확하면 재실행하지 않고 먼저 실제 게시 여부를 확인한다. `state.json`을 손으로 수정하거나 기존 설정을 초기화하지 않는다.

## 스캔 산출물 레이아웃을 유지한다

`fetch-media`는 스캔이 반환한 `<wake>/scans/<scan-id>/<platform>` 절대경로와 후보 ID를 확인한다. manifest 영수증에 경로가 묶이므로 스캔 디렉터리를 옮기면 검증에 실패한다. `prepare-media`는 `fetch-media`로 검증한 사진과 출처 파일만 원본별 초안 작업으로 복사한다.

## 유사도 임계값은 양쪽을 함께 바꾼다

게이트의 `SIMILARITY_THRESHOLD = 0.6`은 social-posting `ego-post.mjs`의 `compareCandidates` 임계값과 짝이다. 한쪽만 바꾸면 tick과 gate의 판정이 갈린다.

## Threads는 검증 전까지 게시 금지

`config.threadsVerified` 플래그는 실환경 게시 1회 검증(SKILL.md "Threads 게시 검증" 절) 후에만 켠다. 검증 없이 플래그만 켜면 ego-post·publish.sh·record-approval.sh 세 곳의 가드가 아니라 실제 미검증 게시가 나간다.

## 시맨틱 버저닝

게이트 종료 코드·상태 스키마·승인 계약을 바꾸는 변경은 major로 올린다(orca automation과 설치된 shim이 구 버전 규약에 묶일 수 있다). 그 외 추가는 minor, 수정은 patch.
