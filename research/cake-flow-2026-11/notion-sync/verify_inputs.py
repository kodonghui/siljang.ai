"""Compare the Notion create-pages inputs recorded in the session transcript
with the flow files (flows.json), so that hand-copied row content is checked
mechanically."""
import json, sys, difflib, glob, os
HERE = os.path.dirname(os.path.abspath(__file__))
fl = {f['id']: f for f in json.load(open(os.path.join(HERE, 'flows.json')))}
DS = '8adbbe2d-640f-49cd-a96c-3ddd880cb267'
seen = {}
for p in sorted(glob.glob('/root/.claude/projects/-home-user/*.jsonl')):
    with open(p) as f:
        for line in f:
            try:
                o = json.loads(line)
            except Exception:
                continue
            m = o.get('message') or {}
            c = m.get('content')
            if not isinstance(c, list):
                continue
            for b in c:
                if b.get('type') == 'tool_use' and b.get('name') == 'mcp__Notion__notion-create-pages':
                    inp = b.get('input') or {}
                    if (inp.get('parent') or {}).get('data_source_id') != DS:
                        continue
                    for pg in inp.get('pages', []):
                        t = pg['properties']['플로우']
                        seen[t.split()[0]] = pg
ok = True
for fid in sorted(fl):
    f = fl[fid]
    if fid not in seen:
        print(fid, 'NOT CREATED YET')
        continue
    pg = seen[fid]
    pr = pg['properties']
    exp = {
        '플로우': f['title'],
        '액터': [x.strip() for x in f['meta']['액터'].split(',')],
        '컨텍스트': [x.strip() for x in f['meta']['컨텍스트'].split(',')],
        '시작': f['meta']['시작'], '끝': f['meta']['끝'],
        '연결 플로우': f['meta']['연결 플로우'],
        '요구사항 수': f['nreq'], '요구사항': f['reqs'] if isinstance(f['reqs'], str) else ', '.join(f['reqs']),
        '후보': ', '.join(f['cands']) if f['cands'] else '없음',
        '상태': '초안', '원본 파일': '`docs/03-user-flow/%s`' % f['file'],
    }
    bad = [k for k in exp if pr.get(k) != exp[k]]
    extra = [k for k in pr if k not in exp]
    body_same = pg.get('content', '') == f['notion_body']
    print(fid, 'props', 'OK' if not bad and not extra else 'DIFF %s extra %s' % (bad, extra), '| body', 'OK' if body_same else 'DIFF')
    for k in bad:
        print('   ', k, 'got', repr(pr.get(k)), 'want', repr(exp[k]))
    if not body_same:
        ok = False
        for l in difflib.unified_diff(f['notion_body'].splitlines(), pg.get('content', '').splitlines(), 'source', 'notion-input', lineterm='', n=1):
            print('   ', l)
    if bad or extra:
        ok = False
print('ALL OK' if ok else 'SOME DIFF')
