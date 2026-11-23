# TASK-058 영업 신고 확인 목록 대조

SCR-047·SPEC-002/003/078과 API-012/005/006/081을 기준으로 구현했습니다. 공통 OperatorLayout/ListView를 써 넓은 화면 표와 좁은 화면 카드를 같은 열 정의로 그립니다. 토큰의 누르는 곳 최소 크기를 사용하고 긴 상호/이름은 한 줄 말줄임으로 처리합니다. 실제 두 폭과44px 측정은 아직 확인하지 않았습니다.

| 조건 | 코드와 DOM 시험 | 실제 화면 |
| --- | --- | --- |
| normal·가게 등록 정보/상세 링크·서버 차례 | 확인 | 미확인 |
| loading·최초 인증/목록/추가 조회 잠금 | 확인 | 미확인 |
| empty·탭별 빈 문구 | 확인 | 미확인 |
| error·422 처음부터 보기/500 추적ID와 재시도 | 확인 | 미확인 |
| permission·인증 전/재확인/401 뒤 기록 제거 | 확인 | 미확인 |
| stale·서울 기준 시각/새로 고침/상세 복귀 재조회 | 확인 | 미확인 |
| 사업자 정보 변경·지금 값→새 값/계좌 끝4자리/불일치 안내 | 확인 | 미확인 |
| 페이지20개/더 보기/같은 커서 재시도/중복 행 병합 | 확인 | 미확인 |
| 로그아웃204/500·중복 클릭/재시도 | 확인 | 미확인 |

## 응답 행

OperatorShopsList.interaction.test.tsx가 OpenAPI 원본을 읽어 다음15행의 상태와 문구를 실제 OperatorArea 경로에서 대조합니다. 별도 길이 단언으로 행 누락을 막습니다.

| API | 응답 예시 | 화면 |
| --- | --- | --- |
| API-012 | 200 pending | normal |
| API-012 | 200 empty | empty |
| API-012 | 401 unauthenticated | permission |
| API-012 | 422 validation_failed | error |
| API-012 | default internal | error |
| API-005 | 200 operator | normal |
| API-005 | 401 unauthenticated | permission |
| API-005 | default internal | error |
| API-006 | 204 | 로그인 이동 |
| API-006 | default internal | error |
| API-081 | 200 pending | normal |
| API-081 | 200 empty | empty |
| API-081 | 401 unauthenticated | permission |
| API-081 | 422 validation_failed | error |
| API-081 | default internal | error |

목록 DTO에는 연락처·계좌번호 전체·신고증/증빙 주소를 복사하지 않습니다. 예금주 불일치 false도 그대로 보존하며 안내만 표시합니다. 최초 운영자 인증 전에는 목록을 조회하지 않고,401 뒤에는 이미 추가한 목록도 DOM에 남기지 않습니다. bfcache는 기존 OperatorArea의 세션 재확인을 사용합니다.

## 검사와 남은 것

구현 전 UI23개 중21개 실패·2개 통과를 확인했습니다. 수정 후 원본15응답과 상호작용28개,API32개/URL15개/스타일41개를 합친4파일116개·타입 종료0·형식/lint440파일701ms가 통과했습니다. 새 상호작용5개 전의 전체 웹52파일1,174개와 빌드586ms/두 Worker도 통과했습니다. 새 빈 DB 전체 검사를 다음에 진행합니다. 실제 상태6종×두 폭/page-check는 학원컴 Aside CLI CDP 보류로 미확인이고 finished/구현 완료로 세지 않습니다.

학원컴 Aside CLI CDP는 같은 화면 제어 장애 두 번 뒤 보류 중입니다. 이 작업에서 브라우저를 추가 실행하거나 Ego/CUA로 바꾸지 않았습니다. 풀리면 상태6종×360·1280·page-check/가로 넘침/콘솔·키보드와44px를 확인합니다. 실제 운영자 계정과 상세 처리의 왕복은 그때 확인합니다.

## 최종 전체 검사

새 빈 DB에34개 마이그레이션을 차례로 적용한 전체 검사에서 서버104파일2,221개·웹52파일1,179개와 빌드817ms/두 Worker가 모두 종료0입니다. 원본9c0937ddf91d45006abc38d6eb32c577e64ac841이며 제품 코드는 이 전체 검사 뒤 바꾸지 않았습니다. 앞선 UI/API/URL/스타일116개·타입 종료0·형식/lint440파일701ms도 통과했습니다. 이제 TASK-058만의 ready PR을 열고 CI와 코드/보안 검토·수동 검토1회·main 배포를 확인합니다. 실제 학원컴6상태×두 폭/page-check/44px는 CDP 보류로 미확인입니다.
