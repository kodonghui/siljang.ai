#!/usr/bin/env python3
"""public 스키마의 일관된 pg_dump를 디스크 평문 없이 age로 암호화한다."""
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile


def backup(destination):
    connection = os.environ.get("BACKUP_DATABASE_URL", "")
    recipient = os.environ.get("BACKUP_AGE_RECIPIENT", "")
    if not connection or not re.fullmatch(r"age1[0-9a-z]{58}", recipient):
        raise ValueError("configuration")
    if destination.exists() or destination.is_symlink() or destination.suffix != ".age":
        raise ValueError("destination")
    pg_env = {k: v for k, v in os.environ.items() if not k.startswith("BACKUP_")}
    pg_env["PGDATABASE"] = connection
    pg_env["PGCONNECT_TIMEOUT"] = "30"
    pg_env["PGOPTIONS"] = "-c default_transaction_read_only=on -c statement_timeout=600000"
    age_env = {k: v for k, v in pg_env.items() if not k.startswith("PG")}
    children = []
    with tempfile.TemporaryDirectory(prefix=".backup-", dir=destination.parent) as private:
        encrypted = Path(private) / "dump.age"
        try:
            with encrypted.open("xb") as output:
                encrypted.chmod(0o600)
                dump = subprocess.Popen(
                    [os.environ.get("PG_DUMP_BIN", "pg_dump"), "--format=custom", "--schema=public",
                     "--no-owner", "--no-privileges", "--no-publications", "--no-subscriptions",
                     "--lock-wait-timeout=30s"],
                    env=pg_env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                )
                children.append(dump)
                age = subprocess.Popen(
                    [os.environ.get("AGE_BIN", "age"), "--encrypt", "--recipient", recipient],
                    env=age_env, stdin=dump.stdout, stdout=output, stderr=subprocess.DEVNULL,
                )
                children.append(age)
                dump.stdout.close()
                dump_result = dump.wait(timeout=660)
                age_result = age.wait(timeout=60)
                if dump_result or age_result or not encrypted.stat().st_size:
                    raise RuntimeError("pipeline")
                output.flush()
                os.fsync(output.fileno())
            # 같은 이름을 경합 중 다른 실행이 만들었어도 덮어쓰지 않는다.
            os.link(encrypted, destination)
        finally:
            for child in children:
                if child.poll() is None:
                    child.kill()
                child.wait()


if __name__ == "__main__":
    os.umask(0o077)
    try:
        if len(sys.argv) != 2:
            raise ValueError("arguments")
        backup(Path(sys.argv[1]))
    except (Exception, KeyboardInterrupt):
        # 연결 문자열·테이블 내용·제공자의 stderr는 공개 Actions 로그에 쓰지 않는다.
        print("암호화 백업 실패: 설정·연결·암호화 단계를 비공개 환경에서 확인하세요.", file=sys.stderr)
        sys.exit(1)
    print("암호화 백업 완료")
