#!/usr/bin/env python3
"""07단계 사이트맵 검사.

    python3 -B research/cake-sitemap-2026-11/check_sitemap.py . [--hub PATH/sitemap.py]

원본(sitemap.yaml, 플로우 문서의 '화면 (07단계)' 표)과 거기서 생성한 파일(README 표, sitemap.html)을
검사한다. --hub에 CORTHEX 허브의 sitemap.py를 주면 허브 파서로도 읽어 PyYAML 결과와 같은지
확인한다(없으면 '미확인').
"""
import html
import importlib.util
import re
import subprocess
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from vocab import ACCESS, AUDIENCES, REASONS  # noqa: E402

KEYS = ["id", "name", "path", "access", "status", "flows", "terms", "specs", "apis", "note"]
OPTIONAL = ["also_paths", "audience", "no_flow", "opens", "opens_by_task", "opens_by_banner", "children"]
NODE = re.compile(r'^\s*([A-Za-z][A-Za-z0-9]*)(\(\[|\[\[|\[|\{)"(.*)"(\]\)|\]\]|\]|\})\s*$')

# 01단계 용어집의 금지어(용어집 '금지어' 열, check_flows.py와 같은 방식)와 직접 확인한 허용 예외.
EXTRA_AVOID = ("입금 확인", "예약 확정", "결제 완료", "노쇼", "클레임", "위약금", "에스크로", "홀드",
               "챗봇", "고객", "관리자", "승인", "리뷰", "배송", "배달", "판매자")
ALLOW = {
    "예약": [r"예약 링크", r"가예약"],
    "확정": [r"주문[이을]? ?확정", r"확정[된되]", r"확정하", r"확정 안내", r"확정 주문", r"버전으로 확정",
             r"추천대로 확정", r"단계 확정", r"\d+ 확정", r"확정 \|", r"상태: 확정", r"확정받",
             r"확정한 뒤 고친"],  # 단계 문서를 마친 뒤 고친 기록의 절 제목(03단계 check_flows.py와 같음)
    "시트": [r"구글 시트"],
    "입금": [r"입금했다고", r"입금 대조", r"들어온 입금", r"입금이 확인", r"입금자", r"입금됨", r"미입금"],
    "주문서": [r"주문서 초안"],
    "매장": [r"매장에서"],
    "정책": [r"5-1의 정책"],
}


class Report:
    def __init__(self):
        self.rows = []

    def add(self, cid, title, problems, detail="", unseen=None):
        state = "미확인" if unseen else ("실패" if problems else "통과")
        self.rows.append((cid, title, state, problems, unseen or detail))

    def show(self):
        for cid, title, state, problems, detail in self.rows:
            print("%s %s: %s%s" % (cid, title, state, (" — " + detail) if detail else ""))
            for p in problems[:30]:
                print("    - " + p)
            if len(problems) > 30:
                print("    - … %d개 더" % (len(problems) - 30))
        n = {s: sum(1 for r in self.rows if r[2] == s) for s in ("통과", "실패", "미확인")}
        print("검사 %d개: 통과 %d, 실패 %d, 미확인 %d" % (len(self.rows), n["통과"], n["실패"], n["미확인"]))
        return n["실패"]


def walk(nodes, parent=None, depth=0, root=None, out=None):
    out = [] if out is None else out
    for n in nodes:
        r = root or n.get("id")
        out.append((n, parent, depth, r))
        walk(n.get("children") or [], n.get("id"), depth + 1, r, out)
    return out


def strip_line_keys(x):
    if isinstance(x, dict):
        return {k: strip_line_keys(v) for k, v in x.items() if k != "__line__"}
    if isinstance(x, list):
        return [strip_line_keys(v) for v in x]
    return x


def avoided_words(dom):
    avoid = []
    for line in dom.splitlines():
        if line.startswith("| TERM-0"):
            c = [x.strip() for x in line.strip().strip("|").split("|")]
            for w in re.split(r",\s*", c[5]):
                w = re.sub(r"\(.*?\)", "", w).strip()
                if w and w != "없음" and len(w) >= 2 and not re.fullmatch(r"`.*`", w):
                    avoid.append((w, c[0]))
    avoid += [(w, "-") for w in EXTRA_AVOID]
    return avoid


def allowed(word, text, start, end):
    window = text[max(0, start - 14): end + 14]
    return any(re.search(a, window) for a in ALLOW.get(word, []))


def main():
    args = [a for a in sys.argv[1:]]
    hub = None
    if "--hub" in args:
        i = args.index("--hub")
        hub = Path(args[i + 1])
        del args[i:i + 2]
    root = Path(args[0] if args else ".").resolve()
    rep = Report()
    ypath = root / "docs/07-sitemap/sitemap.yaml"
    ytext = ypath.read_text(encoding="utf-8")

    # S1 PyYAML
    problems = []
    try:
        tree = yaml.safe_load(ytext)
        if not isinstance(tree, list) or not all(isinstance(n, dict) for n in tree):
            problems.append("최상위가 화면 목록이 아님")
    except yaml.YAMLError as err:
        tree, problems = [], ["파싱 실패: %s" % err]
    flat = walk(tree) if not problems else []
    rep.add("S1", "원본을 PyYAML로 읽음", problems, "루트 %d개, 화면 %d개" % (len(tree or []), len(flat)))

    # S2 허브 파서
    if hub and hub.exists():
        spec = importlib.util.spec_from_file_location("corthex_hub_sitemap", hub)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        problems = []
        try:
            hub_tree = strip_line_keys(mod.read_yaml(ytext))
            if hub_tree != tree:
                problems.append("허브 파서 결과가 PyYAML과 다름")
        except mod.Invalid as err:
            problems.append("허브 파서 오류: %s행 %s" % (err.line, err))
        marks = re.findall(r"^\s*#\s*without a screen\s*:\s*(.*)$", ytext, re.M | re.I)
        rep.add("S2", "허브 파서로 읽음", problems, "PyYAML과 같은 트리, '# without a screen' 행 %d개" % len(marks))
    else:
        rep.add("S2", "허브 파서로 읽음", [], unseen="--hub로 허브의 sitemap.py를 주지 않음")

    by = {}
    dup = []
    for n, parent, depth, r in flat:
        if n.get("id") in by:
            dup.append(n.get("id"))
        by[n.get("id")] = (n, parent, depth, r)

    # S3 ID
    problems = ["중복 ID: %s" % d for d in dup]
    ids = [n.get("id") for n, _, _, _ in flat]
    bad = [i for i in ids if not re.fullmatch(r"SCR-\d{3}", str(i))]
    problems += ["ID 형식 오류: %s" % b for b in bad]
    if not bad:
        want = ["SCR-%03d" % k for k in range(1, len(ids) + 1)]
        if sorted(ids) != want:
            problems.append("SCR-001부터 빠진 번호 없이 연속되지 않음")
        if ids != want:
            problems.append("트리 순서와 번호 순서가 다름(새 화면은 끝 번호로 추가해도 됨, 최초 작성본은 같아야 함)")
    rep.add("S3", "SCR ID 중복·누락 없음", problems, "SCR-001~SCR-%03d" % len(ids))

    # S4 필드
    problems = []
    for n, _, _, _ in flat:
        miss = [k for k in KEYS if k not in n]
        extra = [k for k in n if k not in KEYS + OPTIONAL]
        if miss:
            problems.append("%s: 누락 필드 %s" % (n.get("id"), ", ".join(miss)))
        if extra:
            problems.append("%s: 알 수 없는 필드 %s" % (n.get("id"), ", ".join(extra)))
        if n.get("access") not in ACCESS:
            problems.append("%s: access '%s'가 허용 값 %d개 중 하나가 아님" % (n.get("id"), n.get("access"), len(ACCESS)))
        if n.get("status") not in ("active", "removed"):
            problems.append("%s: status '%s'" % (n.get("id"), n.get("status")))
        if not str(n.get("name") or "").strip() or not str(n.get("note") or "").strip():
            problems.append("%s: 이름이나 설명이 비어 있음" % n.get("id"))
    rep.add("S4", "화면별 필수 필드와 접근 권한", problems, "access %d가지: " % len(ACCESS) + " · ".join(ACCESS))

    # S5 경로
    problems, seen = [], {}
    for n, _, _, _ in flat:
        for p in [n.get("path")] + list(n.get("also_paths") or []):
            p = str(p)
            if p in seen:
                problems.append("경로 중복: %s (%s, %s)" % (p, seen[p], n.get("id")))
            seen[p] = n.get("id")
            if not (re.fullmatch(r"/(?:[a-z0-9-]+|:[a-zA-Z]+)(?:/(?:[a-z0-9-]+|:[a-zA-Z]+))*|/", p)
                    or re.fullmatch(r"kakao:(shop|service)/[a-z_/-]+", p)):
                problems.append("%s: 경로 형식 오류 '%s'" % (n.get("id"), p))
    web = sum(1 for p in seen if p.startswith("/"))
    rep.add("S5", "경로 중복 없음", problems, "경로 %d개(웹 %d, 카카오톡 %d)" % (len(seen), web, len(seen) - web))

    # S6 루트에서 도달
    roots = [n for n in tree or []]
    problems = []
    if len(roots) != 3:
        problems.append("루트가 %d개(3개여야 함)" % len(roots))
    reach = len(flat)
    if reach != len(set(ids)):
        problems.append("루트에서 도달하는 화면 수와 ID 수가 다름")
    auds = [n.get("audience") for n in roots]
    if sorted(a for a in auds if a) != sorted(AUDIENCES) or len(auds) != len(set(auds)):
        problems.append("루트의 audience가 %s 각 1개가 아님: %s" % ("·".join(AUDIENCES), auds))
    problems += ["%s: 루트가 아닌데 audience가 있음" % n.get("id") for n, parent, _, _ in flat if parent and "audience" in n]
    rep.add("S6", "모든 화면이 루트에서 도달 가능", problems,
            ", ".join("%s %s %s(%d)" % (n.get("audience"), n.get("id"), n.get("name"), sum(1 for x in flat if x[3] == n.get("id"))) for n in roots))

    # 참고 목록
    dom = (root / "docs/01-domain/domain.md").read_text(encoding="utf-8")
    terms = set(re.findall(r"^\| (TERM-\d{3}) \|", dom, re.M))
    ctxs = set(re.findall(r"^### (CTX-\d{3}) ", dom, re.M))
    spec_text = (root / "docs/04-functional-spec/spec.md").read_text(encoding="utf-8")
    specs = set(re.findall(r"\b(SPEC-\d{3})\b", spec_text))
    api = yaml.safe_load((root / "api/openapi.yaml").read_text(encoding="utf-8"))
    apis = sorted(op["x-corthex"]["id"] for ops in api["paths"].values() for op in ops.values()
                  if isinstance(op, dict) and "x-corthex" in op)
    flow_files = {}
    for p in sorted((root / "docs/03-user-flow").glob("FL-0*.md")):
        t = p.read_text(encoding="utf-8")
        flow_files[re.search(r"^# (FL-\d{3}) ", t, re.M).group(1)] = (p, t)

    # S7 참조
    problems = []
    for n, _, _, _ in flat:
        i = n.get("id")
        for f in n.get("flows") or []:
            if f not in flow_files:
                problems.append("%s: 없는 플로우 %s" % (i, f))
        t = n.get("terms")
        if t != "none":
            if not isinstance(t, list) or not t:
                problems.append("%s: terms가 목록이나 none이 아님" % i)
            else:
                if t[0] not in ctxs:
                    problems.append("%s: terms 첫 값이 컨텍스트가 아님" % i)
                problems += ["%s: 없는 용어 %s" % (i, x) for x in t if x not in terms | ctxs]
        problems += ["%s: 없는 SPEC %s" % (i, x) for x in n.get("specs") or [] if x not in specs]
        problems += ["%s: 없는 API %s" % (i, x) for x in n.get("apis") or [] if x not in apis]
        kids = {c.get("id") for c in n.get("children") or []}
        for o in n.get("opens") or []:
            if o not in by or o == i or o in kids:
                problems.append("%s: opens의 %s가 없거나 자기 자신·하위 화면임" % (i, o))
    rep.add("S7", "플로우·용어·SPEC·API·이동 화면 참조 유효", problems,
            "플로우 %d, 용어 %d, SPEC %d, API %d개 확인" % (len(flow_files), len(terms), len(specs), len(apis)))

    # S8 플로우 표
    problems, table_flows, total, with_screen = [], {}, 0, 0
    reason_count = {r: 0 for r in REASONS}
    for fl, (p, t) in flow_files.items():
        blocks = re.findall(r"<!-- 07-sitemap:start.*?<!-- 07-sitemap:end -->", t, re.S)
        if len(blocks) != 1:
            problems.append("%s: '화면 (07단계)' 표가 %d개" % (fl, len(blocks)))
            continue
        mer = re.search(r"```mermaid\n(.*?)```", t, re.S).group(1)
        nodes = [(m.group(1), m.group(2)) for m in map(NODE.match, mer.splitlines()) if m]
        need = [n for n, shape in nodes if shape != "[["]
        rows = {}
        for line in blocks[0].splitlines():
            m = re.match(r"^\| (\w+) \| (.*?) \| (.*?) \| (.*?) \|$", line)
            if not m or m.group(1) == "노드":
                continue
            node, _, scr, reason = m.groups()
            if node in rows:
                problems.append("%s %s: 행 중복" % (fl, node))
            rows[node] = (scr.strip(), reason.strip())
        for n in need:
            if n not in rows:
                problems.append("%s %s: 표에 행이 없음" % (fl, n))
        for n in rows:
            if n not in need:
                problems.append("%s %s: 다이어그램에 없는 노드(또는 다른 플로우 연결 노드)" % (fl, n))
        for n, (scr, reason) in rows.items():
            total += 1
            got = re.findall(r"SCR-\d{3}", scr)
            if got and reason:
                problems.append("%s %s: 화면과 사유를 함께 적음" % (fl, n))
            elif not got and reason not in REASONS:
                problems.append("%s %s: 화면도 허용된 사유도 없음('%s')" % (fl, n, reason))
            if got:
                with_screen += 1
            elif reason in REASONS:
                reason_count[reason] += 1
            for s in got:
                if s not in by:
                    problems.append("%s %s: 없는 화면 %s" % (fl, n, s))
                    continue
                if by[s][0].get("status") != "active":
                    problems.append("%s %s: 삭제된 화면 %s" % (fl, n, s))
                if not re.search(re.escape(s) + r" " + re.escape(str(by[s][0].get("name"))), scr):
                    problems.append("%s %s: %s 옆 이름이 원본과 다름" % (fl, n, s))
                table_flows.setdefault(s, set()).add(fl)
    rep.add("S8", "플로우 노드마다 화면이나 사유", problems,
            "노드 %d개: 화면 %d, %s" % (total, with_screen, ", ".join("%s %d" % kv for kv in reason_count.items())))

    # S9 양쪽 일치
    problems = []
    for n, _, _, _ in flat:
        i = n.get("id")
        a, b = set(n.get("flows") or []), table_flows.get(i, set())
        if a != b:
            problems.append("%s: 원본 flows %s, 플로우 표 %s" % (i, sorted(a), sorted(b)))
        if not a and not str(n.get("no_flow") or "").strip():
            problems.append("%s: 플로우 노드가 없는데 no_flow 사유가 없음" % i)
        if a and "no_flow" in n:
            problems.append("%s: 플로우 노드가 있는데 no_flow가 있음" % i)
    rep.add("S9", "화면의 flows와 플로우 표 일치", problems,
            "플로우 노드가 없는 화면 %d개(모두 no_flow 사유 있음)" % sum(1 for n, _, _, _ in flat if not n.get("flows")))

    # S10 API
    used = {a for n, _, _, _ in flat for a in n.get("apis") or []}
    missing = [a for a in apis if a not in used]
    rep.add("S10", "06단계 API가 모두 화면에 매핑됨", ["화면이 없는 API: %s" % a for a in missing],
            "%d/%d" % (len(apis) - len(missing), len(apis)))

    # S11 SPEC
    used = {s for n, _, _, _ in flat for s in n.get("specs") or []}
    all_specs = sorted(set(re.findall(r"^\| (SPEC-\d{3}) \|", spec_text, re.M)))  # 4절 SPEC 표의 행(SPEC-070부터도 셈)
    missing = [s for s in all_specs if s not in used]
    rep.add("S11", "04단계 SPEC이 모두 화면에 매핑됨", ["화면이 없는 SPEC: %s" % s for s in missing],
            "%d/%d" % (len(all_specs) - len(missing), len(all_specs)))

    # S12 읽기 모델
    sec = re.search(r"^### 7-3\. 읽기 모델.*?(?=^#{2,3} )", dom, re.S | re.M).group(0)
    models = re.findall(r"^\| (TERM-\d{3}) \|", sec, re.M)
    on_screen = {x for n, _, _, _ in flat if isinstance(n.get("terms"), list) for x in n["terms"]}
    marks = re.findall(r"^\s*#\s*without a screen\s*:\s*(.*)$", ytext, re.M | re.I)
    without = set(re.findall(r"TERM-\d{3}", " ".join(marks)))
    problems = ["%s: 화면에도 '# without a screen'에도 없음" % m for m in models if m not in on_screen and m not in without]
    problems += ["%s: 화면에 있는데 '# without a screen'에도 적음" % m for m in without if m in on_screen]
    rep.add("S12", "읽기 모델 용어가 화면에 있거나 화면 없음으로 표시됨", problems,
            "읽기 모델 %d개: 화면 %d, 화면 없음 %s" % (len(models), sum(1 for m in models if m in on_screen), ", ".join(sorted(without))))

    # S13 할 일·배너의 이동 화면
    readme = (root / "docs/07-sitemap/README.md").read_text(encoding="utf-8")
    kinds = api["components"]["schemas"]["OwnerTask"]["properties"]["kind"]["enum"]
    banners = api["components"]["schemas"]["Me"]["properties"]["banners"]["items"]["enum"]
    home = next((n for n, _, _, _ in flat if n.get("opens_by_task")), None)
    problems = [] if home else ["opens_by_task가 있는 화면(할 일 목록)이 없음"]
    reach_home = set(home.get("opens") or []) | {c.get("id") for c in home.get("children") or []} if home else set()
    for key, names in (("opens_by_task", kinds), ("opens_by_banner", banners)):
        got = (home or {}).get(key) or {}
        problems += ["%s에 06단계의 '%s'가 없음" % (key, k) for k in names if k not in got]
        problems += ["%s의 '%s'는 06단계에 없는 값" % (key, k) for k in got if k not in names]
        for k, v in got.items():
            if v not in by:
                problems.append("%s '%s': 없는 화면 %s" % (key, k, v))
            elif v not in reach_home:
                problems.append("%s '%s': %s가 %s의 하위 화면이나 opens에 없음" % (key, k, v, home.get("id")))
    rep.add("S13", "할 일 유형·상단 배너마다 이동 화면", problems,
            "%s에서 할 일 유형 %d, 배너 %d" % (home.get("id") if home else "-", len(kinds), len(banners)))

    # S14 금지어
    page = (root / "docs/07-sitemap/sitemap.html").read_text(encoding="utf-8")
    page_text = html.unescape(re.sub(r"<style>.*?</style>|<[^>]+>", " ", page, flags=re.S))
    problems, notes = [], 0
    for name, text in (("sitemap.yaml", ytext), ("README.md", readme), ("sitemap.html", page_text)):
        body = re.sub(r"https?://\S+", "", text)
        for w, tid in avoided_words(dom):
            for m in re.finditer(re.escape(w), body):
                if allowed(w, body, m.start(), m.end()):
                    notes += 1
                else:
                    problems.append("%s: '%s'(%s의 금지어) …%s…" % (name, w, tid, body[max(0, m.start() - 12): m.end() + 12].replace("\n", " ")))
    rep.add("S14", "용어집 금지어 없음", problems, "허용 예외 %d곳" % notes)

    # S15 뷰 3종
    problems = []
    drawn = re.search(r'<p class="drawn" data-drawn="([^"]+)">', page)
    if not drawn:
        problems.append("생성 시각이 없음")
    board = re.search(r'<section id="board".*?</section>\s*(?=<section id="list")', page, re.S)
    board_ids = re.findall(r"SCR-\d{3}", "".join(re.findall(r'<pre class="mermaid">(.*?)</pre>', board.group(0), re.S))) if board else []
    list_ids = re.findall(r'<tr data-scr="(SCR-\d{3})"', page)
    slide_ids = re.findall(r'<li data-scr="(SCR-\d{3})"', page)
    for view, got in (("구조도", board_ids), ("화면 목록", list_ids), ("슬라이드", slide_ids)):
        if sorted(got) != sorted(ids):
            extra = sorted({x for x in got if got.count(x) > 1})
            miss = sorted(set(ids) - set(got))
            problems.append("%s: 화면 %d번 나옴(중복 %s, 누락 %s)" % (view, len(got), extra or "없음", miss or "없음"))
    edges = len(re.findall(r"S\d{3} --&gt; S\d{3}", board.group(0))) if board else 0
    if edges != len(ids) - len(roots):
        problems.append("구조도의 연결선 %d개(상위→하위 %d개여야 함)" % (edges, len(ids) - len(roots)))
    slides = len(re.findall(r'<article class="slide ', page))
    want_slides = len(roots) + sum(len(n.get("children") or []) for n in roots)
    if slides != want_slides:
        problems.append("슬라이드 %d장(루트 %d + 1뎁스 화면 %d = %d장이어야 함)" % (slides, len(roots), want_slides - len(roots), want_slides))
    rep.add("S15", "구조도·화면 목록·슬라이드에 화면마다 한 번", problems,
            "생성 시각 %s, 구조도 노드 %d·연결선 %d, 화면 목록 %d행, 슬라이드 %d장 %d항목" % (
                drawn.group(1) if drawn else "-", len(board_ids), edges, len(list_ids), slides, len(slide_ids)))

    # S16 생성 파일이 원본에서 다시 생성한 것과 같음
    r = subprocess.run([sys.executable, "-B", str(HERE / "build_sitemap.py"), str(root)], capture_output=True, text=True)
    rep.add("S16", "생성 파일이 원본과 일치(생성 시각 제외)", [] if r.returncode == 0 else [r.stdout.strip()],
            r.stdout.strip().splitlines()[0] if r.returncode == 0 and r.stdout.strip() else "")

    # S17 03단계 플로우 검사
    r = subprocess.run([sys.executable, "-B", str(root / "research/cake-flow-2026-11/check_flows.py"),
                        str(root / "docs/03-user-flow"), str(root / "docs/02-prd/requirements.md"),
                        str(root / "docs/01-domain/domain.md")], capture_output=True, text=True)
    pr = re.search(r"^PROBLEMS \((\d+)\)", r.stdout, re.M)
    av = re.search(r"^AVOIDED WORDS \((\d+)\)", r.stdout, re.M)
    ok = pr and av and pr.group(1) == "0" and av.group(1) == "0"
    rep.add("S17", "화면 표를 추가한 플로우 문서가 03단계 검사를 통과", [] if ok else ["check_flows.py: " + r.stdout[-400:]],
            "check_flows.py 문제 %s, 금지어 %s" % (pr.group(1) if pr else "?", av.group(1) if av else "?"))

    sys.exit(1 if rep.show() else 0)


if __name__ == "__main__":
    main()
