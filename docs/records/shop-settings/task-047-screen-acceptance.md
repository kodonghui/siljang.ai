# TASK-047 가게 설정 화면 수락 대조

기준은 SCR-034와 API-009·010·003입니다. 합성 API는 실제 OwnerArea·ShopSettings·공통 상태/필드를 그대로 사용합니다. 실제 사장님 저장 성공은 별도로 확인합니다. 끝남 표시는 아직 추가하지 않습니다.

## 자동 시험

- 가게 조회의 성공5종과401/404/기본 실패, 저장의 성공/변경 없음/401/404/충돌 재조회/처리 중 같은 키/필드 오류/요청 키 재사용/서버 실패, 로그아웃204/실패를 상호 작용으로 대조했습니다.
- 바뀐13개 허용 필드만 baseRevision과 보내며 신원 정보는 보내지 않습니다. 빈 숫자는0으로 바꾸지 않고 서버 검증을 받습니다. 필드 오류 뒤 값 유지/첫 오류 포커스,500의 같은 키/키 재사용 실패의 새 키, 처리 중1초 뒤 같은 키/결과1회, 충돌 뒤 최신 값으로 교체를 확인했습니다.
- 실제 OwnerArea 연결에서 로그아웃 중/실패 뒤 글 보존, 재확인 중 잠금/401 로그인,503 뒤 저장 잠금과 로그아웃 허용을 확인했습니다. 보류 신고도 설정 화면에 들어오며 다른 업무는 재제출로 보냅니다. 다른 계정/가게는 컴포넌트 키로 구분합니다.
- 리뷰 수정 뒤 새 빈 DB34개 마이그레이션에서 서버104파일2,218개·웹18파일308개가 통과했습니다. 타입 종료0, 빌드687ms와 두Worker dry-run, 설계9단계도 전부 종료0입니다. 채널 확인 시작 전/10분 경계와 공백 신고번호의 면제 저장, loading의 액션 잠금을 추가 대조했습니다.

## 응답19개

다음 행은 SCR-034의 원래 표와 같은 순서입니다. 각 행의 화면 상태를 위 상호 작용 시험에서 확인했습니다.

| 응답 | 화면 상태 | 화면에 보이는 것 |
| --- | --- | --- |
| API-009#200:verified | SCR-034#normal | 영업 신고 '확인됨' |
| API-009#200:pending | SCR-034#normal | 영업 신고 '확인 중' |
| API-009#200:on_hold | SCR-034#normal | 영업 신고 '보류'와 보류 사유 |
| API-009#200:identity_change_pending | SCR-034#normal | 사업자 정보 옆에 '변경 확인 기다림'(새 값과 요청 시각은 SCR-035) |
| API-009#200:identity_change_on_hold | SCR-034#normal | 사업자 정보 옆에 '변경 요청 보류'(보류 이유는 SCR-035) |
| API-009#401:unauthenticated | SCR-034#permission | '다시 로그인해 주세요' |
| API-009#404:shop_not_registered | SCR-034#permission | '가게를 먼저 등록해 주세요' |
| API-009#default:internal | SCR-034#load-failed | '문제가 생겼어요. 다시 시도해 주세요' |
| API-010#200:updated | SCR-034#done | '저장했어요' |
| API-010#200:unchanged | SCR-034#done | '바뀐 것이 없어요' |
| API-010#401:unauthenticated | SCR-034#permission | '다시 로그인해 주세요' |
| API-010#404:shop_not_registered | SCR-034#permission | '가게를 먼저 등록해 주세요' |
| API-010#409:version_conflict | SCR-034#stale | '그 사이 바뀌었어요. 지금 상태를 확인해 주세요' |
| API-010#409:request_in_progress | SCR-034#submitting | '처리하고 있어요. 잠시 뒤 다시 확인해 주세요' |
| API-010#422:validation_failed | SCR-034#error | '입력한 내용을 확인해 주세요' |
| API-010#422:idempotency_key_reused | SCR-034#error | '다시 시도해 주세요' |
| API-010#default:internal | SCR-034#error | '문제가 생겼어요. 다시 시도해 주세요' |
| API-003#204 | SCR-034#normal | 로그인 화면(SCR-014)으로 이동 |
| API-003#default:internal | SCR-034#error | '문제가 생겼어요. 다시 시도해 주세요' |

## 학원컴 확인

[실제 자료](2026-11-23-screen/README.md)에8상태×두폭의16원본과실제스테이징로그인전접근2원본이있으며모두오류·경고0입니다. 원본CSS를추가한최종화면에서저장버튼은844~888px입니다. 초기사진을최종으로세지않으며최종사진의CDP시간초과/미회수도구분했습니다. 실제 사장님 카카오/Vault 로그인 뒤 조회·저장·로그아웃은 아직 확인하지 않았습니다.

- 실제 최소 권한은 hands-on.md의19:01단락과 reviewed-grants.json입니다. shop_id/status 조회는true, unlinked_at/시트ID/OAuth참조 조회와 장부 UPDATE는false, 마이그레이션은34개입니다.18:17의3열 허용 뒤 쓰지 않는 열을 회수했습니다.
- 리뷰 뒤 컴파일한 JS·CSS 전체를 학원컴에 다시 전송해4경로×두폭8개를 추가 검사했고 오류·경고0입니다. 합성 PATCH의 mailOrderRegNo/Authority=null과 면제 사유, 저장 완료를 실제 요청에서 대조했습니다. 최신 자료의 범위와 이전8상태 검사를 구분합니다.
- 서버 요약은 같은 가게 조건으로 버전/연결/게시/후기 여부만 읽고 계좌·토큰 참조·사진 주소를 반환하지 않습니다. 선택 필드인 settingsSummary가 없는 이전 응답은 상태를 확인할 수 없다고 표시합니다.
