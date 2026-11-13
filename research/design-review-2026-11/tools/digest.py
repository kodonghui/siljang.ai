# 재검토 결과 파일의 지적마다 제목·문제(앞부분)·확실도만 짧게 보인다.
# 사용: python3 -I digest.py <review md> [시작 ID] [글자 수]
import re, sys
t = open(sys.argv[1], encoding="utf-8").read()
start = sys.argv[2] if len(sys.argv) > 2 else ""
n = int(sys.argv[3]) if len(sys.argv) > 3 else 450
on = not start
for part in re.split(r"(?m)^(?=### R[A-E]-\d+)", t):
    if not part.startswith("### R"): continue
    head = part.splitlines()[0]
    if start and head.startswith("### " + start): on = True
    if not on: continue
    prob = re.search(r"(?ms)^-\s*\**무엇이 문제인가[^:：\n]*[:：](.*?)(?=^-\s*\**근거)", part)
    conf = re.search(r"(?m)^-\s*\**확실도\**\s*[:：](.*)$", part)
    p = re.sub(r"\s+", " ", prob.group(1)).strip() if prob else "(문제 절 못 찾음)"
    print(head[:150]); print("   문제:", p[:n]); print("   확실도:", (conf.group(1).strip()[:120] if conf else "")); print()
