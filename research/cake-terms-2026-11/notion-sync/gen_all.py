"""단계별 Notion DB 행 값을 저장소 원본에서 만든다(용어 바꾸기 동기화용).
python3 -I gen_all.py <repo> <out.json>
출력: {DB 이름: {행 키: {"props": {...}, "body": str|None}}}
"""
import sys, re, json, importlib.util
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import tdiff
import yaml

root = Path(sys.argv[1])
read = lambda p: (root / p).read_text(encoding="utf-8")
esc = lambda s: s.replace("~", "\\~")
unp = lambda s: s.replace("\\|", "|").strip()
nobt = lambda s: s.replace("`", "")
out = {}

def load(name, rel):
    spec = importlib.util.spec_from_file_location(name, root / rel)
    m = importlib.util.module_from_spec(spec); sys.modules[name] = m; spec.loader.exec_module(m); return m

def rows_of(text, first_cols):
    res = []
    for t in tdiff.tables(text):
        if t["hdr"][:len(first_cols)] == first_cols:
            res += [dict(zip(t["hdr"], [unp(c) for c in r])) for r in t["rows"]]
    return res

# 02 요구사항
req = read("docs/02-prd/requirements.md")
out["REQ"] = {d["ID"]: {"props": {"요구사항": esc(d["요구사항"]), "형태": d["형태"], "출처": esc(d["출처"])}, "body": None}
              for d in rows_of(req, ["ID", "요구사항", "형태"])}

# 02 핫스팟 답
hs = {}
sec2 = req.split("## 2. 핫스팟 답")[1].split("\n## 3.")[0]
for blk in re.split(r"\n#### 핫스팟 ", sec2)[1:]:
    head, *lines = blk.split("\n")
    num, rest = head.split(". ", 1)
    title = rest.split(": ")[0]
    b = {}
    for l in lines:
        m = re.match(r"^- (추천|근거|대안|반론|관련): (.*)$", l)
        if m: b[m.group(1)] = m.group(2)
    hs[num] = {"props": {"핫스팟": f"{num} {title}", "답": esc(b.get("추천", "")), "근거": esc(b.get("근거", "")),
                         "대안": esc(b.get("대안", "")), "반론": esc(b.get("반론", "")), "관련 REQ": esc(b.get("관련", ""))}, "body": None}
for d in rows_of(sec2, ["핫스팟"]):
    k = d["핫스팟"]
    m = re.match(r"^([\d·]+)\. (.*)$", k)
    key, title = (m.group(1), f"{m.group(1)} {m.group(2)}") if m else (k, k)
    hs[key] = {"props": {"핫스팟": title, "답": esc(d[[c for c in d if c not in ("핫스팟", "관련 REQ")][0]]), "관련 REQ": esc(d["관련 REQ"])}, "body": None}
out["HOT"] = hs

# 03 플로우(extract.py와 같은 방식, 옛 열 이름도 받음)
fl = {}
for f in sorted((root / "docs/03-user-flow").glob("FL-*.md")):
    text = f.read_text(encoding="utf-8")
    m = re.match(r"---\n(.*?)\n---\n", text, re.S)
    body = text[m.end():] if m else text
    lines = body.split("\n")
    ti = next(i for i, l in enumerate(lines) if l.startswith("# "))
    title = lines[ti][2:].strip()
    rest = "\n".join(lines[ti + 1:]).strip("\n")
    meta = {}
    for l in rest.split("\n"):
        mm = re.match(r"\| (액터|행위자|컨텍스트|시작|끝|연결 플로우|이어지는 흐름) \| (.*) \|$", l)
        if mm:
            meta[{"행위자": "액터", "이어지는 흐름": "연결 플로우"}.get(mm.group(1), mm.group(1))] = mm.group(2)
    reqs = re.search(r"^채우는 요구사항: (.*)$", rest, re.M).group(1)
    ol, code = [], False
    for l in rest.split("\n"):
        if l.startswith("```"):
            code = not code; ol.append(l); continue
        ol.append(l if code else esc(l))
    fl[title.split()[0]] = {"props": {"플로우": title, "시작": esc(meta["시작"]), "끝": esc(meta["끝"]),
                                      "연결 플로우": esc(meta["연결 플로우"]), "요구사항": reqs}, "body": "\n".join(ol)}
out["FLOW"] = fl

r03 = read("docs/03-user-flow/README.md")
out["CAND"] = {d["후보"]: {"props": {"할 일": esc(d["할 일"]), "문장": esc(d["문장"]),
                                    "찾은 플로우": d.get("찾은 플로우", d.get("찾은 흐름")), "사유": esc(d.get("사유", d.get("까닭")))}, "body": None}
               for d in rows_of(r03, ["후보", "우선순위", "컨텍스트", "할 일"])}
out["READ"] = {d["번호"]: {"props": {"요구사항 해석": esc(d.get("요구사항 해석", d.get("읽은 방식"))), "근거": esc(d["근거"]),
                                    "플로우": d.get("플로우", d.get("흐름"))}, "body": None}
               for d in rows_of(r03, ["번호"]) if re.match(r"^R\d+$", d["번호"])}

# 04 SPEC
sr = load("spec_rows_" + str(abs(hash(str(root)))), "research/cake-spec-2026-11/spec_rows.py")
sp = {}
for r in sr.ROWS:
    body = "## 주 동작\n\n" + r["main"] + "\n\n## 예외\n\n" + "\n".join("- " + e for e in r["exc"]) + \
           "\n\n## 수락 기준\n\n" + "\n".join("- " + a for a in r["ac"])
    if r.get("ai"):
        body += "\n\n## AI 호출\n\n원본 5절 AI-1(상담 답 만들기)을 따릅니다."
    sp[r["id"]] = {"props": {"동작": esc(r["name"]), "전제": esc(r["pre"]), "요구사항": r["req"]}, "body": esc(body)}
out["SPEC"] = sp

# 05 결정 사항 E, 테이블 TBL
r05 = read("docs/05-erd/README.md")
e = {}
for d in rows_of(r05, ["번호"]):
    if re.match(r"^E\d+$", d["번호"]):
        v = list(d.values())
        e[d["번호"]] = {"props": {"결정 사항": esc(v[1]), "사유": esc(v[2]), "대안과 그 결과": esc(v[3])}, "body": None}
out["E"] = e
be = load("build_erd_" + str(abs(hash(str(root)))), "research/cake-erd-2026-11/build_erd.py")
schema = read("db/schema.sql")
NEWHEAD = "--old-heads" not in sys.argv
tc = dict(re.findall(r"^COMMENT ON TABLE (\w+) IS '(.*)';$", schema, re.M))
tb = {}
for t in be.parse(schema):
    desc = re.sub(r"^TBL-\d{3} ", "", tc[t.name].replace("''", "'"))
    H = ("컬럼", "참조하는 테이블") if NEWHEAD else ("칸", "가리키는 표")
    lines = [f"### {H[0]} {len(t.columns)}개", "", f"| {H[0]} | 타입 | 빈 값 | 설명 |", "| --- | --- | --- | --- |"]
    for c in t.columns:
        need = "기본 키" if c.pk else ("안 됨" if c.not_null else "됨")
        lines.append(f"| `{c.name}` | {c.type} | {need} | {c.comment.replace('|', chr(92) + '|').strip()} |")
    if t.fks:
        lines += ["", f"### {H[1]} {len(t.fks)}개", ""]
        for fk in t.fks:
            lines.append(f"- ({', '.join(f'`{x}`' for x in fk.cols)}) → `{fk.parent}` ({', '.join(fk.parent_cols)})")
    tb[t.tbl] = {"props": {"이름": esc(t.korean), "설명": esc(desc), "용어": ", ".join(t.terms) or "없음"}, "body": esc("\n".join(lines))}
out["TBL"] = tb

# 06 API·오류 코드·결정 사항
api = yaml.safe_load(read("api/openapi.yaml"))
ops = {}
for p, item in api["paths"].items():
    for m, op in item.items():
        if m in ("get", "post", "put", "patch", "delete"):
            x = op["x-corthex"]
            ops[x["id"]] = {"props": {"API": esc(nobt(f"{x['id']} {op['summary']}")), "태그": op["tags"][0],
                                      "뺀 응답과 사유": esc(nobt(" / ".join(f"{k} {v}" for k, v in (x.get("omit") or {}).items())))}, "body": None}
out["API"] = ops
xc = api["components"]["x-corthex"]
out["ERR"] = {k: {"props": {"뜻": esc(nobt(v["meaning"])), "화면에 보이는 말": esc(nobt(v["message"])), "화면이 할 일": esc(nobt(v["client"]))}, "body": None}
              for k, v in xc["errors"].items()}
out["DEC"] = {d["id"]: {"props": {"결정 사항": esc(nobt(f"{d['id']} {d['title']}")), "선택안": esc(nobt(d["choice"])),
                                 "사유": esc(nobt(d["why"])), "대안": esc(nobt(d["alt"]))}, "body": None} for d in xc["decisions"]}

# 07 결정 사항 S, 화면 SCR(rows2.py와 같은 방식)
r07 = read("docs/07-sitemap/README.md")
out["S"] = {d["번호"]: {"props": {"결정": esc(nobt(d["결정"])), "이유": esc(nobt(d["이유"])), "대안과 그 결과": esc(nobt(d["대안과 그 결과"]))}, "body": None}
            for d in rows_of(r07, ["번호", "결정"])}
sm = yaml.safe_load(read("docs/07-sitemap/sitemap.yaml"))
scr = {}
def walk(node, parent):
    flows = node.get("flows") or []
    scr[node["id"]] = {"props": {
        "이름": esc(node["name"]),
        "상위 화면": esc((parent["id"] + " " + parent["name"]) if parent else "루트"),
        "플로우": esc(", ".join(flows) if flows else "플로우 노드 없음: " + node.get("no_flow", "")),
        "API": esc(", ".join(node.get("apis") or []) or "없음(카카오로 먼저 보내는 안내)"),
        "이동 화면": esc(", ".join(node.get("opens") or [])),
        "설명": esc(node.get("note", ""))}, "body": None}
    for c in node.get("children") or []:
        walk(c, node)
for r in sm:
    walk(r, None)
out["SCR"] = scr

json.dump(out, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print({k: len(v) for k, v in out.items()})
