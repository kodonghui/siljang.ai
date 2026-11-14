#!/usr/bin/env python3
"""08단계 화면 정의와 와이어프레임을 원본에서 다시 생성한다.

원본(사람이든 AI든 여기만 고침)
- research/cake-screens-2026-11/screens_*.py  화면마다 목적·데이터·액션·상태·응답 예외·케이스 유형·레이아웃·긴 글
- docs/07-sitemap/sitemap.yaml                경로·접근 권한·상위 화면·플로우·SPEC·API
- api/openapi.yaml                            API마다의 응답 목록(2xx는 예시 이름, 오류는 오류 코드)
- docs/06-api/README.md 6절·7절              오류 코드의 '화면에 보이는 말', 저장 전 확인 문구, 카카오 스킬 결과
- research/cake-mockup-2026-11/canvas/project/canvas.json  09단계 목업 보드(화면 정의의 '목업' 줄. 없으면 그 줄을 쓰지 않음)

생성하는 것(손으로 고치지 않음)
- docs/08-screens/SCR-0xx.md 50개             화면 정의(06단계 응답마다 상태 하나)
- docs/08-screens/README.md 마커 사이의 표      화면 목록·상태·손님 문구·결정 사항
- docs/08-screens/wireframes.html             회색조 와이어프레임(상태마다 360·1280 프레임)

    python3 -B research/cake-screens-2026-11/build_screens.py .           # 불일치만 확인
    python3 -B research/cake-screens-2026-11/build_screens.py . --write   # 다시 생성

screens_*.py의 scr() 키
- shell: public·kakao·login·owner·owner-setup·operator(와이어프레임의 화면 틀)
- purpose: 한 문장. 끝에 '(FL-…)'나 '(플로우 노드 없음: 사유)'
- data: [(데이터, 출처)]  출처는 'API-0xx …'나 '서버 안내'·'화면' 같은 말
- actions: [(액션, 결과, 실패)]
- states: [(상태, 설명, 프레임)]  프레임 None이면 normal은 레이아웃, loading은 회색 막대.
          읽기 전용 결과(f_result)는 폼·버튼 줄을 빼고 남긴 값을 그 자리에 보임
- na: {기본 상태: 해당 없는 이유}
- resp: {'API-0xx#코드:예시나 오류 코드': (상태 또는 '-', 문구나 None)}  코드 부분에 '='가 있으면 계약 예시 밖의 화면 변형 행
- kinds: {케이스 유형: 화면에 보이는 것}
- layout: [블록]  screens_common.py의 bar·kv·list·form·btns 등
- wide: 1280 배치(없으면 1280도 한 열). {'top'·'left'·'right'·'bottom': [블록 이름 또는 1280에만 있는 블록], 'ratio': 'even'·'main'·'side'}
        블록 이름은 표·폼·사진·캘린더·제목·안내의 이름, 버튼 줄은 첫 버튼 이름. 레이아웃의 블록은 모두 한 번씩 놓음
- long: [(항목, 한도, 화면에서)]
"""
import html
import json
import re
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import screens_common as C  # noqa: E402
import screens_guest  # noqa: E402,F401
import screens_owner_a  # noqa: E402,F401
import screens_owner_b  # noqa: E402,F401
import screens_operator  # noqa: E402,F401


class Stop(SystemExit):
    pass


KIND_LABEL = {"접근": "접근", "입력": "입력", "대상": "대상", "상태": "상태 변화", "반복": "반복", "동시": "동시 변경",
              "한도": "한도", "외부": "외부 서비스", "노출": "데이터 노출", "빈·끊김": "빈 응답·끊긴 응답", "AI": "AI 답"}
SHELL_NAME = {"public": "손님 웹 페이지(360 한 열, 1280 가운데 열)", "kakao": "카카오톡 채널 대화 화면(1280은 PC 카카오톡 창)",
              "login": "로그인(가운데 카드)", "owner": "사장님 화면(1280 왼쪽 메뉴, 360 위쪽 막대와 메뉴 버튼)",
              "owner-setup": "가게 등록 전 사장님 화면(메뉴 없음)", "operator": "운영자 화면(1280 왼쪽 메뉴, 360 위쪽 막대와 메뉴 버튼)"}
VARIANT_NOTE = "※ 06단계 계약의 예시에는 없고 이 화면이 응답 값으로 나눈 경우"
MOCKUP = "research/cake-mockup-2026-11/canvas/project"


def read_mockups(root):
    """09단계 목업: canvas.json의 SCR-0xx-360·1280 보드마다 (보드 제목 끝의 그린 상태, 캔버스 페이지 이름)"""
    path = root / MOCKUP / "canvas.json"
    if not path.exists():
        return {}
    canvas = json.loads(path.read_text(encoding="utf-8"))
    pages = {p["id"]: p["name"] for p in canvas.get("pages", [])}
    out = {}
    for name, b in canvas.get("boards", {}).items():
        m = re.fullmatch(r"(SCR-\d{3})-(360|1280)\.dc\.html", name)
        if m:
            out.setdefault(m.group(1), {})[m.group(2)] = (b.get("title", "").rsplit(" · ", 1)[-1], pages.get(b.get("page"), ""))
    return out


# ── 원본 읽기 ────────────────────────────────────────────────────────────────
def read_tree(root):
    tree = yaml.safe_load((root / "docs/07-sitemap/sitemap.yaml").read_text(encoding="utf-8"))
    nodes, order = {}, []

    def walk(items, parent, depth, top):
        for n in items:
            i = n["id"]
            s = dict(n)
            s.update(parent=parent, depth=depth, root=top or i, kids=[c["id"] for c in n.get("children") or []])
            nodes[i] = s
            order.append(i)
            walk(n.get("children") or [], i, depth + 1, top or i)

    walk(tree, None, 0, None)
    return [n["id"] for n in tree], nodes, order


def read_api(root):
    doc = yaml.safe_load((root / "api/openapi.yaml").read_text(encoding="utf-8"))

    def deref(o):
        while isinstance(o, dict) and "$ref" in o:
            cur = doc
            for p in o["$ref"].lstrip("#/").split("/"):
                cur = cur[p]
            o = cur
        return o

    ops = {}
    for path, item in doc["paths"].items():
        for method, op in item.items():
            if not isinstance(op, dict) or "x-corthex" not in op:
                continue
            aid = op["x-corthex"]["id"]
            rows = []
            for status, r in op.get("responses", {}).items():
                r = deref(r)
                exs = []
                for media in (r.get("content") or {}).values():
                    for name, ex in (media.get("examples") or {}).items():
                        exs.append((name, deref(ex).get("value")))
                if str(status).startswith("2"):
                    for name, _ in exs or [(None, None)]:
                        rows.append((str(status), name))
                else:
                    codes = []
                    for name, val in exs:
                        code = val.get("code") if isinstance(val, dict) else None
                        code = code or name
                        if code not in codes:
                            codes.append(code)
                    for code in codes or [None]:
                        rows.append((str(status), code))
            ops[aid] = {"method": method.upper(), "path": path, "summary": op.get("summary", ""), "rows": rows}
    return ops


def generated_table(text, name):
    m = re.search(r"<!-- BEGIN generated:%s -->\n(.*?)<!-- END generated:%s -->" % (name, name), text, re.S)
    if not m:
        raise Stop("06단계 README에 generated:%s 표가 없음" % name)
    rows = []
    for line in m.group(1).splitlines():
        if not line.startswith("| ") or line.startswith("| ---"):
            continue
        rows.append([c.strip() for c in line.strip().strip("|").split(" | ")])
    return rows[1:]


def read_contract_text(root):
    text = (root / "docs/06-api/README.md").read_text(encoding="utf-8")
    errors = {r[0].strip("`"): {"status": r[1], "message": r[3]} for r in generated_table(text, "errors")}
    confirms = {r[0].strip("`"): r[3] for r in generated_table(text, "confirmations")}
    outcomes = {r[0].strip("`"): r[3] for r in generated_table(text, "skill-outcomes")}
    return errors, confirms, outcomes


# ── 화면 모델 ────────────────────────────────────────────────────────────────
def quote(t):
    if t.startswith("(") or " + " in t or " / " in t:
        return t
    return "'%s'" % t


def flows_in_purpose(purpose):
    m = re.search(r"\(([^()]*)\)\s*$", purpose)
    if not m:
        return None, None
    inner = m.group(1)
    if inner.startswith("플로우 노드 없음:"):
        return [], inner[len("플로우 노드 없음:"):].strip()
    return re.findall(r"FL-\d{3}", inner), None


def build_model(root):
    roots, nodes, order = read_tree(root)
    ops = read_api(root)
    errors, confirms, outcomes = read_contract_text(root)
    problems = []
    model = []
    for sid in order:
        node = nodes[sid]
        s = C.SCREENS.get(sid)
        if s is None:
            problems.append("%s: 화면 정의가 없음" % sid)
            continue
        s = dict(s)
        s["states"] = [tuple(st[:3]) + (list(st[3]) if len(st) > 3 else [],) for st in s["states"]]
        states = [st[0] for st in s["states"]]
        described = set(states)
        for st in states:
            if st not in C.STATE_INFO:
                problems.append("%s: 알 수 없는 상태 %s" % (sid, st))
        if len(states) != len(described):
            problems.append("%s: 상태 중복" % sid)
        for st in C.STD_STATES:
            if st in described and st in s["na"]:
                problems.append("%s: %s가 상태와 해당 없음에 함께 있음" % (sid, st))
            if st not in described and not str(s["na"].get(st, "")).strip():
                problems.append("%s: 기본 상태 %s가 없고 해당 없는 이유도 없음" % (sid, st))
        for a in s["actions"]:
            if len(a) != 3 or not all(str(x).strip() for x in a):
                problems.append("%s: 액션 %s에 결과나 실패가 빠짐" % (sid, a[0]))
        fls, reason = flows_in_purpose(s["purpose"])
        if fls is None:
            problems.append("%s: 목적 끝에 (FL-…)이나 (플로우 노드 없음: 사유)가 없음" % sid)
        elif sorted(fls) != sorted(node.get("flows") or []):
            problems.append("%s: 목적의 플로우 %s와 사이트맵 flows %s가 다름" % (sid, fls, node.get("flows")))
        elif not fls and not reason:
            problems.append("%s: 플로우 노드 없음 사유가 비어 있음" % sid)
        resp = dict(s.get("resp") or {})
        rows = []
        seen = set()
        apis = node.get("apis") or []
        for api in apis:
            op = ops.get(api)
            if op is None:
                problems.append("%s: 계약에 없는 %s" % (sid, api))
                continue
            for status, code in op["rows"]:
                key = "%s#%s" % (api, status) + (":%s" % code if code else "")
                if key in seen:
                    continue
                seen.add(key)
                rows.append({"key": key, "api": api, "status": status, "code": code, "variant": False, "method": op["method"]})
        for key in resp:
            if key in seen:
                continue
            m = re.fullmatch(r"(API-\d{3})#(\w+):(.+)", key)
            if m and "=" in m.group(3) and m.group(1) in apis and any(st == m.group(2) for st, _ in ops[m.group(1)]["rows"]):
                rows.append({"key": key, "api": m.group(1), "status": m.group(2), "code": m.group(3), "variant": True,
                             "method": ops[m.group(1)]["method"]})
                seen.add(key)
            else:
                problems.append("%s: resp의 %s가 이 화면 API의 응답에 없음" % (sid, key))
        for r in rows:
            api, status, code = r["api"], r["status"], r["code"]
            if r["key"] in resp:
                state, text = resp[r["key"]]
            else:
                state, text = C.default_state(sid, api, status, code or ""), None
            if state is None:
                problems.append("%s: %s의 상태를 화면이 정해야 함(카카오 스킬 결과)" % (sid, r["key"]))
                state = "-"
            if state != "-" and state not in described:
                problems.append("%s: %s가 이끄는 %s가 상태 목록에 없음" % (sid, r["key"], state))
            if state == "-" and not text:
                problems.append("%s: %s가 나오지 않는 이유가 없음" % (sid, r["key"]))
            if not text:
                if status.startswith("2"):
                    if api in C.SKILL_APIS:
                        text = quote(C.OUTCOME_TEXT[code]) if code in C.OUTCOME_TEXT else None
                    else:
                        text = C.OK_TEXT.get((api, code or status))
                        if text is None and r["method"] == "GET":
                            text = "받은 데이터를 보임"
                elif api in C.SKILL_APIS:
                    text = C.SKILL_HTTP_TEXT
                else:
                    msg = errors.get(code or "", {}).get("message")
                    text = "'%s'" % msg if msg else None
            if not text:
                problems.append("%s: %s에서 화면에 보이는 것이 없음" % (sid, r["key"]))
            r["state"], r["text"] = state, text or ""
        keys = {r["key"] for r in rows}
        also = {}
        for name, _, _, extra in s["states"]:
            for k in extra:
                if k not in keys:
                    problems.append("%s#%s: 함께 적은 응답 %s가 이 화면의 응답에 없음" % (sid, name, k))
                also.setdefault(k, []).append(name)
        for r in rows:
            r["also"] = [x for x in also.get(r["key"], []) if x != r["state"]]
        if s.get("wide"):
            try:
                plan_wide(sid, [b for b in s["layout"] if b[0] not in ("bar", "kbar")], s["wide"])
            except Stop as err:
                problems.append(str(err))
        model.append({"id": sid, "node": node, "s": s, "rows": rows, "flows": fls or [], "no_flow": reason})
    for sid in C.SCREENS:
        if sid not in nodes:
            problems.append("%s: 사이트맵에 없는 화면 정의" % sid)
    return roots, nodes, order, model, problems, (errors, confirms, outcomes)


# ── Markdown ────────────────────────────────────────────────────────────────
def cell(t):
    return str(t).replace("|", "\\|").replace("\n", " ").strip()


def md_table(head, rows):
    out = ["| " + " | ".join(head) + " |", "|" + "|".join(" --- " for _ in head) + "|"]
    return "\n".join(out + ["| " + " | ".join(cell(c) for c in r) + " |" for r in rows])


def menu_of(sid, nodes, roots):
    node = nodes[sid]
    top = node["root"]
    chain = [sid]
    while nodes[chain[-1]]["parent"]:
        chain.append(nodes[chain[-1]]["parent"])
    first = chain[-2] if len(chain) >= 2 else None
    return top, first


def screen_md(m, nodes, mockups=None):
    sid, node, s = m["id"], m["node"], m["s"]
    parent = node["parent"]
    lines = ["# %s %s" % (sid, node["name"]), ""]
    lines.append("- 경로: `%s`" % node["path"])
    if node.get("also_paths"):  # 사이트맵의 둘째 경로(설계 재검토 낮음 RE-14)
        lines.append("- 다른 경로: %s" % ", ".join("`%s`" % p for p in node["also_paths"]))
    lines.append("- 접근 권한: %s" % node["access"])
    lines.append("- 상위 화면: %s" % ("%s %s" % (parent, nodes[parent]["name"]) if parent else "없음(루트)"))
    lines.append("- 화면 레이아웃: %s" % SHELL_NAME[s["shell"]])
    lines.append("- 플로우: %s" % (", ".join(m["flows"]) if m["flows"] else "플로우 노드 없음(%s)" % m["no_flow"]))
    lines.append("- 관련 SPEC: %s" % (", ".join(node.get("specs") or []) or "없음"))
    lines.append("- API: %s" % (", ".join(node.get("apis") or []) or "없음(서버가 보내는 안내만 보임)"))
    lines.append("- 와이어프레임: `wireframes.html#%s`(상태 %d개, 360·1280)" % (sid, len(s["states"])))
    mk = (mockups or {}).get(sid) or {}
    if set(mk) == {"360", "1280"}:
        links = ", ".join("[`%s-%s`](../../%s/%s-%s.dc.html)(%s)" % (sid, w, MOCKUP, sid, w, mk[w][0].replace(", ", "·"))
                          for w in ("360", "1280"))
        lines.append("- 목업: %s. 캔버스의 '%s' 페이지([09단계 README](../09-mockup/README.md) 2절)" % (links, mk["360"][1]))
    lines += ["", "목적: " + s["purpose"], "", "## 데이터", ""]
    lines.append(md_table(["데이터", "출처"], s["data"]) if s["data"] else "보이는 데이터가 없습니다.")
    lines += ["", "## 액션", "", md_table(["액션", "결과", "실패"], s["actions"]) if s["actions"] else "액션이 없습니다."]
    by_state = {}
    for r in m["rows"]:
        by_state.setdefault(r["state"], []).append(r["key"])
        for x in r["also"]:
            by_state.setdefault(x, []).append(r["key"] + "(내용에 따라)")
    srows = []
    for name, text, _, _ in s["states"]:
        resp = by_state.get(name, [])
        if not resp:
            resp_text = {"loading": "(데이터를 불러오는 동안)", "confirm": "(화면이 여는 확인 창)", "confirm-notify": "(화면이 여는 확인 창)"}.get(name, "-")
        else:
            resp_text = ", ".join(resp)
        srows.append(["%s#%s" % (sid, name), text, resp_text])
    for name in C.STD_STATES:
        if name in s["na"]:
            srows.append(["%s (해당 없음)" % name, s["na"][name], ""])
    lines += ["", "## 상태", "", md_table(["상태", "사용자가 보는 것과 할 수 있는 것", "이 상태로 오는 응답"], srows)]
    if m["rows"]:
        rrows = []
        for r in m["rows"]:
            st = "%s#%s" % (sid, r["state"]) if r["state"] != "-" else "나오지 않음"
            if r["also"]:
                st += ". 내용에 따라 " + ", ".join("%s#%s" % (sid, x) for x in r["also"])
            rrows.append([r["key"] + (" ※" if r["variant"] else ""), st, r["text"]])
        lines += ["", "## 응답과 상태", "",
                  "06단계 계약(`api/openapi.yaml`)의 응답마다 화면 상태 하나입니다. 오류의 문구는 06단계 오류 코드 표의 '화면에 보이는 말'입니다.", "",
                  md_table(["응답", "화면 상태", "화면에 보이는 것"], rrows)]
        if any(r["variant"] for r in m["rows"]):
            lines += ["", VARIANT_NOTE]
    krows = [[KIND_LABEL[k], v] for k, v in s["kinds"].items()]
    krows.append(["화면 상태", "상태마다 360·1280 와이어프레임(`wireframes.html#%s`)" % sid])
    lines += ["", "## 케이스 유형", "", md_table(["케이스 유형", "화면에 보이는 것"], krows)]
    lines += ["", "## 긴 글과 좁은 화면", "", md_table(["항목", "한도", "화면에서"], s["long"])]
    lines += ["", "<!-- build_screens.py가 research/cake-screens-2026-11/screens_*.py에서 생성. 손으로 고치지 않음 -->", ""]
    return "\n".join(lines)


def readme_blocks(model, nodes, roots, contract):
    errors, confirms, outcomes = contract
    blocks = {}
    rows = []
    for m in model:
        s = m["s"]
        na = [k for k in C.STD_STATES if k in s["na"]]
        rows.append(["[%s](%s.md)" % (m["id"], m["id"]), m["node"]["name"], nodes[m["node"]["root"]].get("audience", ""),
                     " · ".join(st[0] for st in s["states"]), " · ".join(na) or "-", len(m["rows"])])
    blocks["screens"] = md_table(["화면", "이름", "사용자", "상태", "해당 없는 기본 상태", "응답 행"], rows)
    count = {}
    for m in model:
        for st in m["s"]["states"]:
            count[st[0]] = count.get(st[0], 0) + 1
    srows = []
    for name, info in C.STATE_INFO.items():
        srows.append(["`%s`" % name, "기본" if name in C.STD_STATES else "화면 고유(W3)", info, count.get(name, 0)])
    blocks["states"] = md_table(["상태 이름", "분류", "뜻", "쓰는 화면 수"], srows)
    orows = []
    for code, text in C.OUTCOME_TEXT.items():
        base = outcomes.get(code, "")
        orows.append(["`%s`" % code, text, "08단계에서 바꿈: " + C.OUTCOME_CHANGED[code] if code in C.OUTCOME_CHANGED else "06단계 뼈대 그대로"])
    blocks["outcomes"] = md_table(["결과", "손님에게 가는 말", "06단계와 비교"], orows)
    crows = [["`%s`" % k, v] for k, v in C.CONFIRM_MSG.items()]
    blocks["confirms"] = md_table(["확인할 것", "확인 창의 말(06단계 6절과 같음)"], crows)
    drows = [[d[0], d[1], d[2], d[3], d[4]] for d in C.DECISIONS]
    blocks["decisions"] = md_table(["ID", "결정할 것", "제안", "이유", "대안과 그 결과"], drows)
    return blocks


def with_blocks(text, blocks):
    for name, body in blocks.items():
        start, end = "<!-- 08-screens:%s:start -->" % name, "<!-- 08-screens:%s:end -->" % name
        if start not in text:
            raise Stop("README에 %s 표시가 없음" % start)
        text = re.sub(re.escape(start) + r".*?" + re.escape(end), lambda mm: start + "\n" + body + "\n" + end, text, flags=re.S)
    return text


# ── 와이어프레임 ─────────────────────────────────────────────────────────────
def e(s):
    return html.escape(str(s), quote=True)


def t(s, cls="t"):
    return '<span class="%s">%s</span>' % (cls, e(s))


def label_of(b):
    if b[0] in ("kv", "list", "form", "photos", "cal"):
        return b[1]
    if b[0] == "text":
        return b[2]
    return None


def bkey(b):
    """1280 배치(wide)에서 블록을 부르는 이름."""
    k = b[0]
    if k in ("btns", "tabs"):
        return b[1][0]
    if k == "text":
        return b[2]
    if k == "chat":
        return "chat"
    return b[1]


WIDE_GROUPS = ("top", "left", "right", "bottom")
WIDE_RATIO = ("even", "main", "side")


def plan_wide(sid, blocks, wide):
    """1280 배치 확인: 그룹마다 [('i', 블록 위치) 또는 ('x', 1280에만 있는 블록)]."""
    keys = [bkey(b) for b in blocks]
    dup = sorted({k for k in keys if keys.count(k) > 1})
    if dup:
        raise Stop("%s: wide로 놓을 블록 이름이 겹침 %s" % (sid, dup))
    bad = set(wide) - set(WIDE_GROUPS) - {"ratio"}
    if bad or wide.get("ratio", "even") not in WIDE_RATIO:
        raise Stop("%s: wide의 키나 ratio가 틀림 %s" % (sid, sorted(bad) or wide.get("ratio")))
    placed, plan = set(), {}
    for g in WIDE_GROUPS:
        items = []
        for ref in wide.get(g, []):
            if isinstance(ref, tuple):
                items.append(("x", ref))
            elif ref in keys and keys.index(ref) not in placed:
                placed.add(keys.index(ref))
                items.append(("i", keys.index(ref)))
            else:
                raise Stop("%s: wide의 '%s'가 레이아웃에 없거나 두 번 놓임" % (sid, ref))
        plan[g] = items
    rest = [keys[i] for i in range(len(keys)) if i not in placed]
    if rest:
        raise Stop("%s: wide에 놓지 않은 블록 %s" % (sid, rest))
    if not plan["left"] or not plan["right"]:
        raise Stop("%s: wide의 left·right가 비어 있음" % sid)
    return plan


def arrange(sid, s, blocks, htmls, w, extras=True):
    """블록 HTML을 360은 한 열로, 1280은 wide 배치대로 놓는다. extras=False면 1280에만 있는 블록을 뺀다."""
    wide = s.get("wide")
    if not wide or w != 1280:
        return "".join(htmls)
    plan = plan_wide(sid, blocks, wide)

    def part(items):
        return "".join(htmls[x] if kind == "i" else (r_block(x, w) if extras else "") for kind, x in items)

    left, right = part(plan["left"]), part(plan["right"])
    mid = ('<div class="cols %s"><div class="c">%s</div><div class="c">%s</div></div>' % (wide.get("ratio", "even"), left, right)
           if left and right else left + right)
    return part(plan["top"]) + mid + part(plan["bottom"])


def r_btns(labels, primary, danger, busy=None, disabled=False):
    out = []
    for i, lab in enumerate(labels):
        cls = "btn"
        if i == primary:
            cls += " pri"
        if danger is not None and i == danger:
            cls += " dan"
        if busy is not None and i == busy[0]:
            out.append('<span class="%s busy">%s</span>' % (cls, t(busy[1])))
            continue
        if disabled:
            cls += " off"
        out.append('<span class="%s">%s</span>' % (cls, t(lab)))
    return '<div class="btns">%s</div>' % "".join(out)


def r_block(b, w, busy=None, disabled=False):
    k = b[0]
    if k == "bar":
        return ""  # 틀이 그림
    if k == "kbar":
        return ""
    if k == "h":
        return '<h4 class="b-h">%s</h4>' % t(b[1])
    if k == "kv":
        rows = "".join('<div class="kv-r"><span class="k">%s</span><span class="v">%s</span></div>' % (t(a), t(v)) for a, v in b[2])
        return '<section class="card"><div class="cap">%s</div>%s</section>' % (t(b[1]), rows)
    if k == "list":
        label, cols, n = b[1], b[2], b[3]
        if w == 1280:
            head = "".join("<th>%s</th>" % t(c) for c in cols)
            body = "".join("<tr>%s</tr>" % "".join('<td><i class="ln"></i></td>' for _ in cols) for _ in range(n))
            return '<section class="card"><div class="cap">%s</div><table class="tb"><tr>%s</tr>%s</table></section>' % (t(label), head, body)
        cards = "".join('<div class="lc">%s</div>' % "".join('<div class="lc-r"><span class="k">%s</span><i class="ln"></i></div>' % t(c) for c in cols[:3]) for _ in range(min(n, 3)))
        return '<section class="card"><div class="cap">%s</div>%s</section>' % (t(label), cards)
    if k == "form":
        fields = []
        for name, kind in b[2]:
            if kind == "area":
                ctl = '<i class="in area"></i>'
            elif kind in ("toggle", "check", "radio"):
                ctl = '<i class="in %s"></i>' % kind
            elif kind == "file":
                ctl = '<i class="in file">%s</i>' % t("사진 선택")
            elif kind == "select":
                ctl = '<i class="in sel">▾</i>'
            else:
                ctl = '<i class="in"></i>'
            fields.append('<div class="fd" data-field="%s"><span class="fl">%s</span>%s</div>' % (e(name), t(name), ctl))
        return '<section class="card"><div class="cap">%s</div>%s</section>' % (t(b[1]), "".join(fields))
    if k == "btns":
        return r_btns(b[1], b[2], b[3], busy=busy, disabled=disabled)
    if k == "banner":
        return '<div class="banner">%s</div>' % t(b[1])
    if k == "photos":
        n = b[2]
        cols = (b[3] if len(b) > 3 else None) or ((1, 1) if n == 1 else (3, min(n, 4)))
        c = cols[1] if w == 1280 else cols[0]
        shown = n if w == 1280 else (min(n, 3) if c >= 3 else min(n, c * 2))
        return '<section class="card"><div class="cap">%s</div><div class="ph c%d%s">%s</div></section>' % (
            t(b[1]), c, " one" if n == 1 else "", '<i class="sq"></i>' * shown)
    if k == "cal":
        days = '<div class="cal">%s</div>' % "".join('<i class="dc"><b>%d</b></i>' % (d + 1) for d in range(35))
        if w == 1280:
            days = '<div class="cal2"><div>%s%s</div><div>%s%s</div></div>' % (t("이번 달", "t mo"), days, t("다음 달", "t mo"), days)
        return '<section class="card"><div class="cap">%s</div>%s</section>' % (t(b[1]), days)
    if k == "tabs":
        return '<div class="tabs">%s</div>' % "".join('<span class="tab%s">%s</span>' % (" on" if i == b[2] else "", t(x)) for i, x in enumerate(b[1]))
    if k == "note":
        return '<p class="note">%s</p>' % t(b[1])
    if k == "msg":
        return '<div class="msg">%s%s</div>' % (t(b[1]), r_btns(b[2], 0, None) if b[2] else "")
    if k == "text":
        return '<section class="card"><div class="cap">%s</div>%s</section>' % (t(b[2]), '<i class="ln full"></i>' * b[1])
    if k == "chat":
        return r_chat(b[1])
    raise Stop("모르는 블록 %s" % k)


def r_chat(bubbles):
    out = []
    for bb in bubbles:
        if bb[0] == "c":
            out.append('<div class="bub me">%s</div>' % t(bb[1]))
        elif bb[0] == "a":
            out.append('<div class="bub ch">%s</div>' % t(bb[1]))
        elif bb[0] == "card":
            lines = "".join('<div class="kc-l">%s</div>' % t(x) for x in bb[2])
            buttons = "".join('<span class="kc-b">%s</span>' % t(x) for x in bb[3])
            out.append('<div class="kcard"><div class="kc-t">%s</div>%s%s</div>' % (t(bb[1]), lines, buttons))
        elif bb[0] == "q":
            out.append('<div class="quick">%s</div>' % "".join('<span class="qr">%s</span>' % t(x) for x in bb[1]))
        else:
            raise Stop("모르는 말풍선 %s" % bb[0])
    return '<div class="chat">%s</div>' % "".join(out)


def find_busy(layout, label):
    """busy 프레임: 그 이름의 버튼, 없으면 마지막 버튼 줄의 주 버튼을 '처리하고 있어요'로."""
    hit = None
    for bi, b in enumerate(layout):
        if b[0] == "btns":
            for i, lab in enumerate(b[1]):
                if lab == label:
                    hit = (bi, i, "처리하고 있어요")
    if hit:
        return hit
    for bi, b in reversed(list(enumerate(layout))):
        if b[0] == "btns":
            return (bi, b[2] if b[2] is not None else 0, label)
    return None


def content_html(sid, s, frame, w, state):
    """레이아웃과 상태 프레임으로 본문 HTML."""
    kind = frame[0] if frame else None
    blocks = [b for b in s["layout"] if b[0] not in ("bar", "kbar")]
    if kind == "box":
        _, title, body, buttons = frame
        return '<div class="box"><div class="box-t">%s</div><p>%s</p>%s</div>' % (t(title), t(body), r_btns(buttons, len(buttons) - 1 if buttons else None, None) if buttons else "")
    tail, extras = "", True
    if kind in ("chat+", "chat="):  # chat=은 normal 대화 없이 그 상태의 대화 전체(설계 재검토 낮음 RE-13)
        htmls = [r_chat((list(b[1]) if kind == "chat+" else []) + list(frame[1])) if b[0] == "chat" else r_block(b, w) for b in blocks]
        if not any(b[0] == "chat" for b in blocks):
            raise Stop("%s#%s: chat+ 프레임인데 레이아웃에 대화가 없음" % (sid, state))
    elif kind == "replace":
        _, label, block = frame
        htmls = [r_block(block, w) if label_of(b) == label else r_block(b, w) for b in blocks]
        if not any(label_of(b) == label for b in blocks):
            raise Stop("%s#%s: replace 프레임의 '%s' 블록이 레이아웃에 없음" % (sid, state, label))
        extras = False  # 바꾼 블록(빈 목록 등)과 1280 보조 블록이 함께 보이지 않게
    elif kind == "busy":
        hit = find_busy(blocks, frame[1])
        htmls = []
        for bi, b in enumerate(blocks):
            if hit and bi == hit[0]:
                htmls.append(r_block(b, w, busy=(hit[1], hit[2]), disabled=True))
            elif b[0] == "btns":
                htmls.append(r_block(b, w, disabled=True))
            else:
                htmls.append(r_block(b, w))
        if not hit:
            tail = '<div class="btns"><span class="btn pri busy">%s</span></div>' % t(frame[1])
    elif kind == "result":
        extra = frame[3]
        names = [label_of(x) for x in extra]
        if None in names or len(set(names)) != len(names):
            raise Stop("%s#%s: result 프레임의 블록에 이름이 없거나 겹침" % (sid, state))
        slots = [bi for bi, b in enumerate(blocks) if b[0] == "form"] + [bi for bi, b in enumerate(blocks) if b[0] == "btns"]
        if not slots:
            raise Stop("%s#%s: result 프레임인데 레이아웃에 폼·버튼 줄이 없음" % (sid, state))
        swap, used, htmls = dict(zip(names, extra)), set(), []
        for b in blocks:
            lab = label_of(b)
            if lab in swap:
                htmls.append(r_block(swap[lab], w))
                used.add(lab)
            else:
                htmls.append("" if b[0] in ("form", "btns") else r_block(b, w))
        htmls[slots[0]] += "".join(r_block(x, w) for x in extra if label_of(x) not in used)
    elif kind in (None, "field", "banner", "dialog"):
        htmls = [r_block(b, w) for b in blocks]
    else:
        raise Stop("%s#%s: 모르는 프레임 %s" % (sid, state, kind))
    base = arrange(sid, s, blocks, htmls, w, extras) + tail
    if kind == "field":
        _, label, text = frame
        tag = '<div class="fd" data-field="%s">' % e(label)
        err = '<span class="ferr">%s</span>' % t(text)
        if tag in base:
            return base.replace(tag, tag + err, 1)
        cap = '<div class="cap">%s</div>' % t(label)  # 목록·표의 행 오류는 그 블록 제목 아래(설계 재검토 M19)
        if cap not in base:
            raise Stop("%s#%s: field 프레임의 '%s' 필드나 목록이 없음" % (sid, state, label))
        return base.replace(cap, cap + err, 1)
    if kind in ("banner", "result"):
        return '<div class="sbanner">%s%s</div>%s' % (t(frame[1]), r_btns(frame[2], None, None) if frame[2] else "", base)
    if kind == "dialog":
        _, title, body, buttons = frame
        dlg = '<div class="dim"></div><div class="dlg"><div class="box-t">%s</div><p>%s</p>%s</div>' % (
            t(title), t(body), r_btns(buttons, len(buttons) - 1, None))
        return base + dlg
    return base


def frame_html(m, nodes, roots, state, text, frame, w, menus):
    sid, s = m["id"], m["s"]
    shell = s["shell"]
    layout = s["layout"]
    bar = next((b for b in layout if b[0] == "bar"), None)
    kbar = next((b for b in layout if b[0] == "kbar"), None)
    body = content_html(sid, s, frame, w, state)
    sk = " sk" if state == "loading" and frame is None else ""
    if shell == "kakao":
        title = kbar[1] if kbar else "카카오톡"
        win = ('<div class="kwin"><div class="khead">‹ %s</div><div class="kbody%s">%s</div>'
               '<div class="kin"><i class="in"></i><span class="send">전송</span></div></div>') % (t(title), sk, body)
        return '<div class="vp kakao">%s</div>' % (('<div class="desk">%s</div>' % win) if w == 1280 else win)
    title = bar[1] if bar else nodes[sid]["name"]
    left = bar[2] if bar else ""
    right = bar[3] if bar else ""
    if shell in ("owner", "operator"):
        top, first = menu_of(sid, nodes, roots)
        items = menus[top]
        nav = "".join('<span class="mi%s">%s</span>' % (" on" if i == first else "", t(lab)) for i, lab in items)
        if w == 1280:
            head = '<div class="phead">%s%s%s</div>' % (t(left, "t lft") if left else "", t(title, "t ttl"), t(right, "t rgt") if right else "")
            return ('<div class="vp app"><aside class="menu"><div class="brand">%s</div>%s</aside>'
                    '<div class="main">%s<div class="content%s">%s</div></div></div>') % (
                t("Siljang 사장님" if shell == "owner" else "Siljang 운영자"), nav, head, sk, body)
        lft = left if left else "☰"
        head = '<div class="mbar">%s%s%s</div>' % (t(lft, "t lft"), t(title, "t ttl"), t(right, "t rgt") if right else "")
        return '<div class="vp app m">%s<div class="content%s">%s</div></div>' % (head, sk, body)
    if shell == "login":
        return '<div class="vp login"><div class="lcard"><div class="ltitle">%s</div><div class="content%s">%s</div></div></div>' % (t(title), sk, body)
    head = '<div class="mbar">%s%s%s</div>' % (t(left, "t lft") if left else "", t(title, "t ttl"), t(right, "t rgt") if right else "")
    cls = "public" if shell == "public" else "setup"
    wide = " wide" if s.get("wide") and w == 1280 else ""
    return '<div class="vp %s">%s<div class="content col%s%s">%s</div></div>' % (cls, head, wide, sk, body)


CSS = """
:root{--bg:#F4F5F8;--surface:#FFFFFF;--ink:#1A2030;--muted:#586074;--line:#D7DBE3;--accent:#A1304D;--chip:#ECEEF3;
--f-bg:#FFFFFF;--f-panel:#F3F3F3;--f-line:#CFCFCF;--f-ink:#2E2E2E;--f-muted:#7A7A7A;--f-fill:#E4E4E4;--f-dark:#4D4D4D;--f-on-dark:#FFFFFF;--f-desk:#DADADA;--f-me:#CFCFCF;--f-dim:rgba(0,0,0,.35);
--font:system-ui,-apple-system,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
--z360:.8;--z1280:.5}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#11141B;--surface:#191E28;--ink:#E6E8EE;--muted:#A0A7B6;--line:#2A3140;--accent:#E6809B;--chip:#222937;
--f-bg:#1F1F1F;--f-panel:#292929;--f-line:#474747;--f-ink:#E2E2E2;--f-muted:#9C9C9C;--f-fill:#3A3A3A;--f-dark:#C8C8C8;--f-on-dark:#141414;--f-desk:#2C2C2C;--f-me:#4A4A4A;--f-dim:rgba(0,0,0,.55);color-scheme:dark}}
:root[data-theme="dark"]{--bg:#11141B;--surface:#191E28;--ink:#E6E8EE;--muted:#A0A7B6;--line:#2A3140;--accent:#E6809B;--chip:#222937;
--f-bg:#1F1F1F;--f-panel:#292929;--f-line:#474747;--f-ink:#E2E2E2;--f-muted:#9C9C9C;--f-fill:#3A3A3A;--f-dark:#C8C8C8;--f-on-dark:#141414;--f-desk:#2C2C2C;--f-me:#4A4A4A;--f-dim:rgba(0,0,0,.55);color-scheme:dark}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:15px;line-height:1.55;margin:0}
.page{padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:24px 48px;max-width:1440px;margin:0 auto}
header.top h1{font-size:1.6rem;line-height:1.25;margin:0 0 6px;text-wrap:balance}
header.top p{margin:0;color:var(--muted);max-width:72ch}
.legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:10px;font-size:.85rem;color:var(--muted)}
.wrap{display:grid;grid-template-columns:268px minmax(0,1fr);gap:28px;margin-top:22px;align-items:start}
nav.picker{position:sticky;top:12px;max-height:calc(100vh - 24px);overflow:auto;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px}
nav.picker h2{font-size:.78rem;letter-spacing:.06em;color:var(--muted);margin:12px 6px 4px;font-weight:600}
nav.picker h2:first-child{margin-top:2px}
nav.picker a{display:flex;gap:8px;align-items:baseline;padding:5px 6px;border-radius:6px;color:var(--ink);text-decoration:none;font-size:.86rem}
nav.picker a:hover{background:var(--chip)}
nav.picker a.on{background:var(--ink);color:var(--surface)}
nav.picker a .id{font-family:var(--mono);font-size:.78rem;opacity:.75;flex:none}
nav.picker a .n{margin-left:auto;font-size:.75rem;opacity:.7;flex:none}
.pick-m{display:none;width:100%;font:inherit;padding:10px;border-radius:8px;border:1px solid var(--line);background:var(--surface);color:var(--ink)}
.scr{display:none;min-width:0}
.scr.on{display:block}
.scr h2{font-size:1.35rem;margin:0 0 4px;line-height:1.3}
.scr h2 .id{font-family:var(--mono);font-size:1rem;color:var(--muted);margin-right:8px}
.meta{color:var(--muted);font-size:.85rem;margin:0 0 8px;display:flex;flex-wrap:wrap;gap:4px 14px}
.meta code{font-family:var(--mono)}
.purpose{max-width:80ch;margin:0 0 18px}
.st{border-top:1px solid var(--line);padding-top:14px;margin-top:18px}
.st h3{font-size:1rem;margin:0 0 4px;display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline}
.st h3 code{font-family:var(--mono);background:var(--chip);padding:1px 6px;border-radius:5px}
.st h3 span{font-weight:400;color:var(--muted);font-size:.85rem}
.st .desc{margin:0 0 4px;max-width:90ch;font-size:.92rem}
.st .resp{margin:0 0 10px;font-family:var(--mono);font-size:.75rem;color:var(--muted);overflow-wrap:anywhere}
.pair{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start}
figure.fr{margin:0;flex:none}
figure.fr figcaption{font-size:.75rem;color:var(--muted);margin-top:4px;font-family:var(--mono)}
.clip{overflow:hidden;border:1px solid var(--line);border-radius:8px;background:var(--f-bg)}
.w360 .vp{width:360px;min-height:640px;zoom:var(--z360)}
.w1280 .vp{width:1280px;min-height:760px;zoom:var(--z1280)}
.vp{position:relative;background:var(--f-bg);color:var(--f-ink);font-family:var(--font);font-size:15px;line-height:1.45}
.vp .t{display:inline}
.content{padding:16px;display:flex;flex-direction:column;gap:12px;min-width:0}
.col{max-width:760px;margin:0 auto;width:100%}
.mbar{display:flex;align-items:center;gap:12px;height:52px;padding:0 14px;border-bottom:1px solid var(--f-line);background:var(--f-panel);font-weight:600}
.mbar .lft{color:var(--f-muted);font-weight:400}.mbar .rgt{margin-left:auto;color:var(--f-muted);font-weight:400;font-size:.9em}
.app:not(.m){display:grid;grid-template-columns:220px 1fr;min-height:760px}
.menu{background:var(--f-panel);border-right:1px solid var(--f-line);padding:16px 10px;display:flex;flex-direction:column;gap:4px}
.brand{font-weight:700;padding:4px 10px 14px;color:var(--f-ink)}
.mi{padding:9px 10px;border-radius:6px;color:var(--f-muted)}
.mi.on{background:var(--f-fill);color:var(--f-ink);font-weight:600}
.main{min-width:0}
.phead{display:flex;align-items:center;gap:14px;height:64px;padding:0 24px;border-bottom:1px solid var(--f-line);font-size:1.25rem;font-weight:600}
.phead .lft{color:var(--f-muted);font-weight:400}.phead .rgt{margin-left:auto;font-size:.8em;color:var(--f-muted);font-weight:400}
.app:not(.m) .content{padding:24px;max-width:1060px}
.login{display:flex;align-items:flex-start;justify-content:center;padding:60px 16px;min-height:640px;background:var(--f-panel)}
.w1280 .login{min-height:760px;padding-top:120px}
.lcard{width:100%;max-width:400px;background:var(--f-bg);border:1px solid var(--f-line);border-radius:12px;padding:24px 8px 8px}
.ltitle{font-weight:700;font-size:1.2rem;padding:0 16px}
.card{border:1px solid var(--f-line);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px;background:var(--f-bg)}
.cap{font-size:.8rem;color:var(--f-muted);font-weight:600}
.kv-r{display:flex;gap:12px;justify-content:space-between;border-bottom:1px dashed var(--f-line);padding-bottom:6px}
.kv-r:last-child{border-bottom:0;padding-bottom:0}
.kv-r .k{color:var(--f-muted);flex:none}.kv-r .v{text-align:right;min-width:0;overflow-wrap:anywhere}
.tb{width:100%;border-collapse:collapse;font-size:.9rem}
.tb th{text-align:left;color:var(--f-muted);font-weight:600;border-bottom:1px solid var(--f-line);padding:6px 8px}
.tb td{border-bottom:1px solid var(--f-line);padding:10px 8px}
.ln{display:block;height:10px;border-radius:5px;background:var(--f-fill);width:70%}
.ln.full{width:100%}
.lc{border-top:1px solid var(--f-line);padding-top:8px;display:flex;flex-direction:column;gap:6px}
.lc:first-of-type{border-top:0}
.lc-r{display:flex;gap:10px;align-items:center}.lc-r .k{font-size:.8rem;color:var(--f-muted);flex:none;width:96px}.lc-r .ln{flex:1}
.fd{display:flex;flex-direction:column;gap:4px}
.fl{font-size:.85rem;color:var(--f-muted)}
.in{display:flex;align-items:center;justify-content:flex-end;height:40px;border:1px solid var(--f-line);border-radius:8px;background:var(--f-bg);padding:0 10px;font-style:normal;color:var(--f-muted)}
.in.area{height:84px}.in.file{justify-content:center;border-style:dashed}
.in.toggle{width:46px;height:26px;border-radius:13px;background:var(--f-fill)}
.in.check,.in.radio{width:22px;height:22px;border-radius:5px}.in.radio{border-radius:11px}
.ferr{font-size:.8rem;color:var(--f-ink);font-weight:600;order:3}
.card>.ferr{display:block;margin:0 0 6px}
.btns{display:flex;flex-wrap:wrap;gap:8px}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 16px;border-radius:8px;border:1px solid var(--f-line);background:var(--f-bg);font-weight:600}
.btn.pri{background:var(--f-dark);color:var(--f-on-dark);border-color:var(--f-dark)}
.btn.dan{border-style:dashed;border-width:2px}
.btn.off{opacity:.45}
.btn.busy{background:var(--f-fill);color:var(--f-ink);border-color:var(--f-line)}
.btn.busy::before{content:"◌ ";margin-right:4px}
.banner,.sbanner{border:1px solid var(--f-line);background:var(--f-panel);border-radius:8px;padding:10px 12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;font-weight:600}
.app:not(.m) .sbanner{margin:16px 24px 0}.m .sbanner,.public .sbanner,.setup .sbanner,.login .sbanner{margin:12px 16px 0}
.ph{display:grid;gap:8px}.ph.c1{grid-template-columns:minmax(0,300px)}.ph.c2{grid-template-columns:repeat(2,minmax(0,200px))}
.ph.c3{grid-template-columns:repeat(3,minmax(0,200px))}.ph.c4{grid-template-columns:repeat(4,minmax(0,200px))}.ph.one .sq{aspect-ratio:3/4}
.sq{display:block;aspect-ratio:1;background:var(--f-fill);border-radius:6px}
.cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
.cal2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.cal2>div{display:flex;flex-direction:column;gap:6px;min-width:0}.mo{font-size:.85rem;font-weight:600}
.cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start}.cols.main{grid-template-columns:minmax(0,2fr) minmax(0,1fr)}.cols.side{grid-template-columns:minmax(0,1fr) minmax(0,2fr)}
.cols>.c{display:flex;flex-direction:column;gap:12px;min-width:0}.col.wide{max-width:1120px}
.dc{display:flex;min-height:44px;border:1px solid var(--f-line);border-radius:6px;padding:4px;font-style:normal;font-size:.75rem;color:var(--f-muted)}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--f-line);overflow:hidden}
.tab{padding:8px 12px;color:var(--f-muted);white-space:nowrap}.tab.on{color:var(--f-ink);font-weight:600;border-bottom:3px solid var(--f-dark)}
.note{margin:0;color:var(--f-muted);font-size:.9rem}
.b-h{margin:4px 0 0;font-size:1rem}
.msg{display:flex;flex-direction:column;gap:10px;align-items:center;text-align:center;padding:28px 12px;border:1px dashed var(--f-line);border-radius:10px;color:var(--f-muted)}
.box{margin:24px auto;max-width:420px;width:100%;border:1px solid var(--f-line);border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:10px;background:var(--f-bg)}
.box-t{font-weight:700;font-size:1.05rem}
.box p,.dlg p{margin:0;color:var(--f-muted)}
.dim{position:absolute;inset:0;background:var(--f-dim)}
.dlg{position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);width:min(88%,420px);background:var(--f-bg);border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:10px;border:1px solid var(--f-line)}
.kakao{background:var(--f-panel);min-height:640px;display:flex}
.w1280 .kakao{min-height:760px}
.desk{flex:1;background:var(--f-desk);display:flex;justify-content:center;align-items:flex-start;padding:40px 0}
.kwin{display:flex;flex-direction:column;width:100%;min-height:640px;background:var(--f-panel)}
.desk .kwin{width:420px;min-height:680px;border:1px solid var(--f-line);border-radius:8px;overflow:hidden}
.khead{height:52px;display:flex;align-items:center;padding:0 14px;font-weight:600;border-bottom:1px solid var(--f-line);background:var(--f-bg)}
.kbody{flex:1;padding:12px;display:flex;flex-direction:column;gap:8px}
.kin{display:flex;gap:8px;padding:8px;border-top:1px solid var(--f-line);background:var(--f-bg)}.kin .in{flex:1;height:36px}
.send{display:flex;align-items:center;padding:0 12px;border-radius:8px;background:var(--f-fill);font-size:.85rem}
.chat{display:flex;flex-direction:column;gap:8px}
.bub{max-width:78%;padding:8px 11px;border-radius:12px;overflow-wrap:anywhere}
.bub.ch{align-self:flex-start;background:var(--f-bg);border:1px solid var(--f-line);border-top-left-radius:3px}
.bub.me{align-self:flex-end;background:var(--f-me);border-top-right-radius:3px}
.kcard{align-self:flex-start;width:78%;background:var(--f-bg);border:1px solid var(--f-line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
.kc-t{font-weight:700;padding:10px 12px 4px}.kc-l{padding:0 12px 6px;color:var(--f-muted);font-size:.9rem}
.kc-b{border-top:1px solid var(--f-line);padding:10px 12px;text-align:center;font-weight:600}
.quick{display:flex;flex-wrap:wrap;gap:6px}.qr{border:1px solid var(--f-line);background:var(--f-bg);border-radius:16px;padding:5px 12px;font-size:.88rem}
.sk .t,.sk .k,.sk .v,.sk .fl{color:transparent!important;background:var(--f-fill);border-radius:4px}
.sk .btn{opacity:.45}.sk .sq,.sk .ln,.sk .dc{background:var(--f-fill)}
@media (max-width:1100px){.wrap{grid-template-columns:220px minmax(0,1fr)}:root{--z1280:.42}}
@media (max-width:800px){.wrap{grid-template-columns:minmax(0,1fr)}nav.picker{display:none}.pick-m{display:block}:root{--z1280:.25}}
"""

JS = """
(function(){
  var secs=[].slice.call(document.querySelectorAll('section.scr'));
  var links=[].slice.call(document.querySelectorAll('nav.picker a'));
  var sel=document.getElementById('pick');
  function show(){
    var id=(location.hash||'').slice(1);
    var ok=secs.some(function(s){return s.id===id;});
    if(!ok){id=secs.length?secs[0].id:'';}
    secs.forEach(function(s){s.classList.toggle('on',s.id===id);});
    links.forEach(function(a){a.classList.toggle('on',a.getAttribute('href')==='#'+id);});
    if(sel){sel.value=id;}
  }
  if(sel){sel.addEventListener('change',function(){location.hash=sel.value;});}
  window.addEventListener('hashchange',function(){show();window.scrollTo(0,0);});
  show();
})();
"""


def build_html(model, nodes, roots):
    menus = {}
    for r in roots:
        items = []
        for k in nodes[r]["kids"]:
            if C.SCREENS.get(k, {}).get("shell") in ("owner", "operator"):
                items.append((k, nodes[k]["name"].replace(" 목록", "") if nodes[k]["name"] != "영업 신고 확인 목록" else "영업 신고 확인"))
        menus[r] = items
    n_frames = sum(len(m["s"]["states"]) for m in model)
    aud = {}
    for m in model:
        aud.setdefault(nodes[m["node"]["root"]].get("audience", ""), []).append(m)
    nav, opts = [], []
    for a, ms in aud.items():
        nav.append("<h2>%s %d</h2>" % (e(a), len(ms)))
        opts.append('<optgroup label="%s">' % e(a))
        for m in ms:
            nav.append('<a href="#%s"><span class="id">%s</span><span>%s</span><span class="n">%d</span></a>' % (
                m["id"], m["id"], e(m["node"]["name"]), len(m["s"]["states"])))
            opts.append('<option value="%s">%s %s</option>' % (m["id"], m["id"], e(m["node"]["name"])))
        opts.append("</optgroup>")
    secs = []
    for m in model:
        sid, node, s = m["id"], m["node"], m["s"]
        by_state = {}
        for r in m["rows"]:
            by_state.setdefault(r["state"], []).append(r["key"])
            for x in r["also"]:
                by_state.setdefault(x, []).append(r["key"] + "(내용에 따라)")
        parts = ['<section class="scr" id="%s" data-scr="%s">' % (sid, sid),
                 '<h2><span class="id">%s</span>%s</h2>' % (sid, e(node["name"])),
                 '<p class="meta"><span><code>%s</code></span><span>접근 권한: %s</span><span>%s</span><span>%s</span></p>' % (
                     e(node["path"]), e(node["access"]),
                     e(", ".join(m["flows"]) if m["flows"] else "플로우 노드 없음"),
                     e(", ".join(node.get("apis") or []) or "API 없음")),
                 '<p class="purpose">%s</p>' % e(s["purpose"])]
        for name, text, frame, _ in s["states"]:
            resp = by_state.get(name, [])
            parts.append('<div class="st" data-state="%s#%s"><h3><code>%s#%s</code><span>%s</span></h3><p class="desc">%s</p>%s<div class="pair">' % (
                sid, name, sid, name, e(C.STATE_INFO[name]), e(text),
                '<p class="resp">%s</p>' % e(", ".join(resp)) if resp else ""))
            for w in (360, 1280):
                parts.append('<figure class="fr w%d" data-frame="%s#%s" data-w="%d"><div class="clip" aria-hidden="true">%s</div><figcaption>%s#%s · %d</figcaption></figure>' % (
                    w, sid, name, w, frame_html(m, nodes, roots, name, text, frame, w, menus), sid, name, w))
            parts.append("</div></div>")
        parts.append("</section>")
        secs.append("".join(parts))
    head = ('<title>Siljang 화면 와이어프레임</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n'
            '<style>%s</style>\n<noscript><style>.scr{display:block}</style></noscript>\n' % CSS.strip())
    top = ('<div class="page"><header class="top"><h1>Siljang 화면 와이어프레임</h1>'
           '<p>08단계 화면 정의(<code>docs/08-screens/SCR-0xx.md</code>)에서 그린 회색조 와이어프레임입니다. 화면 %d개, 상태 %d개를 360과 1280 너비로 그렸습니다. '
           '모양이 아니라 구조와 상태를 보기 위한 것이라 회색, 시스템 글꼴, 예시 값만 씁니다. 디자인 토큰은 09단계에서 정합니다.</p>'
           '<div class="legend"><span>화면 목록(휴대폰에서는 위쪽 선택 상자)에서 고르면 그 화면의 상태가 차례로 나옵니다</span><span>프레임은 줄여 보입니다(360은 0.8배, 1280은 0.5배, 좁은 창에서는 더 작게)</span>'
           '<span>짙은 버튼 = 주 액션, 점선 버튼 = 되돌리기 어려운 액션</span></div></header>'
           '<div class="wrap"><nav class="picker" aria-label="화면 고르기">%s</nav><main><select id="pick" class="pick-m" aria-label="화면 고르기">%s</select>%s</main></div></div>') % (
        len(model), n_frames, "".join(nav), "".join(opts), "".join(secs))
    return head + top + "\n<script>%s</script>\n" % JS.strip()


README_SKELETON = """# 08단계 화면 상태

<!-- 08-screens:screens:start -->
<!-- 08-screens:screens:end -->

<!-- 08-screens:states:start -->
<!-- 08-screens:states:end -->

<!-- 08-screens:outcomes:start -->
<!-- 08-screens:outcomes:end -->

<!-- 08-screens:confirms:start -->
<!-- 08-screens:confirms:end -->

<!-- 08-screens:decisions:start -->
<!-- 08-screens:decisions:end -->
"""


def outputs_of(root):
    roots, nodes, order, model, problems, contract = build_model(root)
    if problems:
        raise Stop("화면 정의 문제 %d개\n  " % len(problems) + "\n  ".join(problems))
    out = {}
    base = root / "docs/08-screens"
    mockups = read_mockups(root)
    for m in model:
        out[base / ("%s.md" % m["id"])] = screen_md(m, nodes, mockups)
    readme = base / "README.md"
    text = readme.read_text(encoding="utf-8") if readme.exists() else README_SKELETON
    out[readme] = with_blocks(text, readme_blocks(model, nodes, roots, contract))
    out[base / "wireframes.html"] = build_html(model, nodes, roots)
    return out, model


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    root = Path(args[0] if args else ".").resolve()
    out, model = outputs_of(root)
    diff = []
    for path, text in out.items():
        old = path.read_text(encoding="utf-8") if path.exists() else None
        if old != text:
            diff.append(path.relative_to(root))
            if write:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text, encoding="utf-8")
    extra = sorted(p for p in (root / "docs/08-screens").glob("SCR-*.md") if p not in out) if (root / "docs/08-screens").exists() else []
    if write:
        for p in extra:
            p.unlink()
        print("다시 생성한 파일 %d개(전체 %d개)" % (len(diff), len(out)) + ("" if len(diff) > 12 else "".join("\n  %s" % d for d in diff)))
    elif diff or extra:
        print("원본과 다른 생성 파일 %d개, 원본에 없는 화면 파일 %d개 (--write로 다시 생성)" % (len(diff), len(extra))
              + "".join("\n  %s" % d for d in diff[:20] + extra))
        sys.exit(1)
    else:
        print("생성 파일이 원본과 같음 (%d개)" % len(out))


if __name__ == "__main__":
    main()
