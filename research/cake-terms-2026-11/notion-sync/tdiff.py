"""두 커밋 사이에서 마크다운 표의 바뀐 셀을 찾는다. 사용: python3 -I tdiff.py <repo> <old> <new> <path>..."""
import subprocess, sys, re, json

def show(repo, rev, path):
    r = subprocess.run(["git", "-C", repo, "show", f"{rev}:{path}"], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else ""

def cells(line):
    s = line.strip()
    if not (s.startswith("|") and s.endswith("|")):
        return None
    # 코드 안의 | 와 \| 는 나누지 않음
    out, cur, code, i = [], "", False, 1
    while i < len(s) - 1:
        ch = s[i]
        if ch == "`":
            code = not code
        if ch == "\\" and i + 1 < len(s) - 1 and s[i + 1] == "|":
            cur += "\\|"; i += 2; continue
        if ch == "|" and not code:
            out.append(cur.strip()); cur = ""
        else:
            cur += ch
        i += 1
    out.append(cur.strip())
    return out

def tables(text):
    lines = text.split("\n")
    heads, res, i = [], [], 0
    while i < len(lines):
        l = lines[i]
        m = re.match(r"^(#{1,6}) (.*)", l)
        if m:
            heads = heads[: len(m.group(1)) - 1] + [m.group(2)]
        c = cells(l)
        if c and i + 1 < len(lines) and re.match(r"^\|\s*:?-{3,}", lines[i + 1].strip()):
            hdr = c; rows = []; j = i + 2
            while j < len(lines) and cells(lines[j]) is not None:
                rows.append(cells(lines[j])); j += 1
            res.append({"where": " / ".join(heads[-2:]), "line": i + 1, "hdr": hdr, "rows": rows})
            i = j; continue
        i += 1
    return res

if __name__ == "__main__":
    repo, old, new, *paths = sys.argv[1:]
    for p in paths:
        to, tn = tables(show(repo, old, p)), tables(show(repo, new, p))
        if len(to) != len(tn):
            print(f"## {p}: 표 수가 다름 {len(to)} → {len(tn)}")
        for a, b in zip(to, tn):
            ch_rows = []
            ko = {r[0]: r for r in a["rows"]}
            for r in b["rows"]:
                o = ko.get(r[0])
                if o is None:
                    ch_rows.append((r[0], "새 행/키 바뀜"))
                    continue
                diffs = [b["hdr"][k] if k < len(b["hdr"]) else str(k) for k in range(max(len(o), len(r))) if (o[k] if k < len(o) else None) != (r[k] if k < len(r) else None)]
                if diffs:
                    ch_rows.append((r[0], ",".join(diffs)))
            hdr_ch = [(x, y) for x, y in zip(a["hdr"], b["hdr"]) if x != y]
            if ch_rows or hdr_ch or a["where"] != b["where"]:
                print(f"## {p}:{b['line']} [{a['where']}] → [{b['where']}] 열={b['hdr']}")
                if hdr_ch: print("   열 이름 바뀜:", hdr_ch)
                print(f"   바뀐 행 {len(ch_rows)}/{len(b['rows'])}:", "; ".join(f"{k}({d})" for k, d in ch_rows[:400]))
