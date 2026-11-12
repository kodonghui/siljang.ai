"""Checks for docs/02-prd/requirements.md (CORTHEX stage 02 checks, Korean EARS)."""
import re
import sys
from collections import Counter

path = sys.argv[1]
domain = sys.argv[2]
text = open(path, encoding="utf-8").read()
dom = open(domain, encoding="utf-8").read()

problems = []
notes = []

# --- REQ rows -----------------------------------------------------------
# Requirement rows are the rows of tables whose header starts with "| ID | 요구사항".
# Other tables that name REQ IDs (such as the 2nd-edition summary in section 8) are skipped.
HEADER = ["ID", "요구사항", "형태", "유형", "우선순위", "컨텍스트", "출처", "상태"]
rows = []
in_req_table = False
for n, line in enumerate(text.splitlines(), 1):
    if line.startswith("| ID | 요구사항"):
        in_req_table = True
        continue
    if not line.startswith("|"):
        in_req_table = False
        continue
    if in_req_table and line.startswith("| REQ-"):
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        rows.append((n, cells))
headers = [l for l in text.splitlines() if l.startswith("| ID | 요구사항")]
for h in headers:
    cells = [c.strip() for c in h.strip().strip("|").split("|")]
    if cells != HEADER:
        problems.append("header differs: %s" % cells)

ids = [c[0] for _, c in rows]
expected = ["REQ-%03d" % i for i in range(1, len(ids) + 1)]
dup = [k for k, v in Counter(ids).items() if v > 1]
if dup:
    problems.append("duplicate IDs: %s" % dup)
# From the 2nd edition on, new rows sit in their context's section, so the file order
# is not the number order: check that the numbers run 1..N with no gap instead.
if sorted(ids) != expected:
    problems.append("IDs do not run REQ-001..REQ-%03d without gaps" % len(ids))

SHAPES = {"항상", "사건", "상태", "예외", "선택 기능"}
TYPES = {"기능", "비기능"}
PRIOS = {"필수", "권장", "선택"}
STATUS = re.compile(r"(초안|확정|제외)(\(.+\))?")  # e.g. 확정(2판), 제외(2판, REQ-153로 바꿈)
counts = Counter()
for n, c in rows:
    rid = c[0]
    if len(c) != 8:
        problems.append("%s: %d cells" % (rid, len(c)))
        continue
    _, req, shape, typ, prio, ctx, src, status = c
    for name, val in zip(HEADER, c):
        if not val:
            problems.append("%s: empty %s" % (rid, name))
    if req.count("야 한다") != 1:
        problems.append("%s: '야 한다' x%d" % (rid, req.count("야 한다")))
    if not req.endswith("."):
        problems.append("%s: no final period" % rid)
    if shape not in SHAPES:
        problems.append("%s: unknown shape %s" % (rid, shape))
    if typ not in TYPES:
        problems.append("%s: unknown type %s" % (rid, typ))
    if prio not in PRIOS:
        problems.append("%s: unknown priority %s" % (rid, prio))
    if not STATUS.fullmatch(status):
        problems.append("%s: status %s" % (rid, status))
    counts["status " + status] += 1
    if not re.fullmatch(r"CTX-00[1-9](, CTX-00[1-9])*", ctx):
        problems.append("%s: context %s" % (rid, ctx))
    # shape patterns
    ok = {
        "항상": req.startswith("시스템은 ") or req.startswith("시스템의 "),
        "사건": ("면, 시스템은 " in req) and not req.startswith("만약"),
        "상태": "동안, 시스템은 " in req and not req.startswith("만약"),
        "예외": req.startswith("만약 ") and ", 시스템은 " in req,
        "선택 기능": "가게에서는, 시스템은 " in req,
    }.get(shape, False)
    if not ok:
        problems.append("%s: text does not match shape %s" % (rid, shape))
    if req.count("시스템은") + req.count("시스템의") != 1:
        problems.append("%s: subject '시스템' x%d" % (rid, req.count("시스템은") + req.count("시스템의")))
    counts[(typ, prio)] += 1
    counts[shape] += 1
    # non-functional: measurable
    if typ == "비기능":
        if not any(k in req for k in ("잼", "시험", "확인", "검사", "점검", "평가 세트", "기록으로")):
            problems.append("%s: non-functional without how it is measured" % rid)
        if re.search(r"P9\d", req):
            for k, label in (("동시", "load"), ("서버", "place")):
                if k not in req:
                    problems.append("%s: performance target without %s" % (rid, label))
        elif any(k in req for k in ("초 안", "분 안")):
            problems.append("%s: time target without percentile" % rid)

# --- referenced REQ IDs exist ---------------------------------------------
maxid = max([int(i[4:]) for i in ids if re.fullmatch(r"REQ-\d{3}", i)] or [0])
for m in re.finditer(r"REQ-(\d{3})", text):
    if int(m.group(1)) > maxid or int(m.group(1)) == 0:
        problems.append("reference to missing %s" % m.group(0))
for m in re.finditer(r"CTX-(\d{3})", text):
    if not 1 <= int(m.group(1)) <= 9:
        problems.append("reference to missing %s" % m.group(0))
terms = set(re.findall(r"^\| (TERM-\d{3}) \|", dom, re.M))
for m in re.finditer(r"TERM-(\d{3})", text):
    if m.group(0) not in terms:
        problems.append("reference to missing %s" % m.group(0))

# --- glossary: avoided words in the requirement column --------------------
avoid = []
for line in dom.splitlines():
    if line.startswith("| TERM-0"):
        c = [x.strip() for x in line.strip().strip("|").split("|")]
        term, words = c[1], c[5]
        for w in re.split(r",\s*", words):
            w = re.sub(r"\(.*?\)", "", w).strip()
            if w and w != "없음":
                avoid.append((w, c[0], term))
# allowed uses (checked by hand, explained in the report)
ALLOW = {
    "예약": [r"예약 링크"],          # TERM-042 / TERM-056 contain 예약
    "시스템": [r"^시스템[은의] ", r", 시스템[은의] "],  # EARS subject, see 0-4
    "확정": [r"주문[이을]? ?확정", r"확정[된되]", r"확정하면", r"확정 안내", r"확정·부터·범위", r"확정해야", r"확정하지", r"확정되었다", r"확정되어"],
    "시트": [r"구글 시트"],
    "입금": [r"입금했다고", r"입금 대조", r"들어온 입금"],
    "메시지": [r"(손님|카카오|마지막|새) ?메시지", r"메시지 속", r"메시지를 받은"],
    "거래": [r"한 거래 후보"],
    "주문서": [r"주문서 초안"],
    "정책": [],
    "자동": [],
}
hits = []
for n, c in rows:
    req = c[1]
    for w, tid, term in avoid:
        if len(w) < 2:
            continue
        for m in re.finditer(re.escape(w), req):
            ctxt = req[max(0, m.start() - 8): m.end() + 8]
            allowed = any(re.search(a, req[max(0, m.start() - 12): m.end() + 12]) for a in ALLOW.get(w, []))
            if allowed:
                notes.append("%s: '%s' (피할 말 of %s %s) allowed use: …%s…" % (c[0], w, tid, term, ctxt))
            else:
                hits.append("%s: '%s' (피할 말 of %s %s): …%s…" % (c[0], w, tid, term, ctxt))
# words outside the glossary that 01 merged away
for w in ("입금 확인", "예약 확정", "결제 완료", "노쇼", "클레임", "위약금", "에스크로", "홀드", "챗봇", "고객", "관리자", "승인", "리뷰", "배송", "배달", "판매자"):
    for n, c in rows:
        if w in c[1]:
            hits.append("%s: '%s' in requirement" % (c[0], w))
hits = sorted(set(hits))

print("REQ rows:", len(rows))
print("glossary terms in domain:", len(terms), min(terms), "~", max(terms))
print("by shape:", {k: v for k, v in counts.items() if isinstance(k, str) and not k.startswith("status ")})
print("by status:", {k[7:]: v for k, v in counts.items() if isinstance(k, str) and k.startswith("status ")})
tp = Counter()
for (t, p), v in [(k, v) for k, v in counts.items() if isinstance(k, tuple)]:
    tp[t] += v
print("by type:", dict(tp))
pr = Counter()
for (t, p), v in [(k, v) for k, v in counts.items() if isinstance(k, tuple)]:
    pr[p] += v
print("by priority:", dict(pr))
live = [c for n, c in rows if len(c) == 8 and not c[7].startswith("제외")]
print("live (not 제외) %d: shape %s, type %s, priority %s" % (
    len(live), dict(Counter(c[2] for c in live)), dict(Counter(c[3] for c in live)), dict(Counter(c[4] for c in live))))
src_kinds = Counter()
for n, c in rows:
    if len(c) != 8:
        continue
    s = c[6]
    for k in ("동희님", "01단계", "Claude 추천", "Claude 기본값", "Claude 추가"):
        if k in s:
            src_kinds[k] += 1
    if re.search(r"법|시행령|원문|보도자료|공지|문서|기록", s):
        src_kinds["법·원문·기록"] += 1
print("sources (a row can count in several):", dict(src_kinds))
claude_only = [c[0] for n, c in rows if len(c) == 8 and re.search(r"Claude (추천|기본값|추가)", c[6]) and not re.search(r"동희님|01단계|법|시행령|원문|공지|보도자료|기록|문서|사례|분석|원칙", c[6])]
print("rows whose only source is a Claude recommendation/default/addition (%d): %s" % (len(claude_only), ", ".join(claude_only)))
print("PROBLEMS (%d)" % len(problems))
for p in problems:
    print("  -", p)
print("AVOIDED WORDS (%d)" % len(hits))
for h in hits:
    print("  -", h)
print("ALLOWED USES (%d)" % len(notes))
for x in sorted(set(notes)):
    print("  -", x)
