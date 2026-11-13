"""Checks for docs/03-user-flow/ (CORTHEX stage 03 checks, Korean flows).

python check_flows.py <flow-dir> <requirements.md> <domain.md> [--fill] [--appendix]

--fill      rewrite each file's '채우는 요구사항:' line from the REQ IDs in its diagram
--appendix  print the requirement-to-flow table for README section 7
"""
import os
import re
import sys
from collections import Counter, defaultdict

args = [a for a in sys.argv[1:] if not a.startswith("--")]
flags = {a for a in sys.argv[1:] if a.startswith("--")}
flow_dir, req_path, dom_path = args
reqs_text = open(req_path, encoding="utf-8").read()
dom = open(dom_path, encoding="utf-8").read()

# --- requirements and glossary ----------------------------------------------
# Requirement rows are the rows of tables whose header starts with "| ID | 요구사항".
# Other tables that name REQ IDs (such as the 2nd-edition summary) are skipped.
REQ = {}
in_req_table = False
for line in reqs_text.splitlines():
    if line.startswith("| ID | 요구사항"):
        in_req_table = True
        continue
    if not line.startswith("|"):
        in_req_table = False
        continue
    if in_req_table and line.startswith("| REQ-"):
        c = [x.strip() for x in line.strip().strip("|").split("|")]
        REQ[c[0]] = {"text": c[1], "type": c[3], "prio": c[4], "ctx": c[5], "status": c[7]}

def excluded(r):
    # '제외' or '제외(버전 2, REQ-153로 바꿈)'
    return REQ[r]["status"].startswith("제외")
TERMS = set(re.findall(r"^\| (TERM-\d{3}) \|", dom, re.M))
CTXS = {"CTX-%03d" % i for i in range(1, 10)}

avoid = []
for line in dom.splitlines():
    if line.startswith("| TERM-0"):
        c = [x.strip() for x in line.strip().strip("|").split("|")]
        for w in re.split(r",\s*", c[5]):
            w = re.sub(r"\(.*?\)", "", w).strip()
            if w and w != "없음" and len(w) >= 2 and not re.fullmatch(r"`.*`", w):
                avoid.append((w, c[0], c[1]))
for w in ("입금 확인", "예약 확정", "결제 완료", "노쇼", "클레임", "위약금", "에스크로", "홀드",
          "챗봇", "고객", "관리자", "승인", "리뷰", "배송", "배달", "판매자"):
    avoid.append((w, "-", "01단계에서 합친 말"))
# allowed uses, checked by hand (window around the hit)
ALLOW = {
    "예약": [r"예약 링크", r"가예약"],                         # TERM-007 가예약 (2026-11-12 용어 정리)
    "정책": [r"5-1의 정책"],                                    # TERM-029 itself (domain 5-1)
    "확정": [r"주문[이을]? ?확정", r"확정[된되]", r"확정하", r"확정 안내", r"확정·부터·범위", r"확정 주문",
             r"운영규정 확정", r"버전으로 확정", r"버전 확정", r"범위 확정", r"추천대로 확정", r"확정해야", r"확정이",
             r"확정까지", r"확정했", r"'확정'", r"확정\)", r"확정으로", r"확정할", r"확정받",
             r"주문 요청·확정", r"플로우만 확정",
             # document status words after the stage 03 checkpoint (2026-11-12), not TERM-011 수락
             r"^status: 확정", r"\| 확정 \|", r"단계 확정", r"상태: 확정", r"\d 확정:", r"(\d|,) 확정 뒤",
             # section name for fixes made after a stage was confirmed (design review, 2026-11-13)
             r"확정한 뒤 고친"],
    "시트": [r"구글 시트"],
    "입금": [r"입금했다고", r"입금 대조", r"들어온 입금", r"입금이 확인", r"입금자", r"입금됨", r"미입금"],
    "거래": [r"전자상거래법"],
    "주문서": [r"주문서 초안"],
    "매장": [r"매장에서"],                                      # place, as in TERM-024
}

def allowed(word, text, start, end):
    window = text[max(0, start - 14): end + 14]
    line_start = text.rfind("\n", 0, start) + 1
    line_end = text.find("\n", end)
    line = text[line_start: line_end if line_end >= 0 else len(text)]
    return any(re.search(a, window) or (a.startswith("^") and re.search(a, line)) for a in ALLOW.get(word, []))

# --- mermaid parsing ----------------------------------------------------------
NODE = re.compile(r'^\s*([A-Za-z][A-Za-z0-9]*)(\(\[|\[\[|\[|\{)"(.*)"(\]\)|\]\]|\]|\})\s*$')
ARROW = re.compile(r'\s*(-->|-\.->|-\.-)(?:\|"([^"]*)"\|)?\s*')
CLASS = re.compile(r"^\s*class\s+([A-Za-z0-9_,]+)\s+(\w+)\s*$")
SHAPES = {"([": "stadium", "[[": "flow", "[": "step", "{": "decision"}

def parse(block):
    nodes, edges, classes, problems = {}, [], {}, []
    lines = block.splitlines()
    if not lines or not lines[0].strip().startswith("flowchart"):
        problems.append("diagram does not start with 'flowchart'")
    for raw in lines[1:]:
        line = raw.strip()
        if not line or line.startswith("%%") or line.startswith("classDef"):
            continue
        m = CLASS.match(line)
        if m:
            for n in m.group(1).split(","):
                classes.setdefault(n, []).append(m.group(2))
            continue
        m = NODE.match(line)
        if m:
            nid, shape, label = m.group(1), m.group(2), m.group(3)
            if nid in nodes:
                problems.append("node %s defined twice" % nid)
            if nid.lower() == "end":
                problems.append("node id 'end' breaks Mermaid")
            nodes[nid] = {"shape": SHAPES[shape], "label": label}
            continue
        parts = ARROW.split(line)
        if len(parts) >= 4:
            ids = parts[0::3]
            for i in range(len(ids) - 1):
                edges.append((ids[i].strip(), ids[i + 1].strip(), parts[3 * i + 1], parts[3 * i + 2] or ""))
            continue
        problems.append("line not understood: %s" % line)
    for a, b, kind, _ in edges:
        for n in (a, b):
            if n not in nodes:
                problems.append("edge uses undefined node %s" % n)
    return nodes, edges, classes, problems

def plain(label):
    return re.sub(r"<br/>", " ", label)

# --- read flow files ----------------------------------------------------------
files = sorted(f for f in os.listdir(flow_dir) if re.match(r"FL-\d{3}-.*\.md$", f))
problems, notes, hits = [], [], []
flows = {}
for f in files:
    path = os.path.join(flow_dir, f)
    text = open(path, encoding="utf-8").read()
    fid = f[:6]
    h1 = re.search(r"^# (FL-\d{3}) (.+)$", text, re.M)
    if not h1 or h1.group(1) != fid:
        problems.append("%s: H1 does not start with %s" % (f, fid))
    fm = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    status = re.search(r"^status: *(.+)$", fm.group(1), re.M).group(1).strip() if fm and re.search(r"^status:", fm.group(1), re.M) else ""
    if status not in ("초안", "확정", "제외"):
        problems.append("%s: status '%s'" % (f, status))
    blocks = re.findall(r"```mermaid\n(.*?)```", text, re.S)
    if len(blocks) != 1:
        problems.append("%s: %d mermaid blocks" % (f, len(blocks)))
        continue
    nodes, edges, classes, perr = parse(blocks[0])
    problems += ["%s: %s" % (fid, p) for p in perr]
    out = defaultdict(list)
    for a, b, kind, label in edges:
        if kind in ("-->", "-.->"):
            out[a].append((b, label))
    starts = [n for n, d in nodes.items() if d["shape"] == "stadium" and d["label"].startswith("시작")]
    ends = [n for n, d in nodes.items() if d["shape"] == "stadium" and d["label"].startswith("끝")]
    if not starts:
        problems.append("%s: no start" % fid)
    if not ends:
        problems.append("%s: no end" % fid)
    # decisions: two or more branches, each labelled
    for n, d in nodes.items():
        if d["shape"] == "decision":
            if len(out[n]) < 2:
                problems.append("%s: decision %s has %d branch(es)" % (fid, n, len(out[n])))
            for b, label in out[n]:
                if not label:
                    problems.append("%s: decision %s -> %s has no label" % (fid, n, b))
    # dead ends: a node with no way on must be an end, a link to another flow, or a note
    annotation = {b for a, b, kind, _ in edges if kind == "-.-"} | {a for a, b, kind, _ in edges if kind == "-.-"}
    for n, d in nodes.items():
        if not out[n] and d["shape"] not in ("flow",) and n not in ends:
            if n in annotation and "후보" in d["label"]:
                continue
            problems.append("%s: %s goes nowhere and is not an end" % (fid, n))
    # reachable from a start
    seen, todo = set(starts), list(starts)
    while todo:
        n = todo.pop()
        for b, _ in out[n]:
            if b not in seen:
                seen.add(b)
                todo.append(b)
    for a, b, kind, _ in edges:
        if kind == "-.-":
            if a in seen:
                seen.add(b)
            if b in seen:
                seen.add(a)
    for n in nodes:
        if n not in seen:
            problems.append("%s: %s cannot be reached from a start" % (fid, n))
    # every node has an actor colour
    for n in nodes:
        if n not in classes:
            problems.append("%s: %s has no class (actor colour)" % (fid, n))
    # steps without a requirement
    bare = [n for n, d in nodes.items() if d["shape"] == "step" and "후보" not in d["label"] and not re.search(r"REQ-\d{3}", d["label"])]
    if bare:
        notes.append("%s: steps without a REQ: %s" % (fid, ", ".join("%s(%s)" % (n, plain(nodes[n]["label"])[:24]) for n in bare)))
    # requirements a step serves: REQ IDs in node labels, not in candidate notes ("후보")
    diagram_reqs = sorted({r for d in nodes.values() if "후보" not in d["label"] for r in re.findall(r"REQ-\d{3}", d["label"])})
    for r in diagram_reqs:
        if r in REQ and excluded(r):
            problems.append("%s: a step serves %s, which is %s" % (fid, r, REQ[r]["status"]))
    flows[fid] = {"file": f, "title": h1.group(2) if h1 else "", "reqs": diagram_reqs, "nodes": nodes,
                  "edges": edges, "starts": starts, "ends": ends, "status": status, "text": text,
                  "gaps": sorted(set(re.findall(r"후보 (N\d)", blocks[0]))),
                  "readings": sorted(set(re.findall(r"R(\d{1,2})\b", blocks[0])), key=int)}
    # fill or compare the '채우는 요구사항' line
    line = "채우는 요구사항: " + ", ".join(diagram_reqs)
    m = re.search(r"^채우는 요구사항: .*$", text, re.M)
    if not m:
        problems.append("%s: no '채우는 요구사항' line" % fid)
    elif m.group(0) != line:
        if "--fill" in flags:
            text = text.replace(m.group(0), line)
            open(path, "w", encoding="utf-8").write(text)
            flows[fid]["text"] = text
            notes.append("%s: filled 채우는 요구사항 (%d REQ)" % (fid, len(diagram_reqs)))
        else:
            problems.append("%s: '채우는 요구사항' differs from the diagram" % fid)

# --- ID references in all files of the folder ---------------------------------
all_files = sorted(f for f in os.listdir(flow_dir) if f.endswith(".md"))
for f in all_files:
    text = open(os.path.join(flow_dir, f), encoding="utf-8").read()
    for m in re.finditer(r"REQ-(\d{3})", text):
        if m.group(0) not in REQ:
            problems.append("%s: reference to missing %s" % (f, m.group(0)))
    for m in re.finditer(r"CTX-(\d{3})", text):
        if m.group(0) not in CTXS:
            problems.append("%s: reference to missing %s" % (f, m.group(0)))
    for m in re.finditer(r"TERM-(\d{3})", text):
        if m.group(0) not in TERMS:
            problems.append("%s: reference to missing %s" % (f, m.group(0)))
    for m in re.finditer(r"FL-(\d{3})", text):
        if m.group(0) not in flows:
            problems.append("%s: reference to missing %s" % (f, m.group(0)))
    # glossary: avoided words (whole file, URLs removed)
    body = re.sub(r"https?://\S+", "", text)
    for w, tid, term in avoid:
        for m in re.finditer(re.escape(w), body):
            ctxt = body[max(0, m.start() - 10): m.end() + 10].replace("\n", " ")
            if allowed(w, body, m.start(), m.end()):
                notes.append("%s: '%s' (금지어 of %s %s) allowed: …%s…" % (f, w, tid, term, ctxt))
            else:
                hits.append("%s: '%s' (금지어 of %s %s): …%s…" % (f, w, tid, term, ctxt))

# --- coverage -------------------------------------------------------------------
by_req = defaultdict(list)
for fid, fl in flows.items():
    for r in fl["reqs"]:
        by_req[r].append(fid)
must = [r for r, d in REQ.items() if d["prio"] == "필수" and not excluded(r)]
live = [r for r in REQ if not excluded(r)]
must_missing = [r for r in must if r not in by_req]
all_missing = [r for r in live if r not in by_req]

print("flows:", len(flows), ", ".join(flows))
print("nodes per flow:", ", ".join("%s %d" % (k, len(v["nodes"])) for k, v in flows.items()))
print("decisions:", sum(1 for v in flows.values() for d in v["nodes"].values() if d["shape"] == "decision"),
      " ends:", sum(len(v["ends"]) for v in flows.values()),
      " starts:", sum(len(v["starts"]) for v in flows.values()))
print("requirements: %d rows, %d live, %d Must; excluded: %s" % (len(REQ), len(live), len(must),
      ", ".join(r for r in REQ if excluded(r)) or "none"))
print("Must in at least one flow: %d/%d; missing: %s" % (len(must) - len(must_missing), len(must), ", ".join(must_missing) or "none"))
print("all in at least one flow: %d/%d; not used by any flow: %s" % (len(live) - len(all_missing), len(live),
      ", ".join("%s(%s)" % (r, REQ[r]["prio"]) for r in all_missing) or "none"))
print("candidates drawn:", dict(sorted(Counter(g for v in flows.values() for g in v["gaps"]).items())))
print("readings named in diagrams:", sorted({int(r) for v in flows.values() for r in v["readings"]}))
print("PROBLEMS (%d)" % len(problems))
for p in problems:
    print("  -", p)
print("AVOIDED WORDS (%d)" % len(hits))
for h in sorted(set(hits)):
    print("  -", h)
print("NOTES (%d)" % len(notes))
for x in sorted(set(notes)):
    print("  -", x)

if "--appendix" in flags:
    print()
    print("| 요구사항 | 우선순위 | 플로우 |")
    print("| --- | --- | --- |")
    for r in sorted(REQ):
        if excluded(r):
            # '제외(버전 2, REQ-153로 바꿈)' -> '제외 (버전 2, REQ-153)'
            m = re.match(r"제외\((.*?)(?:로 바꿈)?\)$", REQ[r]["status"])
            where = "제외 (%s)" % m.group(1) if m else "제외"
        else:
            where = ", ".join(by_req.get(r, [])) or "없음 (2절)"
        print("| %s | %s | %s |" % (r, REQ[r]["prio"], where))
