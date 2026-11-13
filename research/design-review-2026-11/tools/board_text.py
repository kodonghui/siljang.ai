# 목업 보드(.dc.html)의 프레임별 보이는 글을 뽑는다. 프레임 제목(figcaption의 'SCR-xxx#state · 360') 단위로 나눔.
# 사용: python3 -I board_text.py <board dir> <SCR-xxx-360> [state substring]
import re, html, sys
from pathlib import Path
d, name = sys.argv[1], sys.argv[2]; want = sys.argv[3] if len(sys.argv) > 3 else ""
t = Path(d, name + ".dc.html").read_text(encoding="utf-8")
txt = html.unescape(re.sub(r"<script.*?</script>|<style.*?</style>", " ", t, flags=re.S))
txt = re.sub(r"<[^>]+>", "\n", txt)
lines = [l.strip().replace("\xa0", " ") for l in txt.splitlines() if l.strip()]
cur = None; out = {}
for l in lines:
    if re.match(r"SCR-\d{3}#[\w-]+ · ", l):
        cur = l; out[cur] = []; continue
    if cur: out[cur].append(l)
for k, v in out.items():
    if want in k: print(k, "=>", " | ".join(v)[:900])
