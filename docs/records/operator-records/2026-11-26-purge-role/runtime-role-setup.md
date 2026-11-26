# 정기 삭제 역할 적용과 확인

공용 앱 연결은 HTTP와 시간 밖의 시작 기록 확인에만 씁니다. 정기 삭제는 기존 역할과 다른 NOINHERIT·NOSUPERUSER·NOCREATEDB·NOCREATEROLE·NOBYPASSRLS 역할을 준비합니다. 공용/관리 역할의 멤버십을 주지 않습니다. 실제 역할과 비밀번호는 이 문서나 명령 기록에 넣지 않고 Aside Vault에 둡니다.

1. 학원컴 Aside CLI로 Supabase에 로그인한 상태에서47번 이행을 적용합니다. 기존0046은 바꾸지 않습니다.
2. 기존 공용 역할에 tools/staging-login-callback-grants.sql을 재적용하여 삭제ID 표/열 INSERT와 삭제 함수 실행을 회수합니다. 기존 넓은 권한이나 역할 멤버십이 있으면 별도로 확인합니다. 이 파일이 모든 과거 권한을 자동 회수한다고 가정하지 않습니다.
3. 정기 삭제 전용 역할에 tools/staging-purge-grants.sql만 적용합니다. 함수 실행과 각 삭제 단계의 열 권한, 당일 시작 숫자 기록 권한을 줍니다. 보관 원문 customer_name의 직접 SELECT와 운영자 원문 함수 실행은 열지 않습니다.
4. 정기 삭제 연결은 wrangler secret put PURGE_DATABASE_URL로 넣거나 별도 PURGE_HYPERDRIVE를 연결합니다. 공용 HYPERDRIVE/연결 문자열을 재사용하지 않습니다. 로컬은 gitignore된 app/server/.dev.vars만 씁니다.
5. 합성 상담으로 서울03:00 예약 실행부터 시작 기록·후보·지우기와 같은 번호ID의 원문 API200→409를 확인합니다. 공용 역할의 직접 INSERT/함수 실행42501, 미래 시각으로30일 이내 상담이 남는 조건도 확인합니다. 실제 비밀 값·원문은 기록하지 않습니다.

현재 확인한 것은 로컬 PostgreSQL16의 새47개 이행·실제 두 제한 역할입니다. 실제 Supabase 역할/비밀 값 적용과 학원컴 Aside/PC 화면은 미확인입니다. 학원컴 SSH의 앞선 두 실패 이후 회복 근거가 없으므로 같은 접속을 반복하지 않았습니다. 다른 브라우저 도구로 대체하지 않았습니다.

삭제 식별 정보의 보관 기한은 retention-decision.md의 제품 결정 대기입니다. 이 권한 수정은 TTL을 정하거나 기존 기간 지적을 해결 처리하지 않습니다.

실제 Cloudflare 일 실패 알림 정책에도 tools/staging-monitor/job-policy.mjs의9개 실패 이벤트 조건을 재적용하고 다시 읽어 확인해야 합니다. 새 job_connection_failed를 포함한 로컬 생성기/회귀100개는 통과했지만 실제 정책 재적용은 미확인입니다.
