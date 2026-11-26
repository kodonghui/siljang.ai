import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { assertConversationSource, renderConversationFrame } from "./build-kakao-consultation.mjs";
import { fixtureRepository, publishFixture } from "./fixture-source.mjs";

const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
export function assertConsentWithdrawalSource(root, expected) {
  assertConversationSource(root, expected);
  const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", "docs/08-screens/SCR-013.md"], { cwd: root, encoding: "utf8" }).trim();
  if (dirty) throw new Error("CONSENT_WITHDRAWAL_SOURCE_CHANGED: commit SCR013 before generation");
}
/** 저장된 값의 표시 함수만 실행한다. 실제 업무와 발신은 호출하지 않는다. */
export async function buildKakaoConsentWithdrawal(repositoryRoot = ".", destination = join(tmpdir(), "siljang-qa149-consent-withdrawal")) {
  const root = fixtureRepository(import.meta.url, repositoryRoot).replaceAll("\\", "/");
  return publishFixture(root, resolve(destination), async ({ out, source }) => {
    assertConsentWithdrawalSource(root, source);
    const require = createRequire(join(root, "app/package.json"));
    const { build } = require("esbuild");
    const entry = join(out, "fixture-source.ts"), bundle = join(out, "responses.cjs");
    await fs.writeFile(entry, `import {consentWithdrawalSamples,consentWithdrawalResponseCases} from ${JSON.stringify(root + "/app/server/test/support/kakao-consent-withdrawal-cases")};export async function data(){return {states:consentWithdrawalSamples(),responses:await consentWithdrawalResponseCases()};}`);
    await build({ entryPoints: [entry], outfile: bundle, bundle: true, platform: "node", format: "cjs", packages: "external", banner: { js: `var require = require("node:module").createRequire(${JSON.stringify(join(root, "app/package.json"))});` }, logLevel: "silent" });
    const data = await require(bundle).data();
    const screen = await fs.readFile(join(root, "docs/08-screens/SCR-013.md"), "utf8");
    const expected = [...screen.matchAll(/^\| SCR-013#([a-z-]+) \|/gm)].map((m) => m[1]).sort();
    if (data.responses.length !== 29 || JSON.stringify(data.states.map((s) => s.state).sort()) !== JSON.stringify(expected)) throw new Error("consent withdrawal screen contract changed");
    const tokens = await fs.readFile(join(root, "app/web/src/styles/tokens.css"), "utf8");
    const frames = [], responseFrames = [];
    const render = (row, width) => renderConversationFrame({ ...row, userText: "사진 게시 동의를 철회할게요" }, width, tokens, "사진 게시 동의 철회 카드");
    for (const row of data.states) for (const width of [360, 1280]) {
      const file = `${row.state}-${width}.html`;
      await fs.writeFile(join(out, file), render(row, width)); frames.push({ state: row.state, width, file });
    }
    for (const [i, row] of data.responses.entries()) if (row.display === "skill") for (const width of [360, 1280]) {
      const file = `response-${i}-${width}.html`;
      await fs.writeFile(join(out, file), render(row, width)); responseFrames.push({ response: row.response, state: row.state, width, file });
    }
    await fs.writeFile(join(out, "responses.json"), JSON.stringify(data.responses, null, 2) + "\n");
    await fs.writeFile(join(out, "index.html"), `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>사진 게시 동의 철회 합성 자료</title><h1>사진 게시 동의 철회 합성 자료</h1><p>실제 카카오 수신·화면 확인 결과가 아닙니다. 업무 액션과 발신은 실행하지 않습니다.</p><ul>${frames.map((f) => `<li><a href="${f.file}">${escape(f.state)} · ${f.width}</a></li>`).join("")}</ul><h2>응답별 자료</h2><ul>${data.responses.map((r) => `<li>${escape(r.response)} · ${r.display === "skill" ? responseFrames.filter((f) => f.response === r.response).map((f) => `<a href="${f.file}">${f.width}</a>`).join(" ") : r.display === "kakao-client" ? "카카오 자체 오류 · 실제 확인 남음" : "이 카드에는 나오지 않음"}</li>`).join("")}</ul></html>`);
    const metadata = { source, screen: "SCR-013", responseRows: data.responses.length, frames, responseFrames, realBrowser: false, realKakao: false, sdkOnly: true };
    await fs.writeFile(join(out, "manifest.json"), JSON.stringify(metadata, null, 2) + "\n");
    await fs.rm(entry); await fs.rm(bundle);
    assertConsentWithdrawalSource(root, source);
    return metadata;
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await buildKakaoConsentWithdrawal(process.argv[2], process.argv[3]), null, 2));
