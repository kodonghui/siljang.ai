#!/usr/bin/env bash
# CI 서비스와 같은 주 버전의 pg_dump/pg_restore를 쓴다. 연결 값은 인자가 아닌 환경으로 넘긴다.
set -euo pipefail
tool=$(basename "$0")
case "$tool" in pg_dump|pg_restore) ;; *) exit 2 ;; esac
exec docker exec -i \
  -e PGDATABASE -e PGUSER -e PGOPTIONS -e PGCONNECT_TIMEOUT \
  -e PGHOST=127.0.0.1 -e PGPORT=5432 \
  "${TEST_PG_CONTAINER:?시험 컨테이너가 필요합니다}" "$tool" "$@"
