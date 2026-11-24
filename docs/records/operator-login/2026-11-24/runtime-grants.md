# TASK-021 운영자 로그인 최소 권한 보완

예약 번호는 앱 README358·수정 기록650입니다. 실제 합성 운영자 준비 전에 권한만 읽어 확인했고, 계정·비밀번호·TOTP 생성은0회입니다. [원문 사전 확인](runtime-permission-preflight.json)의 SHA-256은 ceaee07f5a02dbf2fccaed57cf8a6969201683849979272de5c3ced7d1defcba입니다. 계정/업무 행·역할 이름·키/토큰/쿠키는 포함하지 않습니다.

## 원인과 변경

실제 operators의 필수 SELECT와 세션/실패 기록 권한은 있었지만 어느 열에도 UPDATE가 없어 createSession의 FOR SHARE가 실행될 수 없었습니다. 보호 열 disabled_at/auth_user_id/mfa_factor_id UPDATE는 모두 false였습니다. 현재 권한 파일에는 운영자 조회 권한만 있고 로그인에 필요한 기존 권한의 재현도 빠져 있었습니다.

공식 PostgreSQL16 SELECT 설명(https://www.postgresql.org/docs/16/sql-select.html, 2026-11-24 확인)은 FOR SHARE 등 잠금에 테이블 어느 열이든 UPDATE 권한이 필요하다고 정합니다. 기존 shops/kakao_channels와 같은 UPDATE(id)만 추가합니다. 앱의 로그인 쿼리는 ID를 변경하지 않습니다. 로그인용 연결 열 읽기·새 세션 INSERT·ended_at UPDATE/만료 세션 DELETE·실패 기록 SELECT/INSERT/DELETE도 원본 tools/staging-login-callback-grants.sql에 열 단위로 명시합니다. 운영자 등록/보안 열 UPDATE·운영자 DELETE·기존 실패 행 UPDATE는 허용하지 않습니다. 새 역할/SECURITY DEFINER/인증 우회는 없습니다.

## 실패 먼저와 검사

새 독립 DB/NOLOGIN NOINHERIT 역할에 실제 권한 파일을 적용한 시험3개가 모두 실패했습니다. 세션 잠금은42501, 실패 기록/로그인은 기대401 대신500이었습니다. 최초 만료 세션 자료의 해시 제약 오류는 시험 자료를 고친 뒤 같은3개 실패를 다시 확인했고 제품 오류로 세지 않습니다. 권한 고침 뒤 관련3파일55개가 통과했습니다.

- 실제 PostgreSQL 잠금으로 세션 생성, 운영자의6개 보안/표시 열 UPDATE와 DELETE42501.
- 실패 기록 뒤 로그인200/내 정보200/로그아웃204/이전 쿠키401, 만료 세션 삭제와12시간 고정, 성공 시 실패 기록 정리와 Supabase 모의 세션 종료.
- 실패5회 뒤429/Retry-After900,15분 창 뒤 정상 로그인으로 정리/쓰기 확인.

전체 검사 원본 b7bd96e1b43fb239ca82e4451b26f01016e95ad5(당시 main250/이행38개)에 새 빈 DB를 사용했습니다. 아래는 원문 결과이며 main246 결합 뒤 이행39개와 현재 head CI는 별도로 확인합니다. 의존성/잠금 파일 차이는0이어서 PR248의 동일 의존성 npm ci 설치를 재사용했습니다. 이 PR에서 npm ci를 새로 실행했다고 하지 않습니다.

```text
 Test Files  133 passed (133)
      Tests  2628 passed (2628)
 Test Files  65 passed (65)
      Tests  1570 passed (1570)
✓ built in 911ms
Total Upload: 5358.90 KiB / gzip: 983.37 KiB
Total Upload: 20.91 KiB / gzip: 6.50 KiB
관련3파일55개 · 타입 · 형식 다음 엄격lint 오류/경고0
```

## 실제 적용과 남은 확인

[직전 main250](main250-deployment.json)은 app45427309177·db45427309470·실제 배포138565072552/전체 태그/활성100%/health200/원격SHA를 확인했습니다. 그 검증을 새 권한 적용 성공으로 세지 않습니다. main246의0039/최소 읽기 권한 고침을 보존했고 TASK-032 finished/양쪽 기록도 유지했습니다. 현재 상태는 끝남32·구현 완료31·MVP 시작 가능35·전체 의존 충족39입니다.

새 권한의 실제 적용은 아직 미확인입니다. 검토된 현재 원본/편집기/해시 대조 뒤 기존 역할에만 적용하고 같은 사전 확인을 다시 읽습니다. 적용 전후 모두 pg_attribute의 operators 실제 전체 열을 열거해 has_column_privilege로 유효 UPDATE 권한을 확인합니다. 적용 전에는 허용 열이0개, 적용 후에는 정확히 id 하나여야 합니다. mfa_enrolled_at·created_at 등 현재/미래 모든 다른 열과 PUBLIC/상속 권한도 포함합니다. operators INSERT는 테이블/어느 열 권한도false, DELETE/TRUNCATE도false, operator_login_failures UPDATE는 테이블/어느 열 권한도false여야 합니다. 단순 아무열.UPDATE=true만으로 통과시키지 않습니다. 조건이 다르면 GRANT 트랜잭션을 예외로 롤백하고 새 계정을 만들기 전에 멈추며 기존 권한을 임의 회수하지 않습니다. 모두 맞으면 이전에 승인된 새 합성 Auth 사용자·Vault 비밀번호/새TOTP·원래 등록 CLI/실제 SQL 증거·실제 앱 로그인·막기/풀기 뒤 이전 쿠키401·로그아웃을 계속합니다. 기존 계정과 인증 수단은 변경하지 않습니다. 실제 로그인 확인 전 TASK-021·031 finished는 표시하지 않습니다. 모델/메일/카카오/결제 호출0회입니다.

## 실장님 검토7136782054 처리

중간1건의 적용후 검사 누락을 보완했습니다. 예전 실제 사전 확인 원문은 수정하지 않고 과거 제한된 관찰로 보존합니다. 적용 절차에 전체 열의 유효 UPDATE 집합={id}·운영자 추가/삭제/전체 지우기 금지·실패 기록 수정 금지를 추가했고 실제 Aside 실행에도 계정 생성 전 같은 검사를 전달했습니다. 기존 계정은 바꾸지 않습니다. 로컬 독립 역할 시험에는 created_at 수정·INSERT·TRUNCATE·실패 기록 UPDATE42501와 전체 열 목록={id} 대조를 더했습니다. 실제 보강 확인이 끝나기 전 완료로 세지 않습니다.
