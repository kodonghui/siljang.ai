#!/usr/bin/env python3
"""10단계 WBS: wbs_rows.py(원본)에서 docs/10-wbs/wbs.md와 README 생성 절(counts·inputs·iterations·before-dev·checks)을
만들고 검사한다.

사용: python3 -I research/cake-wbs-2026-11/build_wbs.py <저장소> [--write]
  --write 없이: 검사하고, 생성 파일이 원본과 같은지 본다(다르면 오류).
  --write: 생성 파일을 다시 쓰고 검사한다.
마지막 줄은 '검사 n개 · 오류 m'. 오류가 있으면 종료 코드 1.

입력(읽기만): 04 spec_rows.py, 02 requirements.md, 04 spec.md(G 규칙), 05 schema.sql·README(A 규칙)·erd_map.py,
06 api_ops.py·api_catalog.py·openapi.yaml, 07 sitemap.yaml, 08 screens_*.py·SCR-*.md, 09 gen_screens.py(그리는 상태), 01 domain.md(금지어).
끝난 조건 가운데 응답 코드·스킬 결과·수락 기준·화면 상태·응답 행·앱 규칙 줄은 여기서 만든다(손으로 쓰지 않음).
"""
import importlib.util
import pathlib
import re
import sys
from collections import OrderedDict, defaultdict

import yaml

REPO = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
WRITE = "--write" in sys.argv
HERE = REPO / "research/cake-wbs-2026-11"
OUT = REPO / "docs/10-wbs/wbs.md"
README = REPO / "docs/10-wbs/README.md"
for d in ("cake-spec-2026-11", "cake-api-2026-11", "cake-screens-2026-11", "cake-erd-2026-11"):
    sys.path.insert(0, str(REPO / "research" / d))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


W = load("wbs_rows", HERE / "wbs_rows.py")
spec_rows = load("spec_rows", REPO / "research/cake-spec-2026-11/spec_rows.py")
import api_catalog  # noqa: E402
import api_ops  # noqa: E402
import erd_map  # noqa: E402
import screens_common as C  # noqa: E402
import build_screens  # noqa: E402,F401  (screens_*.py를 읽어 C.SCREENS를 채움)
from check_screens import OLD_TERMS  # noqa: E402  (옛 용어 → 새 용어, 08·09 검사와 같은 목록)

OWNERS = ("동희님", "Claude")
SIZES = (0.5, 1, 2, 3)
ITER = OrderedDict(W.ITERATIONS)
problems = []
checks = []


def check(name):
    checks.append(name)


def fmt_size(x):
    return ("%g" % x)


def ranges(nums):
    nums = sorted(set(nums))
    out, i = [], 0
    while i < len(nums):
        j = i
        while j + 1 < len(nums) and nums[j + 1] == nums[j] + 1:
            j += 1
        out.append("#%d" % nums[i] if i == j else "#%d~#%d" % (nums[i], nums[j]))
        i = j + 1
    return "·".join(out)


# ── 입력 ─────────────────────────────────────────────────────────────
SPECS = OrderedDict((r["id"], r) for r in spec_rows.ROWS)
AC_N = {sid: (len(r["ac"]) if isinstance(r["ac"], list) else len([x for x in r["ac"].split("<br/>") if x.strip()]))
        for sid, r in SPECS.items()}
FLOWS = sorted({m.group(0) for f in (REPO / "docs/03-user-flow").glob("FL-*.md") for m in [re.match(r"FL-\d{3}", f.name)] if m})

REQS = {}
for line in (REPO / "docs/02-prd/requirements.md").read_text(encoding="utf-8").splitlines():
    if not re.match(r"^\| REQ-\d{3} \|", line):
        continue
    c = [x.strip() for x in line.strip().strip("|").split("|")]
    if len(c) >= 8:
        REQS[c[0]] = {"prio": c[4], "excluded": c[7].startswith("제외"), "kind": c[3]}
REQ_IN_SPEC = set()
for r in SPECS.values():
    REQ_IN_SPEC |= set(re.findall(r"REQ-\d{3}", r["req"]))
REQ_OUTSIDE = sorted(k for k, v in REQS.items() if not v["excluded"] and k not in REQ_IN_SPEC)

spec_md = (REPO / "docs/04-functional-spec/spec.md").read_text(encoding="utf-8")
GRULES = re.findall(r"^\| (G\d) \|", spec_md, re.M)

TBL, TBL_NAME = {}, {}
for line in (REPO / "db/schema.sql").read_text(encoding="utf-8").splitlines():
    m = re.match(r"^-- (TBL-\d{3}) (\w+) ", line)
    if m:
        TBL[m.group(2)] = m.group(1)
        TBL_NAME[m.group(1)] = m.group(2)
SPEC_TBL = {}
for sid, pairs in erd_map.MAP.items():
    SPEC_TBL[sid] = sorted({TBL[c.split(".")[0]] for _, c in pairs if "." in c and c.split(".")[0] in TBL})

ARULES = OrderedDict()
for line in (REPO / "docs/05-erd/README.md").read_text(encoding="utf-8").splitlines():
    m = re.match(r"^\| (A\d+) \| ([^|]+) \|", line)
    if m:
        ARULES[m.group(1)] = m.group(2).strip()

doc = yaml.safe_load((REPO / "api/openapi.yaml").read_text(encoding="utf-8"))
API_RESP = {}
for _p, ops in doc["paths"].items():
    for _m, o in ops.items():
        if isinstance(o, dict) and "x-corthex" in o:
            API_RESP[o["x-corthex"]["id"]] = list(o["responses"].keys())
API = OrderedDict((o["id"], o) for o in sorted(api_ops.OPS, key=lambda o: o["id"]))
SKILL_LISTS = {"API-070": api_ops.MESSAGE_OUTCOMES, "API-071": api_ops.CARD_OUTCOMES,
               "API-072": api_ops.REVIEW_OUTCOMES, "API-073": api_ops.EVENT_OUTCOMES}
OUTCOME_SPEC = {k: re.findall(r"SPEC-\d{3}", v["spec"])[0] for k, v in api_catalog.SKILL_OUTCOMES.items()}
OPEN = OrderedDict((q["id"], q) for q in api_catalog.OPEN_QUESTIONS)
DECS = {d["id"] for d in api_catalog.DECISIONS}

SCR = OrderedDict()


def walk(n):
    SCR[n["id"]] = n
    for ch in n.get("children") or []:
        walk(ch)


for top in yaml.safe_load((REPO / "docs/07-sitemap/sitemap.yaml").read_text(encoding="utf-8")):
    walk(top)
SCR = OrderedDict(sorted(SCR.items()))
gen_src = (REPO / "research/cake-mockup-2026-11/gen_screens.py").read_text(encoding="utf-8")
KEY_STATES = re.findall(r'"([a-z-]+)"', re.search(r"KEY_STATES = \((.*?)\)", gen_src, re.S).group(1))
STATES, DRAWN, RESP_ROWS, RESP_TEXT = {}, {}, {}, {}
for sid, s in C.SCREENS.items():
    names = [st[0] for st in s["states"]]
    if "normal" not in names:
        names = ["normal"] + names
    STATES[sid] = names
    DRAWN[sid] = ["normal"] + [st[0] for st in s["states"]
                               if st[0] in KEY_STATES and len(st) > 2 and st[2] is not None and st[0] != "normal"]
    md = (REPO / "docs/08-screens" / (sid + ".md")).read_text(encoding="utf-8")
    sec = md.split("## 응답과 상태", 1)[1].split("\n## ", 1)[0] if "## 응답과 상태" in md else ""
    rows = [ln for ln in sec.splitlines() if ln.startswith("| ") and not ln.startswith("| ---")]
    RESP_ROWS[sid] = max(0, len(rows) - 1)
    RESP_TEXT[sid] = rows[1:]

dom = (REPO / "docs/01-domain/domain.md").read_text(encoding="utf-8")
AVOID = []
for line in dom.splitlines():
    if line.startswith("| TERM-0"):
        c = [x.strip() for x in line.strip().strip("|").split("|")]
        for w in re.split(r",\s*", c[5]):
            w = re.sub(r"\(.*?\)", "", w).strip()
            if w and w != "없음" and len(w) >= 2:
                AVOID.append((w, c[0], c[1]))
# 02·03단계 검사와 같은 허용 꼴(check_prd.py ALLOW)과 이 단계에서 쓰는 말
ALLOW = {
    "예약": [r"예약 링크", r"가예약"],
    "확정": [r"주문[이을]? ?확정", r"확정[된되]", r"확정하면", r"확정 안내", r"확정해야", r"확정하지"],
    "시트": [r"구글 시트"],
    "입금": [r"입금했다고", r"입금 대조", r"들어온 입금", r"입금자", r"입금됨", r"미입금", r"입금했어요"],
    "주문서": [r"주문서 초안"],
    "정책": [],
}
EXTRA = ("여쭙", "입금 확인", "예약 확정", "결제 완료", "노쇼", "클레임", "위약금", "에스크로", "홀드", "챗봇",
         "고객", "관리자", "승인", "리뷰", "배송", "배달", "판매자", "회원", "자리 잡기", "정한 것", "DB")

# ── 원본 ─────────────────────────────────────────────────────────────
TASKS = W.TASKS
T = OrderedDict()
check("작업 ID 꼴·차례·중복")
prev = 0
for t in TASKS:
    tid = t["id"]
    if not re.fullmatch(r"TASK-\d{3}", tid):
        problems.append("%s: ID 꼴이 TASK-000이 아님" % tid)
        continue
    if tid in T:
        problems.append("%s: ID 중복" % tid)
    if int(tid[5:]) <= prev:
        problems.append("%s: ID가 차례대로가 아님" % tid)
    prev = int(tid[5:])
    T[tid] = t
ACTIVE = OrderedDict((k, v) for k, v in T.items() if v.get("status", "active") == "active")
for k, v in T.items():
    if v.get("status", "active") not in ("active", "removed"):
        problems.append("%s: status는 active나 removed" % k)


def g(t, key):
    return list(t.get(key) or [])


def main_spec(t):
    for s in g(t, "src"):
        if s.startswith("SPEC-"):
            return s
    return None


# API를 만드는 첫 작업
BUILDER = {}
for tid, t in ACTIVE.items():
    for a in g(t, "api"):
        BUILDER.setdefault(a, tid)

# 화면 작업의 앞선 작업: 그 화면이 부르는 API를 만드는 작업.
# later_api: 이 화면 작업이 기다리지 않는 API(뒤 반복의 only_api 작업이 맡음), only_api: 그 API 몫만 하는 화면 작업
def screen_apis(t, sid):
    apis = list(SCR.get(sid, {}).get("apis") or [])
    if g(t, "only_api"):
        return [a for a in apis if a in g(t, "only_api")]
    return [a for a in apis if a not in g(t, "later_api")]


DEPS = {}
for tid, t in ACTIVE.items():
    deps = list(g(t, "dep"))
    for sid in g(t, "scr"):
        for a in screen_apis(t, sid):
            b = BUILDER.get(a)
            if b and b != tid and b not in deps:
                deps.append(b)
    DEPS[tid] = deps
SCREEN_MAIN = {}
for tid, t in ACTIVE.items():
    for sid in g(t, "scr"):
        if not g(t, "only_api"):
            SCREEN_MAIN.setdefault(sid, tid)

# 닿는 테이블: 손으로 적은 것 + 서버 작업이면 출처 SPEC의 테이블(05 erd_map)
TBLS = {}
for tid, t in ACTIVE.items():
    tb = set(g(t, "tbl"))
    if not g(t, "scr"):
        for s in g(t, "src"):
            tb |= set(SPEC_TBL.get(s, []))
    TBLS[tid] = sorted(tb)

# 수락 기준 배정
AC_OF = defaultdict(dict)  # tid -> {spec: [n]}
check("수락 기준 배정(SPEC마다 #1~#n이 한 작업 이상)")
by_main = defaultdict(list)
explicit = defaultdict(set)
for tid, t in ACTIVE.items():
    for s, nums in (t.get("ac") or {}).items():
        if nums:
            explicit[s].add(tid)
            AC_OF[tid][s] = list(nums)
    if (not t.get("noac") and not g(t, "scr") and main_spec(t)
            and main_spec(t) not in (t.get("ac") or {})):
        by_main[main_spec(t)].append(tid)
for s, tids in by_main.items():
    if len(tids) == 1 and not explicit.get(s):
        AC_OF[tids[0]][s] = list(range(1, AC_N.get(s, 0) + 1))
    else:
        problems.append("%s: 이 SPEC을 주 출처로 둔 서버 작업이 여럿(%s)이라 ac로 나눠야 함(수락 기준 %d개)"
                        % (s, ", ".join(sorted(set(tids) | explicit.get(s, set()))), AC_N.get(s, 0)))
covered_ac = defaultdict(set)
for tid, d in AC_OF.items():
    for s, nums in d.items():
        if s not in SPECS:
            problems.append("%s: ac의 %s가 없는 SPEC" % (tid, s))
            continue
        for n in nums:
            if not 1 <= n <= AC_N[s]:
                problems.append("%s: %s 수락 기준 #%d이 없음(%d개)" % (tid, s, n, AC_N[s]))
            covered_ac[s].add(n)
for s, n in AC_N.items():
    miss = sorted(set(range(1, n + 1)) - covered_ac[s])
    if miss:
        problems.append("%s: 수락 기준 %s이 어느 작업에도 배정되지 않음" % (s, ranges(miss)))

# 스킬 결과
OUT_OF = defaultdict(lambda: defaultdict(list))  # tid -> api -> [codes]
check("스킬 결과(카카오 스킬 API 넷의 결과 코드)마다 작업")
for tid, t in ACTIVE.items():
    src = set(g(t, "src"))
    for a in g(t, "api"):
        for code in SKILL_LISTS.get(a, []):
            if OUTCOME_SPEC.get(code) in src:
                OUT_OF[tid][a].append(code)
for a, codes in SKILL_LISTS.items():
    for code in codes:
        if not any(code in OUT_OF[tid][a] for tid in ACTIVE):
            problems.append("%s 스킬 결과 %s(%s): 그 API와 SPEC을 함께 가진 작업이 없음" % (a, code, OUTCOME_SPEC.get(code)))

# ── 검사 ─────────────────────────────────────────────────────────────
check("출처·닿는 ID가 원본에 있음")
for tid, t in ACTIVE.items():
    for s in g(t, "src") + g(t, "rules"):
        ok = ((s in SPECS) or (s in REQS and not REQS[s]["excluded"]) or (s in OPEN) or (s in DECS)
              or (s in ARULES) or (s in GRULES) or (s in TBL_NAME) or (s in SCR) or (s in API) or (s in FLOWS))
        if s in REQS and REQS[s]["excluded"]:
            problems.append("%s: 제외된 %s를 출처로 씀" % (tid, s))
        elif not ok:
            problems.append("%s: 출처 %s가 원본에 없음(SPEC·유효 REQ·열린 OPEN·DEC·A·G·TBL·SCR·API·FL)" % (tid, s))
    for a in g(t, "api"):
        if a not in API:
            problems.append("%s: 없는 API %s" % (tid, a))
    for s in g(t, "scr"):
        if s not in SCR:
            problems.append("%s: 없는 화면 %s" % (tid, s))
    for x in g(t, "tbl"):
        if x not in TBL_NAME:
            problems.append("%s: 없는 테이블 %s" % (tid, x))

check("SPEC %d개마다 작업" % len(SPECS))
for s in SPECS:
    if not any(s in g(t, "src") for t in ACTIVE.values()):
        problems.append("%s: 작업 없음" % s)
check("API마다 만드는 작업")
for a in API:
    if a not in BUILDER:
        problems.append("%s: 만드는 작업 없음" % a)
check("화면마다 작업과 08 상태, 화면이 부르는 API마다 기다리는 화면 작업")
for s in SCR:
    if not any(s in g(t, "scr") for t in ACTIVE.values()):
        problems.append("%s: 작업 없음" % s)
    if s not in STATES:
        problems.append("%s: 08 상태 정의 없음" % s)
    waited = set()
    for t in ACTIVE.values():
        if s in g(t, "scr"):
            waited |= set(screen_apis(t, s))
    for a in (SCR[s].get("apis") or []):
        if a not in waited:
            problems.append("%s: 부르는 %s를 맡은 화면 작업이 없음(later_api만 있음)" % (s, a))
check("테이블마다 작업")
for x in TBL_NAME:
    if not any(x in v for v in TBLS.values()):
        problems.append("%s(%s): 닿는 작업 없음" % (x, TBL_NAME[x]))
check("앱 규칙 A·공통 규칙 G마다 작업")
for r in list(ARULES) + GRULES:
    if not any(r in g(t, "rules") or r in g(t, "src") for t in ACTIVE.values()):
        problems.append("%s: 닿는 작업 없음" % r)
check("열린 질문 OPEN마다 작업")
for q in OPEN:
    if not any(q in g(t, "src") for t in ACTIVE.values()):
        problems.append("%s: 작업 없음" % q)
check("SPEC 밖 유효 요구사항마다 작업")
for q in REQ_OUTSIDE:
    if not any(q in g(t, "src") for t in ACTIVE.values()):
        problems.append("%s: SPEC 행에 없고 작업에도 없음" % q)

check("맡은 이 하나·크기·끝난 조건·반복")
for tid, t in ACTIVE.items():
    if t.get("owner") not in OWNERS:
        problems.append("%s: 맡은 이가 %s 가운데 하나가 아님" % (tid, "·".join(OWNERS)))
    if t.get("size") not in SIZES:
        problems.append("%s: 크기가 %s일 가운데 하나가 아님" % (tid, "·".join(fmt_size(x) for x in SIZES)))
    if t.get("it") not in ITER:
        problems.append("%s: 반복 %s가 없음" % (tid, t.get("it")))
    if not (t.get("done") or "").strip() and not (g(t, "api") or g(t, "scr") or AC_OF.get(tid)):
        problems.append("%s: 끝난 조건 없음" % tid)
    if t.get("owner") == "동희님" and not (t.get("done") or "").strip():
        problems.append("%s: 동희님 작업은 끝난 조건을 글로 적음" % tid)

check("앞선 작업: 없는 ID·자기 자신·고리·반복 거꾸로")
for tid, deps in DEPS.items():
    for d in deps:
        if d == tid:
            problems.append("%s: 자기 자신을 앞선 작업으로 둠" % tid)
        elif d not in ACTIVE:
            problems.append("%s: 앞선 작업 %s가 없거나 지운 작업" % (tid, d))
        elif ACTIVE[d]["it"] > ACTIVE[tid]["it"]:
            problems.append("%s(반복 %s): 앞선 작업 %s가 뒤 반복 %s" % (tid, ACTIVE[tid]["it"], d, ACTIVE[d]["it"]))
indeg = {k: 0 for k in ACTIVE}
for tid, deps in DEPS.items():
    for d in deps:
        if d in ACTIVE and d != tid:
            indeg[tid] += 1
queue = [k for k, v in indeg.items() if v == 0]
seen = 0
children = defaultdict(list)
for tid, deps in DEPS.items():
    for d in deps:
        if d in ACTIVE and d != tid:
            children[d].append(tid)
while queue:
    k = queue.pop()
    seen += 1
    for ch in children[k]:
        indeg[ch] -= 1
        if indeg[ch] == 0:
            queue.append(ch)
if seen != len(ACTIVE):
    problems.append("앞선 작업에 고리: %s" % ", ".join(k for k, v in indeg.items() if v > 0))

# 가장 긴 앞선 작업 줄(크기 합). 고리가 없을 때만
CRIT = (0, [])
if seen == len(ACTIVE):
    best = {}

    def longest(k):
        if k not in best:
            prev_ = [longest(d) for d in DEPS[k] if d in ACTIVE and d != k]
            p = max(prev_, key=lambda x: x[0]) if prev_ else (0, [])
            best[k] = (p[0] + ACTIVE[k]["size"], p[1] + [k])
        return best[k]

    CRIT = max((longest(k) for k in ACTIVE), key=lambda x: x[0])

GEN_BLOCK = r"<!-- BEGIN generated:([a-z0-9-]+) -->.*?<!-- END generated:\1 -->"


def banned(label, text, allow_more=None):
    for w, term_id, term in AVOID:
        for m in re.finditer(re.escape(w), text):
            around = text[max(0, m.start() - 12): m.end() + 12]
            pats = ALLOW.get(w, []) + (allow_more or {}).get(w, [])
            if w in ALLOW and any(re.search(a, around) for a in pats):
                continue
            problems.append("%s: '%s'(%s %s의 금지어): …%s…" % (label, w, term_id, term, around))
    for w in EXTRA:
        if w in text:
            problems.append("%s: '%s'" % (label, w))
    for rx, new in OLD_TERMS:
        for m in re.finditer(rx, text):
            problems.append("%s: 옛 용어 '%s' → %s: …%s…" % (label, m.group(0), new, text[max(0, m.start() - 12): m.end() + 12]))


check("금지어(01 용어집, 02·03 검사와 같은 허용 꼴)와 옛 용어(08·09 검사와 같은 목록): 작업·반복 설명·README·tech-stack.md의 손으로 쓴 글")
for tid, t in T.items():
    banned(tid, (t.get("name") or "") + " " + (t.get("done") or "") + " " + str(t.get("finished") or ""))
for it, note in W.ITERATION_NOTES:
    banned("반복 %s 설명" % it, note)
if README.exists():
    # 생성 절·주소·코드 글자는 빼고 본다. '확정한 뒤 고친 것'은 단계 README마다 같은 절 이름
    hand = re.sub(GEN_BLOCK, " ", README.read_text(encoding="utf-8"), flags=re.S)
    hand = re.sub(r"https?://\S+|`[^`]*`", " ", hand)
    banned("README", hand, {"확정": [r"확정한 뒤 고친 것"]})
STACK = REPO / "docs/10-wbs/tech-stack.md"
if STACK.exists():
    # 10단계 기술 스택 제안(TASK-001)도 손으로 쓴 글이라 같은 금지어를 봄. 주소·코드 글자는 뺌
    banned("tech-stack.md", re.sub(r"https?://\S+|`[^`]*`", " ", STACK.read_text(encoding="utf-8")))

check("끝난 표시(finished): 끝난 날로 시작하고 앞선 작업이 모두 끝남")
for tid, t in ACTIVE.items():
    if t.get("finished") is None:
        continue
    if not re.match(r"20\d\d-\d\d-\d\d", str(t["finished"])):
        problems.append("%s: finished는 끝난 날(YYYY-MM-DD)로 시작" % tid)
    for d in DEPS[tid]:
        if not ACTIVE.get(d, {}).get("finished"):
            problems.append("%s: 끝났다고 적었지만 앞선 작업 %s가 끝나지 않음" % (tid, d))

# ── 끝난 조건 만들기 ────────────────────────────────────────────────


def done_lines(tid, t):
    out = []
    if t.get("finished"):
        out.append("끝남: %s" % t["finished"])
    if (t.get("done") or "").strip():
        out.append(t["done"].strip())
    for s, nums in AC_OF.get(tid, {}).items():
        if nums:
            out.append("%s 수락 기준 %s: 자동 시험 통과" % (s, ranges(nums)))
    for a in g(t, "api"):
        line = "%s 응답(%s)마다 통과하는 시험" % (a, "·".join(API_RESP.get(a, ["?"])))
        codes = OUT_OF.get(tid, {}).get(a)
        if codes:
            line += ", 스킬 결과 %s" % "·".join(codes)
        out.append(line)
    for s in g(t, "scr"):
        if g(t, "only_api"):
            n = sum(1 for r in RESP_TEXT.get(s, []) if any(a in r for a in g(t, "only_api")))
            out.append("%s 응답 행 가운데 %s의 %d개마다 정한 상태로 보임(상태 그리기는 %s)"
                       % (s, "·".join(g(t, "only_api")), n, SCREEN_MAIN.get(s, "?")))
            continue
        shell = C.SCREENS.get(s, {}).get("shell")
        allst, drawn = STATES.get(s, []), DRAWN.get(s, [])
        undrawn = [x for x in allst if x not in drawn]
        if shell == "kakao":
            line = ("%s 상태 %d개마다 스킬 응답이 08 정의와 같음(카카오 응답 형식: 출력 3개 이하, 카드 설명 400자 이하)"
                    % (s, len(allst)))
        else:
            line = "%s 상태 %d개를 360·1280에서 그려 page-check 통과(누르는 곳 44px)" % (s, len(allst))
        line += ", 09에서 그린 %d개(%s)" % (len(drawn), "·".join(drawn))
        if undrawn:
            line += "와 그리지 않은 %d개(%s)는 08 와이어프레임과 09 토큰으로" % (len(undrawn), "·".join(undrawn))
        later = g(t, "later_api")
        nrows = sum(1 for r in RESP_TEXT.get(s, []) if not any(a in r for a in later))
        if nrows:
            line += ", 08 응답 행 %d개마다 정한 상태로 보임" % nrows
        if later:
            line += "(%s의 행은 %s)" % ("·".join(later), ", ".join(
                tid2 for tid2, t2 in ACTIVE.items() if s in g(t2, "scr") and set(later) & set(g(t2, "only_api"))))
        out.append(line)
    rules = g(t, "rules")
    if rules:
        a = [r for r in rules if r.startswith("A")]
        gg = [r for r in rules if r.startswith("G")]
        if a:
            out.append("05 앱 규칙(%s)을 지키는지 보는 서버 시험" % "·".join(a))
        if gg:
            out.append("04 공통 규칙(%s)을 지키는지 보는 시험" % "·".join(gg))
    return out


def touches(tid, t):
    parts = g(t, "api") + TBLS.get(tid, []) + g(t, "scr")
    return ", ".join(parts) if parts else "없음"


def esc(x):
    return str(x).replace("|", "\\|").replace("\n", " ")


# ── 생성 ─────────────────────────────────────────────────────────────
n_act = len(ACTIVE)
tot = sum(t["size"] for t in ACTIVE.values() if t.get("size") in SIZES)
by_owner = defaultdict(int)
for t in ACTIVE.values():
    by_owner[t.get("owner")] += 1
st_total = sum(len(STATES.get(s, [])) for s in SCR)
st_drawn = sum(len(DRAWN.get(s, [])) for s in SCR)
counts = ("작업 %d개 · 크기 합 %s일 · 반복 %d개 · 동희님 %d개 · Claude %d개 · SPEC %d개 · 수락 기준 %d개 · API %d개 · "
          "화면 %d개(상태 %d개, 09에서 그린 %d개, 그리지 않은 %d개) · 테이블 %d개 · 앱 규칙 %d개 · 공통 규칙 %d개 · 열린 질문 %d개 · 끝난 작업 %d개"
          % (n_act, fmt_size(tot), len(ITER), by_owner["동희님"], by_owner["Claude"], len(SPECS), sum(AC_N.values()),
             len(API), len(SCR), st_total, st_drawn, st_total - st_drawn, len(TBL_NAME), len(ARULES), len(GRULES), len(OPEN),
             sum(1 for t in ACTIVE.values() if t.get("finished"))))

L = []
L.append("# 10단계 WBS")
L.append("")
L.append("<!-- build_wbs.py가 research/cake-wbs-2026-11/wbs_rows.py에서 생성. 손으로 고치지 않음 -->")
L.append("")
L.append(counts + ".")
L.append("")
L.append("읽는 법과 나눈 방식은 [README](README.md)에 있습니다. '닿는 것'은 만드는 API, 쓰고 읽는 테이블, 만드는 화면입니다. "
         "'끝난 조건'의 첫 줄은 손으로 쓴 조건이고, 수락 기준·응답 코드·스킬 결과·화면 상태·응답 행·규칙 줄은 원본에서 생성합니다. "
         "화면 작업의 앞선 작업에는 그 화면이 부르는 API를 만드는 작업이 자동으로 들어갑니다. "
         "끝난 작업은 끝난 조건 맨 앞에 '끝남'과 끝난 날·증거가 붙습니다.")
L.append("")
L.append("| 반복 | 이름 | 작업 | 크기 합(일) | 동희님 | Claude |")
L.append("| --- | --- | --- | --- | --- | --- |")
for it, name in ITER.items():
    ts = [t for t in ACTIVE.values() if t.get("it") == it]
    L.append("| %s | %s | %d | %s | %d | %d |" % (it, name, len(ts), fmt_size(sum(t["size"] for t in ts)),
                                                 sum(1 for t in ts if t["owner"] == "동희님"),
                                                 sum(1 for t in ts if t["owner"] == "Claude")))
L.append("")
crit_line = ("가장 긴 앞선 작업 줄(차례대로만 할 수 있는 작업의 크기 합): %s일, 작업 %d개(%s)."
             % (fmt_size(CRIT[0]), len(CRIT[1]), " → ".join(CRIT[1])))
L.append(crit_line)
L.append("")
for it, name in ITER.items():
    L.append("## 반복 %s. %s" % (it, name))
    L.append("")
    note = dict(W.ITERATION_NOTES).get(it)
    if note:
        L.append(note)
        L.append("")
    L.append("| ID | 작업 | 출처 | 닿는 것 | 앞선 작업 | 맡은 이 | 크기 | 끝난 조건 |")
    L.append("| --- | --- | --- | --- | --- | --- | --- | --- |")
    for tid, t in ACTIVE.items():
        if t.get("it") != it:
            continue
        L.append("| %s | %s | %s | %s | %s | %s | %s일 | %s |" % (
            tid, esc(t["name"]), esc(", ".join(g(t, "src") + g(t, "rules")) or "없음"), esc(touches(tid, t)),
            esc(", ".join(DEPS[tid]) or "없음"), t["owner"], fmt_size(t["size"]),
            "<br/>".join(esc(x) for x in done_lines(tid, t))))
    L.append("")
removed = [t for t in T.values() if t.get("status") == "removed"]
if removed:
    L.append("## 지운 작업")
    L.append("")
    L.append("| ID | 작업 | 지운 날과 이유 |")
    L.append("| --- | --- | --- |")
    for t in removed:
        L.append("| %s | %s | %s |" % (t["id"], esc(t["name"]), esc(t.get("removed", ""))))
    L.append("")

L.append("## 부록 A. SPEC → 작업")
L.append("")
L.append("| SPEC | 이름 | 수락 기준 | 작업(받은 수락 기준) |")
L.append("| --- | --- | --- | --- |")
for s, r in SPECS.items():
    ts = []
    for tid, t in ACTIVE.items():
        if s in g(t, "src"):
            nums = AC_OF.get(tid, {}).get(s)
            ts.append("%s(%s)" % (tid, ranges(nums)) if nums else tid)
    L.append("| %s | %s | %d | %s |" % (s, esc(r["name"]), AC_N[s], ", ".join(ts) or "없음"))
L.append("")
L.append("## 부록 B. API → 작업")
L.append("")
L.append("| API | 연산 | 응답 | 만드는 작업 | 함께 고치는 작업 | 부르는 화면 작업 |")
L.append("| --- | --- | --- | --- | --- | --- |")
for a, o in API.items():
    b = BUILDER.get(a, "없음")
    more = [tid for tid, t in ACTIVE.items() if a in g(t, "api") and tid != b]
    users = [tid for tid, t in ACTIVE.items() if any(a in (SCR[s].get("apis") or []) for s in g(t, "scr") if s in SCR)]
    L.append("| %s | `%s %s` | %s | %s | %s | %s |" % (a, o["method"].upper(), o["path"], "·".join(API_RESP.get(a, [])),
                                                    b, ", ".join(more) or "없음", ", ".join(users) or "없음"))
L.append("")
L.append("## 부록 C. 화면 → 작업과 상태")
L.append("")
L.append("| SCR | 이름 | 상태 | 09에서 그린 것 | 그리지 않은 것 | 응답 행 | 작업 |")
L.append("| --- | --- | --- | --- | --- | --- | --- |")
for s, n in SCR.items():
    allst, drawn = STATES.get(s, []), DRAWN.get(s, [])
    undrawn = [x for x in allst if x not in drawn]
    ts = [tid for tid, t in ACTIVE.items() if s in g(t, "scr")]
    L.append("| %s | %s | %d | %d | %s | %d | %s |" % (s, esc(n["name"]), len(allst), len(drawn),
                                                  ("%d(%s)" % (len(undrawn), "·".join(undrawn))) if undrawn else "0",
                                                  RESP_ROWS.get(s, 0), ", ".join(ts) or "없음"))
L.append("")
L.append("## 부록 D. 테이블 → 작업")
L.append("")
L.append("| TBL | 테이블 | 작업 |")
L.append("| --- | --- | --- |")
for x, name in sorted(TBL_NAME.items()):
    ts = [tid for tid, v in TBLS.items() if x in v]
    L.append("| %s | `%s` | %s |" % (x, name, ", ".join(ts) or "없음"))
L.append("")
L.append("## 부록 E. 규칙·열린 질문·SPEC 밖 요구사항 → 작업")
L.append("")
L.append("| ID | 내용 | 작업 |")
L.append("| --- | --- | --- |")
for r, title in ARULES.items():
    ts = [tid for tid, t in ACTIVE.items() if r in g(t, "rules") or r in g(t, "src")]
    L.append("| %s | 05 앱 규칙: %s | %s |" % (r, esc(title), ", ".join(ts) or "없음"))
for r in GRULES:
    ts = [tid for tid, t in ACTIVE.items() if r in g(t, "rules") or r in g(t, "src")]
    L.append("| %s | 04 공통 규칙 | %s |" % (r, ", ".join(ts) or "없음"))
for q, o in OPEN.items():
    ts = [tid for tid, t in ACTIVE.items() if q in g(t, "src")]
    L.append("| %s | 06 열린 질문(%s) | %s |" % (q, esc(o["where"]), ", ".join(ts) or "없음"))
for q in REQ_OUTSIDE:
    ts = [tid for tid, t in ACTIVE.items() if q in g(t, "src")]
    L.append("| %s | SPEC 행 밖 요구사항(%s, %s) | %s |" % (q, REQS[q]["prio"], REQS[q]["kind"], ", ".join(ts) or "없음"))
L.append("")
text = "\n".join(L)

check("생성 파일이 원본과 같음")
stale = []
if WRITE:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text, encoding="utf-8")
elif not OUT.exists() or OUT.read_text(encoding="utf-8") != text:
    stale.append(str(OUT.relative_to(REPO)))
# README 생성 절: 숫자와 표는 여기서만 만든다(손으로 옮기지 않음)
R = OrderedDict()
R["counts"] = counts + "."
R["inputs"] = "\n".join([
    "| 단계 | 원본(읽기만) | 읽은 것 |",
    "| --- | --- | --- |",
    "| 01 | `docs/01-domain/domain.md` | 용어집의 금지어 %d개 |" % len(AVOID),
    "| 02 | `docs/02-prd/requirements.md` | 요구사항 %d개(제외 %d개), SPEC 행에 없는 유효 요구사항 %d개(%s) |"
    % (len(REQS), sum(1 for v in REQS.values() if v["excluded"]), len(REQ_OUTSIDE), ", ".join(REQ_OUTSIDE)),
    "| 03 | `docs/03-user-flow/FL-*.md` | 플로우 %d개(출처 ID) |" % len(FLOWS),
    "| 04 | `research/cake-spec-2026-11/spec_rows.py`, `docs/04-functional-spec/spec.md` | SPEC %d개, 수락 기준 %d개, 공통 규칙 %d개 |"
    % (len(SPECS), sum(AC_N.values()), len(GRULES)),
    "| 05 | `db/schema.sql`, `docs/05-erd/README.md`, `research/cake-erd-2026-11/erd_map.py` | 테이블 %d개, 앱 규칙 %d개, SPEC마다 닿는 테이블 |"
    % (len(TBL_NAME), len(ARULES)),
    "| 06 | `api/openapi.yaml`, `research/cake-api-2026-11/api_ops.py`·`api_catalog.py` | API %d개(응답 %d개), 카카오 스킬 API 넷의 결과 코드 %d개, 열린 질문 %d개, 결정 사항 %d개 |"
    % (len(API), sum(len(v) for v in API_RESP.values()), sum(len(v) for v in SKILL_LISTS.values()), len(OPEN), len(DECS)),
    "| 07 | `docs/07-sitemap/sitemap.yaml` | 화면 %d개와 화면마다 부르는 API |" % len(SCR),
    "| 08 | `research/cake-screens-2026-11/screens_*.py`, `docs/08-screens/SCR-*.md` | 상태 %d개, 응답 행 %d개 |"
    % (st_total, sum(RESP_ROWS.get(s, 0) for s in SCR)),
    "| 09 | `research/cake-mockup-2026-11/gen_screens.py` | 그리는 상태 이름 %d개(%s), 그린 상태 %d개 |"
    % (len(KEY_STATES), "·".join(KEY_STATES), st_drawn),
])
rows = ["| 반복 | 이름 | 작업 | 크기 합(일) | 동희님 | Claude | 끝나면 |", "| --- | --- | --- | --- | --- | --- | --- |"]
for it, name in ITER.items():
    ts = [t for t in ACTIVE.values() if t.get("it") == it]
    note = dict(W.ITERATION_NOTES).get(it, "")
    rows.append("| %s | %s | %d | %s | %d | %d | %s |" % (
        it, name, len(ts), fmt_size(sum(t["size"] for t in ts)), sum(1 for t in ts if t["owner"] == "동희님"),
        sum(1 for t in ts if t["owner"] == "Claude"), esc(note.split("끝나면 ", 1)[-1])))
rows.append("| 합 | | %d | %s | %d | %d | |" % (n_act, fmt_size(tot), by_owner["동희님"], by_owner["Claude"]))
rows.append("")
rows.append(crit_line)
R["iterations"] = "\n".join(rows)
first = min(ITER)
rows = ["| ID | 작업 | 맡은 이 | 크기 | 출처 | 앞선 작업 | 끝난 조건 |", "| --- | --- | --- | --- | --- | --- | --- |"]
for tid, t in ACTIVE.items():
    if t.get("it") == first:
        rows.append("| %s | %s | %s | %s일 | %s | %s | %s |" % (
            tid, esc(t["name"]), t["owner"], fmt_size(t["size"]), esc(", ".join(g(t, "src") + g(t, "rules")) or "없음"),
            esc(", ".join(DEPS[tid]) or "없음"), "<br/>".join(esc(x) for x in done_lines(tid, t))))
R["before-dev"] = "\n".join(rows)
R["checks"] = "\n".join("%d. %s" % (i + 1, c) for i, c in enumerate(checks))
if README.exists():
    rd = README.read_text(encoding="utf-8")
    new = rd
    for name, body in R.items():
        pat = r"<!-- BEGIN generated:%s -->.*?<!-- END generated:%s -->" % (name, name)
        if not re.search(pat, rd, flags=re.S):
            problems.append("README: 생성 절 generated:%s가 없음" % name)
            continue
        block = "<!-- BEGIN generated:%s -->\n%s\n<!-- END generated:%s -->" % (name, body, name)
        new = re.sub(pat, lambda m: block, new, flags=re.S)
    for m in re.finditer(r"<!-- BEGIN generated:([a-z0-9-]+) -->", rd):
        if m.group(1) not in R:
            problems.append("README: 모르는 생성 절 generated:%s" % m.group(1))
    if WRITE:
        README.write_text(new, encoding="utf-8")
    elif new != rd:
        stale.append(str(README.relative_to(REPO)))
else:
    problems.append("README: %s가 없음" % README.relative_to(REPO))
for s in stale:
    problems.append("%s: 생성 절이 원본과 다름(--write로 다시 만듦)" % s)

for p in problems:
    print("오류:", p)
print(counts)
print("검사 %d개 · 오류 %d" % (len(checks), len(problems)))
sys.exit(1 if problems else 0)
