import json, sys
def walk(d, path):
    for k, v in d.items():
        if k.startswith("$"): continue
        if isinstance(v, dict) and "$value" in v:
            yield path + [k], v
        elif isinstance(v, dict):
            yield from walk(v, path + [k])
def css(t):
    ty, v = t["$type"], t["$value"]
    if ty == "color":
        r, g, b = (round(c * 255) for c in v["components"])
        a = v.get("alpha", 1)
        return "#%02X%02X%02X" % (r, g, b) if a == 1 else "rgba(%d,%d,%d,%s)" % (r, g, b, a)
    if ty == "dimension": return "%s%s" % (v["value"], v["unit"])
    if ty == "fontFamily": return ",".join('"%s"' % f if " " in f else f for f in v)
    if ty in ("fontWeight", "number"): return str(v)
    if ty == "shadow":
        c = v["color"]; r, g, b = (round(x * 255) for x in c["components"])
        return "%s %s %s %s rgba(%d,%d,%d,%s)" % (*(str(v[k]["value"]) + v[k]["unit"] for k in ("offsetX", "offsetY", "blur", "spread")), r, g, b, c.get("alpha", 1))
    raise SystemExit("type " + ty)
d = json.load(open(sys.argv[1], encoding="utf-8"))
print(";".join("--%s:%s" % ("-".join(p), css(t)) for p, t in walk(d, [])) + ";")
