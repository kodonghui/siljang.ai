# TASK-054 채널 연결 화면 대조

SCR-041·SPEC-008/017·API-030/031/032/079·09 목업/토큰을 기준으로 구현했습니다. 아래41행은08의 원본 응답 표입니다. 모든 행을 API 모듈과 실제 화면 합성 시험에서 대조했고, 헤더 누락 추가2개도 검사합니다. 실제 브라우저의 page-check 통과를 뜻하지 않습니다.

| 응답 | 상태 | 원본에서 정한 표시 |
| --- | --- | --- |
| API-030#200:pending | SCR-041#checking | '연결 확인 중'과 남은 시간(10분), 닿은 시험 버튼 n/5, 몇 초마다 다시 읽음 |
| API-030#200:linked | SCR-041#normal | '연결됨'과 연결된 시각, '먼저 보내기 됨' |
| API-030#200:failed | SCR-041#error | '연결 안 됨'과 사유 후보(스킬 주소, 오픈빌더 배포, 닿지 않은 버튼 블록) |
| API-030#200:event_checking | SCR-041#checking | '연결됨'과 '먼저 보내기 확인 중'(시험 안내의 발송 결과를 기다림) |
| API-030#200:event_unavailable | SCR-041#event-off | '연결됨'과 '먼저 보내기 안 됨: {사유}', '손님 안내는 다음 대화 때 전해요', '시험 안내 다시 보내기' |
| API-030#401:unauthenticated | SCR-041#permission | '다시 로그인해 주세요' |
| API-030#404:shop_not_registered | SCR-041#permission | '가게를 먼저 등록해 주세요' |
| API-030#404:not_set | SCR-041#empty | '아직 정하지 않았어요' |
| API-030#default:internal | SCR-041#error | '문제가 생겼어요. 다시 시도해 주세요' |
| API-031#200:created | SCR-041#done | '저장했어요. 아래 스킬 설정 값을 오픈빌더에 넣어 주세요'와 스킬 키(이때 한 번만 보임, '복사') |
| API-031#200:unchanged | SCR-041#done | '바뀐 것이 없어요' |
| API-031#200:blocks_changed | SCR-041#done | '블록 ID를 바꿨어요. 연결 확인을 다시 해 주세요'. 다시 연결될 때까지 이 채널의 손님 메시지는 받지 않음 |
| API-031#401:unauthenticated | SCR-041#permission | '다시 로그인해 주세요' |
| API-031#404:shop_not_registered | SCR-041#permission | '가게를 먼저 등록해 주세요' |
| API-031#409:version_conflict | SCR-041#stale | '그 사이 바뀌었어요. 지금 상태를 확인해 주세요' |
| API-031#409:channel_linked_elsewhere | SCR-041#error | '이미 다른 가게에 연결된 채널이에요' |
| API-031#409:request_in_progress | SCR-041#submitting | '처리하고 있어요. 잠시 뒤 다시 확인해 주세요' |
| API-031#422:validation_failed | SCR-041#error | '입력한 내용을 확인해 주세요' |
| API-031#422:idempotency_key_reused | SCR-041#error | '다시 시도해 주세요' |
| API-031#default:internal | SCR-041#error | '문제가 생겼어요. 다시 시도해 주세요' |
| API-032#200:started | SCR-041#checking | '연결 확인 중'으로 바뀌고 연결 문구('연결 ' 뒤 숫자 6자리)와 '이 문구를 가게 채널 대화창에 보내 주세요' |
| API-032#200:unchanged | SCR-041#checking | '이미 확인 중이거나 연결됐어요'와 지금 상태(연결됐으면 SCR-041#normal) |
| API-032#401:unauthenticated | SCR-041#permission | '다시 로그인해 주세요' |
| API-032#404:shop_not_registered | SCR-041#permission | '가게를 먼저 등록해 주세요' |
| API-032#404:not_set | SCR-041#empty | '아직 정하지 않았어요' |
| API-032#409:channel_setup_incomplete | SCR-041#error | '버튼 블록 ID 5개를 모두 넣어 주세요'와 빈 블록 ID 필드를 굵게 |
| API-032#409:channel_linked_elsewhere | SCR-041#error | '이미 다른 가게에 연결된 채널이에요' |
| API-032#409:request_in_progress | SCR-041#submitting | '처리하고 있어요. 잠시 뒤 다시 확인해 주세요' |
| API-032#422:validation_failed | SCR-041#error | '입력한 내용을 확인해 주세요' |
| API-032#422:idempotency_key_reused | SCR-041#error | '다시 시도해 주세요' |
| API-032#default:internal | SCR-041#error | '문제가 생겼어요. 다시 시도해 주세요' |
| API-079#200:regenerated | SCR-041#done | '스킬 키를 바꿨어요. 새 키를 오픈빌더 헤더 값에 넣고 배포해 주세요'와 새 키(이때 한 번만 보임, '복사'), '옛 키는 {시각}까지 받아요' |
| API-079#200:revoked | SCR-041#done | '스킬 키를 바꿨어요. 새 키를 오픈빌더 헤더 값에 넣고 배포해 주세요'와 새 키(이때 한 번만 보임, '복사'), '옛 키는 바로 끊었어요. 배포할 때까지 손님 메시지를 받지 않아요' |
| API-079#401:unauthenticated | SCR-041#permission | '다시 로그인해 주세요' |
| API-079#404:shop_not_registered | SCR-041#permission | '가게를 먼저 등록해 주세요' |
| API-079#404:not_set | SCR-041#empty | '아직 정하지 않았어요' |
| API-079#409:version_conflict | SCR-041#stale | '그 사이 바뀌었어요. 지금 상태를 확인해 주세요' |
| API-079#409:request_in_progress | SCR-041#submitting | '처리하고 있어요. 잠시 뒤 다시 확인해 주세요' |
| API-079#422:validation_failed | SCR-041#error | '입력한 내용을 확인해 주세요' |
| API-079#422:idempotency_key_reused | SCR-041#error | '다시 시도해 주세요' |
| API-079#default:internal | SCR-041#error | '문제가 생겼어요. 다시 시도해 주세요' |

상태10개의 로컬 시험은 정상/빈 화면/조회 골격/권한/오류/충돌/처리 중/연결 확인/먼저 보내기 안 됨/완료를 확인합니다. 깨끗한 원본a73bde2의 새 빈 DB에34개 마이그레이션을 적용한 서버104파일2,221개·웹40파일912개·빌드687ms와 두 Worker가 종료0입니다.

- 10분 남은 시간, 블록5개의 닿음/기다림, 실패 사유와 해당 필드,5초 조회와 최종 기한 조회를 확인합니다. 숨긴 탭·편집·명령 시작·세션 확인은 진행 중 읽기를 취소하고 늦은401은 버립니다.
- 편집 중 수동 조회와 키 교체를 잠가 입력을 보존합니다. G3는 바꾼 필드만 최신 revision 위에 적용한 뒤 새 키로 저장하며, G2의 처리 중/내부 오류는 같은 본문/키, 키 재사용 오류는 새 키로 보냅니다.
- 일회성43자 스킬 키는 현재 화면 상태에만 둡니다. 조회 응답에서는 계약 밖 비밀 필드를 제거하고 연결/키 버전 변경 뒤 이전 키를 지웁니다. 클립보드 성공/차단 시 선택/대기 중 값 변경을 확인합니다.
- 무료 MVP는 실제 Event API 발신을 부르지 않습니다. 연결됨/unchecked는 손님 안내를 다음 대화 때 전합니다.

학원컴 Aside CLI의 공통 CDP 시간 초과는 보류 상태입니다. 실제10상태×360·1280, page-check/실린 글꼴·44px, 실제 사장님 계정/카카오 연결/시험 버튼 결과는 확인0개입니다. W7의 실제 오픈빌더 위치도 미확인입니다. finished/구현 완료는 표시하지 않습니다.

main207 결합 뒤 서버·DB·의존성 차이 없이 웹922개·타입/lint·빌드735ms와 두 Worker가 통과했습니다. 새 빈 DB 전체의 원본과 이 후속 회귀를 구분합니다.
