# TASK-048 영업 신고 화면 수락 대조

기준은 SCR-035와 API-009·011·007·080입니다. 09 목업의 일반/오류와 08의 나머지 여섯 상태를 같은 실제 OwnerArea·ShopLicense·공통 부품으로 구현합니다. 아래 표는 계약의 응답36행이며, 성공 예시의 이름 resubmitted/requested는 본문의 outcome=done으로 전달됩니다.

## 자동 시험과 실제 환경의 범위

- 조회의 다섯 성공 상태와401/404/기본 실패, 신고 재제출과 사업자 변경의 성공/변경 없음·권한·충돌·필드·요청 키 재사용·서버 실패를 상호 작용으로 대조합니다.
- 두 저장 모두 처리 중1초 뒤 같은 키와 본문으로 다시 보내며 결과를 한 번 표시합니다. 500은 같은 키, 요청 키 재사용 실패는 새 키입니다. 사진 만료/저장소503은 옛 업로드 성공 안내를 지우고 파일을 남겨 다시 올린 뒤 새 업로드 ID와 요청으로 저장합니다.
- 사진201은 license_photo만 보내고 multipart의 Content-Type과 요청 키를 직접 만들지 않습니다. completion_photo 행은 이 화면이 요청하지 않습니다. 401·413·422·429·503·기본 실패와10MB 초과 사전 차단을 대조합니다.
- 다른 기기가 먼저 바꾸거나 요청했을 때 최신 상태를 읽고, 필드 오류 뒤 입력과 첫 필드 포커스를 보존합니다. 처리 중·세션 재확인 중 입력/메뉴/로그아웃을 잠그고 세션 재확인 실패 뒤에는 입력을 보존해 잠그되 로그아웃을 허용합니다.
- 운영자가 반영하기 전까지 확인된 사업자 값을 유지합니다. 반영된 applied는 공통 가게 조회 검증과 신고 화면 모두 계약대로 받습니다. 신고 확인 시각은 licenseReviewedAt이며 가게 전체 updatedAt을 대신 쓰지 않습니다. 보류를 고치는 신고/결제 수단 경로는 로그인 복귀에서도 허용합니다.
- 실제 사장님 로그인 뒤 신고증/증빙 업로드·재제출·사업자 변경은 아직 확인하지 않았습니다. 기존 계정/Vault와 S3 실환경 설정 확인을 기다립니다. 합성 응답과 실제 환경 성공을 구분하고 finished를 추가하지 않습니다.

리뷰 수정 원본a815bfadac0866ffd4a67fb7c6f200cc667755b9의 새 빈 데이터베이스/마이그레이션34개 전체는 서버104파일2,221개·웹21파일382개, 타입·빌드1.11s/두Worker가 종료0입니다. 수정 전60a93f8의 서버2,221개·웹374개와 별도로 확인했습니다.

## 응답과 상태

| 응답 | 화면 상태 | 화면에 보이는 것 |
| --- | --- | --- |
| API-009#200:verified | SCR-035#normal | 영업 신고 '확인됨' |
| API-009#200:pending | SCR-035#normal | 영업 신고 '확인 중' |
| API-009#200:on_hold | SCR-035#on-hold | 영업 신고 '보류'와 보류 사유 |
| API-009#200:identity_change_pending | SCR-035#normal | 사업자 정보 표에 '변경 확인 기다림'과 새 값·요청 시각, '변경 요청'은 막힘 |
| API-009#200:identity_change_on_hold | SCR-035#normal | 사업자 정보 표에 '변경 요청 보류'와 보류 이유, '다시 요청' |
| API-009#401:unauthenticated | SCR-035#permission | '다시 로그인해 주세요' |
| API-009#404:shop_not_registered | SCR-035#permission | '가게를 먼저 등록해 주세요' |
| API-009#default:internal | SCR-035#error | '문제가 생겼어요. 다시 시도해 주세요' |
| API-011#200:resubmitted | SCR-035#done | '신고증을 다시 올렸어요. 운영자가 다시 확인해요'와 '확인 중' |
| API-011#401:unauthenticated | SCR-035#permission | '다시 로그인해 주세요' |
| API-011#404:shop_not_registered | SCR-035#permission | '가게를 먼저 등록해 주세요' |
| API-011#409:version_conflict | SCR-035#stale | '그 사이 바뀌었어요. 지금 상태를 확인해 주세요' |
| API-011#409:invalid_state | SCR-035#stale | '지금 상태에서는 할 수 없어요' |
| API-011#409:request_in_progress | SCR-035#submitting | '처리하고 있어요. 잠시 뒤 다시 확인해 주세요' |
| API-011#422:validation_failed | SCR-035#error | '입력한 내용을 확인해 주세요' |
| API-011#422:idempotency_key_reused | SCR-035#error | '다시 시도해 주세요' |
| API-011#default:internal | SCR-035#error | '문제가 생겼어요. 다시 시도해 주세요' |
| API-007#201:license_photo | SCR-035#normal | 사진 미리보기와 '올렸어요'. 1시간 안에 저장해야 씀 |
| API-007#201:completion_photo | 나오지 않음 | 이 화면은 신고증 사진만 올림(완성 사진은 SCR-030) |
| API-007#401:unauthenticated | SCR-035#permission | '다시 로그인해 주세요' |
| API-007#413:file_too_large | SCR-035#error | '사진이 너무 커요. 10MB(완성 사진은 20MB)까지 올릴 수 있어요' |
| API-007#422:validation_failed | SCR-035#error | '입력한 내용을 확인해 주세요' |
| API-007#429:rate_limited | SCR-035#error | 사진을 너무 자주 올림(429 rate_limited: 1분 30번, 쓰지 않은 올린 파일 50개): 사진 필드 옆 '잠시 뒤 다시 시도해 주세요'. Retry-After 초 뒤 다시 올림(06단계 DEC-16) |
| API-007#503:storage_unavailable | SCR-035#error | '사진을 저장하지 못했어요. 다시 올려 주세요' |
| API-007#default:internal | SCR-035#error | '문제가 생겼어요. 다시 시도해 주세요' |
| API-080#201:requested | SCR-035#done | '변경을 요청했어요. 운영자가 확인하면 바뀌어요'와 '변경 확인 기다림' |
| API-080#200:unchanged | SCR-035#done | '바뀐 것이 없어요'(세 값이 지금과 같아 요청을 남기지 않음) |
| API-080#401:unauthenticated | SCR-035#permission | '다시 로그인해 주세요' |
| API-080#404:shop_not_registered | SCR-035#permission | '가게를 먼저 등록해 주세요' |
| API-080#409:version_conflict | SCR-035#stale | '그 사이 바뀌었어요. 지금 상태를 확인해 주세요' |
| API-080#409:identity_change_pending | SCR-035#stale | 이미 확인을 기다리는 변경 요청이 있어요 · 다시 읽은 그 요청 |
| API-080#409:request_in_progress | SCR-035#submitting | '처리하고 있어요. 잠시 뒤 다시 확인해 주세요' |
| API-080#422:validation_failed | SCR-035#error | '입력한 내용을 확인해 주세요' |
| API-080#422:idempotency_key_reused | SCR-035#error | '다시 시도해 주세요' |
| API-080#503:storage_unavailable | SCR-035#error | '사진을 저장하지 못했어요. 다시 올려 주세요' |
| API-080#default:internal | SCR-035#error | '문제가 생겼어요. 다시 시도해 주세요' |

## 학원컴 확인

Aside CLI의 수정 전13상태×360·1280과 실제 로그인 전 접근 두 폭, 합계28건의 검사 원본은 [2026-11-23-screen](2026-11-23-screen/README.md)에 보존했습니다. 오류·경고0입니다. 리뷰 수정 뒤 잠금·양식 보존·조회 복구·사진 안내와 결제 수단 복귀15건도 별도 원본으로 보존했습니다. 오류·경고0입니다. 사진 회수 성공과 실제 사장님/S3 성공은 주장하지 않습니다.

결제 수단 화면은 TASK-053에서 구현합니다. 현재 복귀 버튼으로 영업 신고로 돌아올 수 있습니다. 413 문구는 SCR-035/API-007이 정한 전체 문구를 유지합니다. 등록 화면의 사진 처리 공유는 리뷰가 제안한 TASK-046 후속 PR로 진행합니다.
