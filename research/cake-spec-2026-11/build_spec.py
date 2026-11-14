"""04단계 SPEC 표를 만들고 검사한다.

python3 -I build_spec.py <repo> [--write]
  <repo>/docs/02-prd/requirements.md, <repo>/docs/03-user-flow/, <repo>/docs/04-functional-spec/spec.md 를 읽음
  --write 이면 spec.md 의 '<!-- SPEC-TABLE -->' 와 '<!-- /SPEC-TABLE -->' 사이, '<!-- REQ-MAP -->' 사이를 새로 씀
  수락 기준 끝의 ' (확인: REQ-…)'는 그 기준이 직접 확인하는 요구사항(그 행의 요구사항 가운데서).
  우선순위 필수이고 확정인 요구사항마다 확인하는 수락 기준이 있어야 함. 없이 두는 것은
  spec.md 의 '<!-- AC-EXEMPT -->' 표에 이유와 함께 둠
"""
import os, re, sys, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("spec_rows", os.path.join(HERE, "spec_rows.py"))
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
ROWS = mod.ROWS

KINDS = ["접근", "입력", "대상", "상태", "반복", "동시", "한도", "외부", "노출", "빈·끊김", "화면", "AI"]
repo = sys.argv[1]
write = "--write" in sys.argv

# 요구사항
reqs = {}
for line in open(os.path.join(repo, "docs/02-prd/requirements.md"), encoding="utf-8"):
    if line.startswith("| REQ-"):
        c = [x.strip() for x in line.strip().strip("|").split("|")]
        if len(c) >= 8:
            reqs[c[0]] = dict(text=c[1], form=c[2], kind=c[3], prio=c[4], status=c[7])
flows = {m.group(1) for f in os.listdir(os.path.join(repo, "docs/03-user-flow"))
         for m in [re.match(r"(FL-\d{3})", f)] if m}
errors, warns = [], []
TAG = re.compile(r" \(확인: (REQ-\d{3}(?:, REQ-\d{3})*)\)$")
OLD_TAG = re.compile(r"\(REQ-\d{3}(?:, REQ-\d{3})*\)$")
spec_md = open(os.path.join(repo, "docs/04-functional-spec/spec.md"), encoding="utf-8").read()
exempt = {}
m = re.search(r"<!-- AC-EXEMPT -->\n(.*?)<!-- /AC-EXEMPT -->", spec_md, flags=re.S)
if not m: errors.append("spec.md에 '수락 기준 없이 두는 필수 요구사항' 표(<!-- AC-EXEMPT -->)가 없음")
else:
    for line in m.group(1).splitlines():
        if line.startswith("| REQ-"):
            c = [x.strip() for x in line.strip().strip("|").split("|")]
            exempt[c[0]] = c[1] if len(c) > 1 else ""

def ids(s, pre):
    return re.findall(pre + r"-\d{3}", s)

seen = set()
cover = {}
checked = {}
spec_ids = [r["id"] for r in ROWS]
for i, r in enumerate(ROWS, 1):
    sid = r["id"]
    if sid != f"SPEC-{i:03d}": errors.append(f"{sid}: 번호 순서가 {i:03d}이 아님")
    if sid in seen: errors.append(f"{sid}: 중복됨")
    seen.add(sid)
    rq = ids(r["req"], "REQ")
    if not rq: errors.append(f"{sid}: REQ 없음")
    for q in rq:
        if q not in reqs: errors.append(f"{sid}: 없는 {q}")
        elif reqs[q]["status"].startswith("제외"): errors.append(f"{sid}: 제외된 {q}")
        cover.setdefault(q, []).append(sid)
    for f in ids(r["fl"], "FL"):
        if f not in flows: errors.append(f"{sid}: 없는 {f}")
    if not ids(r["fl"], "FL"): errors.append(f"{sid}: FL 없음")
    if not r["exc"]: errors.append(f"{sid}: 예외 없음")
    for e in r["exc"]:
        tags = re.findall(r"\[([^\]]+)\]", e.split(" ")[0] + " " + " ".join(e.split(" ")[1:3]))
        lead = re.match(r"^((?:\[[^\]]+\]\s*)+)", e)
        if not lead: errors.append(f"{sid}: 종류 표시 없는 예외: {e[:30]}")
        else:
            for t in re.findall(r"\[([^\]]+)\]", lead.group(1)):
                if t not in KINDS: errors.append(f"{sid}: 모르는 종류 {t}")
    if not r["ac"]: errors.append(f"{sid}: 수락 기준 없음")
    for n, a in enumerate(r["ac"], 1):
        if not (a.startswith("Given ") and ", When " in a and ", Then " in a):
            errors.append(f"{sid}: Given/When/Then 형식 아님: {a[:40]}")
        t = TAG.search(a)
        rest = a[:t.start()] if t else a
        if "(확인" in rest or OLD_TAG.search(rest):
            errors.append(f"{sid} #{n}: 꼬리표는 줄 끝에 하나, 꼴은 ' (확인: REQ-…)'")
        if t:
            got = t.group(1).split(", ")
            if len(set(got)) != len(got): errors.append(f"{sid} #{n}: 꼬리표에 같은 요구사항이 두 번")
            for q in got:
                if q not in rq: errors.append(f"{sid} #{n}: 꼬리표의 {q}가 이 행의 요구사항에 없음")
                else: checked.setdefault(q, []).append(f"{sid} #{n}")
    # 본문의 SPEC·G 참조
    body = " ".join([r["main"], r["pre"]] + r["exc"])
    for s in ids(body, "SPEC"):
        if s not in spec_ids: errors.append(f"{sid}: 없는 {s} 참조")
    for g in re.findall(r"G(\d+)", body):
        if not 1 <= int(g) <= 9: errors.append(f"{sid}: 없는 G{g}")
    if r["ai"] and r["ai"] != "AI-1": errors.append(f"{sid}: 없는 AI 항목 {r['ai']}")

live = {k: v for k, v in reqs.items() if not v["status"].startswith("제외")}
func = {k: v for k, v in live.items() if v["kind"].startswith("기능")}
must_func = {k for k, v in func.items() if v["prio"] == "필수"}
miss_must = sorted(must_func - set(cover))
miss_func = sorted(set(func) - set(cover))
nonfunc_in = sorted(q for q in cover if live.get(q, {}).get("kind", "").startswith("비기"))
if miss_must: errors.append("SPEC 없는 기능 필수 요구사항: " + ", ".join(miss_must))
must = {k for k, v in live.items() if v["prio"] == "필수" and v["status"].startswith("확정")}
for q, why in exempt.items():
    if q not in must: errors.append(f"수락 기준 없이 두는 표의 {q}: 확정인 필수 요구사항이 아님")
    elif q in checked: errors.append(f"수락 기준 없이 두는 표의 {q}: 확인하는 수락 기준({', '.join(checked[q])})이 있으니 표에서 뺌")
    if not why: errors.append(f"수락 기준 없이 두는 표의 {q}: 이유 없음")
miss_ac = sorted(must - set(checked) - set(exempt))
if miss_ac: errors.append("확인하는 수락 기준이 없는 필수 요구사항: " + ", ".join(miss_ac))

print(f"SPEC 행 {len(ROWS)}개, AI 호출이 있는 행 {sum(1 for r in ROWS if r['ai'])}개")
print(f"기능 요구사항 {len(func)}개 가운데 SPEC 있음 {len(func) - len(miss_func)}개; 없는 것 {miss_func}")
print(f"기능 필수 {len(must_func)}개 가운데 SPEC 있음 {len(must_func) - len(miss_must)}개")
print(f"SPEC이 연결한 비기능 요구사항 {len(nonfunc_in)}개: {nonfunc_in}")
n_ac = sum(len(r["ac"]) for r in ROWS)
n_tag = sum(1 for r in ROWS for a in r["ac"] if TAG.search(a))
print(f"필수 요구사항 {len(must)}개 가운데 확인하는 수락 기준 있음 {len(must & set(checked))}개, "
      f"수락 기준 없이 둠 {len(must & set(exempt))}개 {sorted(must & set(exempt))}, 없는 것 {miss_ac}")
print(f"수락 기준 {n_ac}개 가운데 확인 꼬리표가 있는 것 {n_tag}개, 꼬리표가 가리킨 요구사항 {len(checked)}개")
kind_count = {k: 0 for k in KINDS}
for r in ROWS:
    for e in r["exc"]:
        lead = re.match(r"^((?:\[[^\]]+\]\s*)+)", e)
        if lead:
            for t in re.findall(r"\[([^\]]+)\]", lead.group(1)):
                if t in kind_count: kind_count[t] += 1
print("예외 종류별 수:", kind_count)
for e in errors: print("오류:", e)
print("오류", len(errors))

def cell(s): return s.replace("|", "\\|").replace("\n", " ")

if write:
    path = os.path.join(repo, "docs/04-functional-spec/spec.md")
    text = open(path, encoding="utf-8").read()
    lines = ["| ID | 동작 | 출처 | 전제 | 주 동작 | 예외 | 수락 기준 | AI | 상태 |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for r in ROWS:
        src = r["req"] + "; " + r["fl"]
        exc = "<br/>".join(cell(e) for e in r["exc"])
        ac = "<br/>".join(cell(a) for a in r["ac"])
        lines.append(f"| {r['id']} | {cell(r['name'])} | {cell(src)} | {cell(r['pre'])} | {cell(r['main'])} | {exc} | {ac} | {r['ai'] or ''} | {r['status']} |")
    table = "\n".join(lines)
    text = re.sub(r"(<!-- SPEC-TABLE -->\n).*?(<!-- /SPEC-TABLE -->)", lambda m: m.group(1) + table + "\n" + m.group(2), text, flags=re.S)
    mlines = ["| 요구사항 | 우선순위 | 유형 | SPEC | 수락 기준 |", "| --- | --- | --- | --- | --- |"]
    for q in sorted(live):
        v = live[q]
        s = ", ".join(cover.get(q, [])) or ("12단계 QA에서 잼" if v["kind"].startswith("비기") else "없음")
        a = ", ".join(checked.get(q, [])) or ("수락 기준 없이 둠(위 표)" if q in exempt else "없음")
        mlines.append(f"| {q} | {v['prio']} | {v['kind']} | {s} | {a} |")
    text = re.sub(r"(<!-- REQ-MAP -->\n).*?(<!-- /REQ-MAP -->)", lambda m: m.group(1) + "\n".join(mlines) + "\n" + m.group(2), text, flags=re.S)
    open(path, "w", encoding="utf-8").write(text)
    print("spec.md 표를 새로 씀")
sys.exit(1 if errors else 0)
