# 재검토 결과 파일(reviews/*.md)의 지적을 뽑아, 인용한 원문이 가리킨 파일에 글자 그대로 있는지 1차로 기계 확인한다.
# 사용: python3 -B verify_quotes.py <repo root> <review md> [...] [--json <out.json>]  → 표준 출력에 표, --json이면 그 파일에도 씀
# 판단(지적이 맞는지)은 하지 않는다. 인용이 실제로 있는지, 가리킨 줄 근처인지만 본다.
import json, re, sys
from pathlib import Path

args = sys.argv[1:]
JSON = None
if "--json" in args:
    i = args.index("--json"); JSON = args[i + 1]; del args[i:i + 2]
root = Path(args[0]).resolve()
HEAD = re.compile(r"^###\s+(R[A-E]-\d+)\s*\[(높음|중간|낮음)\]\s*(.+)$")
LOC = re.compile(r"((?:[\w.\-]+/)*[\w.\-]+\.(?:md|yaml|yml|sql|json|html|py|js))(?::(\d+)(?:[-–~](\d+))?)?")

def norm(s):
    return re.sub(r"\s+", " ", s).strip()

def quotes_of(block):
    qs = []
    for m in re.finditer(r"`([^`\n]{6,})`", block):
        qs.append(m.group(1))
    for m in re.finditer(r"[\"“]([^\"”\n]{8,})[\"”]", block):
        qs.append(m.group(1))
    for line in block.splitlines():
        s = line.strip()
        if s.startswith(">"):
            q = s.lstrip(">").strip()
            if len(q) >= 8:
                qs.append(q)
    # 파일 경로처럼 생긴 것은 인용이 아님
    return [q for q in dict.fromkeys(qs) if not LOC.fullmatch(q.strip())]

cache = {}
def text_of(rel):
    if rel not in cache:
        p = (root / rel)
        if not p.is_file():
            hits = list(root.glob("**/" + Path(rel).name)) if "/" not in rel else []
            hits = [h for h in hits if ".git" not in h.parts]
            p = hits[0] if len(hits) == 1 else p
        cache[rel] = p.read_text(encoding="utf-8", errors="replace") if p.is_file() else None
    return cache[rel]

out = []
for f in args[1:]:
    txt = Path(f).read_text(encoding="utf-8")
    parts = re.split(r"(?m)^(?=###\s+R[A-E]-\d+)", txt)
    for part in parts:
        first = part.splitlines()[0] if part.strip() else ""
        m = HEAD.match(first)
        if not m:
            continue
        fid, sev, title = m.groups()
        conf = re.search(r"확실도\s*[:：]\s*\**\s*(높음|중간|낮음)", part)
        locs = []
        for lm in re.finditer(r"(?m)^\s*-\s*\**위치\**\s*[:：](.*)$", part):
            for x in LOC.finditer(lm.group(1)):
                locs.append((x.group(1), int(x.group(2)) if x.group(2) else None))
        files = sorted({l[0] for l in locs})
        missing_files = [r for r in files if text_of(r) is None]
        ev = re.search(r"(?ms)^\s*-\s*\**근거\**\s*[:：](.*?)(?=^\s*-\s*\**(?:왜 중요한가|고치는 방향|확실도)\**\s*[:：])", part)
        qs = quotes_of(ev.group(1) if ev else part)
        found = 0; notfound = []
        alltext = norm("\n".join(t for t in (text_of(r) for r in files) if t))
        for q in qs:
            if norm(q) in alltext:
                found += 1
            else:
                notfound.append(q[:80])
        out.append({"id": fid, "sev": sev, "title": title.strip(), "conf": conf.group(1) if conf else None,
                    "files": files, "missing_files": missing_files, "quotes": len(qs), "found": found,
                    "notfound": notfound, "src": Path(f).name})

order = {"높음": 0, "중간": 1, "낮음": 2}
out.sort(key=lambda r: (order[r["sev"]], r["id"]))
if JSON:
    json.dump(out, open(JSON, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
from collections import Counter
print("지적", len(out), dict(Counter(r["sev"] for r in out)))
for r in out:
    flag = "" if (r["quotes"] == r["found"] and not r["missing_files"]) else "  ← 인용 확인 필요"
    print(f'{r["id"]:7s} {r["sev"]} 확실도:{r["conf"]} 인용 {r["found"]}/{r["quotes"]} {r["title"][:70]}{flag}')
