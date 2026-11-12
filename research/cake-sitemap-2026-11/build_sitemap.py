#!/usr/bin/env python3
"""07단계 사이트맵의 뷰를 원본에서 다시 생성한다.

원본(사람이든 AI든 여기만 고침)
- docs/07-sitemap/sitemap.yaml                 화면 트리
- docs/03-user-flow/FL-0xx-*.md 끝의 표         '화면'·'화면 없음 사유' 열(플로우 노드마다 화면)

생성하는 것(손으로 고치지 않음)
- 플로우 표의 '내용' 열(다이어그램의 노드 글)과 화면 이름, 다이어그램에 새로 생긴 노드의 빈 행
- docs/07-sitemap/README.md 마커 사이의 표
- docs/07-sitemap/sitemap.html 구조도·화면 목록·슬라이드(비교할 때는 생성 시각을 뺌)

    python3 -B research/cake-sitemap-2026-11/build_sitemap.py .           # 불일치만 확인
    python3 -B research/cake-sitemap-2026-11/build_sitemap.py . --write   # 다시 생성
"""
import datetime
import html
import re
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from vocab import ACCESS, AUDIENCES, REASONS  # noqa: E402

KST = datetime.timezone(datetime.timedelta(hours=9))
NODE = re.compile(r'^\s*([A-Za-z][A-Za-z0-9]*)(\(\[|\[\[|\[|\{)"(.*)"(\]\)|\]\]|\]|\})\s*$')
SHAPES = {"([": "stadium", "[[": "flow", "[": "step", "{": "decision"}
FLOW_BLOCK = re.compile(r"<!-- 07-sitemap:start.*?<!-- 07-sitemap:end -->", re.S)
FLOW_START = "<!-- 07-sitemap:start · '화면'·'화면 없음 사유' 열이 원본, 나머지 열은 build_sitemap.py가 생성 -->"
FLOW_END = "<!-- 07-sitemap:end -->"
ROW = re.compile(r"^\| (\w+) \| (.*?) \| (.*?) \| (.*?) \|$")
DRAWN_RE = re.compile(r'<p class="drawn" data-drawn="[^"]*">.*?</p>')
STROKE = {"guest": "#C08A12", "owner": "#3B82B0", "operator": "#8268C8"}


class Stop(SystemExit):
    pass


# ── 원본 읽기 ────────────────────────────────────────────────────────────────
def read_tree(root):
    """sitemap.yaml → (roots, screens). screens[id] = 노드 + parent·depth·root·kids."""
    tree = yaml.safe_load((root / "docs/07-sitemap/sitemap.yaml").read_text(encoding="utf-8"))
    screens, order = {}, []

    def walk(nodes, parent, depth, top):
        for n in nodes:
            i = n["id"]
            s = dict(n)
            s.update(parent=parent, depth=depth, root=top or i, kids=[c["id"] for c in n.get("children") or []])
            screens[i] = s
            order.append(i)
            walk(n.get("children") or [], i, depth + 1, top or i)

    walk(tree, None, 0, None)
    return [n["id"] for n in tree], screens, order


def read_flows(root):
    """{FL: path·title·text·nodes[(id, shape, label)]·rows{node: (scr, reason)}}."""
    out = {}
    for p in sorted((root / "docs/03-user-flow").glob("FL-0*.md")):
        text = p.read_text(encoding="utf-8")
        fl, title = re.search(r"^# (FL-\d{3}) (.+)$", text, re.M).groups()
        mer = re.search(r"```mermaid\n(.*?)```", text, re.S).group(1)
        nodes = [(m.group(1), SHAPES[m.group(2)], m.group(3)) for m in map(NODE.match, mer.splitlines()) if m]
        rows = {}
        block = FLOW_BLOCK.search(text)
        for line in (block.group(0).splitlines() if block else []):
            m = ROW.match(line)
            if m and m.group(1) != "노드":
                rows[m.group(1)] = (re.findall(r"SCR-\d{3}", m.group(3)), m.group(4).strip())
        out[fl] = {"path": p, "title": title.strip(), "text": text, "nodes": nodes, "rows": rows}
    return out


def table_flows(fls):
    got = {}
    for fl, f in fls.items():
        for scr, _ in f["rows"].values():
            for s in scr:
                got.setdefault(s, set()).add(fl)
    return got


# ── 플로우 문서의 '화면 (07단계)' 표 ─────────────────────────────────────────
def clean_label(label):
    t = label.replace("<br/>", " ").replace("<br>", " ").replace("#quot;", '"')
    t = re.sub(r"\(Claude 판단[^)]*\)", "", t)
    t = re.sub(r"REQ-\d{3}(?:,\s*REQ-\d{3})*", "", t)
    t = re.sub(r"\s+", " ", t).strip().rstrip(",").strip()
    return t.replace("|", "\\|")


def flow_section(fl, f, screens):
    need = [n for n, shape, _ in f["nodes"] if shape != "flow"]
    stray = [n for n in f["rows"] if n not in need]
    if stray:
        raise Stop("%s: 다이어그램에 없는 노드의 행 %s. 행을 지우거나 다이어그램을 확인한 뒤 다시 실행하세요" % (fl, ", ".join(stray)))
    labels = {n: lab for n, _, lab in f["nodes"]}
    lines = [
        FLOW_START,
        "## 화면 (07단계)",
        "",
        "노드마다 그 시점에 사람이 보는 화면을 적었습니다. 화면이 없으면 사유를 적었습니다"
        "(분기·서버 처리·외부·종료, 정의는 `docs/07-sitemap/README.md` 3절). "
        "다른 플로우로 연결되는 노드는 해당 플로우의 표에 있습니다. 화면 목록은 `docs/07-sitemap/sitemap.yaml`.",
        "",
        "| 노드 | 내용 | 화면 | 화면 없음 사유 |",
        "| --- | --- | --- | --- |",
    ]
    for n in need:
        scr, reason = f["rows"].get(n, ([], ""))
        cell = ", ".join("%s %s" % (s, screens[s]["name"]) if s in screens else s for s in scr)
        lines.append("| %s | %s | %s | %s |" % (n, clean_label(labels[n]), cell, reason))
    lines.append(FLOW_END)
    return "\n".join(lines)


def with_flow_section(text, section):
    if FLOW_BLOCK.search(text):
        return FLOW_BLOCK.sub(lambda m: section, text)
    return text.rstrip("\n") + "\n\n" + section + "\n"


# ── README의 생성 표 ─────────────────────────────────────────────────────────
def md_table(head, rows):
    out = ["| " + " | ".join(head) + " |", "|" + "|".join(" --- " for _ in head) + "|"]
    return "\n".join(out + ["| " + " | ".join(str(c) for c in r) + " |" for r in rows])


def readme_blocks(roots, screens, order, fls):
    blocks = {}
    per_root = {r: sum(1 for i in order if screens[i]["root"] == r) for r in roots}
    used_flows = {f for i in order for f in screens[i].get("flows") or []}
    blocks["counts"] = "화면 %d개: %s. 화면에 연결된 플로우 %d/%d개, 화면에 매핑된 API %d개, SPEC %d개." % (
        len(order), ", ".join("%s %d" % (screens[r]["audience"], per_root[r]) for r in roots),
        len(used_flows), len(fls),
        len({a for i in order for a in screens[i].get("apis") or []}),
        len({x for i in order for x in screens[i].get("specs") or []}))

    blocks["access"] = md_table(["접근 권한", "정의", "화면 수"],
                                [[a, d, sum(1 for i in order if screens[i]["access"] == a)] for a, d in ACCESS.items()])

    count = {k: 0 for k in REASONS}
    total = with_screen = 0
    for f in fls.values():
        for scr, reason in f["rows"].values():
            total += 1
            if scr:
                with_screen += 1
            elif reason in count:
                count[reason] += 1
    links = sum(1 for f in fls.values() for _, shape, _ in f["nodes"] if shape == "flow")
    blocks["reasons"] = md_table(["사유", "정의", "노드 수"], [[k, v, count[k]] for k, v in REASONS.items()]) + \
        "\n\n플로우 노드 %d개 가운데 화면이 있는 노드 %d개, 사유를 적은 노드 %d개입니다(다른 플로우 연결 노드 %d개는 제외)." % (
            total, with_screen, total - with_screen, links)

    rows = []
    for i in order:
        s = screens[i]
        name = ("　" * s["depth"]) + ("└ " if s["depth"] else "") + s["name"]
        path = "`%s`" % s["path"] + "".join("<br>`%s`" % a for a in s.get("also_paths") or [])
        rows.append([i, name, path, s["access"], ", ".join(s.get("flows") or []) or "없음(5절)"])
    blocks["screens"] = md_table(["ID", "화면", "경로", "접근 권한", "플로우"], rows)

    blocks["noflow"] = md_table(["ID", "화면", "플로우 노드가 없는 사유"],
                                [[i, screens[i]["name"], screens[i]["no_flow"]] for i in order if screens[i].get("no_flow")])

    rows = []
    for i in order:
        s = screens[i]
        terms = s.get("terms")
        rows.append([i, ", ".join(s.get("specs") or []), ", ".join(s.get("apis") or []) or "없음(먼저 보내는 안내)",
                     ", ".join(terms) if isinstance(terms, list) else "none", ", ".join(s.get("opens") or [])])
    blocks["details"] = md_table(["ID", "SPEC", "API", "용어", "이동 화면(하위 화면 외)"], rows)

    home = next(screens[i] for i in order if screens[i].get("opens_by_task"))
    blocks["tasks"] = md_table(["할 일 유형(kind)", "이동 화면"],
                               [["`%s`" % k, "%s %s" % (v, screens[v]["name"])] for k, v in home["opens_by_task"].items()]) + \
        "\n\n" + md_table(["상단 배너(banners)", "이동 화면"],
                          [["`%s`" % k, "%s %s" % (v, screens[v]["name"])] for k, v in home["opens_by_banner"].items()])
    return blocks


def with_readme_blocks(text, blocks):
    for name, body in blocks.items():
        start, end = "<!-- 07-sitemap:%s:start -->" % name, "<!-- 07-sitemap:%s:end -->" % name
        if start not in text:
            raise Stop("README에 %s 표시가 없음" % start)
        text = re.sub(re.escape(start) + r".*?" + re.escape(end), lambda m: start + "\n" + body + "\n" + end, text, flags=re.S)
    return text


# ── sitemap.html (구조도·화면 목록·슬라이드) ──────────────────────────────────
def e(s):
    return html.escape(str(s), quote=True)


def subtree(i, screens):
    out = [i]
    for k in screens[i]["kids"]:
        out += subtree(k, screens)
    return out


def mermaid_for(r, screens):
    members = subtree(r, screens)
    out = ["flowchart LR"]
    for i in members:
        s = screens[i]
        out.append('  S%s["%s · %s<br/>%s<br/>%s"]' % (i[4:], i, s["access"], s["name"], s["path"]))
    for i in members:
        for k in screens[i]["kids"]:
            out.append("  S%s --> S%s" % (i[4:], k[4:]))
    cls = AUDIENCES[screens[r]["audience"]]
    out.append("  classDef %s stroke:%s,stroke-width:2px" % (cls, STROKE[cls]))
    out.append("  class %s %s" % (",".join("S" + i[4:] for i in members), cls))
    return "\n".join(out)


def slides_of(roots, screens):
    """(root, title, members, branches): 루트마다 첫 장은 루트 화면, 그다음 1뎁스 화면마다 한 장."""
    out = []
    for r in roots:
        s = screens[r]
        out.append((r, "%s 루트: %s" % (s["audience"], s["name"]), [r], [screens[k]["name"] for k in s["kids"]]))
        for k in s["kids"]:
            out.append((r, screens[k]["name"], subtree(k, screens), []))
    return out


def build_html(roots, screens, order, fls, drawn):
    per_root = {r: sum(1 for i in order if screens[i]["root"] == r) for r in roots}

    board = []
    for r in roots:
        cls = AUDIENCES[screens[r]["audience"]]
        board.append(
            '<section class="board-part" aria-labelledby="b-%s">\n'
            '<h3 id="b-%s"><span class="dot %s" aria-hidden="true"></span>%s <span class="count">%d개</span></h3>\n'
            '<div class="scroll"><pre class="mermaid">\n%s\n</pre></div>\n</section>'
            % (cls, cls, cls, e(screens[r]["audience"]), per_root[r], e(mermaid_for(r, screens))))

    rows = []
    for r in roots:
        cls = AUDIENCES[screens[r]["audience"]]
        rows.append('<tr class="group %s"><th colspan="5" scope="rowgroup"><span class="dot %s" aria-hidden="true"></span>%s · %d개</th></tr>'
                    % (cls, cls, e(screens[r]["audience"]), per_root[r]))
        for i in order:
            s = screens[i]
            if s["root"] != r:
                continue
            paths = "<code>%s</code>" % e(s["path"]) + "".join("<br><code>%s</code>" % e(a) for a in s.get("also_paths") or [])
            fl = " ".join('<span class="fl" title="%s">%s</span>' % (e(fls[f]["title"]), f[3:]) for f in s.get("flows") or []) \
                or '<span class="none">없음</span>'
            rows.append('<tr data-scr="%s"><td class="id">%s</td><td class="name" style="--depth:%d">%s</td>'
                        '<td class="path">%s</td><td><span class="access">%s</span></td><td class="flows">%s</td></tr>'
                        % (i, i, s["depth"], e(s["name"]), paths, e(s["access"]), fl))

    deck = slides_of(roots, screens)
    slides = []
    for n, (r, title, members, branches) in enumerate(deck, 1):
        cls = AUDIENCES[screens[r]["audience"]]
        base = min(screens[m]["depth"] for m in members)
        items = "".join('<li data-scr="%s" style="--depth:%d"><span class="id">%s</span> <span class="sname">%s</span>'
                        '<span class="meta"><code>%s</code> · %s</span></li>'
                        % (m, screens[m]["depth"] - base, m, e(screens[m]["name"]), e(screens[m]["path"]), e(screens[m]["access"]))
                        for m in members)
        more = '<p class="branches">1뎁스 화면 %d개: %s</p>' % (len(branches), e(" · ".join(branches))) if branches else ""
        fl = sorted({f for m in members for f in screens[m].get("flows") or []})
        fl_html = "".join('<li><span class="fl">%s</span> %s</li>' % (f[3:], e(fls[f]["title"])) for f in fl) \
            or '<li class="none">연결된 플로우 노드 없음</li>'
        slides.append(
            '<article class="slide %s" aria-label="슬라이드 %d">\n'
            '<header><span class="aud %s">%s</span><span class="num">%d / %d</span></header>\n'
            '<h3>%s</h3>\n<div class="slide-body"><ul class="screens">%s</ul>%s\n'
            '<div class="slide-flows"><h4>이 화면이 쓰이는 플로우</h4><ul>%s</ul></div></div>\n</article>'
            % (cls, n, cls, e(screens[r]["audience"]), n, len(deck), e(title), items, more, fl_html))

    stats = "".join('<div><dt>%s</dt><dd>%d</dd></div>' % (e(screens[r]["audience"]), per_root[r]) for r in roots)
    used = len({f for i in order for f in screens[i].get("flows") or []})
    template = (HERE / "sitemap_page.html").read_text(encoding="utf-8")
    return (template
            .replace("{{DRAWN}}", '<p class="drawn" data-drawn="%s">생성 시각 %s · 원본 <code>docs/07-sitemap/sitemap.yaml</code></p>' % (drawn, drawn))
            .replace("{{TOTAL}}", str(len(order)))
            .replace("{{STATS}}", stats)
            .replace("{{FLOWS}}", "%d/%d" % (used, len(fls)))
            .replace("{{SLIDES_N}}", str(len(deck)))
            .replace("{{BOARD}}", "\n".join(board))
            .replace("{{ROWS}}", "\n".join(rows))
            .replace("{{SLIDES}}", "\n".join(slides)))


# ── 실행 ────────────────────────────────────────────────────────────────────
def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    root = Path(args[0] if args else ".").resolve()
    roots, screens, order = read_tree(root)
    fls = read_flows(root)
    outputs = {}
    for fl, f in fls.items():
        outputs[f["path"]] = with_flow_section(f["text"], flow_section(fl, f, screens))
    readme = root / "docs/07-sitemap/README.md"
    outputs[readme] = with_readme_blocks(readme.read_text(encoding="utf-8"), readme_blocks(roots, screens, order, fls))
    page = root / "docs/07-sitemap/sitemap.html"
    drawn = datetime.datetime.now(KST).strftime("%Y-%m-%d %H:%M KST")
    outputs[page] = build_html(roots, screens, order, fls, drawn)

    diff = []
    for path, text in outputs.items():
        old = path.read_text(encoding="utf-8") if path.exists() else None
        same = old is not None and (DRAWN_RE.sub("", old) == DRAWN_RE.sub("", text) if path == page else old == text)
        if not same:
            diff.append(path.relative_to(root))
            if write:
                path.write_text(text, encoding="utf-8")
    if write:
        print("다시 생성한 파일 %d개" % len(diff) + "".join("\n  %s" % d for d in diff))
    elif diff:
        print("원본과 다른 생성 파일 %d개 (--write로 다시 생성)" % len(diff) + "".join("\n  %s" % d for d in diff))
        sys.exit(1)
    else:
        print("생성 파일이 원본과 같음 (%d개)" % len(outputs))


if __name__ == "__main__":
    main()
