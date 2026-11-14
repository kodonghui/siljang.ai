#!/usr/bin/env python3
"""09단계 A 방향 화면 50개를 그린다: 화면마다 normal(360·1280)과 모습이 크게 다른 상태(빈 상태·오류·확인 창·카드 기한·
채널 친구가 아닐 때, 손님이 주문마다 보는 카드: 알레르기 정보·주문자 정보·새 금액 확인·입금자 이름·사진 게시 동의)의 360.

08단계 원본(research/cake-screens-2026-11/screens_*.py)의 레이아웃 블록과 상태 프레임을 그대로 읽고, 블록마다 후보 A의
부품(gen.py의 class A)을 design/base.tokens.json의 변수로 그린다. 와이어프레임의 자리 값은 screen_samples.py의 06단계 예시
값으로 바꾼다. 아이콘 크기는 base의 size.icon-sm·md·lg 토큰이다.

    python3 -B research/cake-mockup-2026-11/gen_screens.py               # 100개 모두(높이는 heights.json)
    python3 -B research/cake-mockup-2026-11/gen_screens.py SCR-001 ...   # 이 화면들만

쓰는 파일: research/cake-mockup-2026-11/canvas/project/SCR-0xx-360.dc.html, SCR-0xx-1280.dc.html, 그리고 canvas.json의
SCR 보드·메모·페이지(손님·사장님·운영자 화면 페이지. 다른 보드와 메모는 '후보 A·B' 페이지로 옮기기만 하고 자리는 그대로)
"""
import html
import json
import pathlib
import re
import subprocess
import sys
from datetime import date

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "cake-screens-2026-11"))
sys.path.insert(0, str(HERE.parent / "cake-api-2026-11"))
import gen  # noqa: E402
import screens_common as C  # noqa: E402
from build_screens import bkey, plan_wide  # noqa: E402  (screens_*.py도 함께 읽음)
from screen_samples import S as SAMPLES, SERVICE, SHOP, SHOP_INFO  # noqa: E402
from api_examples import trace  # noqa: E402  (06단계 추적 ID: 32자리 16진수)

# 예약 링크 페이지 1280의 가게 정보(gen.A.aside)를 가게 신원 정보(REQ-239, 설계 재검토 M11)로. 후보 시안은 gen.py가 따로 그려 그대로
gen.SHOP_INFO = SHOP_INFO

OUT = HERE / "canvas" / "project"
HEIGHTS = HERE / "heights.json"
# 뒤 다섯은 손님이 주문마다 보는 카드(SCR-004·005·006·011, 설계 재검토 남은 빈 곳)
KEY_STATES = ("empty", "error", "confirm-notify", "confirm", "expired", "not-sent", "deferred",
              "allergy", "orderer", "amount-confirm", "depositor", "photo-consent")
VARS = subprocess.run([sys.executable, "-B", str(HERE / "css_vars.py"), str(REPO / "design/base.tokens.json")],
                      capture_output=True, text=True, check=True).stdout.strip().replace('"', "'")
LINE = gen.LINE
OWNER_MENU = [("할 일", "SCR-016"), ("주문", "SCR-020"), ("입금 대조", "SCR-028"), ("제작", "SCR-030"), ("픽업", "SCR-031"),
              ("영업 캘린더", "SCR-032"), ("가게 설정", "SCR-034")]
OPERATOR_MENU = [("영업 신고 확인", "SCR-047"), ("운영자 알림", "SCR-049")]


def e(s):
    return html.escape(str(s), quote=False)


def a(s):
    return html.escape(str(s), quote=True)


def nb(s):
    """띄어 쓰지 않은 가운뎃점 낱말(즉석판매제조·가공업)은 줄을 바꾸지 않음. 글자는 그대로."""
    return re.sub(r"([가-힣A-Za-z0-9]+(?:·[가-힣A-Za-z0-9]+)+|\d+(?:-\d+)+)", r'<span style="white-space: nowrap">\1</span>', e(s))


# ── 아이콘: base의 아이콘 크기 토큰(16·20·24px) ─────────────────────────────────────
ICONS = dict(gen.ICONS, **{
    "alert": '<circle cx="12" cy="12" r="9"></circle><path d="M12 7.5v5.5"></path><path d="M12 16.5h.01"></path>',
    "info": '<circle cx="12" cy="12" r="9"></circle><path d="M12 11v5.5"></path><path d="M12 7.5h.01"></path>',
    "copy": '<rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path>',
    "send": '<path d="M5 12h14"></path><path d="m13 6 6 6-6 6"></path>',
    "mic": '<rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0"></path><path d="M12 18v3"></path>',
    "calendar": '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M16 3v4"></path><path d="M8 3v4"></path><path d="M3 10h18"></path>',
    "external": '<path d="M14 4h6v6"></path><path d="M10 14 20 4"></path><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"></path>',
    "upload": '<path d="M12 15V4"></path><path d="m7 9 5-5 5 5"></path><path d="M5 20h14"></path>',
    "inbox": '<path d="M3 13h5l2 3h4l2-3h5"></path><path d="M5 5h14l2 8v6H3v-6Z"></path>',
    "lock": '<rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path>',
})
ICON_TOKEN = {16: "sm", 18: "md", 20: "md", 22: "lg", 24: "lg", 28: "lg"}


def icon(name, size=20, sw="2", style=""):
    tok = size if isinstance(size, str) else ICON_TOKEN[size]
    st = "width: var(--size-icon-%s); height: var(--size-icon-%s); flex: none" % (tok, tok) + ("; " + style if style else "")
    return ('<svg style="' + st + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + sw + '" '
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>')


gen.svg = icon  # gen.A의 부품(가격표 펼침, 달 이동, 위쪽 막대 등)도 아이콘을 토큰 크기로 그림

TONE = {"accent": ("var(--color-accent-soft)", "var(--color-accent)"),
        "success": ("var(--color-success-soft)", "var(--color-success)"),
        "warning": ("var(--color-warning-soft)", "var(--color-warning)"),
        "danger": ("var(--color-danger-soft)", "var(--color-danger)"),
        "muted": ("var(--color-surface-sunken)", "var(--color-ink)")}
TODAY = date(2026, 11, 12)


class Base(gen.A):
    """후보 A '주문서'의 부품을 base 토큰으로. 08단계 블록을 그리는 부품을 더함."""
    key = "base"
    idp, idn = "x", 0  # 그림마다 figures()가 idp를 바꾸고 idn을 0으로 되돌림: 한 보드 안에서 ID가 겹치지 않고 다시 만들어도 같음

    def uid(self, kind):
        self.idn += 1
        return "%s-%s-%d" % (kind, self.idp, self.idn)

    # ── 글과 머리 ──────────────────────────────────────────────────────────
    def head(self, title, meta="", link=""):
        right = ""
        if link:
            right = ('<a href="#" style="flex: none; min-height: var(--size-target); display: inline-flex; align-items: center; '
                     'font-size: var(--font-size-small); text-underline-offset: var(--space-xs)">' + e(link) + '</a>')
        elif meta:
            right = '<span style="flex: none; font-size: var(--font-size-small); color: var(--color-ink-muted)">' + e(meta) + '</span>'
        return ('<div style="display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-sm)">'
                + self.h2(e(title)) + right + '</div>')

    def sect(self, w, inner, title=None, meta="", link="", first=False):
        body = (self.head(title, meta, link) + "\n" if title else "") + inner
        return self.band(body, first) if w == 360 else self.block(body, first)

    def note(self, text):
        return '<p style="margin: 0; font-size: var(--font-size-small); color: var(--color-ink-muted)">' + e(text) + '</p>'

    def ferr(self, eid, text):
        """필드·목록 옆 입력 오류 한 줄(설계 재검토 M19 RE-05): 위험 색 아이콘과 글. 필드는 aria-describedby로 이 줄을 가리킴."""
        return ('<span id="' + eid + '" style="display: flex; align-items: center; gap: var(--space-xs); font-size: var(--font-size-small); '
                'font-weight: var(--font-weight-medium); color: var(--color-danger)">' + icon("alert", 16, style="flex: none") + '<span>'
                + e(text) + '</span></span>')

    def link(self, text, small=True):
        fs = "font-size: var(--font-size-small); " if small else ""
        return ('<a href="#" style="align-self: flex-start; min-height: var(--size-target); display: inline-flex; align-items: center; '
                + fs + 'text-underline-offset: var(--space-xs)">' + e(text) + '</a>')

    def disclosure(self, text, open_=False, body=""):
        """펼치는 줄: 입력 필드(고르기)과 헷갈리지 않게 테두리 없이 글과 화살표만. body는 펼쳤을 때 아래 글."""
        did = self.uid("x") if body else ""
        ctl = (' aria-controls="' + did + '"') if body else ""
        btn = ('<button type="button" aria-expanded="' + ("true" if open_ else "false") + '"' + ctl + ' style="width: 100%; '
               'min-height: var(--size-target); display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); '
               'padding: 0; border: 0; background: transparent; color: var(--color-ink); font: inherit; font-weight: var(--font-weight-semibold); '
               'text-align: left">' + e(text) + icon("up" if open_ else "down", 16, style="color: var(--color-ink-muted)") + '</button>')
        if not body:
            return btn
        return (btn + '<div id="' + did + '" style="display: flex; flex-direction: column; gap: var(--space-xs); padding: var(--space-sm) var(--space-md); '
                'border-radius: var(--radius-sm); background: var(--color-surface-sunken); font-size: var(--font-size-small)">' + body + '</div>')

    def tagx(self, text, tone="muted", strong=False):
        bg, fg = TONE[tone]
        return ('<span style="flex: none; display: inline-flex; align-items: center; padding: var(--space-xxs) var(--space-sm); '
                'border-radius: var(--radius-sm); background: ' + bg + '; color: ' + fg + '; font-size: var(--font-size-small); '
                'font-weight: var(--font-weight-' + ("bold" if strong else "medium") + '); line-height: var(--font-line-height-tight); '
                'white-space: nowrap">' + e(text) + '</span>')

    def sbtn(self, label, kind="secondary", h="var(--size-target)", full=False, extra=""):
        return self.btn(kind, e(label), h=h, full=full, pad="var(--space-md)", extra=css_join("font-size: var(--font-size-small)", extra))

    # ── 셀 ───────────────────────────────────────────────────────────────
    def cell(self, c):
        if c is None:
            return ""
        if isinstance(c, str):
            return nb(c)
        if isinstance(c, list):
            return ('<span style="display: inline-flex; flex-wrap: wrap; align-items: center; gap: var(--space-xs) var(--space-sm)">'
                    + "".join(self.cell(x[0] if isinstance(x, tuple) and len(x) == 2 and x[1] is None else x) for x in c) + '</span>')
        kind = c[0]
        if kind == "tag":
            return self.tagx(c[1], c[2] if len(c) > 2 else "muted")
        if kind == "strong":
            return '<strong style="font-weight: var(--font-weight-semibold)">' + e(c[1]) + '</strong>'
        if kind == "muted":
            return '<span style="color: var(--color-ink-muted)">' + e(c[1]) + '</span>'
        if kind == "link":
            return self.link(c[1])
        if kind == "btn":
            return self.sbtn(c[1], c[2] if len(c) > 2 else "secondary")
        if kind == "btns":
            return ('<span style="display: flex; flex-wrap: wrap; gap: var(--space-xs)">'
                    + "".join(self.sbtn(lab, kind_) for lab, kind_ in c[1]) + '</span>')
        if kind == "marks":
            out = []
            for lab, at in c[1]:
                if at:
                    out.append('<span style="display: inline-flex; align-items: center; gap: var(--space-xs); min-height: var(--size-target); '
                               'padding-inline: var(--space-sm); border-radius: var(--radius-md); background: var(--color-success-soft); '
                               'color: var(--color-success); font-size: var(--font-size-small); font-weight: var(--font-weight-semibold)">'
                               + icon("check", 16) + e(lab) + '<span style="font-weight: var(--font-weight-regular)">' + e(at) + '</span></span>')
                else:
                    out.append(self.sbtn(lab))
            return '<span style="display: flex; flex-wrap: wrap; gap: var(--space-xs)">' + "".join(out) + '</span>'
        if kind == "photos":
            tags = c[2] if len(c) > 2 else None
            if not tags:
                return ('<span style="display: flex; gap: var(--space-xs)">' + "".join(
                    self.photo(lab + " 크게 보기", "", "flex: none; width: var(--size-target); height: var(--size-target)", small=True)
                    for lab in c[1]) + '</span>')
            # 사진마다 라벨(예: 후기 사진의 게시 동의)을 그 사진 바로 아래에
            return ('<span style="display: flex; flex-wrap: wrap; gap: var(--space-sm)">' + "".join(
                '<span style="display: flex; flex-direction: column; align-items: center; gap: var(--space-xxs)">'
                + self.photo(lab + " 크게 보기", "", "flex: none; width: var(--size-target); height: var(--size-target)", small=True)
                + self.cell(t) + '</span>' for lab, t in zip(c[1], tags)) + '</span>')
        raise SystemExit("모르는 셀 %r" % (c,))

    def rowlink(self, c, strong=False):
        """목록 행에서 상세로 가는 링크(본문 크기, 밑줄). 높이는 누르는 크기를 채움."""
        inner = e(c[1]) if isinstance(c, tuple) else nb(c)
        return ('<a href="#" style="display: inline-flex; align-items: center; min-height: var(--size-target); color: var(--color-ink); '
                'font-weight: var(--font-weight-' + ("semibold" if strong else "medium") + '); text-decoration: underline; '
                'text-decoration-color: var(--color-line-control); text-underline-offset: var(--space-xs)">' + inner + '</a>')

    # ── 사진 ──────────────────────────────────────────────────────────────
    def photo(self, aria, label, size_css, small=False):
        ic = icon("image", 16 if small else 24, "1.75")
        lab = e(label)
        return ('<button type="button" aria-label="' + a(aria) + '" style="' + size_css + '; padding: 0; border: 0; '
                'border-radius: var(--radius-sm); background: var(--color-surface-sunken); color: var(--color-ink-muted); '
                'display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-xs); '
                'font: inherit; font-size: var(--font-size-caption)">' + ic + lab + '</button>')

    def photos(self, w, label, n, cols, d):
        labels = d.get("labels") or ["%s %d" % (label, i + 1) for i in range(n)]
        size = d.get("size")
        caps = d.get("caption") or []
        btns = d.get("btn") or []

        def tile(i, lab, size_css):
            p = self.photo(lab + " 크게 보기" if not lab.endswith("그림") else lab + " 크게 보기", lab, size_css)
            under = ""
            if i < len(caps):
                under += '<span style="font-size: var(--font-size-small)">' + e(caps[i]) + '</span>'
            if i < len(btns):
                under += self.sbtn(btns[i], full=True)
            if not under:
                return p
            return ('<div style="min-width: 0; display: flex; flex-direction: column; gap: var(--space-xs)">' + p + under + '</div>')

        if size == "photo":  # 손님 포트폴리오: 360은 가로로 넘기는 240px 줄
            row = "\n".join(tile(i, lab, "flex: none; width: var(--size-photo); height: var(--size-photo)") for i, lab in enumerate(labels))
            return ('<div style="display: flex; gap: var(--space-sm); overflow-x: auto; scrollbar-width: none; '
                    'margin-inline: calc(-1 * var(--space-lg)); padding-inline: var(--space-lg)">\n' + row + '\n</div>')
        if size == "wide":
            return tile(0, labels[0], "width: 100%; aspect-ratio: 4 / 3")
        if size == "thumb":
            return ('<div style="display: flex; flex-wrap: wrap; gap: var(--space-sm)">' + "\n".join(
                '<div style="width: var(--size-thumb); display: flex; flex-direction: column; gap: var(--space-xs)">'
                + self.photo(lab + " 크게 보기", lab if i >= len(caps) else "", "width: var(--size-thumb); height: var(--size-thumb)")
                + (thumb_caption(caps[i]) if i < len(caps) else "") + '</div>'
                for i, lab in enumerate(labels)) + '</div>')
        c = (cols or ((1, 1) if n == 1 else (3, min(n, 4))))[1 if w == 1280 else 0]
        return ('<div style="display: grid; grid-template-columns: repeat(' + str(c) + ', minmax(0, 1fr)); gap: var(--space-sm)">\n'
                + "\n".join(tile(i, lab, "width: 100%; aspect-ratio: 1") for i, lab in enumerate(labels)) + '\n</div>')

    # ── 이름·값 ────────────────────────────────────────────────────────────
    def kvx(self, rows, copy=None):
        out = []
        for i, (k, v) in enumerate(rows):
            val = nb(v)
            if re.fullmatch(r"[0-9A-Za-z_-]{16,}", v):  # 봇 ID 같은 긴 영문·숫자 글자열은 작은 글씨로 한 줄에
                val = '<span style="font-size: var(--font-size-small)">' + e(v) + '</span>'
            if copy == k:
                val = ('<span style="display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm)">'
                       '<span style="white-space: nowrap">' + val + '</span>' + self.sbtn("복사") + '</span>')
            out.append('<div style="display: grid; grid-template-columns: var(--size-thumb) minmax(0, 1fr); gap: var(--space-md); '
                       'align-items: baseline; padding: var(--space-sm) var(--space-md);' + ("" if i == 0 else " border-top: " + LINE + ";")
                       + '"><dt style="color: var(--color-ink-muted)">' + e(k) + '</dt><dd style="margin: 0; min-width: 0; '
                       'font-weight: var(--font-weight-medium)">' + val + '</dd></div>')
        return ('<dl style="margin: 0; border: ' + LINE + '; border-radius: var(--radius-md); background: var(--color-surface)">\n'
                + "\n".join(out) + '\n</dl>')

    def hero(self, k, v):
        size = "heading" if "://" in v else "display"  # 주소는 한 단계 작게(360에서 두 줄 안에)
        return ('<div style="display: flex; flex-direction: column; gap: var(--space-xxs)"><span style="font-size: var(--font-size-small); '
                'color: var(--color-ink-muted)">' + e(k) + '</span><span style="font-size: var(--font-size-' + size + '); line-height: '
                'var(--font-line-height-tight); font-weight: var(--font-weight-bold); overflow-wrap: anywhere">' + e(v) + '</span></div>')

    def stats(self, rows, w):
        cols = 4 if w == 1280 else 2
        return ('<dl style="margin: 0; display: grid; grid-template-columns: repeat(' + str(cols) + ', minmax(0, 1fr)); gap: var(--space-sm)">'
                + "".join('<div style="display: flex; flex-direction: column; gap: var(--space-xxs); padding: var(--space-sm) var(--space-md); '
                          'border: ' + LINE + '; border-radius: var(--radius-md); background: var(--color-surface)"><dt style="font-size: '
                          'var(--font-size-small); color: var(--color-ink-muted)">' + e(k) + '</dt><dd style="margin: 0; font-weight: '
                          'var(--font-weight-semibold)">' + e(v) + '</dd></div>' for k, v in rows) + '</dl>')

    # ── 목록 ──────────────────────────────────────────────────────────────
    def tablex(self, cols, rows, widths=None, link_col=None):
        th = ("padding: var(--space-sm) var(--space-md); border-bottom: " + LINE + "; background: var(--color-surface-sunken); "
              "text-align: left; font-size: var(--font-size-small); font-weight: var(--font-weight-semibold); color: var(--color-ink-muted)")
        td = "padding: var(--space-sm) var(--space-md); vertical-align: middle; border-bottom: " + LINE
        tdl = "padding: 0 var(--space-md); vertical-align: middle; border-bottom: " + LINE  # 링크 셀: 링크가 누르는 높이를 채움
        cg = ""
        if widths:
            cg = "<colgroup>" + "".join('<col style="width: %d%%">' % x for x in widths) + "</colgroup>"

        def one(i, c):
            if i == link_col:
                strong = isinstance(c, tuple) and c[0] == "strong"
                return '<td style="' + tdl + '">' + self.rowlink(c, strong) + '</td>'
            return '<td style="' + td + '">' + self.cell(c) + '</td>'
        body = "\n".join("<tr>" + "".join(one(i, c) for i, c in enumerate(r)) + "</tr>" for r in rows)
        return ('<table style="width: 100%; border-collapse: collapse; table-layout: fixed; background: var(--color-surface); border: '
                + LINE + '">' + cg + '<thead><tr>' + "".join('<th scope="col" style="' + th + '">' + e(x) + '</th>' for x in cols)
                + '</tr></thead>\n<tbody>\n' + body + '\n</tbody></table>')

    def cards(self, cols, rows, spec, link=False, bad=()):
        out = []
        for ri, r in enumerate(rows):
            title = r[spec.get("title", 0)]
            title_html = self.rowlink(title, strong=True) if link else self.cell(title)
            tags = "".join(self.cell(r[i]) for i in spec.get("tag", []) if r[i] not in ("—", "", None))
            meta = []
            for i in spec.get("meta", []):
                if r[i] in ("—", "", None):
                    continue
                meta.append('<dt style="color: var(--color-ink-muted)">' + e(cols[i]) + '</dt><dd style="margin: 0; min-width: 0">'
                            + self.cell(r[i]) + '</dd>')
            body = ('<p style="margin: 0">' + self.cell(r[spec["body"]]) + '</p>') if "body" in spec else ""
            fc = r[spec["foot"]] if "foot" in spec else None
            foot = self.cell(fc) if fc is not None else ""
            # 버튼 줄은 왼쪽부터(줄이 바뀌어도 같은 쪽), 금액·시각 같은 값은 오른쪽 끝
            act = isinstance(fc, tuple) and fc[0] in ("btns", "marks", "btn", "photos")
            line = "var(--border-width-hairline) solid var(--color-danger)" if ri in bad else LINE  # 입력 오류가 난 행
            out.append('<li style="display: flex; flex-direction: column; gap: var(--space-xs); padding: var(--space-md); border: ' + line
                       + '; border-radius: var(--radius-md); background: var(--color-surface)">'
                       '<div style="display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); min-height: var(--space-xl)">'
                       '<span style="font-weight: var(--font-weight-semibold)">' + title_html + '</span>'
                       + ('<span style="display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-xs)">' + tags + '</span>' if tags else "")
                       + '</div>' + body
                       + ('<dl style="margin: 0; display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: var(--space-xxs) var(--space-sm); '
                          'font-size: var(--font-size-small)">'
                          + "".join(meta) + '</dl>' if meta else "")
                       + ('<div style="display: flex; justify-content: ' + ("flex-start" if act else "flex-end") + '; padding-top: var(--space-xs)">'
                          + foot + '</div>' if foot else "")
                       + '</li>')
        return ('<ul style="margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-sm)">\n'
                + "\n".join(out) + '\n</ul>')

    def navlist(self, rows, cols=None, selected=None):
        """누르면 다른 화면으로 가는 줄 목록. cols를 주면 첫 셀 아래에 '열 이름 값'을 흐린 줄로(버전 이력처럼 시각이 둘인 목록)."""
        out = []
        for i, r in enumerate(rows):
            if cols:
                t = r[0][1] if isinstance(r[0], tuple) else r[0]
                title = e(cols[0] + " " + t) if re.fullmatch(r"\d+", t) else self.cell(r[0])
                subs = ['<span style="white-space: nowrap">' + e(cols[j]) + " " + e(c) + '</span>'  # '열 이름 값'은 한 덩어리로
                        for j, c in enumerate(r) if j and isinstance(c, str) and c not in ("—", "")]
                name = ('<span style="flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: var(--space-xxs)">'
                        '<span style="font-weight: var(--font-weight-medium)">' + title + '</span><span style="font-size: var(--font-size-small); '
                        'color: var(--color-ink-muted)">' + " · ".join(subs) + '</span></span>')
                right = "".join(self.cell(c) for c in r[1:] if not isinstance(c, str))
            else:
                name = ('<span style="flex: 1 1 0; min-width: 0; font-weight: var(--font-weight-medium)">' + self.cell(r[0]) + '</span>')
                right = "".join('<span style="font-size: var(--font-size-small); color: var(--color-ink-muted)">' + self.cell(c) + '</span>'
                                if isinstance(c, str) else self.cell(c) for c in r[1:])
            on = i == selected
            out.append('<li style="' + ("" if i == 0 else "border-top: " + LINE) + '"><a href="#"' + (' aria-current="true"' if on else "")
                       + ' style="display: flex; align-items: center; gap: var(--space-sm); min-height: var(--size-target); box-sizing: border-box; '
                       'padding: var(--space-sm) var(--space-sm) var(--space-sm) var(--space-md); color: var(--color-ink); text-decoration: none'
                       + ("; background: var(--color-accent-soft); box-shadow: inset var(--border-width-strong) 0 0 var(--color-accent)" if on else "")
                       + '">' + name + right + icon("right", 16, style="color: var(--color-ink-muted)") + '</a></li>')
        return ('<ul style="margin: 0; padding: 0; list-style: none; border: ' + LINE + '; border-radius: var(--radius-md); overflow: hidden; '
                'background: var(--color-surface)">\n' + "\n".join(out) + '\n</ul>')

    # ── 폼 ───────────────────────────────────────────────────────────────
    def ctrl_box(self, inner, extra=""):
        return ('<div style="display: flex; align-items: center; gap: var(--space-sm); min-height: var(--size-control); padding-inline: '
                'var(--space-md); box-sizing: border-box; border: var(--border-width-hairline) solid var(--color-line-control); '
                'border-radius: var(--radius-sm); background: var(--color-surface)' + (extra and "; " + extra) + '">' + inner + '</div>')

    def field(self, fid, name, kind, d):
        values, opts, picks, helps = d.get("values", {}), d.get("options", {}), d.get("pick", {}), d.get("help", {})
        label = d.get("labels", {}).get(name, name)
        v = values.get(name, "")
        hid = fid + "-h"
        help_ = ('<span id="' + hid + '" style="font-size: var(--font-size-small); color: var(--color-ink-muted)">' + e(helps[name]) + '</span>'
                 if name in helps else "")
        desc = ' aria-describedby="' + hid + '"' if help_ else ""
        # 입력 오류 프레임(설계 재검토 M19 RE-05): 폼과 넣은 값은 그대로 두고 그 필드 아래에 사유. 테두리는 위험 색
        err = d["err"] if d.get("err") and d["err"][0] == name else None
        err_ = ""
        if err:
            if kind not in ("text", "number", "date", "time"):
                raise SystemExit("입력 오류를 그리지 않는 필드 종류 " + kind)
            err_ = self.ferr(fid + "-e", err[1])
            desc = ' aria-invalid="true" aria-describedby="' + " ".join([fid + "-e"] + ([hid] if help_ else [])) + '"'
        lab = '<label for="' + fid + '" style="font-weight: var(--font-weight-semibold)">' + e(label) + '</label>'
        col = "display: flex; flex-direction: column; gap: var(--space-xs)"
        inp = ("flex: 1 1 0; align-self: stretch; min-width: 0; padding: 0; border: 0; background: transparent; font: inherit; "
               "color: var(--color-ink); outline: none")
        if kind in ("text", "number", "date", "time"):
            mode = ' inputmode="numeric"' if kind == "number" else ""
            ic = icon("calendar", 20, style="color: var(--color-ink-muted)") if kind == "date" else ""
            return ('<div style="' + col + '">' + lab + self.ctrl_box('<input id="' + fid + '"' + mode + desc + ' value="' + a(v) + '" style="'
                                                                      + inp + '">' + ic, "border-color: var(--color-danger)" if err else "")
                    + err_ + help_ + '</div>')
        if kind == "select":
            return ('<div style="' + col + '">' + lab + '<button type="button" id="' + fid + '" aria-haspopup="listbox"' + desc + ' style="'
                    'display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); min-height: var(--size-control); '
                    'padding-inline: var(--space-md); border: var(--border-width-hairline) solid var(--color-line-control); '
                    'border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-ink); font: inherit; text-align: left">'
                    + '<span style="flex: 1 1 0; min-width: 0">' + e(v) + '</span>' + icon("down", 16) + '</button>' + help_ + '</div>')
        if kind == "area":
            limit = d.get("count", {}).get(name)
            cnt = ('<span style="align-self: flex-end; font-size: var(--font-size-small); color: var(--color-ink-muted)">'
                   + "{:,}/{:,}".format(len(v), limit) + '</span>') if limit else ""
            return ('<div style="' + col + '">' + lab + '<textarea id="' + fid + '" rows="4"' + desc + ' style="width: 100%; box-sizing: border-box; '
                    'padding: var(--space-sm) var(--space-md); border: var(--border-width-hairline) solid var(--color-line-control); '
                    'border-radius: var(--radius-sm); background: var(--color-surface); font: inherit; color: var(--color-ink); resize: none">'
                    + e(v) + '</textarea>' + cnt + help_ + '</div>')
        if kind == "radio":
            options = opts.get(name) or name.split(" · ")
            legend = name if name in opts else (d.get("title") or "")
            pick = picks.get(name, 0)
            items = "".join('<label style="display: flex; align-items: center; gap: var(--space-sm); min-height: var(--size-target)">'
                            '<input type="radio" name="' + fid + '"' + (" checked" if i == pick else "") + ' style="width: var(--space-lg); '
                            'height: var(--space-lg); margin: 0; accent-color: var(--color-accent)">' + e(o) + '</label>'
                            for i, o in enumerate(options))
            leg = ('<legend style="padding: 0; margin-bottom: var(--space-xxs); font-weight: var(--font-weight-semibold)">' + e(legend) + '</legend>'
                   if legend else "")
            aria = "" if legend else ' aria-label="' + a(name) + '"'
            return ('<fieldset' + aria + ' style="margin: 0; padding: 0; border: 0; min-width: 0; display: flex; flex-direction: column">'
                    + leg + items + help_ + '</fieldset>')
        if kind == "check":
            on = bool(v)
            return ('<label style="display: flex; align-items: center; gap: var(--space-sm); min-height: var(--size-target); '
                    'font-weight: var(--font-weight-medium)"><input type="checkbox"' + (" checked" if on else "") + ' style="width: '
                    'var(--space-lg); height: var(--space-lg); margin: 0; accent-color: var(--color-accent)">' + e(label) + '</label>')
        if kind == "toggle":
            days = d.get("days", {}).get(name)
            if days is not None:
                btns = "".join('<button type="button" aria-pressed="' + ("true" if x in days else "false") + '" style="min-width: var(--size-target); '
                               'height: var(--size-target); padding: 0; border: var(--border-width-hairline) solid '
                               + ("var(--color-accent); background: var(--color-accent-soft); color: var(--color-accent); font-weight: var(--font-weight-semibold)"
                                  if x in days else "var(--color-line-control); background: var(--color-surface); color: var(--color-ink)")
                               + '; border-radius: var(--radius-sm); font: inherit">' + x + '</button>' for x in "일월화수목금토")
                return ('<div role="group" aria-labelledby="' + fid + '" style="' + col + '"><span id="' + fid + '" style="font-weight: '
                        'var(--font-weight-semibold)">' + e(label) + '</span><div style="display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); '
                        'gap: var(--space-xs)">' + btns + '</div>' + help_ + '</div>')
            on = bool(v)
            track = ("background: var(--color-accent); justify-content: flex-end" if on
                     else "background: var(--color-line-control); justify-content: flex-start")
            return ('<div style="display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); min-height: var(--size-target)">'
                    '<span id="' + fid + '" style="font-weight: var(--font-weight-semibold)">' + e(label) + '</span>'
                    '<button type="button" role="switch" aria-checked="' + ("true" if on else "false") + '" aria-labelledby="' + fid + '" style="'
                    'flex: none; width: var(--size-target); height: var(--size-target); padding: 0; border: 0; background: transparent; '
                    'display: flex; align-items: center; justify-content: center"><span style="width: var(--size-target); height: var(--space-xl); '
                    'padding: var(--space-xs); box-sizing: border-box; border-radius: var(--radius-lg); display: flex; ' + track + '">'
                    '<span style="width: var(--space-lg); height: var(--space-lg); border-radius: var(--radius-md); background: var(--color-surface)">'
                    '</span></span></button></div>')
        if kind == "file":
            done = bool(v)
            return ('<div style="' + col + '"><span style="font-weight: var(--font-weight-semibold)">' + e(label) + '</span>'
                    '<div style="display: flex; align-items: center; gap: var(--space-md)">'
                    + self.photo(label + " 크게 보기", "", "flex: none; width: var(--size-thumb); height: var(--size-thumb)")
                    + '<div style="display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-xs)">'
                    + ('<span style="display: inline-flex; align-items: center; gap: var(--space-xs); color: var(--color-success); '
                       'font-weight: var(--font-weight-semibold)">' + icon("check", 16) + e(v) + '</span>' if done else "")
                    + self.sbtn("사진 선택") + '</div></div>' + help_ + '</div>')
        raise SystemExit("모르는 필드 종류 " + kind)

    def form(self, sid, label, fields, d, w):
        fid = self.uid("f")
        # hide: 고른 값에 따라 나오는 필드 가운데 지금 안 보이는 것. start: 360 입력 오류 프레임은 오류 필드 바로 앞 필드부터(내린 모습)
        fields = [f for f in fields[d.get("start", 0):] if f[0] not in d.get("hide", ())]
        items = [self.field("%s-%d" % (fid, i), n, k, d) for i, (n, k) in enumerate(fields)]
        if d.get("inline") and w == 1280:
            return ('<div style="display: grid; grid-template-columns: repeat(' + str(len(items)) + ', minmax(0, 1fr)); gap: var(--space-md)">'
                    + "".join(items) + '</div>')
        if d.get("inline"):
            return ('<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-sm) var(--space-md)">'
                    + "".join(items) + '</div>')
        return '<div style="display: flex; flex-direction: column; gap: var(--space-lg)">\n' + "\n".join(items) + '\n</div>'

    # ── 버튼 ──────────────────────────────────────────────────────────────
    def kind_of(self, i, primary, danger):
        if danger is not None and i == danger:
            return "danger"
        return "primary" if i == primary else "secondary"

    def footer(self, labels, primary, danger, busy=None):
        btns = [(lab, self.kind_of(i, primary, danger)) for i, lab in enumerate(labels)]
        first, rest = btns[0], btns[1:]
        if primary is not None and primary != 0:
            first = btns[primary]
            rest = [b for i, b in enumerate(btns) if i != primary]
        big = self.btn(first[1], e(first[0]), h="var(--size-control-lg)", full=True, size="title")
        if rest:
            big += ('<div style="display: grid; grid-template-columns: repeat(' + str(len(rest)) + ', minmax(0, 1fr)); gap: var(--space-sm)">'
                    + "".join(self.btn(k, e(lab), pad="var(--space-sm)") for lab, k in rest) + '</div>')
        return ('<div style="display: flex; flex-direction: column; gap: var(--space-sm); padding: var(--space-md) var(--space-lg); '
                'background: var(--color-surface); border-top: ' + LINE + '">' + big + '</div>')

    def btnrow(self, labels, primary, danger, wide=True):
        out = []
        dang = []
        for i, lab in enumerate(labels):
            k = self.kind_of(i, primary, danger)
            # 360 본문 안의 버튼 줄은 줄 너비를 채움(아래 고정 버튼과 같은 모양), 1280은 글 길이만큼
            b = self.btn(k, e(lab), pad="var(--space-xl)" if k == "primary" else "var(--space-lg)", extra="" if wide else "flex: 1 0 auto")
            (dang if k == "danger" and wide and len(labels) > 1 else out).append(b)
        spacer = '<span style="flex: 1 1 0"></span>' if dang else ""
        return ('<div style="display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-sm)">' + "".join(out) + spacer
                + "".join(dang) + '</div>')

    # ── 상태 ──────────────────────────────────────────────────────────────
    def msgbox(self, text, buttons=(), ic="inbox"):
        b = ('<div style="display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-sm)">'
             + "".join(self.btn("secondary", e(x)) for x in buttons) + '</div>') if buttons else ""
        return ('<div style="display: flex; flex-direction: column; align-items: center; gap: var(--space-sm); padding: var(--space-xxl) var(--space-lg); '
                'border: var(--border-width-hairline) dashed var(--color-line-control); border-radius: var(--radius-md); '
                'color: var(--color-ink-muted); text-align: center">' + icon(ic, 24) + '<span>' + e(text) + '</span>' + b + '</div>')

    def statebox(self, title, body, buttons, tone="error"):
        ic, color = ("alert", "var(--color-danger)") if tone == "error" else ("info", "var(--color-ink-muted)")
        b = ('<div style="display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-sm); padding-top: var(--space-xs)">'
             + "".join(self.btn("primary" if i == len(buttons) - 1 else "secondary", e(x)) for i, x in enumerate(buttons)) + '</div>'
             ) if buttons else ""
        return ('<div role="' + ("alert" if tone == "error" else "status") + '" style="display: flex; flex-direction: column; align-items: center; '
                'gap: var(--space-sm); padding: var(--space-xxl) var(--space-lg); border: ' + LINE + '; border-radius: var(--radius-md); '
                'background: var(--color-surface); text-align: center"><span style="color: ' + color + '">' + icon(ic, 24) + '</span>'
                '<strong style="font-size: var(--font-size-title); font-weight: var(--font-weight-semibold)">' + e(title) + '</strong>'
                '<span style="color: var(--color-ink-muted)">' + e(body) + '</span>' + b + '</div>')

    def bannerx(self, text, buttons=(), tone="warning"):
        bg, fg = TONE[tone]
        b = "".join(self.btn("warn" if tone == "warning" else "secondary", e(x), pad="var(--space-md)", extra="flex: none") for x in buttons)
        return ('<div role="status" style="display: flex; align-items: center; gap: var(--space-md); padding: var(--space-sm) var(--space-sm) '
                'var(--space-sm) var(--space-md); min-height: var(--size-target); box-sizing: border-box; border: var(--border-width-hairline) solid '
                + fg + '; border-radius: var(--radius-md); background: ' + bg + '; color: ' + fg + '"><span style="flex: 1 1 0; min-width: 0; '
                'font-weight: var(--font-weight-semibold)">' + e(text) + '</span>' + b + '</div>')

    def dialog(self, sid, title, body, buttons, field=None):
        did = self.uid("d")
        f = ""
        if field:
            f = ('<div style="display: flex; flex-direction: column; gap: var(--space-xs)"><label for="' + did + '-f" style="font-weight: '
                 'var(--font-weight-semibold)">' + e(field[0]) + '</label><textarea id="' + did + '-f" rows="2" style="width: 100%; '
                 'box-sizing: border-box; padding: var(--space-sm) var(--space-md); border: var(--border-width-hairline) solid '
                 'var(--color-line-control); border-radius: var(--radius-sm); background: var(--color-surface); font: inherit; color: '
                 'var(--color-ink); resize: none">' + e(field[1]) + '</textarea></div>')
        kinds = ["secondary"] * (len(buttons) - 1) + ["primary"]
        return ('<div aria-hidden="true" style="position: absolute; inset: 0; background: var(--color-scrim)"></div>\n'
                '<div role="dialog" aria-modal="true" aria-labelledby="' + did + '-t" aria-describedby="' + did + '-d" style="position: absolute; '
                'left: var(--space-lg); right: var(--space-lg); top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; '
                'gap: var(--space-md); padding: var(--space-xl) var(--space-lg) var(--space-lg); border: ' + LINE + '; border-radius: var(--radius-lg); '
                'background: var(--color-surface)">\n' + self.h2(e(title), did + "-t") + '\n<p id="' + did + '-d" style="margin: 0">' + e(body) + '</p>\n'
                + f + '<div style="display: grid; grid-template-columns: repeat(' + str(len(buttons)) + ', minmax(0, 1fr)); gap: var(--space-sm)">'
                + "".join(self.btn(k, e(x), pad="var(--space-sm)") for k, x in zip(kinds, buttons)) + '</div>\n</div>')

    # ── 탭 ───────────────────────────────────────────────────────────────
    def tabsx(self, labels, active, counts=None, aria="보기"):
        counts = counts or {}
        tab = ("flex: none; min-height: var(--size-target); display: inline-flex; align-items: center; gap: var(--space-xs); padding: 0; "
               "margin-bottom: calc(-1 * var(--border-width-hairline)); border: 0; background: transparent; font: inherit; white-space: nowrap")
        out = []
        for i, lab in enumerate(labels):
            on = i == active
            n = counts.get(lab)
            badge = ""
            if n:
                badge = ('<span style="display: inline-flex; align-items: center; justify-content: center; min-width: var(--space-xl); '
                         'padding-inline: var(--space-xs); box-sizing: border-box; border-radius: var(--radius-sm); background: '
                         + ("var(--color-accent-soft); color: var(--color-accent)" if on else "var(--color-surface-sunken); color: var(--color-ink)")
                         + '; font-size: var(--font-size-caption); font-weight: var(--font-weight-semibold)">' + str(n) + '</span>')
            out.append('<button type="button" role="tab" aria-selected="' + ("true" if on else "false") + '" style="' + tab + '; border-bottom: '
                       'var(--border-width-strong) solid ' + ("var(--color-accent); color: var(--color-ink); font-weight: var(--font-weight-semibold)"
                                                             if on else "transparent; color: var(--color-ink-muted)") + '">' + e(lab) + badge + '</button>')
        return ('<div role="tablist" aria-label="' + a(aria) + '" style="display: flex; gap: var(--space-lg); overflow-x: auto; scrollbar-width: none; '
                'border-bottom: ' + LINE + '">' + "".join(out) + '</div>')

    # ── 영업 캘린더(사장님) ─────────────────────────────────────────────────────
    def owner_month(self, y, m, selected=None):
        days_info = {date(2026, 11, 19): (2, ""), date(2026, 11, 20): (5, "다 참"), date(2026, 11, 21): (1, ""),
                     date(2026, 11, 22): (0, "마감")}
        cell = "border-right: " + LINE + "; border-bottom: " + LINE
        lead, days = gen.month_cells(y, m)
        out = ['<div style="padding-block: var(--space-xs); ' + cell + '; font-size: var(--font-size-caption); color: var(--color-ink-muted)">'
               + x + '</div>' for x in "일월화수목금토"]
        out += ['<div style="' + cell + '; background: var(--color-paper)"></div>'] * lead
        for d in days:
            base = ("min-height: var(--size-thumb); display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-xxs); "
                    "padding: var(--space-xs); box-sizing: border-box; text-align: left; " + cell)
            if d < TODAY:
                out.append('<div style="' + base + '; background: var(--color-paper); color: var(--color-ink-muted)">' + str(d.day) + '</div>')
                continue
            held, lab = days_info.get(d, (0, ""))
            if d.isoweekday() == 1:
                lab, look = "휴무", "background: var(--color-surface); color: var(--color-ink-muted)"
                count = ""
            else:
                look = ("background: var(--color-surface-sunken); color: var(--color-ink)" if lab
                        else "background: var(--color-surface); color: var(--color-ink)")
                count = '<span style="font-size: var(--font-size-small); font-weight: var(--font-weight-semibold)">%d/5</span>' % held
            sel = "; box-shadow: inset 0 0 0 var(--border-width-strong) var(--color-accent)" if d == selected else ""
            today = ' aria-current="date"' if d == TODAY else ""
            lb = ('<span style="font-size: var(--font-size-caption); font-weight: var(--font-weight-semibold)">' + lab + '</span>') if lab else ""
            out.append('<button type="button"' + today + ' style="' + base + '; border-top: 0; border-left: 0; font: inherit; ' + look + sel + '">'
                       '<span style="font-size: var(--font-size-small); font-weight: var(--font-weight-' + ("bold" if d == TODAY else "regular")
                       + ')">' + str(d.day) + '</span>' + count + lb + '</button>')
        out += ['<div style="' + cell + '; background: var(--color-paper)"></div>'] * (-(lead + len(days)) % 7)
        return ('<div style="display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border-top: ' + LINE + '; border-left: '
                + LINE + '; background: var(--color-surface); text-align: center">\n' + "\n".join(out) + '\n</div>')


def thumb_caption(text):
    """도안 그림 아래 글: ' · ' 앞은 이름, 뒤는 흐린 글씨로 다음 줄에(좁은 셀에서 한 낱말만 남지 않게)."""
    name, _, rest = text.partition(" · ")
    return ('<span style="display: flex; flex-direction: column; font-size: var(--font-size-small); line-height: var(--font-line-height-tight)">'
            '<span>' + e(name) + '</span>' + ('<span style="color: var(--color-ink-muted)">' + e(rest) + '</span>' if rest else "") + '</span>')


def sep_wrap(text):
    """' · '·' → '로 나눈 조각이 모두 짧으면 조각 사이에서만 줄을 바꿈(구분 기호는 줄 끝에 남음). 긴 조각이 있으면 보통 줄바꿈."""
    parts = re.split(r"( · | → )", text)
    words = parts[0::2]
    if len(words) < 2 or any(len(x) > 18 for x in words):
        return nb(text)
    return "".join('<span style="white-space: nowrap">' + e(x) + '</span>' if i % 2 == 0 else "&nbsp;" + x.strip() + " "
                   for i, x in enumerate(parts))


def css_join(*parts):
    return "; ".join(p for p in parts if p)


T = Base()


# ── 블록 그리기 ─────────────────────────────────────────────────────────────────
class Ctx:
    def __init__(self, sid, w, state=None):
        self.sid, self.w, self.state = sid, w, state
        self.s = C.SCREENS[sid]
        self.d = SAMPLES.get(sid, {})
        self.st = (self.d.get("states") or {}).get(state, {}) if state else {}
        self.ferr = None  # 입력 오류 프레임의 (필드나 목록 이름, 사유)

    def sample(self, b):
        """06 예시 값. 상태 프레임이면 그 상태의 'blocks'가 블록별로 덮어씀(사전 값은 한 단계 더 합침)."""
        base = self.d.get(bkey(b), {})
        over = (self.st.get("blocks") or {}).get(bkey(b))
        if not over:
            return base
        if not isinstance(base, dict) or not isinstance(over, dict):
            return over
        out = dict(base)
        for k, v in over.items():
            out[k] = dict(base[k], **v) if isinstance(v, dict) and isinstance(base.get(k), dict) else v
        return out


def render_block(b, cx, first=False, head=None):
    """08단계 블록 하나를 A 부품으로. 사장님 화면의 1280 섹션은 block, 360은 band.
    head: 바로 앞 h 블록의 (제목, 옆 글). 그 제목을 이 섹션의 제목으로 씀(제목만 있는 섹션을 따로 두지 않음)."""
    k, w, sid = b[0], cx.w, cx.sid
    d = cx.sample(b)
    if head and isinstance(d, dict):
        d = dict(d, title=head[0], meta=head[1] or d.get("meta", ""))
    special = SPECIAL.get((sid, bkey(b)))
    if special:
        return special(b, cx, first)
    if k in ("bar", "kbar"):
        return ""
    if k == "h":
        title, meta = d if isinstance(d, tuple) else (b[1], "")
        return T.sect(w, "", title, meta, first=first) if w == 360 else T.block(T.head(title, meta), first)
    if k == "kv":
        if d.get("hidden"):
            return ""
        rows = d.get("rows") or b[2]
        title = d.get("title", b[1])
        if d.get("collapsed"):
            return T.sect(w, T.disclosure(title), None, first=first)
        if d.get("summary"):
            return T.sect(w, T.stats(rows, w), None, first=first)
        inner = ""
        if d.get("big"):
            inner = T.hero(*rows[0]) + "\n"
            rows = rows[1:]
        inner += T.kvx(rows, d.get("copy"))
        if d.get("note"):
            inner += "\n" + T.note(d["note"])
        if d.get("link") and not title:  # 제목을 숨긴 표의 링크(예: '버전 이력')는 표 아래에(설계 재검토 M20 RE-10)
            inner += "\n" + T.link(d["link"])
        return T.sect(w, inner, title, d.get("meta", ""), d.get("link", ""), first)
    if k == "list":
        label, cols = b[1], d.get("cols") or b[2]
        rows = d.get("rows") or [["—"] * len(cols)]
        title = d.get("title", label)
        lc = d.get("link_col")
        spec = d.get("card") or {"title": 0, "meta": list(range(1, len(cols)))}
        if d.get("nav"):
            ncols = cols if d.get("nav_meta") else None
            if w == 360 or not b[4] or d.get("nav_wide"):
                inner = T.navlist(rows, ncols, d.get("selected") if w == 1280 else None)
            else:
                inner = T.tablex(cols, rows, d.get("widths"), lc)
        elif w == 1280:
            inner = T.tablex(cols, rows, d.get("widths"), lc)
        else:
            inner = T.cards(cols, rows, spec, link=lc is not None and lc == spec.get("title", 0), bad=d.get("bad", ()))
        if cx.ferr and cx.ferr[0] == label:  # 목록의 입력 오류: 목록 위에 사유, 그 행은 위험 색 테두리
            inner = T.ferr(T.uid("e"), cx.ferr[1]) + "\n" + inner
        if d.get("extra") and w == 1280:
            inner += "\n" + T.kvx(d["extra"])
        elif d.get("extra"):
            inner = inner.replace("</dl></li>", "".join(
                '<dt style="color: var(--color-ink-muted)">' + e(k_) + '</dt><dd style="margin: 0; min-width: 0">' + nb(v_) + '</dd>'
                for k_, v_ in d["extra"]) + "</dl></li>", 1)
        return T.sect(w, inner, title, d.get("meta", ""), first=first)
    if k == "form":
        if d.get("hidden"):
            return ""
        names = [n for n, _ in b[2]]
        if cx.ferr and cx.ferr[0] in names:
            d = dict(d, err=cx.ferr, start=max(0, names.index(cx.ferr[0]) - 1) if w == 360 else 0)
        title = d.get("title", b[1])
        f0, k0 = b[2][0]
        lab0 = d.get("labels", {}).get(f0, f0)
        if k0 == "radio" and f0 not in d.get("options", {}):  # 고르기 하나뿐이면 그 묶음 이름(legend)이 섹션 제목과 같음
            lab0 = d.get("title") or ""
        if len(b[2]) == 1 and lab0 == title:
            title = None
        return T.sect(w, T.form(sid, b[1], b[2], d, w), title, d.get("meta", ""), first=first)
    if k == "btns":
        if isinstance(d, dict) and d.get("hidden"):  # 조건이 있을 때만 보이는 버튼 줄(예: SCR-048 '반영'·'보류')
            return ""
        return T.sect(w, T.btnrow(b[1], b[2], b[3], wide=w == 1280), None, first=first)
    if k == "banner":
        return T.sect(w, T.bannerx(d.get("text", b[1])), None, first=first)
    if k == "photos":
        title = d.get("title", b[1])
        meta = d.get("meta", "%d장" % b[2] if b[2] > 1 and d.get("size") not in ("grid",) else "")
        return T.sect(w, T.photos(w, b[1], b[2], b[3] if len(b) > 3 else None, d), title, meta, first=first)
    if k == "cal":
        return T.sect(w, T.owner_month(2026, 11, date(2026, 11, 20)), None, first=first)
    if k == "tabs":
        return T.sect(w, tabs_html(b, cx), None, first=first)
    if k == "note":
        kind = d.get("kind", "note")
        text = d.get("text", b[1])
        inner = {"link": T.link, "note": T.note, "disclosure": T.disclosure,  # 1280의 버튼 하나는 글 길이만큼
                 "button": lambda x: T.btn("secondary", e(x), extra="" if w == 360 else "align-self: flex-start")}[kind](text)
        return T.sect(w, inner, None, first=first)
    if k == "msg":
        return T.msgbox(b[1], b[2])
    if k == "text":
        paras = d.get("paras") or []
        inner = "\n".join('<p style="margin: 0">' + e(p) + '</p>' for p in paras)
        return T.sect(w, inner, d.get("title", b[2]), first=first)
    if k == "chat":
        cd = cx.d.get("chat", {})
        bubbles = cd.get("bubbles") or b[1]
        return T.sect(w, owner_chat(bubbles), cd.get("title"), first=first)
    raise SystemExit("모르는 블록 %s" % k)


def tabs_html(b, cx):
    """탭 줄. 빈 상태 프레임에서는 지금 탭의 개수 표시를 빼서 '1건'과 '없어요'가 함께 보이지 않게."""
    counts = dict((cx.d.get("tabs") or {}).get("counts") or {})
    if cx.state == "empty":
        counts.pop(b[1][b[2]], None)
    return T.tabsx(b[1], b[2], counts)


def into_section(html, extra, at_end=False):
    """그려 둔 섹션 안 맨 앞(탭) 또는 맨 끝(설명 문구)에 넣음."""
    if at_end:
        return html[: -len("\n</section>")] + "\n" + extra + "\n</section>"
    i = html.find(">\n", html.find("<section")) + 2
    return html[:i] + extra + "\n" + html[i:]


SECTION_TOP = '<section style="padding-top: var(--space-xl); border-top: ' + LINE + '; '


def no_top_rule(htmls):
    """1280 열의 첫 섹션은 위 줄을 그리지 않음(열 위에 줄만 따로 뜨지 않게)."""
    out = [h for h in htmls if h]
    if out and out[0].startswith(SECTION_TOP):
        out[0] = '<section style="' + out[0][len(SECTION_TOP):]
    return out


# ── 대화 ───────────────────────────────────────────────────────────────────────
BUB ="max-width: 82%; padding: var(--space-sm) var(--space-md); border-radius: var(--radius-lg); white-space: pre-line"


def bubble(bb, side_owner=False):
    k = bb[0]
    if k in ("c", "a") and bb[1].startswith("(") and bb[1].endswith(")"):  # 08단계의 '(아직 도착하지 않음. …)' 같은 설명
        bb = ("note", bb[1][1:-1])
        k = "note"
    if k in ("c", "a"):
        right = (k == "c") != side_owner
        look = ("align-self: flex-end; background: var(--color-accent-soft); color: var(--color-ink)" if right
                else "align-self: flex-start; background: var(--color-surface); border: " + LINE)
        extra = ""
        if len(bb) > 2:
            extra = ('<span style="display: block; margin-top: var(--space-xxs); font-size: var(--font-size-caption); color: var(--color-ink-muted)">'
                     + e(bb[2]) + '</span>')
        return '<div style="' + BUB + '; ' + look + '">' + sep_wrap(bb[1]) + extra + '</div>'
    if k == "who":
        right = (bb[1] == "손님") == side_owner is False
        align = "flex-start" if bb[1] == "손님" else "flex-end"
        if not side_owner:
            align = "flex-end" if bb[1] == "손님" else "flex-start"
        return ('<span style="align-self: ' + align + '; margin-top: var(--space-xs); font-size: var(--font-size-caption); color: var(--color-ink-muted)">'
                '<strong style="font-weight: var(--font-weight-semibold); color: var(--color-ink)">' + e(bb[1]) + '</strong> ' + e(bb[2]) + '</span>')
    if k == "sys":
        return ('<p style="align-self: center; margin: 0; padding: var(--space-xs) var(--space-md); border-radius: var(--radius-md); '
                'background: var(--color-surface-sunken); font-size: var(--font-size-small); text-align: center">' + e(bb[1])
                + ' <a href="#" style="text-underline-offset: var(--space-xxs)">' + e(bb[2]) + '</a></p>')
    if k == "day":
        return ('<p style="align-self: center; margin: var(--space-xs) 0 0; font-size: var(--font-size-caption); color: var(--color-ink-muted)">'
                + e(bb[1]) + '</p>')
    if k == "note":
        return ('<p style="align-self: stretch; margin: 0; padding: var(--space-xs) var(--space-sm); border: var(--border-width-hairline) dashed '
                'var(--color-line-control); border-radius: var(--radius-sm); font-size: var(--font-size-small); color: var(--color-ink-muted); '
                'text-align: center">' + e(bb[1]) + '</p>')
    if k == "voice":
        return ('<div style="align-self: flex-end; display: inline-flex; align-items: center; gap: var(--space-xs); padding: var(--space-sm) '
                'var(--space-md); border-radius: var(--radius-lg); background: var(--color-accent-soft)">' + icon("mic", 16) + '음성 메시지</div>')
    if k == "photo":
        return ('<div style="align-self: ' + ("flex-start" if side_owner else "flex-end") + '; display: flex; gap: var(--space-xs)">'
                + "".join(T.photo("사진 %d 크게 보기" % (i + 1), "", "flex: none; width: var(--size-thumb); height: var(--size-thumb)")
                          for i in range(bb[1])) + '</div>')
    if k == "q":
        return ('<div style="align-self: stretch; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-xs)">'
                + "".join('<button type="button" style="min-height: var(--size-target); padding-inline: var(--space-md); border: '
                          'var(--border-width-hairline) solid var(--color-accent); border-radius: var(--radius-lg); background: var(--color-surface); '
                          'color: var(--color-accent); font: inherit; font-size: var(--font-size-small); font-weight: var(--font-weight-semibold)">'
                          + e(x) + '</button>' for x in bb[1]) + '</div>')
    if k in ("card", "sum", "pay"):
        if k == "pay":
            _, title, amount, lines, due = bb
            body = ('<span style="font-size: var(--font-size-heading); font-weight: var(--font-weight-bold)">' + e(amount) + '</span>'
                    + "".join('<span style="font-size: var(--font-size-small)">' + e(x) + '</span>' for x in lines)
                    + '<span style="font-size: var(--font-size-small); font-weight: var(--font-weight-semibold)">' + e(due) + '</span>')
            buttons = []
        else:
            title, lines = bb[1], bb[2]
            buttons = bb[3] if k == "card" else []
            body = "".join('<span style="font-size: var(--font-size-small)">' + sep_wrap(x) + '</span>' for x in lines)
        btns = "".join('<button type="button" style="min-height: var(--size-target); padding: var(--space-xs) var(--space-md); border: 0; '
                       'border-top: ' + LINE + '; background: transparent; color: var(--color-accent); font: inherit; font-size: var(--font-size-small); '
                       'font-weight: var(--font-weight-semibold)">' + e(x) + '</button>' for x in buttons)
        return ('<div style="align-self: flex-start; width: 82%; display: flex; flex-direction: column; border: ' + LINE + '; '
                'border-radius: var(--radius-lg); background: var(--color-surface); overflow: hidden"><div style="display: flex; '
                'flex-direction: column; gap: var(--space-xxs); padding: var(--space-md)"><strong style="font-weight: var(--font-weight-semibold)">'
                + e(title) + '</strong>' + body + '</div>' + btns + '</div>')
    raise SystemExit("모르는 말풍선 %r" % (bb,))


def chat_list(bubbles, side_owner=False):
    return ('<div style="display: flex; flex-direction: column; gap: var(--space-sm)">\n'
            + "\n".join(bubble(bb, side_owner) for bb in bubbles) + '\n</div>')


def owner_chat(bubbles):
    return chat_list(bubbles, side_owner=True)


def kakao_frame(title, bubbles, w, fixed=False):
    head = ('<header style="min-height: var(--size-bar); display: flex; align-items: center; gap: var(--space-xs); padding-inline: '
            'var(--space-xs) var(--space-lg); box-sizing: border-box; background: var(--color-surface); border-bottom: ' + LINE + '">'
            '<button type="button" aria-label="뒤로" style="width: var(--size-target); height: var(--size-target); flex: none; display: flex; '
            'align-items: center; justify-content: center; padding: 0; border: 0; background: transparent; color: var(--color-ink)">'
            + icon("left", 22) + '</button><h1 style="margin: 0; font-size: var(--font-size-title); font-weight: var(--font-weight-semibold)">'
            + e(title) + '</h1></header>')
    foot = ('<div style="display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-sm) var(--space-lg); '
            'background: var(--color-surface); border-top: ' + LINE + '"><input aria-label="메시지 입력" style="flex: 1 1 0; '
            'min-width: 0; height: var(--size-control); padding-inline: var(--space-md); box-sizing: border-box; border: var(--border-width-hairline) '
            'solid var(--color-line-control); border-radius: var(--radius-lg); background: var(--color-surface); font: inherit">'
            '<button type="button" aria-label="전송" style="width: var(--size-target); height: var(--size-target); flex: none; display: flex; '
            'align-items: center; justify-content: center; padding: 0; border: 0; border-radius: var(--radius-md); background: var(--color-accent); '
            'color: var(--color-on-accent)">' + icon("send", 20) + '</button></div>')
    body = '<div style="padding: var(--space-lg)">' + chat_list(bubbles) + '</div>'
    if w == 360:
        if fixed:
            return ('<div style="width: 360px; height: 800px; display: flex; flex-direction: column; background: var(--color-paper)">' + head
                    + '<main style="flex: 1 1 auto; min-height: 0; overflow-y: auto; scrollbar-width: none; display: flex; flex-direction: column-reverse">'
                    + body + '</main>' + foot + '</div>')
        return ('<div style="width: 360px; min-height: 800px; display: flex; flex-direction: column; background: var(--color-paper)">' + head
                + '<main style="flex: 1 1 auto">' + body + '</main>' + foot + '</div>')
    win = ('<div style="width: 360px; display: flex; flex-direction: column; border: ' + LINE + '; border-radius: var(--radius-lg); '
           'background: var(--color-paper); overflow: hidden">' + head + '<main style="min-height: var(--size-photo)">' + body + '</main>'
           + foot + '</div>')
    return ('<div style="width: 1280px; min-height: 800px; display: flex; align-items: flex-start; justify-content: center; padding-block: '
            'var(--space-xxl); box-sizing: border-box; background: var(--color-surface-sunken)">' + win + '</div>')


# ── 화면 레이아웃 ─────────────────────────────────────────────────────────────────────
def parent_menu(sid):
    """사장님·운영자 메뉴에서 이 화면이 속한 1뎁스."""
    n = int(sid[4:])
    owner = [(16, 19, "할 일"), (20, 27, "주문"), (28, 29, "입금 대조"), (30, 30, "제작"), (31, 31, "픽업"), (32, 33, "영업 캘린더"),
             (34, 45, "가게 설정"), (47, 48, "영업 신고 확인"), (49, 49, "운영자 알림"), (50, 50, "영업 신고 확인")]
    return next(lab for lo, hi, lab in owner if lo <= n <= hi)


def side_menu(sid):
    operator = C.SCREENS[sid]["shell"] == "operator"
    items = OPERATOR_MENU if operator else OWNER_MENU
    current = parent_menu(sid)
    out = []
    for label, _ in items:
        on = label == current
        look = ("background: var(--color-accent-soft); color: var(--color-accent); font-weight: var(--font-weight-semibold); "
                "box-shadow: inset var(--border-width-strong) 0 0 var(--color-accent)") if on else "color: var(--color-ink)"
        badge = ""
        if label == "할 일":
            bl = "background: var(--color-accent); color: var(--color-on-accent)" if on else "background: var(--color-accent-soft); color: var(--color-accent)"
            badge = ('<span style="min-width: var(--space-xl); padding-inline: var(--space-xs); box-sizing: border-box; border-radius: var(--radius-sm); '
                     + bl + '; font-size: var(--font-size-caption); font-weight: var(--font-weight-semibold); text-align: center">3</span>')
        out.append('<a href="#"' + (' aria-current="page"' if on else "") + ' style="display: flex; align-items: center; justify-content: space-between; '
                   'gap: var(--space-sm); min-height: var(--size-target); padding-inline: var(--space-md); border-radius: var(--radius-sm); ' + look
                   + '; text-decoration: none">' + e(label) + badge + '</a>')
    brand, sub = ("Siljang 운영자", "운영자 한빛") if operator else ("Siljang 사장님", SHOP)
    foot = ""
    if operator:
        foot = ('<button type="button" style="margin-top: auto; min-height: var(--size-target); padding-inline: var(--space-md); border: 0; '
                'background: transparent; color: var(--color-ink-muted); font: inherit; font-size: var(--font-size-small); text-align: left">로그아웃</button>')
    return ('<nav aria-label="' + ("운영자 메뉴" if operator else "사장님 메뉴") + '" style="width: var(--size-menu); flex: none; display: flex; '
            'flex-direction: column; gap: var(--space-xxs); padding: var(--space-lg) var(--space-sm); box-sizing: border-box; '
            'background: var(--color-surface); border-right: ' + LINE + '"><div style="display: flex; flex-direction: column; padding: 0 var(--space-md) '
            'var(--space-lg)"><span style="font-size: var(--font-size-title); font-weight: var(--font-weight-bold)">' + brand + '</span>'
            '<span style="font-size: var(--font-size-small); color: var(--color-ink-muted)">' + e(sub) + '</span></div>\n' + "\n".join(out) + foot + '\n</nav>')


def topbar(title, lead, right="", sub=""):
    if lead:
        ic, aria = (icon("menu", 22), "메뉴 열기") if lead == "menu" else (icon("back", 22), "뒤로")
        btn = ('<button type="button" aria-label="' + aria + '" style="width: var(--size-target); height: var(--size-target); flex: none; '
               'display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: var(--radius-md); '
               'background: transparent; color: var(--color-ink)">' + ic + '</button>')
        pad = "var(--space-xs) var(--space-lg)"
    else:
        btn, pad = "", "var(--space-lg)"
    r = ('<span style="margin-left: auto; font-size: var(--font-size-small); color: var(--color-ink-muted)">' + e(right) + '</span>') if right else ""
    return ('<header style="min-height: var(--size-bar); display: flex; align-items: center; gap: var(--space-xs); padding-inline: ' + pad + '; '
            'box-sizing: border-box; background: var(--color-surface); border-bottom: ' + LINE + '">' + btn
            + heading(title, sub) + r + '</header>')


def heading(title, sub=""):
    h = '<h1 style="margin: 0; font-size: var(--font-size-title); line-height: var(--font-line-height-tight); font-weight: var(--font-weight-semibold)">' + e(title) + '</h1>'
    if not sub:
        return h
    return ('<div style="min-width: 0; display: flex; flex-direction: column; padding-block: var(--space-xs)">' + h
            + '<p style="margin: 0; font-size: var(--font-size-small); line-height: var(--font-line-height-tight); color: var(--color-ink-muted)">'
            + sep_wrap(sub) + '</p></div>')


def phone(header, body, footer="", overlay="", fixed=False, inert=False):
    """inert: 확인 창이 열린 동안 뒤 화면(머리·본문·바닥 버튼)은 누를 수 없음(모달). 상태 견본의 'inert'로 켬(설계 재검토 M12, SCR-027)."""
    if inert:
        header, footer = (re.sub(r"^<(\w+)", r"<\1 inert", x, count=1) for x in (header, footer))
    if fixed:
        frame, scroll = "width: 360px; height: 800px; position: relative; overflow: hidden", "; min-height: 0; overflow-y: auto; scrollbar-width: none"
    else:
        frame, scroll = "width: 360px; min-height: 800px", ""
    return ('<div style="' + frame + '; display: flex; flex-direction: column; background: var(--color-paper)">\n' + header + '\n'
            '<main' + (" inert" if inert else "") + ' style="flex: 1 1 auto' + scroll + '; display: flex; flex-direction: column">\n' + body
            + '\n</main>\n' + footer + overlay + '\n</div>')


def desk(sid, title, back, meta, body, operator=False):
    m = ('<p style="margin: 0; font-size: var(--font-size-small); color: var(--color-ink-muted)">' + e(meta) + '</p>') if meta else ""
    b = ""
    if back:
        b = ('<button type="button" aria-label="뒤로" style="width: var(--size-target); height: var(--size-target); flex: none; display: flex; '
             'align-items: center; justify-content: center; margin-left: calc(-1 * var(--space-sm)); padding: 0; border: 0; border-radius: var(--radius-md); '
             'background: transparent; color: var(--color-ink)">' + icon("back", 22) + '</button>')
    who = ""
    if operator:
        who = ('<span style="margin-left: auto; font-size: var(--font-size-small); color: var(--color-ink-muted)">운영자 한빛</span>')
    return ('<div style="width: 1280px; min-height: 800px; display: flex; background: var(--color-paper)">\n' + side_menu(sid) + '\n'
            '<main style="flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: var(--space-lg); '
            'padding: var(--space-xl) var(--space-xxl); box-sizing: border-box">\n'
            '<div style="display: flex; align-items: center; gap: var(--space-sm)">' + b + '<div style="display: flex; flex-direction: column; '
            'gap: var(--space-xxs)"><h1 style="margin: 0; font-size: var(--font-size-heading); line-height: var(--font-line-height-tight); '
            'font-weight: var(--font-weight-bold)">' + e(title) + '</h1>' + m + '</div>' + who + '</div>\n' + body + '\n</main>\n</div>')


NARROW = "width: 100%; max-width: calc(var(--size-content) - var(--size-aside))"


def column(htmls, narrow):
    inner = "\n".join(h for h in htmls if h)
    st = NARROW + "; " if narrow else ""
    return '<div style="' + st + 'min-width: 0; display: flex; flex-direction: column; gap: var(--space-xl)">\n' + inner + '\n</div>'


def arrange_1280(cx, blocks, htmls):
    wide = cx.s.get("wide")
    if not wide:
        has_table = any(b[0] == "list" and b[4] for b in blocks) or any(b[0] == "photos" and b[2] > 4 for b in blocks)
        return column(htmls, narrow=not has_table)
    plan = plan_wide(cx.sid, blocks, wide)

    def part(items, first_group=False):
        out = []
        for kind, x in items:
            if kind == "i":
                out.append(htmls[x])
            else:
                out.append(render_block(x, cx, first=not out))
        return out

    ratio = {"even": "minmax(0, 1fr) minmax(0, 1fr)", "main": "minmax(0, 1fr) var(--size-aside)",
             "side": "var(--size-aside) minmax(0, 1fr)"}[wide.get("ratio", "even")]
    left = column(no_top_rule(part(plan["left"])), False)
    right = column(no_top_rule(part(plan["right"])), False)
    mid = ('<div style="display: grid; grid-template-columns: ' + ratio + '; gap: var(--space-xxl); align-items: start">\n' + left + '\n'
           + right + '\n</div>')
    return "\n".join(x for x in [column(no_top_rule(part(plan["top"])), False) if plan["top"] else "", mid,
                                 column(part(plan["bottom"]), False) if plan["bottom"] else ""] if x)


def content(cx, frame=None):
    """레이아웃(과 상태 프레임)으로 본문. 돌려주는 것: (본문, 360 아래 고정 버튼 또는 '')."""
    blocks = [b for b in cx.s["layout"] if b[0] not in ("bar", "kbar")]
    kind = frame[0] if frame else None
    if kind == "replace":
        _, label, block = frame
        blocks = [("msgwrap", block, b) if (b[1] == label if b[0] in ("kv", "list", "form", "photos", "cal") else False) else b
                  for b in blocks]
    if kind == "field" and cx.w == 360:  # 입력 오류 프레임(360 × 800)은 오류가 난 블록까지 내린 모습(설계 재검토 M19 RE-05)
        at = next(i for i, b in enumerate(blocks) if (b[0] == "form" and any(n == frame[1] for n, _ in b[2]))
                  or (b[0] in ("list", "kv") and b[1] == frame[1]))
        if at and blocks[at - 1][0] == "h":
            at -= 1
        blocks = blocks[at:]
    footer = ""
    last = blocks[-1] if blocks else None
    if cx.w == 360 and last and last[0] == "btns" and kind != "box":
        footer = T.footer(last[1], last[2], last[3])
        blocks = blocks[:-1]
    heads = {}
    for i, b in enumerate(blocks[:-1]):
        nxt = blocks[i + 1]
        if b[0] == "h" and (nxt[0] if nxt[0] != "msgwrap" else nxt[2][0]) in ("kv", "list", "form", "photos", "text"):
            hd = cx.sample(b)
            heads[i + 1] = hd if isinstance(hd, tuple) else (b[1], "")
    htmls = []
    tabs_for_next = None
    one_column = cx.w == 360 or not cx.s.get("wide")
    for i, b in enumerate(blocks):
        first = not any(htmls)
        prev = max((j for j, h in enumerate(htmls) if h), default=None)
        nd = cx.sample(b) if b[0] == "note" else {}
        nxt = blocks[i + 1] if i + 1 < len(blocks) else None
        if i + 1 in heads:  # 제목은 다음 섹션이 가짐
            htmls.append("")
        elif (b[0] == "tabs" and nxt and (nxt[0] if nxt[0] != "msgwrap" else "msgwrap")
              in ("list", "photos", "kv", "form", "msgwrap", "cal", "text")):
            tabs_for_next = tabs_html(b, cx)  # 탭과 그 아래 목록을 한 섹션으로(사이에 줄이 겹치지 않게)
            htmls.append("")
        elif (b[0] == "note" and nd.get("kind", "note") in ("note", "link") and prev is not None
              and htmls[prev].endswith("\n</section>") and one_column):
            # 설명 문구·링크는 바로 앞 섹션 안 끝에(따로 줄을 긋고 떨어져 보이지 않게)
            text = nd.get("text", b[1])
            htmls[prev] = into_section(htmls[prev], T.link(text) if nd.get("kind") == "link" else T.note(text), at_end=True)
            htmls.append("")
        elif b[0] == "msgwrap":
            orig = b[2]
            title = (heads.get(i) or (cx.sample(orig).get("title", orig[1]), ""))[0]
            htmls.append(T.sect(cx.w, T.msgbox(b[1][1], b[1][2]), title, first=first))
        else:
            htmls.append(render_block(b, cx, first, heads.get(i)))
        if tabs_for_next and b[0] != "tabs" and htmls[-1]:
            htmls[-1] = into_section(htmls[-1], tabs_for_next)
            tabs_for_next = None
    if cx.w == 1280:
        real = [b if b[0] != "msgwrap" else b[2] for b in blocks]
        body = arrange_1280(cx, real, htmls)
    else:
        body = "\n".join(h for h in htmls if h)
    return body, footer


def screen_title(cx):
    bar = next((b for b in cx.s["layout"] if b[0] == "bar"), None)
    return cx.d.get("title") or (bar[1] if bar else "")


def lead_of(cx):
    bar = next((b for b in cx.s["layout"] if b[0] == "bar"), None)
    if not bar:
        return None
    return "back" if bar[2] == "←" else ("menu" if cx.s["shell"] in ("owner", "operator") else None)


def draw(sid, w, state=None, frame=None):
    """화면 하나의 한 프레임."""
    cx = Ctx(sid, w, state)
    s, shell = cx.s, cx.s["shell"]
    fixed = state is not None
    kind = frame[0] if frame else None
    if (sid, state) in STATE_DRAW:
        return STATE_DRAW[(sid, state)](cx, frame)
    if sid in CUSTOM:
        return CUSTOM[sid](cx, frame)
    if shell == "kakao":
        bubbles = list((cx.d.get("chat") or {}).get("bubbles") or next(b for b in s["layout"] if b[0] == "chat")[1])
        if cx.st.get("chat"):  # 일어난 순서대로 다시 쓴 대화 전체(08단계 chat+는 normal 뒤에 붙임)
            bubbles = list(cx.st["chat"])
        elif kind == "chat+":
            bubbles += cx.st.get("chat+") or frame[1]
        title = SERVICE if sid == "SCR-019" else SHOP
        return kakao_frame(title, bubbles, w, fixed=fixed)
    title = screen_title(cx)
    if kind == "box":
        _, bt, bb, bbtn = frame
        tone = "error" if state == "error" else "info"
        box = T.statebox(bt, bb, bbtn, tone)
        body, footer = '<div style="padding: var(--space-xl) var(--space-lg)">' + box + '</div>', ""
    else:
        if kind == "field":
            cx.ferr = (frame[1], frame[2])
        body, footer = content(cx, frame if kind in ("replace", "field") else None)
        if kind == "banner":
            body = T.sect(w, T.bannerx(frame[1], frame[2]), None, first=True) + "\n" + body
    if shell in ("login",):
        return login_frame(cx, title, body, frame)
    if w == 360:
        overlay = ""
        if kind == "dialog":
            overlay = T.dialog(sid, frame[1], frame[2], frame[3], cx.st.get("field"))
        lead = lead_of(cx)
        right = SHOP if lead == "menu" and shell == "owner" else ""
        if shell == "public":
            header = public_header(cx, title)
        else:
            header = topbar(title, lead, right, cx.d.get("meta", ""))
        return phone(header, body, footer, overlay, fixed=fixed, inert=bool(overlay and cx.st.get("inert")))
    # 1280
    if shell == "public":
        return public_wide(cx, title, body)
    if shell == "owner-setup":
        return setup_wide(title, body)
    return desk(sid, title, lead_of(cx) == "back", cx.d.get("meta", ""), body, operator=shell == "operator")


def public_header(cx, title):
    if cx.sid == "SCR-001":
        return ('<header style="min-height: var(--size-bar); display: flex; align-items: center; padding: var(--space-md) var(--space-lg); '
                'box-sizing: border-box; background: var(--color-surface); border-bottom: ' + LINE + '"><h1 style="margin: 0; font-size: '
                'var(--font-size-heading); line-height: var(--font-line-height-tight); font-weight: var(--font-weight-bold)">' + e(title) + '</h1></header>')
    return topbar(title, "back")


def public_wide(cx, title, body):
    name = SHOP if cx.sid == "SCR-001" else title
    sub = ""
    if cx.sid == "SCR-002":
        sub = '<p style="margin: 0; color: var(--color-ink-muted)">' + SHOP + '</p>'
    return ('<main style="width: 1280px; min-height: 800px; display: flex; flex-direction: column; background: var(--color-paper)">\n'
            '<header style="background: var(--color-surface); border-bottom: ' + LINE + '"><div style="max-width: var(--size-content); '
            'margin-inline: auto; padding-block: var(--space-xl); display: flex; flex-direction: column; gap: var(--space-xxs)">'
            '<h1 style="margin: 0; font-size: var(--font-size-display); line-height: var(--font-line-height-tight); font-weight: var(--font-weight-bold)">'
            + e(name) + '</h1>' + sub + '</div></header>\n<div style="width: 100%; max-width: var(--size-content); margin-inline: auto; '
            'padding-block: var(--space-xl) var(--space-xxl)">\n' + body + '\n</div>\n</main>')


def setup_wide(title, body):
    return ('<div style="width: 1280px; min-height: 800px; display: flex; flex-direction: column; background: var(--color-paper)">\n'
            '<header style="min-height: var(--size-bar); display: flex; align-items: center; padding-inline: var(--space-xxl); '
            'background: var(--color-surface); border-bottom: ' + LINE + '"><span style="font-size: var(--font-size-title); font-weight: '
            'var(--font-weight-bold)">Siljang 사장님</span></header>\n<main style="' + NARROW + '; margin-inline: auto; padding-block: '
            'var(--space-xl) var(--space-xxl); display: flex; flex-direction: column; gap: var(--space-lg)">\n<h1 style="margin: 0; font-size: '
            'var(--font-size-heading); font-weight: var(--font-weight-bold)">' + e(title) + '</h1>\n' + body + '\n</main>\n</div>')


def login_frame(cx, title, body, frame):
    sid, w = cx.sid, cx.w
    s = cx.s
    service = next(b for b in s["layout"] if b[0] == "h")
    note = next(b for b in s["layout"] if b[0] == "note")
    btns = next(b for b in s["layout"] if b[0] == "btns")
    form = next((b for b in s["layout"] if b[0] == "form"), None)
    kind = frame[0] if frame else None
    parts = ['<span style="font-size: var(--font-size-display); font-weight: var(--font-weight-bold); line-height: var(--font-line-height-tight)">'
             + e(SERVICE) + '</span>', '<h1 style="margin: 0; font-size: var(--font-size-heading); font-weight: var(--font-weight-semibold)">'
             + e(title) + '</h1>']
    if kind == "box":
        parts.append(T.bannerx(frame[1] + ". " + frame[2], tone="danger") if False else
                     '<div role="alert" style="display: flex; gap: var(--space-sm); padding: var(--space-sm) var(--space-md); border: '
                     'var(--border-width-hairline) solid var(--color-danger); border-radius: var(--radius-md); background: var(--color-danger-soft); '
                     'color: var(--color-danger)">' + icon("alert", 20) + '<span style="display: flex; flex-direction: column"><strong style="font-weight: '
                     'var(--font-weight-semibold)">' + e(frame[1]) + '</strong><span>' + e(frame[2]) + '</span></span></div>')
    if form:
        parts.append(T.form(sid, form[1], form[2], cx.sample(form), 360))
    parts.append(T.btn("primary", e(btns[1][0]), h="var(--size-control-lg)", full=True, size="title"))
    parts.append('<p style="margin: 0; text-align: center; font-size: var(--font-size-small); color: var(--color-ink-muted)">' + e(note[1]) + '</p>')
    card = ('<div style="width: 100%; max-width: var(--size-aside); box-sizing: border-box; display: flex; flex-direction: column; gap: var(--space-lg); '
            'padding: var(--space-xxl) var(--space-xl); border: ' + LINE + '; border-radius: var(--radius-lg); background: var(--color-surface)">'
            + "\n".join(parts) + '</div>')
    width = "360px" if w == 360 else "1280px"
    return ('<div style="width: ' + width + '; min-height: 800px; display: flex; align-items: center; justify-content: center; padding: '
            'var(--space-lg); box-sizing: border-box; background: var(--color-paper)">' + card + '</div>')


# ── 화면별 부품(06 예시를 A 시안 부품 그대로) ────────────────────────────────────────
def sp_price(b, cx, first):
    return T.sect(cx.w, price_card(), None, first=first) if cx.w == 360 else T.block(price_card(), first)


def price_card():
    out = []
    for gi, (group, items) in enumerate(gen.PRICE):
        top = "" if gi == 0 else "border-top: " + LINE + "; "
        out.append('<button type="button" aria-expanded="true" style="width: 100%; min-height: var(--size-target); display: flex; align-items: center; '
                   'gap: var(--space-sm); padding-inline: var(--space-md); border: 0; ' + top + 'background: transparent; color: var(--color-ink); '
                   'font: inherit; font-weight: var(--font-weight-semibold); text-align: left">' + group + '<span style="font-size: var(--font-size-small); '
                   'font-weight: var(--font-weight-regular); color: var(--color-ink-muted)">' + str(len(items)) + '개</span>'
                   + icon("up", 16, style="margin-left: auto") + '</button>')
        for name, sub, price, custom, thumb in items:
            amount = '<span style="font-weight: var(--font-weight-medium); text-align: right">' + price + '</span>'
            tagh = T.tag("custom") if custom else ""
            if thumb:  # 도안 그림은 크게(size.thumb)
                out.append('<div style="display: flex; align-items: center; gap: var(--space-md); padding: var(--space-sm) var(--space-md); '
                           'border-top: ' + LINE + '">' + T.photo(thumb + " 크게 보기", "", "flex: none; width: var(--size-thumb); height: var(--size-thumb)")
                           + '<div style="flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-xxs)">'
                           '<span>' + name + '</span><span style="font-size: var(--font-size-small); color: var(--color-ink-muted)">' + sub + '</span>'
                           + tagh + '</div>' + amount + '</div>')
            elif custom:
                out.append('<div style="display: flex; align-items: center; gap: var(--space-md); padding: var(--space-sm) var(--space-md); '
                           'border-top: ' + LINE + '"><div style="flex: 1 1 0; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; '
                           'gap: var(--space-xs) var(--space-sm)"><span>' + name + '</span>' + tagh + '</div>' + amount + '</div>')
            else:
                out.append('<div style="display: flex; justify-content: space-between; gap: var(--space-md); padding: var(--space-sm) var(--space-md); '
                           'border-top: ' + LINE + '"><span>' + name + '</span>' + amount + '</div>')
    return ('<div style="border: ' + LINE + '; border-radius: var(--radius-md); background: var(--color-surface)">\n' + "\n".join(out) + '\n</div>')


def sp_booking_cal(b, cx, first):
    if cx.w == 360:
        inner = "\n".join([T.legend(), T.month_nav("2026년 11월"), T.month_grid(2026, 11)])
        return T.band(inner)
    months = "\n".join('<div style="min-width: 0; display: flex; flex-direction: column; gap: var(--space-xs)"><h3 style="margin: 0; '
                       'font-size: var(--font-size-small); font-weight: var(--font-weight-semibold); color: var(--color-ink-muted)">%d월</h3>\n' % m
                       + T.month_grid(2026, m) + '\n</div>' for m in (11, 12))
    return "\n".join([T.legend(), T.month_nav("2026년 11월 · 12월"), '<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); '
                      'gap: var(--space-xl)">\n' + months + '\n</div>'])


def sp_h_tight(b, cx, first):
    title, meta = cx.sample(b) or (b[1], "")
    if cx.w == 360:
        return T.band(T.head(title, meta), first)
    return T.block(T.head(title, meta), first)


def scr001(cx, frame):
    """예약 링크 페이지: 360은 한 열과 아래 고정 '문의하기', 1280은 사진을 위 전체 너비로 크게."""
    w, kind = cx.w, frame[0] if frame else None
    d = cx.d
    if kind == "box":
        box = T.statebox(frame[1], frame[2], frame[3], "error")
        return phone("", '<div style="padding: var(--space-xxl) var(--space-lg)">' + box + '</div>', fixed=True)
    empty = kind == "replace"
    portfolio = (T.msgbox("아직 사진이 없어요") if empty else
                 T.photos(360, "포트폴리오", 3, None, d["포트폴리오"]))
    if w == 360:
        price = T.band(T.head("가격표", "버전 4") + "\n" + price_card())
        cal = T.band(T.head("빈 날짜", "오늘부터 60일") + "\n" + "\n".join([T.legend(), T.month_nav("2026년 11월"), T.month_grid(2026, 11)]))
        info = T.band(T.disclosure("가게 정보") + "\n" + T.link("개인정보 처리방침 보기"))
        body = "\n".join([T.band(T.label_h2("포트폴리오") + "\n" + portfolio, first=True), price, cal, info])
        foot = ('<div style="padding: var(--space-md) var(--space-lg); background: var(--color-surface); border-top: ' + LINE + '">'
                + T.btn("primary", "문의하기", h="var(--size-control-lg)", full=True, size="title") + '</div>')
        return phone(public_header(cx, SHOP), body, foot, fixed=frame is not None)
    photos = "\n".join(T.photo("포트폴리오 사진 %d 크게 보기" % i, "사진 %d" % i, "aspect-ratio: 4 / 3") for i in (1, 2, 3))
    top = T.block(T.label_h2("포트폴리오") + '\n<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(var(--size-photo), 1fr)); '
                  'gap: var(--space-sm)">\n' + photos + '\n</div>', first=True)
    left = "\n".join([T.block(T.head("가격표", "버전 4") + "\n" + price_card(), first=True),
                      T.block(T.head("빈 날짜", "오늘부터 60일") + "\n" + sp_booking_cal(None, cx, False))])
    aside = gen.A.aside(T)
    return ('<main style="width: 1280px; min-height: 800px; display: flex; flex-direction: column; background: var(--color-paper)">\n'
            '<header style="background: var(--color-surface); border-bottom: ' + LINE + '"><div style="max-width: var(--size-content); '
            'margin-inline: auto; padding-block: var(--space-xl)"><h1 style="margin: 0; font-size: var(--font-size-display); line-height: '
            'var(--font-line-height-tight); font-weight: var(--font-weight-bold)">' + SHOP + '</h1></div></header>\n'
            '<div style="width: 100%; max-width: var(--size-content); margin-inline: auto; padding-block: var(--space-xl) var(--space-xxl); '
            'display: flex; flex-direction: column; gap: var(--space-xl)">\n' + top + '\n<div style="display: grid; grid-template-columns: '
            'minmax(0, 1fr) var(--size-aside); gap: var(--space-xxl); align-items: start; padding-top: var(--space-xl); border-top: ' + LINE + '">\n'
            '<div style="min-width: 0; display: flex; flex-direction: column; gap: var(--space-xl)">\n' + left + '\n</div>\n' + aside
            + '\n</div>\n</div>\n</main>')


def scr016(cx, frame):
    w, kind = cx.w, frame[0] if frame else None
    tasks = gen.TASKS
    if kind == "banner":
        tasks = gen.TASKS[:1]
    if w == 1280:
        body = T.tabsx(["열린 할 일", "처리한 일"], 0, {"열린 할 일": 3}, "할 일 보기") + "\n" + T.table(gen.TASKS)
        return desk(cx.sid, "할 일", False, cx.d.get("meta", ""), body)
    parts = []
    if kind == "banner":
        parts.append(T.bannerx(frame[1], frame[2]))
    if kind == "box":
        parts = [T.statebox(frame[1], frame[2], frame[3], "error")]
    else:
        parts.append(T.tabsx(["열린 할 일", "처리한 일"], 0, {"열린 할 일": len(tasks) if kind != "replace" else 0}, "할 일 보기"))
        if kind == "replace":
            parts.append(T.msgbox(frame[2][1], frame[2][2], ic="check"))
        else:
            parts.append(T.note("오래된 순"))
            parts += [T.task_card(t) for t in tasks]
    body = '<div style="display: flex; flex-direction: column; gap: var(--space-md); padding: var(--space-lg)">\n' + "\n".join(parts) + '\n</div>'
    return phone(topbar("할 일", "menu", SHOP), body, fixed=frame is not None)


def scr022(cx, frame):
    """A 방향 시안의 사진·요청 내용·견적 부품에 08 정의의 '최종 금액' 폼과 결과 한 줄, 버튼 줄(설계 재검토 M5·M6).
    견적이 '70,000원부터'라 '수락' 없이 '금액 변경 수락'·'거절'(REQ-230, SPEC-031)."""
    w, kind = cx.w, frame[0] if frame else None
    lay = cx.s["layout"]
    amount = next(b for b in lay if b[0] == "form")
    result = next(b for b in lay if b[0] == "note")
    act = next(b for b in lay if b[0] == "btns")
    if w == 1280:
        left = T.block(T.head("참고 사진", "3장") + "\n" + T.ref_grid(), first=True)
        right = "\n".join([T.block(T.head("요청 내용") + "\n" + T.kv(gen.REQUEST[2:]), first=True), T.block(T.head("가게 규칙 계산") + "\n" + T.quote()),
                           render_block(amount, cx), render_block(result, cx)])
        body = ('<div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-xxl); align-items: start">\n'
                + left + '\n<div style="min-width: 0; display: flex; flex-direction: column; gap: var(--space-xl)">\n' + right + '\n</div>\n</div>\n'
                + render_block(act, cx))
        return desk(cx.sid, "맞춤 주문 검토", True, cx.d.get("meta", ""), body)
    top = topbar("맞춤 주문 검토", "back")
    if kind == "box":
        return phone(top, '<div style="padding: var(--space-xl) var(--space-lg)">' + T.statebox(frame[1], frame[2], frame[3], "error") + '</div>',
                     fixed=True)
    bands = "\n".join([T.band(T.head("참고 사진", "3장") + "\n" + T.ref_row(), first=True), T.band(T.head("요청 내용") + "\n" + T.kv(gen.REQUEST)),
                       T.band(T.head("가게 규칙 계산") + "\n" + T.quote()), render_block(amount, cx), render_block(result, cx)])
    overlay = T.dialog(cx.sid, frame[1], frame[2], frame[3]) if kind == "dialog" else ""
    return phone(top, bands, T.footer(act[1], act[2], act[3]), overlay, fixed=frame is not None)


def scr032_cal(b, cx, first):
    if cx.w == 360:
        inner = T.month_nav("2026년 11월") + "\n" + T.owner_month(2026, 11, date(2026, 11, 20))
        return T.sect(360, inner, None, first=first)
    months = "\n".join('<div style="min-width: 0; display: flex; flex-direction: column; gap: var(--space-xs)"><h3 style="margin: 0; '
                       'font-size: var(--font-size-small); font-weight: var(--font-weight-semibold); color: var(--color-ink-muted)">%d월</h3>\n' % m
                       + T.owner_month(2026, m, date(2026, 11, 20)) + '\n</div>' for m in (11, 12))
    return T.block(T.month_nav("2026년 11월 · 12월") + '\n<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); '
                   'gap: var(--space-lg)">\n' + months + '\n</div>', first)


def scr022_like_kv(b, cx, first):
    return render_block(b, cx, first)


def sp_skill(b, cx, first):
    """SCR-041 스킬 설정 값: 접어 둠(08 normal)."""
    return T.sect(cx.w, T.disclosure("스킬 설정 값"), None, first=first)


def scr041_empty(cx, frame):
    """SCR-041#empty: 08 정의의 연결 순서 1~5단계, 봇 ID·채널 공개 ID 필드와 버튼 블록 ID 필드 다섯(설계 재검토 H8·H5),
    봇 ID 필드 아래 펼쳐 둔 '봇 ID 찾는 법'(W7), '저장'.
    08 회색 와이어프레임은 상자 하나로 줄여 그렸으므로 시안은 정의 글대로 그림."""
    steps = ["오픈빌더에서 봇과 버튼 블록 다섯 열기", "봇 ID·채널 공개 ID·블록 ID 넣고 저장", "스킬 설정 값을 옮기고 안내 블록에 이벤트 이름을 붙인 뒤 배포",
             "연결 확인: 연결 문구와 시험 버튼 다섯", "시험 안내 결과"]
    ol = ('<ol style="margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-sm)">' + "".join(
        '<li' + (' aria-current="step"' if i == 1 else "") + ' style="display: flex; align-items: center; gap: var(--space-sm)">'
        '<span style="flex: none; width: var(--space-xl); height: var(--space-xl); display: inline-flex; align-items: center; justify-content: center; '
        'border-radius: var(--radius-md); background: ' + ("var(--color-accent); color: var(--color-on-accent)" if i == 1
                                                           else "var(--color-surface-sunken); color: var(--color-ink)")
        + '; font-size: var(--font-size-small); font-weight: var(--font-weight-semibold)">' + str(i + 1) + '</span><span>' + sep_wrap(x) + '</span></li>'
        for i, x in enumerate(steps)) + '</ol>')
    fid = T.uid("f")
    how = T.disclosure("봇 ID 찾는 법", True, '<p style="margin: 0">' + e("오픈빌더에서 봇을 열었을 때 주소의 /bot/ 다음 값이에요") + '</p>')
    fields = ('<div style="display: flex; flex-direction: column; gap: var(--space-lg)">\n'
              + '<div style="display: flex; flex-direction: column; gap: var(--space-xs)">' + T.field(fid + "-0", "봇 ID", "text", {}) + how + '</div>\n'
              + T.field(fid + "-1", "채널 공개 ID", "text", {}) + '\n</div>')
    blocks = ('<div style="display: flex; flex-direction: column; gap: var(--space-lg)">\n'
              + "\n".join(T.field(fid + "-%d" % (i + 2), x, "text", {}) for i, x in enumerate(["확인 카드", "주문자 정보", "알레르기 답", "입금자 이름", "후기"]))
              + '\n</div>')
    body = "\n".join([T.band(T.head("연결 순서") + "\n" + ol, first=True), T.band(fields),
                      T.band(T.head("버튼 블록 ID") + "\n" + blocks)])
    return phone(topbar(screen_title(cx), "back"), body, T.footer(["저장"], 0, None), fixed=True)


def scr043_empty(cx, frame):
    """SCR-043#empty: 08 정의의 조건 7개 목록(설계 재검토 M20 RE-10). 마친 것은 체크와 '마침', 남은 것은 그 화면 링크(결제 수단은
    '결제 수단 등록하기'), 영업 신고 확인은 '운영자가 확인하고 있어요'. 예약 링크 주소·'복사'·주소를 넣어 달라는 안내는 없음.
    08 회색 와이어프레임은 목록을 자리 값으로 그렸으므로 시안은 정의 글대로 그림."""
    items = [("영업 신고 확인", "wait", "운영자가 확인하고 있어요"), ("가격표", "done", "마침"), ("운영규정", "done", "마침"),
             ("영업 캘린더", "done", "마침"), ("결제 수단", "link", "결제 수단 등록하기"), ("채널 연결", "done", "마침"),
             ("개인정보 처리방침", "done", "마침")]
    rows = []
    for i, (name, st, text) in enumerate(items):
        if st == "done":
            right = ('<span style="flex: none; display: inline-flex; align-items: center; gap: var(--space-xs); color: var(--color-success); '
                     'font-weight: var(--font-weight-semibold)">' + icon("check", 16) + e(text) + '</span>')
        elif st == "link":
            right = T.link(text)
        else:
            right = '<span style="font-size: var(--font-size-small); color: var(--color-ink-muted); text-align: right">' + e(text) + '</span>'
        rows.append('<li style="display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); min-height: '
                    'var(--size-target); padding: var(--space-xs) var(--space-md);' + ("" if i == 0 else " border-top: " + LINE + ";")
                    + '"><span style="font-weight: var(--font-weight-medium)">' + e(name) + '</span>' + right + '</li>')
    ul = ('<ul style="margin: 0; padding: 0; list-style: none; border: ' + LINE + '; border-radius: var(--radius-md); '
          'background: var(--color-surface)">\n' + "\n".join(rows) + '\n</ul>')
    body = T.band(T.head(frame[1]) + "\n" + ul, first=True)
    return phone(topbar(screen_title(cx), lead_of(cx)), body, fixed=True)


SPECIAL = {("SCR-032", "잡힌 자리/하루 최대 · 휴무 · 다 참 · 마감 · 추가 수락"): scr032_cal,
           ("SCR-041", "스킬 설정 값"): sp_skill}
CUSTOM = {"SCR-001": scr001, "SCR-016": scr016, "SCR-022": scr022}
STATE_DRAW = {("SCR-041", "empty"): scr041_empty, ("SCR-043", "empty"): scr043_empty}


# ── 아트보드 ────────────────────────────────────────────────────────────────────
def name_of(sid):
    import yaml
    tree = yaml.safe_load((REPO / "docs/07-sitemap/sitemap.yaml").read_text(encoding="utf-8"))
    found = {}

    def walk(items):
        for n in items or []:
            found[n["id"]] = n["name"]
            walk(n.get("children"))
    walk(tree)
    return found[sid]


def figures(sid, w):
    s = C.SCREENS[sid]
    d = SAMPLES.get(sid, {})
    out = []
    capx = d.get("cap" if w == 360 else "cap1280", "")
    # 'SCR-000#상태 · 너비' 부분은 한 줄로(캡션은 ' · ' 뒤에서만 줄을 바꿈. 앞 구분 기호를 줄바꿈 없는 공백으로)
    cap = "%s#normal\u00a0· %d\u00a0· 전체 길이%s" % (sid, w, (" · " + capx) if capx else "")
    T.idp, T.idn = "%s-%d" % (sid[4:], w), 0
    out.append(T.fig(cap, draw(sid, w)))
    if w == 1280:
        return out, []
    shown = ["normal"]
    for st in s["states"]:
        name, frame = st[0], st[2] if len(st) > 2 else None
        if name not in KEY_STATES or frame is None:
            continue
        if frame[0] == "box":  # 08단계 자리 값 '추적 ID: 0000-0000'을 06단계 모양의 추적 ID로
            frame = (frame[0], frame[1], frame[2].replace("0000-0000", trace(sid + ":" + name)), frame[3])
        note = STATE_NOTE.get((sid, name)) or STATE_NOTE.get(name, "")
        if frame[0] == "field":  # 입력 오류 프레임은 오류가 난 블록까지 내린 모습(content())
            note += " · 오류가 난 곳까지 내린 모습"
        cap = "%s#%s\u00a0· 360 × 800%s" % (sid, name, (" · " + note) if note else "")
        T.idp, T.idn = "%s-%s" % (sid[4:], name), 0
        out.append(T.fig(cap, draw(sid, 360, name, frame)))
        shown.append(name)
    return out, shown


# 캡션 끝에 붙이는 '언제 보이는지'. 화면별 것이 먼저.
STATE_NOTE = {"not-sent": "알림 채널 친구가 아닐 때", "deferred": "손님이 채널 친구가 아닐 때", "expired": "카드 30분이 지난 뒤",
              # 되돌릴 수 없고 손님에게 안내가 가는 액션 앞의 확인 창(설계 재검토 M19 RE-06)
              ("SCR-022", "confirm-notify"): "'거절'을 누른 뒤",
              ("SCR-023", "confirm-notify"): "'주문 취소'를 누른 뒤",
              ("SCR-024", "confirm-notify"): "'그대로'를 고르고 '수락'을 누른 뒤",
              ("SCR-025", "confirm-notify"): "'환불 결정'을 누른 뒤",
              ("SCR-027", "confirm-notify"): "재제작을 고르고 '보상 정하기'를 누른 뒤",
              ("SCR-029", "confirm-notify"): "'입금됨'을 누른 뒤",
              ("SCR-031", "confirm-notify"): "'픽업 완료'를 누른 뒤",
              # 손님이 주문마다 보는 카드(설계 재검토 남은 빈 곳)
              ("SCR-004", "allergy"): "알레르기 정보 동의를 아직 고르지 않았을 때",
              ("SCR-004", "orderer"): "주문자 이름·연락처가 없을 때",
              ("SCR-005", "amount-confirm"): "견적보다 높게 정한 맞춤 주문의 결제 안내",
              ("SCR-006", "depositor"): "'입금자 이름이 달라요'를 누른 뒤",
              ("SCR-011", "photo-consent"): "완성 사진 보내기를 켠 가게의 완성 사진 안내",
              # 필드 옆 입력 오류(설계 재검토 M19 RE-05): 오류가 난 필드까지 내린 모습
              ("SCR-015", "error"): "사업자등록번호가 10자리가 아닐 때",
              ("SCR-032", "error"): "하루 최대 개수가 100을 넘을 때",
              ("SCR-033", "error"): "전날 안내 시각이 20:50보다 늦을 때",
              ("SCR-034", "error"): "하루 AI 비용 한도가 1,000,000원을 넘을 때",
              ("SCR-036", "error"): "같은 조합을 더함과 함께 못 고름으로 함께 정했을 때",
              ("SCR-038", "error"): "단계별 환불의 기간이 겹칠 때",
              ("SCR-040", "error"): "카드 결제 링크가 https로 시작하지 않을 때",
              ("SCR-021", "confirm"): "가게 사정 취소를 누른 뒤",
              ("SCR-022", "confirm"): "그날 남은 자리가 없을 때",
              ("SCR-023", "confirm"): "결제 기한을 연장할 때 그날 남은 자리가 없으면",
              ("SCR-024", "confirm"): "다 찬 날로 바꾸는 요청을 수락할 때",
              ("SCR-027", "confirm"): "재제작 픽업 일시를 휴무일로 정할 때",
              ("SCR-031", "confirm"): "픽업 날이 아닌 날 인도를 기록할 때",
              ("SCR-032", "confirm"): "확정 주문이 있는 날을 휴무로 바꿀 때",
              ("SCR-033", "confirm"): "확정 주문이 있는 요일을 쉬는 요일로 바꿀 때",
              ("SCR-038", "confirm"): "제작 전 취소 환불을 100%보다 낮출 때",
              ("SCR-040", "confirm"): "예금주가 상호·대표자와 다를 때",
              ("SCR-048", "confirm"): "'확인됨'을 누른 뒤",
              ("SCR-050", "confirm"): "'원래 값 열기'를 누른 뒤",
              ("SCR-029", "expired"): "결제 기한이 지난 안내를 열 때",
              ("SCR-026", "empty"): "손님 환불 계좌를 아직 받지 못했을 때",
              ("SCR-032", "empty"): "영업 캘린더를 아직 정하지 않았을 때",
              ("SCR-033", "empty"): "처음 정할 때",
              ("SCR-036", "empty"): "가격표를 아직 만들지 않았을 때",
              ("SCR-038", "empty"): "운영규정을 아직 확정하지 않았을 때",
              ("SCR-040", "empty"): "결제 수단을 아직 등록하지 않았을 때",
              ("SCR-041", "empty"): "채널을 아직 정하지 않았을 때",
              ("SCR-042", "empty"): "장부를 아직 연결하지 않았을 때",
              ("SCR-043", "empty"): "예약 링크 조건을 다 마치지 않았을 때",
              ("SCR-047", "empty"): "'확인 중' 탭에 가게가 없을 때",
              ("SCR-048", "empty"): "결제 계좌를 아직 등록하지 않았을 때",
              ("SCR-050", "empty"): "그 탭에 기록이 없을 때"}


def page(title, width, height, figs):
    head = ('<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<title>' + e(title) + '</title>\n'
            '<script src="./support.js"></script>\n</head>\n<body>\n<x-dc>\n<helmet>\n'
            '<link rel="stylesheet" href="' + gen.FONT["a"] + '">\n<style>\nbody{margin:0}\n'
            'a{color:var(--color-accent)}a:hover{color:var(--color-accent-pressed)}\n</style>\n</helmet>\n')
    root = ('<div data-tokens="base" style="' + VARS + ' width: ' + str(width) + 'px; box-sizing: border-box; padding: var(--space-xxl); '
            'display: grid; grid-auto-flow: column; grid-auto-columns: min-content; grid-template-rows: auto auto; column-gap: var(--space-xxl); '
            'align-items: start; background: var(--color-line); ' + gen.ROOT + '">\n\n')
    tail = ('\n\n</div>\n</x-dc>\n<script type="text/x-dc" data-dc-script data-props=\'{"$preview":{"width":' + str(width)
            + ',"height":' + str(height) + '}}\'>\nclass Component extends DCLogic {\nrenderVals() {\nreturn {};\n}\n}\n</script>\n</body>\n</html>\n')
    return head + root + "\n\n".join(figs) + tail


def board_width(n_phones, w):
    return (n_phones * 360 + (n_phones + 1) * 32) if w == 360 else 1280 + 2 * 32


# ── 캔버스 배치(canvas.json) ───────────────────────────────────────────────────────
# 페이지마다 화면 한 줄: 왼쪽 360 보드, 오른쪽 1280 보드(열을 맞춤). 줄 위 300px에 화면 이름(title1), 줄 사이 420px.
# 고르기 전 후보(Main, A·B 보드)는 '후보 A·B' 페이지에 예전 자리 그대로 둔다.
PAGES = [("customer", "손님 화면", "손님"), ("owner", "사장님 화면", "사장님"), ("operator", "운영자 화면", "운영자"),
         ("candidates", "후보 A·B (방향 고르기)", None)]
ROW_GAP, NOTE_ABOVE, COL_GAP = 420, 300, 80
LEGEND = ("A '주문서' 방향에 손님 화면 사진을 크게 해서 그린 화면 50개. 화면마다 360 보드(normal 전체 길이, 이어서 모습이 크게 다른 "
          "상태를 360 × 800으로)와 1280 보드(normal). 색·글꼴과 회색 사진 자리는 임시이고 토큰 고정 전에 바꿈. "
          "고르기 전 후보는 '후보 A·B (방향 고르기)' 페이지.")


def audience_of():
    """화면 ID → 사이트맵 맨 위 화면의 audience(손님·사장님·운영자)"""
    import yaml
    tree = yaml.safe_load((REPO / "docs/07-sitemap/sitemap.yaml").read_text(encoding="utf-8"))
    out = {}

    def walk(items, aud):
        for n in items or []:
            out[n["id"]] = aud or n["audience"]
            walk(n.get("children"), aud or n["audience"])
    walk(tree, None)
    return out


def write_canvas():
    path = OUT / "canvas.json"
    canvas = json.loads(path.read_text(encoding="utf-8"))
    mine = {p for p, _, _ in PAGES}
    canvas["pages"] = [{"id": p, "name": n} for p, n, _ in PAGES] + [p for p in canvas.get("pages", []) if p["id"] not in mine]
    canvas["launch"] = {"view": "canvas", "page": PAGES[0][0]}
    boards, notes = canvas.setdefault("boards", {}), canvas.setdefault("notes", {})
    for k, r in boards.items():  # 후보 시안과 Main
        if not k.startswith("SCR-"):
            r.setdefault("page", "candidates")
    for k, nt in notes.items():
        if not (k.startswith("scr") or k == "legend"):
            nt.setdefault("page", "candidates")
    for k in [k for k in boards if k.startswith("SCR-")]:
        del boards[k]
    for k in [k for k in notes if k.startswith("scr") or k == "legend"]:
        del notes[k]
    aud = audience_of()
    files = {}
    for f in sorted(OUT.glob("SCR-*.dc.html")):
        t = f.read_text(encoding="utf-8")
        pv = json.loads(re.search(r"data-props='([^']+)'", t).group(1))["$preview"]
        title = html.unescape(re.search(r"<title>([^<]+)</title>", t).group(1))
        states = []
        for s in re.findall(r"<figcaption[^>]*>SCR-\d{3}#([a-z][a-z0-9_-]*)", t):
            if s not in states:
                states.append(s)
        files[f.name] = (pv["width"], pv["height"], title + " · " + ", ".join(states))
    order = [k for k in canvas.get("order", []) if not k.startswith("SCR-")]
    for p, _, who in PAGES:
        if who is None:
            continue
        sids = sorted({k[:7] for k in files if aud[k[:7]] == who})
        pcx = max(files["%s-360.dc.html" % s][0] for s in sids) + COL_GAP
        y = 0
        for s in sids:
            nm = name_of(s)
            w3, h3, t3 = files["%s-360.dc.html" % s]
            w12, h12, t12 = files["%s-1280.dc.html" % s]
            boards["%s-360.dc.html" % s] = {"x": 0, "y": y, "w": w3, "h": h3, "title": t3, "page": p}
            boards["%s-1280.dc.html" % s] = {"x": pcx, "y": y, "w": w12, "h": h12, "title": t12, "page": p}
            order += ["%s-360.dc.html" % s, "%s-1280.dc.html" % s]
            notes["scr" + s[4:]] = {"x": 0, "y": y - NOTE_ABOVE, "text": "%s %s" % (s, nm), "kind": "title1",
                                    "maxW": pcx + w12, "page": p}
            y += max(h3, h12) + ROW_GAP
        if p == PAGES[0][0]:
            notes["legend"] = {"x": pcx + 1344 + 2 * COL_GAP, "y": 0, "text": LEGEND, "w": 640, "page": p}
    canvas["order"] = order
    path.write_text(json.dumps(canvas, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("canvas.json: 보드 %d개, 메모 %d개, 페이지 %d개" % (len(boards), len(notes), len(canvas["pages"])))


def main(argv):
    heights = json.loads(HEIGHTS.read_text(encoding="utf-8")) if HEIGHTS.exists() else {}
    sids = argv or sorted(C.SCREENS)
    meta = {}
    for sid in sids:
        nm = name_of(sid)
        for w in (360, 1280):
            figs, shown = figures(sid, w)
            width = board_width(len(figs), w)
            board = "%s-%d" % (sid, w)
            (OUT / (board + ".dc.html")).write_text(page("%s %s · %d" % (sid, nm, w), width, heights.get(board, 1200), figs), encoding="utf-8")
            meta[board] = {"w": width, "states": shown or ["normal"], "name": nm}
            print(board, width, heights.get(board, "(높이 아직 안 잼)"), ",".join(shown or ["normal"]))
    write_canvas()
    return meta


if __name__ == "__main__":
    main(sys.argv[1:])
