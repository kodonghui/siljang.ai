-- 스키마 소유자가 별도로 만든 전용 읽기 역할에만 적용한다. 비밀번호/연결 주소는 넣지 않는다.
-- psql -v backup_role=<역할> -v schema_owner=<이행을 적용한 소유자> -f <이 파일>
BEGIN;
SELECT set_config('siljang.backup_role', :'backup_role', true) AS backup_role_setting \gset
DO $check$
DECLARE r pg_roles;
BEGIN
  SELECT * INTO STRICT r FROM pg_roles WHERE rolname=current_setting('siljang.backup_role');
  IF r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolbypassrls OR r.rolinherit
     OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid)
     OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relowner=r.oid)
     OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p')
                AND (has_table_privilege(r.oid,oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                     OR has_any_column_privilege(r.oid,oid,'INSERT,UPDATE,REFERENCES')))
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND prosecdef
                AND has_function_privilege(r.oid,oid,'EXECUTE'))
  THEN RAISE EXCEPTION '별도 최소 백업 역할이 필요합니다'; END IF;
END
$check$;
GRANT USAGE ON SCHEMA public TO :"backup_role";
GRANT SELECT ON ALL TABLES IN SCHEMA public TO :"backup_role";
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO :"backup_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"schema_owner" IN SCHEMA public GRANT SELECT ON TABLES TO :"backup_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"schema_owner" IN SCHEMA public GRANT SELECT ON SEQUENCES TO :"backup_role";
ALTER ROLE :"backup_role" SET default_transaction_read_only=on;
COMMIT;
