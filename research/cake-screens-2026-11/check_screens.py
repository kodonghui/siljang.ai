#!/usr/bin/env python3
"""08단계 화면 정의 검사.

    python3 -B research/cake-screens-2026-11/check_screens.py . [--hub PATH/hub.py]

생성한 화면 정의(docs/08-screens/SCR-0xx.md)·README·와이어프레임을 07단계 사이트맵(docs/07-sitemap/sitemap.yaml),
06단계 계약(api/openapi.yaml, docs/06-api/README.md)과 01단계 용어집에 대어 본다. 응답 목록은 build_screens.py와
따로 openapi.yaml에서 다시 읽는다. --hub에 CORTHEX 허브의 hub.py를 주면 허브 스냅숏의 화면 상태가 화면 정의의
상태와 같은지 확인한다(없으면 '미확인').
"""
import html
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "cake-sitemap-2026-11"))
import screens_common as C  # noqa: E402
import screens_guest  # noqa: E402,F401
import screens_owner_a  # noqa: E402,F401
import screens_owner_b  # noqa: E402,F401
import screens_operator  # noqa: E402,F401
from check_sitemap import ALLOW, Report, avoided_words  # noqa: E402

SCR_STATE = re.compile(r"(SCR-\d{3})#([a-z][a-z0-9_-]{0,30})")
KINDS = {"접근", "입력", "대상", "상태 변화", "반복", "동시 변경", "한도", "외부 서비스", "데이터 노출", "빈 응답·끊긴 응답", "AI 답", "화면 상태"}
SECTIONS = ["데이터", "액션", "상태", "케이스 유형", "긴 글과 좁은 화면"]
HEADER = ["경로", "접근 권한", "상위 화면", "화면 레이아웃", "플로우", "관련 SPEC", "API", "와이어프레임"]
SKILL_APIS = ("API-070", "API-071", "API-072", "API-073")
LOGIN = {"SCR-014": "API-001", "SCR-046": "API-004"}

# 08단계에서 직접 확인한 금지어 예외. '확정'은 TERM-011(수락)의 금지어지만 주문 확정·운영규정 확정·가격 표시 방식의
# 뜻으로는 06·07단계에서 쓰는 말이다. '시트'는 06단계 오류 문구(sheet_not_accessible) 그대로다.
ALLOW_08 = {
    "확정": [r"확정돼요", r"확정한 (운영규정|버전)", r"확정 (시각|전|결과)", r"'확정'", r"확정했", r"확정함", r"확정을",
             r"확정\(", r"표시 방식\(확정", r"수락·확정", r"상태\(확정", r"확정해 주세요", r"운영규정[^|\n]{0,20}확정",
             r"(?m)^확정$", r"\d+일 확정",
             r"확정한 뒤 고친"],  # 단계 문서를 마친 뒤 고친 기록의 절 제목(03단계 check_flows.py와 같음)
    "시트": [r"그 시트를 열 수 없어요"],
}

# 01~07 용어 정리(2026-11-12) 전의 말. 업계 용어로 바꾼 뒤 다시 나오면 안 된다.
OLD_TERMS = [
    (r"화면 나무", "사이트맵"), (r"갈림길", "분기"), (r"정한 것", "결정 사항"), (r"굳힘|굳히", "확정"),
    (r"확인 지점", "체크포인트"), (r"까닭", "이유·사유"), (r"피할 말", "금지어"), (r"여쭙|여쭘", "질문"),
    (r"판 번호", "버전"), (r"자리 잡기", "가예약"), (r"넘긴 질문", "전달한 질문"), (r"넘기기", "전달"),
    (r"결제 받을 곳", "결제 수단"), (r"다시 만들기", "재제작"), (r"영업 달력", "영업 캘린더"), (r"장부 줄", "장부 행"),
    (r"한 거래 후보", "거래 후보"), (r"(?<![가-힣])사건(?![가-힣])", "이벤트"), (r"행위자", "액터"), (r"상태 기계", "상태 머신"),
    (r"(?<![가-힣])흐름", "플로우"), (r"가로로 넘김", "가로 스크롤"), (r"저절로", "자동으로"), (r"가리기|가려 ?(?:둠|둡니다|짐|진)", "마스킹"),
    (r"(?<![가-힣빈])칸(?:에|을|이|은|마다|만|과|의|\b)", "필드·셀·영역"), (r"(?<![가-힣])틀(?:이|을|은|의|에)?(?![가-힣])", "레이아웃"),
    (r"되돌리기 ?\(|5분 안에 되돌", "실행 취소"), (r"(?:다음|이전|첫|한|두) 쪽", "페이지"), (r"보낸 쪽", "발신자"),
    (r"부르지 않", "호출하지 않"), (r"환불 정하기", "환불 결정"), (r"이어 붙", "추가로 불러옴"), (r"마감 후 추가 받기|오버부킹", "마감 후 추가 수락"),
]


def table_rows(text):
    rows = []
    for line in text.splitlines():
        if line.startswith("| ") and not line.startswith("| ---"):
            rows.append([c.replace("\\|", "|").strip() for c in re.split(r"(?<!\\) \| ", line.strip()[2:-2])])
    return rows[1:]


def sections(text):
    out, cur = {}, None
    for line in text.splitlines():
        if line.startswith("## "):
            cur = line[3:].strip()
            out[cur] = []
        elif cur:
            out[cur].append(line)
    return {k: "\n".join(v) for k, v in out.items()}


def read_contract(root):
    """openapi.yaml에서 API마다 응답 행 (상태 코드, 2xx 예시 이름 또는 오류 코드)."""
    doc = yaml.safe_load((root / "api/openapi.yaml").read_text(encoding="utf-8"))

    def deref(o):
        while isinstance(o, dict) and "$ref" in o:
            cur = doc
            for p in o["$ref"].lstrip("#/").split("/"):
                cur = cur[p]
            o = cur
        return o

    ops = {}
    for item in doc["paths"].values():
        for op in item.values():
            if not isinstance(op, dict) or "x-corthex" not in op:
                continue
            keys = []
            for status, r in op.get("responses", {}).items():
                r = deref(r)
                exs = [(name, deref(ex).get("value")) for media in (r.get("content") or {}).values()
                       for name, ex in (media.get("examples") or {}).items()]
                if str(status).startswith("2"):
                    keys += ["%s:%s" % (status, n) for n, _ in exs] or [str(status)]
                else:
                    for n, v in exs:
                        k = "%s:%s" % (status, (v.get("code") if isinstance(v, dict) else None) or n)
                        if k not in keys:
                            keys.append(k)
                    if not exs:
                        keys.append(str(status))
            ops[op["x-corthex"]["id"]] = keys
    return ops


def default_state(sid, api, key):
    status, _, code = key.partition(":")
    if status.startswith("2"):
        return "empty" if code == "empty" else "normal"
    if status == "401":
        return "error" if LOGIN.get(sid) == api else "permission"
    if status == "403":
        return "permission"
    if status == "404":
        return {"shop_not_registered": "permission", "not_set": "empty"}.get(code, "error")
    if status == "409":
        return {"confirmation_required": "confirm", "request_in_progress": "submitting", "channel_linked_elsewhere": "error"}.get(code, "stale")
    if status == "429":
        return "rate-limited"
    return "error"


def generated(text, name):
    m = re.search(r"<!-- BEGIN generated:%s -->\n(.*?)<!-- END generated:%s -->" % (name, name), text, re.S)
    return table_rows(m.group(1)) if m else None


def page_text(page):
    """보이는 글. 요소마다 한 줄(버튼 이름 하나가 한 줄이 되게)."""
    text = html.unescape(re.sub(r"<style>.*?</style>|<script>.*?</script>|<[^>]+>", "\n", page, flags=re.S))
    return "\n".join(x.strip() for x in text.splitlines() if x.strip())


def allowed(word, text, start, end):
    window = text[max(0, start - 14): end + 14]
    return any(re.search(a, window) for a in ALLOW.get(word, []) + ALLOW_08.get(word, []))


def main():
    args = sys.argv[1:]
    hub = None
    if "--hub" in args:
        i = args.index("--hub")
        hub = Path(args[i + 1])
        del args[i:i + 2]
    root = Path(args[0] if args else ".").resolve()
    d8 = root / "docs/08-screens"
    rep = Report()

    tree = yaml.safe_load((root / "docs/07-sitemap/sitemap.yaml").read_text(encoding="utf-8"))
    nodes, order = {}, []

    def walk(items, parent):
        for n in items:
            nodes[n["id"]] = dict(n, parent=parent)
            order.append(n["id"])
            walk(n.get("children") or [], n["id"])

    walk(tree, None)

    # C1 파일
    files = sorted(p.name for p in d8.iterdir()) if d8.exists() else []
    want = sorted(["%s.md" % i for i in order] + ["README.md", "wireframes.html"])
    problems = ["없는 파일 %s" % f for f in sorted(set(want) - set(files))] + ["사이트맵에 없는 파일 %s" % f for f in sorted(set(files) - set(want))]
    rep.add("C1", "화면마다 정의 파일 하나(사이트맵과 같은 50개)와 README·와이어프레임", problems,
            "SCR 파일 %d개, 사이트맵 화면 %d개" % (sum(1 for f in files if f.startswith("SCR-")), len(order)))
    docs = {sid: (d8 / ("%s.md" % sid)).read_text(encoding="utf-8") for sid in order if (d8 / ("%s.md" % sid)).exists()}

    # C2 머리말
    problems = []
    for sid, text in docs.items():
        n = nodes[sid]
        head = dict(re.findall(r"^- ([^:\n]+): (.*)$", text.split("\n목적:")[0], re.M))
        if not text.startswith("# %s %s\n" % (sid, n["name"])):
            problems.append("%s: 제목이 사이트맵 이름과 다름" % sid)
        missing = [k for k in HEADER if k not in head]
        if missing:
            problems.append("%s: 머리말에 %s가 없음" % (sid, missing))
            continue
        if head["경로"] != "`%s`" % n["path"]:
            problems.append("%s: 경로 %s ≠ 사이트맵 %s" % (sid, head["경로"], n["path"]))
        also = ", ".join("`%s`" % p for p in n.get("also_paths") or [])  # 사이트맵의 둘째 경로(설계 재검토 낮음 RE-14)
        if head.get("다른 경로", "") != also:
            problems.append("%s: 다른 경로 %s ≠ 사이트맵 also_paths %s" % (sid, head.get("다른 경로", "(없음)"), also or "(없음)"))
        if head["접근 권한"] != n["access"]:
            problems.append("%s: 접근 권한 %s ≠ 사이트맵 %s" % (sid, head["접근 권한"], n["access"]))
        if not head["상위 화면"].startswith(n["parent"] or "없음(루트)"):
            problems.append("%s: 상위 화면 %s ≠ 사이트맵 %s" % (sid, head["상위 화면"], n["parent"]))
        if sorted(re.findall(r"SPEC-\d{3}", head["관련 SPEC"])) != sorted(n.get("specs") or []):
            problems.append("%s: 관련 SPEC이 사이트맵과 다름" % sid)
        if sorted(re.findall(r"API-\d{3}", head["API"])) != sorted(n.get("apis") or []):
            problems.append("%s: API가 사이트맵과 다름" % sid)
        if not head["와이어프레임"].startswith("`wireframes.html#%s`" % sid):
            problems.append("%s: 와이어프레임 링크가 틀림" % sid)
    rep.add("C2", "머리말(경로·다른 경로·접근 권한·상위 화면·SPEC·API·와이어프레임)이 사이트맵과 같음", problems)

    # C3 목적과 플로우
    problems, no_flow = [], 0
    for sid, text in docs.items():
        m = re.search(r"^목적: (.*)$", text, re.M)
        purpose = m.group(1) if m else ""
        tail = re.search(r"\(([^()]*)\)\s*$", purpose)
        flows = sorted(nodes[sid].get("flows") or [])
        if not purpose:
            problems.append("%s: 목적이 없음" % sid)
        elif not tail:
            problems.append("%s: 목적 끝에 플로우가 없음" % sid)
        elif tail.group(1).startswith("플로우 노드 없음:"):
            no_flow += 1
            if flows or not tail.group(1)[len("플로우 노드 없음:"):].strip():
                problems.append("%s: 플로우 노드 없음인데 사이트맵 flows %s가 있거나 사유가 비었음" % (sid, flows))
        elif sorted(re.findall(r"FL-\d{3}", tail.group(1))) != flows:
            problems.append("%s: 목적의 플로우 %s ≠ 사이트맵 %s" % (sid, tail.group(1), flows))
    rep.add("C3", "목적 한 문장과 플로우 ID(사이트맵과 같음)", problems, "플로우 노드 없음 %d개" % no_flow)

    # C4 데이터·액션
    problems, nrows, nacts, nnav = [], 0, 0, 0
    for sid, text in docs.items():
        sec = sections(text)
        apis = set(nodes[sid].get("apis") or [])
        for r in table_rows(sec.get("데이터", "")):
            nrows += 1
            used = set(re.findall(r"(?<!의 )API-\d{3}", r[1])) if len(r) > 1 else set()
            for other, api in re.findall(r"(SCR-\d{3})의 (API-\d{3})", r[1] if len(r) > 1 else ""):
                if api not in (nodes.get(other, {}).get("apis") or []):
                    problems.append("%s: 데이터 출처 '%s의 %s'가 그 화면의 API가 아님" % (sid, other, api))
            if len(r) != 2 or not r[0] or not r[1]:
                problems.append("%s: 데이터 행 %s에 출처가 없음" % (sid, r[:1]))
            elif used - apis:
                problems.append("%s: 데이터 출처 %s가 이 화면의 API가 아님" % (sid, sorted(used - apis)))
            elif not used and "의 API-" not in r[1] and not re.search(r"서버|화면|카카오|주소|입력|설정|안내|계산|손님|사장님|기기|브라우저|정해진|SCR-\d{3}", r[1]):
                problems.append("%s: 데이터 출처 '%s'가 API도 화면 안 값도 아님" % (sid, r[1]))
        acts = table_rows(sec.get("액션", ""))
        nacts += len(acts)
        for r in acts:
            if len(r) != 3 or not all(r):
                problems.append("%s: 액션 %s에 결과나 실패가 빠짐" % (sid, r[:1]))
        if "데이터" not in sec or "액션" not in sec:
            problems.append("%s: 데이터나 액션 절이 없음" % sid)
        # 바로 이동(설계 재검토 낮음 RE-19): 액션·응답 표에서 괄호로 단 화면 ID는 사이트맵의 상위·하위·opens에 있어야 함.
        # 카카오톡 대화 화면은 링크로 여는 화면이 아니라 카드라 대상에서 뺌
        n = nodes[sid]
        rel = {n["parent"]} | {c["id"] for c in n.get("children") or []} | set(n.get("opens") or []) \
            | set((n.get("opens_by_task") or {}).values()) | set((n.get("opens_by_banner") or {}).values())
        for part in ("액션", "응답과 상태"):
            for t in re.findall(r"\((SCR-\d{3})\)", sec.get(part, "")):
                if t == sid or t not in nodes or nodes[t]["path"].startswith("kakao:"):
                    continue
                nnav += 1
                if t not in rel:
                    problems.append("%s: %s 표의 바로 이동 %s가 사이트맵의 상위·하위·opens에 없음" % (sid, part, t))
    rep.add("C4", "데이터마다 출처, 액션마다 결과와 실패, 바로 이동하는 화면이 사이트맵에 있음", problems,
            "데이터 %d행, 액션 %d행, 바로 이동 %d곳" % (nrows, nacts, nnav))

    # C5 상태
    problems, described, total = [], {}, 0
    readme = (d8 / "README.md").read_text(encoding="utf-8") if (d8 / "README.md").exists() else ""
    known = {r[0].strip("`") for r in table_rows(readme.split("<!-- 08-screens:states:start -->")[-1].split("<!-- 08-screens:states:end -->")[0])} if readme else set()
    for sid, text in docs.items():
        rows = table_rows(sections(text).get("상태", ""))
        got, na = [], []
        for r in rows:
            m = re.fullmatch(r"(SCR-\d{3})#([a-z-]+)", r[0])
            n = re.fullmatch(r"([a-z]+) \(해당 없음\)", r[0])
            if m and m.group(1) == sid:
                got.append(m.group(2))
                if len(r) < 3 or not r[1] or not r[2]:
                    problems.append("%s#%s: 설명이나 오는 응답 셀이 비었음" % (sid, m.group(2)))
            elif n:
                na.append(n.group(1))
                if len(r) < 2 or not r[1]:
                    problems.append("%s: %s가 해당 없는 이유가 없음" % (sid, n.group(1)))
            else:
                problems.append("%s: 상태 행 '%s'를 읽을 수 없음" % (sid, r[0]))
        described[sid] = got
        total += len(got)
        for st in C.STD_STATES:
            if (st in got) + (st in na) != 1:
                problems.append("%s: 기본 상태 %s가 상태와 해당 없음 가운데 한 곳에만 있어야 함" % (sid, st))
        bad = [s for s in got if s not in known]
        if bad:
            problems.append("%s: README 상태 표에 없는 상태 %s" % (sid, bad))
        if len(set(got)) != len(got):
            problems.append("%s: 상태 중복" % sid)
    rep.add("C5", "기본 상태 여섯(normal·loading·empty·error·permission·stale)은 상태나 '해당 없음'과 이유", problems,
            "그린 상태 %d개, README 상태 이름 %d개" % (total, len(known)))

    # C6 응답 전수
    contract = read_contract(root)
    problems, nresp, nvar, nexc, nskill = [], 0, 0, 0, 0
    for sid, text in docs.items():
        rows = table_rows(sections(text).get("응답과 상태", ""))
        seen = {}
        for r in rows:
            key = r[0].rstrip(" ※")
            if key in seen:
                problems.append("%s: 응답 %s가 두 번 나옴" % (sid, key))
            seen[key] = r
        for api in nodes[sid].get("apis") or []:
            for k in contract.get(api, []):
                key = "%s#%s" % (api, k)
                if key not in seen:
                    problems.append("%s: 계약의 응답 %s가 응답과 상태 표에 없음" % (sid, key))
        for key, r in seen.items():
            nresp += 1
            api, _, k = key.partition("#")
            variant = r[0].endswith(" ※")
            if api not in (nodes[sid].get("apis") or []):
                problems.append("%s: 이 화면의 API가 아닌 %s" % (sid, key))
                continue
            if variant:
                nvar += 1
                if "=" not in k or not any(c.split(":")[0] == k.split(":")[0] for c in contract.get(api, [])):
                    problems.append("%s: ※ 행 %s의 상태 코드가 계약에 없음" % (sid, key))
            elif k not in contract.get(api, []):
                problems.append("%s: 계약에 없는 응답 %s" % (sid, key))
            m = re.match(r"(SCR-\d{3})#([a-z-]+)|나오지 않음", r[1])
            if not m or len(r) < 3 or not r[2]:
                problems.append("%s: %s의 화면 상태나 보이는 것이 비었음" % (sid, key))
            elif m.group(1) and (m.group(1) != sid or m.group(2) not in described.get(sid, [])):
                problems.append("%s: %s가 이끄는 %s가 이 화면의 상태가 아님" % (sid, key, r[1]))
            elif api in SKILL_APIS:
                nskill += 1
            elif not variant and m.group(2) != default_state(sid, api, k):
                nexc += 1
    rep.add("C6", "06단계 계약의 응답마다 화면 상태 하나(openapi.yaml을 따로 읽어 대조)", problems,
            "응답 행 %d개(※ 화면이 나눈 행 %d, 카카오 스킬 %d, 기본값과 다르게 정한 행 %d)" % (nresp, nvar, nskill, nexc))

    # C7 케이스 유형·긴 글
    problems = []
    for sid, text in docs.items():
        sec = sections(text)
        kinds = table_rows(sec.get("케이스 유형", ""))
        labels = [r[0] for r in kinds]
        if not kinds or "화면 상태" not in labels:
            problems.append("%s: 케이스 유형이 없거나 '화면 상태' 행이 없음" % sid)
        bad = [x for x in labels if x not in KINDS]
        if bad:
            problems.append("%s: 모르는 케이스 유형 %s" % (sid, bad))
        if any(len(r) < 2 or not r[1] for r in kinds):
            problems.append("%s: 케이스 유형에 빈 셀" % sid)
        longs = table_rows(sec.get("긴 글과 좁은 화면", ""))
        if not longs or any(len(r) < 3 or not all(r) for r in longs):
            problems.append("%s: 긴 글과 좁은 화면 행이 없거나 비었음" % sid)
    rep.add("C7", "케이스 유형과 긴 글·좁은 화면", problems)

    # C8 교차 참조
    problems, nref = [], 0
    for name, text in list(docs.items()) + [("README", readme)]:
        for sid, st in SCR_STATE.findall(text):
            nref += 1
            if sid not in nodes:
                problems.append("%s: 없는 화면 %s#%s" % (name, sid, st))
            elif st not in described.get(sid, []):
                problems.append("%s: %s에 없는 상태 #%s" % (name, sid, st))
        for sid in set(re.findall(r"SCR-\d{3}", text)) - set(nodes):
            problems.append("%s: 사이트맵에 없는 %s" % (name, sid))
    rep.add("C8", "SCR-xxx#상태 참조가 모두 그 화면에 있는 상태(허브가 상태를 잘못 더하지 않음)", problems, "참조 %d곳" % nref)

    # C9 와이어프레임
    page = (d8 / "wireframes.html").read_text(encoding="utf-8") if (d8 / "wireframes.html").exists() else ""
    problems = []
    frames = re.findall(r'<figure class="fr w(\d+)" data-frame="(SCR-\d{3})#([a-z-]+)" data-w="(\d+)">', page)
    have = {}
    for cls_w, sid, st, w in frames:
        if cls_w != w:
            problems.append("%s#%s: 프레임 class와 data-w가 다름" % (sid, st))
        have[(sid, st, w)] = have.get((sid, st, w), 0) + 1
    want = {(sid, st, w) for sid in order for st in described.get(sid, []) for w in ("360", "1280")}
    problems += ["프레임 없음 %s#%s · %s" % k for k in sorted(want - set(have))]
    problems += ["상태 표에 없는 프레임 %s#%s · %s" % k for k in sorted(set(have) - want)]
    problems += ["프레임 %s#%s · %s가 %d번" % (k + (n,)) for k, n in sorted(have.items()) if n > 1]
    for sid in order:
        if '<section class="scr" id="%s"' % sid not in page:
            problems.append("%s: 화면 절이 없음" % sid)
    if not re.match(r"\s*<title>[^<]{2,40}</title>", page):
        problems.append("맨 앞에 <title>이 없음")
    if '<meta name="claude:viewport-fit-sides" content="cover">' not in page[:2000]:
        problems.append("viewport-fit-sides 표시가 없음")
    ext = re.findall(r'(?:src|href)="(https?://[^"]+)"', page) + re.findall(r"<link\b|<script\s+src", page)
    if ext:
        problems.append("바깥 자원 %s" % ext[:3])
    head = re.search(r"화면 (\d+)개, 상태 (\d+)개", page)
    if not head or (int(head.group(1)), int(head.group(2))) != (len(order), total):
        problems.append("머리글의 화면·상태 수가 %s(화면 %d, 상태 %d여야 함)" % (head.group(0) if head else "없음", len(order), total))
    size = len(page.encode("utf-8"))
    if size > 16 * 1024 * 1024:
        problems.append("페이지가 16MB를 넘음")
    rep.add("C9", "와이어프레임: 그린 상태마다 360·1280 프레임 하나씩, 바깥 자원 없음", problems,
            "프레임 %d개(상태 %d × 2), %.1fMB" % (len(frames), total, size / 1048576))

    # C10 06단계 문구
    text06 = (root / "docs/06-api/README.md").read_text(encoding="utf-8")
    problems = []
    conf = {r[0].strip("`"): r[3] for r in generated(text06, "confirmations") or []}
    outs = {r[0].strip("`"): r[3] for r in generated(text06, "skill-outcomes") or []}
    if not conf or not outs:
        problems.append("06단계 README의 확인 문구나 스킬 결과 표를 읽지 못함")
    for k in sorted(set(conf) | set(C.CONFIRM_MSG)):
        if conf.get(k) != C.CONFIRM_MSG.get(k):
            problems.append("확인 문구 %s: 06단계 '%s' ≠ 08단계 '%s'" % (k, conf.get(k), C.CONFIRM_MSG.get(k)))
    same = changed = desc = 0
    for k in sorted(set(outs) | set(C.OUTCOME_TEXT)):
        ours = C.OUTCOME_TEXT.get(k)
        if ours is None or k not in outs:
            problems.append("스킬 결과 %s가 한쪽에만 있음" % k)
        elif k in C.OUTCOME_CHANGED:
            changed += 1
        elif ours == outs[k] or ours.startswith(outs[k] + " + "):
            same += 1  # 뒤에 ' + 새 카드'처럼 함께 가는 것만 적은 경우도 같은 문구
        elif ours.startswith("(") and ours.endswith(")"):
            desc += 1
        else:
            problems.append("스킬 결과 %s: 06단계 '%s'와 다른데 바꾼 이유가 없음" % (k, outs[k]))
    for k in C.OUTCOME_CHANGED:
        if k in outs and C.OUTCOME_TEXT.get(k) == outs[k]:
            problems.append("스킬 결과 %s: 바꿈으로 적었지만 06단계와 같음" % k)
    rep.add("C10", "확인 창 문구는 06단계와 같고, 손님 문구는 같거나 바꾼 이유가 있음", problems,
            "확인 문구 %d개, 손님 문구 %d개(같음 %d, 08단계에서 바꿈 %d, 설명 %d)" % (len(conf), len(outs), same, changed, desc))

    # C11 금지어
    dom = (root / "docs/01-domain/domain.md").read_text(encoding="utf-8")
    texts = [("SCR-0xx.md", "\n".join(docs.values())), ("README.md", readme), ("wireframes.html", page_text(page))]
    problems, notes = [], 0
    for name, text in texts:
        body = re.sub(r"https?://\S+", "", text)
        for w, tid in avoided_words(dom):
            for m in re.finditer(re.escape(w), body):
                if allowed(w, body, m.start(), m.end()):
                    notes += 1
                else:
                    problems.append("%s: '%s'(%s의 금지어) …%s…" % (name, w, tid, body[max(0, m.start() - 12): m.end() + 12].replace("\n", " ")))
    rep.add("C11", "용어집 금지어 없음", problems, "허용 예외 %d곳" % notes)

    # C12 예전 말
    problems = []
    srcs = [(p.name, p.read_text(encoding="utf-8")) for p in sorted(HERE.glob("screens_*.py"))]
    for name, text in texts + srcs:
        for rx, new in OLD_TERMS:
            for m in re.finditer(rx, text):
                problems.append("%s: '%s' → %s …%s…" % (name, m.group(0), new, text[max(0, m.start() - 12): m.end() + 12].replace("\n", " ")))
    rep.add("C12", "01~07 용어 정리 전의 말 없음(생성 파일과 원본)", problems, "규칙 %d개" % len(OLD_TERMS))

    # C13 생성 파일 일치
    r = subprocess.run([sys.executable, "-B", str(HERE / "build_screens.py"), str(root)], capture_output=True, text=True)
    rep.add("C13", "생성 파일이 원본(screens_*.py·사이트맵·계약)에서 다시 생성한 것과 같음",
            [] if r.returncode == 0 else [(r.stdout + r.stderr).strip()[-600:]], r.stdout.strip().splitlines()[0] if r.returncode == 0 and r.stdout.strip() else "")

    # C14 허브
    if hub and hub.exists():
        with tempfile.TemporaryDirectory() as tmp:
            r = subprocess.run([sys.executable, "-B", str(hub), "--home", tmp, "snapshot", "--path", str(root), "--print"],
                               capture_output=True, text=True, cwd=str(root))
        problems = []
        try:
            snap = json.loads(r.stdout)
        except ValueError:
            snap = None
            problems.append("허브 스냅숏을 읽지 못함: " + (r.stderr or r.stdout)[-300:])
        if snap:
            st = snap["stages"].get("08-screen-states", {})
            if st.get("source_state") != "found":
                problems.append("허브가 08단계 원본을 찾지 못함: %s" % st.get("source_state"))
            items = {x["id"]: x for x in snap["items"] if x.get("kind") == "screen"}
            for sid in order:
                x = items.get(sid)
                if not x:
                    problems.append("%s: 허브에 화면이 없음" % sid)
                    continue
                if sorted(x.get("states") or []) != sorted(described.get(sid, [])):
                    problems.append("%s: 허브 상태 %s ≠ 화면 정의 %s" % (sid, sorted(x.get("states") or []), sorted(described.get(sid, []))))
                if not str(x.get("screen_doc", "")).startswith("docs/08-screens/%s.md" % sid):
                    problems.append("%s: 허브의 screen_doc이 %s" % (sid, x.get("screen_doc")))
            errs = [c for c in snap.get("checks", []) if c.get("level") == "error"]
            problems += ["허브 오류: %s" % c.get("message") for c in errs]
        rep.add("C14", "허브 스냅숏이 화면마다 같은 상태를 읽음", problems,
                "08단계 파일 %s개 읽음, 상태 %s개" % (snap["stages"]["08-screen-states"].get("files") if snap else "?",
                                              sum(len(x.get("states") or []) for x in snap["items"] if x.get("kind") == "screen") if snap else "?"))
    else:
        rep.add("C14", "허브 스냅숏이 화면마다 같은 상태를 읽음", [], unseen="--hub로 허브의 hub.py를 주지 않음")

    # C15 07단계 검사
    r = subprocess.run([sys.executable, "-B", str(HERE.parent / "cake-sitemap-2026-11/check_sitemap.py"), str(root)], capture_output=True, text=True)
    last = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ""
    rep.add("C15", "07단계 사이트맵 검사가 그대로 통과", [] if r.returncode == 0 and "실패 0" in last else [last or r.stderr[-300:]], last)

    sys.exit(1 if rep.show() else 0)


if __name__ == "__main__":
    main()
