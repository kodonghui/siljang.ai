#!/usr/bin/env python3
"""09단계 목업 검사.

    python3 -B research/cake-mockup-2026-11/check_mockup.py . [--page-check PATH/page-check.js]

캔버스 내보내기(research/cake-mockup-2026-11/canvas/project/)의 아트보드를 후보 토큰(design/candidates/*.tokens.json),
08단계 화면 정의(docs/08-screens/), 07단계 사이트맵, 06단계 예시와 대어 본다. --page-check에 corthex-uxui의
page-check.js를 주면 아트보드마다 Playwright Chromium으로 그 검사를 돌린다(없으면 '미확인'). 방향을 고른 뒤에는
고른 기록과 design/base.tokens.json, 화면 정의의 목업 링크도 본다. 09단계를 마친 뒤에는 토큰 고정 기록과, 고정한
design/base.tokens.json의 SHA-256(앞 12자리)이 README에 적은 값과 같은지 본다.

아트보드 이름: 후보 시안은 A|B-SCR-000-360|1280(토큰 루트 a|b), 고른 방향으로 그린 50개 화면은 SCR-000-360|1280
(토큰 루트 base, gen_screens.py가 만듦), 두 후보를 나란히 둔 Main.
"""
import hashlib
import html
import json
import re
import subprocess
import sys
import tempfile
from html.parser import HTMLParser
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "cake-sitemap-2026-11"))
sys.path.insert(0, str(HERE.parent / "cake-screens-2026-11"))
from check_sitemap import ALLOW, Report, avoided_words  # noqa: E402
from check_screens import ALLOW_08, OLD_TERMS  # noqa: E402

PROJECT = HERE / "canvas" / "project"
NAMES = {"a": "A '주문서'", "b": "B '쇼케이스'"}

# 09단계에서 직접 확인한 금지어 예외. '주문서'는 TERM-004(주문 내용)의 금지어지만 여기서는 후보 A 디자인 방향의 이름
# ('A 주문서', 'A · 주문서', "A '주문서'")과 그 이름의 바탕이 된 '종이 주문서'다. 화면에 보이는 문구에는 쓰지 않는다.
ALLOW_09 = {"주문서": [r"A ?[·']? ?'?주문서", r"종이 주문서", r"주문서 초안"]}

# 토큰을 쓰지 않아도 되는 날값. 휴대폰(360 × 800)과 PC(1280 × 800) 프레임 크기, 아트보드 너비($preview와 같아야 함).
FRAME = {"width": {"360px", "1280px"}, "height": {"800px"}, "min-height": {"800px"}}
RAW_OK = {("Main", "gap: 80px"): "두 후보 판 사이 간격. 어느 후보의 토큰 루트에도 속하지 않는 캔버스 배치"}
UNIT = re.compile(r"(?<![\w.-])-?\d*\.?\d+(?:px|rem|em|vh|vw|vmin|vmax|pt|pc|cm|mm|in|ch|ex|ms|s|deg|rad|turn)\b")
COLOR_FN = re.compile(r"#[0-9A-Fa-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(")
NUMBER_PROPS = {"font-size", "font-weight", "line-height", "letter-spacing", "opacity", "border-radius", "border-width",
                "outline-width", "outline-offset", "gap", "row-gap", "column-gap"}
COLOR_PROPS = {"color", "background", "background-color", "border", "border-top", "border-right", "border-bottom", "border-left",
               "border-color", "border-inline", "border-block", "border-inline-start", "border-inline-end", "border-block-start",
               "border-block-end", "outline", "outline-color", "box-shadow", "text-shadow", "fill", "stroke",
               "text-decoration-color", "caret-color", "accent-color", "column-rule"}
COLOR_WORDS = {"V", "transparent", "currentcolor", "inherit", "none", "solid", "dashed", "dotted", "inset", "calc"}
VAR = re.compile(r"var\(\s*(--[a-z0-9-]+)\s*(,[^()]*)?\)")

# 보이는 문구 가운데 06·08단계 출처에 그대로 없는 것과 그 이유
ALLOW_COPY = {
    "2호·캐릭터 그림을 함께 고르면": "06단계 예시 가격표의 옵션 규칙(2호와 캐릭터 그림을 함께 고르면 5,000원을 더함)과 SPEC-004 "
                             "'옵션 규칙(함께 못 고르는 옵션, 더하는 값)'을 사장님이 읽는 문장으로 씀",
    "달빛케이크(이하 '가게')는 케이크 주문 상담과 주문 처리를 위해 다음과 같이 개인정보를 처리합니다.":
        "SCR-002 처리방침 본문. 06단계 예시(API-039)의 첫 문장 '주문 상담과 예약을 위해'의 '예약'이 TERM-001(주문)의 금지어라 "
        "'주문 처리'로 바꿈. 06단계 예시를 고칠 때 맞춤(09 README 7절)",
    "손님이 채널 친구예요": "SCR-017 데이터 '손님 채널 친구 여부'(API-041 customerChannelFriend)를 보이는 문장으로 씀. 친구가 아니면 "
                   "보낸 뒤 '손님이 채널 친구가 아니어서 다음 대화 때 먼저 전해요'",
    "처음 픽업 일시": "SCR-038 '날짜를 바꾼 주문의 환불 기준' 라디오의 값 original_pickup(API-020 dateChangeRefundBasis). 08 정의에 보이는 이름이 없음",
    "바꾼 픽업 일시": "같은 라디오의 값 new_pickup",
    "72시간 이상": "SCR-038·039 단계별 환불 표의 '픽업 전 시간' 값. 06단계 예시 refundTiers(hoursBeforeMin 72, 끝 없음)를 읽는 말로 씀",
    "72시간 미만": "같은 표의 둘째 행(hoursBeforeMin 0, hoursBeforeMax 72)",
    "오픈빌더에서 봇을 열었을 때 주소의 /bot/ 다음 값이에요": "SCR-041 '봇 ID 찾는 법'을 펼친 글. 08 README W7 '오픈빌더에서 봇을 열었을 때 주소의 "
                                          "/bot/ 다음 값이라고 안내함'을 안내 문장으로 씀(주소 형식은 개발 전 실제 오픈빌더 화면으로 확인)",
}
# 후보 시안(A-·B-, 방향을 고르기 전 그림)에서만 받는 글과 그 이유. 고른 뒤 08 정의가 바뀌어도 후보 시안은 방향을 고른 기록이라 다시 그리지 않음
CANDIDATE_COPY = {
    "손님 결제 안내에": "후보 A·B의 SCR-022 360. 방향을 고를 때의 08 정의 SCR-022 '금액 변경 수락' 행의 '손님에게 요청 금액 → 바뀐 금액이 담긴 "
                 "결제 안내'를 금액 필드 아래 미리보기로 풀어 씀",
    "으로 보내요": "위와 같은 문장의 끝(금액 두 개는 굵게 따로 씀)",
    "바꾼 금액": "후보 A·B의 SCR-022 360 금액 필드 이름. 방향을 고를 때의 08 정의 SCR-022 '바꾼 금액 1원~1,000만 원'. 설계 재검토 M6(PR G2)로 "
             "08 정의가 '최종 금액'(견적의 아래 끝 이상, REQ-230)이 됨",
    "요청 금액 70,000원 · 1원~1,000만 원": "같은 필드의 도움말(요청 금액과 그때의 한도)",
}
VALUE = [r"0\d{1,2}-\d{3,4}-\d{4}", r"[+]?\d{1,3}(?:,\d{3})*(?:만)? ?원(?:부터)?", r"[+]?\d{1,3}(?:,\d{3})+", r"\d{4}년", r"\d{1,2}월",
         r"\d{1,2}일(?:\([월화수목금토일]\))?", r"[월화수목금토일]요일", r"\d{1,2}:\d{2}", r"\b[A-Z][A-Z0-9]{5}\b",
         r"\b[0-9a-f]{32}\b", r"\d+(?:장|개|호|건)?", r"—"]
# 출처의 자리 값({count}, '버전 n', 'n건', 'M월 D일 HH:MM', 가린 이름 '김OO'). 출처도 값을 빼고 견줄 때 함께 뺌
PLACEHOLDER = [r"\{[A-Za-z_]+\}(?:장|개|호|건)?", r"(?<![A-Za-z])n(?:장|개|호|건)?(?![A-Za-z])", r"(?<![A-Za-z])M월", r"(?<![A-Za-z])D일",
               r"HH:MM", r"[가-힣]OO"]
# 화면 아트보드 이름. 후보 시안(A-·B-)과 고른 방향의 화면(앞 글자 없음)
SCREEN = re.compile(r"(?:[AB]-)?SCR-\d{3}-(360|1280)")


def root_of(b):
    """화면 아트보드의 토큰 루트: 후보 시안은 a·b, 고른 방향의 화면은 base."""
    return "base" if b.name.startswith("SCR-") else b.name[0].lower()


def scr_of(b):
    """(후보 글자 또는 None, SCR-000, 너비)"""
    if b.name.startswith("SCR-"):
        return None, b.name[:7], b.name.rsplit("-", 1)[1]
    return b.name[0], b.name[2:9], b.name.rsplit("-", 1)[1]


# 접근성 이름(aria-label) 가운데 08단계 정의에 없는 것. 정의는 아이콘 버튼·영역의 이름을 정하지 않아 시안에서 붙였다.
ALLOW_A11Y = [
    (r"뒤로|메뉴 열기", "위쪽 막대의 아이콘 버튼"),
    (r"(?:사장님|운영자) 메뉴", "1280 왼쪽 메뉴(nav)의 이름"),
    (r"할 일 보기", "'열린 할 일'·'처리한 일' 탭 묶음(tablist)의 이름"),
    (r"(?:포트폴리오|참고|신고|후기) 사진 \d+ 크게 보기", "사진을 크게 여는 버튼"),
    (r"도안 .+ 그림 크게 보기", "가격표의 도안 그림을 크게 여는 버튼(04·08단계의 말 '도안 그림')"),
    (r"메시지 입력", "카카오톡 대화 화면 아래 입력 줄(카카오톡 앱의 부분이라 08 정의에 이름이 없음)"),
]

# DTCG 2025.10
COLOR_SPACES = {"srgb", "srgb-linear", "hsl", "hwb", "lab", "lch", "oklab", "oklch", "display-p3", "a98-rgb", "prophoto-rgb",
                "rec2020", "xyz-d65", "xyz-d50"}
GROUP_KEYS = {"$type", "$description", "$extensions", "$deprecated", "$extends"}
TOKEN_KEYS = {"$value", "$type", "$description", "$extensions", "$deprecated"}
WEIGHT_WORDS = {"thin", "hairline", "extra-light", "ultra-light", "light", "normal", "regular", "book", "medium", "semi-bold",
                "demi-bold", "bold", "extra-bold", "ultra-bold", "black", "heavy", "extra-black", "ultra-black"}


def is_num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def is_dim(v, units=("px", "rem")):
    return isinstance(v, dict) and set(v) == {"value", "unit"} and is_num(v["value"]) and v["unit"] in units


def color_errors(v):
    if isinstance(v, str) and re.fullmatch(r"\{[^{}]+\}", v):
        return []
    if not isinstance(v, dict):
        return ["색 값이 객체가 아님"]
    errs = ["모르는 키 %s" % sorted(set(v) - {"colorSpace", "components", "alpha", "hex"})] if set(v) - {"colorSpace", "components", "alpha", "hex"} else []
    comps = v.get("components")
    if v.get("colorSpace") not in COLOR_SPACES:
        errs.append("colorSpace %r" % v.get("colorSpace"))
    if not (isinstance(comps, list) and len(comps) == 3 and all(is_num(c) or c == "none" for c in comps)):
        errs.append("components %r" % comps)
    elif v.get("colorSpace") == "srgb" and not all(0 <= c <= 1 for c in comps if is_num(c)):
        errs.append("components가 0~1 밖")
    if "alpha" in v and not (is_num(v["alpha"]) and 0 <= v["alpha"] <= 1):
        errs.append("alpha %r" % v["alpha"])
    if "hex" in v:
        hx = v["hex"]
        if not (isinstance(hx, str) and re.fullmatch(r"#[0-9A-Fa-f]{6}", hx)):
            errs.append("hex %r" % hx)
        elif v.get("colorSpace") == "srgb" and not errs and [round(c * 255) for c in comps] != [int(hx[i:i + 2], 16) for i in (1, 3, 5)]:
            errs.append("hex %s가 components와 다름" % hx)
    return errs


def value_errors(ty, v):
    if isinstance(v, str) and re.fullmatch(r"\{[^{}]+\}", v):
        return []
    if ty == "color":
        return color_errors(v)
    if ty == "dimension":
        return [] if is_dim(v) else ["dimension 값 %r" % (v,)]
    if ty == "duration":
        return [] if is_dim(v, ("ms", "s")) else ["duration 값 %r" % (v,)]
    if ty == "fontFamily":
        ok = (isinstance(v, str) and v) or (isinstance(v, list) and v and all(isinstance(x, str) and x for x in v))
        return [] if ok else ["fontFamily 값 %r" % (v,)]
    if ty == "fontWeight":
        return [] if (is_num(v) and 1 <= v <= 1000) or v in WEIGHT_WORDS else ["fontWeight 값 %r" % (v,)]
    if ty == "number":
        return [] if is_num(v) else ["number 값 %r" % (v,)]
    if ty == "cubicBezier":
        ok = isinstance(v, list) and len(v) == 4 and all(is_num(x) for x in v) and 0 <= v[0] <= 1 and 0 <= v[2] <= 1
        return [] if ok else ["cubicBezier 값 %r" % (v,)]
    if ty == "shadow":
        errs = []
        for s in v if isinstance(v, list) else [v]:
            keys = set(s) if isinstance(s, dict) else set()
            if not {"color", "offsetX", "offsetY", "blur", "spread"} <= keys or keys - {"color", "offsetX", "offsetY", "blur", "spread", "inset"}:
                errs.append("shadow 키 %r" % sorted(keys))
                continue
            errs += color_errors(s["color"])
            errs += ["shadow %s %r" % (k, s[k]) for k in ("offsetX", "offsetY", "blur", "spread") if not is_dim(s[k])]
            if "inset" in s and not isinstance(s["inset"], bool):
                errs.append("shadow inset %r" % s["inset"])
        return errs
    return ["이 검사가 모르는 타입 %s" % ty]


def token_errors(doc):
    """DTCG 2025.10: 그룹은 $value가 없는 객체, 토큰은 $value와 $type(그룹에서 물려받아도 됨)이 있고 값이 타입의 형식을 따름."""
    errs, tokens = [], {}

    def walk(node, path, inherited):
        for k, v in node.items():
            if k.startswith("$"):
                continue
            name = ".".join(path + [k])
            if re.search(r"[.{}]", k):
                errs.append("%s: 이름에 . { } 를 씀" % name)
            if not isinstance(v, dict):
                errs.append("%s: 객체가 아님" % name)
                continue
            dollar = {x for x in v if x.startswith("$")}
            if "$value" in v:
                ty = v.get("$type", inherited)
                if dollar - TOKEN_KEYS:
                    errs.append("%s: 토큰에 쓸 수 없는 키 %s" % (name, sorted(dollar - TOKEN_KEYS)))
                if any(not x.startswith("$") for x in v):
                    errs.append("%s: 토큰 안에 다른 이름이 있음" % name)
                if not ty:
                    errs.append("%s: $type 없음" % name)
                else:
                    errs.extend("%s: %s" % (name, e) for e in value_errors(ty, v["$value"]))
                tokens[name] = (ty, v["$value"])
            else:
                if dollar - GROUP_KEYS:
                    errs.append("%s: 그룹에 쓸 수 없는 키 %s" % (name, sorted(dollar - GROUP_KEYS)))
                if not any(not x.startswith("$") for x in v):
                    errs.append("%s: 빈 그룹" % name)
                walk(v, path + [k], v.get("$type", inherited))

    top = {x for x in doc if x.startswith("$")} - GROUP_KEYS - {"$schema"}
    if top:
        errs.append("파일 맨 위에 쓸 수 없는 키 %s" % sorted(top))
    walk(doc, [], doc.get("$type"))
    for name, (ty, v) in tokens.items():
        if isinstance(v, str) and re.fullmatch(r"\{[^{}]+\}", v):
            target = tokens.get(v[1:-1])
            if not target:
                errs.append("%s: 참조 %s가 없음" % (name, v))
            elif target[0] != ty:
                errs.append("%s: 참조 %s의 타입이 다름" % (name, v))
    return errs, tokens


class Board(HTMLParser):
    """아트보드의 <x-dc> 안: 토큰 루트별 변수, 요소마다 스타일과 그 토큰 루트, 보이는 글, 캡션, SVG 크기."""
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
    HIDDEN = {"script", "style", "title", "svg", "helmet"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.roots, self.styles, self.texts, self.attrs, self.svg = [], {}, [], [], [], []
        self.css, self.cap, self.hidden, self.in_style = [], 0, 0, False

    def scope(self):
        return next((k for _, k in reversed(self.stack) if k), None)

    def handle_starttag(self, tag, attrs):
        self.start(tag, attrs, tag not in self.VOID)

    def handle_startendtag(self, tag, attrs):
        self.start(tag, attrs, False)

    def start(self, tag, attrs, push):
        a = dict(attrs)
        key, style = a.get("data-tokens"), a.get("style") or ""
        if key:
            self.roots.setdefault(key, []).append(dict(re.findall(r"(--[a-z0-9-]+):([^;]*);", style)))
            style = re.sub(r"--[a-z0-9-]+:[^;]*;", "", style)
        if push:
            self.stack.append((tag, key))
            if tag in self.HIDDEN:
                self.hidden += 1
            if tag == "figcaption":
                self.cap += 1
            if tag == "style":
                self.in_style = True
        if tag == "svg":
            self.svg.append((a.get("width"), a.get("height"), a.get("style") or ""))
        if style.strip():
            self.styles.append((self.scope() if push else (key or self.scope()), tag, style))
        if not self.hidden:
            for k in ("aria-label", "alt", "placeholder", "title"):
                if a.get(k):
                    self.attrs.append((k, a[k]))
            if tag in ("input", "textarea") and a.get("value"):
                self.texts.append(("text", a["value"]))

    def handle_endtag(self, tag):
        while self.stack:
            t, _ = self.stack.pop()
            if t in self.HIDDEN:
                self.hidden -= 1
            if t == "figcaption":
                self.cap -= 1
            if t == "style":
                self.in_style = False
            if t == tag:
                break

    def handle_data(self, data):
        if self.in_style:
            self.css.append(data)
        t = " ".join(data.split())
        if t and not self.hidden:
            self.texts.append(("caption" if self.cap else "text", t))


def read_board(path):
    t = path.read_text(encoding="utf-8")
    b = Board()
    b.feed(t[t.index("<x-dc>"): t.index("</x-dc>") + len("</x-dc>")] if "<x-dc>" in t and "</x-dc>" in t else "")
    b.close()
    m = re.search(r"data-props='(\{.*?\})'", t)
    b.preview = (json.loads(m.group(1)).get("$preview") if m else None) or {}
    b.raw, b.name = t, path.name[: -len(".dc.html")]
    return b


def declarations(style):
    for decl in style.split(";"):
        prop, sep, val = decl.partition(":")
        if sep and prop.strip():
            yield prop.strip().lower(), val.strip()


def css_vars(path):
    out = subprocess.run([sys.executable, "-B", str(HERE / "css_vars.py"), str(path)], capture_output=True, text=True, check=True).stdout
    return {k: v.replace('"', "'") for k, v in re.findall(r"(--[a-z0-9-]+):([^;]*);", out)}


def strip_values(s, names=()):
    """값(금액·날짜·요일·시각·전화번호·주문번호·추적 ID·개수·06 예시의 이름)과 따옴표·괄호·쉼표·마침표를 뺀 말"""
    for n in names:
        s = s.replace(n, " ")
    for v in VALUE:
        s = re.sub(v, " ", s)
    return " ".join(re.sub(r"[+,.()'\"]", " ", s).split())


def norm_source(src):
    """출처도 자리 값과 값을 빼서 견줌(예: '결제 기한 M월 D일 HH:MM에 지나 …', '이날 확정 주문 {count}건은 …')"""
    for v in PLACEHOLDER:
        src = re.sub(v, " ", src)
    return strip_values(src)


def copy_ok(text, src, names, src_norm=""):
    """출처에 그대로 있거나, ' · '·' → '·', '·'~'·'/'·': '로 나눈 조각마다 값을 뺀 나머지 말이 출처(또는 값을 뺀 출처)에 있음."""
    if text in src:
        return True
    for part in re.split(r" · | → |, |~|/|: ", text):
        rest = strip_values(part, names)
        if rest and rest not in src and rest not in src_norm:
            return False
    return True


def allowed(word, text, start, end):
    window = text[max(0, start - 14): end + 14]
    return any(re.search(a, window) for a in ALLOW.get(word, []) + ALLOW_08.get(word, []) + ALLOW_09.get(word, []))


def main():
    args = sys.argv[1:]
    pc = None
    if "--page-check" in args:
        i = args.index("--page-check")
        pc = Path(args[i + 1]).resolve()
        del args[i:i + 2]
    root = Path(args[0] if args else ".").resolve()
    rep = Report()
    files = sorted(PROJECT.glob("*.dc.html"))
    boards = [read_board(f) for f in files]
    screens = [b for b in boards if SCREEN.fullmatch(b.name)]
    others = [b.name for b in boards if b not in screens and b.name != "Main"]

    # C1 토큰 파일
    cand = {k: root / ("design/candidates/%s.tokens.json" % k) for k in NAMES}
    base = root / "design/base.tokens.json"
    problems, counts = [], []
    for key, path in list(cand.items()) + ([("base", base)] if base.exists() else []):
        if not path.exists():
            problems.append("%s 없음" % path.relative_to(root))
            continue
        errs, tokens = token_errors(json.loads(path.read_text(encoding="utf-8")))
        problems += ["%s: %s" % (path.name, e) for e in errs]
        counts.append("%s %d개" % (path.name, len(tokens)))
    rep.add("C1", "토큰 파일이 DTCG 2025.10 형식(그룹은 $value 없음, 토큰은 $value·$type, 값은 타입의 형식)", problems, ", ".join(counts))

    # C2 아트보드의 토큰 값과 글꼴
    problems = []
    expected = {k: css_vars(p) for k, p in list(cand.items()) + [("base", base)] if p.exists()}
    for b in boards:
        if not b.roots:
            problems.append("%s: 토큰 루트(data-tokens)가 없음" % b.name)
        if b in screens and set(b.roots) != {root_of(b)}:
            problems.append("%s: 토큰 루트가 %s(파일 이름으로는 %s)" % (b.name, sorted(b.roots), root_of(b)))
        for key, props_list in b.roots.items():
            for props in props_list:
                exp = expected.get(key)
                if exp is None:
                    problems.append("%s: 모르는 후보 %s" % (b.name, key))
                    continue
                got = {k: v.replace('"', "'") for k, v in props.items()}
                for k in sorted(set(exp) | set(got)):
                    if exp.get(k) != got.get(k):
                        problems.append("%s(%s): %s 아트보드 %s, 토큰 파일 %s" % (b.name, key, k, got.get(k), exp.get(k)))
            fams = {props_list[0].get(k, "").split(",")[0].strip("'\" ") for k in props_list[0] if k.startswith("--font-family-")}
            weights = {props_list[0][k] for k in props_list[0] if k.startswith("--font-weight-")}
            links = " ".join(html.unescape(x) for x in re.findall(r'<link[^>]+href="(https://fonts\.googleapis\.com/[^"]+)"', b.raw))
            for f in fams:
                if "family=" + f.replace(" ", "+") not in links:
                    problems.append("%s(%s): 글꼴 %s를 불러오지 않음" % (b.name, key, f))
            loaded = set(re.findall(r"\d{3}", " ".join(re.findall(r"wght@([\d;]+)", links))))
            if weights - loaded:
                problems.append("%s(%s): 굵기 %s를 불러오지 않음" % (b.name, key, sorted(weights - loaded)))
    rep.add("C2", "아트보드의 토큰 값이 토큰 파일과 같고(css_vars.py, 글꼴 이름의 따옴표만 다름) 토큰의 글꼴·굵기를 불러옴", problems,
            "아트보드 %d개, 토큰 루트 %d개" % (len(boards), sum(len(v) for b in boards for v in b.roots.values())))

    # C3 날값 / C4 변수
    raw, undefined, used, notes = [], [], {k: set() for k in list(NAMES) + ["base"]}, 0
    for b in boards:
        w = b.preview.get("width")
        defined = {k: set().union(*map(set, v)) for k, v in b.roots.items()}
        css = "".join(b.css)
        rules = [(None, decls) for decls in re.findall(r"\{([^{}]*)\}", css)]
        for scope, tag, style in [(s, t, st) for s, t, st in b.styles] + [(None, "style", d) for _, d in rules]:
            for prop, val in declarations(style):
                if (b.name, "%s: %s" % (prop, val)) in RAW_OK:
                    notes += 1
                    continue
                for m in VAR.finditer(val):
                    names = [k for k in defined if m.group(1) in defined[k]] if scope is None and tag == "style" else None
                    if m.group(2):
                        raw.append("%s <%s> %s: %s — 변수에 대체값" % (b.name, tag, prop, val))
                    if tag == "style":
                        missing = [k for k in defined if m.group(1) not in defined[k]]
                        if missing or not defined:
                            undefined.append("%s <style> %s가 토큰 루트 %s에 없음" % (b.name, m.group(1), missing or "없음"))
                        for k in names or []:
                            used.setdefault(k, set()).add(m.group(1))
                    elif scope is None:
                        undefined.append("%s <%s> %s — 토큰 루트 밖에서 변수를 씀" % (b.name, tag, m.group(1)))
                    elif m.group(1) not in defined.get(scope, set()):
                        undefined.append("%s <%s> %s가 토큰 루트 %s에 없음" % (b.name, tag, m.group(1), scope))
                    else:
                        used.setdefault(scope, set()).add(m.group(1))
                v = VAR.sub("V", val)
                for u in UNIT.findall(v):
                    if not (u in FRAME.get(prop, ()) or (prop == "width" and u == "%spx" % w)):
                        raw.append("%s <%s> %s: %s" % (b.name, tag, prop, val))
                if COLOR_FN.search(v):
                    raw.append("%s <%s> %s: %s" % (b.name, tag, prop, val))
                if prop in NUMBER_PROPS and re.search(r"(?<![\w.-])(?:\d*\.)?\d*[1-9]\d*(?![\w%])", v):
                    raw.append("%s <%s> %s: %s" % (b.name, tag, prop, val))
                if prop in COLOR_PROPS:
                    words = {x.lower() for x in re.findall(r"[A-Za-z][A-Za-z-]*", v)} - {x.lower() for x in COLOR_WORDS}
                    if words:
                        raw.append("%s <%s> %s: %s — 색 이름 %s" % (b.name, tag, prop, val, sorted(words)))
                if prop == "font-family" and v not in ("V", "inherit"):
                    raw.append("%s <%s> %s: %s" % (b.name, tag, prop, val))
    rep.add("C3", "스타일 값은 토큰 이름만 씀(0·%·fr·개수, 360·1280 × 800 프레임과 아트보드 너비만 날값)", sorted(set(raw)),
            "예외 %d곳: %s" % (notes, "; ".join("%s '%s' %s" % (k[0], k[1], r) for k, r in RAW_OK.items())))
    sizes = {k: len(css_vars(p)) for k, p in list(cand.items()) + [("base", base)] if p.exists()}
    rep.add("C4", "쓴 변수가 모두 그 요소가 속한 토큰 루트(후보 a·b, 고른 방향 base)에 있음", sorted(set(undefined)),
            ", ".join("%s 토큰 %d개 중 %d개 씀" % (NAMES.get(k, "base"), sizes.get(k, 0), len(used.get(k, ())))
                      for k in list(NAMES) + ["base"]))

    # C5 파일 형식
    problems = []
    for b in boards:
        t = b.raw
        for need, what in (("<!doctype html>", "doctype"), ('<html lang="ko">', "lang=ko"), ('<script src="./support.js"></script>', "support.js"),
                           ("<x-dc>", "<x-dc>"), ("</x-dc>", "</x-dc>"), ("<helmet>", "<helmet>"), ("data-dc-script", "data-dc-script")):
            if need not in t:
                problems.append("%s: %s 없음" % (b.name, what))
        if "{{" in t:
            problems.append("%s: 빈 자리 {{ }}가 남음" % b.name)
        if not re.search(r"<title>[^<]+</title>", t):
            problems.append("%s: <title> 없음" % b.name)
        if not (is_num(b.preview.get("width")) and is_num(b.preview.get("height"))):
            problems.append("%s: $preview 너비·높이 없음" % b.name)
    if others:
        problems.append("이름 규칙(A|B-SCR-000-360|1280, SCR-000-360|1280, Main) 밖의 아트보드: %s" % ", ".join(others))
    rep.add("C5", "아트보드 파일 형식(doctype·lang·support.js·<x-dc>·<helmet>·$preview, 빈 자리 없음)", problems,
            "후보 시안 %d개, 고른 방향의 화면 %d개와 Main" % (sum(not b.name.startswith("SCR-") for b in screens),
                                               sum(b.name.startswith("SCR-") for b in screens)))

    # C6 캔버스 배치
    problems = []
    canvas = json.loads((PROJECT / "canvas.json").read_text(encoding="utf-8"))
    cb = canvas.get("boards", {})
    if set(cb) != {f.name for f in files}:
        problems.append("canvas.json의 보드와 파일이 다름: 보드만 %s, 파일만 %s" % (sorted(set(cb) - {f.name for f in files}), sorted({f.name for f in files} - set(cb))))
    if sorted(canvas.get("order", [])) != sorted(cb) or len(set(canvas.get("order", []))) != len(canvas.get("order", [])):
        problems.append("order가 보드 목록과 다름")
    for b in boards:
        r = cb.get(b.name + ".dc.html")
        if r and (r.get("w"), r.get("h")) != (b.preview.get("width"), b.preview.get("height")):
            problems.append("%s: 캔버스 %s×%s, $preview %s×%s" % (b.name, r.get("w"), r.get("h"), b.preview.get("width"), b.preview.get("height")))
    pages = [p["id"] for p in canvas.get("pages", [])]
    first = pages[0] if pages else None

    def page_of(r):  # page가 없으면 첫 페이지
        return r.get("page") or first
    for k, r in list(cb.items()) + list(canvas.get("notes", {}).items()):
        if pages and page_of(r) not in pages:
            problems.append("%s: 없는 페이지 %s" % (k, r.get("page")))
    if canvas.get("launch", {}).get("page") and canvas["launch"]["page"] not in pages:
        problems.append("launch의 페이지 %s가 pages에 없음" % canvas["launch"]["page"])
    rects = sorted(cb.items())
    for i, (n1, r1) in enumerate(rects):
        for n2, r2 in rects[i + 1:]:
            if page_of(r1) == page_of(r2) and r1["x"] < r2["x"] + r2["w"] and r2["x"] < r1["x"] + r1["w"] \
                    and r1["y"] < r2["y"] + r2["h"] and r2["y"] < r1["y"] + r1["h"]:
                problems.append("%s와 %s가 겹침" % (n1, n2))
    # 여러 보드의 제목(title1)은 한 줄 72px. 그 줄 위 223px 안과 보드 이름 띠(보드 위 40px)에 걸치는 보드가 없어야 함
    for k, nt in canvas.get("notes", {}).items():
        if nt.get("kind") != "title1":
            continue
        if not nt.get("maxW"):
            problems.append("메모 %s: title1에 maxW 없음" % k)
        x0, x1, y0, y1 = nt["x"], nt["x"] + (nt.get("maxW") or 0), nt["y"], nt["y"] + 223
        for n, r in cb.items():
            if page_of(r) == page_of(nt) and r["x"] < x1 and x0 < r["x"] + r["w"] and r["y"] - 40 < y1 and y0 < r["y"] + r["h"]:
                problems.append("메모 %s(%s)가 %s와 223px 안에 있음" % (k, nt.get("text"), n))
    heights = json.loads((HERE / "heights.json").read_text(encoding="utf-8")) if (HERE / "heights.json").exists() else {}
    for n, h in heights.items():
        b = next((x for x in boards if x.name == n), None)
        if not b:
            problems.append("heights.json의 %s: 파일 없음" % n)
        elif b.preview.get("height") != h:
            problems.append("heights.json의 %s: %s, $preview %s" % (n, h, b.preview.get("height")))
    rep.add("C6", "canvas.json의 보드가 파일과 같고 크기가 $preview와 같으며 겹치지 않음(heights.json도 같음)", problems,
            "보드 %d개, 메모 %d개" % (len(cb), len(canvas.get("notes", {}))))

    # C7 캡션·제목
    problems, states = [], 0
    d8 = root / "docs/08-screens"
    tree = yaml.safe_load((root / "docs/07-sitemap/sitemap.yaml").read_text(encoding="utf-8"))
    sitemap = {}

    def walk(items):
        for n in items or []:
            sitemap[n["id"]] = n["name"]
            walk(n.get("children"))
    walk(tree)
    for b in screens:
        col, scr, width = scr_of(b)
        name = sitemap.get(scr)
        defined = set(re.findall(r"(?m)^\| %s#([a-z][a-z0-9_-]*) \|" % scr, (d8 / ("%s.md" % scr)).read_text(encoding="utf-8"))) if (d8 / ("%s.md" % scr)).exists() else set()
        if not defined:
            problems.append("%s: docs/08-screens/%s.md의 상태 표가 없음" % (b.name, scr))
        caps = [t for k, t in b.texts if k == "caption"]
        if not caps:
            problems.append("%s: 캡션 없음" % b.name)
        for c in caps:
            m = re.match(r"(SCR-\d{3})#([a-z][a-z0-9_-]*) · (\d+)", c)
            if not m:
                problems.append("%s: 캡션이 'SCR-000#상태 · 너비'로 시작하지 않음: %s" % (b.name, c))
                continue
            states += 1
            if m.group(1) != scr:
                problems.append("%s: 캡션의 화면 %s" % (b.name, m.group(1)))
            if m.group(2) not in defined:
                problems.append("%s: %s#%s는 08단계 정의에 없는 상태" % (b.name, scr, m.group(2)))
            if m.group(3) != width:
                problems.append("%s: 캡션의 너비 %s" % (b.name, m.group(3)))
        title = re.search(r"<title>([^<]+)</title>", b.raw)
        want = ("%s · %s · %s" % (col, name, width)) if col else ("%s %s · %s" % (scr, name, width))
        if not title or html.unescape(title.group(1)) != want:
            problems.append("%s: <title> '%s', 사이트맵으로는 '%s'" % (b.name, title and html.unescape(title.group(1)), want))
        ctitle = (cb.get(b.name + ".dc.html") or {}).get("title", "")
        cwant = ("%s · %s %s · %s · " % (col, scr, name, width)) if col else ("%s %s · %s · " % (scr, name, width))
        if not ctitle.startswith(cwant):
            problems.append("%s: 캔버스 제목 '%s'가 '%s상태'로 시작하지 않음" % (b.name, ctitle, cwant))
    rep.add("C7", "캡션의 화면 상태가 08단계 정의에 있고, 제목이 사이트맵 이름·너비와 같음", problems, "캡션 %d개" % states)

    # C8 보이는 문구의 출처
    src = "\n".join(p.read_text(encoding="utf-8") for p in sorted(d8.glob("SCR-*.md")))
    src += "\n".join(p.read_text(encoding="utf-8") for p in sorted((root / "research/cake-screens-2026-11").glob("*.py")))
    src += (root / "docs/06-api/README.md").read_text(encoding="utf-8")
    examples = (root / "research/cake-api-2026-11/api_examples.py").read_text(encoding="utf-8")
    src += examples
    names = sorted(set(re.findall(r'"(?:name|[a-z]+Name)": "([^"]+)"', examples)) | set(re.findall(r'opt\("[^"]+", "([^"]+)"\)', examples)),
                   key=len, reverse=True)
    src_norm = norm_source(src)
    problems, seen, by_rule, by_allow, a11y = [], 0, 0, set(), set()
    for b in screens:
        for kind, t in b.texts + [("attr", v) for _, v in b.attrs]:
            if kind == "caption":
                continue
            seen += 1
            t = html.unescape(t)
            if t in ALLOW_COPY or (b.name[:2] in ("A-", "B-") and t in CANDIDATE_COPY):
                by_allow.add(t)
            elif copy_ok(t, src, names, src_norm):
                by_rule += t not in src
            elif kind == "attr" and any(re.fullmatch(rx, t) for rx, _ in ALLOW_A11Y):
                a11y.add(t)
            else:
                problems.append("%s: '%s'" % (b.name, t))
    rep.add("C8", "보이는 문구와 접근성 이름이 08단계 정의·와이어프레임 원본·06단계 README·예시에 있음", sorted(set(problems)),
            "문구 %d개, 값을 빼고 맞춘 것 %d개, 이유를 적은 예외 %d개(%s), 정의에 없는 접근성 이름 %d개(%s)"
            % (seen, by_rule, len(by_allow), " / ".join(sorted(by_allow)), len(a11y), " / ".join(sorted(a11y))))

    # C9 금지어 / C10 예전 말
    dom = (root / "docs/01-domain/domain.md").read_text(encoding="utf-8")
    readme = root / "docs/09-mockup/README.md"
    texts = [(b.name, "\n".join(t for _, t in b.texts + [("attr", v) for _, v in b.attrs])) for b in boards]
    texts.append(("canvas.json", "\n".join([n.get("text", "") for n in canvas.get("notes", {}).values()] + [r.get("title", "") for r in cb.values()])))
    for key, path in list(cand.items()) + [("base", base)]:
        if path.exists():
            texts.append((path.name, "\n".join(re.findall(r'"\$description": "([^"]*)"', path.read_text(encoding="utf-8")))))
    if readme.exists():
        texts.append(("docs/09-mockup/README.md", readme.read_text(encoding="utf-8")))
    problems, notes = [], 0
    for name, text in texts:
        body = re.sub(r"https?://\S+", "", text)
        for w, tid in avoided_words(dom):
            for m in re.finditer(re.escape(w), body):
                if allowed(w, body, m.start(), m.end()):
                    notes += 1
                else:
                    problems.append("%s: '%s'(%s의 금지어) …%s…" % (name, w, tid, body[max(0, m.start() - 12): m.end() + 12].replace("\n", " ")))
    rep.add("C9", "보이는 문구·캔버스 제목·토큰 설명·09 README에 용어집 금지어 없음", problems, "허용 예외 %d곳" % notes)
    problems = []
    for name, text in texts + [(p.name, p.read_text(encoding="utf-8"))
                               for p in (HERE / "gen.py", HERE / "make_tokens.py", HERE / "gen_screens.py", HERE / "screen_samples.py")]:
        for rx, new in OLD_TERMS:
            for m in re.finditer(rx, text):
                problems.append("%s: '%s' → %s …%s…" % (name, m.group(0), new, text[max(0, m.start() - 12): m.end() + 12].replace("\n", " ")))
    rep.add("C10", "01~07 용어 정리 전의 말 없음(위 글과 gen.py·make_tokens.py·gen_screens.py·screen_samples.py)", problems,
            "규칙 %d개" % len(OLD_TERMS))

    # C11 page-check
    if not pc:
        rep.add("C11", "page-check(한국어 줄바꿈·넘침·대비·누름 영역) 오류 0", [], unseen="--page-check로 page-check.js를 주지 않음")
    else:
        problems, warns = [], []
        with tempfile.TemporaryDirectory() as tmp:
            for b in boards:
                w, h = b.preview.get("width"), b.preview.get("height")
                out = Path(tmp) / (b.name + ".html")
                subprocess.run([sys.executable, "-B", str(HERE / "dc2html.py"), str(PROJECT / (b.name + ".dc.html")), str(out)], check=True)
                r = subprocess.run(["node", str(HERE / "check_local.js"), str(pc), str(out), str(w)], capture_output=True, text=True, cwd=HERE)
                try:
                    j = json.loads(r.stdout.strip().splitlines()[0])
                except (IndexError, ValueError):
                    problems.append("%s: page-check를 돌리지 못함 %s" % (b.name, (r.stderr or r.stdout).strip()[-200:]))
                    continue
                if not j["pass"] or j["counts"].get("error"):
                    problems.append("%s: 오류 %s %s" % (b.name, j["counts"].get("error"), j["byCheck"]))
                if (j["dims"]["w"], j["dims"]["h"]) != (w, h):
                    problems.append("%s: 그린 크기 %s×%s, $preview %s×%s" % (b.name, j["dims"]["w"], j["dims"]["h"], w, h))
                if j["dims"]["docW"] > w:
                    problems.append("%s: 가로 넘침 %s" % (b.name, j["dims"]["docW"]))
                if j["errs"]:
                    problems.append("%s: 콘솔 오류 %s" % (b.name, j["errs"][:2]))
                if j["counts"].get("warn") or j["counts"].get("info"):
                    warns.append("%s 경고 %s·알림 %s %s" % (b.name, j["counts"].get("warn", 0), j["counts"].get("info", 0), j["byCheck"]))
        rep.add("C11", "page-check(한국어 줄바꿈·넘침·대비·누름 영역) 오류 0, 크기가 $preview와 같고 가로 넘침·콘솔 오류 없음", problems,
                "아트보드 %d개. %s" % (len(boards), "; ".join(warns) if warns else "경고·알림 없음"))

    # C12 아이콘 크기: 고른 방향의 화면은 base 토큰 size.icon-sm·md·lg만(SVG에 width·height 속성 없이 style로)
    problems, n = [], 0
    for b in screens:
        if not b.name.startswith("SCR-"):
            continue
        for w_, h_, st in b.svg:
            n += 1
            if w_ or h_:
                problems.append("%s: SVG에 크기 속성 width=%s height=%s" % (b.name, w_, h_))
            sizes_ = re.findall(r"(?:^|;)\s*(width|height):\s*([^;]+)", st)
            if {k for k, _ in sizes_} != {"width", "height"} or any(not re.fullmatch(r"var\(--size-icon-(?:sm|md|lg)\)", v.strip()) for _, v in sizes_):
                problems.append("%s: SVG 크기 %s" % (b.name, st))
    icons = sorted({int(w_) for b in boards if not b.name.startswith("SCR-") for w_, _, _ in b.svg if w_ and w_.isdigit()})
    rep.add("C12", "고른 방향 화면의 아이콘 크기가 base 토큰 size.icon-sm·md·lg", sorted(set(problems)),
            "아이콘 %d개. 후보 시안(A·B)은 고르기 전 그림이라 SVG 속성 값 %s 그대로 둠" % (n, "·".join(map(str, icons))))

    # C13 방향 선택 기록과 토큰 고정 기록 / C14 화면 정의의 목업 링크
    stages = json.loads((root / ".corthex/stages.json").read_text(encoding="utf-8")).get("stages", {})
    st09 = stages.get("09-mockup") or {}
    cps = st09.get("checkpoints") or []
    if not cps:
        rep.add("C13", "고른 방향과 동희님 말이 기록됨", [], unseen="방향 선택 체크포인트 전(.corthex/stages.json 09-mockup에 체크포인트 없음)")
    else:
        problems = []
        for i, cp in enumerate(cps[:2]):
            for k in ("approved", "by", "where", "date"):
                if not cp.get(k):
                    problems.append("stages.json 09-mockup %s 체크포인트에 %s 없음" % (("첫", "둘째")[i], k))
        text = readme.read_text(encoding="utf-8") if readme.exists() else ""
        m = re.search(r"고른 방향: ([AB])", text)
        if not m:
            problems.append("docs/09-mockup/README.md에 '고른 방향: A|B' 줄이 없음")
        if not re.search(r"고른 방향[^\n]*\n(?:[^\n]*\n){0,6}[^\n]*\"[^\"]+\"", text):
            problems.append("docs/09-mockup/README.md의 고른 방향 가까이에 동희님 말(큰따옴표)이 없음")
        if not base.exists():
            problems.append("design/base.tokens.json 없음")
        # 토큰 고정(둘째 체크포인트): 09가 done이면 반드시, 고정한 뒤에는 파일이 README에 적은 해시와 같아야 함
        frozen = ""
        if st09.get("state") == "done" or len(cps) > 1:
            if len(cps) < 2:
                problems.append("stages.json 09-mockup이 done인데 토큰 고정 체크포인트(둘째)가 없음")
            mf = re.search(r"고정한 토큰: `design/base\.tokens\.json` (\d+)개 \(SHA-256 `([0-9a-f]{12})`\)", text)
            if not mf:
                problems.append("docs/09-mockup/README.md에 '고정한 토큰: `design/base.tokens.json` N개 (SHA-256 `앞 12자리`)' 줄이 없음")
            elif base.exists():
                # 줄 끝을 LF로 맞춰 셈(Windows에서 CRLF로 받아도 같은 값)
                digest = hashlib.sha256(base.read_bytes().replace(b"\r\n", b"\n")).hexdigest()[:12]
                if digest != mf.group(2):
                    problems.append("design/base.tokens.json의 SHA-256 앞 12자리 %s가 README에 고정한 %s와 다름"
                                    "(고정한 뒤 바꾸려면 새 결정을 README 8-2절에 적고 해시를 고침)" % (digest, mf.group(2)))
                n_tok = len(token_errors(json.loads(base.read_text(encoding="utf-8")))[1])
                if n_tok != int(mf.group(1)):
                    problems.append("design/base.tokens.json의 토큰 %d개, README에 고정한 수 %s개" % (n_tok, mf.group(1)))
                frozen = ", 토큰 고정 %s개(SHA-256 %s)" % (mf.group(1), mf.group(2))
            if not re.search(r"고정한 토큰[^\n]*\n(?:[^\n]*\n){0,8}[^\n]*\"[^\"]+\"", text):
                problems.append("docs/09-mockup/README.md의 고정한 토큰 가까이에 동희님 말(큰따옴표)이 없음")
        rep.add("C13", "고른 방향과 토큰 고정, 동희님 말이 기록됨(stages.json·README), design/base.tokens.json이 고정한 해시와 같음", problems,
                "고른 방향 %s%s" % (m.group(1) if m else "-", frozen))
    # 화면 정의 머리말의 '- 목업:' 줄이 그 화면의 360·1280 보드 파일을 링크(build_screens.py가 canvas.json에서 씀)
    problems, linked = [], set()
    allscr = {p.stem for p in d8.glob("SCR-*.md")}
    for p in sorted(d8.glob("SCR-*.md")):
        m = re.search(r"(?m)^- 목업: (.+)$", p.read_text(encoding="utf-8"))
        if not m:
            continue
        links = re.findall(r"\]\(\.\./\.\./research/cake-mockup-2026-11/canvas/project/((SCR-\d{3})-(360|1280))\.dc\.html\)", m.group(1))
        if sorted((s_, w_) for _, s_, w_ in links) != [(p.stem, "1280"), (p.stem, "360")]:
            problems.append("%s: 목업 줄의 링크 %s" % (p.stem, [n for n, _, _ in links]))
        for n, _, _ in links:
            if not (PROJECT / (n + ".dc.html")).exists() or (n + ".dc.html") not in cb:
                problems.append("%s: %s 파일이나 캔버스 보드 없음" % (p.stem, n))
        linked.add(p.stem)
    if not linked:
        rep.add("C14", "화면 정의마다 목업 링크", [], unseen="방향을 고른 뒤 남은 화면을 그리고 화면 정의에 목업 링크를 넣을 때 검사")
    else:
        problems += ["%s: 목업 링크 없음" % s_ for s_ in sorted(allscr - linked)]
        rep.add("C14", "화면 정의마다 목업 링크(360·1280 보드 파일과 캔버스 보드가 있음)", problems,
                "%d/%d" % (len(linked), len(allscr)))

    sys.exit(1 if rep.show() else 0)


if __name__ == "__main__":
    main()
