// 09단계 디자인 토큰(design/base.tokens.json, 2026-11-13 고정)을 CSS 변수로 바꾼다.
// 만든 파일 src/styles/tokens.css는 손으로 고치지 않는다(이 스크립트로만 다시 만든다).
//
// 사용(app/web에서):
//   node scripts/gen-tokens.mjs           다시 만들어 씀
//   node scripts/gen-tokens.mjs --check   다시 만든 것이 지금 파일과 같은지만 봄(다르면 종료 코드 1). 시험이 부름
//
// 이름은 토큰 경로를 '-'로 이은 것(color.paper → --color-paper, 09 목업의 css_vars.py와 같은 이름).
// 모르는 종류·단위나 hex와 components가 다른 색은 만들지 않고 멈춘다.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SOURCE = new URL("../../../design/base.tokens.json", import.meta.url);
const TARGET = new URL("../src/styles/tokens.css", import.meta.url);

function* walk(node, path) {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("$")) continue;
    const here = [...path, key];
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`토큰이 아닌 값: ${here.join(".")}`);
    }
    if ("$value" in value) yield [here, value];
    else yield* walk(value, here);
  }
}

const hex2 = (n) => n.toString(16).toUpperCase().padStart(2, "0");

function color(name, v) {
  if (v === null || typeof v !== "object" || v.colorSpace !== "srgb" || !Array.isArray(v.components)) {
    throw new Error(`${name}: srgb 색이 아님`);
  }
  if (v.components.length !== 3 || v.components.some((c) => typeof c !== "number" || c < 0 || c > 1)) {
    throw new Error(`${name}: components가 0~1 숫자 셋이 아님`);
  }
  const rgb = v.components.map((c) => Math.round(c * 255));
  const hex = `#${rgb.map(hex2).join("")}`;
  if (typeof v.hex === "string" && v.hex.toUpperCase() !== hex) {
    throw new Error(`${name}: hex ${v.hex}와 components(${hex})가 다름`);
  }
  const alpha = v.alpha ?? 1;
  if (typeof alpha !== "number" || alpha < 0 || alpha > 1) throw new Error(`${name}: alpha가 0~1이 아님`);
  return alpha === 1 ? hex : `rgba(${rgb.join(", ")}, ${alpha})`;
}

function cssValue(name, token) {
  const type = token.$type;
  const v = token.$value;
  switch (type) {
    case "color":
      return color(name, v);
    case "dimension":
      if (typeof v?.value !== "number" || v.unit !== "px") throw new Error(`${name}: px 크기가 아님`);
      return `${v.value}${v.unit}`;
    case "fontFamily":
      if (!Array.isArray(v) || v.length === 0 || v.some((f) => typeof f !== "string" || f === "")) {
        throw new Error(`${name}: 글꼴 이름 목록이 아님`);
      }
      return v.map((f) => (/^[A-Za-z-]+$/.test(f) ? f : `"${f}"`)).join(", ");
    case "fontWeight":
    case "number":
      if (typeof v !== "number") throw new Error(`${name}: 숫자가 아님`);
      return String(v);
    default:
      throw new Error(`${name}: 모르는 종류 ${type}`);
  }
}

export function tokensToCss(tokens) {
  const lines = [];
  for (const [path, token] of walk(tokens, [])) {
    lines.push(`  --${path.join("-")}: ${cssValue(path.join("."), token)};`);
  }
  return [
    "/* 생성 파일: design/base.tokens.json(09단계, 2026-11-13 고정)에서 scripts/gen-tokens.mjs가 만듦. 손으로 고치지 않음 */",
    ":root {",
    ...lines,
    "}",
    "",
  ].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const css = tokensToCss(JSON.parse(readFileSync(SOURCE, "utf8")));
  if (process.argv.includes("--check")) {
    let now = null;
    try {
      now = readFileSync(TARGET, "utf8");
    } catch {
      // 파일이 없으면 다르다고 봄
    }
    if (now !== css) {
      console.error(
        "src/styles/tokens.css가 design/base.tokens.json에서 다시 만든 것과 다릅니다. npm run tokens -w web",
      );
      process.exit(1);
    }
    console.log(`tokens.css 같음(변수 ${css.split("\n").filter((l) => l.startsWith("  --")).length}개)`);
  } else {
    writeFileSync(TARGET, css);
    console.log(`tokens.css 씀(변수 ${css.split("\n").filter((l) => l.startsWith("  --")).length}개)`);
  }
}
