#!/bin/bash
# db/migrations/의 마이그레이션을 파일 이름 차례로 빈 데이터베이스에 적용한다(TASK-017, 04 공통 규칙 G3).
#
# 사용: bash tools/db-migrate.sh "<libpq 연결 문자열(dbname 포함)>"
#   예: bash tools/db-migrate.sh "host=127.0.0.1 port=54329 user=postgres dbname=migrated"
#
# - 파일 이름이 0001_부터 빈틈없이 이어지는지 먼저 본다(번호가 빠지거나 겹치면 아무것도 하지 않고 끝 상태 2).
# - 파일마다 한 트랜잭션(psql -1, ON_ERROR_STOP)으로 적용하고 '파일 이름 ok 걸린 초'를 한 줄씩 찍는다.
# - 하나라도 실패하면 그 파일 이름과 psql 오류를 찍고 멈춘다(끝 상태 1). 뒤 파일은 적용하지 않는다.
# - 적용한 판을 데이터베이스에 남기지 않으므로 빈 데이터베이스에만 쓴다. public 스키마에 테이블이 이미 있으면
#   아무것도 하지 않고 멈춘다(끝 상태 2). 스테이징처럼 판을 남기며 이어서 적용하는 방법은 TASK-174에서 정한다.
set -u -o pipefail
export LC_ALL=C # 파일 이름을 바이트 차례로 정렬하고, 걸린 초의 소수점을 '.'으로

CONN=${1:-}
if [ -z "$CONN" ]; then
  echo '사용: bash tools/db-migrate.sh "<연결 문자열(dbname 포함)>"' >&2
  exit 2
fi
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd) || exit 2
PSQL=(psql -X -q -v ON_ERROR_STOP=1)

shopt -s nullglob
files=("$ROOT"/db/migrations/*.sql)
if [ ${#files[@]} -eq 0 ]; then
  echo "db/migrations/에 .sql 파일이 없음" >&2
  exit 2
fi
i=0
for f in "${files[@]}"; do
  i=$((i + 1))
  want=$(printf '%04d_' "$i")
  name=$(basename "$f")
  if [[ $name != "$want"* ]]; then
    echo "번호가 이어지지 않음: ${want%_} 자리에 $name" >&2
    exit 2
  fi
done

if ! n=$("${PSQL[@]}" -A -t -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'" "$CONN" 2>&1); then
  echo "연결하지 못함: $n" >&2
  exit 2
fi
if [ "$n" != 0 ]; then
  echo "public에 테이블 ${n}개가 있어 멈춤(빈 데이터베이스에만 적용)" >&2
  exit 2
fi

for f in "${files[@]}"; do
  name=$(basename "$f")
  t0=$EPOCHREALTIME
  if ! out=$("${PSQL[@]}" -1 -f "$f" "$CONN" 2>&1); then
    echo "$name 실패"
    printf '%s\n' "$out"
    exit 1
  fi
  awk -v n="$name" -v a="$t0" -v b="$EPOCHREALTIME" 'BEGIN { printf "%s ok %.2f초\n", n, b - a }'
done
echo "마이그레이션 ${#files[@]}개를 차례로 적용함"
