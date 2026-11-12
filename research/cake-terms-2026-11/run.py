import sys, os, re, json, collections, importlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scope import files, ROOT
import engine
importlib.reload(engine)
import rules
importlib.reload(rules)

def run(write=False, out_dir=None, only_rules=None, report="report.txt"):
    log = collections.defaultdict(collections.Counter)
    changed = {}
    for f in files():
        path = f"{ROOT}/{f}"
        t0 = open(path, encoding="utf-8").read()
        t = t0
        g = engine.group_of(f)
        # protect verbatim quotes
        prot = []
        def mask(m):
            if "K" in m.re.groupindex and m.group("K") is not None:
                a, b = m.start("K") - m.start(), m.end("K") - m.start()
                prot.append(m.group("K")); return m.group(0)[:a] + f"\u0001{len(prot)-1}\u0001" + m.group(0)[b:]
            prot.append(m.group(0)); return f"\u0001{len(prot)-1}\u0001"
        for pq in rules.PROTECT:
            t = re.sub(pq, mask, t)
        for r in rules.RULES:
            if only_rules and r.name not in only_rules:
                continue
            if r.applies(g) and (r.files is None or any(x in f for x in r.files)):
                t = r.sub(t, log, f)
        t = re.sub("\u0001(\\d+)\u0001", lambda m: prot[int(m.group(1))], t)
        if t != t0:
            changed[f] = t
            if write:
                open(path, "w", encoding="utf-8").write(t)
    with open(report, "w", encoding="utf-8") as fo:
        names = list(dict.fromkeys([r.name for r in rules.RULES] + [r.name + " (명사형)" for r in rules.RULES]))
        for name in names + sorted(k for k in log if k.endswith("!SKIP")):
            if name not in log: continue
            c = log[name]
            fo.write(f"### {name}  total={sum(c.values())} distinct={len(c)}\n")
            for (ctx, out), n in sorted(c.items(), key=lambda x: -x[1]):
                fo.write(f"{n:4d}  {ctx}  =>  {out}\n")
    return changed, log

if __name__ == "__main__":
    import tempfile
    w = "--write" in sys.argv
    rep = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--report=")),
               os.path.join(tempfile.gettempdir(), "terms-report.txt"))
    ch, log = run(write=w, report=rep)
    print("report:", rep)
    for f in sorted(ch):
        print("  would change:" if not w else "  changed:", f)
    tot = {k: sum(v.values()) for k, v in log.items()}
    print("files changed:", len(ch), " total subs:", sum(v for k, v in tot.items() if not k.endswith('!SKIP')))
    for k, v in tot.items():
        print(f"  {k}: {v}")
