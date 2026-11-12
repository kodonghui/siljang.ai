import json, re, sys, pathlib
S = pathlib.Path('/tmp/claude-0/-home-user/da899c49-066e-5aef-85e2-3a3c898471d3/scratchpad/notion03')
flows = json.load(open(S/'flows.json', encoding='utf-8'))
readme = pathlib.Path('/home/user/siljang.ai/docs/03-user-flow/README.md').read_text(encoding='utf-8')
esc = lambda s: s.replace('~', '\\~')
def table(section_title):
    sec = readme.split(section_title)[1]
    rows, started = [], False
    for l in sec.split('\n'):
        if l.startswith('| '):
            rows.append(l); started = True
        elif started:
            break
    hdr = [c.strip() for c in rows[0].strip().strip('|').split('|')]
    out = []
    for l in rows[1:]:
        if l.startswith('| ---'): continue
        cells = [c.strip() for c in l.strip().strip('|').split('|')]
        assert len(cells) == len(hdr), l
        out.append(dict(zip(hdr, cells)))
    return out
kind = sys.argv[1]
if kind == 'flows':
    lo, hi = int(sys.argv[2]), int(sys.argv[3])
    pages = []
    for f in flows[lo:hi]:
        m = f['meta']
        pages.append({'properties': {
            '플로우': f['title'], '액터': m['액터'].split(', '),
            '컨텍스트': m['컨텍스트'].split(', '), '시작': esc(m['시작']), '끝': esc(m['끝']),
            '연결 플로우': esc(m['연결 플로우']), '요구사항 수': f['nreq'], '요구사항': f['reqs'],
            '후보': ', '.join(f['cands']) or '없음', '상태': '초안',
            '원본 파일': '`docs/03-user-flow/%s`' % f['file']},
            'content': f['notion_body']})
    print(json.dumps(pages, ensure_ascii=False))
elif kind == 'cands':
    ctx = {'CTX-004': 'CTX-004 결제·환불', 'CTX-008': 'CTX-008 알림', 'CTX-009': 'CTX-009 장부 연결'}
    pages = [{'properties': {'후보': r['후보'], '우선순위': r['우선순위'], '컨텍스트': ctx[r['컨텍스트']],
              '할 일': esc(r['할 일']), '문장': esc(r['문장']), '찾은 플로우': r['찾은 플로우'],
              '사유': esc(r['사유']), '상태': '제안'}} for r in table('## 3. 새 요구사항 후보')]
    print(json.dumps(pages, ensure_ascii=False))
elif kind == 'readings':
    pages = [{'properties': {'번호': r['번호'], '요구사항 해석': esc(r['요구사항 해석']), '근거': esc(r['근거']),
              '플로우': r['플로우'], '04에서 다시 봄': '__YES__' if r['04에서 다시 봄'] == '예' else '__NO__',
              '상태': '제안'}} for r in table('## 4. 요구사항 해석 (Claude 판단)')]
    print(json.dumps(pages, ensure_ascii=False))
