// 같은 평가 코드를 Node 22에서 실행할 한 파일로 만든다. 생성물은 저장소에 넣지 않는다.
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(new URL("../../app/package.json", import.meta.url));
const { build } = await import(pathToFileURL(require.resolve("esbuild")).href);
if (!process.argv[2]) throw new TypeError("output path required");
await build({
  entryPoints: [`${repo}app/server/eval/cli.ts`],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: process.argv[2],
  banner: {
    js: 'import { createRequire as nativeCreateRequire } from "node:module"; const require = nativeCreateRequire(import.meta.url);',
  },
});
