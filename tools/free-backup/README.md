# 무료 MVP 데이터베이스 백업

근거는 `docs/handover/codex-finish.md` 4-3의 TASK-165 지시입니다. Supabase Pro로 바꾸지 않습니다. 운영 MVP에는 합성 데이터와 시험 계정만 넣습니다.

## 보관 범위

- 일일 예약: 매일 13:23 UTC(22:23 KST). GitHub Actions 예약은 지연되거나 건너뛸 수 있으므로 실행 이력과 실패 알림을 확인합니다.
- 형식: `public` 스키마의 정의·표 전체·시퀀스를 일관된 custom `pg_dump`로 읽어 즉시 age 공개 키로 암호화합니다. 중간 평문 덤프 파일은 만들지 않습니다.
- 공개 artifact에는 `public.dump.age` 하나만, 보관 기간은 7일입니다. 성공한 파일만 올립니다. 실패 시 부분 파일·임시 디렉터리를 정리하고 연결/SQL/제공자 오류는 로그에 쓰지 않습니다.
- GitHub의 artifact 만료·삭제는 서비스가 처리합니다. 매일 정확히 한 번 실행되거나 만료 시각에 즉시 제거된다고 보장하지 않습니다. 이 변경에서 켜는 설정은 하지 않았습니다. FREE_BACKUP_ENABLED 조회도403이므로 저장소 변수의 실제 상태는 미확인입니다.
- 사진 원본, `auth`·`storage`·`vault` 등 다른 스키마, 서버 역할/비밀번호, Worker 비밀 값과 `FIELD_KEY_*`는 포함하지 않습니다. DB의 암호문을 읽으려면 기존 FIELD_KEY를 Aside Vault에서 별도로 복구해야 합니다. Supabase 프로젝트 전체 복제나 사진 복구를 통과했다고 세지 않습니다.

## 실제 운영에서 켜기

아래 단계는 아직 실행하지 않았습니다. 학원컴 Aside CLI 연결이 회복되면 진행합니다. 비밀번호 재설정·요금제 변경·실제 데이터 지우기는 하지 않습니다.

1. 학원컴 Aside Vault에 age 개인 키를 만들고 보관합니다. 개인 키를 저장소·artifact·Actions 비밀 값에 넣지 않습니다. Vault에서 읽어 복호화할 수 있는지 확인한 뒤 공개 수신 키만 사용합니다. 이 PR의 CI 키는 매번 버리는 임시 합성 시험 키입니다.
2. 운영 DB에 앱·지우기 역할과 다른 새 `NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION` 로그인 역할을 만듭니다. 비밀번호는 Vault에만 보관합니다. 소유자/역할 멤버십/스키마·DB 생성/복제/쓰기/민감 함수 실행 권한이 있는 기존 역할은 `grants.sql`이 거절합니다. 실제 이행 소유자를 `schema_owner`, 새 역할을 `backup_role`로 주어 적용합니다. 새 역할은 `public`의 읽기와 시퀀스 SELECT만 필요합니다. 새 DDL을 다른 소유자로 적용하면 그 소유자의 기본 읽기 권한도 검토해야 합니다. RLS를 켜거나 스키마를 늘리면 백업 범위를 다시 검토합니다.
3. 관리자 확인 대기: `free-backup` GitHub 환경을 만들고 배포 브랜치를 main만 허용하도록 보호 규칙을 검증합니다. 기존 저장소 수준의 백업 비밀 값은 제거하고 이 환경의 secrets에 `BACKUP_DATABASE_URL`, `BACKUP_AGE_RECIPIENT`만 등록합니다. 연결은 TLS 호스트 검증을 통과해야 합니다. 현재 클라이언트는 PostgreSQL 17.11이며 서버가 17보다 높아지면 먼저 클라이언트/복구 CI를 갱신합니다. 직접 연결은 IPv6를 쓰며, Actions에서 닿지 않으면 무료 session pooler의 호환성을 읽기 전용 덤프로 확인합니다. transaction pooler는 쓰지 않고 IPv4 유료 추가 기능을 사지 않습니다. 계정·주소·키 값은 기록하지 않습니다.
4. 보호 규칙과 환경 비밀 값 확인 후 별도 변경으로 workflow의 `if: false`를 제거하고 저장소 변수 `FREE_BACKUP_ENABLED=true` 조건을 복원한 뒤 main에서 `free-backup`을 수동 실행합니다. 암호화 artifact 하나·7일 설정·성공 시각을 기록합니다. 실패 알림 메일 수신은 TASK-016의 남은 실제 확인과 연결합니다.
5. 그 파일을 Vault 개인 키로 복호화하여 격리된 새 시험 DB에 복구합니다. 원본 주문·동의·결제의 수와 내용을 비교하고 시간/손실 수만 기록합니다. 이후 첫 예약 실행도 확인합니다. 이 확인 전에는 TASK-165 끝남을 표시하지 않습니다.

GitHub Actions 비밀 값 목록 조회는 기존 403이며 이 PR에서 재시도하지 않았습니다. Supabase 실제 연결·Vault 키 보관·예약 성공·artifact 다운로드는 로컬 시험으로 대신하지 않습니다.

## 복구 절차와 격리

복구 대상은 새 빈 DB로 한정합니다. 실행 중인 운영 DB에 `--clean`을 쓰거나 원본 DB를 지우지 않습니다. GitHub에서 내려받은 암호화 파일을 Vault 개인 키로 모두 인증·복호화한 뒤 복구합니다. 잘못된 키·변조 실패로 남은 부분 평문을 복구기에 넣지 않습니다. 복호화 파일은 권한 0600의 임시 디렉터리에만 두고 종료 시 지웁니다.

1. 대상 DB의 PUBLIC CONNECT를 회수하고 앱/바깥 접속을 열지 않습니다. 실제 Supabase에서는 Data API가 꺼졌는지 확인합니다. 소유자 이외의 기존 연결이 없는 새 대상을 사용합니다.
2. `public`만 덤프하므로 `btree_gist` 확장은 별도로 준비합니다. CI는 새 DB의 기본 빈 public을 없애고 extensions 스키마에 확장을 설치한 뒤 덤프가 public을 만듭니다. 관리형 Supabase의 기존 스키마에 무조건 같은 SQL을 실행하지 않습니다. 실제 새 프로젝트에서는 기본 public/확장과 충돌하는 정의를 먼저 대조합니다.
3. 운영 PostgreSQL 17.11 클라이언트가 만든 아카이브 1.16은 PostgreSQL 17 이상의 대상에 PostgreSQL 17.11 `pg_restore --single-transaction --exit-on-error --no-owner --no-privileges`로 복구합니다. 원본 역할·권한은 복사하지 않습니다. 아직 격리 중일 때 `restore-fence.sql`로 확장 이외 앱 함수의 PUBLIC 실행을 모두 회수합니다. 원본의 함수 권한이 자동으로 보존되었다고 판단하지 않습니다.
4. 장부의 `siljang_ledger_private` 함수 스키마는 public 전용 덤프에 없으므로, 격리된 복구 대상에서 `PGHOST`·`PGPORT`·`PGDATABASE`와 `PGUSER=postgres`를 지정하고 `SILJANG_LEDGER_RESTORE=1 bash tools/free-backup/restore-ledger-functions.sh`를 실행합니다. 이 스크립트는 다른 세션과 PUBLIC 연결을 거부하고 0051~0058의 장부 함수와 0049의 기본 역할 권한 회수를 한 트랜잭션에서 적용합니다. 복구된 public 장부 함수의 정의가 현재 이행과 다르면 전체 트랜잭션을 되돌립니다. 백업 시점에 적용한 이행과 같은 저장소 버전으로 실행해야 합니다. 이어서 기존 최소 권한 파일을 적용합니다. Vault 행이나 토큰은 복구하지 않으며 사장님은 장부를 다시 연결합니다. 장부 서명 삭제 트리거는 public 덤프에서 복원하며, 스크립트는 그 트리거를 다시 만들지 않습니다. 복구 후 30일이 지난 개인정보 삭제 작업을 다시 실행합니다. 나중에 장부 함수 이행이 추가되면 이 스크립트의 목록도 함께 갱신합니다.
5. 표 전체의 행 내용을 비교하고 주문/동의/결제와 시퀀스를 확인합니다. 민감 함수의 PUBLIC 실행 0도 확인합니다. 실제 Worker 키·역할·Data API·스토리지·백업에 없는 외부 연결을 점검한 뒤 별도 배포/되돌리기 절차를 따릅니다.

`restore-smoke.py`는 `CI_BACKUP_TEST=1`, `PGHOST=127.0.0.1`일 때만 실행합니다. UUID로 새 합성 DB 두 개를 만들고 PUBLIC CONNECT를 회수합니다. 05 규칙 시험의 첫 정상 주문/완성 사진 동의를 재사용하며 원본 시험 파일을 바꾸지 않습니다. 62개 표의 행을 정렬한 SHA-256으로 비교하고 주문·세 종류 동의·결제가 0건이면 실패합니다. 암호화 키·평문·DB·역할은 끝에 지웁니다. CI는 PG17.11 서버에서 운영과 동일한 고정 이미지의 PG17.11 클라이언트로 덤프와 복구를 검사합니다. PG16 시험은 별도 호환성 검사이며 운영 덤프 복구 근거가 아닙니다. PG16 대상 복구는 지원하지 않습니다.

```sh
AGE_BIN=/설치/age python3 -I tools/free-backup/test_backup.py
CI_BACKUP_TEST=1 PGHOST=127.0.0.1 PGPORT=54329 PGUSER=postgres AGE_BIN=/설치/age python3 -I tools/free-backup/restore-smoke.py
```

## 공식 근거(2026-11-26 확인)

- [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups): 자동 일일 백업은 유료 플랜이고 Free는 별도 내보내기를 권합니다. DB 백업에는 Storage 객체가 포함되지 않습니다.
- [Supabase 연결 안내](https://supabase.com/docs/guides/database/connecting-to-postgres): 백업은 직접 연결을 권하며 무료 shared session pooler는 IPv4 경로입니다. 실제 이 계정에서의 덤프 호환성은 미확인입니다.
- [age v1.3.2 공식 배포](https://github.com/FiloSottile/age/releases/tag/v1.3.2): 2026-08-29 배포, linux-amd64 파일 SHA-256을 설치기에 고정했습니다. 자체 암호를 만들지 않습니다.
- [GitHub artifact 보관 기간](https://docs.github.com/en/actions/using-workflows/storing-workflow-data-as-artifacts#configuring-a-custom-artifact-retention-period): workflow에 7일을 명시합니다. 성공/과금 상태와 실제 만료는 계정에서 별도 확인합니다.
