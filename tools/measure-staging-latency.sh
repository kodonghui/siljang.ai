#!/usr/bin/env bash
# TASK-171 → TASK-172. From each test host, time the staging Worker response and, when configured, a PostgreSQL SELECT 1.
# Optional PG* settings are already present in the host process environment or its local PostgreSQL service file.
set -euo pipefail

staging=${1:-}
attempts=${2:-5}
if [[ ! $staging =~ ^https://[^/@?#]+/?$ || ! $attempts =~ ^([1-9]|1[0-9]|20)$ ]]; then
  echo '사용: measure-staging-latency.sh https://스테이징-호스트 [횟수(1~20)]' >&2
  exit 2
fi
staging=${staging%/}
headers=$(mktemp)
trap 'rm -f -- "$headers"' EXIT

measure_db=false
if [[ -n ${PGSERVICE:-} || -n ${PGHOST:-} ]]; then
  if ! command -v psql >/dev/null; then
    echo 'PostgreSQL 연결 설정을 사용하려면 psql이 필요합니다.' >&2
    exit 2
  fi
  measure_db=true
fi

failed=0
for ((round = 1; round <= attempts; round++)); do
  if result=$(curl -s --max-time 15 -D "$headers" -o /dev/null --write-out '%{http_code} %{time_total}' "$staging/api/healthz"); then
    read -r status seconds <<< "$result"
    colo=$(awk 'tolower($1) == "cf-ray:" { gsub(/\r/, "", $2); sub(/^.*-/, "", $2); print $2 }' "$headers" | tail -n 1)
    [[ $status == 200 ]] || failed=1
    printf 'worker sample=%d status=%s colo=%s time_s=%s\n' "$round" "$status" "${colo:--}" "$seconds"
  else
    printf 'worker sample=%d status=connection_error\n' "$round"
    failed=1
  fi

  if "$measure_db"; then
    start=$(date +%s%N)
    if value=$(PGCONNECT_TIMEOUT=5 psql -X -w -Atq -c 'SELECT 1' 2>/dev/null) && [[ $value == 1 ]]; then
      elapsed=$(( ($(date +%s%N) - start) / 1000000 ))
      printf 'postgres sample=%d status=ok time_ms=%d\n' "$round" "$elapsed"
    else
      printf 'postgres sample=%d status=connection_error\n' "$round"
      failed=1
    fi
  fi
done
if ! "$measure_db"; then
  echo 'postgres status=skipped reason=no_local_connection_settings'
fi
exit "$failed"
