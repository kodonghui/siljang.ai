#!/usr/bin/env bash
set -euo pipefail

health_url=${SILJANG_STAGING_HEALTH_URL:?SILJANG_STAGING_HEALTH_URL is required}
response=$(curl --proto '=https' --silent --show-error --max-time 10 \
  --write-out $'\n%{http_code}' -- "$health_url")
status=${response##*$'\n'}
if [[ "$status" != 200 ]]; then
  printf 'Siljang staging health check failed: HTTP %s\n' "$status" >&2
  exit 1
fi

if ! jq -e 'type == "object" and .status == "ok"' >/dev/null 2>&1 <<< "${response%$'\n'*}"; then
  printf 'Siljang staging health check failed: invalid health response\n' >&2
  exit 1
fi

printf 'Siljang staging health check passed: HTTP 200, status=ok\n'
