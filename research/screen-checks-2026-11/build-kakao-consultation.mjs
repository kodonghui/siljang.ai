import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { fixtureRepository, publishFixture } from "./fixture-source.mjs";

const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
export function assertConversationSource(root, expected) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (git("rev-parse", "HEAD") !== expected || git("status", "--porcelain", "--untracked-files=all", "--", "app/server", "docs/08-screens/SCR-003.md") !== "") throw new Error("CONVERSATION_SOURCE_CHANGED: commit server and screen inputs before generation");
}

/** 합성 자료를 실제 서버 응답에서 그리는 정적 프레임. 카카오 서비스나 업무 액션을 호출하지 않는다. */
export function renderConversationFrame(sample, width, tokens) {
  if (![360, 1280].includes(width) || !/^[a-z-]+$/.test(sample.state)) throw new Error("invalid conversation frame");
  if (/<\/style|@import|url\(/i.test(tokens)) throw new Error("unexpected token resource");
  const body = sample.body;
  const outputs = body?.useCallback === true ? [{ simpleText: { text: body.data.text } }] : body?.template?.outputs;
  if (!Array.isArray(outputs) || outputs.length > 3) throw new Error("invalid conversation outputs");
  const bubbles = outputs.map((output) => {
    if (typeof output.simpleText?.text === "string") return `<div class="bubble shop">${escape(output.simpleText.text)}</div>`;
    const card = output.textCard;
    if (!card || typeof card.title !== "string" || typeof card.description !== "string" || !Array.isArray(card.buttons)) throw new Error("unsupported conversation output");
    return `<section class="card"><h2>${escape(card.title)}</h2><p>${escape(card.description)}</p><div class="buttons">${card.buttons.map((button) => `<button type="button">${escape(button.label)}</button>`).join("")}</div></section>`;
  }).join("");
  const quick = body?.template?.quickReplies ?? [];
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'none'"><title>가게 채널 상담</title><style>${tokens}
*{box-sizing:border-box}body{margin:0;background:var(--color-surface-sunken);color:var(--color-ink);font-family:var(--font-family-base);font-size:var(--font-size-body);line-height:var(--font-line-height-body)}.window{width:100%;max-width:480px;min-height:800px;margin:auto;background:var(--color-paper);display:flex;flex-direction:column}header{min-height:var(--size-bar);padding:var(--space-md) var(--space-lg);background:var(--color-surface);border-bottom:1px solid var(--color-line);font-size:var(--font-size-title);font-weight:var(--font-weight-semibold)}main{padding:var(--space-lg);display:flex;flex-direction:column;gap:var(--space-md);flex:1}.bubble{max-width:82%;padding:var(--space-sm) var(--space-md);border-radius:var(--radius-lg);white-space:pre-wrap;overflow-wrap:anywhere;word-break:keep-all}.shop,.card{align-self:flex-start;background:var(--color-surface);border:1px solid var(--color-line)}.customer{align-self:flex-end;background:var(--color-accent-soft)}.card{width:100%;border-radius:var(--radius-lg);padding:var(--space-md);overflow-wrap:anywhere}.card h2{font-size:var(--font-size-title);margin:0 0 var(--space-sm)}.card p{white-space:pre-wrap;margin:0 0 var(--space-md)}.buttons,.quick{display:flex;flex-wrap:wrap;gap:var(--space-xs)}.quick{justify-content:flex-end}button{min-height:var(--size-target);padding:var(--space-sm) var(--space-md);border:1px solid var(--color-accent);border-radius:var(--radius-md);background:var(--color-surface);color:var(--color-accent);font:inherit;font-size:var(--font-size-small)}footer{padding:var(--space-sm) var(--space-lg);display:flex;gap:var(--space-sm);background:var(--color-surface);border-top:1px solid var(--color-line)}input{min-width:0;flex:1;height:var(--size-control);border:1px solid var(--color-line-control);border-radius:var(--radius-md);font:inherit;padding:var(--space-sm)}footer button{background:var(--color-accent);color:var(--color-on-accent)}
</style></head><body data-state="${escape(sample.state)}" data-width="${width}"><div class="window"><header>합성 케이크 가게</header><main aria-label="가게 대화"><div class="bubble customer">${escape(sample.userText ?? "11월 20일에 케이크 주문하고 싶어요")}</div>${bubbles}${quick.length ? `<div class="quick">${quick.map((reply) => `<button type="button">${escape(reply.label)}</button>`).join("")}</div>` : ""}</main><footer><input aria-label="메시지 입력" readonly><button type="button">전송</button></footer></div></body></html>`;
}

export async function buildKakaoConversation(repositoryRoot = ".", destination = join(tmpdir(), "siljang-qa085-conversation")) {
  const root = fixtureRepository(import.meta.url, repositoryRoot).replaceAll("\\", "/");
  return publishFixture(root, resolve(destination), async ({ out, source }) => {
    assertConversationSource(root, source);
    const require = createRequire(join(root, "app/package.json"));
    const { build } = require("esbuild");
    const entry = join(out, "fixture-source.ts"), bundle = join(out, "responses.cjs");
    await fs.writeFile(entry, `import {kakaoConsultationMessage,kakaoQuoteMessage} from ${JSON.stringify(root + "/app/server/src/kakao-consultation-message")};import {consultationResponseCases} from ${JSON.stringify(root + "/app/server/test/support/kakao-consultation-cases")};
export async function data(){const quote=kakaoQuoteMessage({amount:35000,amountMax:null,displayKind:'fixed',validUntil:'2026-11-28T06:00:00Z'},'Asia/Seoul');const text=quote.template.outputs[0].simpleText.text;const views=[
{state:'normal',contents:['AI가 상담해요. 처리방침: https://privacy.example/policy',text],suggestedDays:['2026-11-19','2026-11-21']},{state:'loading'},{state:'empty'},{state:'error',reason:'photo_download_failed'},{state:'permission',contactPhone:'02-000-0000'},{state:'stale',contents:['가격표가 바뀌어 지금 금액은 38,000원이에요. 이 금액으로 주문할까요?']},{state:'handed-over',recommendChannel:true},{state:'fixed-answer'},{state:'rate-limited'},{state:'link-test',mode:'initial',next:'card',blockId:'synthetic-confirm'}];return {states:views.map(view=>({state:view.state,body:kakaoConsultationMessage(view)})),responses:await consultationResponseCases()};}`);
    await build({ entryPoints: [entry], outfile: bundle, bundle: true, platform: "node", format: "cjs", packages: "external", banner: { js: `var require = require("node:module").createRequire(${JSON.stringify(join(root, "app/package.json"))});` }, logLevel: "silent" });
    const data = await require(bundle).data();
    const screen = await fs.readFile(join(root, "docs/08-screens/SCR-003.md"), "utf8");
    const expectedStates = [...screen.matchAll(/^\| SCR-003#([a-z-]+) \|/gm)].map((match) => match[1]).sort();
    if (data.responses.length !== 29 || JSON.stringify(data.states.map((row) => row.state).sort()) !== JSON.stringify(expectedStates)) throw new Error("conversation contract changed");
    const tokens = await fs.readFile(join(root, "app/web/src/styles/tokens.css"), "utf8");
    const frames = [];
    for (const row of data.states) for (const width of [360, 1280]) {
      const file = `${row.state}-${width}.html`;
      await fs.writeFile(join(out, file), renderConversationFrame(row, width, tokens));
      frames.push({ state: row.state, width, file });
    }
    const responseFrames = [];
    for (const [index, row] of data.responses.entries()) {
      if (row.display !== "skill") continue;
      for (const width of [360, 1280]) {
        const file = `response-${index}-${width}.html`;
        await fs.writeFile(join(out, file), renderConversationFrame(row, width, tokens));
        responseFrames.push({ response: row.response, state: row.state, width, file });
      }
    }
    await fs.writeFile(join(out, "responses.json"), JSON.stringify(data.responses, null, 2) + "\n");
    await fs.writeFile(join(out, "index.html"), `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>상담 합성 표시 자료</title><h1>상담 합성 표시 자료</h1><p>실제 카카오 수신·화면 확인 결과가 아닙니다. 업무 액션과 발신은 실행하지 않습니다.</p><ul>${frames.map((frame) => `<li><a href="${frame.file}">${escape(frame.state)} · ${frame.width}</a></li>`).join("")}</ul><h2>응답별 자료</h2><ul>${data.responses.map((row) => `<li>${escape(row.response)} · ${row.display === "skill" ? responseFrames.filter((frame) => frame.response === row.response).map((frame) => `<a href="${frame.file}">${frame.width}</a>`).join(" ") : row.display === "kakao-client" ? "카카오 자체 오류 · 실제 확인 남음" : "이 상담에는 나오지 않음"}</li>`).join("")}</ul></html>`);
    const metadata = { source, screen: "SCR-003", responseRows: data.responses.length, frames, responseFrames, realBrowser: false, realKakao: false, sdkOnly: true };
    await fs.writeFile(join(out, "manifest.json"), JSON.stringify(metadata, null, 2) + "\n");
    await fs.rm(entry); await fs.rm(bundle);
    assertConversationSource(root, source);
    return metadata;
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await buildKakaoConversation(process.argv[2], process.argv[3]), null, 2));
