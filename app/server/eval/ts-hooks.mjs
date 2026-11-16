// 서버 코드는 확장자 없이 가져온다(moduleResolution Bundler). Node는 확장자가 있어야 해서, .ts 파일이 상대 경로로
// 가져오는 이름에 확장자가 없고 같은 이름의 .ts 파일이 있으면 그 파일로 이어 준다. 그 밖의 가져오기는 그대로 둔다.
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
