import { createRequire } from "node:module";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

import { execFileSync } from "node:child_process";
const root = resolve(process.argv[2] ?? ".").replaceAll("\\", "/"),
	out = resolve(process.argv[3] ?? join(tmpdir(), "siljang-qa087-owner-tasks"));
const support = join(dirname(fileURLToPath(import.meta.url)), "support");
const require = createRequire(join(root, "app/package.json"));
const { build } = require("esbuild"),
	{ parse } = require("yaml");
const source = execFileSync("git", ["rev-parse", "HEAD"], {
	cwd: root,
	encoding: "utf8",
}).trim();
await fs.mkdir(out, { recursive: true });
const api = parse(await fs.readFile(root + "/api/openapi.yaml", "utf8"));
const me =
	api.paths["/owner/me"].get.responses[200].content["application/json"]
		.examples;
const tasks =
	api.paths["/owner/tasks"].get.responses[200].content["application/json"]
		.examples;
const entry = `import ${JSON.stringify(root + "/app/web/src/styles")};import ${JSON.stringify(root + "/app/web/src/styles/fonts")};
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter,useNavigate} from 'react-router';import {App} from ${JSON.stringify(root + "/app/web/src/App")};
const meExamples=${JSON.stringify(me)},taskExamples=${JSON.stringify(tasks)};
let state='normal',count={me:0,tasks:0,more:0,logout:0},refresh=()=>{},shopGone=false,sessionGone=false;
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
const problem=(code,status)=>json({code,traceId:'0123456789abcdef0123456789abcdef'},status);
globalThis.fetch=async(input,init)=>{const path=String(input),q=new URL(path,'http://example.org').searchParams,current=state;
 if(path==='/api/owner/session'&&init?.method==='DELETE'){count.logout++;sessionGone=true;refresh();return new Response(null,{status:204});}
 if(path==='/api/owner/me'){count.me++;refresh();if(count.me>1&&current==='tab-slow')await new Promise(r=>setTimeout(r,4500));if(count.me>1&&current==='recheck-pending')return new Promise(()=>{});if(count.me>1&&current==='recheck-error')return problem('internal',500);if(count.me>1&&current==='account-switch')await new Promise(r=>setTimeout(r,1500));if(sessionGone||current==='me-permission')return problem('unauthenticated',401);if(current==='me-error')return problem('internal',500);let v=structuredClone(meExamples[current==='not-sent'?'not_friend':current==='friend'?'friend':'mvp'].value);v.shop.name='합성 할 일 가게';if(current==='account-switch'&&count.me>1){v.owner.ownerId='00000000-0000-4000-8000-000000009901';v.shop.shopId='00000000-0000-4000-8000-000000009902';v.shop.name='새 합성 가게';}if(shopGone||current==='no-shop')v=structuredClone(meExamples.no_shop.value);if(current==='hold'){v.shop.licenseStatus='on_hold';v.banners=['license_on_hold'];}if(current==='banners')v.banners=['license_pending','license_on_hold','booking_link_not_ready','ledger_relink'];return json(v);}
 if(path.startsWith('/api/owner/tasks?')){count.tasks++;if(q.has('cursor'))count.more++;refresh();if(current==='loading')return new Promise(()=>{});if(current==='slow-more'&&q.has('cursor'))await new Promise(r=>setTimeout(r,4000));if(init?.signal?.aborted)throw new DOMException('Aborted','AbortError');
  if(current==='permission'){sessionGone=true;return problem('unauthenticated',401);}if(current==='task-no-shop'){shopGone=true;return problem('shop_not_registered',404);}if(current==='validation')return problem('validation_failed',422);if(current==='error'||(current==='more-error'&&q.has('cursor')&&count.more===1))return problem('internal',500);
  let v=structuredClone(taskExamples[current==='not-sent'?'not_friend':'open_tasks'].value);if(current==='empty')v.items=[];if(current==='account-switch'&&count.me>1)v.items=[{...v.items[0],taskId:'00000000-0000-4000-8000-000000009903',summary:'새 가게 할 일'}];if(current==='order-numbers')v.items=v.items.slice(0,2).map((t,i)=>({...t,order:{...(t.order??v.items[0].order),orderNo:i===0?'A1B2C3D':'A1B2C3D4'}}));
  if(q.get('status')==='closed'||current==='closed')v.items=v.items.map((t,i)=>({...t,closedAt:'2026-11-24T12:00:00+09:00',waitStatus:i===0?'closed_no_answer':'answered'}));
  if(['more','more-error','slow-more'].includes(current)){v.items=q.has('cursor')?v.items.slice(1):v.items.slice(0,2);v.nextCursor=q.has('cursor')?null:'next-page';}
  if(current==='stale'&&count.tasks>1)v.items[0].summary='다시 읽은 합성 할 일';
  if(current==='no-target')v.items[0].subject=null;
  if(current==='long')v.items[0].summary='긴 합성 요약'.repeat(25).slice(0,200);
  if(current==='maximum')v.items=Array.from({length:100},(_,i)=>({...structuredClone(v.items[i%v.items.length]),taskId:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),summary:'합성 할 일 '+(i+1)}));
  return json(v);
 }
 return problem('not_found',404);
};
function IdentityProbe(){const navigate=useNavigate();return <button className='ui-button ui-button--secondary' type='button' onClick={()=>navigate('/owner?limit=19')}>합성 신원 재확인 경로로 이동</button>;}
function Fixture(){const[g,next]=useState(0),[,tick]=useState(0);refresh=()=>tick(v=>v+1);const path=state==='invalid'?'/owner?status=unknown':state==='maximum'?'/owner?limit=100':state==='closed'?'/owner?status=closed':'/owner';return <><aside className='qa-control'><label>시험 상태<select value={state} onChange={e=>{state=e.target.value;count={me:0,tasks:0,more:0,logout:0};shopGone=sessionGone=false;next(v=>v+1)}}>{['normal','loading','empty','error','not-sent','permission','stale','friend','me-error','me-permission','no-shop','task-no-shop','validation','invalid','closed','more','more-error','slow-more','banners','hold','long','maximum','no-target','order-numbers','recheck-pending','recheck-error','account-switch','tab-slow'].map(v=><option key={v}>{v}</option>)}</select></label><button className='ui-button ui-button--secondary' type='button'>합성 다른 초점</button><p>공개 합성 응답 · 내 정보 {count.me} · 할 일 {count.tasks} · 추가 {count.more} · 실제 서비스 쓰기 없음</p></aside><MemoryRouter key={g} initialEntries={[path]}>{['recheck-pending','recheck-error','account-switch'].includes(state)?<IdentityProbe/>:null}<App/></MemoryRouter></>};createRoot(document.getElementById('root')).render(<Fixture/>);`;
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
const pageCheck = await fs.readFile(
	root + "/tools/corthex/page-check.js",
	"utf8",
);
await fs.writeFile(out + "/page-check.js", pageCheck);
await fs.writeFile(
	out + "/checker.js",
	"window.__siljangCheck=()=>(\n" + pageCheck.trim().replace(/;$/, "") + "\n);",
);
for (const name of [
	"qa.css",
	"synthetic-photo.svg",
	"qa-observe.js",
	"observer-selftest.js",
])
	await fs.copyFile(support + "/" + name, out + "/" + name);
await fs.writeFile(
	out + "/server.mjs",
	(await fs.readFile(support + "/server.mjs", "utf8")).replace(
		"QA054_READY_",
		"QA087_V3_READY_",
	),
);
const head =
	'<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><link rel="icon" href="/synthetic-photo.svg"><title>합성 할 일 화면 검사</title><link rel="stylesheet" href="/main.css"><link rel="stylesheet" href="/qa.css"><script src="/qa-observe.js"></script><script src="/checker.js"></script></head>';
await fs.writeFile(
	out + "/index.html",
	head +
		'<body><div id="root"></div><script type="module" src="/main.js"></script></body></html>',
);
await fs.writeFile(
	out + "/observer-selftest.html",
	head +
		'<body><main><h1>분리 관찰기 시험</h1></main><script src="/observer-selftest.js"></script></body></html>',
);
const manifest = {
	localProductSourceCommit: source,
	scope:
		"현재 작업 트리의 실제 App/OwnerArea/홈을 묶는 합성 자료. 브라우저 검사나 실제 서비스 쓰기가 아님",
	primaryStates: 7,
	responseRows: 13,
	tabMeDelayMs: 4500,
	identityProbe:
		"/owner?limit=19 (경로 이동; 실제 visibilitychange 증거가 아님)",
	browserRun: false,
	outsideServices: 0,
};
await fs.writeFile(
	out + "/manifest.json",
	JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
	JSON.stringify({
		source,
		out,
		primaryStates: 7,
		responseRows: 13,
		browserRun: false,
	}),
);
