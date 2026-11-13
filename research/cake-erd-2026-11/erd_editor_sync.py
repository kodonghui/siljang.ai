#!/usr/bin/env python3
"""05단계 ERD: db/schema.sql과 ERD Editor 다이어그램(db/schema.erd.json)의 차이를 MCP 편집 도구로 다이어그램에 옮긴다.

스키마를 확정한 뒤의 바꿈(db/schema.sql과 새 마이그레이션 0002, 0003 …)을 다이어그램에 더할 때 쓴다.
다이어그램을 통째로 다시 들여오는 erd_editor_build.py --build와 erd_import_* 도구는 쓰지 않고, JSON도 손으로 쓰지 않는다.
다이어그램 파일은 ID를 찾으려고 읽기만 하고, 바꾸는 것은 모두 erd_ 편집 도구(erd_batch 등)로 한다.

옮기는 것(check_erd.py E1이 견주는 것과 같음)
- 테이블: 없는 테이블 더하기·남는 테이블 빼기, 테이블 설명, 컨텍스트 그룹
- 새 테이블의 자리: erd_add_table은 그룹 밖 빈 곳에 두므로 그 컨텍스트 그룹 상자 안의 빈 곳으로 옮김(erd_move_table)
- 컬럼: 없는 컬럼 더하기(스키마의 차례 자리로 옮김)·남는 컬럼 빼기, 타입·기본 키·NOT NULL·설명, 한 컬럼 UNIQUE 표시
- 관계(외래 키): 없는 관계 잇기·남는 관계 빼기
- 다이어그램에 두는 인덱스(조건 없는 인덱스와 여러 컬럼 UNIQUE): 더하기·빼기·다시 만들기
- after 스크립트: 부분·식 인덱스, EXCLUDE, 지연 외래 키(erd_editor_build.py --build와 같은 꼴로 다시 씀)
- 맨 위 메모의 CHECK 개수

쓰는 법(저장소 맨 위에서, Node.js 22.12 이상과 npx 필요)
  python3 -B research/cake-erd-2026-11/erd_editor_sync.py .           # 바꿀 것만 보임(다이어그램은 그대로)
  python3 -B research/cake-erd-2026-11/erd_editor_sync.py . --write   # MCP 편집 도구로 고치고 저장
그다음 check_erd.py로 E1을 본다.
"""
from __future__ import annotations

import importlib.util
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load(name: str, path: Path):
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


eb = load("erd_editor_build", HERE / "erd_editor_build.py")
build_erd = sys.modules["build_erd"]
check_erd = load("check_erd", HERE / "check_erd.py")
ERD = eb.ERD

ON_DELETE = {"RESTRICT": "restrict", "CASCADE": "cascade", "SET NULL": "setNull", "SET DEFAULT": "setDefault",
             "NO ACTION": "noAction"}
AFTER_HEAD = "-- 다이어그램이 담지 못해 db/schema.sql에서 그대로 옮긴 것(erd_editor_build.py·erd_editor_sync.py가 씀). CHECK 제약은 db/schema.sql에만 있음."


# ── 원본(db/schema.sql)에서 읽기 ─────────────────────────────────────────────

def code_only(schema_text: str) -> str:
    body = schema_text.split(build_erd.COMMENT_BEGIN)[0]
    return "\n".join(build_erd.split_comment(l)[0] for l in body.splitlines())


def check_count(schema_text: str) -> int:
    return code_only(schema_text).count("CHECK (")


ACTION_RE = re.compile(r"ON DELETE (SET NULL|SET DEFAULT|NO ACTION|RESTRICT|CASCADE)")
# 다이어그램 파일의 관계 onDelete 값(비트): 편집 도구의 이름 차례와 같음(none 1, … restrict 32, erd_get으로 확인)
ACTION_BITS = {1: "none", 2: "noAction", 4: "cascade", 8: "setNull", 16: "setDefault", 32: "restrict"}


def on_delete(schema_text: str, fk) -> str:
    """외래 키의 ON DELETE: 제약 문장(ALTER TABLE이면 ;까지)이나 컬럼 줄의 REFERENCES에서."""
    code = code_only(schema_text)
    i = code.find(f"CONSTRAINT {fk.name} FOREIGN KEY")
    text = ""
    if i >= 0:  # 그 제약 문장만: 다음 제약 줄, 테이블 끝, ; 가운데 먼저 오는 곳까지
        rest = code[i:]
        text = rest[:min([j for j in (rest.find(";"), rest.find("\n  CONSTRAINT"), rest.find("\n);")) if j >= 0] or [len(rest)])]
    else:  # 컬럼 줄의 REFERENCES
        body = code.split(f"CREATE TABLE {fk.child} (")[1].split("\n);")[0]
        m = re.search(r"^  " + fk.cols[0] + r"\s[^\n]*REFERENCES " + fk.parent + r" \(" + fk.parent_cols[0] + r"\)[^\n]*", body, re.M)
        text = m.group(0) if m else ""
    a = ACTION_RE.search(text)
    return ON_DELETE[a.group(1)] if a else "none"


def plain_indexes(schema_text: str, tables: list) -> dict[str, tuple[str, tuple[str, ...], bool]]:
    """다이어그램에 두는 인덱스: 조건·식 없는 CREATE INDEX와 여러 컬럼 UNIQUE 제약(check_erd.py E1과 같은 규칙)."""
    plain = {}
    for m in check_erd.INDEX_RE.finditer(schema_text):
        unique, name, table, cols, where = m.groups()
        if not (where or "(" in cols):
            plain[name] = (table, tuple(build_erd.cols(cols)), bool(unique))
    for t in tables:
        body = schema_text.split(f"CREATE TABLE {t.name} (")[1].split("\n);")[0]
        for name, cols in re.findall(r"CONSTRAINT (\w+) UNIQUE \(([^)]+)\)", body):
            if "," in cols:
                plain[name] = (t.name, tuple(build_erd.cols(cols)), True)
    return plain


def single_uniques(t) -> set[str]:
    """한 컬럼 UNIQUE(기본 키 빼고): 다이어그램에서는 컬럼의 UNIQUE 표시."""
    pk = {c.name for c in t.columns if c.pk}
    return {u[0] for u in t.uniques if len(u) == 1 and u[0] not in pk}


# ── 다이어그램(db/schema.erd.json)에서 ID 읽기 ─────────────────────────────────

class Diagram:
    """다이어그램 파일을 읽기만 해서 이름 → ID와 지금 값을 찾는다."""

    def __init__(self, root: Path) -> None:
        self.doc = json.loads((root / ERD).read_text(encoding="utf-8"))
        c = self.doc["collections"]
        self.model = check_erd.erd_editor_model(self.doc)
        self.tables = {t["name"]: t for t in c["tableEntities"].values() if t["id"] in self.doc["doc"]["tableIds"]}
        self.cols = c["tableColumnEntities"]
        self.rels = c["relationshipEntities"]
        self.indexes = {i["name"]: i for i in c["indexEntities"].values() if i["id"] in self.doc["doc"]["indexIds"]}
        self.groups = {g["name"]: g["id"] for g in c.get("tableGroupEntities", {}).values()}
        self.memos = c.get("memoEntities", {})

    def table_id(self, name: str) -> str:
        return self.tables[name]["id"]

    def col_ids(self, table: str) -> dict[str, str]:
        return {self.cols[x]["name"]: x for x in self.tables[table]["columnIds"]}

    def col_order(self, table: str) -> list[str]:
        return [self.cols[x]["name"] for x in self.tables[table]["columnIds"]]

    def rel_ids(self) -> dict[tuple, str]:
        name = {tid: t["name"] for tid, t in self.doc["collections"]["tableEntities"].items()}
        out = {}
        for rid in self.doc["doc"]["relationshipIds"]:
            r = self.rels[rid]
            out[(name[r["end"]["tableId"]], tuple(self.cols[x]["name"] for x in r["end"]["columnIds"]),
                 name[r["start"]["tableId"]], tuple(self.cols[x]["name"] for x in r["start"]["columnIds"]))] = rid
        return out


# ── 차이를 편집 도구 호출로 ───────────────────────────────────────────────────

def group_name(ctx: str) -> str:
    return f"{ctx} {build_erd.CTX_NAMES[ctx]}" if ctx != "공통" else "공통"


DEFAULT_RE = re.compile(r"\bDEFAULT\s+(.+?)(?=\s+(?:CHECK|NOT\s+NULL|NULL|PRIMARY\s+KEY|UNIQUE|REFERENCES)\b|,?\s*$)")


def column_defaults(schema_text: str, tables: list) -> dict[tuple[str, str], str]:
    """컬럼 줄의 DEFAULT 식(설명을 뺀 코드에서). 0003부터: 더한 컬럼의 기본값도 다이어그램에 옮김."""
    names = {t.name: {c.name for c in t.columns} for t in tables}
    out: dict[tuple[str, str], str] = {}
    table = None
    for line in code_only(schema_text).splitlines():
        m = re.match(r"CREATE TABLE (\w+)", line)
        if m:
            table = m.group(1)
            continue
        m = re.match(r"\s+(\w+)\s", line)
        if table and m and m.group(1) in names.get(table, ()):
            dm = DEFAULT_RE.search(line)
            if dm:
                out[(table, m.group(1))] = dm.group(1).strip()
    return out


def default_op(table_ref: str, col_ref: str, value: str) -> dict:
    return {"tool": "erd_change_column_default", "args": {"tableId": table_ref, "columnId": col_ref, "value": value}}


def step_tables_columns(schema_text: str, tables: list, d: Diagram) -> list[dict]:
    """1단계: 테이블과 컬럼(관계·인덱스는 새 ID가 생긴 뒤 2단계에서)."""
    ops: list[dict] = []
    defaults = column_defaults(schema_text, tables)
    want = {t.name for t in tables}
    for name in sorted(set(d.tables) - want):
        ops.append({"tool": "erd_remove_table", "args": {"tableId": d.table_id(name)}})
    n = 0
    for t in tables:
        uniq = single_uniques(t)
        if t.name not in d.tables:  # 새 테이블: 만들고 이름·설명·컬럼·그룹
            tv = f"t{len(ops)}"
            ops.append({"tool": "erd_add_table", "as": tv, "args": {}})
            ops.append({"tool": "erd_change_table_name", "args": {"tableId": f"${tv}", "value": t.name}})
            ops.append({"tool": "erd_change_table_comment", "args": {"tableId": f"${tv}", "value": table_comment(schema_text, t.name)}})
            for c in t.columns:
                n += 1
                ops += new_column_ops(f"${tv}", f"c{n}", c, c.name in uniq)
                if (t.name, c.name) in defaults:
                    ops.append(default_op(f"${tv}", f"$c{n}", defaults[(t.name, c.name)]))
            gid = d.groups.get(group_name(t.ctx))
            if gid:
                ops.append({"tool": "erd_set_table_group", "args": {"tableIds": [f"${tv}"], "groupId": gid}})
            continue
        tid = d.table_id(t.name)
        g = d.model["tables"][t.name]
        if g["comment"] != table_comment(schema_text, t.name):
            ops.append({"tool": "erd_change_table_comment", "args": {"tableId": tid, "value": table_comment(schema_text, t.name)}})
        if d.model["groups"].get(t.name) != group_name(t.ctx) and group_name(t.ctx) in d.groups:
            ops.append({"tool": "erd_set_table_group", "args": {"tableIds": [tid], "groupId": d.groups[group_name(t.ctx)]}})
        ids = d.col_ids(t.name)
        extra = [ids[c] for c in g["columns"] if c not in {x.name for x in t.columns}]
        if extra:
            ops.append({"tool": "erd_remove_columns", "args": {"tableId": tid, "columnIds": extra}})
        for i, c in enumerate(t.columns):
            e = g["columns"].get(c.name)
            if e is None:
                n += 1
                cv = f"c{n}"
                ops += new_column_ops(tid, cv, c, c.name in uniq)
                if (t.name, c.name) in defaults:
                    ops.append(default_op(tid, f"${cv}", defaults[(t.name, c.name)]))
                # 스키마의 차례: 다음 컬럼 가운데 다이어그램에 있는 첫 컬럼 자리로 옮김(없으면 맨 끝 그대로)
                nxt = next((x.name for x in t.columns[i + 1:] if x.name in ids), None)
                if nxt:
                    ops.append({"tool": "erd_move_column", "args": {"tableId": tid, "columnId": f"${cv}", "targetColumnId": ids[nxt]}})
                continue
            cid = ids[c.name]
            if re.sub(r"\s+", "", c.type).lower() != re.sub(r"\s+", "", e["type"]).lower():
                ops.append({"tool": "erd_change_column_data_type", "args": {"tableId": tid, "columnId": cid, "value": c.type}})
            if c.pk != e["pk"]:
                ops.append({"tool": "erd_set_column_primary_key", "args": {"tableId": tid, "columnId": cid, "value": c.pk}})
            if c.not_null != e["not_null"] and not c.pk:
                ops.append({"tool": "erd_set_column_not_null", "args": {"tableId": tid, "columnId": cid, "value": c.not_null}})
            if (c.name in uniq) != e["unique"]:
                ops.append({"tool": "erd_set_column_unique", "args": {"tableId": tid, "columnId": cid, "value": c.name in uniq}})
            if defaults.get((t.name, c.name), "") != (d.cols[cid].get("default") or ""):
                ops.append(default_op(tid, cid, defaults.get((t.name, c.name), "")))
            if c.comment != e["comment"]:
                ops.append({"tool": "erd_change_column_comment", "args": {"tableId": tid, "columnId": cid, "value": c.comment}})
    return ops


def new_column_ops(table_ref: str, var: str, c, unique: bool) -> list[dict]:
    ops = [{"tool": "erd_add_column", "as": var, "args": {"tableId": table_ref}},
           {"tool": "erd_change_column_name", "args": {"tableId": table_ref, "columnId": f"${var}", "value": c.name}},
           {"tool": "erd_change_column_data_type", "args": {"tableId": table_ref, "columnId": f"${var}", "value": c.type}}]
    if c.pk:
        ops.append({"tool": "erd_set_column_primary_key", "args": {"tableId": table_ref, "columnId": f"${var}", "value": True}})
    elif c.not_null:
        ops.append({"tool": "erd_set_column_not_null", "args": {"tableId": table_ref, "columnId": f"${var}", "value": True}})
    if unique:
        ops.append({"tool": "erd_set_column_unique", "args": {"tableId": table_ref, "columnId": f"${var}", "value": True}})
    ops.append({"tool": "erd_change_column_comment", "args": {"tableId": table_ref, "columnId": f"${var}", "value": c.comment}})
    return ops


def table_comment(schema_text: str, name: str) -> str:
    m = re.search(r"^COMMENT ON TABLE " + name + r" IS '(.*)';$", schema_text, re.M)
    return m.group(1).replace("''", "'") if m else ""


def step_relations_indexes(schema_text: str, tables: list, d: Diagram) -> list[dict]:
    """2단계: 관계와 다이어그램에 두는 인덱스."""
    ops: list[dict] = []
    have = d.rel_ids()
    want = {}
    for t in tables:
        for fk in t.fks:
            want[(fk.child, tuple(fk.cols), fk.parent, tuple(fk.parent_cols))] = fk
    for key in sorted(set(have) - set(want)):
        ops.append({"tool": "erd_remove_relationship", "args": {"relationshipId": have[key]}})
    for key in sorted(set(have) & set(want)):
        rid = have[key]
        mine, theirs = on_delete(schema_text, want[key]), ACTION_BITS.get(d.rels[rid].get("onDelete"))
        if mine != theirs:
            ops.append({"tool": "erd_change_relationship_on_delete", "args": {"relationshipId": rid, "onDelete": mine}})
    for key in sorted(set(want) - set(have)):
        fk = want[key]
        child_ids, parent_ids = d.col_ids(fk.child), d.col_ids(fk.parent)
        ops.append({"tool": "erd_link_columns", "args": {
            "startTableId": d.table_id(fk.parent), "startColumnIds": [parent_ids[c] for c in fk.parent_cols],
            "endTableId": d.table_id(fk.child), "endColumnIds": [child_ids[c] for c in fk.cols],
            "relationshipType": "ZeroN", "onDelete": on_delete(schema_text, fk), "onUpdate": "none"}})
    plain = plain_indexes(schema_text, tables)
    got = d.model["indexes"]
    for name in sorted(set(got) - set(plain)):
        ops.append({"tool": "erd_remove_index", "args": {"indexId": d.indexes[name]["id"]}})
    k = 0
    for name, (table, cols, unique) in sorted(plain.items()):
        if got.get(name) == (table, cols, unique):
            continue
        if name in got:
            ops.append({"tool": "erd_remove_index", "args": {"indexId": d.indexes[name]["id"]}})
        k += 1
        iv = f"i{k}"
        ids = d.col_ids(table)
        ops.append({"tool": "erd_add_index", "as": iv, "args": {"tableId": d.table_id(table)}})
        ops.append({"tool": "erd_change_index_name", "args": {"indexId": f"${iv}", "value": name}})
        for c in cols:
            ops.append({"tool": "erd_add_index_column", "args": {"indexId": f"${iv}", "columnId": ids[c]}})
        if unique:
            ops.append({"tool": "erd_set_index_unique", "args": {"indexId": f"${iv}", "value": True}})
    return ops


def after_script(mcp, schema_text: str) -> str:
    """erd_editor_build.py --build와 같은 꼴: 부분·식 인덱스, EXCLUDE, 지연 외래 키(다이어그램이 붙인 외래 키 이름으로)."""
    alters = []
    for table, cols in eb.deferred_fks(schema_text):
        ddl = mcp.call("erd_read", path=ERD, format="sql", tableNames=[table])
        want = ", ".join(cols)
        m = re.search(r"ALTER TABLE " + table + r"\s+ADD CONSTRAINT (\w+)\s+FOREIGN KEY \(" + re.escape(want) + r"\)", ddl)
        if not m:
            raise SystemExit(f"다이어그램에서 {table} ({want}) 외래 키를 찾지 못함")
        alters.append(f"ALTER TABLE {table} ALTER CONSTRAINT {m.group(1)} DEFERRABLE INITIALLY DEFERRED;")
    after = "\n".join([
        AFTER_HEAD,
        "-- 부분·식 인덱스",
        *[sql for _, sql in eb.special_indexes(schema_text)],
        "-- 중복 막기(EXCLUDE)",
        *eb.exclusions(schema_text),
        "-- 주문 행이 현재 버전의 주문 내용을 참조하는 외래 키는 트랜잭션 끝에 확인",
        *alters,
    ])
    if len(after) > 10000:
        raise SystemExit(f"after 스크립트가 {len(after)}자로 10,000자를 넘음")
    return after


def memo_ops(schema_text: str, d: Diagram) -> list[dict]:
    n = check_count(schema_text)
    ops = []
    for mid, m in d.memos.items():
        value = m.get("value", "")
        new = re.sub(r"CHECK 제약 \d+개", f"CHECK 제약 {n}개", value)
        if new != value:
            ops.append({"tool": "erd_change_memo_value", "args": {"memoId": mid, "value": new}})
    return ops


def place_new_tables(mcp, names: list[str]) -> list[dict]:
    """새 테이블 자리: 그룹 상자 안에서 같은 그룹 테이블의 오른쪽이나 아래 자리 가운데, 위에서부터 처음으로 들어가고
    어느 테이블과도 겹치지 않는 곳으로 옮김(너비는 erd_list의 어림값, 사이 60). 들어갈 곳이 없으면 그대로 두고 알림."""
    tables: dict[str, dict] = {}
    groups: dict[str, dict] = {}
    offset = 0
    while True:
        page = json.loads(mcp.call("erd_list", path=ERD, offset=offset))
        tables.update({t["name"]: t for t in page["tables"]})
        groups.update({g["id"]: g for g in page.get("tableGroups", [])})
        if page.get("nextOffset") is None:
            break
        offset = page["nextOffset"]
    gap, pad, ops = 60, 24, []
    for name in names:
        t = tables[name]
        g = groups.get(t.get("groupId"))
        if not g:
            continue
        others = [o for o in tables.values() if o["name"] != name and o.get("groupId") == t["groupId"]]

        def free(x: float, y: float) -> bool:
            if (x < g["x"] + pad or y < g["y"] + pad or x + t["width"] > g["x"] + g["width"] - pad
                    or y + t["height"] > g["y"] + g["height"] - pad):
                return False
            return all(x + t["width"] + gap <= o["x"] or o["x"] + o["width"] + gap <= x
                       or y + t["height"] + gap <= o["y"] or o["y"] + o["height"] + gap <= y
                       for o in tables.values() if o["name"] != name)

        spots = sorted({(o["x"] + o["width"] + gap, o["y"]) for o in others} | {(o["x"], o["y"] + o["height"] + gap) for o in others},
                       key=lambda p: (p[1], p[0]))
        spot = next((p for p in spots if free(*p)), None)
        if spot is None:
            print(f"  {name}: 그룹 '{g['name']}' 상자 안에 빈 곳이 없어 자리를 그대로 둠")
            continue
        ops.append({"tool": "erd_move_table", "args": {"tableId": t["id"], "x": spot[0], "y": spot[1]}})
        tables[name] = {**t, "x": spot[0], "y": spot[1]}
    return ops


def show(title: str, ops: list[dict]) -> None:
    print(f"{title}: 편집 {len(ops)}개")
    for op in ops:
        args = {k: (v if not isinstance(v, str) or len(v) <= 70 else v[:67] + "…") for k, v in op.get("args", {}).items()}
        print(f"  {op['tool']}{' as ' + op['as'] if op.get('as') else ''} {json.dumps(args, ensure_ascii=False)}")


def run_batches(mcp, ops: list[dict]) -> None:
    # erd_batch는 한 번에 100개까지. 'as' 이름은 한 묶음 안에서만 쓰이므로, 이름을 쓰는 편집은 같은 묶음에 둠
    chunk: list[dict] = []
    for op in ops:
        starts_unit = op["tool"] in ("erd_add_table", "erd_add_column", "erd_add_index") or not op.get("as")
        if len(chunk) >= 80 and starts_unit and not uses_pending_name(op, chunk):
            mcp.call("erd_batch", path=ERD, operations=chunk)
            chunk = []
        chunk.append(op)
    if chunk:
        mcp.call("erd_batch", path=ERD, operations=chunk)


def uses_pending_name(op: dict, chunk: list[dict]) -> bool:
    names = {o["as"] for o in chunk if o.get("as")}
    text = json.dumps(op.get("args", {}))
    return any(f'"${n}"' in text or f'"${n}.' in text for n in names)


def main(argv: list[str]) -> int:
    if not argv or argv[0].startswith("-"):
        print(__doc__)
        return 2
    root = Path(argv[0]).resolve()
    write = "--write" in argv
    schema_text = (root / build_erd.SCHEMA).read_text(encoding="utf-8")
    tables = build_erd.parse(schema_text)

    d = Diagram(root)
    new_names = [t.name for t in tables if t.name not in d.tables]
    ops1 = step_tables_columns(schema_text, tables, d)
    show("1단계 테이블·컬럼", ops1)
    mcp = eb.Mcp(root) if write else None
    try:
        if write and ops1:
            run_batches(mcp, ops1)
            mcp.call("erd_save", path=ERD)
        if write and new_names:
            moves = place_new_tables(mcp, new_names)
            show("1단계 새 테이블 자리", moves)
            if moves:
                run_batches(mcp, moves)
                mcp.call("erd_save", path=ERD)
        elif new_names:
            print(f"1단계 새 테이블 자리: 더한 뒤 그룹 상자 안의 빈 곳으로 옮김(--write): {', '.join(new_names)}")
        d = Diagram(root)  # 새 컬럼 ID를 다시 읽음
        ops2 = step_relations_indexes(schema_text, tables, d) if (write or not ops1) else []
        if not write and ops1:
            print("2단계 관계·인덱스: 1단계를 적용한 뒤에 셈(--write)")
        else:
            show("2단계 관계·인덱스", ops2)
        if write and ops2:
            run_batches(mcp, ops2)
            mcp.call("erd_save", path=ERD)
        ops3 = memo_ops(schema_text, d)
        if write:
            after = after_script(mcp, schema_text)
            if after != d.doc["settings"].get("ddlScripts", {}).get("after", ""):
                ops3.append({"tool": "erd_set_ddl_script", "args": {"position": "after", "sql": after}})
            before = d.doc["settings"].get("ddlScripts", {}).get("before", "")
            if "btree_gist" not in before:
                ops3.append({"tool": "erd_set_ddl_script", "args": {
                    "position": "before", "sql": "CREATE EXTENSION IF NOT EXISTS btree_gist; -- refund_tiers의 EXCLUDE에 씀"}})
        show("3단계 스크립트·메모", ops3)
        if not write:
            specials = [n for n, _ in eb.special_indexes(schema_text)]
            missing = [n for n in specials if not re.search(r"INDEX " + n + r" ON ", d.doc["settings"].get("ddlScripts", {}).get("after", ""))]
            print(f"  after 스크립트에 없는 부분·식 인덱스: {', '.join(missing) or '없음'} (--write면 after 스크립트를 다시 씀)")
        if write and ops3:
            run_batches(mcp, ops3)
            mcp.call("erd_save", path=ERD)
        if write:
            summary = json.loads(mcp.call("erd_list", path=ERD, namesOnly=True))
            print(f"저장함: 테이블 {summary['tableCount']}개. check_erd.py로 E1을 보세요")
    finally:
        if mcp:
            mcp.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
