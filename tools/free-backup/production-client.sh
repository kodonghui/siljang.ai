#!/usr/bin/env bash
# DB 연결 문자열은 docker 명령 인자에 펼치지 않는다. 스키마 비밀 값은 이 컨테이너에만 전달한다.
set -euo pipefail
# libpq의 URI sslmode는 PGSSLMODE보다 우선한다. 완전 검증을 명시한 URI만 받는다.
python3 -I - <<'PY'
import os
import sys
from urllib.parse import parse_qs, urlsplit
try:
    uri = urlsplit(os.environ["PGDATABASE"])
    valid = uri.scheme in ("postgres", "postgresql") and uri.hostname and parse_qs(uri.query).get("sslmode") == ["verify-full"]
except (KeyError, ValueError):
    valid = False
if not valid:
    print("백업 연결은 sslmode=verify-full URI가 필요합니다.", file=sys.stderr)
    sys.exit(1)
PY
test -s /etc/ssl/certs/ca-certificates.crt
exec docker run --rm --network host \
  --mount type=bind,source=/etc/ssl/certs/ca-certificates.crt,target=/etc/ssl/certs/ca-certificates.crt,readonly \
  -e PGDATABASE -e PGOPTIONS -e PGCONNECT_TIMEOUT -e PGSSLMODE=verify-full \
  -e PGSSLROOTCERT=/etc/ssl/certs/ca-certificates.crt \
  postgres:17.11-bookworm@sha256:665dc7b37ac52a17e298511414c21d23ffa4e6a6ef6225b3e5d59c7afb35e994 \
  pg_dump "$@"
