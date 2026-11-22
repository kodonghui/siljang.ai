# TASK-028 수락 조건 대조

2026-11-22 KST. 기준은 WBS의 TASK-028 행과 SPEC-017 #1·#2·#6, API-070~073, G4·G5입니다. 업무별 카드/사진/안내 처리의 완료와 공통 처리의 검증을 구분합니다.

| 조건 | 확인한 경로 | 근거 |
| --- | --- | --- |
| SPEC-017 #1 | 같은 요청 세 번에 수신·AI 호출·자유 입력 초안 각 1건, 이후 메시지 스킬의 빈 출력 | `app/server/test/kakao-callback.test.ts`, `kakao-skill.test.ts`; 실제 모델 한 건은 hands-on.md |
| SPEC-017 #2 | 3,750ms 안 응답 준비, 큐 발행 예고, 콜백 기한/선점/재전달 | `kakao-skill-deadline.test.ts`, `kakao-callback.test.ts`, `kakao-callback-recovery.test.ts` |
| SPEC-017 #6 | 헤더 없음/다른 가게 키 401·쓰기 0, 현재/직전 키 기한과 즉시 폐기 | `kakao-skill.test.ts`, `kakao-http-contract.test.ts` |
| API-070 HTTP 200·401·422·default | 계약 본문·헤더와 인증/입력/처리 실패 | `kakao-http-contract.test.ts`; 네 스킬의 선언 응답 20개와 처리 실패 3개 |
| API-070 결과 11종 | callback_pending, 모델 실패 4종, 비용 한도, 지원하지 않는 입력, 빈도 제한, 중복, 받지 않음, 서버 오류 | `kakao-reply.test.ts`, `kakao-ai-failure.test.ts`, `kakao-ai-cost-limit.test.ts`, `kakao-callback.test.ts`, `kakao-skill.test.ts` |
| API-071 HTTP 200·401·422·default와 not_accepting·server_error | 연결 전/처리 실패와 계약 대조 | `kakao-http-contract.test.ts`, `kakao-skill-deadline.test.ts` |
| API-072 HTTP 200·401·422·default와 duplicate·not_accepting·server_error | 실제 글 후기 수신/버전 저장의 동시 요청 세 번, 중단 롤백/재시도, 반복 감사 답 | `kakao-review-dedup.test.ts`, `kakao-runtime-grants.test.ts`, `kakao-http-contract.test.ts` |
| API-073 HTTP 200·401·422·default | 없는 안내와 인증/입력/서버 실패, 인증 뒤 기한 초과 500 | `kakao-http-contract.test.ts`, `kakao-skill-deadline.test.ts` |
| G4 콜백/AI | 기한 안 재시도 1회, 늦은 답의 보존/다음 대화 전달, AI 실패의 질문/할 일/알림 원자적 저장 | `kakao-callback.test.ts`, `kakao-callback-expiry-recovery.test.ts`, `kakao-ai-failure.test.ts`, `kakao-deferred.test.ts` |
| G4 Event API 공통 전송 | 요청 실패/발송 결과의 분류, 1·5·30분 재전송 계획과 조회 계획, 상한 뒤 다음 대화 계획 | `kakao-event.test.ts`, `kakao-event-services.test.ts`, `retry.test.ts` |
| G5 | 친구/가게 발신 가능 상태와 이미 끝난 안내 차단, 가게 시간대 08:00~20:50, 전달 확인 뒤 보냄 계획, 고정 이벤트/안내 키만 전송 | `kakao-event.test.ts`, `kakao-event-services.test.ts`; 같은 주문/이벤트 키의 1건 저장은 `event-keys.test.ts` |
| 제한 역할 | 수신/마스킹/실패/정상 모델/초안/글 후기 경로의 실제 PostgreSQL 역할과 금지 권한 | `kakao-runtime-grants.test.ts`, `tools/staging-login-callback-grants.sql` |
| 실제 스테이징 권한 | 기존 연결 역할의 GRANT 적용/카탈로그 확인; 실제 쓰기는 미완료 | hands-on.md; 새 pg_temp 방식은 42501, 쓰기 false/롤백·역할 복원 true |

모델의 비동기 실패는 처음 callback_pending 응답 뒤 콜백의 사장님 확인 안내와 실패 코드 로그로 확인합니다. 실제 OpenAI 합성 한 건은 로컬 DB의 같은 소비자로 확인했고 카카오 발신은 모의 응답입니다. 스테이징 AI 키/설정과 실제 큐 실행 확인은 TASK-173/167의 실환경 검증에 남깁니다.

첫 AI 고지 자체는 TASK-064, 가게 규칙/가격/금액/조문/카드의 전체 검증은 TASK-069 및 해당 업무 작업입니다. 글 후기는 API-072 업무 중복을 검증할 수 있게 연결했으며 사진/게시 동의는 TASK-145가 이어갑니다. 실제 Event API 발신은 무료 MVP 지시대로 TASK-167에 남기며, 안내 글/버튼과 실행기의 업무별 저장은 TASK-104가 맡습니다. 공통 전송 서비스 생성은 HTTP를 보내지 않습니다.

로컬 최종 전체 타입·서버 77개 파일 1,317개·웹 11개 파일 237개·빌드 819ms가 통과했습니다. 스테이징의 기존 주문 금액 읽기 권한은 이번 최소 권한 파일과 다르며 기존 권한을 취소하지 않았습니다. 코드/자동 시험 조건은 마쳤지만 실제 서버 역할의 쓰기가 미완료라 finished를 표시하지 않습니다. 최종 CI/main 배포 확인 뒤 구현 완료 목록에서 실환경 확인을 이어갑니다.
