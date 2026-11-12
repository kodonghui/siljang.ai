"""python3 -I diff2.py BASE.json CUR.json DB[,DB…] → 바뀐 행의 속성(json)과 본문 편집(content_updates)"""
import json, re, sys
base = json.load(open(sys.argv[1], encoding='utf-8')); cur = json.load(open(sys.argv[2], encoding='utf-8'))
BAD = set('`<>\\~*_[]')
def render(s):  # Notion fetch 표현: `x` → <code>x</code>
    return re.sub(r'`([^`]*)`', r'<code>\1</code>', s)
def edits_for(ob, nb):
    ol, nl = ob.split('\n'), nb.split('\n')
    if len(ol) != len(nl):
        return None
    R = render(ob)
    out = []
    for a, b in zip(ol, nl):
        if a == b:
            continue
        p = 0
        while p < min(len(a), len(b)) and a[p] == b[p]: p += 1
        s = 0
        while s < min(len(a), len(b)) - p and a[len(a)-1-s] == b[len(b)-1-s]: s += 1
        i, j = p, len(a) - s          # old core a[i:j]
        k = len(b) - s                # new core b[p:k]
        ok = False
        for _ in range(60):
            seg = a[i:j]
            if seg and not (set(seg) & BAD) and R.count(seg) == 1 and len(seg.strip()) >= 2:
                ok = True; break
            # 좌우로 한 글자씩 넓힘(나쁜 글자는 넘지 않음)
            grew = False
            if i > 0 and a[i-1] not in BAD: i -= 1; grew = True
            if j < len(a) and a[j] not in BAD: j += 1; grew = True
            if not grew: break
        if not ok:
            return None
        out.append({"old_str": a[i:j], "new_str": a[i:p] + b[p:k] + a[len(a)-s:j] if j >= len(a)-s else None})
        # 위 new_str: 왼쪽 문맥 a[i:p] + 새 핵심 b[p:k] + 오른쪽 문맥 a[len(a)-s:j]
        if out[-1]["new_str"] is None:
            return None
    return out

for db in sys.argv[3].split(','):
    n, o = cur[db], base[db]
    miss = [k for k in n if k not in o] + [k for k in o if k not in n]
    if miss: print(db, 'UNMATCHED', miss)
    for k in n:
        if k not in o: continue
        dp = {p: v for p, v in n[k]['props'].items() if o[k]['props'].get(p) != v}
        if dp: print(db, k, 'PROPS', json.dumps(dp, ensure_ascii=False))
        if n[k].get('body') is not None and n[k]['body'] != o[k].get('body'):
            e = edits_for(o[k]['body'], n[k]['body'])
            print(db, k, 'BODY', json.dumps(e, ensure_ascii=False) if e is not None else 'FALLBACK')
