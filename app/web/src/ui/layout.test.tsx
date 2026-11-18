// 사장님·운영자 화면 레이아웃(TASK-182)의 메뉴·1뎁스 표를 07·08과 견주고, 레이아웃·목록 부품의 표시를 본다(renderToString).
// 브라우저에서 누르는 것(360 메뉴 열기·닫기 포커스, Esc, 항목 누르면 닫힘)과 너비마다 보이는 쪽은 scripts/page-check.mjs가 본다.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
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
