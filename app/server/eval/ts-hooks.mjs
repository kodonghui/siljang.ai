import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, next) {
  const parent = context.parentURL ?? "";
  if (/^\.\.?\//.test(specifier) && parent.endsWith(".ts") && !/\.[cm]?[jt]s$/.test(specifier)) {
    const url = new URL(`${specifier}.ts`, parent);
    if (existsSync(fileURLToPath(url))) return next(url.href, context);
  }
  return next(specifier, context);
}
