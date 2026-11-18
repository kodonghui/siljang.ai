# db: 05 스키마와 마이그레이션

05단계(ERD)의 원본입니다. 파일마다 무엇인지와 고치는 차례는 [05 README](../docs/05-erd/README.md) 2절, 검사 결과는 8절에 있습니다.

- `schema.sql`: 지금 스키마 전체(05 원본).
- `migrations/`: 빈 데이터베이스에서 `schema.sql`과 같은 스키마를 만드는 마이그레이션(0001부터 번호 차례, 지금은 0022까지). 한 번 적용한 파일은 고치지 않고 다음 번호로 더합니다(05 README 2절).
- `schema.erd.json`: ERD Editor 다이어그램(사람이 보는 곳, 05 README 9절).

## CI (TASK-017)

[`.github/workflows/db.yml`](../.github/workflows/db.yml)이 PR과 main push마다 PostgreSQL 16.15(공식 이미지 `postgres:16.15-bookworm`, digest 고정)의 빈 서버에서 차례로 돌립니다. 비밀 값은 넘기지 않습니다.

1. [`tools/db-migrate.sh`](../tools/db-migrate.sh): 마이그레이션을 빈 데이터베이스에 파일 이름 차례로 하나씩(파일마다 한 트랜잭션) 적용하고 파일마다 한 줄을 찍습니다. 번호가 0001부터 이어지지 않거나 public 스키마에 테이블이 이미 있으면 아무것도 하지 않고, 적용하다 실패하면 그 파일에서 멈춥니다.
2. [`tools/db-rule-tests.sh`](../tools/db-rule-tests.sh): 1에서 만든 데이터베이스에서 05 규칙 테스트(`research/cake-erd-2026-11/rule_tests.sql`)를 돌리고, 파일 안의 시험 줄 수만큼 모두 기대한 대로인지 봅니다. 시험 쓰기는 끝에 모두 되돌립니다.
3. `research/cake-erd-2026-11/check_erd.py`: 05 검사 15개(정적 검사, `schema.sql`과 마이그레이션의 카탈로그 비교, 규칙 테스트, 두 세션 동시 쓰기, ERD Editor 파일).

## 로컬에서 같은 일

검사용 PostgreSQL 16 서버에서만 돌립니다(1은 새 데이터베이스를 만들고, 3은 검사용 데이터베이스를 지우고 다시 만듦).

```bash
PG="host=127.0.0.1 port=54329 user=postgres"
psql -X -c "CREATE DATABASE migrated TEMPLATE template0" "$PG dbname=postgres"
bash tools/db-migrate.sh "$PG dbname=migrated"
bash tools/db-rule-tests.sh "$PG dbname=migrated"
python3 -B research/cake-erd-2026-11/check_erd.py . --db "$PG"
```

## 아직 아닌 것

- 스테이징 데이터베이스에 CI와 같은 판을 적용하고 적용한 판을 남기는 방법은 TASK-174(Supabase에 맞추기)에서 정합니다. 그때까지 `tools/db-migrate.sh`는 빈 데이터베이스에만 씁니다.
- PostgreSQL 17(Supabase 새 프로젝트의 기본)에서 CI를 돌리는 것도 TASK-174입니다.
