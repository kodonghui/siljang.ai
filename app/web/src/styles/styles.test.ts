// 스타일이 09 토큰만 쓰는지(TASK-029). 새 색·크기·간격 값을 만들지 않고, 생성 파일은 손으로 고치지 않는다.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WEB = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, WEB), "utf8");

/** 손으로 쓴 CSS(생성 파일 tokens.css 밖) */
const HAND_CSS = [
  "src/styles/base.css",
  "src/styles/parts.css",
  "src/styles/layout.css",
  "src/samples/samples.css",
  "src/price-list.css",
  "src/price-list-history.css",
];

const tokens = read("src/styles/tokens.css");
const defined = new Set([...tokens.matchAll(/^\s+(--[a-z0-9-]+):/gm)].map((m) => m[1]));

/** 주석을 뺀 CSS */
const uncomment = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** 09 토큰의 px 값(예: size.menu → 220) */
const tokenPx = (path: string): number => {
  let node: unknown = JSON.parse(readFileSync(new URL("../../design/base.tokens.json", WEB), "utf8"));
  for (const key of path.split(".")) node = (node as Record<string, unknown>)[key];
  const value = (node as { $value?: { value?: unknown; unit?: unknown } }).$value;
  if (typeof value?.value !== "number" || value.unit !== "px") throw new Error(`${path}: px 토큰이 아님`);
  return value.value;
};

/**
 * 넓고 좁음을 가르는 너비(TASK-182): 왼쪽 메뉴(size.menu)와 09의 가운데 열(size.content)이 다 들어가는 너비.
 * CSS의 @media 조건에는 var()를 쓸 수 없어 손으로 쓴 CSS가 숫자로 적는 유일한 값이다.
 */
const BREAKPOINT = tokenPx("size.menu") + tokenPx("size.content");
const MEDIA = /@media\s*\(min-width:\s*(\d+)px\)/g;

describe("09 토큰(design/base.tokens.json → src/styles/tokens.css)", () => {
  it("생성기로 다시 만든 것과 지금 파일이 같다(손으로 고치지 않음)", () => {
    const script = fileURLToPath(new URL("scripts/gen-tokens.mjs", WEB));
    expect(() => execFileSync(process.execPath, [script, "--check"], { stdio: "pipe" })).not.toThrow();
  });

  it("09의 기본 토큰 55개와 카카오 공식 규격 3개가 모두 변수이고 밝은 화면 하나다", () => {
    const source = JSON.parse(readFileSync(new URL("../../design/base.tokens.json", WEB), "utf8")) as object;
    let count = 0;
    const walk = (node: object) => {
      for (const [key, value] of Object.entries(node)) {
        if (key.startsWith("$") || typeof value !== "object" || value === null) continue;
        if ("$value" in value) count++;
        else walk(value);
      }
    };
    walk(source);
    expect(count).toBe(55);
    const base = count;
    walk(JSON.parse(read("src/styles/kakao.tokens.json")));
    expect(count - base).toBe(3);
    expect(defined.size).toBe(58);
    expect(defined.has("--provider-kakao-container")).toBe(true);
    expect(defined.has("--provider-kakao-label")).toBe(true);
    expect(defined.has("--provider-kakao-radius")).toBe(true);
    expect(tokens).not.toContain("prefers-color-scheme");
  });
});

describe("손으로 쓴 CSS", () => {
  it.each(HAND_CSS)("%s: 숫자 크기·색 값을 직접 쓰지 않는다(토큰 변수만, @media 너비만 예외)", (path) => {
    const css = uncomment(read(path)).replace(MEDIA, "@media (min-width: BREAKPOINT)");
    const raw = [
      ...css.matchAll(/(?<![\w-])\d*\.?\d+(px|rem|em|pt|vh|vw|vmin|vmax|ch|ms|s)\b/g),
      ...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g),
      ...css.matchAll(/\b(rgba?|hsla?|oklch|lab|lch|color-mix)\(/g),
      ...css.matchAll(/:\s*(white|black|red|gray|grey|blue|green)\b/g),
    ].map((m) => m[0]);
    expect(raw).toEqual([]);
  });

  it.each(HAND_CSS)("%s: 쓰는 변수는 토큰이거나 그 파일이 둔 것", (path) => {
    const css = uncomment(read(path));
    const local = new Set(
      [...(css + uncomment(read("src/styles/layout.css"))).matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]),
    );
    const used = [...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1] ?? "");
    const unknown = used.filter((name) => !defined.has(name) && !local.has(name));
    expect(unknown).toEqual([]);
    expect(used.length).toBeGreaterThan(0);
  });

  it(`@media 너비는 size.menu + size.content(${BREAKPOINT}px) 하나뿐이다`, () => {
    const widths = HAND_CSS.flatMap((path) => [...uncomment(read(path)).matchAll(MEDIA)].map((m) => Number(m[1])));
    expect(widths.length).toBeGreaterThan(0);
    expect(new Set(widths)).toEqual(new Set([BREAKPOINT]));
    const other = HAND_CSS.flatMap((path) =>
      [...uncomment(read(path)).matchAll(/@media[^{]*/g)]
        .map((m) => m[0].trim())
        .filter((q) => !/^@media\s*\(min-width:\s*\d+px\)$/.test(q)),
    );
    expect(other).toEqual([]);
  });

  it("한국어 줄바꿈(keep-all·break-word)을 바탕에 둔다(page-check가 없으면 오류로 봄)", () => {
    const base = uncomment(read("src/styles/base.css"));
    expect(base).toMatch(/word-break:\s*keep-all/);
    expect(base).toMatch(/overflow-wrap:\s*break-word/);
  });
});

describe("부품 코드", () => {
  const files = (dir: string) =>
    readdirSync(new URL(dir, WEB))
      .filter((n) => n.endsWith(".tsx") && !n.endsWith(".test.tsx"))
      .map((n) => `${dir}${n}`);

  it.each([...files("src/ui/"), ...files("src/samples/")])(
    "%s: 인라인 style을 쓰지 않는다(값은 CSS 토큰으로)",
    (path) => {
      expect(read(path)).not.toMatch(/\bstyle=\{/);
    },
  );
});
