import json, re, sys, glob, os
from collections import OrderedDict
repo = sys.argv[1]
synced = sys.argv[2]
FLOW_DB = 'https://app.notion.com/p/67cd294c32764e5399406187fa021b2e'
RECORD = 'https://app.notion.com/p/415bf16cc3ec8170b22bf7ce04dc315c'
rows = {  # from the Notion SQL query of the flow data source
 'FL-001': '415bf16cc3ec812fa576e42ad37b7f69', 'FL-002': '415bf16cc3ec8199b42ae617459e2192',
 'FL-003': '415bf16cc3ec81099656e689c38f8419', 'FL-004': '415bf16cc3ec8122a9a3ff6c4c5b934b',
 'FL-005': '415bf16cc3ec81e6abb3fa6edd348415', 'FL-006': '415bf16cc3ec81a29309dd1f69e1c6ec',
 'FL-007': '415bf16cc3ec81acba5bf18e12cbe7b6', 'FL-008': '415bf16cc3ec819292ece5773f7e5d5f',
 'FL-009': '415bf16cc3ec81459f12e9633dafd877', 'FL-010': '415bf16cc3ec8125ac0ede95aa369157',
 'FL-011': '415bf16cc3ec81e7be53f8558ac0be48', 'FL-012': '415bf16cc3ec8124b9ddd253c70f1747',
 'FL-013': '415bf16cc3ec812dade8e7408106e0fb', 'FL-014': '415bf16cc3ec81ad9299d3242cc8ac7f'}
d = os.path.join(repo, 'docs/03-user-flow')
meta = {}
for p in sorted(glob.glob(os.path.join(d, 'FL-*.md'))):
    fid = os.path.basename(p)[:6]
    t = open(p, encoding='utf-8').read()
    assert t.startswith('---\nstatus: 초안\n---\n'), p
    if 'notion:' not in t.split('---')[1]:
        t = t.replace('---\nstatus: 초안\n---\n', '---\nstatus: 초안\nnotion: https://app.notion.com/p/%s\n---\n' % rows[fid], 1)
        open(p, 'w', encoding='utf-8').write(t)
    m = {}
    for l in t.splitlines():
        mm = re.match(r'^\| (행위자|컨텍스트) \| (.*) \|$', l)
        if mm:
            m[mm.group(1)] = mm.group(2)
    meta[fid] = m
print('flow files linked:', len(meta))
rp = os.path.join(d, 'README.md')
t = open(rp, encoding='utf-8').read()
if not t.startswith('---\n'):
    t = '---\nnotion: %s\nsynced_at: %s\n---\n\n' % (FLOW_DB, synced) + t
old_intro = '사람이 보고 댓글을 다는 곳은 Notion의 흐름 표(한 줄에 흐름 하나, 줄마다 같은 그림)이고, 둘이 다르면 이 폴더가 맞습니다.'
new_intro = ('사람이 보고 댓글을 다는 곳은 Notion의 [흐름 표](%s)(한 줄에 흐름 하나, 줄마다 같은 그림)이고, 둘이 다르면 이 폴더가 맞습니다. '
             '흐름 파일마다 맨 위 `notion`에 그 줄의 주소를 적었고, 이 폴더를 그 표에 옮겨 대조한 시각을 이 파일 맨 위 `synced_at`에 적습니다. '
             '흐름 표와 새 요구사항 후보 표, 읽은 방식 표는 최근 업데이트 DB의 [03단계 기록 페이지](%s) 안에 있습니다.') % (FLOW_DB, RECORD)
if old_intro in t:
    t = t.replace(old_intro, new_intro, 1)
out, changed = [], 0
for l in t.split('\n'):
    mm = re.match(r'^\| \[(FL-\d{3})\]\(', l)
    if mm:
        cells = l.strip().strip('|').split('|')
        cells = [c.strip() for c in cells]
        assert len(cells) == 8, l
        fid = mm.group(1)
        actors = meta[fid]['행위자']
        ctx = ', '.join(re.findall(r'CTX-\d{3}', meta[fid]['컨텍스트']))
        if (cells[2], cells[3]) != (actors, ctx):
            changed += 1
        cells[2], cells[3] = actors, ctx
        l = '| ' + ' | '.join(cells) + ' |'
    out.append(l)
t = '\n'.join(out)
print('flow list rows changed:', changed)
hub_row = [l for l in t.split('\n') if l.startswith('| 허브 |')]
assert len(hub_row) == 1
notion_row = ('| Notion 표 | 흐름 14줄, 후보 7줄, 읽은 방식 22줄. 흐름 줄에 넣은 내용이 파일과 글자 단위로 같음(넣은 값을 기계로 대조). '
              '저장된 내용은 FL-001·FL-007을 다시 읽어 같음을 봄. 넣다가 생긴 오타 한 곳(FL-007)은 고침 |')
if '| Notion 표 |' not in t:
    t = t.replace(hub_row[0], hub_row[0] + '\n' + notion_row, 1)
open(rp, 'w', encoding='utf-8').write(t)
pj = os.path.join(repo, '.corthex/project.json')
j = json.load(open(pj, encoding='utf-8'), object_pairs_hook=OrderedDict)
e = j['stages']['03-user-flow']
ne = OrderedDict()
for k in ('human', 'link', 'source', 'truth', 'note'):
    if k == 'link':
        ne['link'] = FLOW_DB
    elif k in e:
        ne[k] = e[k]
extra = ' 흐름 표와 새 요구사항 후보 표(https://app.notion.com/p/df79c1494a954b5c9d8b7bbd9df27bc3), 읽은 방식 표(https://app.notion.com/p/0b281fc982aa445b88f02ce184dd5ba2)는 최근 업데이트 DB의 03단계 기록 행(%s) 안에 있습니다.' % RECORD
if RECORD not in ne['note']:
    ne['note'] = ne['note'] + extra
j['stages']['03-user-flow'] = ne
open(pj, 'w', encoding='utf-8').write(json.dumps(j, ensure_ascii=False, indent=2) + '\n')
print('project.json updated')
