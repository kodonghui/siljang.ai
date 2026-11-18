// 사장님·운영자 화면 레이아웃(TASK-182)의 메뉴·1뎁스 표를 07·08과 견주고, 레이아웃·목록 부품의 표시를 본다(renderToString).
// 브라우저에서 누르는 것(360 메뉴 열기·닫기 포커스, Esc, 항목 누르면 닫힘)과 너비마다 보이는 쪽은 scripts/page-check.mjs가 본다.
import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { LoginLayout, OperatorLayout, OwnerLayout, PageSection, SetupLayout } from "./Layout";
import { type ListColumn, ListView } from "./ListView";
import {
  GO_BACK_LABEL,
  isMenuScreen,
  MENU_NAME,
  MENUS,
  type MenuShell,
  OPEN_MENU_LABEL,
  OPERATOR_MENU,
  OWNER_MENU,
  SCREEN_SECTION,
  sectionOf,
} from "./menus";

const REPO = new URL("../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, REPO), "utf8");

interface SitemapNode {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly status?: string;
  readonly children?: readonly SitemapNode[];
}

/** 07 화면 트리: 화면마다 경로·루트·1뎁스 조상 */
const sitemap = (() => {
  const roots = parse(read("docs/07-sitemap/sitemap.yaml")) as SitemapNode[];
  const rows = new Map<string, { path: string; root: string; top: string; depth: number; name: string }>();
  const walk = (nodes: readonly SitemapNode[], root: string, top: string | null, depth: number) => {
    for (const n of nodes) {
      if (n.status === "removed") continue;
      const t = top ?? n.id;
      rows.set(n.id, { path: n.path, root, top: t, depth, name: n.name });
      walk(n.children ?? [], root, t, depth + 1);
    }
  };
  for (const r of roots) {
    rows.set(r.id, { path: r.path, root: r.id, top: r.id, depth: 0, name: r.name });
    walk(r.children ?? [], r.id, null, 1);
  }
  return rows;
})();

/** 08 화면 정의의 원본(research/cake-screens-2026-11/screens_*.py): 화면마다 레이아웃 종류와 위쪽 막대 첫 버튼(← 또는 없음) */
const screens08 = (() => {
  const out = new Map<string, { shell: string; back: boolean }>();
  for (const file of ["screens_guest.py", "screens_owner_a.py", "screens_owner_b.py", "screens_operator.py"]) {
    const src = read(`research/cake-screens-2026-11/${file}`);
    const parts = src.split(/^scr\(/m).slice(1);
    for (const part of parts) {
      const id = /^"(SCR-\d{3})"/.exec(part)?.[1];
      const shell = /shell="([a-z-]+)"/.exec(part)?.[1];
      const bar = /\bbar\(("[^"]*")(?:,\s*left="([^"]*)")?/.exec(part);
      if (id === undefined || shell === undefined) continue;
      out.set(id, { shell, back: bar !== null && bar[2] === undefined });
    }
  }
  return out;
})();

const W4 = (() => {
  const line = read("docs/08-screens/README.md")
    .split("\n")
    .find((l) => l.startsWith("| W4 |"));
  if (line === undefined) throw new Error("08 README에 W4 행이 없음");
  return line;
})();

const SHELLS: readonly MenuShell[] = ["owner", "operator"];

describe("메뉴(08 W4, 07 화면 트리)", () => {
  it("사장님 메뉴 7개의 이름과 순서가 08 W4와 같다", () => {
    const listed = /왼쪽 메뉴\(([^)]+)\)/.exec(W4)?.[1]?.split("·");
    expect(OWNER_MENU.map((m) => m.label)).toEqual(listed);
  });

  it("운영자 메뉴 2개의 이름과 순서가 08 W4와 같다", () => {
    const listed = /운영자 화면은 메뉴 둘\(([^)]+)\)/.exec(W4)?.[1]?.split("·");
    expect(OPERATOR_MENU.map((m) => m.label)).toEqual(listed);
  });

  it("사장님 메뉴는 07 사장님 로그인(SCR-014) 아래 1뎁스 화면에서 가게 등록(SCR-015)만 뺀 것(같은 순서)", () => {
    const tops = [...sitemap.entries()]
      .filter(([, r]) => r.root === "SCR-014" && r.depth === 1 && r.path.startsWith("/"))
      .map(([id]) => id)
      .filter((id) => id !== "SCR-015");
    expect(OWNER_MENU.map((m) => m.screen)).toEqual(tops);
  });

  it("운영자 메뉴는 07 운영자 로그인(SCR-046) 아래 1뎁스에서 가게 기록 보기(SCR-050)만 뺀 것", () => {
    const tops = [...sitemap.entries()].filter(([, r]) => r.root === "SCR-046" && r.depth === 1).map(([id]) => id);
    expect(tops).toContain("SCR-050");
    expect(OPERATOR_MENU.map((m) => m.screen)).toEqual(tops.filter((id) => id !== "SCR-050"));
  });

  it.each(SHELLS)("%s 메뉴 항목의 주소가 07 경로와 같다", (shell) => {
    for (const m of MENUS[shell]) expect(m.path, m.screen).toBe(sitemap.get(m.screen)?.path);
  });

  it("메뉴의 접근성 이름은 09 그대로('사장님 메뉴'·'운영자 메뉴'·'메뉴 열기'·'뒤로')", () => {
    const readme = read("docs/09-mockup/README.md");
    for (const name of [MENU_NAME.owner, MENU_NAME.operator, OPEN_MENU_LABEL, GO_BACK_LABEL]) {
      expect(readme).toContain(`'${name}'`);
    }
  });
});

describe("화면 → 1뎁스(07, 08 레이아웃)", () => {
  /** 08에서 메뉴가 있는 화면(사장님 화면·운영자 화면 레이아웃) */
  const withMenu = [...screens08.entries()].filter(([, s]) => s.shell === "owner" || s.shell === "operator");

  it("08에서 메뉴가 있는 웹 화면이 모두 표에 있고, 표에는 그 화면만 있다", () => {
    const web = withMenu.filter(([id]) => sitemap.get(id)?.path.startsWith("/")).map(([id]) => id);
    expect(Object.keys(SCREEN_SECTION).sort()).toEqual(web.sort());
  });

  it("카카오 화면(SCR-019 사장님 알림)과 메뉴 없는 화면(SCR-014·015·046)은 표에 없다", () => {
    for (const id of ["SCR-014", "SCR-015", "SCR-019", "SCR-046"]) expect(SCREEN_SECTION[id], id).toBeUndefined();
    expect(screens08.get("SCR-015")?.shell).toBe("owner-setup");
    expect(screens08.get("SCR-014")?.shell).toBe("login");
    expect(screens08.get("SCR-046")?.shell).toBe("login");
  });

  it("1뎁스는 07 화면 트리의 1뎁스 조상이다(SCR-050만 '영업 신고 확인')", () => {
    for (const [id, section] of Object.entries(SCREEN_SECTION)) {
      const expected = id === "SCR-050" ? "SCR-047" : sitemap.get(id)?.top;
      expect(section, id).toBe(expected);
    }
  });

  it("360 위쪽 막대의 첫 버튼: 메뉴 항목 화면은 '메뉴 열기', 나머지는 '뒤로'(08 레이아웃의 ←와 같음)", () => {
    for (const [id, s] of withMenu) {
      if (SCREEN_SECTION[id] === undefined) continue;
      const shell = s.shell as MenuShell;
      expect(isMenuScreen(shell, id), id).toBe(!s.back);
    }
  });

  it("sectionOf: 화면이 속한 메뉴 항목, 다른 메뉴의 화면이면 오류", () => {
    expect(sectionOf("owner", "SCR-022").label).toBe("주문");
    expect(sectionOf("owner", "SCR-016").label).toBe("할 일");
    expect(sectionOf("operator", "SCR-048").label).toBe("영업 신고 확인");
    expect(sectionOf("operator", "SCR-050").label).toBe("영업 신고 확인");
    expect(sectionOf("operator", "SCR-049").label).toBe("운영자 알림");
    expect(() => sectionOf("owner", "SCR-047")).toThrow();
    expect(() => sectionOf("operator", "SCR-016")).toThrow();
    expect(() => sectionOf("owner", "SCR-015")).toThrow();
  });
});

const noop = () => {};

/** 태그를 뺀 글 */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** 메뉴 항목 링크(<a class="ui-menu__item" …>)마다 aria-current 값 */
const currentMarks = (html: string) =>
  [...html.matchAll(/<a class="ui-menu__item"([^>]*)>/g)].map((m) => {
    const attrs = m[1] ?? "";
    return {
      screen: /data-screen="([^"]+)"/.exec(attrs)?.[1],
      current: /aria-current="([^"]+)"/.exec(attrs)?.[1] ?? null,
    };
  });

const owner = (screen: string, back?: string) =>
  renderToString(
    <OwnerLayout screen={screen} title="주문" shopName="달빛케이크" todoCount={3} {...(back ? { back } : {})}>
      <p>본문</p>
    </OwnerLayout>,
  );

describe("사장님·운영자 레이아웃", () => {
  it("사장님 메뉴: 1280 왼쪽 메뉴(nav '사장님 메뉴')와 메뉴 머리, 항목 7개가 07 경로 링크", () => {
    const html = owner("SCR-020");
    expect(html).toMatch(/<nav class="ui-layout__side ui-menu" aria-label="사장님 메뉴">/);
    expect(html).toContain("Siljang 사장님");
    expect(html).toContain("달빛케이크");
    for (const m of OWNER_MENU) expect(html).toContain(`href="${m.path}"`);
    expect(html).not.toContain("로그아웃");
  });

  it("1뎁스 화면 자체는 aria-current=page, 다른 항목은 없음", () => {
    const marks = currentMarks(owner("SCR-020")).slice(0, 7);
    expect(marks.filter((m) => m.current !== null)).toEqual([{ screen: "SCR-020", current: "page" }]);
  });

  it("하위 화면에서는 속한 1뎁스를 aria-current=true로 표시(지금 페이지가 아님)", () => {
    const marks = currentMarks(owner("SCR-022", "/owner/orders/K7Q3M9")).slice(0, 7);
    expect(marks.filter((m) => m.current !== null)).toEqual([{ screen: "SCR-020", current: "true" }]);
  });

  it("메뉴 항목 화면: 위쪽 막대의 첫 버튼은 '메뉴 열기'(aria-expanded·aria-controls가 360 열린 메뉴 dialog를 가리킴)", () => {
    const html = owner("SCR-016");
    const button = /<button[^>]*aria-label="메뉴 열기"[^>]*>/.exec(html)?.[0] ?? "";
    expect(button).toContain('aria-expanded="false"');
    expect(button).toContain('aria-haspopup="dialog"');
    const controls = /aria-controls="([^"]+)"/.exec(button)?.[1];
    expect(controls).toBeDefined();
    expect(html).toContain(`<dialog id="${controls}" class="ui-sheet" aria-label="사장님 메뉴"`);
    expect(html).not.toContain('aria-label="뒤로"');
    expect(html).toContain('<h1 class="ui-layout__title">주문</h1>');
  });

  it("하위 화면: 첫 버튼은 '뒤로' 링크(07 상위 화면 주소)이고 '메뉴 열기'와 열린 메뉴가 없음", () => {
    const html = owner("SCR-021", "/owner/orders");
    expect(html).toMatch(/<a class="ui-layout__lead" href="\/owner\/orders" aria-label="뒤로">/);
    expect(html).not.toContain("메뉴 열기");
    expect(html).not.toContain("<dialog");
  });

  it("하위 화면인데 '뒤로' 목적지가 없으면 오류(화면 작업의 잘못)", () => {
    expect(() => owner("SCR-021")).toThrow(/back/);
  });

  it("'할 일' 옆 수는 화면 읽기에서 'N건'으로, 0이면 없음", () => {
    // 보이는 것은 '3', 접근성 이름은 '할 일 3건'(태그 사이에 띄어쓰기가 없음)
    expect(owner("SCR-016")).toContain(
      '<span>할 일</span><span class="ui-menu__count"><span class="ui-sr-only"> </span>3<span class="ui-sr-only">건</span></span>',
    );
    const none = renderToString(
      <OwnerLayout screen="SCR-016" title="할 일" shopName="달빛케이크" todoCount={0}>
        <p>본문</p>
      </OwnerLayout>,
    );
    expect(none).not.toContain("ui-menu__count");
  });

  it("운영자 메뉴: nav '운영자 메뉴', 항목 2개, 메뉴 아래 '로그아웃', 운영자 이름", () => {
    const html = renderToString(
      <OperatorLayout screen="SCR-047" title="영업 신고 확인" operatorName="운영자 한빛" onLogout={noop}>
        <p>본문</p>
      </OperatorLayout>,
    );
    expect(html).toContain('aria-label="운영자 메뉴"');
    expect(html).toContain("Siljang 운영자");
    expect(html).toContain("운영자 한빛");
    expect(html).toMatch(/<button type="button" class="ui-menu__logout">로그아웃<\/button>/);
    for (const m of OPERATOR_MENU) expect(html).toContain(`href="${m.path}"`);
    expect(currentMarks(html).slice(0, 2)).toEqual([
      { screen: "SCR-047", current: "page" },
      { screen: "SCR-049", current: null },
    ]);
  });

  it("가게 기록 보기(SCR-050)는 '영업 신고 확인'을 표시하고 '뒤로'", () => {
    const html = renderToString(
      <OperatorLayout
        screen="SCR-050"
        title="가게 기록 보기"
        operatorName="운영자 한빛"
        onLogout={noop}
        back="/operator/shops/S1"
      >
        <p>본문</p>
      </OperatorLayout>,
    );
    expect(currentMarks(html).slice(0, 2)).toEqual([
      { screen: "SCR-047", current: "true" },
      { screen: "SCR-049", current: null },
    ]);
    expect(html).toContain('aria-label="뒤로"');
  });

  it("다른 메뉴의 화면을 주면 오류", () => {
    expect(() =>
      renderToString(
        <OperatorLayout screen="SCR-016" title="x" operatorName="운영자" onLogout={noop}>
          <p />
        </OperatorLayout>,
      ),
    ).toThrow();
  });

  it("메뉴 없는 화면: 가게 등록 전(SCR-015)과 로그인(SCR-014·046)에는 nav·메뉴 버튼이 없다", () => {
    const setup = renderToString(
      <SetupLayout title="가게 등록">
        <p>본문</p>
      </SetupLayout>,
    );
    const login = renderToString(
      <LoginLayout title="운영자 로그인">
        <p>본문</p>
      </LoginLayout>,
    );
    for (const html of [setup, login]) {
      expect(html).not.toContain("<nav");
      expect(html).not.toContain("메뉴 열기");
      expect(html).not.toContain("<dialog");
    }
    expect(setup).toContain("Siljang 사장님");
    expect(text(login)).toContain("Siljang 운영자 로그인");
  });

  it("PageSection: 제목이 있으면 h2", () => {
    const html = renderToString(
      <PageSection title="결제 확인">
        <p>x</p>
      </PageSection>,
    );
    expect(html).toContain('<section class="ui-section"><h2 class="ui-section__title">결제 확인</h2>');
  });
});

interface Order {
  readonly id: string;
  readonly code: string;
  readonly customer: string;
  readonly pickup: string;
  readonly status: string;
  readonly amount: string;
}

const ORDERS: readonly Order[] = [
  { id: "o1", code: "K7Q3M9", customer: "김하늘", pickup: "11월 20일 14:00", status: "제작 중", amount: "56,000원" },
  { id: "o2", code: "P2X8L4", customer: "이도윤", pickup: "11월 21일 11:00", status: "결제 대기", amount: "42,000원" },
];

const COLUMNS: readonly ListColumn<Order>[] = [
  { label: "주문 번호", cell: (o) => o.code, card: "title", width: "narrow" },
  { label: "손님", cell: (o) => o.customer, card: "meta" },
  { label: "픽업", cell: (o) => o.pickup, card: "meta" },
  { label: "상태", cell: (o) => o.status, card: "tag" },
  { label: "금액", cell: (o) => o.amount, card: "foot" },
];

const list = (rows: readonly Order[] = ORDERS) =>
  renderToString(
    <ListView
      label="주문 목록"
      columns={COLUMNS}
      rows={rows}
      rowKey={(o) => o.id}
      href={(o) => `/owner/orders/${o.code}`}
      empty="아직 주문이 없어요"
    />,
  );

describe("목록 부품(1280 표, 360 카드)", () => {
  it("열 정의 하나로 표와 카드를 함께 그림(표 caption과 카드 목록의 이름이 같음)", () => {
    const html = list();
    expect(html).toContain('<table class="ui-list__table"><caption class="ui-sr-only">주문 목록</caption>');
    expect(html).toContain('<ul class="ui-list__cards" aria-label="주문 목록">');
    for (const c of COLUMNS) expect(html).toContain(`<th scope="col">${c.label}</th>`);
  });

  it("표는 제목 열이 링크 셀, 카드는 제목이 링크(같은 상세 주소)", () => {
    const html = list();
    expect(html).toMatch(
      /<td class="ui-list__linkcell"><a class="ui-list__link" href="\/owner\/orders\/K7Q3M9">K7Q3M9<\/a><\/td>/,
    );
    expect(html).toMatch(
      /<span class="ui-list__cardtitle"><a class="ui-list__link ui-list__link--strong" href="\/owner\/orders\/K7Q3M9">K7Q3M9<\/a><\/span>/,
    );
    expect([...html.matchAll(/href="\/owner\/orders\//g)]).toHaveLength(4);
  });

  it("카드: 상태는 제목 옆 라벨, 손님·픽업은 '열 이름 값' 줄, 금액은 아래 줄", () => {
    const html = list();
    expect(html).toContain('<span class="ui-list__tags"><span>제작 중</span></span>');
    expect(html).toContain("<dt>손님</dt><dd>김하늘</dd>");
    expect(html).toContain("<dt>픽업</dt><dd>11월 20일 14:00</dd>");
    expect(html).toContain('<div class="ui-list__foot"><span>56,000원</span></div>');
  });

  it("열 너비는 토큰 클래스(narrow = size.thumb)", () => {
    expect(list()).toContain('<col class="ui-list__col--narrow"/>');
  });

  it("빈 목록은 EmptyState(08 empty 글), 표·카드 없음", () => {
    const html = list([]);
    expect(html).toContain('class="ui-empty"');
    expect(html).toContain("아직 주문이 없어요");
    expect(html).not.toContain("<table");
  });

  it("제목 열이 없거나 둘이면 오류", () => {
    const render = (columns: readonly ListColumn<Order>[]) =>
      renderToString(
        <ListView label="x" columns={columns} rows={ORDERS} rowKey={(o) => o.id} href={() => "/"} empty="없음" />,
      );
    expect(() => render(COLUMNS.filter((c) => c.card !== "title"))).toThrow();
    expect(() => render([...COLUMNS, { label: "둘째", cell: (o) => o.id, card: "title" }])).toThrow();
  });
});
