import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

import { assertFixtureSource, fixtureRepository, publishFixture } from "./fixture-source.mjs";
export async function buildConsultationMessages(repositoryRoot, destination) {
  const root = fixtureRepository(import.meta.url, repositoryRoot).replaceAll("\\", "/");
  const target = resolve(destination ?? join(tmpdir(), "siljang-qa089-consultation-messages"));
  return publishFixture(root, target, async ({ out, source }) => {
    const support = join(root, "research/screen-checks-2026-11/support");
    const require = createRequire(join(root, "app/package.json"));
    const { build } = require("esbuild"),
      { parse } = require("yaml");

    await fs.mkdir(out, { recursive: true });
    const api = parse(await fs.readFile(root + "/api/openapi.yaml", "utf8"));
    const me = api.paths["/owner/me"].get.responses[200].content["application/json"].examples;
    const operation = api.paths["/owner/consultations/{consultationId}/messages"].get;
    const messages = operation.responses[200].content["application/json"].examples;
    const problemSamples = {};
    for (const response of Object.values(operation.responses))
      for (const example of Object.values(response.content?.["application/problem+json"]?.examples ?? {}))
        problemSamples[example.value.code] ??= example.value;
    const responseRows = Object.entries(operation.responses).flatMap(([status, response]) =>
      Object.entries(response.content ?? {}).flatMap(([, body]) =>
        Object.keys(body.examples ?? {}).map((name) => ({
          response: `API-043#${status}:${name}`,
          state: `SCR-018#${status === "200" ? (name === "deleted" ? "empty" : "normal") : status === "401" ? "permission" : "error"}`,
        })),
      ),
    );
    if (responseRows.length !== 7) throw new Error("SCR018 response contract changed");

    const entry = `import ${JSON.stringify(root + "/app/web/src/styles")};import ${JSON.stringify(root + "/app/web/src/styles/fonts")};
import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router';import{App}from ${JSON.stringify(root + "/app/web/src/App")};
const meExamples=${JSON.stringify(me)},messageExamples=${JSON.stringify(messages)},problemSamples=${JSON.stringify(problemSamples)};
let state='normal',count={me:0,messages:0,more:0,logout:0,rejected:0},refresh=()=>{},sessionGone=false;
const json=v=>new Response(JSON.stringify(v),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const problem=(code,status)=>{const v=problemSamples[code];if(!v||v.status!==status)throw new Error('Unknown synthetic problem');return new Response(JSON.stringify(structuredClone(v)),{status,headers:{'Content-Type':'application/problem+json','Cache-Control':'no-store'}});};
globalThis.fetch=async(input,init)=>{
 const url=new URL(String(input),'http://example.org'),path=url.pathname,q=url.searchParams,current=state;
 const method=init?.method??'GET';
 if(url.origin!=='http://example.org'&&!String(input).startsWith('/')){count.rejected++;throw new Error('Synthetic fixture blocks outside requests');}
 if(path==='/api/owner/session'&&method==='DELETE'){count.logout++;sessionGone=true;refresh();return new Response(null,{status:204});}
 if(method!=='GET'){count.rejected++;throw new Error('Synthetic fixture permits no business writes');}
 if(path==='/api/owner/me'){count.me++;refresh();return sessionGone?problem('unauthenticated',401):json(meExamples.mvp.value);}
 if(path==='/api/owner/consultations/'+messageExamples.messages.value.consultationId+'/messages'){
  count.messages++;if(q.has('cursor'))count.more++;refresh();
  const expected=new Headers(init?.headers).get('X-Expected-Shop-Id');
  if(expected!==meExamples.mvp.value.shop.shopId){count.rejected++;return problem('unauthenticated',401);}
  if(current==='loading')return new Promise(()=>{});
  if(init?.signal?.aborted)throw new DOMException('Aborted','AbortError');
  if(current==='permission'){sessionGone=true;return problem('unauthenticated',401);}
  if(current==='not-found')return problem('not_found',404);
  if(current==='validation')return problem('validation_failed',422);
  if(current==='error'||(current==='more-error'&&q.has('cursor')&&count.more===1))return problem('internal',500);
  const example=current==='empty'?'deleted':current==='owner-reply'?'with_owner_reply':'messages';
  const v=structuredClone(messageExamples[example].value);
  if(current==='ended')v.status='ended';
  if(current==='long')v.items[0].text='긴 합성 대화 '.repeat(20000).slice(0,100000);
  if(['photos','photo-stale','stale'].includes(current)){
   const expiry=['photo-stale','stale'].includes(current)&&count.messages===1?1:Math.floor(Date.now()/1000)+900;
   const base=new URL('/synthetic-photo.svg',globalThis.location?.href??'http://example.org/');
   v.items[0].kind='photo';v.items[0].text='합성 참고 사진';v.items[0].photos=[{url:base.href+'?exp='+expiry},{url:base.href+'?exp='+expiry+'&copy=2'}];
  }
  if(['sending','deferred','failed'].includes(current))v.items[0].delivery=current;
  if(current==='privacy')v.items[1].text+=' 계좌 123456789012 [카드번호1] …1111 [긴숫자1]';
  if(['more','more-error'].includes(current)){
   v.nextCursor=q.has('cursor')?null:'older_page';
   if(q.has('cursor'))v.items=[{...v.items[0],messageId:'00000000-0000-4000-8000-000000000089',at:'2026-01-01T00:00:00+09:00',text:'이전 합성 대화'},v.items[0]];
  }
  return json(v);
 }
 count.rejected++;throw new Error('Unexpected synthetic request');
};
function Fixture(){const[g,next]=useState(0),[,tick]=useState(0);refresh=()=>tick(v=>v+1);const path='/owner/consultations/'+(state==='invalid-id'?'invalid-id':messageExamples.messages.value.consultationId)+(state==='invalid-query'?'?limit=0':'');return <><aside className='qa-control'><label>시험 상태<select value={state} onChange={e=>{state=e.target.value;count={me:0,messages:0,more:0,logout:0,rejected:0};sessionGone=false;next(v=>v+1);}}>{['normal','loading','empty','error','permission','stale','owner-reply','not-found','validation','invalid-id','invalid-query','ended','long','photos','photo-stale','privacy','more','more-error','sending','deferred','failed'].map(v=><option key={v}>{v}</option>)}</select></label><button className='ui-button ui-button--secondary' type='button'>합성 다른 초점</button><p>공개 합성 응답 · 내 정보 {count.me} · 대화 {count.messages} · 추가 {count.more} · 거절 {count.rejected} · 실제 서비스 쓰기 없음</p></aside><MemoryRouter key={g} initialEntries={[path]}><App/></MemoryRouter></>};createRoot(document.getElementById('root')).render(<Fixture/>);`;
    const entryFile = join(out, "fixture-source.tsx");
    await fs.writeFile(entryFile, entry);
    await build({
      absWorkingDir: root,
      entryPoints: [entryFile],
      outdir: out,
      bundle: true,
      jsx: "automatic",
      format: "esm",
      minify: true,
      nodePaths: [root + "/app/node_modules"],
      define: {
        "import.meta.env.VITE_API_BASE": '"/api"',
        "process.env.NODE_ENV": '"production"',
      },
      loader: { ".woff2": "file", ".woff": "file", ".png": "file" },
      assetNames: "assets/[name]-[hash]",
      entryNames: "main",
    });
    await fs.rm(entryFile, { force: true });
    assertFixtureSource(root, source);
    const pageCheck = await fs.readFile(root + "/tools/corthex/page-check.js", "utf8");
    await fs.writeFile(out + "/page-check.js", pageCheck);
    await fs.writeFile(
      out + "/checker.js",
      "window.__siljangCheck=()=>(\n" + pageCheck.trim().replace(/;$/, "") + "\n);",
    );
    for (const name of ["qa.css", "synthetic-photo.svg", "qa-observe.js", "observer-selftest.js"])
      await fs.copyFile(support + "/" + name, out + "/" + name);
    await fs.writeFile(
      out + "/server.mjs",
      (await fs.readFile(support + "/server.mjs", "utf8")).replace("QA054_READY_", "QA089_V1_READY_"),
    );
    const head =
      '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><link rel="icon" href="/synthetic-photo.svg"><title>합성 상담 대화 화면 검사</title><link rel="stylesheet" href="/main.css"><link rel="stylesheet" href="/qa.css"><script src="/qa-observe.js"></script><script src="/checker.js"></script></head>';
    await fs.writeFile(
      out + "/index.html",
      head + '<body><div id="root"></div><script type="module" src="/main.js"></script></body></html>',
    );
    await fs.writeFile(
      out + "/observer-selftest.html",
      head + '<body><main><h1>분리 관찰기 시험</h1></main><script src="/observer-selftest.js"></script></body></html>',
    );
    assertFixtureSource(root, source);
    const manifest = {
      localProductSourceCommit: source,
      scope: "실제 App/OwnerArea/상담 화면과 합성 응답. 브라우저/실제 서비스 실행 아님",
      primaryStates: 6,
      states: ["normal", "loading", "empty", "error", "permission", "stale"],
      widthsPrepared: [360, 1280],
      responseRows: responseRows.length,
      responseCases: responseRows,
      sourceInputs: "동일 작업 트리/커밋 원본을 생성 전후 검사",
      browserRun: false,
      outsideServices: 0,
    };
    await fs.writeFile(out + "/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
    return {
      source,
      out,
      entry,
      primaryStates: 6,
      responseRows: responseRows.length,
      browserRun: false,
    };
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { entry, ...metadata } = await buildConsultationMessages(process.argv[2], process.argv[3]);
  console.log(JSON.stringify(metadata));
}
