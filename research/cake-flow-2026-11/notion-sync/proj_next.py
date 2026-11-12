import json, glob
# find the latest rows-mode result for the project DB in the transcript
val = None
for p in sorted(glob.glob('/root/.claude/projects/-home-user/*.jsonl')):
    for line in open(p):
        try: o = json.loads(line)
        except Exception: continue
        c = (o.get('message') or {}).get('content')
        if not isinstance(c, list): continue
        for b in c:
            if b.get('type') == 'tool_result':
                t = b.get('content')
                if isinstance(t, list):
                    t = ''.join(x.get('text', '') for x in t if isinstance(x, dict))
                if t and '"다음 행동"' in t and '\\\\~009' in t and '"mode"' not in t:
                    try:
                        r = json.loads(t)['results'][0]
                        val = r['다음 행동']
                    except Exception:
                        pass
assert val, 'not found'
old = val
a = '동희님: PoC 가게 후보를'
b = ('동희님: 03단계(사용자 흐름) 확인 지점에 답하기(흐름 14개와 새 요구사항 후보 7개를 추천대로 정할지, 이 작업 대화의 결정 카드와 '
     "최근 업데이트 '수제케이크 03 사용자 흐름' 행), PoC 가게 후보를")
c = '다음은 03단계(사용자 흐름).'
d = ('03단계(사용자 흐름)는 11/11 23:25에 초안을 쓰고 확인 지점을 여쭙는 중: 흐름 14개(FL-001\\~014)를 그리고 걸음마다 요구사항을 이음'
     '(필수 107개 가운데 106개, 흐름 밖 다섯 개는 서비스 전체 기준), 1판의 빈 곳 7개(새 요구사항 후보 N1\\~N7, 필수 4)와 Claude 판단 22개를 함께 여쭘, '
     '원본은 `siljang.ai` 초안 PR #3.')
assert old.count(a) == 1 and old.count(c) == 1
new = old.replace(a, b).replace(c, d).replace('<code>siljang.ai</code>', '`siljang.ai`')
open('proj_next_expected.txt', 'w').write(new)
print(json.dumps(new, ensure_ascii=False))
