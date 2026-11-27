# 정기 삭제 역할 적용과 확인

공용 앱 연결은 HTTP와 시간 밖의 시작 기록 확인에만 씁니다. 정기 삭제는 기존 역할과 다른 NOINHERIT·NOSUPERUSER·NOCREATEDB·NOCREATEROLE·NOBYPASSRLS 역할을 준비합니다. 공용/관리 역할의 멤버십을 주지 않습니다. 실제 역할과 비밀번호는 이 문서나 명령 기록에 넣지 않고 Aside Vault에 둡니다.

## 2026-11-28 스테이징 연결 변경

코디네이터 전달에 따르면 2026-11-27 18:00:28 UTC 정기 삭제는 직결 주소에서 `job_connection_failed`로 실패했고, 전용 역할과 캐시를 끈 `siljang-staging-purge` Hyperdrive를 생성했습니다. 스테이징 Worker는 저장소의 `PURGE_HYPERDRIVE` 바인딩을 통해 전용 연결을 사용합니다. Worker 설정과 비밀 값은 대시보드에서 변경하지 않습니다. 공용 HTTP 연결은 기존 `HYPERDRIVE`를 사용합니다. 이 변경의 배포와 실제 예약 삭제 결과는 아직 확인하지 않았습니다. 아래 과거 기록은 당시 상태입니다.

## 스테이징 이행과 남은 설정

2026-11-27 코디네이터가 스테이징 DB에 PR head 526ec74의 0048 적용과 이행 48개 확인을 전달했습니다. 이 작업공간의 0048 SHA-256은 92b3bd40458971c37550f2ca97e55acc32ad3f74fd8c5ed77c7545c68543f90b이며 기존 head의 파일과 같습니다. 사용자님은 “DB 먼저 적용하고 병합”을 승인했습니다. 정기 삭제 전용 역할과 PURGE_DATABASE_URL은 아직 없어 예약 삭제와 그 결과는 미확인이고, 설정 전 정기 작업이 실패해 삭제 식별 정보가 남을 수 있습니다. 실제 DB를 이 작업공간에서 다시 조회하지 않았으며 Cloudflare 경보 적용도 미확인입니다.

- [x] 코디네이터 전달: 0048까지 스테이징 DB 이행 48개 적용 확인.
- [ ] 정기 삭제 전용 역할을 만들고 권한을 적용한 뒤 새 함수 EXECUTE를 역할별로 확인한다.
- [ ] PURGE_DATABASE_URL 또는 전용 PURGE_HYPERDRIVE 설정과 실제 예약 삭제·감시를 확인한다.

1. 학원컴 Aside CLI로 Supabase에 로그인한 상태에서 0048번까지 이행을 적용합니다. 기존0046은 바꾸지 않습니다.
2. 기존 공용 역할에 tools/staging-login-callback-grants.sql을 재적용하여 삭제ID 표/열 INSERT와 삭제 함수 실행을 회수합니다. 기존 넓은 권한이나 역할 멤버십이 있으면 별도로 확인합니다. 이 파일이 모든 과거 권한을 자동 회수한다고 가정하지 않습니다.
3. Worker를 배포하기 전에 정기 삭제 전용 역할에 tools/staging-purge-grants.sql을 재적용합니다. 이행 생성기는 공용 역할 권한만 적용하므로 이 단계를 생략하지 않습니다. `has_function_privilege`로 전용 역할의 `purge_expired_masked_value_erasures(integer)` EXECUTE가 true이고 공용 역할 및 존재하는 anon·authenticated·service_role은 false인지 확인합니다. 확인이 끝날 때까지 정기 삭제가 실행되지 않으므로 실패와 누적을 감시하고 설정을 완료합니다. 함수 실행과 각 삭제 단계의 열 권한, 당일 시작 숫자 기록 권한을 줍니다. 보관 원문 customer_name의 직접 SELECT와 운영자 원문 함수 실행은 열지 않습니다.
4. 스테이징 정기 삭제 연결은 저장소의 전용 PURGE_HYPERDRIVE 바인딩을 사용합니다. 다른 환경에서는 wrangler secret put PURGE_DATABASE_URL 또는 별도 PURGE_HYPERDRIVE를 사용합니다. 공용 HYPERDRIVE/연결 문자열을 재사용하지 않습니다. 로컬은 gitignore된 app/server/.dev.vars만 씁니다.
5. Worker 배포 뒤 합성 상담으로 서울 03:00 예약 실행부터 시작 기록·후보·지우기와 같은 번호 ID의 원문 API 200→409를 확인합니다. 생성 24시간이 지난 뒤 다음 서울 03:00 예약 실행으로 삭제 식별 정보가 제거된 후 같은 번호 ID가 404인지 확인합니다. 예약 실행의 전용 역할, 실패 기록 및 배치 처리를 함께 확인합니다. 공용 역할의 직접 INSERT/함수 실행42501, 미래 시각으로30일 이내 상담이 남는 조건도 확인합니다. 실제 비밀 값·원문은 기록하지 않습니다.

현재 확인한 것은 로컬 PostgreSQL16의 새47개 이행·실제 두 제한 역할입니다. 실제 Supabase 역할/비밀 값 적용과 학원컴 Aside/PC 화면은 미확인입니다. 학원컴 SSH의 앞선 두 실패 이후 회복 근거가 없으므로 같은 접속을 반복하지 않았습니다. 다른 브라우저 도구로 대체하지 않았습니다.

삭제 식별 정보 보관 기한은 retention-decision.md의 2026-11-27 승인에 따릅니다. 0048 적용과 이행 48개는 코디네이터 전달로 확인했으며 전용 권한·역할별 EXECUTE와 예약 실행 409→404는 미확인입니다.

실제 Cloudflare 일 실패 알림 정책에도 tools/staging-monitor/job-policy.mjs의9개 실패 이벤트 조건을 재적용하고 다시 읽어 확인해야 합니다. 새 job_connection_failed를 포함한 로컬 생성기/회귀100개는 통과했지만 실제 정책 재적용은 미확인입니다.
