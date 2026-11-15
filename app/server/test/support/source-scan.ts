import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * 서버 코드(src/)의 글자 값을 꺼내는 작은 읽개(정적 시험용, TASK-019). 주석과 정규식 글을 건너뛰고,
 * 템플릿 글의 ${…}는 ' __expr__ '로 바꾼다(끼워 넣은 값은 정적으로 알 수 없음). 끼워 넣은 식 안의 글자 값도 꺼낸다.
 */
export const EXPR = " __expr__ ";

export interface SourceFile {
  /** src/ 아래 경로(예: shop-scope.ts). */
  readonly name: string;
  readonly text: string;
}

/** src/ 아래의 .ts 파일(생성한 형식 파일 .d.ts는 뺌). */
export function serverSources(srcDir: URL): SourceFile[] {
  const root = srcDir.pathname;
  const out: SourceFile[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        out.push({ name: relative(root, path), text: readFileSync(path, "utf8") });
      }
    }
  };
  walk(root);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const REGEX_BEFORE = /[(,=:[!&|?{};+\-*%<>~^]/;
const REGEX_WORDS = new Set([
  "return",
  "typeof",
  "case",
  "in",
  "of",
  "delete",
  "void",
  "throw",
  "new",
  "yield",
  "await",
]);

export function stringLiterals(source: string): string[] {
  const out: string[] = [];
  scan(source, 0, false, out);
  return out;
}

/** source[start…]을 읽는다. inExpr이면 짝 맞는 }에서 멈추고 그 다음 자리를 돌려준다. */
function scan(source: string, start: number, inExpr: boolean, out: string[]): number {
  let i = start;
  let prev = "";
  let word = "";
  let braces = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i] as string;
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? n : end;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let text = "";
      while (j < n && source[j] !== ch) {
        if (source[j] === "\\") {
          text += source.slice(j, j + 2);
          j += 2;
          continue;
        }
        text += source[j];
        j += 1;
      }
      out.push(text);
      i = j + 1;
      prev = ch;
      word = "";
      continue;
    }
    if (ch === "`") {
      i = template(source, i + 1, out);
      prev = "`";
      word = "";
      continue;
    }
    if (ch === "/" && (prev === "" || REGEX_BEFORE.test(prev) || REGEX_WORDS.has(word))) {
      let j = i + 1;
      let inClass = false;
      while (j < n) {
        const c = source[j];
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) break;
        else if (c === "\n") break;
        j += 1;
      }
      j += 1;
      while (j < n && /[a-z]/i.test(source[j] as string)) j += 1;
      i = j;
      prev = "/";
      word = "";
      continue;
    }
    if (inExpr) {
      if (ch === "{") braces += 1;
      if (ch === "}") {
        if (braces === 0) return i + 1;
        braces -= 1;
      }
    }
    if (/[A-Za-z0-9_$]/.test(ch)) {
      word = /[A-Za-z0-9_$]/.test(prev) ? word + ch : ch;
      prev = ch;
    } else if (!/\s/.test(ch)) {
      prev = ch;
      word = "";
    }
    i += 1;
  }
  return n;
}

/** 템플릿 글을 읽어 out에 넣고 닫는 ` 다음 자리를 돌려준다. */
function template(source: string, start: number, out: string[]): number {
  let i = start;
  let text = "";
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    if (ch === "\\") {
      text += source.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === "`") {
      out.push(text);
      return i + 1;
    }
    if (ch === "$" && source[i + 1] === "{") {
      text += EXPR;
      i = scan(source, i + 2, true, out);
      continue;
    }
    text += ch;
    i += 1;
  }
  out.push(text);
  return n;
}
