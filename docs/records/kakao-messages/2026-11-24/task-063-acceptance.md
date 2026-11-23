# TASK-063 손님 메시지 수신 수락 조건 대조

WBS의 TASK-063은 SPEC-017 수락 기준3·4·7, API-070의 네 HTTP 응답과11개 스킬 결과, A13을 자동 시험으로 확인하는 작업입니다. 수신/콜백/마스킹/비용 차단은 앞선 TASK-028의 공통 코드에 들어 있습니다. 이 작업은 그 구현을 수신 관점에서 대조하고 빠진 회귀 시험을 보강합니다.

## 자동 시험

| 끝난 조건 | 검사와 확인할 결과 |
| --- | --- |
| SPEC-017 수락 기준3 | kakao-callback.test.ts와 kakao-callback-expiry-recovery.test.ts: 기한이 지난 질문을 사장님에게 넘기고 질문·할 일·대기 알림·다음 대화 안내를 함께 남김. 중단/반복 뒤에도 한 번만 저장함 |
| SPEC-017 수락 기준4 | kakao-message-input.test.ts: 친구였던 손님의 다음 요청에 isFriend가 없으면 false, 뒤늦은 옛 true는 최신 값을 되돌리지 않음 |
| SPEC-017 수락 기준7·REQ-262 | kakao-message-input.test.ts와 kakao-ai-cost-limit.test.ts: 상담 비용1000원부터 해당 질문은 ai_cost_limit로 넘기고 AI를 호출하지 않음. 같은 가게의 다른 상담에는 모의 모델이 한 번 답함 |
| A13 | kakao-ai-cost-limit.test.ts: 하루 합계·가게 시간대 자정/서머타임·0원 설정·다른 가게 제외·큐 소비 전 재확인과 중복 차단 |
| API-070 HTTP200·401·422·default | kakao-http-contract.test.ts: 계약 본문/헤더·쓰기 차단·내부 오류 미노출. 처리 도중 실패의200/server_error도 대조 |
| 상담 열기·이어가기 | kakao-message-input.test.ts: 열린 상담을 이어가고 끝난 상담은 유지한 채 새 상담을 만듦 |
| 글 길이 | kakao-message-input.test.ts: 유니코드1000자를 넘는 전체 마스킹 글은 기록에 남고 모의 모델에는 앞1000자만 전달됨 |
| 교차 가게 | kakao-message-input.test.ts: 다른 가게 키는401이며 두 가게 기록의 수·내용 해시와 큐가 바뀌지 않음 |
| 같은 요청·분당 한도 | kakao-skill.test.ts: 세 번 동시 수신의 한 번 저장/빈 반복 출력과20개 뒤 첫 초과만 안내·이후 무음·다음 분 복구 |

신규 실제 PostgreSQL 시험5개는 첫 실행부터 통과했습니다. 기존 구현을 대조하는 회귀 시험이며 제품 코드를 바꾸지 않았습니다. 모델과 카카오 발신은 모의 응답이고 실제 API 호출은0건입니다. 모델 입력 시험의 고지 완료 값은 시험 자료로 넣으며 첫 고지를 구현했다고 주장하지 않습니다.

## 스킬 결과11개

| 결과 | 확인하는 시험 |
| --- | --- |
| callback_pending | kakao-callback.test.ts, kakao-message-input.test.ts |
| ai_unavailable | kakao-ai-failure.test.ts, kakao-callback.test.ts |
| ai_timeout | kakao-callback.test.ts, kakao-reply.test.ts |
| ai_key_missing | kakao-ai-failure.test.ts, kakao-skill.test.ts |
| ai_limit_reached | kakao-callback.test.ts, kakao-reply.test.ts |
| ai_cost_limit_reached | kakao-ai-cost-limit.test.ts, kakao-message-input.test.ts |
| unsupported_message | kakao-skill.test.ts, kakao-reply.test.ts |
| rate_limited | kakao-skill.test.ts |
| duplicate | kakao-skill.test.ts, kakao-callback.test.ts |
| not_accepting | kakao-http-contract.test.ts, kakao-skill.test.ts |
| server_error | kakao-http-contract.test.ts, kakao-skill.test.ts |

모델의 비동기 실패는 최초 callback_pending 뒤 콜백 안내와 실패 코드 로그로 확인합니다. 모든 결과가 최초 HTTP 응답에서 즉시 생긴다고 세지 않습니다.

## 뒤 작업과 실제 확인

첫 고지와 처리방침 버전은 TASK-064, 사진은 TASK-065, 대화 전체 마스킹/줄이기는 TASK-066, 초안·견적·명령과 한 차례의 AI 업무 처리는 TASK-069가 이어갑니다. 동시 수신의 저장/중복 차단과 완성된 AI 대화 흐름을 구분합니다. SPEC-017 수락 기준5의 스테이징20상담 P99는 TASK-164입니다.

실제 카카오/모델·스테이징 큐 업무 흐름은 TASK-028/173/167의 남은 실제 확인과 함께 추적합니다. 학원컴 Aside CLI CDP와 whoami는 앞선 같은 목적 두 실패 뒤 보류 상태입니다. 이 작업에서 추가 브라우저 제어/Ego/CUA·실제 모델 호출·결제는 하지 않았습니다. 새 빈 PostgreSQL 마이그레이션34개·서버105파일2,226개·웹65파일1,563개·타입/웹/두 Worker 빌드가 통과했습니다. 이 표의 자동 조건을 대조해 TASK-063 finished를 표시했습니다. 실제 환경 확인을 조건으로 둔 다른 작업은 그대로 남깁니다.
