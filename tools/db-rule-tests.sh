#!/bin/bash
# 05 규칙 테스트(research/cake-erd-2026-11/rule_tests.sql)를 주어진 데이터베이스에서 돌리고 기대한 수와 견준다(TASK-017).
#
# 사용: bash tools/db-rule-tests.sh "<libpq 연결 문자열(dbname 포함)>"
#   보통 tools/db-migrate.sh로 마이그레이션을 적용한 데이터베이스에 돌린다. 시험 쓰기는 끝에 모두 되돌린다(ROLLBACK).
#
# 통과: 'rule_tests: N blocked, 0 not blocked'이고 N이 파일 안의 시험 줄(SELECT pg_temp.expect_…) 수와 같음.
#   check_erd.py의 D4와 같은 셈이다(D4는 schema.sql로 만든 데이터베이스에서 돌림).
# 끝 상태: 통과 0, 실패 1(실패한 시험의 이름과 사유를 찍음), 끝까지 돌지 않음 2.
set -u -o pipefail

CONN=${1:-}
if [ -z "$CONN" ]; then
  echo '사용: bash tools/db-rule-tests.sh "<연결 문자열(dbname 포함)>"' >&2
  exit 2
fi
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd) || exit 2
SQL="$ROOT/research/cake-erd-2026-11/rule_tests.sql"

want=$(grep -cE '^SELECT pg_temp\.expect_(fail|stale|left|ok)\(' "$SQL")
out=$(psql -X -q -v ON_ERROR_STOP=1 -f "$SQL" "$CONN" 2>&1)
rc=$?
line=$(printf '%s\n' "$out" | grep -oE 'rule_tests: [0-9]+ blocked, [0-9]+ not blocked' | tail -1)
if [ $rc -ne 0 ] || [ -z "$line" ]; then
  echo "규칙 테스트가 끝까지 돌지 않음(psql 끝 상태 $rc)"
  printf '%s\n' "$out" | tail -20
  exit 2
fi
read -r blocked not_blocked < <(printf '%s\n' "$line" | grep -oE '[0-9]+' | paste -sd ' ')
echo "$line (파일 안의 시험 줄 ${want}개)"
if [ "$not_blocked" != 0 ] || [ "$blocked" != "$want" ]; then
  echo "기대와 다른 시험:"
  # 끝의 행 수 표(orders | order_details | …) 앞까지, '이름 | 사유' 줄만
  printf '%s\n' "$out" | awk '/^ *orders +\|/ { exit } /\|/ && !/rule_tests:/' | head -40
  exit 1
fi
echo "규칙 테스트 ${want}개 모두 기대한 대로"
