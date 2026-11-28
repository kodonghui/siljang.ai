# TASK-161 합성 화면 확인

2026-11-28 서울의 로컬 Vite와 헤드리스 Chromium에서 OpenAPI의 합성 응답을 이용해 SCR-050을 확인했습니다. `list`, `detail`, `loading`, `empty`, `error`, `permission`, `stale`, `confirm`, `submitting`, `done`을 각각 360·1280 너비로 캡처했습니다.

`report.json`과 `states.json`의 page-check는 모두 오류 0이며 문서 가로 너비가 화면 너비를 넘지 않았고 브라우저 오류도 없었습니다. 표시된 버튼과 링크의 크기는 모두 44px 이상이었습니다. 모달이 열린 상태에서는 가려진 배경 글자에 대한 대비 수동 확인 경고가 21~28개 나왔습니다. 캡처에서 모달 본문과 버튼을 직접 보았지만 가려진 배경의 대비를 통과로 세지 않습니다.

실제 스테이징 DB·Cloudflare·운영자 계정과 학원컴 확인은 하지 않았습니다. 로컬 서버는 합성 JSON만 반환했습니다.

리뷰 처리 뒤 전체 Chromium의 합성 뒤로 가기 캐시 시험을 360·1280에서 실행했습니다. `pagehide`와 `pageshow`의 `persisted=true`를 관찰했고 복원된 `pageshow`의 첫 관찰과 로그인 재확인 전 화면에서 연 이름과 사유가 없었습니다. 첫 `pagehide` 관찰자는 화면의 삭제 처리보다 먼저 실행되어 그 순간 원문이 보였으며, 복원 결과와 구분합니다.
