#!/usr/bin/env python3
"""로컬/CI의 새 합성 DB 두 개만 쓰고 항상 지우는 암호화 복구 시험."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
TOOLS = Path(__file__).resolve().parent


def sql(database, statement, *, env=None):
    result = subprocess.run(["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
                            input=statement.encode(), env={**(env or os.environ), "PGDATABASE": database},
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True)
    return result.stdout


def snapshot(database):
    names = json.loads(sql(database, "SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public'"))
    return {name: hashlib.sha256(sql(database, f'COPY (SELECT to_jsonb(t)::text FROM public."{name}" t ORDER BY to_jsonb(t)::text) TO STDOUT')).hexdigest()
            for name in names}


def run():
    if os.environ.get("CI_BACKUP_TEST") != "1" or os.environ.get("PGHOST") != "127.0.0.1":
        raise ValueError("로컬 합성 시험만 허용합니다")
    for key in ["PGSERVICE", "PGSERVICEFILE", "PGHOSTADDR"]:
        os.environ.pop(key, None)
    # 환경의 PGDATABASE에 외부 연결 문자열이 있어도 이 이름으로 항상 덮어쓴다.
    token = uuid.uuid4().hex
    source, target, role = (f"backup_{prefix}_{token}" for prefix in ["source", "restore", "reader"])
    created, role_created = [], False
    started = time.monotonic()
    proof = {}
    try:
        for database in [source, target]:
            sql("postgres", f'CREATE DATABASE "{database}" TEMPLATE template0')
            created.append(database)
            sql("postgres", f'REVOKE CONNECT ON DATABASE "{database}" FROM PUBLIC')
        for migration in sorted((ROOT / "db/migrations").glob("*.sql")):
            sql(source, "BEGIN;\n" + migration.read_text() + "\nCOMMIT;")
        # 05 규칙 시험의 첫 정상 주문과 게시 동의를 재사용한다. 원본 시험/ROLLBACK은 바꾸지 않는다.
        fixture = (ROOT / "research/cake-erd-2026-11/rule_tests.sql").read_text()
        begin, end = "-- ───────────── 1부: 정상 플로우 ─────────────", "-- 신고 → 재제작 주문"
        assert fixture.count(begin) == fixture.count(end) == 1
        sql(source, "BEGIN; SET CONSTRAINTS ALL DEFERRED;\n" + fixture.split(begin)[1].split(end)[0] + "\nCOMMIT;")
        # public 덤프에는 Vault 행이 없다. 복구된 연결은 재연결 상태여야 한다.
        sql(source, "UPDATE ledger_links SET our_columns='{\"columns\":[{\"header\":\"주문번호\",\"column\":\"A\"}]}'::jsonb")
        ledger_shop, ledger_owner = sql(source, "SELECT l.shop_id,s.owner_id FROM ledger_links l JOIN shops s ON s.id=l.shop_id LIMIT 1").decode().strip().split("|")
        sql(source, "CREATE SEQUENCE backup_smoke_seq START 7; SELECT nextval('backup_smoke_seq')")
        sequence_query = "SELECT json_agg(json_build_object('name',sequencename,'last_value',last_value,'increment_by',increment_by) ORDER BY sequencename) FROM pg_sequences WHERE schemaname='public'"
        sequences_before = sql(source, sequence_query)
        before = snapshot(source)
        counts = json.loads(sql(source, "SELECT json_build_object('orders',(SELECT count(*) FROM orders), 'terms',(SELECT count(*) FROM orders WHERE terms_consented_at IS NOT NULL), 'allergy',(SELECT count(*) FROM order_details WHERE allergy_consent_at IS NOT NULL), 'photos',(SELECT count(*) FROM photo_consents), 'payments',(SELECT count(*) FROM payments))"))
        assert all(value > 0 for value in counts.values())
        sql("postgres", f'CREATE ROLE "{role}" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS')
        role_created = True
        sql("postgres", f'GRANT CONNECT ON DATABASE "{source}" TO "{role}"')
        grants = (TOOLS / "grants.sql").read_text()
        grant_command = ["psql", "-Xq", "-v", "ON_ERROR_STOP=1", "-v", f"backup_role={role}",
                         "-v", f"schema_owner={os.environ.get('PGUSER', 'postgres')}"]
        # 이미 쓰기/민감 함수 실행 권한이 있는 역할에 읽기 권한을 더해 백업 역할로 쓰지 않는다.
        unsafe_cases = [
            (f'GRANT UPDATE ON orders TO "{role}"', f'REVOKE UPDATE ON orders FROM "{role}"'),
            (f'GRANT EXECUTE ON FUNCTION purge_closed_consultation(uuid,uuid,timestamptz) TO "{role}"',
             f'REVOKE EXECUTE ON FUNCTION purge_closed_consultation(uuid,uuid,timestamptz) FROM "{role}"'),
            (f'GRANT CREATE ON SCHEMA public TO "{role}"', f'REVOKE CREATE ON SCHEMA public FROM "{role}"'),
            (f'GRANT CREATE ON DATABASE "{source}" TO "{role}"', f'REVOKE CREATE ON DATABASE "{source}" FROM "{role}"'),
            (f'ALTER ROLE "{role}" REPLICATION', f'ALTER ROLE "{role}" NOREPLICATION'),
        ]
        for index, (grant, revoke) in enumerate(unsafe_cases, 1):
            sql(source, grant)
            rejected = subprocess.run(grant_command, input=grants.encode(), env={**os.environ, "PGDATABASE": source},
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            assert rejected.returncode != 0, f"위험 권한 역할{index} 허용"
            assert sql(source, f"SELECT has_table_privilege('{role}','orders','SELECT')").strip() == b"f"
            sql(source, revoke)
        subprocess.run(grant_command, input=grants.encode(), env={**os.environ, "PGDATABASE": source},
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        rights = sql(source, f"SELECT has_table_privilege('{role}','orders','SELECT') AND NOT has_table_privilege('{role}','orders','UPDATE') AND NOT has_table_privilege('{role}','orders','DELETE') AND NOT has_function_privilege('{role}','purge_closed_consultation(uuid,uuid,timestamptz)','EXECUTE')")
        assert rights.strip() == b"t"
        try:
            sql(source, "UPDATE orders SET amount=amount", env={**os.environ, "PGUSER": role})
        except subprocess.CalledProcessError:
            pass
        else:
            raise AssertionError("백업 역할의 쓰기가 허용됨")
        age = os.environ.get("AGE_BIN", "age")
        keygen = str(Path(age).with_name("age-keygen")) if "/" in age else "age-keygen"
        with tempfile.TemporaryDirectory(prefix="siljang-restore-") as private:
            private = Path(private)
            key, encrypted, plain = private / "identity", private / "backup.dump.age", private / "restore.dump"
            subprocess.run([keygen, "-o", str(key)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            recipient = subprocess.check_output([keygen, "-y", str(key)], text=True).strip()
            backup_env = {**os.environ, "BACKUP_DATABASE_URL": source, "BACKUP_AGE_RECIPIENT": recipient,
                          "PGUSER": role}
            subprocess.run([sys.executable, "-I", str(TOOLS / "backup.py"), str(encrypted)], env=backup_env, check=True)
            restore_started = time.monotonic()
            # 전부 인증된 뒤에만 복구한다. 실패한 복호화의 부분 평문을 복구기에 흘리지 않는다.
            with plain.open("xb") as output:
                plain.chmod(0o600)
                subprocess.run([age, "--decrypt", "--identity", str(key), str(encrypted)],
                               stdout=output, stderr=subprocess.DEVNULL, check=True)
            if os.environ.get("CHECK_PRODUCTION_ARCHIVE") == "1":
                # PGDMP + 아카이브 주/부 버전: 운영 PG17.11의 custom 형식 1.16.
                assert plain.read_bytes()[:7] == b"PGDMP\x01\x10", "운영 아카이브 형식 불일치"
            # 필터한 dump는 public CREATE를 포함하지만 확장 자체는 포함하지 않는다.
            # 새 빈 시험 DB의 기본 public만 없애고, 확장은 별도 스키마에 준비한다.
            sql(target, "DROP SCHEMA public; CREATE SCHEMA extensions; CREATE EXTENSION btree_gist SCHEMA extensions")
            with plain.open("rb") as incoming:
                subprocess.run([os.environ.get("PG_RESTORE_BIN", "pg_restore"), "--dbname", target,
                                "--single-transaction", "--exit-on-error", "--no-owner", "--no-privileges"],
                               stdin=incoming, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            # Vault 비밀을 복원하지 않고 앱 전용 함수만 원본 이행에서 복구한다.
            restore_cmd = ["bash", str(TOOLS / "restore-ledger-functions.sh")]
            restore_env = {**os.environ, "PGDATABASE": target, "SILJANG_LEDGER_RESTORE": "1"}
            denied = subprocess.run(restore_cmd, env={**restore_env, "SILJANG_LEDGER_RESTORE": "0"}, capture_output=True)
            assert denied.returncode != 0, "명시적 복구 선택 없이 함수 복구 허용"
            for variable in ["PGSERVICE", "PGSERVICEFILE", "PGHOSTADDR", "PGOPTIONS"]:
                assert subprocess.run(restore_cmd, env={**restore_env, variable: "synthetic"}, capture_output=True).returncode != 0, f"{variable} 허용"
            assert subprocess.run(restore_cmd, env={**restore_env, "PGDATABASE": "postgresql://example.invalid/test"}, capture_output=True).returncode != 0, "연결 문자열을 DB 이름으로 허용"
            sql("postgres", f'GRANT CONNECT ON DATABASE "{target}" TO PUBLIC')
            denied = subprocess.run(restore_cmd, env=restore_env, capture_output=True)
            assert denied.returncode != 0, "공개 연결이 열린 대상에 함수 복구 허용"
            assert sql(target, "SELECT to_regnamespace('siljang_ledger_private') IS NULL").strip() == b"t"
            sql("postgres", f'REVOKE CONNECT ON DATABASE "{target}" FROM PUBLIC')
            original = sql(target, "SELECT pg_get_functiondef('public.read_owner_ledger(uuid,uuid,uuid)'::regprocedure)").decode()
            marker = "$function$"
            assert original.count(marker) == 2
            changed = original.rsplit(marker, 1)[0] + "\n-- synthetic version mismatch\n" + marker + ";"
            sql(target, "SET check_function_bodies=off; " + changed)
            assert subprocess.run(restore_cmd, env=restore_env, capture_output=True).returncode != 0, "다른 버전의 복구 함수 덮어쓰기 허용"
            assert sql(target, "SELECT to_regnamespace('siljang_ledger_private') IS NULL").strip() == b"t"
            sql(target, "SET check_function_bodies=off; " + original + ";")
            subprocess.run(restore_cmd, env=restore_env, check=True)
            assert subprocess.run(restore_cmd, env=restore_env, capture_output=True).returncode != 0, "이미 적용한 대상 재실행 허용"
            ledger_state = sql(target, f"SELECT status FROM public.read_owner_ledger('{ledger_shop}'::uuid,'{ledger_owner}'::uuid,NULL)").strip()
            assert ledger_state == b"auth_lost", "Vault 없는 복구의 재연결 상태 불일치"
            sql(target, (TOOLS / "restore-fence.sql").read_text())
            assert sql(target, "SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND prosecdef AND has_function_privilege('public',oid,'EXECUTE')").strip() == b"0"
            assert sql(target, "SELECT count(*) FROM pg_trigger WHERE tgrelid='public.orders'::regclass AND tgname='orders_purge_ledger_signatures' AND NOT tgisinternal").strip() == b"1", "장부 서명 삭제 트리거 복구 실패"
            assert snapshot(target) == before, "복구 기록 불일치"
            assert sql(target, sequence_query) == sequences_before, "복구 시퀀스 불일치"
            proof = {"server_major": int(sql(source, "SHOW server_version_num")) // 10000,
                     "tables_compared": len(before), "records": counts, "lost_records": 0,
                     "sequences_compared": len(json.loads(sequences_before)),
                     "public_security_definer_execute": 0, "ledger_auth_lost_after_public_restore": True,
                     "unsafe_role_rejections": len(unsafe_cases), "backup_role_update_rejected": True,
                     "restore_seconds": round(time.monotonic() - restore_started, 3),
                     "total_seconds": round(time.monotonic() - started, 3)}
    finally:
        for database in reversed(created):
            sql("postgres", f'DROP DATABASE "{database}" WITH (FORCE)')
        if role_created:
            sql("postgres", f'DROP ROLE "{role}"')
    proof["remaining_test_databases"] = int(sql("postgres", f"SELECT count(*) FROM pg_database WHERE datname IN ('{source}','{target}')"))
    print(json.dumps(proof, sort_keys=True))


if __name__ == "__main__":
    os.umask(0o077)
    try:
        run()
    except AssertionError as error:
        print("합성 백업 복구 시험 실패: " + str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print("합성 백업 복구 시험 실패", file=sys.stderr)
        sys.exit(1)
