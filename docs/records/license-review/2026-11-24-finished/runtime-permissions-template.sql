-- 읽기 전용. 같은 실제 runtime 역할만 값을 넣고, 결과에는 역할/행 ID를 내보내지 않는다.
WITH target AS (SELECT '__RUNTIME_ROLE__'::regrole::oid AS role_oid),
review AS (SELECT to_regprocedure('public.review_shop_license(uuid,uuid,text,timestamptz,text,text,text)') AS function_oid)
SELECT
  (SELECT bool_and(has_column_privilege(t.role_oid,'public.operators',c,'SELECT'))
     FROM unnest(ARRAY['id','display_name','disabled_at','mfa_enrolled_at']) AS c) AS operator_required_select,
  (SELECT bool_and(has_column_privilege(t.role_oid,'public.operator_sessions',c,'SELECT'))
     FROM unnest(ARRAY['id','operator_id','token_hash','created_at','expires_at','ended_at']) AS c) AS session_required_select,
  r.function_oid IS NOT NULL AS review_function_exists,
  coalesce(has_function_privilege(t.role_oid,r.function_oid,'EXECUTE'),false) AS review_execute,
  coalesce(p.prosecdef,false) AS review_security_definer,
  coalesce(p.proconfig @> ARRAY['search_path=pg_catalog'],false) AS review_fixed_pg_catalog_search_path,
  NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) AS a
    WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS review_public_execute_denied,
  (SELECT coalesce(bool_or(has_column_privilege(t.role_oid,'public.shops',c,'UPDATE')),false)
     FROM unnest(ARRAY['license_status','license_hold_reason','license_reviewed_by','license_reviewed_at']) AS c) AS direct_license_approval_update_allowed,
  (SELECT coalesce(bool_or(has_column_privilege(t.role_oid,'public.payment_accounts',c,'UPDATE')),false)
     FROM unnest(ARRAY['holder_checked_by','holder_checked_at']) AS c) AS direct_holder_check_update_allowed
FROM target AS t CROSS JOIN review AS r LEFT JOIN pg_proc AS p ON p.oid=r.function_oid;
