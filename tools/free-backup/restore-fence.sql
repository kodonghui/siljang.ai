-- 새 격리 DB에서 pg_restore --no-privileges 뒤 연결을 열기 전에 실행한다.
-- 확장 함수는 제외하고 앱 함수의 PUBLIC 실행을 전부 닫는다. 운영 역할은 기존 권한 파일로 다시 부여한다.
DO $fence$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS identity FROM pg_proc p
    WHERE p.pronamespace='public'::regnamespace
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass
                      AND d.objid=p.oid AND d.deptype='e')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.identity);
  END LOOP;
END
$fence$;
