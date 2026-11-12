#!/usr/bin/env python3
"""05단계 ERD: ERD Editor 다이어그램(db/schema.erd.json)을 db/schema.sql에서 만들고, 다이어그램의 DDL을 원본과 견준다.

사람이 보는 곳은 ERD Editor(VS Code 확장 4.0.0 이상 등)로 여는 db/schema.erd.json, 원본은 db/schema.sql(truth: source).
다이어그램은 ERD Editor MCP 서버(@dineug/erd-editor-mcp)의 도구로만 바꾸고 JSON을 손으로 쓰지 않는다.

만들기(--build): 스키마를 확정하기 전, 첫 다이어그램을 만들 때만. 들여오기는 다이어그램과 배치를 통째로 바꾼다.
  1. 문서를 만들고 PostgreSQL로 맞춤 → 2. erd_import_sql로 db/schema.sql을 들여옴
  3. 다이어그램이 담지 못하는 것을 스크립트로: before = CREATE EXTENSION, after = 부분·식 인덱스, EXCLUDE, 지연 외래 키
     (부분 인덱스는 들여오기에서 조건 없는 인덱스로 들어와 고유 규칙을 실제보다 세게 보이므로 다이어그램의 인덱스에서 뺌)
  4. 컨텍스트마다 테이블 그룹(색)과 자동 배치, 그룹을 CTX 차례로 위에서 아래로 쌓고 맨 위에 메모 한 장
  확정한 뒤에는 db/schema.sql과 마이그레이션을 먼저 고치고, 같은 변경을 erd_ 편집 도구로 다이어그램에 더한다.

견주기(--compare): 다이어그램을 테이블마다 erd_read(sql)로 읽어 빈 DB에 만들고, db/schema.sql로 만든 DB와 카탈로그를 견준다.
  이름이 아닌 뜻으로 견줌(외래 키·고유 규칙은 컬럼과 대상으로). CHECK는 다이어그램에 없으므로 개수만 보임.

쓰는 법(저장소 맨 위에서, Node.js 22.12 이상과 npx 필요)
  python3 -B research/cake-erd-2026-11/erd_editor_build.py . --build
  python3 -B research/cake-erd-2026-11/erd_editor_build.py . --compare --db "host=localhost port=5432 user=postgres"
"""
from __future__ import annotations

import importlib.util
import json
import queue
import re
import subprocess
import sys
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
ERD = "db/schema.erd.json"
SERVER = ["npx", "-y", "@dineug/erd-editor-mcp@1.2.0"]
DB_SCHEMA, DB_EDITOR = "erd_check_schema", "erd_check_editor"

GROUP_COLORS = {
    "CTX-001": "#2563eb", "CTX-002": "#16a34a", "CTX-003": "#dc2626", "CTX-004": "#d97706", "CTX-005": "#7c3aed",
    "CTX-006": "#db2777", "CTX-007": "#0891b2", "CTX-008": "#65a30d", "CTX-009": "#475569", "공통": "#78716c",
}

MEMO = """이 다이어그램은 db/schema.sql에서 만든 보기입니다(원본은 db/schema.sql, truth: source).
다이어그램에 없는 것: CHECK 제약 275개는 db/schema.sql에만 있습니다. 부분·식 인덱스, EXCLUDE, 지연 외래 키 설정은 다이어그램 대신 DDL의 after 스크립트에 그대로 있습니다.
설명: docs/05-erd/README.md. 바꾸는 법: db/schema.sql과 새 마이그레이션을 먼저 고치고, 같은 변경을 이 다이어그램에 더합니다."""


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


build_erd = load("build_erd", HERE / "build_erd.py")


class Mcp:
    """MCP stdio 서버에 줄마다 JSON-RPC 하나로 말을 건다."""

    def __init__(self, cwd: Path) -> None:
        self.p = subprocess.Popen(SERVER, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True, bufsize=1)
        self.q: queue.Queue = queue.Queue()
        self.n = 0
        threading.Thread(target=self._read, daemon=True).start()
        threading.Thread(target=lambda: [None for _ in self.p.stderr], daemon=True).start()
        r = self._send("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                       "clientInfo": {"name": "corthex-erd-build", "version": "1.0"}})
        self.server = r["result"]["serverInfo"]
        self._send("notifications/initialized", notify=True)

    def _read(self) -> None:
        for line in self.p.stdout:
            if line.strip():
                try:
                    self.q.put(json.loads(line))
                except ValueError:
                    pass

    def _send(self, method: str, params: dict | None = None, notify: bool = False):
        msg = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            msg["params"] = params
        if not notify:
            self.n += 1
            msg["id"] = self.n
        self.p.stdin.write(json.dumps(msg, ensure_ascii=False) + "\n")
        self.p.stdin.flush()
        if notify:
            return None
        while True:
            r = self.q.get(timeout=300)
            if r.get("id") == self.n:
                return r

    def call(self, tool: str, **args) -> str:
        r = self._send("tools/call", {"name": tool, "arguments": args})
        res = r.get("result") or {}
        text = "".join(c.get("text", "") for c in res.get("content", []))
        if "error" in r or res.get("isError") or text.startswith('{"error"'):
            raise RuntimeError(f"{tool}: {r.get('error') or text}")
        return text

    def close(self) -> None:
        self.p.stdin.close()
        try:
            self.p.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.p.kill()


# ── 원본에서 다이어그램이 담지 못하는 것 찾기 ─────────────────────────────────────────

INDEX_RE = re.compile(r"^CREATE (UNIQUE )?INDEX (\w+) ON (\w+) \((.*?)\)( WHERE .*?)?;", re.M)


def special_indexes(schema_text: str) -> list[tuple[str, str]]:
    """(이름, 문장): WHERE가 있는 부분 인덱스와 컬럼이 아닌 식을 쓰는 인덱스."""
    out = []
    for m in INDEX_RE.finditer(schema_text):
        unique, name, table, cols, where = m.groups()
        if where or "(" in cols:
            out.append((name, f"CREATE {unique or ''}INDEX {name} ON {table} ({cols}){where or ''};"))
    return out


def exclusions(schema_text: str) -> list[str]:
    out, table = [], None
    for line in schema_text.splitlines():
        m = build_erd.CREATE_RE.match(line)
        if m:
            table = m.group(1)
        code, _ = build_erd.split_comment(line)
        m = re.match(r"^\s*CONSTRAINT (\w+) (EXCLUDE .*?),?$", code)
        if m and table:
            out.append(f"ALTER TABLE {table} ADD CONSTRAINT {m.group(1)} {m.group(2)};")
    return out


def deferred_fks(schema_text: str) -> list[tuple[str, list[str]]]:
    return [(m.group(1), build_erd.cols(m.group(3)))
            for m in build_erd.ALTER_FK_RE.finditer(schema_text)
            if "DEFERRABLE" in schema_text[m.end():m.end() + 120].split(";")[0]]


def ids(root: Path) -> tuple[dict[str, str], dict[str, str]]:
    """다이어그램 파일에서 테이블 이름 → ID, 인덱스 이름 → ID(읽기만 함)."""
    d = json.loads((root / ERD).read_text(encoding="utf-8"))
    c = d["collections"]
    return ({t["name"]: t["id"] for t in c["tableEntities"].values()},
            {i["name"]: i["id"] for i in c["indexEntities"].values()})


# ── 만들기 ─────────────────────────────────────────────────────────────────

def build(root: Path) -> None:
    schema_text = (root / build_erd.SCHEMA).read_text(encoding="utf-8")
    tables = build_erd.parse(schema_text)
    mcp = Mcp(root)
    try:
        print(f"ERD Editor MCP {mcp.server.get('version')}")
        print(mcp.call("erd_open_document", path=ERD, create=True))
        mcp.call("erd_set_database", path=ERD, value="PostgreSQL")
        mcp.call("erd_set_database_name", path=ERD, value="siljang")
        mcp.call("erd_import_sql", path=ERD, value=schema_text)

        table_ids, index_ids = ids(root)
        specials = special_indexes(schema_text)
        drop = [index_ids[n] for n, _ in specials if n in index_ids]
        if drop:
            mcp.call("erd_batch", path=ERD, operations=[{"tool": "erd_remove_index", "args": {"indexId": i}} for i in drop])

        alters = []
        for table, cols in deferred_fks(schema_text):
            ddl = mcp.call("erd_read", path=ERD, format="sql", tableNames=[table])
            want = ", ".join(cols)
            m = re.search(r"ALTER TABLE " + table + r"\s+ADD CONSTRAINT (\w+)\s+FOREIGN KEY \(" + re.escape(want) + r"\)", ddl)
            if not m:
                raise SystemExit(f"다이어그램에서 {table} ({want}) 외래 키를 찾지 못함")
            alters.append(f"ALTER TABLE {table} ALTER CONSTRAINT {m.group(1)} DEFERRABLE INITIALLY DEFERRED;")
        after = "\n".join([
            "-- 다이어그램이 담지 못해 db/schema.sql에서 그대로 옮긴 것(erd_editor_build.py가 씀). CHECK 제약은 db/schema.sql에만 있음.",
            "-- 부분·식 인덱스",
            *[sql for _, sql in specials],
            "-- 중복됨 막기(EXCLUDE)",
            *exclusions(schema_text),
            "-- 주문 행이 현재 버전의 주문 내용을 참조하는 외래 키는 트랜잭션 끝에 확인",
            *alters,
        ])
        if len(after) > 10000:
            raise SystemExit(f"after 스크립트가 {len(after)}자로 10,000자를 넘음")
        mcp.call("erd_set_ddl_script", path=ERD, position="before",
                 sql="CREATE EXTENSION IF NOT EXISTS btree_gist; -- refund_tiers의 EXCLUDE에 씀")
        mcp.call("erd_set_ddl_script", path=ERD, position="after", sql=after)

        ops = []
        for ctx, name in build_erd.CTX_NAMES.items():
            mine = [table_ids[t.name] for t in tables if t.ctx == ctx]
            if mine:
                label = f"{ctx} {name}" if ctx != "공통" else "공통"
                ops.append({"tool": "erd_add_table_group",
                            "args": {"name": label, "color": GROUP_COLORS[ctx], "tableIds": mine}})
        mcp.call("erd_batch", path=ERD, operations=ops)
        mcp.call("erd_sort_tables", path=ERD)
        # 자동 배치 뒤 그룹을 CTX-001부터 위에서 아래로 쌓고, 맨 위에 메모를 둠
        d = json.loads((root / ERD).read_text(encoding="utf-8"))
        rects = {g["name"]: (gid, g["ui"]) for gid, g in d["collections"]["tableGroupEntities"].items()}
        moves, y = [], 300
        for ctx, name in build_erd.CTX_NAMES.items():
            label = f"{ctx} {name}" if ctx != "공통" else "공통"
            if label in rects:
                gid, ui = rects[label]
                moves.append({"tool": "erd_move_table_group", "args": {"groupId": gid, "x": 50, "y": y}})
                y += ui["height"] + 80
        mcp.call("erd_batch", path=ERD, operations=moves)
        memo = json.loads(mcp.call("erd_add_memo", path=ERD))["createdIds"][0]
        mcp.call("erd_change_memo_value", path=ERD, memoId=memo, value=MEMO)
        mcp.call("erd_change_memo_color", path=ERD, memoId=memo, color="#fde68a")
        mcp.call("erd_resize_memo", path=ERD, memoId=memo, width=720, height=170)
        mcp.call("erd_move_memo", path=ERD, memoId=memo, x=50, y=50)
        mcp.call("erd_save", path=ERD)
        summary = json.loads(mcp.call("erd_list", path=ERD, namesOnly=True))
        print(f"만듦: 테이블 {summary['tableCount']}개, 그룹 {len(ops)}개, 다이어그램에서 뺀 부분·식 인덱스 {len(drop)}개, "
              f"after 스크립트 {len(after)}자")
    finally:
        mcp.close()


# ── 견주기 ─────────────────────────────────────────────────────────────────

def editor_ddl(root: Path) -> tuple[str, str]:
    """다이어그램의 DDL을 테이블마다 읽어 모음: before → 테이블·설명 → 인덱스 → 외래 키 → after."""
    mcp = Mcp(root)
    try:
        names = json.loads(mcp.call("erd_list", path=ERD, namesOnly=True))["tableNames"]
        scripts = json.loads(mcp.call("erd_read", path=ERD, format="scripts"))
        phases: dict[str, list[str]] = {"table": [], "fk": [], "index": []}
        seen: set[str] = set()
        for name in names:
            for stmt in re.split(r";\s*\n", mcp.call("erd_read", path=ERD, format="sql", tableNames=[name])):
                stmt = stmt.strip()
                if not stmt or stmt in seen:
                    continue
                seen.add(stmt)
                kind = "fk" if stmt.startswith("ALTER TABLE") else "index" if stmt.startswith("CREATE") and "INDEX" in stmt.split("\n")[0] else "table"
                phases[kind].append(stmt + ";")
        version = mcp.server.get("version", "")
    finally:
        mcp.close()
    # ERD Editor는 외래 키 다음에 인덱스를 쓰는데, 복합 UNIQUE가 인덱스로 바뀌어 그 순서로는 PostgreSQL에 적용되지 않음.
    # 견주려고 인덱스를 외래 키 앞에 둠(README 9절).
    ddl = "\n\n".join([scripts.get("before", ""), *phases["table"], *phases["index"], *phases["fk"], scripts.get("after", "")])
    return ddl, version


SEM_SQL = r"""
SELECT 'table ' || c.relname || ' | ' || coalesce(obj_description(c.oid, 'pg_class'), '')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'
UNION ALL
SELECT 'column ' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
       || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
       || ' | ' || coalesce(col_description(c.oid, a.attnum), '')
FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
UNION ALL
SELECT 'foreign key ' || c.relname || ' ' || regexp_replace(pg_get_constraintdef(con.oid), '\s+', ' ', 'g')
FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND con.contype = 'f'
UNION ALL
SELECT 'exclude ' || c.relname || ' ' || pg_get_constraintdef(con.oid)
FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND con.contype = 'x'
UNION ALL
SELECT CASE WHEN i.indisprimary THEN 'primary key ' WHEN i.indisunique THEN 'unique ' ELSE 'index ' END
       || t.relname || ' ' || regexp_replace(pg_get_indexdef(i.indexrelid), '^CREATE (UNIQUE )?INDEX \S+ ON \S+ ', '')
FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND NOT EXISTS (SELECT 1 FROM pg_constraint x WHERE x.conindid = i.indexrelid AND x.contype = 'x')
UNION ALL
SELECT 'extension ' || extname FROM pg_extension WHERE extname <> 'plpgsql'
ORDER BY 1
"""


def compare(root: Path, base: str) -> int:
    check_erd = load("check_erd", HERE / "check_erd.py")
    pg = check_erd.Pg(base)
    ddl, version = editor_ddl(root)
    try:
        pg.recreate(DB_SCHEMA)
        pg.recreate(DB_EDITOR)
        err = pg.apply(DB_SCHEMA, root / build_erd.SCHEMA)
        if not err:
            r = subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-1", "-f", "-", pg.conn(DB_EDITOR)],
                               input=ddl, capture_output=True, text=True)
            err = r.stderr.strip() if r.returncode else ""
        if err:
            print("적용 실패:", err)
            return 1
        a = [r[0] for r in pg.query(DB_SCHEMA, SEM_SQL)]
        b = [r[0] for r in pg.query(DB_EDITOR, SEM_SQL)]
        checks = pg.query(DB_SCHEMA, "SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace "
                                     "WHERE n.nspname = 'public' AND c.contype = 'c'")[0][0]
        editor_checks = pg.query(DB_EDITOR, "SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace "
                                            "WHERE n.nspname = 'public' AND c.contype = 'c'")[0][0]
    finally:
        pg.drop(DB_SCHEMA)
        pg.drop(DB_EDITOR)
    only_schema = sorted(set(a) - set(b))
    only_editor = sorted(set(b) - set(a))
    kinds = {}
    for line in a:
        k = line.split(" ")[0] if not line.startswith(("foreign key", "primary key")) else " ".join(line.split(" ")[:2])
        kinds[k] = kinds.get(k, 0) + 1
    print(f"ERD Editor MCP {version}: 다이어그램의 DDL {len(ddl):,}자를 빈 DB에 만들어 db/schema.sql과 뜻으로 견줌")
    print("견준 것: " + ", ".join(f"{k} {v}" for k, v in sorted(kinds.items())))
    print(f"CHECK: db/schema.sql {checks}개, 다이어그램 {editor_checks}개(다이어그램은 CHECK를 담지 못함)")
    print(f"db/schema.sql에만 {len(only_schema)}줄, 다이어그램에만 {len(only_editor)}줄")
    for line in only_schema:
        print("  - " + line)
    for line in only_editor:
        print("  + " + line)
    return 0 if not only_schema and not only_editor else 1


def main(argv: list[str]) -> int:
    if not argv or argv[0].startswith("-"):
        print(__doc__)
        return 2
    root = Path(argv[0]).resolve()
    status = 0
    if "--build" in argv:
        build(root)
    if "--compare" in argv:
        status = compare(root, argv[argv.index("--db") + 1] if "--db" in argv else "")
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
