import json, re, sys, pathlib
flow_dir = pathlib.Path(sys.argv[1])
out = []
for f in sorted(flow_dir.glob('FL-*.md')):
    text = f.read_text(encoding='utf-8')
    m = re.match(r'---\n(.*?)\n---\n', text, re.S)
    body = text[m.end():] if m else text
    lines = body.split('\n')
    # title
    ti = next(i for i, l in enumerate(lines) if l.startswith('# '))
    title = lines[ti][2:].strip()
    rest = '\n'.join(lines[ti+1:]).strip('\n')
    meta = {}
    for l in rest.split('\n'):
        mm = re.match(r'\| (행위자|컨텍스트|시작|끝|이어지는 흐름) \| (.*) \|$', l)
        if mm:
            meta[mm.group(1)] = mm.group(2)
    reqs = re.search(r'^채우는 요구사항: (.*)$', rest, re.M).group(1)
    gap = rest.split('## 빈 곳 (새 요구사항 후보)')[1]
    cands = re.findall(r'^- (N\d)\b', gap, re.M)
    # notion body: escape ~ outside code fences
    out_lines, in_code = [], False
    for l in rest.split('\n'):
        if l.startswith('```'):
            in_code = not in_code
            out_lines.append(l); continue
        out_lines.append(l if in_code else l.replace('~', '\\~'))
    out.append(dict(file=f.name, id=title.split()[0], title=title, meta=meta,
                    reqs=reqs, nreq=len(reqs.split(', ')), cands=cands,
                    notion_body='\n'.join(out_lines)))
json.dump(out, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
for o in out:
    print(o['id'], '|', o['meta']['행위자'], '|', o['meta']['컨텍스트'], '|', o['nreq'], '|', ','.join(o['cands']) or '없음')
