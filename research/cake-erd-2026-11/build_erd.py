#!/usr/bin/env python3
"""05단계 ERD 도구: db/schema.sql 하나에서 나머지를 만든다.

만드는 것
- db/schema.sql 각 테이블 헤더 주석의 SPEC 목록. 원본은 같은 폴더의 erd_map.py(SPEC → 테이블.컬럼 대응).
- db/schema.sql 끝의 컬럼 설명(COMMENT ON COLUMN). 각 컬럼 줄 끝의 '-- 설명'이 원본.
- docs/05-erd/README.md의 테이블 목록과 컨텍스트별 다이어그램(표시 사이만 바꿈).
- --migration을 주면 db/migrations/0001_init.sql(스키마를 확정하기 전까지만 씀).

쓰는 법(저장소 맨 위에서, __pycache__를 만들지 않게 -B)
  python3 -B research/cake-erd-2026-11/build_erd.py .               # 바뀔 파일만 보임
  python3 -B research/cake-erd-2026-11/build_erd.py . --write       # 고쳐 씀
  python3 -B research/cake-erd-2026-11/build_erd.py . --write --migration
"""
from __future__ import annotations

import importlib.util
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

SCHEMA = "db/schema.sql"
MIGRATION = "db/migrations/0001_init.sql"
README = "docs/05-erd/README.md"

COMMENT_BEGIN = "-- ▼ 컬럼 설명: build_erd.py가 각 컬럼 줄 끝의 설명에서 만듦. 이 아래는 손으로 고치지 않음."
COMMENT_END = "-- ▲ 컬럼 설명 끝"

CTX_NAMES = {
    "CTX-001": "상담",
    "CTX-002": "가게 규칙",
    "CTX-003": "주문",
    "CTX-004": "결제·환불",
    "CTX-005": "제작·전달",
    "CTX-006": "후기·포트폴리오",
    "CTX-007": "가게 등록·연결",
    "CTX-008": "알림",
    "CTX-009": "장부 연결",
    "공통": "공통",
}

TYPE_WORDS = ("uuid", "text", "integer", "bigint", "smallint", "boolean", "timestamptz", "date", "time", "jsonb", "numeric")
HEADER_RE = re.compile(r"^-- (TBL-\d{3}) (\w+) \(([^)]+)\) ← (.*?) \| terms: (.*)$")
CREATE_RE = re.compile(r"^CREATE TABLE (\w+) \($")
COL_RE = re.compile(r"^  ([a-z_][a-z0-9_]*)\s+(" + "|".join(TYPE_WORDS) + r")\b(.*)$")
FK_RE = re.compile(r"CONSTRAINT (\w+) FOREIGN KEY \(([^)]+)\) REFERENCES (\w+) \(([^)]+)\)")
ALTER_FK_RE = re.compile(
    r"ALTER TABLE (\w+) ADD CONSTRAINT (\w+) FOREIGN KEY \(([^)]+)\)\s*REFERENCES (\w+) \(([^)]+)\)", re.S)
UNIQUE_RE = re.compile(r"CONSTRAINT \w+ UNIQUE \(([^)]+)\)")
PK_RE = re.compile(r"PRIMARY KEY \(([^)]+)\)")
INLINE_REF_RE = re.compile(r"REFERENCES (\w+) \((\w+)\)")


@dataclass
class Column:
    name: str
    type: str
    not_null: bool
    pk: bool
    comment: str


@dataclass
class ForeignKey:
    name: str
    child: str
    cols: list[str]
    parent: str
    parent_cols: list[str]


@dataclass
class Table:
    tbl: str
    name: str
    ctx: str
    specs: list[str]
    terms: list[str]
    korean: str = ""
    columns: list[Column] = field(default_factory=list)
    uniques: list[list[str]] = field(default_factory=list)
    fks: list[ForeignKey] = field(default_factory=list)


def split_comment(line: str) -> tuple[str, str]:
    """작은따옴표 밖의 첫 '--'에서 나눈다."""
    quoted = False
    i = 0
    while i < len(line):
        ch = line[i]
        if ch == "'":
            quoted = not quoted
        elif not quoted and line.startswith("--", i):
            return line[:i].rstrip(), line[i + 2:].strip()
        i += 1
    return line.rstrip(), ""


def column_type(rest: str, first: str) -> str:
    m = re.match(r"(\(\d+,\s*\d+\)|\[\])?", rest)
    return first + (m.group(1) or "" if m else "")


def parse(schema_text: str) -> list[Table]:
    body = schema_text.split(COMMENT_BEGIN)[0]
    lines = body.splitlines()
    tables: list[Table] = []
    pending: Table | None = None
    current: Table | None = None
    for line in lines:
        m = HEADER_RE.match(line)
        if m:
            tbl, name, ctx, specs, terms = m.groups()
            pending = Table(
                tbl=tbl, name=name, ctx=ctx,
                specs=[s.strip() for s in specs.split(",") if s.strip()],
                terms=[] if terms.strip() == "none" else [t.strip() for t in terms.split(",")],
            )
            continue
        m = CREATE_RE.match(line)
        if m:
            if pending is None or pending.name != m.group(1):
                raise SystemExit(f"TBL 헤더 주석이 없는 테이블: {m.group(1)}")
            current, pending = pending, None
            tables.append(current)
            continue
        if current is not None:
            if line.startswith(");"):
                current = None
                continue
            code, comment = split_comment(line)
            m = COL_RE.match(code)
            if m:
                name, first, rest = m.groups()
                current.columns.append(Column(
                    name=name, type=column_type(rest, first),
                    not_null=("NOT NULL" in rest or "PRIMARY KEY" in rest),
                    pk=("PRIMARY KEY" in rest), comment=comment))
                if "PRIMARY KEY" in rest:
                    current.uniques.append([name])
                r = INLINE_REF_RE.search(rest)
                if r:
                    current.fks.append(ForeignKey(f"{current.name}_{name}_fkey", current.name, [name], r.group(1), [r.group(2)]))
                continue
            for fk in FK_RE.finditer(code):
                current.fks.append(ForeignKey(fk.group(1), current.name, cols(fk.group(2)), fk.group(3), cols(fk.group(4))))
            for u in UNIQUE_RE.finditer(code):
                current.uniques.append(cols(u.group(1)))
            pk = PK_RE.search(code)
            if pk and "FOREIGN KEY" not in code:
                current.uniques.append(cols(pk.group(1)))
                for c in current.columns:
                    if c.name in cols(pk.group(1)):
                        c.pk = True
                        c.not_null = True
        m = re.match(r"^COMMENT ON TABLE (\w+) IS '(TBL-\d{3}) ([^:']+)", line)
        if m:
            for t in tables:
                if t.name == m.group(1):
                    t.korean = re.sub(r"\(TERM-\d{3}\)", "", m.group(3)).strip()
    by_name = {t.name: t for t in tables}
    for m in ALTER_FK_RE.finditer(body):
        child, name, c, parent, pc = m.groups()
        by_name[child].fks.append(ForeignKey(name, child, cols(c), parent, cols(pc)))
    return tables


def cols(text: str) -> list[str]:
    return [c.strip() for c in text.split(",") if c.strip()]


def sql_quote(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"


def column_comments(tables: list[Table]) -> str:
    out = [COMMENT_BEGIN]
    for t in tables:
        for c in t.columns:
            if c.comment:
                out.append(f"COMMENT ON COLUMN {t.name}.{c.name} IS {sql_quote(c.comment)};")
    out.append(COMMENT_END)
    return "\n".join(out) + "\n"


def with_comments(schema_text: str, tables: list[Table]) -> str:
    head = schema_text.split(COMMENT_BEGIN)[0].rstrip("\n") + "\n\n"
    return head + column_comments(tables)


def migration_text(schema_text: str) -> str:
    header = (
        "-- 0001_init: 첫 스키마(CORTHEX 05단계 ERD, 스키마를 확정할 때의 db/schema.sql 사본)\n"
        "-- 한 번 어디에든 적용한 뒤에는 이 파일을 고치지 않고 0002부터 새 파일을 더함.\n"
        "-- 빈 데이터베이스에 한 트랜잭션으로 적용: psql -1 -v ON_ERROR_STOP=1 -f db/migrations/0001_init.sql\n\n"
    )
    return header + schema_text


def load_map() -> dict[str, list[tuple[str, str]]]:
    path = Path(__file__).resolve().with_name("erd_map.py")
    spec = importlib.util.spec_from_file_location("erd_map", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["erd_map"] = mod
    spec.loader.exec_module(mod)
    return mod.MAP


def specs_by_table(spec_map: dict[str, list[tuple[str, str]]]) -> dict[str, list[str]]:
    out: dict[str, set[str]] = {}
    for spec_id, pairs in spec_map.items():
        for _, target in pairs:
            out.setdefault(target.split(".")[0], set()).add(spec_id)
    return {t: sorted(ids) for t, ids in out.items()}


def with_headers(schema_text: str, by_table: dict[str, list[str]]) -> str:
    """테이블 헤더 주석의 SPEC 목록을 erd_map.py의 대응으로 다시 쓴다. 대응이 없는 테이블은 'none'."""
    out = []
    for line in schema_text.split("\n"):
        m = HEADER_RE.match(line)
        if m:
            tbl, name, ctx, _, terms = m.groups()
            line = f"-- {tbl} {name} ({ctx}) ← {', '.join(by_table.get(name, [])) or 'none'} | terms: {terms}"
        out.append(line)
    return "\n".join(out)


# ── README 생성 ────────────────────────────────────────────────────────────

def main_col(fk: ForeignKey) -> list[str]:
    rest = [c for c in fk.cols if c != "shop_id"]
    return rest or fk.cols


def table_list(tables: list[Table]) -> str:
    out = ["| TBL | 테이블 | 이름 | 컨텍스트 | 읽고 쓰는 SPEC | 용어 |", "| --- | --- | --- | --- | --- | --- |"]
    for t in tables:
        specs = ", ".join(s.replace("SPEC-", "") for s in t.specs)
        out.append(f"| {t.tbl} | `{t.name}` | {t.korean} | {t.ctx} | {specs} | {', '.join(t.terms) or '없음'} |")
    return "\n".join(out)


SHOW_ALWAYS = {"status", "kind", "version", "order_no", "amount"}


def short(text: str, n: int = 16) -> str:
    """다이어그램 컬럼 설명: 첫 구절을 n글자까지. 넘치면 단어 중간에서 자르지 않고 마지막 띄어쓰기나 가운뎃점에서 끊고 …를 붙임."""
    text = re.split(r"[.(:,]", text)[0].strip().replace('"', "")
    if len(text) <= n:
        return text
    cut = text[:n]
    if text[n] in " ·":
        return cut.rstrip() + "…"
    k = max(cut.rfind(" "), cut.rfind("·"))
    return (cut[:k] if k > 0 else cut).rstrip() + "…"


def mermaid_type(t: str) -> str:
    return {"integer": "int", "smallint": "int", "bigint": "bigint", "boolean": "bool"}.get(t, t.split("(")[0].replace("[]", "_list"))


def er_diagram(ctx: str, tables: list[Table], by_name: dict[str, Table]) -> str:
    mine = [t for t in tables if t.ctx == ctx]
    names = {t.name for t in mine}
    lines = ["erDiagram"]
    seen: set[tuple[str, str, str]] = set()
    rels = []
    outside: set[str] = set()
    for t in mine:
        for fk in t.fks:
            key = (t.name, fk.parent, main_col(fk)[0])
            if key in seen:
                continue
            seen.add(key)
            mc = main_col(fk)
            nullable = any(not c.not_null for c in t.columns if c.name in mc)
            unique = any(set(u) <= set(fk.cols) for u in t.uniques)
            left = "|o" if nullable else "||"
            right = "o|" if unique else "o{"
            label = "_".join(mc) if len(mc) <= 2 else mc[0]
            if fk.name == "orders_current_details_fk":
                label = "current_version"
            rels.append(f'  {fk.parent} {left}--{right} {t.name} : "{label}"')
            if fk.parent not in names:
                outside.add(fk.parent)
    for t in mine:
        fk_cols = {c for fk in t.fks for c in main_col(fk)}
        lines.append(f"  {t.name} {{")
        for c in t.columns:
            keys = []
            if c.pk:
                keys.append("PK")
            if c.name in fk_cols:
                keys.append("FK")
            if not keys and c.name not in SHOW_ALWAYS:
                continue
            k = (" " + ", ".join(keys)) if keys else ""
            lines.append(f'    {mermaid_type(c.type)} {c.name}{k} "{short(c.comment)}"')
        lines.append("  }")
    lines.extend(rels)
    return "\n".join(lines)


def context_overview(tables: list[Table], by_name: dict[str, Table]) -> str:
    edges: dict[tuple[str, str], int] = {}
    for t in tables:
        for fk in t.fks:
            a, b = t.ctx, by_name[fk.parent].ctx
            if a != b:
                edges[(a, b)] = edges.get((a, b), 0) + 1
    ids = {c: f"C{i}" for i, c in enumerate(CTX_NAMES)}
    lines = ["flowchart LR"]
    for c, name in CTX_NAMES.items():
        n = sum(1 for t in tables if t.ctx == c)
        label = name if c == "공통" else f"{c} {name}"
        lines.append(f'  {ids[c]}["{label}<br/>테이블 {n}개"]')
    for (a, b), n in sorted(edges.items()):
        lines.append(f"  {ids[a]} -->|{n}| {ids[b]}")
    return "\n".join(lines)


def diagrams(tables: list[Table]) -> str:
    by_name = {t.name: t for t in tables}
    out = [
        "### 컨텍스트 사이 (화살표: 참조하는 쪽 → 참조되는 쪽, 숫자는 외래 키 수)",
        "",
        "```mermaid",
        context_overview(tables, by_name),
        "```",
    ]
    for ctx, name in CTX_NAMES.items():
        mine = [t for t in tables if t.ctx == ctx]
        if not mine:
            continue
        tbls = ", ".join(f"{t.tbl} `{t.name}`" for t in mine)
        out += [
            "",
            f"### {ctx} {name}" if ctx != "공통" else "### 공통",
            "",
            f"테이블: {tbls}. 컬럼은 기본 키(PK)·외래 키(FK)와 상태·종류·버전·금액만 보입니다. 다른 컨텍스트의 테이블은 이름만 나옵니다.",
            "",
            "```mermaid",
            er_diagram(ctx, tables, by_name),
            "```",
        ]
    return "\n".join(out)


def replace_block(text: str, name: str, content: str) -> str:
    begin, end = f"<!-- build_erd:{name}:begin -->", f"<!-- build_erd:{name}:end -->"
    if begin not in text or end not in text:
        raise SystemExit(f"{README}에 {begin} … {end} 표시가 없습니다")
    a = text.index(begin) + len(begin)
    b = text.index(end)
    return text[:a] + "\n" + content.rstrip("\n") + "\n" + text[b:]


def build(root: Path, migration: bool = False) -> tuple[list[Table], dict[Path, str]]:
    """만들 파일과 그 내용을 반환한다. 파일은 쓰지 않는다(check_erd.py도 씀)."""
    schema_path = root / SCHEMA
    schema_text = with_headers(schema_path.read_text(encoding="utf-8"), specs_by_table(load_map()))
    tables = parse(schema_text)
    targets: dict[Path, str] = {schema_path: with_comments(schema_text, tables)}
    readme = root / README
    if readme.exists():
        text = readme.read_text(encoding="utf-8")
        text = replace_block(text, "tables", table_list(tables))
        text = replace_block(text, "diagrams", diagrams(tables))
        targets[readme] = text
    if migration:
        targets[root / MIGRATION] = migration_text(targets[schema_path])
    return tables, targets


def main(argv: list[str]) -> int:
    if not argv or argv[0].startswith("-"):
        print(__doc__)
        return 2
    root = Path(argv[0])
    write = "--write" in argv
    tables, targets = build(root, "--migration" in argv)
    changed = 0
    for path, new in targets.items():
        old = path.read_text(encoding="utf-8") if path.exists() else None
        if old != new:
            changed += 1
            print(("고침: " if write else "바뀜: ") + str(path.relative_to(root)))
            if write:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(new, encoding="utf-8")
    print(f"테이블 {len(tables)}개, 컬럼 {sum(len(t.columns) for t in tables)}개, 외래 키 {sum(len(t.fks) for t in tables)}개. "
          f"바뀐 파일 {changed}개{'' if write else ' (--write 없이 보기만)'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
