"""Compare page content that Notion returned on fetch (read from the session
transcript) with the flow files, so the stored rows are checked mechanically."""
import json, glob, os, re, difflib
HERE = os.path.dirname(os.path.abspath(__file__))
fl = {f['id']: f for f in json.load(open(os.path.join(HERE, 'flows.json')))}
uses, results = {}, {}
for p in sorted(glob.glob('/root/.claude/projects/-home-user/*.jsonl')):
    for line in open(p):
        try:
            o = json.loads(line)
        except Exception:
            continue
        c = (o.get('message') or {}).get('content')
        if not isinstance(c, list):
            continue
        for b in c:
            if b.get('type') == 'tool_use' and b.get('name') == 'mcp__Notion__notion-fetch':
                uses[b['id']] = b['input'].get('id')
            elif b.get('type') == 'tool_result':
                t = b.get('content')
                if isinstance(t, list):
                    t = ''.join(x.get('text', '') for x in t if isinstance(x, dict))
                results[b.get('tool_use_id')] = t
latest = {}
for uid, pid in uses.items():
    t = results.get(uid)
    if not t:
        continue
    try:
        txt = json.loads(t)['text']
    except Exception:
        txt = t
    m = re.search(r'"플로우":"(FL-\d{3})', txt)
    c = re.search(r'<content>\n(.*)\n</content>', txt, re.S)
    if m and c:
        latest[m.group(1)] = c.group(1)
for fid in sorted(fl):
    if fid not in latest:
        print(fid, 'not fetched')
        continue
    got, want = latest[fid], fl[fid]['notion_body']
    print(fid, 'stored content', 'SAME as source' if got == want else 'DIFF')
    if got != want:
        for l in difflib.unified_diff(want.splitlines(), got.splitlines(), 'source', 'notion', lineterm='', n=0):
            print('   ', l)
