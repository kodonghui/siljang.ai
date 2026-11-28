#!/usr/bin/env bash
# public 전용 복구 뒤 장부의 앱 함수를 재설치한다. Vault 비밀이나 토큰은 복원하지 않는다.
set -euo pipefail
if [[ ${SILJANG_LEDGER_RESTORE:-} != 1 || ! ${PGDATABASE:-} =~ ^[A-Za-z0-9_][A-Za-z0-9_-]*$ || -z ${PGHOST:-} || ! ${PGPORT:-} =~ ^[0-9]+$ || ${PGUSER:-} != postgres ]]; then
  echo '격리된 복구 대상 PGHOST·PGPORT·PGDATABASE, PGUSER=postgres와 SILJANG_LEDGER_RESTORE=1이 필요합니다.' >&2
  exit 2
fi
for variable in PGSERVICE PGSERVICEFILE PGHOSTADDR PGOPTIONS; do
  if [[ -n ${!variable:-} ]]; then
    echo "복구 대상 선택을 바꾸는 환경 변수가 설정돼 있습니다: $variable" >&2
    exit 2
  fi
done
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
{
  cat <<'SQL'
DO $guard$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'restore executor must be postgres';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname='siljang_ledger_private') THEN
    RAISE EXCEPTION 'ledger function schema already exists';
  END IF;
  IF pg_catalog.to_regclass('public.ledger_links') IS NULL OR pg_catalog.to_regprocedure('public.read_owner_ledger(uuid,uuid,uuid)') IS NULL OR pg_catalog.to_regprocedure('public.unlink_owner_ledger(uuid,uuid,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'restored ledger contract is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()) THEN
    RAISE EXCEPTION 'restore database has other sessions';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_database d, LATERAL pg_catalog.aclexplode(COALESCE(d.datacl,pg_catalog.acldefault('d',d.datdba))) a WHERE d.datname=current_database() AND a.grantee=0 AND a.privilege_type='CONNECT') THEN
    RAISE EXCEPTION 'restore database permits public connections';
  END IF;
END
$guard$;
CREATE TEMP TABLE ledger_restore_function_baseline ON COMMIT DROP AS
SELECT p.oid AS function_id, pg_catalog.pg_get_functiondef(p.oid) AS definition
FROM pg_catalog.pg_proc p
WHERE p.oid IN (
  pg_catalog.to_regprocedure('public.read_owner_ledger(uuid,uuid,uuid)'),
  pg_catalog.to_regprocedure('public.unlink_owner_ledger(uuid,uuid,timestamptz)')
);
SQL
  for file in 0051_ledger_vault_status.sql 0052_ledger_unlink_vault.sql 0053_ledger_vault_store.sql 0054_ledger_create.sql 0055_ledger_lock.sql 0056_ledger_oauth_once.sql 0057_ledger_job_credential.sql; do
    cat "$root/db/migrations/$file"
    printf '\n'
  done
  # public 백업에는 이행된 열이 이미 있으므로 0058의 비공개 표와 함수 정의만 복구한다.
  awk 'found { print } /^-- 구글 계정 식별자/ { found=1; print }' "$root/db/migrations/0058_ledger_write_lease.sql"
  # 복구 대상의 기본 역할 권한도 원래 0049 원칙으로 닫는다.
  cat "$root/db/migrations/0049_revoke_supabase_definer_execute.sql"
  cat <<'SQL'
DO $compare$
BEGIN
  IF (SELECT count(*) FROM pg_temp.ledger_restore_function_baseline) <> 2 OR EXISTS (
    SELECT 1 FROM pg_temp.ledger_restore_function_baseline b
    WHERE b.definition IS DISTINCT FROM pg_catalog.pg_get_functiondef(b.function_id)
  ) THEN
    RAISE EXCEPTION 'restored ledger function version does not match';
  END IF;
END
$compare$;
SQL
} | psql -X -q -v ON_ERROR_STOP=1 --single-transaction
