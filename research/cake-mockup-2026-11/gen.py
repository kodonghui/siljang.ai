#!/usr/bin/env python3
"""Stage 09 artboards for candidate A '주문서' and candidate B '쇼케이스' (Siljang, cake shop).

Writes literal markup (no template holes) that styles every element with the candidate's token
variables. Copy and numbers come from the stage 06 examples
(research/cake-api-2026-11/api_examples.py): shop 달빛케이크, orders K7Q3M9 and P4X8N2, today 11월 12일.

    python3 gen.py            write every artboard below with the heights in heights.json
    python3 gen.py NAME ...   write only these
"""
import json
import pathlib
import re
import sys
from datetime import date

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "canvas" / "project"
HEIGHTS = HERE / "heights.json"


def token_vars(key, src):
    text = (OUT / src).read_text(encoding="utf-8")
    return re.search(r'data-tokens="%s" style="(.*?--size-content:\d+px;)' % key, text).group(1)


VARS = {"a": token_vars("a", "A-SCR-001-360.dc.html"), "b": token_vars("b", "B-SCR-001-360.dc.html")}
FONT = {
    "a": "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&amp;display=swap",
    "b": "https://fonts.googleapis.com/css2?family=Gothic+A1:wght@700;800&amp;family=Noto+Sans+KR:wght@400;500;700&amp;display=swap",
}
ROOT = ("color: var(--color-ink); font-family: var(--font-family-base); font-size: var(--font-size-body); "
        "line-height: var(--font-line-height-body); word-break: keep-all; overflow-wrap: break-word; text-wrap: pretty; "
        "font-variant-numeric: tabular-nums")

# ── data from the stage 06 examples ──────────────────────────────────────────────
TODAY = date(2026, 11, 12)
CLOSED = {date(2026, 11, 12), date(2026, 11, 13), date(2026, 11, 20)}   # booking_days(): 마감


def day_status(d):
    if d < TODAY:
        return "past"
    if d.isoweekday() == 1:
        return "off"
    return "closed" if d in CLOSED else "open"


# (name, sub line, price, custom order?, thumbnail label)
PRICE = [
    ("크기", [("1호", "", "35,000원", False, ""), ("2호", "", "45,000원", False, "")]),
    ("맛", [("생크림", "", "+0원", False, ""), ("초코", "", "+3,000원", False, "")]),
    ("디자인", [("기본 레터링", "도안 하트 레터링", "+0원", False, "도안 하트 레터링 그림"),
               ("캐릭터 그림", "도안 곰돌이", "+20,000원부터", True, "도안 곰돌이 그림")]),
    ("추가", [("초 추가", "", "+1,000원", False, ""), ("2단", "", "+40,000~60,000원", True, "")]),
]
SHOP_INFO = [("상호", "달빛케이크"), ("대표자", "김달빛"), ("연락처", "010-1234-5678"),
             ("사업자등록번호", "123-45-67891"), ("통신판매업 신고번호", "제2026-서울마포-0123호"),
             ("픽업 장소", "서울 마포구 달빛로 12, 1층")]
TASKS = [  # API-040 items, oldest first
    {"kind": "에스컬레이션 건", "summary": "먹어도 되는지 묻는 질문", "order": "", "opened": "11월 12일 12:40",
     "wait": "waiting", "href": "#SCR-017"},
    {"kind": "결제 확인 요청", "summary": "결제 확인 요청 36,000원", "order": "K7Q3M9", "opened": "11월 12일 13:40",
     "wait": "", "href": "#SCR-029"},
    {"kind": "맞춤 주문", "summary": "맞춤 주문 11/20 16:00, 그날 남은 자리 0", "order": "P4X8N2",
     "opened": "11월 12일 14:10", "wait": "late", "href": "#SCR-022"},
]
MENU = [("할 일", "#SCR-016"), ("주문", "#SCR-020"), ("입금 대조", "#SCR-028"), ("제작", "#SCR-030"),
        ("픽업", "#SCR-031"), ("영업 캘린더", "#SCR-032"), ("가게 설정", "#SCR-034")]
REQUEST = [("주문번호", "P4X8N2"), ("요청 시각", "11월 12일 14:10"), ("픽업", "11월 20일(금) 16:00"), ("크기", "2호"),
           ("맛", "생크림"), ("디자인", "캐릭터 그림 · 도안 곰돌이"), ("문구", "HAPPY BIRTHDAY"), ("색", "하늘색"),
           ("도안 메모", "사진처럼 곰돌이 얼굴을 크게"), ("알레르기 답", "없음")]
QUOTE_LINES = [("2호", "45,000원"), ("생크림", "0원"), ("캐릭터 그림", "20,000원부터"),
               ("2호·캐릭터 그림을 함께 고르면", "5,000원")]
REASON = "곰돌이 얼굴 입체 장식이 더해져요"

ICONS = {
    "image": '<rect x="3" y="4" width="18" height="16" rx="2"></rect><circle cx="9" cy="10" r="2"></circle><path d="m21 16-5-5-9 9"></path>',
    "up": '<path d="m6 15 6-6 6 6"></path>',
    "down": '<path d="m6 9 6 6 6-6"></path>',
    "left": '<path d="m15 18-6-6 6-6"></path>',
    "right": '<path d="m9 18 6-6-6-6"></path>',
    "menu": '<path d="M4 6h16"></path><path d="M4 12h16"></path><path d="M4 18h16"></path>',
    "back": '<path d="M19 12H5"></path><path d="m12 19-7-7 7-7"></path>',
    "check": '<path d="M20 6 9 17l-5-5"></path>',
    "bell": '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path>',
}


def svg(name, size, sw="2", style=""):
    st = ' style="' + style + '"' if style else ""
    return ('<svg' + st + ' width="' + str(size) + '" height="' + str(size) + '" viewBox="0 0 24 24" fill="none" '
            'stroke="currentColor" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round" '
            'aria-hidden="true">' + ICONS[name] + '</svg>')


def css(*parts):
    return "; ".join(p for p in parts if p)


def month_cells(y, m):
    first = date(y, m, 1)
    nxt = date(y + (m == 12), m % 12 + 1, 1)
    return first.isoweekday() % 7, [date(y, m, d) for d in range(1, (nxt - first).days + 1)]


LABEL = {"open": "받음", "closed": "마감", "off": "휴무"}
LINE = "var(--border-width-hairline) solid var(--color-line)"


# ── candidate A '주문서' ──────────────────────────────────────────────────────────
class A:
    key, padpx, pad, bg = "a", 32, "var(--space-xxl)", "var(--color-paper)"

    # A figure takes two rows of the board grid (caption, frame) as a subgrid, so frames start on one line
    # even when a caption wraps.
    FIG = "margin: 0; grid-row: span 2; display: grid; grid-template-rows: subgrid; row-gap: var(--space-sm); align-items: start"

    @staticmethod
    def caption(text):
        """A caption breaks only after a ' · ' separator, and the dot stays at the end of the line."""
        return "&nbsp;· ".join(part.replace(" ", "&nbsp;") for part in text.split(" · "))

    def fig(self, caption, inner):
        caption = self.caption(caption)
        return ('<figure style="' + self.FIG + '">\n'
                '<figcaption style="font-size: var(--font-size-small); font-weight: var(--font-weight-semibold); text-wrap: balance">'
                + caption + '</figcaption>\n' + inner + '\n</figure>')

    def h2(self, text, ident=""):
        i = ' id="' + ident + '"' if ident else ""
        return ('<h2' + i + ' style="margin: 0; font-size: var(--font-size-title); font-weight: var(--font-weight-semibold)">'
                + text + '</h2>')

    def label_h2(self, text):
        return ('<h2 style="margin: 0; font-size: var(--font-size-small); font-weight: var(--font-weight-semibold); '
                'color: var(--color-ink-muted)">' + text + '</h2>')

    def head(self, title, meta=""):
        m = ('<span style="font-size: var(--font-size-small); color: var(--color-ink-muted)">' + meta + '</span>') if meta else ""
        return ('<div style="display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-sm)">'
                + self.h2(title) + m + '</div>')

    def block(self, inner, first=False):
        sep = "" if first else "padding-top: var(--space-xl); border-top: " + LINE + "; "
        return '<section style="' + sep + 'display: flex; flex-direction: column; gap: var(--space-md)">\n' + inner + '\n</section>'

    def band(self, inner, first=False):
        sep = "" if first else "border-top: " + LINE + "; "
        return ('<section style="padding: var(--space-lg); ' + sep + 'display: flex; flex-direction: column; gap: var(--space-md)">\n'
                + inner + '\n</section>')

    def btn(self, kind, label, h="var(--size-control)", full=False, size="", attrs="", pad="var(--space-lg)", extra=""):
        look = {
            "primary": "border: 0; background: var(--color-accent); color: var(--color-on-accent)",
            "secondary": "border: var(--border-width-hairline) solid var(--color-line-control); background: var(--color-surface); color: var(--color-ink)",
            "danger": "border: var(--border-width-hairline) solid var(--color-danger); background: var(--color-surface); color: var(--color-danger)",
            "warn": "border: var(--border-width-hairline) solid var(--color-warning); background: var(--color-surface); color: var(--color-warning)",
            "off": "border: 0; background: var(--color-surface-sunken); color: var(--color-ink-muted)",  # 막힌 버튼(설계 재검토 낮음 RE-13)
        }[kind]
        st = css("width: 100%" if full else "", "height: " + h, "padding-inline: " + pad, look,
                 "border-radius: var(--radius-md)", "font: inherit",
                 "font-size: var(--font-size-" + size + ")" if size else "", "font-weight: var(--font-weight-semibold)", extra)
        return '<button type="button"' + attrs + ' style="' + st + '">' + label + '</button>'

    def tag(self, kind):
        if kind == "late":
            return ('<span style="flex: none; display: inline-flex; align-items: center; padding: var(--space-xxs) var(--space-sm); '
                    'border-radius: var(--radius-sm); border: var(--border-width-hairline) solid var(--color-warning); '
                    'background: var(--color-warning-soft); color: var(--color-warning); font-size: var(--font-size-small); '
                    'font-weight: var(--font-weight-bold); line-height: var(--font-line-height-tight)">지연</span>')
        if kind == "waiting":
            return ('<span style="flex: none; display: inline-flex; align-items: center; padding: var(--space-xxs) var(--space-sm); '
                    'border-radius: var(--radius-sm); background: var(--color-surface-sunken); color: var(--color-ink); '
                    'font-size: var(--font-size-small); font-weight: var(--font-weight-medium); line-height: var(--font-line-height-tight)">기다림</span>')
        return ('<span style="padding: 0 var(--space-xs); border: var(--border-width-hairline) solid var(--color-accent); '
                'border-radius: var(--radius-sm); color: var(--color-accent); font-size: var(--font-size-caption); '
                'font-weight: var(--font-weight-medium)">맞춤 주문</span>')

    def photo(self, aria, label, size_css):
        return ('<button type="button" aria-label="' + aria + '" style="' + size_css + '; padding: 0; border: 0; '
                'border-radius: var(--radius-sm); background: var(--color-surface-sunken); color: var(--color-ink-muted); '
                'display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-xs); '
                'font: inherit; font-size: var(--font-size-caption)">' + svg("image", 24, "1.75") + label + '</button>')

    # public page, 1280
    def pub_wide(self, left, aside):
        return ('<main style="width: 1280px; display: flex; flex-direction: column; background: var(--color-paper)">\n'
                '<header style="background: var(--color-surface); border-bottom: ' + LINE + '">'
                '<div style="max-width: var(--size-content); margin-inline: auto; padding-block: var(--space-xl)">'
                '<h1 style="margin: 0; font-size: var(--font-size-display); line-height: var(--font-line-height-tight); '
                'font-weight: var(--font-weight-bold)">달빛케이크</h1></div></header>\n'
                '<div style="width: 100%; max-width: var(--size-content); margin-inline: auto; padding-block: var(--space-xl) var(--space-xxl); '
                'display: grid; grid-template-columns: minmax(0, 1fr) var(--size-aside); gap: var(--space-xxl); align-items: start">\n'
                '<div style="min-width: 0; display: flex; flex-direction: column; gap: var(--space-xl)">\n' + left + '\n</div>\n'
                + aside + '\n</div>\n</main>')

    def portfolio_wide(self):
        photos = "\n".join(self.photo("포트폴리오 사진 %d 크게 보기" % i, "사진 %d" % i, "aspect-ratio: 4 / 3") for i in (1, 2, 3))
        return self.block(self.label_h2("포트폴리오") + '\n<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); '
                          'gap: var(--space-sm)">\n' + photos + '\n</div>', first=True)

    def price_card(self, open_groups):
        out = []
        for gi, (group, items) in enumerate(PRICE):
            is_open = group in open_groups
            top = "" if gi == 0 else "border-top: " + LINE + "; "
            out.append('<button type="button" aria-expanded="' + ("true" if is_open else "false") + '" style="width: 100%; '
                       'min-height: var(--size-target); display: flex; align-items: center; gap: var(--space-sm); padding-inline: var(--space-md); '
                       'border: 0; ' + top + 'background: transparent; color: var(--color-ink); font: inherit; '
                       'font-weight: var(--font-weight-semibold); text-align: left">' + group
                       + '<span style="font-size: var(--font-size-small); font-weight: var(--font-weight-regular); color: var(--color-ink-muted)">'
                       + str(len(items)) + '개</span>' + svg("up" if is_open else "down", 16, style="margin-left: auto") + '</button>')
            if is_open:
                out += [self.price_row(*it) for it in items]
        return ('<div style="border: ' + LINE + '; border-radius: var(--radius-md); background: var(--color-surface)">\n'
                + "\n".join(out) + '\n</div>')

    def price_row(self, name, sub, price, custom, thumb):
        amount = '<span style="font-weight: var(--font-weight-medium); text-align: right">' + price + '</span>'
        if not (sub or custom or thumb):
            return ('<div style="display: flex; justify-content: space-between; gap: var(--space-md); padding: var(--space-sm) var(--space-md); '
                    'border-top: ' + LINE + '"><span>' + name + '</span>' + amount + '</div>')
        pic = ('<div role="img" aria-label="' + thumb + '" style="width: var(--size-target); height: var(--size-target); flex: none; '
               'border-radius: var(--radius-sm); background: var(--color-surface-sunken)"></div>') if thumb else ""
        subl = ('<span style="font-size: var(--font-size-small); color: var(--color-ink-muted)">' + sub + '</span>') if sub else ""
        tag = self.tag("custom") if custom else ""
        if thumb:
            text = ('<div style="flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; '
                    'gap: var(--space-xxs)"><span>' + name + '</span>' + subl + tag + '</div>')
        else:
            text = ('<div style="flex: 1 1 0; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; '
                    'gap: var(--space-xs) var(--space-sm)"><span>' + name + '</span>' + tag + '</div>')
        return ('<div style="display: flex; align-items: center; gap: var(--space-md); padding: var(--space-sm) var(--space-md); '
                'border-top: ' + LINE + '">' + pic + text + amount + '</div>')

    def legend(self):
        sw = "width: var(--space-md); height: var(--space-md)"
        items = [("받음", "background: var(--color-accent-soft); border: var(--border-width-hairline) solid var(--color-accent)"),
                 ("마감", "background: var(--color-surface-sunken); border: var(--border-width-hairline) solid var(--color-line-control)"),
                 ("휴무", "background: var(--color-surface); border: var(--border-width-hairline) solid var(--color-line-control)")]
        return ('<div style="display: flex; flex-wrap: wrap; gap: var(--space-xs) var(--space-lg); font-size: var(--font-size-small)">\n'
                + "\n".join('<span style="display: inline-flex; align-items: center; gap: var(--space-xs)"><span style="' + sw + '; ' + s
                            + '"></span>' + l + '</span>' for l, s in items) + '\n</div>')

    def month_nav(self, label):
        return ('<div style="display: flex; align-items: center; justify-content: space-between">\n'
                '<button type="button" disabled aria-label="이전 달" style="width: var(--size-target); height: var(--size-target); display: flex; '
                'align-items: center; justify-content: center; padding: 0; border: ' + LINE + '; border-radius: var(--radius-md); '
                'background: var(--color-paper); color: var(--color-ink-muted)">' + svg("left", 18) + '</button>\n'
                '<span style="font-weight: var(--font-weight-semibold)">' + label + '</span>\n'
                '<button type="button" aria-label="다음 달" style="width: var(--size-target); height: var(--size-target); display: flex; '
                'align-items: center; justify-content: center; padding: 0; border: var(--border-width-hairline) solid var(--color-line-control); '
                'border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-ink)">' + svg("right", 18) + '</button>\n</div>')

    def month_grid(self, y, m):
        cell = "border-right: " + LINE + "; border-bottom: " + LINE
        filler = '<div style="min-height: var(--size-target); ' + cell + '; background: var(--color-paper)"></div>'
        lead, days = month_cells(y, m)
        out = ['<div style="padding-block: var(--space-xs); ' + cell + '; font-size: var(--font-size-caption); color: var(--color-ink-muted)">'
               + w + '</div>' for w in "일월화수목금토"]
        out += [filler] * lead
        for d in days:
            s = day_status(d)
            base = ("min-height: var(--size-target); display: flex; flex-direction: column; align-items: center; "
                    "justify-content: center; " + cell)
            if s == "past":
                out.append('<div style="' + base + '; background: var(--color-paper); color: var(--color-ink-muted)">' + str(d.day) + '</div>')
                continue
            lab = LABEL[s]
            if d == TODAY:
                out.append('<div aria-label="%d월 %d일 오늘, %s" style="' % (d.month, d.day, lab) + base
                           + '; background: var(--color-surface-sunken); color: var(--color-ink); box-shadow: inset 0 0 0 var(--border-width-strong) var(--color-ink)">'
                           '<span style="font-weight: var(--font-weight-bold); line-height: var(--font-line-height-tight)">' + str(d.day)
                           + '</span><span style="font-size: var(--font-size-caption); line-height: var(--font-line-height-tight)">' + lab + '</span></div>')
                continue
            look = {"open": "background: var(--color-accent-soft); color: var(--color-accent)",
                    "closed": "background: var(--color-surface-sunken); color: var(--color-ink-muted)",
                    "off": "background: var(--color-surface); color: var(--color-ink-muted)"}[s]
            out.append('<div style="' + base + '; ' + look + '"><span style="font-weight: var(--font-weight-semibold); '
                       'line-height: var(--font-line-height-tight)">' + str(d.day) + '</span><span style="font-size: var(--font-size-caption); '
                       'line-height: var(--font-line-height-tight)">' + lab + '</span></div>')
        out += [filler] * (-(lead + len(days)) % 7)
        return ('<div style="display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border-top: ' + LINE + '; border-left: '
                + LINE + '; background: var(--color-surface); text-align: center; font-size: var(--font-size-small)">\n'
                + "\n".join(out) + '\n</div>')

    def calendar_two(self):
        months = "\n".join(
            '<div style="min-width: 0; display: flex; flex-direction: column; gap: var(--space-xs)"><h3 style="margin: 0; '
            'font-size: var(--font-size-small); font-weight: var(--font-weight-semibold); color: var(--color-ink-muted)">%d월</h3>\n' % m
            + self.month_grid(2026, m) + '\n</div>' for m in (11, 12))
        return self.block("\n".join([self.head("빈 날짜", "오늘부터 60일"), self.legend(), self.month_nav("2026년 11월 · 12월"),
                                     '<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-xl)">\n'
                                     + months + '\n</div>']))

    def aside(self):
        rows = "\n".join('<div style="display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); gap: var(--space-md); '
                         'padding-block: var(--space-sm); border-top: ' + LINE + '"><dt style="color: var(--color-ink-muted)">' + k
                         + '</dt><dd style="margin: 0">' + v + '</dd></div>' for k, v in SHOP_INFO)
        card = "padding: var(--space-lg); border: " + LINE + "; border-radius: var(--radius-md); background: var(--color-surface)"
        return ('<aside style="display: flex; flex-direction: column; gap: var(--space-lg)">\n'
                + self.btn("primary", "문의하기", h="var(--size-control-lg)", full=True, size="title") + '\n'
                '<section style="display: flex; flex-direction: column; gap: var(--space-sm); ' + card + '">' + self.h2("가게 정보")
                + '<dl style="margin: 0; font-size: var(--font-size-small)">\n' + rows + '\n</dl></section>\n'
                '<a href="#privacy" style="align-self: flex-start; min-height: var(--size-target); display: inline-flex; align-items: center; '
                'font-size: var(--font-size-small); text-underline-offset: var(--space-xs)">개인정보 처리방침 보기</a>\n</aside>')

    # owner screens
    def phone(self, header, body, footer="", overlay="", full=False, at_end=False):
        """A 360 screen. full=True grows to its content. Otherwise it is 360 × 800: <main> scrolls between the top bar and
        the footer, so the footer stays at the bottom and covers nothing. at_end shows <main> scrolled to its end
        (column-reverse puts the start of the scroll at the bottom)."""
        if full:
            frame, scroll = "width: 360px", ""
        else:
            frame = "width: 360px; height: 800px; position: relative; overflow: hidden"
            scroll = "; min-height: 0; overflow-y: auto; scrollbar-width: none"
        if at_end:
            main = ('<main style="flex: 1 1 auto' + scroll + '; display: flex; flex-direction: column-reverse">\n'
                    '<div style="display: flex; flex-direction: column">\n' + body + '\n</div>\n</main>')
        else:
            main = '<main style="flex: 1 1 auto' + scroll + '; display: flex; flex-direction: column">\n' + body + '\n</main>'
        return ('<div style="' + frame + '; display: flex; flex-direction: column; background: ' + self.bg + '">\n' + header + '\n'
                + main + '\n' + footer + overlay + '\n</div>')

    def topbar(self, title, lead):
        icon, aria = (svg("menu", 22), "메뉴 열기") if lead == "menu" else (svg("back", 22), "뒤로")
        right = ('<span style="margin-left: auto; font-size: var(--font-size-small); color: var(--color-ink-muted)">달빛케이크</span>'
                 if lead == "menu" else "")
        return ('<header style="min-height: var(--size-bar); display: flex; align-items: center; gap: var(--space-xs); '
                'padding-inline: var(--space-xs) var(--space-lg); box-sizing: border-box; background: var(--color-surface); border-bottom: ' + LINE + '">'
                '<button type="button" aria-label="' + aria + '" style="width: var(--size-target); height: var(--size-target); flex: none; '
                'display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: var(--radius-md); '
                'background: transparent; color: var(--color-ink)">' + icon + '</button>'
                '<h1 style="margin: 0; font-size: var(--font-size-title); font-weight: var(--font-weight-semibold)">' + title + '</h1>' + right + '</header>')

    def tabs(self, count, wide=False):
        badge = ('<span style="display: inline-flex; align-items: center; justify-content: center; min-width: var(--space-xl); '
                 'padding-inline: var(--space-xs); box-sizing: border-box; border-radius: var(--radius-sm); background: var(--color-accent-soft); '
                 'color: var(--color-accent); font-size: var(--font-size-caption); font-weight: var(--font-weight-semibold)">' + str(count) + '</span>'
                 ) if count else ""
        tab = ("min-height: var(--size-target); display: inline-flex; align-items: center; gap: var(--space-xs); padding: 0; "
               "margin-bottom: calc(-1 * var(--border-width-hairline)); border: 0; background: transparent; font: inherit")
        return ('<div role="tablist" aria-label="할 일 보기" style="display: flex; gap: var(--space-xl); border-bottom: ' + LINE + '">'
                '<button type="button" role="tab" aria-selected="true" style="' + tab + '; border-bottom: var(--border-width-strong) solid var(--color-accent); '
                'color: var(--color-ink); font-weight: var(--font-weight-semibold)">열린 할 일' + badge + '</button>'
                '<button type="button" role="tab" aria-selected="false" style="' + tab + '; border-bottom: var(--border-width-strong) solid transparent; '
                'color: var(--color-ink-muted)">처리한 일</button></div>')

    def note(self, text):
        return '<p style="margin: 0; font-size: var(--font-size-small); color: var(--color-ink-muted)">' + text + '</p>'

    def task_card(self, t):
        edge = ("border: var(--border-width-hairline) solid var(--color-ink); box-shadow: inset 0 0 0 var(--border-width-hairline) var(--color-ink)"
                if t["wait"] == "late" else "border: " + LINE)
        meta = " · ".join((["주문 " + t["order"]] if t["order"] else []) + [t["opened"]])
        return ('<a href="' + t["href"] + '" style="display: flex; flex-direction: column; gap: var(--space-xs); padding: var(--space-md); '
                + edge + '; border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-ink); text-decoration: none">'
                '<span style="display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); min-height: var(--space-xl)">'
                '<span style="font-size: var(--font-size-small); font-weight: var(--font-weight-semibold); color: var(--color-ink-muted)">'
                + t["kind"] + '</span>' + (self.tag(t["wait"]) if t["wait"] else "") + '</span>'
                '<span style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; '
                'font-weight: var(--font-weight-medium)">' + t["summary"] + '</span>'
                '<span style="font-size: var(--font-size-small); color: var(--color-ink-muted)">' + meta + '</span></a>')

    def banner(self):
        return ('<div role="status" style="display: flex; align-items: center; gap: var(--space-md); padding: var(--space-sm) var(--space-sm) '
                'var(--space-sm) var(--space-md); border: var(--border-width-hairline) solid var(--color-warning); border-radius: var(--radius-md); '
                'background: var(--color-warning-soft); color: var(--color-warning)"><span style="flex: 1 1 0; min-width: 0; '
                'font-weight: var(--font-weight-semibold)">알림을 받으려면 우리 서비스 채널을 추가하세요</span>'
                + self.btn("warn", "채널 추가", pad="var(--space-md)", extra="flex: none") + '</div>')

    def empty(self):
        return ('<div style="display: flex; flex-direction: column; align-items: center; gap: var(--space-sm); padding: var(--space-xxl) var(--space-lg); '
                'border: var(--border-width-hairline) dashed var(--color-line-control); border-radius: var(--radius-md); color: var(--color-ink-muted); '
                'text-align: center">' + svg("check", 24) + '<span>지금 처리할 일이 없어요</span></div>')

    def menu(self, current, badge=3):
        items = []
        for label, href in MENU:
            on = label == current
            look = ("background: var(--color-accent-soft); color: var(--color-accent); font-weight: var(--font-weight-semibold); "
                    "box-shadow: inset var(--border-width-strong) 0 0 var(--color-accent)") if on else "color: var(--color-ink)"
            b = ""
            if label == "할 일" and badge:
                bl = ("background: var(--color-accent); color: var(--color-on-accent)" if on
                      else "background: var(--color-accent-soft); color: var(--color-accent)")
                b = ('<span style="min-width: var(--space-xl); padding-inline: var(--space-xs); box-sizing: border-box; border-radius: var(--radius-sm); '
                     + bl + '; font-size: var(--font-size-caption); font-weight: var(--font-weight-semibold); text-align: center">' + str(badge) + '</span>')
            items.append('<a href="' + href + '"' + (' aria-current="page"' if on else "") + ' style="display: flex; align-items: center; '
                         'justify-content: space-between; gap: var(--space-sm); min-height: var(--size-target); padding-inline: var(--space-md); '
                         'border-radius: var(--radius-sm); ' + look + '; text-decoration: none">' + label + b + '</a>')
        return ('<nav aria-label="사장님 메뉴" style="width: var(--size-menu); flex: none; display: flex; flex-direction: column; gap: var(--space-xxs); '
                'padding: var(--space-lg) var(--space-sm); box-sizing: border-box; background: var(--color-surface); border-right: ' + LINE + '">'
                '<div style="display: flex; flex-direction: column; padding: 0 var(--space-md) var(--space-lg)"><span style="font-size: var(--font-size-title); '
                'font-weight: var(--font-weight-bold)">Siljang 사장님</span><span style="font-size: var(--font-size-small); color: var(--color-ink-muted)">'
                '달빛케이크</span></div>\n' + "\n".join(items) + '\n</nav>')

    def desktop(self, current, title, meta, body, fixed=True):
        h = "height: 800px" if fixed else "min-height: 800px"
        m = ('<p style="margin: 0; font-size: var(--font-size-small); color: var(--color-ink-muted)">' + meta + '</p>') if meta else ""
        return ('<div style="width: 1280px; ' + h + '; display: flex; background: var(--color-paper)">\n' + self.menu(current) + '\n'
                '<main style="flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: var(--space-lg); '
                'padding: var(--space-xl) var(--space-xxl); box-sizing: border-box">\n'
                '<div style="display: flex; flex-direction: column; gap: var(--space-xxs)"><h1 style="margin: 0; font-size: var(--font-size-heading); '
                'line-height: var(--font-line-height-tight); font-weight: var(--font-weight-bold)">' + title + '</h1>' + m + '</div>\n'
                + body + '\n</main>\n</div>')

    def row_link(self, t, h):
        return ('<a href="' + t["href"] + '" style="display: flex; align-items: center; min-height: ' + h + '; color: var(--color-ink); '
                'font-weight: var(--font-weight-medium); text-decoration: underline; text-decoration-color: var(--color-line-control); '
                'text-underline-offset: var(--space-xs)"><span style="min-width: 0; white-space: nowrap; overflow: hidden; '
                'text-overflow: ellipsis">' + t["summary"] + '</span></a>')

    def table_rows(self, tasks, pad, h):
        edge = "var(--border-width-strong) solid var(--color-ink)"
        rows = []
        for t in tasks:
            late = t["wait"] == "late"
            base = ("padding: 0 " + pad + "; vertical-align: middle; "
                    + ("border-top: " + edge + "; border-bottom: " + edge if late else "border-bottom: " + LINE))
            cells = [t["kind"], self.row_link(t, h), t["order"] or "—", t["opened"], self.tag(t["wait"]) if t["wait"] else "—"]
            tds = []
            for i, c in enumerate(cells):
                s = base + ("; border-left: " + edge if late and i == 0 else "") + ("; border-right: " + edge if late and i == 4 else "")
                tds.append('<td style="' + s + '">' + c + '</td>')
            rows.append("<tr>" + "".join(tds) + "</tr>")
        return "\n".join(rows)

    def table(self, tasks):
        th = ("padding: var(--space-sm) var(--space-md); border-bottom: " + LINE + "; background: var(--color-surface-sunken); text-align: left; "
              "font-size: var(--font-size-small); font-weight: var(--font-weight-semibold); color: var(--color-ink-muted)")
        return ('<table style="width: 100%; border-collapse: collapse; table-layout: fixed; background: var(--color-surface); border: ' + LINE + '">'
                + COLS + '<thead><tr>' + "".join('<th scope="col" style="' + th + '">' + x + '</th>' for x in HEADS) + '</tr></thead>\n<tbody>\n'
                + self.table_rows(tasks, "var(--space-md)", "var(--size-target)") + '\n</tbody></table>')

    def kv(self, rows):
        return ('<dl style="margin: 0; border: ' + LINE + '; border-radius: var(--radius-md); background: var(--color-surface)">\n'
                + "\n".join('<div style="display: grid; grid-template-columns: var(--size-thumb) minmax(0, 1fr); gap: var(--space-md); '
                            'padding: var(--space-sm) var(--space-md);' + ("" if i == 0 else " border-top: " + LINE + ";")
                            + '"><dt style="color: var(--color-ink-muted)">' + k + '</dt><dd style="margin: 0; font-weight: var(--font-weight-medium)">'
                            + v + '</dd></div>' for i, (k, v) in enumerate(rows)) + '\n</dl>')

    def quote(self):
        lines = "\n".join('<li style="display: flex; justify-content: space-between; gap: var(--space-md)"><span>' + k + '</span><span>'
                          + v + '</span></li>' for k, v in QUOTE_LINES)
        return ('<div style="border: ' + LINE + '; border-radius: var(--radius-md); background: var(--color-surface)">\n'
                '<div style="display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-md); padding: var(--space-md) '
                'var(--space-md) var(--space-xs)"><span style="font-weight: var(--font-weight-semibold)">견적</span><span style="font-size: '
                'var(--font-size-heading); font-weight: var(--font-weight-bold)">70,000원부터</span></div>\n'
                '<ul style="margin: 0; padding: 0 var(--space-md) var(--space-sm); list-style: none; display: flex; flex-direction: column; '
                'gap: var(--space-xxs); font-size: var(--font-size-small); color: var(--color-ink-muted)">\n' + lines + '\n</ul>\n'
                '<p style="margin: 0; padding: var(--space-sm) var(--space-md); border-top: ' + LINE + '; font-size: var(--font-size-small); '
                'color: var(--color-ink-muted)">가격표 버전 4 · 11월 15일 14:08까지 유효</p>\n'
                '<div style="display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); padding: var(--space-md); '
                'border-top: ' + LINE + '"><span style="display: flex; flex-direction: column"><span style="font-weight: var(--font-weight-semibold)">'
                '그날 자리</span><span style="font-size: var(--font-size-small); color: var(--color-ink-muted)">11월 20일(금)</span></span>'
                '<span><strong style="color: var(--color-warning); font-weight: var(--font-weight-bold)">남은 자리 0</strong> / 하루 최대 5</span></div>\n</div>')

    def ref_row(self):
        photos = "\n".join(self.photo("참고 사진 %d 크게 보기" % i, "참고 사진 %d" % i,
                                      "flex: none; width: calc(var(--size-thumb) + var(--space-lg)); aspect-ratio: 1") for i in (1, 2, 3))
        return ('<div style="display: flex; gap: var(--space-sm); overflow-x: auto; margin-inline: calc(-1 * var(--space-lg)); '
                'padding-inline: var(--space-lg)">\n' + photos + '\n</div>')

    def ref_grid(self):
        photos = "\n".join(self.photo("참고 사진 %d 크게 보기" % i, "참고 사진 %d" % i, "aspect-ratio: 1") for i in (1, 2, 3))
        return '<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-sm)">\n' + photos + '\n</div>'

    def actions(self):
        return ('<div style="display: flex; flex-direction: column; gap: var(--space-sm); padding: var(--space-md) var(--space-lg); '
                'background: var(--color-surface); border-top: ' + LINE + '">'
                + self.btn("primary", "수락", h="var(--size-control-lg)", full=True, size="title")
                + '<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-sm)">'
                + self.btn("secondary", "금액 변경 수락", attrs=' aria-expanded="false"', pad="var(--space-sm)")
                + self.btn("danger", "거절", attrs=' aria-expanded="false"', pad="var(--space-sm)") + '</div></div>')

    def actions_wide(self):
        return ('<div style="display: flex; align-items: center; gap: var(--space-sm); padding-top: var(--space-lg); border-top: ' + LINE + '">'
                + self.btn("primary", "수락", pad="var(--space-xl)") + self.btn("secondary", "금액 변경 수락", attrs=' aria-expanded="false"')
                + '<span style="flex: 1 1 0"></span>' + self.btn("danger", "거절", attrs=' aria-expanded="false"') + '</div>')

    def amount_panel(self):
        return ('<div role="region" aria-labelledby="a-amt-h" style="display: flex; '
                'flex-direction: column; gap: var(--space-md); padding: var(--space-lg); background: var(--color-surface); '
                'border-top: var(--border-width-strong) solid var(--color-ink)">\n'
                + self.h2("금액 변경 수락", "a-amt-h") + '\n'
                '<div style="display: flex; flex-direction: column; gap: var(--space-xs)"><label for="a-amt" style="font-weight: var(--font-weight-semibold)">'
                '바꾼 금액</label><div style="display: flex; align-items: center; gap: var(--space-xs); height: var(--size-control); '
                'padding-inline: var(--space-md); border: var(--border-width-hairline) solid var(--color-accent); border-radius: var(--radius-sm); '
                'background: var(--color-surface); outline: var(--border-width-strong) solid var(--color-accent); outline-offset: var(--space-xxs)">'
                '<input id="a-amt" inputmode="numeric" value="75,000" aria-describedby="a-amt-d" style="flex: 1 1 0; align-self: stretch; min-width: 0; padding: 0; border: 0; '
                'background: transparent; font: inherit; color: var(--color-ink); text-align: right; outline: none">'
                '<span style="color: var(--color-ink-muted)">원</span></div><span id="a-amt-d" style="font-size: var(--font-size-small); '
                'color: var(--color-ink-muted)">요청 금액 70,000원 · 1원~1,000만 원</span></div>\n'
                '<div style="display: flex; flex-direction: column; gap: var(--space-xs)"><label for="a-rsn" style="font-weight: var(--font-weight-semibold)">'
                '사유</label><textarea id="a-rsn" rows="2" aria-describedby="a-rsn-d" style="width: 100%; box-sizing: border-box; padding: '
                'var(--space-sm) var(--space-md); border: var(--border-width-hairline) solid var(--color-line-control); border-radius: var(--radius-sm); '
                'background: var(--color-surface); font: inherit; color: var(--color-ink); resize: none">' + REASON + '</textarea>'
                '<span id="a-rsn-d" style="align-self: flex-end; font-size: var(--font-size-small); color: var(--color-ink-muted)">'
                + str(len(REASON)) + '/200</span></div>\n'
                '<p style="margin: 0; padding: var(--space-sm) var(--space-md); border-radius: var(--radius-sm); background: var(--color-surface-sunken); '
                'font-size: var(--font-size-small)">손님 결제 안내에 <strong>70,000원 → 75,000원</strong>으로 보내요</p>\n'
                '<div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: var(--space-sm)">'
                + self.btn("secondary", "취소") + self.btn("primary", "금액 변경 수락") + '</div>\n</div>')

    def confirm(self):
        return ('<div aria-hidden="true" style="position: absolute; inset: 0; background: var(--color-scrim)"></div>\n'
                '<div role="dialog" aria-modal="true" aria-labelledby="a-cf-t" aria-describedby="a-cf-d" style="position: absolute; '
                'left: var(--space-lg); right: var(--space-lg); top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; '
                'gap: var(--space-md); padding: var(--space-xl) var(--space-lg) var(--space-lg); border: ' + LINE + '; border-radius: var(--radius-lg); '
                'background: var(--color-surface)">\n' + self.h2("저장하기 전에 확인해 주세요", "a-cf-t") + '\n'
                '<p id="a-cf-d" style="margin: 0">그날 남은 자리가 없어요. 추가로 받을까요?</p>\n'
                '<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-sm)">'
                + self.btn("secondary", "취소") + self.btn("primary", "추가로 받기") + '</div>\n</div>')


HEADS = ["종류", "요약", "주문번호", "연 시각", "기다림"]
COLS = ('<colgroup><col style="width: 16%"><col><col style="width: 13%"><col style="width: 17%">'
        '<col style="width: 11%"></colgroup>')


# ── candidate B '쇼케이스' ────────────────────────────────────────────────────────
class B(A):
    key, padpx, pad, bg = "b", 48, "var(--space-xxxl)", "var(--color-bg)"

    def fig(self, caption, inner):
        caption = self.caption(caption)
        return ('<figure style="' + self.FIG + '">\n'
                '<figcaption style="font-size: var(--font-size-small); font-weight: var(--font-weight-bold); text-wrap: balance">'
                + caption + '</figcaption>\n' + inner + '\n</figure>')

    def h2(self, text, ident=""):
        i = ' id="' + ident + '"' if ident else ""
        return ('<h2' + i + ' style="margin: 0; font-family: var(--font-family-display); font-size: var(--font-size-title); '
                'line-height: var(--font-line-height-tight); font-weight: var(--font-weight-heavy)">' + text + '</h2>')

    label_h2 = h2

    def block(self, inner, first=False):
        return '<section style="display: flex; flex-direction: column; gap: var(--space-md)">\n' + inner + '\n</section>'

    def band(self, inner, first=False):
        p = "var(--space-lg)" if first else "var(--space-sm) var(--space-lg) var(--space-lg)"
        return '<section style="padding: ' + p + '; display: flex; flex-direction: column; gap: var(--space-md)">\n' + inner + '\n</section>'

    def btn(self, kind, label, h="var(--size-control)", full=False, size="", attrs="", pad="var(--space-xl)", extra=""):
        look = {
            "primary": "border: 0; background: var(--color-accent); color: var(--color-on-accent)",
            "secondary": "border: var(--border-width-hairline) solid var(--color-line-control); background: var(--color-surface); color: var(--color-ink)",
            "danger": "border: 0; background: var(--color-danger-soft); color: var(--color-danger)",
            "warn": "border: 0; background: var(--color-surface); color: var(--color-warning)",
        }[kind]
        st = css("width: 100%" if full else "", "height: " + h, "padding-inline: " + pad, look,
                 "border-radius: var(--radius-pill)", "font: inherit",
                 "font-size: var(--font-size-" + size + ")" if size else "", "font-weight: var(--font-weight-bold)", extra)
        return '<button type="button"' + attrs + ' style="' + st + '">' + label + '</button>'

    def tag(self, kind):
        pill = ("flex: none; display: inline-flex; align-items: center; padding: var(--space-xs) var(--space-md); border-radius: var(--radius-pill); "
                "font-size: var(--font-size-small); line-height: var(--font-line-height-tight); ")
        if kind == "late":
            return ('<span style="' + pill + 'background: var(--color-warning-soft); color: var(--color-warning); '
                    'font-weight: var(--font-weight-bold)">지연</span>')
        if kind == "waiting":
            return ('<span style="' + pill + 'background: var(--color-surface-sunken); color: var(--color-ink); '
                    'font-weight: var(--font-weight-medium)">기다림</span>')
        return ('<span style="padding: 0 var(--space-sm); border-radius: var(--radius-pill); background: var(--color-accent-soft); '
                'color: var(--color-accent); font-size: var(--font-size-caption); font-weight: var(--font-weight-medium)">맞춤 주문</span>')

    def photo(self, aria, label, size_css):
        return ('<button type="button" aria-label="' + aria + '" style="' + size_css + '; padding: 0; border: 0; '
                'border-radius: var(--radius-md); background: var(--color-surface-sunken); color: var(--color-ink-muted); '
                'display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-xs); '
                'font: inherit; font-size: var(--font-size-small)">' + svg("image", 28, "1.75") + label + '</button>')

    def pub_wide(self, left, aside):
        return ('<main style="width: 1280px; display: flex; flex-direction: column; background: var(--color-bg)">\n'
                '<header style="background: var(--color-accent); color: var(--color-on-accent)"><div style="max-width: var(--size-content); '
                'margin-inline: auto; padding-block: var(--space-xxxl) var(--space-xl)"><h1 style="margin: 0; font-family: var(--font-family-display); '
                'font-size: var(--font-size-display); line-height: var(--font-line-height-tight); font-weight: var(--font-weight-heavy)">달빛케이크</h1>'
                '</div></header>\n'
                '<div style="width: 100%; max-width: var(--size-content); margin-inline: auto; padding-block: var(--space-xxl) var(--space-xxxl); '
                'display: grid; grid-template-columns: minmax(0, 1fr) var(--size-aside); gap: var(--space-xxl); align-items: start">\n'
                '<div style="min-width: 0; display: flex; flex-direction: column; gap: var(--space-xxl)">\n' + left + '\n</div>\n'
                + aside + '\n</div>\n</main>')

    def portfolio_wide(self):
        photos = [self.photo("포트폴리오 사진 1 크게 보기", "사진 1", "grid-column: span 2; grid-row: span 2"),
                  self.photo("포트폴리오 사진 2 크게 보기", "사진 2", "aspect-ratio: 1"),
                  self.photo("포트폴리오 사진 3 크게 보기", "사진 3", "aspect-ratio: 1")]
        return self.block(self.h2("포트폴리오") + '\n<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); '
                          'gap: var(--space-sm)">\n' + "\n".join(photos) + '\n</div>')

    def price_card(self, open_groups):
        out = []
        for gi, (group, items) in enumerate(PRICE):
            is_open = group in open_groups
            top = "" if gi == 0 else "border-top: " + LINE + "; "
            out.append('<button type="button" aria-expanded="' + ("true" if is_open else "false") + '" style="width: 100%; '
                       'min-height: var(--size-control); display: flex; align-items: center; gap: var(--space-sm); padding: 0; border: 0; '
                       + top + 'background: transparent; color: var(--color-ink); font: inherit; font-weight: var(--font-weight-bold); '
                       'text-align: left">' + group + '<span style="font-size: var(--font-size-small); font-weight: var(--font-weight-regular); '
                       'color: var(--color-ink-muted)">' + str(len(items)) + '개</span>'
                       + svg("up" if is_open else "down", 18, style="margin-left: auto") + '</button>')
            if is_open:
                for n, it in enumerate(items):
                    out.append(self.price_row(*it, last=n == len(items) - 1))
        return ('<div style="display: flex; flex-direction: column; padding: var(--space-xs) var(--space-lg); border-radius: var(--radius-lg); '
                'background: var(--color-surface); box-shadow: var(--shadow-card)">\n' + "\n".join(out) + '\n</div>')

    def price_row(self, name, sub, price, custom, thumb, last=False):
        pb = "padding-block: var(--space-sm) var(--space-md)" if last else "padding-block: var(--space-sm)"
        amount = '<span style="font-weight: var(--font-weight-bold); text-align: right">' + price + '</span>'
        if not (sub or custom or thumb):
            return ('<div style="display: flex; justify-content: space-between; gap: var(--space-md); ' + pb + '"><span>' + name + '</span>'
                    + amount + '</div>')
        pic = ('<div role="img" aria-label="' + thumb + '" style="width: var(--size-control); height: var(--size-control); flex: none; '
               'border-radius: var(--radius-sm); background: var(--color-surface-sunken)"></div>') if thumb else ""
        subl = ('<span style="font-size: var(--font-size-small); color: var(--color-ink-muted)">' + sub + '</span>') if sub else ""
        tag = self.tag("custom") if custom else ""
        if thumb:
            text = ('<div style="flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; '
                    'gap: var(--space-xs)"><span>' + name + '</span>' + subl + tag + '</div>')
        else:
            text = ('<div style="flex: 1 1 0; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; '
                    'gap: var(--space-xs) var(--space-sm)"><span>' + name + '</span>' + tag + '</div>')
        return '<div style="display: flex; align-items: center; gap: var(--space-md); ' + pb + '">' + pic + text + amount + '</div>'

    def legend(self):
        sw = "width: var(--space-md); height: var(--space-md); border-radius: var(--radius-pill)"
        items = [("받음", "background: var(--color-accent)"), ("마감", "background: var(--color-line-control)"),
                 ("휴무", "border: var(--border-width-strong) solid var(--color-line-control); box-sizing: border-box")]
        return ('<div style="display: flex; flex-wrap: wrap; gap: var(--space-xs) var(--space-lg); font-size: var(--font-size-small)">\n'
                + "\n".join('<span style="display: inline-flex; align-items: center; gap: var(--space-xs)"><span style="' + sw + '; ' + s
                            + '"></span>' + l + '</span>' for l, s in items) + '\n</div>')

    def month_nav(self, label):
        return ('<div style="display: flex; align-items: center; justify-content: space-between">\n'
                '<button type="button" disabled aria-label="이전 달" style="width: var(--size-target); height: var(--size-target); display: flex; '
                'align-items: center; justify-content: center; padding: 0; border: 0; border-radius: var(--radius-pill); '
                'background: var(--color-surface-sunken); color: var(--color-ink-muted)">' + svg("left", 20) + '</button>\n'
                '<span style="font-family: var(--font-family-display); font-weight: var(--font-weight-heavy)">' + label + '</span>\n'
                '<button type="button" aria-label="다음 달" style="width: var(--size-target); height: var(--size-target); display: flex; '
                'align-items: center; justify-content: center; padding: 0; border: 0; border-radius: var(--radius-pill); '
                'background: var(--color-surface); color: var(--color-ink); box-shadow: var(--shadow-card)">' + svg("right", 20) + '</button>\n</div>')

    def month_grid(self, y, m):
        lead, days = month_cells(y, m)
        out = ['<div style="padding-block: var(--space-xs); font-size: var(--font-size-caption); color: var(--color-ink-muted)">' + w + '</div>'
               for w in "일월화수목금토"]
        out += ['<div></div>'] * lead
        base = ("min-height: var(--size-control); display: flex; flex-direction: column; align-items: center; justify-content: center; "
                "border-radius: var(--radius-sm)")
        for d in days:
            s = day_status(d)
            if s == "past":
                out.append('<div style="min-height: var(--size-control); display: flex; align-items: center; justify-content: center; '
                           'color: var(--color-ink-muted)">' + str(d.day) + '</div>')
                continue
            lab = LABEL[s]
            num = ('<span style="font-weight: var(--font-weight-bold); line-height: var(--font-line-height-tight)">' + str(d.day)
                   + '</span><span style="font-size: var(--font-size-caption); line-height: var(--font-line-height-tight)">' + lab + '</span>')
            if d == TODAY:
                out.append('<div aria-label="%d월 %d일 오늘, %s" style="' % (d.month, d.day, lab) + base
                           + '; background: var(--color-surface-sunken); color: var(--color-ink); box-shadow: inset 0 0 0 '
                           'var(--border-width-strong) var(--color-ink)">' + num + '</div>')
                continue
            look = {"open": "background: var(--color-accent-soft); color: var(--color-accent)",
                    "closed": "background: var(--color-surface-sunken); color: var(--color-ink-muted)",
                    "off": "box-shadow: inset 0 0 0 var(--border-width-hairline) var(--color-line-control); color: var(--color-ink-muted)"}[s]
            out.append('<div style="' + base + '; ' + look + '">' + num + '</div>')
        return ('<div style="display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: var(--border-width-strong); '
                'text-align: center; font-size: var(--font-size-small)">\n' + "\n".join(out) + '\n</div>')

    def calendar_two(self):
        months = "\n".join(
            '<div style="min-width: 0; display: flex; flex-direction: column; gap: var(--space-xs)"><h3 style="margin: 0; '
            'font-family: var(--font-family-display); font-size: var(--font-size-body); font-weight: var(--font-weight-heavy)">%d월</h3>\n' % m
            + self.month_grid(2026, m) + '\n</div>' for m in (11, 12))
        return self.block("\n".join([self.head("빈 날짜", "오늘부터 60일"), self.legend(), self.month_nav("2026년 11월 · 12월"),
                                     '<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-xl)">\n'
                                     + months + '\n</div>']))

    def aside(self):
        rows = "\n".join('<div style="display: flex; flex-direction: column"><dt style="font-size: var(--font-size-small); '
                         'color: var(--color-ink-muted)">' + k + '</dt><dd style="margin: 0; font-weight: var(--font-weight-medium)">'
                         + v + '</dd></div>' for k, v in SHOP_INFO)
        return ('<aside style="display: flex; flex-direction: column; gap: var(--space-lg)">\n'
                + self.btn("primary", "문의하기", full=True, size="title") + '\n'
                '<section style="display: flex; flex-direction: column; gap: var(--space-md); padding: var(--space-xl); border-radius: var(--radius-lg); '
                'background: var(--color-surface); box-shadow: var(--shadow-card)">' + self.h2("가게 정보")
                + '<dl style="margin: 0; display: flex; flex-direction: column; gap: var(--space-md)">\n' + rows + '\n</dl></section>\n'
                '<a href="#privacy" style="align-self: flex-start; min-height: var(--size-target); display: inline-flex; align-items: center; '
                'font-size: var(--font-size-small); text-underline-offset: var(--space-xs)">개인정보 처리방침 보기</a>\n</aside>')

    def topbar(self, title, lead):
        icon, aria = (svg("menu", 24), "메뉴 열기") if lead == "menu" else (svg("back", 24), "뒤로")
        right = ('<span style="margin-left: auto; font-size: var(--font-size-small); color: var(--color-on-accent-muted)">달빛케이크</span>'
                 if lead == "menu" else "")
        return ('<header style="min-height: var(--size-bar); display: flex; align-items: center; gap: var(--space-xs); '
                'padding-inline: var(--space-xs) var(--space-lg); box-sizing: border-box; background: var(--color-accent); color: var(--color-on-accent)">'
                '<button type="button" aria-label="' + aria + '" style="width: var(--size-target); height: var(--size-target); flex: none; '
                'display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: var(--radius-pill); '
                'background: transparent; color: var(--color-on-accent)">' + icon + '</button>'
                '<h1 style="margin: 0; font-family: var(--font-family-display); font-size: var(--font-size-title); line-height: var(--font-line-height-tight); '
                'font-weight: var(--font-weight-heavy)">' + title + '</h1>' + right + '</header>')

    def tabs(self, count, wide=False):
        badge = ('<span style="display: inline-flex; align-items: center; justify-content: center; min-width: var(--space-xl); '
                 'padding-inline: var(--space-xs); box-sizing: border-box; border-radius: var(--radius-pill); background: var(--color-accent); '
                 'color: var(--color-on-accent); font-size: var(--font-size-caption); font-weight: var(--font-weight-bold)">' + str(count) + '</span>'
                 ) if count else ""
        grow = "flex: none; padding-inline: var(--space-xl)" if wide else "flex: 1 1 0; padding-inline: var(--space-md)"
        tab = (grow + "; min-height: var(--size-target); display: inline-flex; align-items: center; justify-content: center; "
               "gap: var(--space-xs); border: 0; border-radius: var(--radius-pill); font: inherit")
        return ('<div role="tablist" aria-label="할 일 보기" style="display: flex; gap: var(--space-xs); padding: var(--space-xs); '
                'border-radius: var(--radius-pill); background: var(--color-surface-sunken)' + ('; align-self: flex-start' if wide else '') + '">'
                '<button type="button" role="tab" aria-selected="true" style="' + tab + '; background: var(--color-surface); color: var(--color-ink); '
                'box-shadow: var(--shadow-card); font-weight: var(--font-weight-bold)">열린 할 일' + badge + '</button>'
                '<button type="button" role="tab" aria-selected="false" style="' + tab + '; background: transparent; color: var(--color-ink-muted); '
                'font-weight: var(--font-weight-medium)">처리한 일</button></div>')

    def task_card(self, t):
        shadow = ("inset 0 0 0 var(--border-width-strong) var(--color-ink), var(--shadow-card)" if t["wait"] == "late"
                  else "var(--shadow-card)")
        meta = " · ".join((["주문 " + t["order"]] if t["order"] else []) + [t["opened"]])
        return ('<a href="' + t["href"] + '" style="display: flex; flex-direction: column; gap: var(--space-sm); padding: var(--space-lg); '
                'border-radius: var(--radius-lg); background: var(--color-surface); box-shadow: ' + shadow + '; color: var(--color-ink); '
                'text-decoration: none"><span style="display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); '
                'min-height: var(--size-target)"><span style="font-size: var(--font-size-small); font-weight: var(--font-weight-bold); '
                'color: var(--color-ink-muted)">' + t["kind"] + '</span>' + (self.tag(t["wait"]) if t["wait"] else "") + '</span>'
                '<span style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; '
                'font-size: var(--font-size-title); line-height: var(--font-line-height-tight); font-weight: var(--font-weight-bold)">'
                + t["summary"] + '</span><span style="font-size: var(--font-size-small); color: var(--color-ink-muted)">' + meta + '</span></a>')

    def banner(self):
        return ('<div role="status" style="display: flex; align-items: center; gap: var(--space-md); padding: var(--space-md) var(--space-sm) '
                'var(--space-md) var(--space-lg); border-radius: var(--radius-lg); background: var(--color-warning-soft); color: var(--color-warning)">'
                + svg("bell", 20, style="flex: none") + '<span style="flex: 1 1 0; min-width: 0; font-weight: var(--font-weight-bold)">'
                '알림을 받으려면 우리 서비스 채널을 추가하세요</span>'
                + self.btn("warn", "채널 추가", h="var(--size-target)", pad="var(--space-lg)", extra="flex: none") + '</div>')

    def empty(self):
        return ('<div style="display: flex; flex-direction: column; align-items: center; gap: var(--space-md); padding: var(--space-xxxl) '
                'var(--space-lg); text-align: center"><span style="width: var(--size-bar); height: var(--size-bar); display: flex; '
                'align-items: center; justify-content: center; border-radius: var(--radius-pill); background: var(--color-accent-soft); '
                'color: var(--color-accent)">' + svg("check", 28) + '</span><span style="font-family: var(--font-family-display); '
                'font-size: var(--font-size-title); font-weight: var(--font-weight-heavy)">지금 처리할 일이 없어요</span></div>')

    def menu(self, current, badge=3):
        items = []
        for label, href in MENU:
            on = label == current
            look = ("background: var(--color-surface); color: var(--color-accent); font-weight: var(--font-weight-bold)" if on
                    else "color: var(--color-on-accent-muted); font-weight: var(--font-weight-medium)")
            b = ""
            if label == "할 일" and badge:
                bl = ("background: var(--color-accent); color: var(--color-on-accent)" if on
                      else "background: var(--color-on-accent-muted); color: var(--color-accent)")
                b = ('<span style="min-width: var(--space-xl); padding-inline: var(--space-xs); box-sizing: border-box; border-radius: var(--radius-pill); '
                     + bl + '; font-size: var(--font-size-caption); font-weight: var(--font-weight-bold); text-align: center">' + str(badge) + '</span>')
            items.append('<a href="' + href + '"' + (' aria-current="page"' if on else "") + ' style="display: flex; align-items: center; '
                         'justify-content: space-between; gap: var(--space-sm); min-height: var(--size-target); padding-inline: var(--space-lg); '
                         'border-radius: var(--radius-pill); ' + look + '; text-decoration: none">' + label + b + '</a>')
        return ('<nav aria-label="사장님 메뉴" style="width: var(--size-menu); flex: none; display: flex; flex-direction: column; gap: var(--space-xs); '
                'padding: var(--space-xl) var(--space-md); box-sizing: border-box; background: var(--color-accent); color: var(--color-on-accent)">'
                '<div style="display: flex; flex-direction: column; gap: var(--space-xs); padding: 0 var(--space-lg) var(--space-xl)">'
                '<span style="font-family: var(--font-family-display); font-size: var(--font-size-title); line-height: var(--font-line-height-tight); '
                'font-weight: var(--font-weight-heavy)">Siljang 사장님</span><span style="font-size: var(--font-size-small); '
                'color: var(--color-on-accent-muted)">달빛케이크</span></div>\n' + "\n".join(items) + '\n</nav>')

    def desktop(self, current, title, meta, body, fixed=True):
        h = "height: 800px" if fixed else "min-height: 800px"
        m = ('<p style="margin: 0; font-size: var(--font-size-small); color: var(--color-ink-muted)">' + meta + '</p>') if meta else ""
        return ('<div style="width: 1280px; ' + h + '; display: flex; background: var(--color-bg)">\n' + self.menu(current) + '\n'
                '<main style="flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: var(--space-xl); '
                'padding: var(--space-xxl) var(--space-xxxl); box-sizing: border-box">\n'
                '<div style="display: flex; flex-direction: column; gap: var(--space-xs)"><h1 style="margin: 0; font-family: var(--font-family-display); '
                'font-size: var(--font-size-heading); line-height: var(--font-line-height-tight); font-weight: var(--font-weight-heavy)">' + title
                + '</h1>' + m + '</div>\n' + body + '\n</main>\n</div>')

    def table(self, tasks):
        th = ("padding: var(--space-md) var(--space-lg); border-bottom: " + LINE + "; text-align: left; font-size: var(--font-size-small); "
              "font-weight: var(--font-weight-bold); color: var(--color-ink-muted)")
        return ('<div style="padding-bottom: var(--space-lg); border-radius: var(--radius-lg); background: var(--color-surface); '
                'box-shadow: var(--shadow-card)"><table style="width: 100%; border-collapse: collapse; table-layout: fixed">'
                + COLS + '<thead><tr>' + "".join('<th scope="col" style="' + th + '">' + x + '</th>' for x in HEADS) + '</tr></thead>\n<tbody>\n'
                + self.table_rows(tasks, "var(--space-lg)", "var(--size-control)") + '\n</tbody></table></div>')

    def kv(self, rows):
        return ('<dl style="margin: 0; display: flex; flex-direction: column; padding: var(--space-xs) var(--space-lg); border-radius: var(--radius-lg); '
                'background: var(--color-surface); box-shadow: var(--shadow-card)">\n'
                + "\n".join('<div style="display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-lg); '
                            'padding-block: var(--space-md);' + ("" if i == 0 else " border-top: " + LINE + ";")
                            + '"><dt style="flex: none; color: var(--color-ink-muted)">' + k + '</dt><dd style="margin: 0; min-width: 0; '
                            'font-weight: var(--font-weight-bold); text-align: right">' + v + '</dd></div>' for i, (k, v) in enumerate(rows))
                + '\n</dl>')

    def quote(self):
        lines = "\n".join('<li style="display: flex; justify-content: space-between; gap: var(--space-md)"><span>' + k + '</span><span>'
                          + v + '</span></li>' for k, v in QUOTE_LINES)
        return ('<div style="display: flex; flex-direction: column; gap: var(--space-md); padding: var(--space-lg); border-radius: var(--radius-lg); '
                'background: var(--color-surface); box-shadow: var(--shadow-card)">\n'
                '<div style="display: flex; flex-direction: column; gap: var(--space-xs)"><span style="font-size: var(--font-size-small); '
                'font-weight: var(--font-weight-bold); color: var(--color-ink-muted)">견적</span><span style="font-family: var(--font-family-display); '
                'font-size: var(--font-size-display); line-height: var(--font-line-height-tight); font-weight: var(--font-weight-heavy)">70,000원부터</span></div>\n'
                '<ul style="margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-xs); '
                'font-size: var(--font-size-small); color: var(--color-ink-muted)">\n' + lines + '\n</ul>\n'
                '<p style="margin: 0; font-size: var(--font-size-small); color: var(--color-ink-muted)">가격표 버전 4 · 11월 15일 14:08까지 유효</p>\n</div>\n'
                '<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-xs) var(--space-md); '
                'padding: var(--space-md) var(--space-lg); border-radius: var(--radius-lg); background: var(--color-warning-soft)">'
                '<span style="font-weight: var(--font-weight-bold)">그날 자리 · 11월 20일(금)</span><span><strong style="color: var(--color-warning); '
                'font-weight: var(--font-weight-heavy)">남은 자리 0</strong> / 하루 최대 5</span></div>')

    def ref_row(self):
        photos = "\n".join(self.photo("참고 사진 %d 크게 보기" % i, "참고 사진 %d" % i, "flex: none; width: var(--size-thumb); aspect-ratio: 1")
                           for i in (1, 2, 3))
        return ('<div style="display: flex; gap: var(--space-sm); overflow-x: auto; margin-inline: calc(-1 * var(--space-lg)); '
                'padding-inline: var(--space-lg)">\n' + photos + '\n</div>')

    def actions(self):
        return ('<div style="display: flex; flex-direction: column; gap: var(--space-sm); padding: var(--space-md) var(--space-lg); '
                'background: var(--color-surface); box-shadow: var(--shadow-raised)">'
                + self.btn("primary", "수락", full=True, size="title")
                + '<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-sm)">'
                + self.btn("secondary", "금액 변경 수락", h="var(--size-target)", attrs=' aria-expanded="false"', pad="var(--space-sm)")
                + self.btn("danger", "거절", h="var(--size-target)", attrs=' aria-expanded="false"', pad="var(--space-sm)") + '</div></div>')

    def actions_wide(self):
        return ('<div style="display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-lg); border-radius: var(--radius-lg); '
                'background: var(--color-surface); box-shadow: var(--shadow-card)">'
                + self.btn("primary", "수락", pad="var(--space-xxl)") + self.btn("secondary", "금액 변경 수락", attrs=' aria-expanded="false"')
                + '<span style="flex: 1 1 0"></span>' + self.btn("danger", "거절", attrs=' aria-expanded="false"') + '</div>')

    def amount_panel(self):
        return ('<div role="region" aria-labelledby="b-amt-h" style="display: flex; '
                'flex-direction: column; gap: var(--space-md); padding: var(--space-xl) var(--space-lg) var(--space-lg); background: var(--color-surface); '
                'border-radius: var(--radius-lg) var(--radius-lg) 0 0; box-shadow: var(--shadow-raised)">\n'
                + self.h2("금액 변경 수락", "b-amt-h") + '\n'
                '<div style="display: flex; flex-direction: column; gap: var(--space-sm)"><label for="b-amt" style="font-weight: var(--font-weight-bold)">'
                '바꾼 금액</label><div style="display: flex; align-items: center; gap: var(--space-xs); height: var(--size-control); '
                'padding-inline: var(--space-lg); border: var(--border-width-hairline) solid var(--color-accent); border-radius: var(--radius-sm); '
                'background: var(--color-surface); outline: var(--border-width-strong) solid var(--color-accent); outline-offset: var(--border-width-strong)">'
                '<input id="b-amt" inputmode="numeric" value="75,000" aria-describedby="b-amt-d" style="flex: 1 1 0; align-self: stretch; min-width: 0; padding: 0; border: 0; '
                'background: transparent; font: inherit; color: var(--color-ink); text-align: right; outline: none">'
                '<span style="color: var(--color-ink-muted)">원</span></div><span id="b-amt-d" style="font-size: var(--font-size-small); '
                'color: var(--color-ink-muted)">요청 금액 70,000원 · 1원~1,000만 원</span></div>\n'
                '<div style="display: flex; flex-direction: column; gap: var(--space-sm)"><label for="b-rsn" style="font-weight: var(--font-weight-bold)">'
                '사유</label><textarea id="b-rsn" rows="2" aria-describedby="b-rsn-d" style="width: 100%; box-sizing: border-box; padding: '
                'var(--space-sm) var(--space-lg); border: var(--border-width-hairline) solid var(--color-line-control); border-radius: var(--radius-sm); '
                'background: var(--color-surface); font: inherit; color: var(--color-ink); resize: none">' + REASON + '</textarea>'
                '<span id="b-rsn-d" style="align-self: flex-end; font-size: var(--font-size-small); color: var(--color-ink-muted)">'
                + str(len(REASON)) + '/200</span></div>\n'
                '<p style="margin: 0; padding: var(--space-sm) var(--space-lg); border-radius: var(--radius-md); background: var(--color-accent-soft); '
                'color: var(--color-ink); font-size: var(--font-size-small)">손님 결제 안내에 <strong>70,000원 → 75,000원</strong>으로 보내요</p>\n'
                '<div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: var(--space-sm)">'
                + self.btn("secondary", "취소", pad="var(--space-md)") + self.btn("primary", "금액 변경 수락", pad="var(--space-md)") + '</div>\n</div>')

    def confirm(self):
        return ('<div aria-hidden="true" style="position: absolute; inset: 0; background: var(--color-scrim)"></div>\n'
                '<div role="dialog" aria-modal="true" aria-labelledby="b-cf-t" aria-describedby="b-cf-d" style="position: absolute; left: 0; right: 0; '
                'bottom: 0; display: flex; flex-direction: column; gap: var(--space-md); padding: var(--space-xl) var(--space-lg) var(--space-lg); '
                'border-radius: var(--radius-lg) var(--radius-lg) 0 0; background: var(--color-surface); box-shadow: var(--shadow-raised)">\n'
                + self.h2("저장하기 전에 확인해 주세요", "b-cf-t") + '\n'
                '<p id="b-cf-d" style="margin: 0">그날 남은 자리가 없어요. 추가로 받을까요?</p>\n'
                '<div style="display: flex; flex-direction: column; gap: var(--space-sm)">'
                + self.btn("primary", "추가로 받기", full=True) + self.btn("secondary", "취소", full=True) + '</div>\n</div>')


# ── screens ─────────────────────────────────────────────────────────────────────
def scr001_wide(T):
    left = "\n".join([T.portfolio_wide(), T.block(T.head("가격표", "버전 4") + "\n" + T.price_card(("크기", "맛", "디자인", "추가"))),
                      T.calendar_two()])
    return [T.fig("SCR-001#normal · 1280 · 전체 길이 (문의하기는 오른쪽 열 위)", T.pub_wide(left, T.aside()))], 0


def scr016_phone(T):
    def frame(body):
        return T.phone(T.topbar("할 일", "menu"),
                       '<div style="display: flex; flex-direction: column; gap: var(--space-md); padding: var(--space-lg)">\n' + body + '\n</div>')
    normal = frame("\n".join([T.tabs(3), T.note("오래된 순")] + [T.task_card(t) for t in TASKS]))
    notsent = frame("\n".join([T.banner(), T.tabs(1), T.note("오래된 순"), T.task_card(TASKS[0])]))
    empty = frame("\n".join([T.tabs(0), T.empty()]))
    return [T.fig("SCR-016#normal · 360 × 800", normal),
            T.fig("SCR-016#not-sent · 360 × 800 · 알림 채널 친구가 아닐 때", notsent),
            T.fig("SCR-016#empty · 360 × 800", empty)], 3


def scr016_wide(T):
    body = T.tabs(3, wide=True) + "\n" + T.table(TASKS)
    return [T.fig("SCR-016#normal · 1280 × 800", T.desktop("할 일", "할 일", "오래된 순 · 열린 할 일 3개", body))], 0


def scr022_phone(T):
    bands = "\n".join([T.band(T.head("참고 사진", "3장") + "\n" + T.ref_row(), first=True),
                       T.band(T.head("요청 내용") + "\n" + T.kv(REQUEST)),
                       T.band(T.head("가게 규칙 계산") + "\n" + T.quote())])
    top = T.topbar("맞춤 주문 검토", "back")
    return [T.fig("SCR-022#normal · 360 · 전체 길이 (버튼 셋은 화면 아래 고정)", T.phone(top, bands, footer=T.actions(), full=True)),
            T.fig("SCR-022#normal · 360 × 800 · 금액 변경 수락을 누른 뒤",
                  T.phone(top, bands, footer=T.amount_panel(), at_end=True)),
            T.fig("SCR-022#confirm · 360 × 800 · 그날 남은 자리가 없을 때",
                  T.phone(top, bands, footer=T.actions(), overlay=T.confirm(), at_end=True))], 3


def scr022_wide(T):
    left = T.block(T.head("참고 사진", "3장") + "\n" + T.ref_grid(), first=True)
    right = "\n".join([T.block(T.head("요청 내용") + "\n" + T.kv(REQUEST[2:]), first=True),
                       T.block(T.head("가게 규칙 계산") + "\n" + T.quote())])
    body = ('<div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-xxl); align-items: start">\n'
            + left + '\n<div style="min-width: 0; display: flex; flex-direction: column; gap: var(--space-xl)">\n' + right + '\n</div>\n</div>\n'
            + T.actions_wide())
    return [T.fig("SCR-022#normal · 1280 · 전체 길이",
                  T.desktop("주문", "맞춤 주문 검토", "주문번호 P4X8N2 · 요청 11월 12일 14:10", body, fixed=False))], 0


BOARDS = {
    "A-SCR-001-1280": (A, scr001_wide, "A · 예약 링크 페이지 · 1280"),
    "B-SCR-001-1280": (B, scr001_wide, "B · 예약 링크 페이지 · 1280"),
    "A-SCR-016-360": (A, scr016_phone, "A · 할 일 목록 · 360"),
    "B-SCR-016-360": (B, scr016_phone, "B · 할 일 목록 · 360"),
    "A-SCR-016-1280": (A, scr016_wide, "A · 할 일 목록 · 1280"),
    "B-SCR-016-1280": (B, scr016_wide, "B · 할 일 목록 · 1280"),
    "A-SCR-022-360": (A, scr022_phone, "A · 맞춤 주문 검토 · 360"),
    "B-SCR-022-360": (B, scr022_phone, "B · 맞춤 주문 검토 · 360"),
    "A-SCR-022-1280": (A, scr022_wide, "A · 맞춤 주문 검토 · 1280"),
    "B-SCR-022-1280": (B, scr022_wide, "B · 맞춤 주문 검토 · 1280"),
}


def board_width(T, phones):
    return (phones * 360 if phones else 1280) + ((phones + 1) if phones else 2) * T.padpx


def page(T, title, width, height, figures):
    head = ('<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<title>' + title + '</title>\n'
            '<script src="./support.js"></script>\n</head>\n<body>\n<x-dc>\n<helmet>\n'
            '<link rel="stylesheet" href="' + FONT[T.key] + '">\n<style>\nbody{margin:0}\n'
            'a{color:var(--color-accent)}a:hover{color:var(--color-accent-pressed)}\n</style>\n</helmet>\n')
    root = ('<div data-tokens="' + T.key + '" style="' + VARS[T.key] + ' width: ' + str(width) + 'px; box-sizing: border-box; padding: '
            + T.pad + '; display: grid; grid-auto-flow: column; grid-auto-columns: min-content; grid-template-rows: auto auto; '
            'column-gap: ' + T.pad + '; align-items: start; background: var(--color-line); ' + ROOT + '">\n\n')
    tail = ('\n\n</div>\n</x-dc>\n<script type="text/x-dc" data-dc-script data-props=\'{"$preview":{"width":' + str(width)
            + ',"height":' + str(height) + '}}\'>\nclass Component extends DCLogic {\nrenderVals() {\nreturn {};\n}\n}\n</script>\n</body>\n</html>\n')
    return head + root + "\n\n".join(figures) + tail


def main(names):
    heights = json.loads(HEIGHTS.read_text()) if HEIGHTS.exists() else {}
    for name in names or BOARDS:
        cls, build, title = BOARDS[name]
        T = cls()
        figures, phones = build(T)
        width = board_width(T, phones)
        (OUT / (name + ".dc.html")).write_text(page(T, title, width, heights.get(name, 1200), figures), encoding="utf-8")
        print(name, width, heights.get(name, "(height not measured)"))


if __name__ == "__main__":
    main(sys.argv[1:])
