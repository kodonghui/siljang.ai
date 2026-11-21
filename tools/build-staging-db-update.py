#!/usr/bin/env python3
"""TASK-173: 기존 원장의 해시를 확인하는 스테이징 SQL 생성기. 비밀 값은 받지 않는다."""
import argparse
import hashlib
from pathlib import Path
import re
import subprocess
import sys
import uuid


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def immutable_file(root, source, path):
    relative = path.relative_to(root).as_posix()
    result = subprocess.run(
        ["git", "show", f"{source}:{relative}"],
        cwd=root, capture_output=True, check=False,
    )
    if result.returncode or result.stdout != path.read_bytes():
        raise ValueError("source_file_mismatch")
    return result.stdout


def build(root, source, role, cleanup):
    if not re.fullmatch(r"[0-9a-f]{40}", source):
        raise ValueError("source_commit_invalid")
    if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", role):
        raise ValueError("runtime_role_invalid")
    if cleanup is not None and str(uuid.UUID(cleanup)) != cleanup:
        raise ValueError("cleanup_id_invalid")
    files = sorted((root / "db/migrations").glob("*.sql"))
    if len(files) < 25 or any(
        not re.fullmatch(rf"{i:04d}_[a-z0-9_-]+\.sql", path.name)
        for i, path in enumerate(files, 1)
    ):
        raise ValueError("migration_sequence_invalid")
    records = []
    for path in files:
        data = immutable_file(root, source, path)
        records.append((path.name, hashlib.sha256(data).hexdigest(), data.decode("utf-8")))
    grant_bytes = immutable_file(root, source, root / "tools/staging-login-callback-grants.sql")
    grants = grant_bytes.decode("utf-8").replace(':"runtime_role"', f'"{role}"')
    delimiter = "$siljang_update$"
    if delimiter in grants or any(delimiter in sql for _, _, sql in records):
        raise ValueError("sql_delimiter_collision")
    names = "ARRAY[" + ",".join(literal(name) for name, _, _ in records) + "]::text[]"
    sql = [
        "-- 생성: tools/build-staging-db-update.py. 이 파일을 직접 고치지 않는다.",
        f"-- 원본 SQL 커밋: {source}",
        f"-- 권한 파일 SHA-256: {hashlib.sha256(grant_bytes).hexdigest()}",
        "BEGIN;",
        "SET LOCAL lock_timeout = '10s';",
        "SET LOCAL statement_timeout = '30s';",
        "SET LOCAL search_path = public, pg_temp;",
        "SELECT pg_advisory_xact_lock(hashtextextended('siljang:staging:migrations', 0));",
        f"DO {delimiter}\nBEGIN",
        "IF to_regclass('siljang_deploy.migrations') IS NULL THEN RAISE EXCEPTION 'migration_ledger_missing'; END IF;",
        f"IF EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE NOT (filename = ANY({names}))) THEN RAISE EXCEPTION 'migration_ledger_unknown_file'; END IF;",
        "IF (SELECT count(*) <> count(DISTINCT filename) OR coalesce(max(left(filename, 4)::int), 0) <> count(*) FROM siljang_deploy.migrations) THEN RAISE EXCEPTION 'migration_ledger_not_prefix'; END IF;",
        f"IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = {literal(role)} AND rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole) THEN RAISE EXCEPTION 'runtime_role_not_limited'; END IF;",
        f"IF has_table_privilege({literal(role)}, 'public.access_logs', 'SELECT,UPDATE,TRUNCATE') OR has_any_column_privilege({literal(role)}, 'public.access_logs', 'UPDATE') THEN RAISE EXCEPTION 'access_log_privilege_drift'; END IF;",
        f"IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.access_logs'::regclass AND attnum > 0 AND NOT attisdropped AND attname <> 'accessed_at' AND has_column_privilege({literal(role)}, 'public.access_logs', attname, 'SELECT')) THEN RAISE EXCEPTION 'access_log_column_drift'; END IF;",
    ]
    # 기존 파일 검증을 모두 마친 뒤에만 DDL을 시작한다.
    for i, (name, digest, _) in enumerate(records, 1):
        sql.append(f"IF EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = {literal(name)} AND sha256 IS DISTINCT FROM {literal(digest)}) THEN RAISE EXCEPTION 'migration_hash_mismatch'; END IF;")
        if i <= 22:
            sql.append(f"IF NOT EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = {literal(name)}) THEN RAISE EXCEPTION 'migration_baseline_missing'; END IF;")
    for name, digest, body in records[22:]:
        sql.extend([
            f"IF NOT EXISTS (SELECT 1 FROM siljang_deploy.migrations WHERE filename = {literal(name)}) THEN",
            body,
            f"INSERT INTO siljang_deploy.migrations (filename, source_commit, sha256, applied_at) VALUES ({literal(name)}, {literal(source)}, {literal(digest)}, now());",
            "END IF;",
        ])
    sql.append(grants)
    if cleanup is not None:
        sql.extend([
            f"DELETE FROM public.ops_events WHERE id = {literal(cleanup)}::uuid AND kind = 'privacy_transfer_missing' AND count = 0 AND detail = '{{\"task173_probe\":1}}'::jsonb;",
            f"IF EXISTS (SELECT 1 FROM public.ops_events WHERE id = {literal(cleanup)}::uuid) THEN RAISE EXCEPTION 'probe_cleanup_mismatch'; END IF;",
        ])
    sql.extend([
        "IF to_regclass('public.owner_sessions') IS NULL OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'messages' AND column_name IN ('kakao_callback_enc','kakao_callback_deadline_at','kakao_callback_claim_until')) <> 3 THEN RAISE EXCEPTION 'migration_schema_incomplete'; END IF;",
        f"END;\n{delimiter};",
        "COMMIT;",
        f"SELECT count(*)::int AS migration_count, to_regclass('public.owner_sessions') IS NOT NULL AS owner_sessions_present, has_table_privilege({literal(role)}, 'public.owner_sessions', 'UPDATE') AS owner_session_update, has_table_privilege({literal(role)}, 'public.access_logs', 'SELECT') AS access_log_full_select FROM siljang_deploy.migrations;",
    ])
    return "\n".join(sql) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--role", required=True)
    parser.add_argument("--cleanup-ops-id")
    parser.add_argument("--output")
    args = parser.parse_args()
    try:
        sql = build(Path(__file__).resolve().parent.parent, args.source_commit, args.role, args.cleanup_ops_id)
    except (ValueError, OSError):
        print("staging_update_source_invalid", file=sys.stderr)
        return 1
    if args.output:
        Path(args.output).write_text(sql, encoding="utf-8")
    else:
        print(sql, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
