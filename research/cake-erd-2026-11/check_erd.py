#!/usr/bin/env python3
"""05단계 ERD 검사: CORTHEX 05-erd 계약의 검사를 한 번에 돌린다.

검사 (실패가 하나라도 있으면 끝 상태 1)
  S1 TBL 번호가 중복되지 않고 TBL-001부터 차례대로이며, 테이블 이름도 중복되지 않음
  S2 헤더 주석 컨텍스트가 CTX-001~009나 '공통'
  S3 헤더 주석 SPEC 목록이 erd_map.py 대응에서 나온 목록과 같음
  S4 기능 명세의 SPEC마다 대응이 하나 이상이고, 대응한 테이블.컬럼이 모두 스키마에 있음
  S5 쓰이지 않는 테이블이 없음(모든 테이블이 어떤 SPEC의 대응에 나옴)
  S6 모든 컬럼 줄 끝에 설명이 있음
  S7 01단계 애그리거트(3-1)·읽기 모델(5-2) 용어가 테이블 헤더 주석이나 '테이블 없음' 행 가운데 한쪽에만 있고,
     용어의 컨텍스트가 테이블이나 행의 컨텍스트와 맞음(정한 예외는 erd_map.TERM_CTX_EXCEPTIONS).
     '테이블 없음' 행이 참조하는 TBL 번호가 모두 있음. 나머지 용어(상태·값 이름)는 컬럼이나 테이블 설명에 TERM 번호가 있음
  S8 COMMENT ON TABLE이 테이블마다 하나이고 헤더 주석과 같은 TBL 번호로 시작
  S9 build_erd.py를 다시 돌려도 바뀌는 파일이 없음
  D1 db/schema.sql을 빈 DB에 한 트랜잭션으로 적용
  D2 db/migrations/*.sql을 차례대로 다른 빈 DB에 적용하면 두 DB의 테이블·컬럼·제약·인덱스·설명·확장이 같음
  D3 실제 DB에서 테이블마다 기본 키가 있고, 테이블 설명이 헤더 주석의 TBL 번호로 시작하며, 대응한 컬럼이 모두 있음
  D4 규칙 테스트(rule_tests.sql)의 테스트가 모두 기대한 제약에 막힘. 같은 잠금 번호를 읽고 늦게 쓴 쓰기(expect_stale)는 0행
  D5 두 세션이 같은 주문에 결제 확인과 손님 취소를 같은 값을 읽고 동시에 쓰면, 잠금 번호(lock_version)를 견줄 때는
     늦은 쪽이 먼저 쓴 쪽의 커밋을 기다린 뒤 0행이고, 내용 버전(version)을 견주는 옛 방식으로는 늦은 쪽이 덮어씀(설계 재검토 H12)
  E1 ERD Editor 파일(db/schema.erd.json)의 테이블·컬럼·타입·NOT NULL·기본 키가 스키마와 같음.
     다르면 테이블·컬럼별 차이와 파일 날짜를 보임(CHECK·EXCLUDE·부분 인덱스처럼 ERD Editor가 담지 못하는 것은 따로 셈)

쓰는 법(저장소 맨 위에서)
  python3 -B research/cake-erd-2026-11/check_erd.py . --db "host=localhost port=5432 user=postgres"
  --db를 빼면 D1~D5를 '미확인'으로 보고함. 검사용 DB erd_check_schema·erd_check_migrations를 만들고
  끝나면 지움(--keep이면 남김). 같은 이름의 DB가 있으면 지우고 다시 만드니 검사용 서버에서만 돌림.
"""
from __future__ import annotations

import difflib
import importlib.util
import json
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC_DOC = "docs/04-functional-spec/spec.md"
DOMAIN_DOC = "docs/01-domain/domain.md"
RULE_TESTS = HERE / "rule_tests.sql"
ERD_FILE = "db/schema.erd.json"
DB_SCHEMA, DB_MIGRATIONS = "erd_check_schema", "erd_check_migrations"


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


build_erd = load("build_erd", HERE / "build_erd.py")
erd_map = load("erd_map", HERE / "erd_map.py")


class Report:
    def __init__(self) -> None:
        self.rows: list[tuple[str, str, str]] = []

    def add(self, key: str, ok: bool | None, text: str, details: list[str] | None = None) -> None:
        word = {True: "통과", False: "실패", None: "미확인"}[ok]
        self.rows.append((key, word, text))
        print(f"{word} {key} {text}")
        for d in (details or [])[:40]:
            print(f"      {d}")
        if details and len(details) > 40:
            print(f"      … 그 밖에 {len(details) - 40}개")

    def summary(self) -> int:
        n = {w: sum(1 for _, x, _ in self.rows if x == w) for w in ("통과", "실패", "미확인")}
        print(f"\n검사 {len(self.rows)}개: 통과 {n['통과']}, 실패 {n['실패']}, 미확인 {n['미확인']}")
        return 1 if n["실패"] else 0


# ── 문서 읽기 ───────────────────────────────────────────────────────────────

def spec_ids(root: Path) -> list[str]:
    text = (root / SPEC_DOC).read_text(encoding="utf-8")
    return sorted(set(re.findall(r"\bSPEC-\d{3}\b", text)))


def glossary(root: Path) -> dict[str, tuple[str, set[str]]]:
    """TERM ID → (이름, 컨텍스트 집합). '전체'는 {'전체'}."""
    out = {}
    for line in (root / DOMAIN_DOC).read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\| (TERM-\d{3}) \| ([^|]+) \| [^|]* \| ([^|]+) \|", line)
        if m:
            ctx = m.group(3).strip()
            out[m.group(1)] = (m.group(2).strip(), {"전체"} if ctx == "전체" else set(re.findall(r"CTX-\d{3}", ctx)))
    return out


def table_rows(root: Path, heading: str) -> list[list[str]]:
    """domain.md에서 heading으로 시작하는 절의 첫 표 행들(헤더 행·구분 행 뺌)."""
    lines = (root / DOMAIN_DOC).read_text(encoding="utf-8").splitlines()
    start = next(i for i, l in enumerate(lines) if l.startswith(heading))
    rows, seen_table = [], False
    for l in lines[start + 1:]:
        if l.startswith("|"):
            seen_table = True
            cells = [c.strip() for c in l.strip().strip("|").split("|")]
            if set("".join(cells)) <= set("- :"):
                continue
            rows.append(cells)
        elif seen_table:
            break
    return rows[1:]


def required_terms(root: Path, terms: dict[str, tuple[str, set[str]]]) -> dict[str, str]:
    """애그리거트(3-1)와 읽기 모델(5-2) 용어 ID → 종류."""
    by_name = {name: tid for tid, (name, _) in terms.items()}
    out: dict[str, str] = {}
    for cells in table_rows(root, "### 3-1. 컨텍스트"):
        for name in cells[3].split(","):
            out[by_name[name.strip()]] = "애그리거트"
    for cells in table_rows(root, "### 5-2. 읽기 모델"):
        out[by_name[cells[0]]] = "읽기 모델"
    return out


# ── 정적 검사 ───────────────────────────────────────────────────────────────

def static_checks(root: Path, rep: Report) -> list:
    schema_text = (root / build_erd.SCHEMA).read_text(encoding="utf-8")
    tables = build_erd.parse(schema_text)
    names = [t.name for t in tables]

    want = [f"TBL-{i:03d}" for i in range(1, len(tables) + 1)]
    got = [t.tbl for t in tables]
    dup_names = sorted({n for n in names if names.count(n) > 1})
    rep.add("S1", got == want and not dup_names,
            f"TBL 번호 {len(tables)}개(TBL-001~TBL-{len(tables):03d}), 테이블 이름 중복 없음",
            [f"번호 순서: {a} 자리에 {b}" for a, b in zip(want, got) if a != b] + [f"중복된 이름: {n}" for n in dup_names])

    bad_ctx = [f"{t.tbl} {t.name}: {t.ctx}" for t in tables if t.ctx not in build_erd.CTX_NAMES]
    rep.add("S2", not bad_ctx, "헤더 주석 컨텍스트가 CTX-001~009나 공통", bad_ctx)

    derived = build_erd.specs_by_table(erd_map.MAP)
    diff = [f"{t.tbl} {t.name}: 헤더 주석 {', '.join(t.specs)} / 대응 {', '.join(derived.get(t.name, []))}"
            for t in tables if t.specs != derived.get(t.name, [])]
    rep.add("S3", not diff, "헤더 주석 SPEC 목록이 erd_map.py 대응과 같음", diff)

    ids = spec_ids(root)
    cols = {(t.name, c.name) for t in tables for c in t.columns}
    pairs = [(s, d, tc) for s, ps in erd_map.MAP.items() for d, tc in ps]
    problems = [f"{s}: 대응 없음" for s in ids if not erd_map.MAP.get(s)]
    problems += [f"{s}: 기능 명세에 없는 SPEC" for s in erd_map.MAP if s not in ids]
    problems += [f"{s} '{d}': {tc} 컬럼이 스키마에 없음" for s, d, tc in pairs if tuple(tc.split(".")) not in cols]
    used_cols = {tc for _, _, tc in pairs}
    rep.add("S4", not problems,
            f"SPEC {len(ids)}개 모두 대응 있음: 데이터 {len(pairs)}건 → 컬럼 {len(used_cols)}개(전체 컬럼 {len(cols)}개)", problems)

    used = {tc.split(".")[0] for tc in used_cols}
    unused = [f"{t.tbl} {t.name}" for t in tables if t.name not in used]
    rep.add("S5", not unused, f"쓰이지 않는 테이블 없음({len(tables)}개 모두 SPEC 대응에 나옴)", unused)

    no_comment = [f"{t.name}.{c.name}" for t in tables for c in t.columns if not c.comment]
    rep.add("S6", not no_comment, f"컬럼 {len(cols)}개 모두 설명 있음", no_comment)

    terms = glossary(root)
    required = required_terms(root, terms)
    in_tables: dict[str, list] = {}
    for t in tables:
        for term in t.terms:
            in_tables.setdefault(term, []).append(t)
    without = {}
    for m in re.finditer(r"^-- without a table: (TERM-\d{3}) \(([^,]+), (.*)\)$", schema_text, re.M):
        without[m.group(1)] = (m.group(2), m.group(3))
    issues = []
    for term in sorted(set(in_tables) | set(without)):
        if term not in terms:
            issues.append(f"{term}: 용어집에 없음")
    for term, kind in sorted(required.items()):
        a, b = term in in_tables, term in without
        if a == b:
            issues.append(f"{term} {terms[term][0]}({kind}): " + ("테이블 헤더 주석과 '테이블 없음' 행 둘 다에 있음" if a else "어디에도 없음"))
    for term, ts in sorted(in_tables.items()):
        ctxs = terms.get(term, ("", set()))[1]
        for t in ts:
            if "전체" in ctxs or t.ctx in ctxs:
                continue
            if (t.name, term) in erd_map.TERM_CTX_EXCEPTIONS:
                continue
            issues.append(f"{term}: 용어집 {', '.join(sorted(ctxs))}인데 {t.tbl} {t.name}은 {t.ctx}")
    tbl_ids = {t.tbl for t in tables}
    for term, (ctx_text, rest) in sorted(without.items()):
        ctxs = {"전체"} if ctx_text == "전체" else set(re.findall(r"CTX-\d{3}", ctx_text))
        if ctxs != terms.get(term, ("", set()))[1]:
            issues.append(f"{term}: '테이블 없음' 행 컨텍스트 {ctx_text} ≠ 용어집 {', '.join(sorted(terms[term][1]))}")
        for grp in re.findall(r"TBL-(\d{3}(?:·\d{3})*)", rest):
            for n in grp.split("·"):
                if f"TBL-{n}" not in tbl_ids:
                    issues.append(f"{term}: '테이블 없음' 행이 없는 TBL-{n}을 참조함")
    described = set()
    for m in re.finditer(r"^COMMENT ON (?:COLUMN|TABLE) \S+ IS '(.*)';$", schema_text, re.M):
        described |= set(re.findall(r"TERM-\d{3}", m.group(1)))
    rest = sorted(set(terms) - set(in_tables) - set(without))
    issues += [f"{term} {terms[term][0]}: 테이블 헤더 주석·'테이블 없음' 행·컬럼 설명 어디에도 없음" for term in rest if term not in described]
    n_agg = sum(1 for k in required.values() if k == "애그리거트")
    exc = ", ".join(f"{term}→{name}" for (name, term) in erd_map.TERM_CTX_EXCEPTIONS)
    rep.add("S7", not issues,
            f"애그리거트 {n_agg}개·읽기 모델 {len(required) - n_agg}개 용어가 테이블 헤더 주석 {sum(1 for x in required if x in in_tables)}개"
            f"·'테이블 없음' 행 {sum(1 for x in required if x in without)}개에 한 번씩, 나머지 용어 {len(rest)}개는 컬럼·테이블 설명에. "
            f"용어집 {len(terms)}개 모두 자리 있음. 컨텍스트 예외 {exc}", issues)

    comments = re.findall(r"^COMMENT ON TABLE (\w+) IS '(TBL-\d{3}) ", schema_text, re.M)
    by_table: dict[str, list[str]] = {}
    for name, tbl in comments:
        by_table.setdefault(name, []).append(tbl)
    bad = [f"{t.tbl} {t.name}: 테이블 설명 {by_table.get(t.name, ['없음'])}" for t in tables if by_table.get(t.name) != [t.tbl]]
    rep.add("S8", not bad, "테이블 설명이 테이블마다 하나이고 헤더 주석과 같은 TBL 번호로 시작", bad)

    _, targets = build_erd.build(root, migration=False)
    stale = [str(p.relative_to(root)) for p, new in targets.items()
             if (p.read_text(encoding="utf-8") if p.exists() else None) != new]
    rep.add("S9", not stale, "build_erd.py로 만든 부분(헤더 주석 SPEC·컬럼 설명·README 표와 다이어그램)이 최신", stale)
    return tables


# ── DB 검사 ────────────────────────────────────────────────────────────────

CATALOG_SQL = r"""
SELECT regexp_replace(line, '\s*\n\s*', ' ', 'g') FROM (
SELECT 'extension ' || extname AS line FROM pg_extension WHERE extname <> 'plpgsql'
UNION ALL
SELECT 'table ' || c.relname || ' | ' || coalesce(obj_description(c.oid, 'pg_class'), '')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
UNION ALL
SELECT 'column ' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
       || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END
       || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
       || ' | ' || coalesce(col_description(c.oid, a.attnum), '')
FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
UNION ALL
SELECT 'constraint ' || c.relname || ' ' || con.conname || ' ' || pg_get_constraintdef(con.oid)
FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
UNION ALL
SELECT 'index ' || indexdef FROM pg_indexes WHERE schemaname = 'public'
UNION ALL
SELECT 'trigger ' || tgrelid::regclass || ' ' || tgname FROM pg_trigger WHERE NOT tgisinternal
UNION ALL
SELECT 'function ' || p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND NOT EXISTS (SELECT 1 FROM pg_depend dp WHERE dp.objid = p.oid AND dp.deptype = 'e')
UNION ALL
SELECT 'view ' || viewname FROM pg_views WHERE schemaname = 'public'
UNION ALL
SELECT 'sequence ' || sequencename FROM pg_sequences WHERE schemaname = 'public'
) catalog ORDER BY 1
"""

FACTS_SQL = r"""
SELECT c.relname, coalesce(obj_description(c.oid, 'pg_class'), ''),
       EXISTS (SELECT 1 FROM pg_constraint p WHERE p.conrelid = c.oid AND p.contype = 'p')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY 1
"""


class Pg:
    def __init__(self, base: str) -> None:
        self.base = base.strip()

    def conn(self, db: str) -> str:
        return f"{self.base} dbname={db}".strip()

    def run(self, db: str, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", *args, self.conn(db)],
                              capture_output=True, text=True)

    def query(self, db: str, sql: str) -> list[list[str]]:
        r = self.run(db, "-A", "-t", "-F", "\t", "-c", sql)
        if r.returncode:
            raise RuntimeError(r.stderr.strip())
        return [line.split("\t") for line in r.stdout.splitlines() if line]

    def recreate(self, db: str) -> None:
        r = self.run("postgres", "-c", f"DROP DATABASE IF EXISTS {db}", "-c", f"CREATE DATABASE {db} TEMPLATE template0")
        if r.returncode:
            raise RuntimeError(r.stderr.strip())

    def drop(self, db: str) -> None:
        self.run("postgres", "-c", f"DROP DATABASE IF EXISTS {db}")

    def apply(self, db: str, path: Path) -> str:
        r = self.run(db, "-1", "-f", str(path))
        return r.stderr.strip() if r.returncode else ""


def db_checks(root: Path, rep: Report, tables: list, base: str | None, keep: bool) -> None:
    keys = ("D1", "D2", "D3", "D4", "D5")
    if base is None:
        for k in keys:
            rep.add(k, None, "DB 연결(--db)이 없어 돌리지 않음")
        return
    pg = Pg(base)
    try:
        pg.recreate(DB_SCHEMA)
        pg.recreate(DB_MIGRATIONS)
    except (RuntimeError, FileNotFoundError) as e:
        for k in keys:
            rep.add(k, None, f"검사용 DB를 만들지 못함: {e}")
        return
    try:
        server = pg.query(DB_SCHEMA, "SHOW server_version")[0][0].split()[0]
        err = pg.apply(DB_SCHEMA, root / build_erd.SCHEMA)
        rep.add("D1", not err, f"db/schema.sql을 빈 DB에 한 트랜잭션으로 적용(PostgreSQL {server})", [err] if err else [])
        if err:
            for k in keys[1:]:
                rep.add(k, None, "D1이 실패해 돌리지 않음")
            return

        migrations = sorted((root / "db/migrations").glob("*.sql"))
        if not migrations:
            rep.add("D2", False, "db/migrations/에 마이그레이션이 없음")
        else:
            errs = [f"{m.name}: {e}" for m in migrations if (e := pg.apply(DB_MIGRATIONS, m))]
            if errs:
                rep.add("D2", False, "마이그레이션 적용 실패", errs)
            else:
                a = [r[0] for r in pg.query(DB_SCHEMA, CATALOG_SQL)]
                b = [r[0] for r in pg.query(DB_MIGRATIONS, CATALOG_SQL)]
                delta = [l for l in difflib.unified_diff(a, b, "schema.sql", "migrations", lineterm="", n=0)
                         if not l.startswith(("---", "+++", "@@"))]
                kinds = {}
                for line in a:
                    kinds[line.split(" ")[0]] = kinds.get(line.split(" ")[0], 0) + 1
                what = ", ".join(f"{k} {v}" for k, v in sorted(kinds.items()))
                rep.add("D2", not delta,
                        f"마이그레이션 {len(migrations)}개({', '.join(m.name for m in migrations)})로 빈 DB에서 다시 만든 카탈로그가 schema.sql과 같음({what})",
                        delta)

        facts = {r[0]: (r[1], r[2] == "t") for r in pg.query(DB_SCHEMA, FACTS_SQL)}
        cols = {(r[0], r[1]) for r in pg.query(DB_SCHEMA, "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'")}
        cons = {r[0]: r[1] for r in pg.query(DB_SCHEMA, "SELECT contype, count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public' GROUP BY 1")}
        issues = []
        for t in tables:
            if t.name not in facts:
                issues.append(f"{t.tbl} {t.name}: DB에 테이블이 없음")
                continue
            comment, has_pk = facts[t.name]
            if not has_pk:
                issues.append(f"{t.tbl} {t.name}: 기본 키 없음")
            if not comment.startswith(t.tbl + " "):
                issues.append(f"{t.tbl} {t.name}: 테이블 설명이 TBL 번호로 시작하지 않음")
        extra = sorted(set(facts) - {t.name for t in tables})
        issues += [f"{n}: 헤더 주석 없는 테이블" for n in extra]
        issues += [f"{s}: {tc} 컬럼이 DB에 없음" for s, ps in erd_map.MAP.items() for _, tc in ps if tuple(tc.split(".")) not in cols]
        rep.add("D3", not issues,
                f"DB 테이블 {len(facts)}개 모두 기본 키와 TBL 설명, 대응 컬럼 모두 있음"
                f"(기본 키 {cons.get('p', 0)}, 외래 키 {cons.get('f', 0)}, CHECK {cons.get('c', 0)}, UNIQUE {cons.get('u', 0)}, EXCLUDE {cons.get('x', 0)})",
                issues)

        rule_text = RULE_TESTS.read_text(encoding="utf-8")
        expected = len(re.findall(r"^SELECT pg_temp\.expect_(?:fail|stale)\(", rule_text, re.M))
        stale = len(re.findall(r"^SELECT pg_temp\.expect_stale\(", rule_text, re.M))
        r = pg.run(DB_SCHEMA, "-f", str(RULE_TESTS))
        m = re.search(r"rule_tests: (\d+) blocked, (\d+) not blocked", r.stdout)
        if r.returncode or not m:
            rep.add("D4", False, "규칙 테스트가 끝까지 돌지 않음", [r.stderr.strip()[-2000:]])
        else:
            blocked, not_blocked = int(m.group(1)), int(m.group(2))
            fails = [l.strip() for l in r.stdout.splitlines() if "|" in l and "rule_tests:" not in l][:20]
            rep.add("D4", not_blocked == 0 and blocked == expected,
                    f"규칙 테스트 {expected}개 가운데 기대한 제약에 막힘(늦은 쓰기 {stale}개는 0행) {blocked}개, 안 막힘 {not_blocked}개", fails if not_blocked else [])
        race_check(pg, rep)
    finally:
        if not keep:
            pg.drop(DB_SCHEMA)
            pg.drop(DB_MIGRATIONS)


# ── D5 두 세션 동시 쓰기(설계 재검토 H12) ──────────────────────────────────────

RACE_ORDER = "e5000000-0000-0000-0000-000000000001"
# 외래 키 트리거를 건너뛰어 주문 한 행만 만듦(검사용 DB에서만, 슈퍼유저). CHECK는 그대로 봄
RACE_SETUP = (
    "SET session_replication_role = replica; "
    f"DELETE FROM orders WHERE id = '{RACE_ORDER}'; "
    "INSERT INTO orders (id, shop_id, order_no, customer_id, consultation_id, draft_id, kind, status, price_list_id, "
    "operating_rules_id, details_confirmed_at, terms_consented_at, pickup_at, pickup_day, amount) "
    f"VALUES ('{RACE_ORDER}', gen_random_uuid(), 'RACE01', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), "
    "'standard', 'awaiting_payment', gen_random_uuid(), gen_random_uuid(), now(), now(), now() + interval '3 days', "
    "current_date + 3, 36000)"
)
RACE_WAYS = (  # (이름, 쓸 때 함께 바꾸는 것, 견주는 조건)
    ("옛 방식(내용 버전 version 비교)", "updated_at = now()", "version = 1"),
    ("잠금 번호(lock_version 비교)", "lock_version = lock_version + 1, updated_at = now()", "lock_version = 1"),
)


def race_once(pg: Pg, bump: str, pred: str) -> tuple[str, str, float, str]:
    """사장님 결제 확인(먼저 쓰고 1.5초 뒤 커밋)과 손님 취소(같은 값을 읽은 채로 늦게 씀)를 두 세션에서 돌린다."""
    r = pg.run(DB_SCHEMA, "-c", RACE_SETUP)
    if r.returncode:
        raise RuntimeError(r.stderr.strip())
    where = f"WHERE id = '{RACE_ORDER}' AND {pred}"
    confirm = (f"BEGIN;\nUPDATE orders SET status = 'confirmed', confirmed_at = now(), {bump} {where};\n"
               "\\echo rows :ROW_COUNT\nSELECT pg_sleep(1.5);\nCOMMIT;\n")
    cancel = (f"BEGIN;\nUPDATE orders SET status = 'cancelled', cancelled_at = now(), cancel_kind = 'customer', {bump} {where};\n"
              "\\echo rows :ROW_COUNT\nCOMMIT;\n")
    cmd = ["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", pg.conn(DB_SCHEMA)]
    s1 = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    s1.stdin.write(confirm)
    s1.stdin.close()
    for _ in range(50):  # 먼저 쓴 쪽이 행을 잡고 커밋을 미루는 중인지 봄
        busy = pg.query(DB_SCHEMA, "SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND query LIKE 'SELECT pg_sleep(1.5)%'")
        if busy and busy[0][0] == "1":
            break
        time.sleep(0.05)
    t0 = time.monotonic()
    s2 = subprocess.run(cmd, input=cancel, capture_output=True, text=True)
    waited = time.monotonic() - t0
    out1, err1 = s1.communicate()
    if s1.returncode or s2.returncode:
        raise RuntimeError((err1 + s2.stderr).strip())
    rows = lambda out: (re.findall(r"^rows (\d+)", out, re.M) or ["?"])[0]
    final = pg.query(DB_SCHEMA, f"SELECT status, lock_version FROM orders WHERE id = '{RACE_ORDER}'")[0]
    return rows(out1), rows(s2.stdout), waited, f"{final[0]}, 잠금 번호 {final[1]}"


def race_check(pg: Pg, rep: Report) -> None:
    try:
        runs = [(name, *race_once(pg, bump, pred)) for name, bump, pred in RACE_WAYS]
    except (RuntimeError, IndexError) as e:
        rep.add("D5", None, f"두 세션 동시 쓰기를 돌리지 못함: {e}")
        return
    (_, o1, o2, ow, of), (_, n1, n2, nw, nf) = runs
    reproduced = o1 == "1" and o2 == "1" and of.startswith("cancelled") and ow >= 0.5
    blocked = n1 == "1" and n2 == "0" and nf == "confirmed, 잠금 번호 2" and nw >= 0.5
    rep.add("D5", reproduced and blocked,
            "두 세션이 같은 주문에 결제 확인과 손님 취소를 같은 값을 읽고 동시에 씀: 옛 방식은 늦은 취소가 확인을 덮어쓰고(문제 재현), "
            "잠금 번호는 늦은 취소가 먼저 쓴 쪽의 커밋을 기다린 뒤 0행이라 결제 확인이 남음",
            [f"{name}: 결제 확인 {a}행, 손님 취소 {b}행(기다림 {w:.1f}초) → {f}" for name, a, b, w, f in runs])


# ── ERD Editor 파일 비교 ─────────────────────────────────────────────────────

COL_PK, COL_UNIQUE, COL_NOT_NULL = 2, 4, 8  # ERD Editor 컬럼 options 비트


def erd_editor_model(doc: dict) -> dict:
    """ERD Editor 파일(3.x)을 견줄 형식으로: 테이블·컬럼·관계·인덱스·그룹·스크립트."""
    coll = doc["collections"]
    tables, columns = coll["tableEntities"], coll["tableColumnEntities"]
    groups = coll.get("tableGroupEntities", {})
    out = {"tables": {}, "rels": set(), "indexes": {}, "groups": {}, "scripts": doc["settings"].get("ddlScripts", {})}
    col_name = {cid: c["name"] for cid, c in columns.items()}
    tbl_name = {tid: t["name"] for tid, t in tables.items()}
    for tid in doc["doc"]["tableIds"]:
        t = tables[tid]
        cols = {}
        for cid in t["columnIds"]:
            c = columns[cid]
            opts = c.get("options", 0)
            cols[c["name"]] = {"type": c.get("dataType", ""), "pk": bool(opts & COL_PK), "unique": bool(opts & COL_UNIQUE),
                               "not_null": bool(opts & (COL_NOT_NULL | COL_PK)), "comment": c.get("comment", "")}
        out["tables"][t["name"]] = {"comment": t.get("comment", ""), "columns": cols}
        if t.get("groupId") in groups:
            out["groups"][t["name"]] = groups[t["groupId"]]["name"]
    for rid in doc["doc"]["relationshipIds"]:
        r = coll["relationshipEntities"][rid]
        out["rels"].add((tbl_name[r["end"]["tableId"]], tuple(col_name[c] for c in r["end"]["columnIds"]),
                         tbl_name[r["start"]["tableId"]], tuple(col_name[c] for c in r["start"]["columnIds"])))
    icols = coll.get("indexColumnEntities", {})
    for iid in doc["doc"]["indexIds"]:
        i = coll["indexEntities"][iid]
        out["indexes"][i["name"]] = (tbl_name[i["tableId"]], tuple(col_name[icols[x]["columnId"]] for x in i["indexColumnIds"]),
                                     bool(i.get("unique")))
    return out


INDEX_RE = re.compile(r"^CREATE (UNIQUE )?INDEX (\w+) ON (\w+) \((.*?)\)( WHERE .*?)?;", re.M)


def erd_check(root: Path, rep: Report, tables: list) -> None:
    path = root / ERD_FILE
    if not path.exists():
        rep.add("E1", None, f"{ERD_FILE}이 없어 ERD Editor와 비교하지 못함")
        return
    try:
        got = erd_editor_model(json.loads(path.read_text(encoding="utf-8")))
    except (KeyError, ValueError, TypeError) as e:
        rep.add("E1", None, f"{ERD_FILE}을 읽지 못함: {e!r}")
        return
    when = subprocess.run(["git", "-C", str(root), "log", "-1", "--format=%cI", "--", ERD_FILE],
                          capture_output=True, text=True).stdout.strip()
    if not when or subprocess.run(["git", "-C", str(root), "diff", "--quiet", "HEAD", "--", ERD_FILE]).returncode:
        when = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(timespec="seconds") + ", 커밋 전 파일 시각"
    schema_text = (root / build_erd.SCHEMA).read_text(encoding="utf-8")
    diffs = []
    for t in tables:
        g = got["tables"].get(t.name)
        if g is None:
            diffs.append(f"{t.tbl} {t.name}: 다이어그램에 테이블이 없음")
            continue
        want_comment = re.search(r"^COMMENT ON TABLE " + t.name + r" IS '(.*)';$", schema_text, re.M)
        if not want_comment or g["comment"] != want_comment.group(1).replace("''", "'"):
            diffs.append(f"{t.tbl} {t.name}: 테이블 설명이 다름")
        want_group = f"{t.ctx} {build_erd.CTX_NAMES[t.ctx]}" if t.ctx != "공통" else "공통"
        if got["groups"].get(t.name) != want_group:
            diffs.append(f"{t.tbl} {t.name}: 그룹 {got['groups'].get(t.name)} / 컨텍스트 {want_group}")
        for c in t.columns:
            e = g["columns"].get(c.name)
            if e is None:
                diffs.append(f"{t.name}.{c.name}: 다이어그램에 컬럼이 없음")
                continue
            for what, mine, theirs in (("타입", re.sub(r"\s+", "", c.type).lower(), re.sub(r"\s+", "", e["type"]).lower()),
                                       ("기본 키", c.pk, e["pk"]),
                                       ("NOT NULL", c.not_null, e["not_null"]), ("설명", c.comment, e["comment"])):
                if mine != theirs:
                    diffs.append(f"{t.name}.{c.name}: {what} {mine!r} / 다이어그램 {theirs!r}")
        diffs += [f"{t.name}.{n}: 스키마에 없는 컬럼" for n in sorted(set(g["columns"]) - {c.name for c in t.columns})]
    diffs += [f"{n}: 스키마에 없는 테이블" for n in sorted(set(got["tables"]) - {t.name for t in tables})]

    want_rels = {(fk.child, tuple(fk.cols), fk.parent, tuple(fk.parent_cols)) for t in tables for fk in t.fks}
    diffs += [f"관계 없음: {a}({', '.join(b)}) → {c}({', '.join(d)})" for a, b, c, d in sorted(want_rels - got["rels"])]
    diffs += [f"스키마에 없는 관계: {a}({', '.join(b)}) → {c}({', '.join(d)})" for a, b, c, d in sorted(got["rels"] - want_rels)]

    plain, special = {}, []
    for m in INDEX_RE.finditer(schema_text):
        unique, name, table, cols, where = m.groups()
        if where or "(" in cols:
            special.append(name)
        else:
            plain[name] = (table, tuple(build_erd.cols(cols)), bool(unique))
    for t in tables:
        for name, cols in re.findall(r"CONSTRAINT (\w+) UNIQUE \(([^)]+)\)", "\n".join(
                l for l in schema_text.split(f"CREATE TABLE {t.name} (")[1].split("\n);")[0].splitlines())):
            if "," in cols:
                plain[name] = (t.name, tuple(build_erd.cols(cols)), True)
    for name, want in sorted(plain.items()):
        if got["indexes"].get(name) != want:
            diffs.append(f"인덱스 {name}: {want} / 다이어그램 {got['indexes'].get(name)}")
    after = got["scripts"].get("after", "")
    for name in special:
        if name in got["indexes"]:
            diffs.append(f"인덱스 {name}: 부분·식 인덱스가 다이어그램에 조건 없이 들어 있음")
        if not re.search(r"INDEX " + name + r" ON ", after):
            diffs.append(f"인덱스 {name}: after 스크립트에 없음")
    diffs += [f"인덱스 {n}: 스키마에 없음" for n in sorted(set(got["indexes"]) - set(plain))]
    if "btree_gist" not in got["scripts"].get("before", ""):
        diffs.append("before 스크립트에 CREATE EXTENSION btree_gist가 없음")
    if "EXCLUDE" not in after:
        diffs.append("after 스크립트에 EXCLUDE가 없음")

    n_cols = sum(len(v["columns"]) for v in got["tables"].values())
    rep.add("E1", not diffs,
            f"ERD Editor 파일({when})의 테이블 {len(got['tables'])}개·컬럼 {n_cols}개·관계 {len(got['rels'])}개·인덱스 {len(got['indexes'])}개와 "
            f"컨텍스트 그룹이 스키마와 같음. 다이어그램이 담지 못하는 부분·식 인덱스 {len(special)}개와 EXCLUDE는 after 스크립트에, CHECK는 schema.sql에만",
            diffs)


def main(argv: list[str]) -> int:
    if not argv or argv[0].startswith("-"):
        print(__doc__)
        return 2
    root = Path(argv[0]).resolve()
    base = None
    if "--db" in argv:
        base = argv[argv.index("--db") + 1]
    rep = Report()
    tables = static_checks(root, rep)
    db_checks(root, rep, tables, base, "--keep" in argv)
    erd_check(root, rep, tables)
    return rep.summary()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
