#!/usr/bin/env bash
# DB 연결 문자열은 docker 명령 인자에 펼치지 않는다. 스키마 비밀 값은 이 컨테이너에만 전달한다.
set -euo pipefail
exec docker run --rm --network host \
  -e PGDATABASE -e PGOPTIONS -e PGCONNECT_TIMEOUT -e PGSSLMODE=verify-full \
  postgres:17.11-bookworm@sha256:665dc7b37ac52a17e298511414c21d23ffa4e6a6ef6225b3e5d59c7afb35e994 \
  pg_dump "$@"
