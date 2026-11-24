import { createRequire } from "node:module";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
export async function buildOperatingRules(repositoryRoot, destination) {
	const root = resolve(repositoryRoot ?? ".").replaceAll("\\", "/");
	const out = resolve(
		destination ?? join(tmpdir(), "siljang-qa051-operating-rules"),
	);
	const support = join(dirname(fileURLToPath(import.meta.url)), "support");
	const require = createRequire(join(root, "app/package.json"));
	const { build } = require("esbuild"),
		{ parse } = require("yaml");
	const source = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: root,
		encoding: "utf8",
	}).trim();
	await fs.mkdir(out, { recursive: true });
	const api = parse(await fs.readFile(join(root, "api/openapi.yaml"), "utf8"));
	const examples =
		api.paths["/owner/operating-rules"].get.responses[200].content[
			"application/json"
		].examples;
	const operations = {
		read: api.paths["/owner/operating-rules"].get,
		save: api.paths["/owner/operating-rules/versions"].post,
		fallback: api.paths["/owner/operating-rules/versions/{version}"].get,
	};
	const problemSamples = {};
	for (const [name, operation] of Object.entries(operations)) {
		const samples = {};
		for (const response of Object.values(operation.responses)) {
			for (const example of Object.values(
				response.content?.["application/problem+json"]?.examples ?? {},
			))
				samples[example.value.code] ??= example.value;
		}
		problemSamples[name] = samples;
	}
	const inputName = operations.save.requestBody.content[
		"application/json"
	].schema.$ref
		.split("/")
		.at(-1);
	const inputFields = Object.keys(
		api.components.schemas[inputName].properties,
	).filter((name) => !["baseRevision", "confirm"].includes(name));
	const entry = `import ${JSON.stringify(root + "/app/web/src/styles")};import ${JSON.stringify(root + "/app/web/src/styles/fonts")};import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter,Routes,Route} from 'react-router';import {OwnerArea} from ${JSON.stringify(root + "/app/web/src/OwnerArea")};
const normal=${JSON.stringify(examples.current.value)},template=${JSON.stringify(examples.template.value)};
const problemSamples=${JSON.stringify(problemSamples)},inputFields=${JSON.stringify(inputFields)};
let current=structuredClone(normal),scenario='normal',reads=0,sends=0,firstKey=null,sameKey=null,refresh=()=>{},shopGone=false;
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const problem=(operation,code,status,extra={})=>{
 const sample=problemSamples[operation][code]??problemSamples.fallback[code];
 if(!sample||sample.status!==status)throw new Error('Unknown synthetic problem');
 return new Response(JSON.stringify({...structuredClone(sample),...extra}),{status,headers:{'Content-Type':'application/problem+json','Cache-Control':'no-store'}});
};
const values=value=>Object.fromEntries(inputFields.map(key=>[key,value[key]]));
const canonical=value=>Array.isArray(value)?value.map(canonical):value!==null&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const semantic=value=>JSON.stringify(canonical(values(value)));
const profile={owner:{ownerId:'00000000-0000-4000-8000-000000000051',alertChannelFriend:false,createdAt:'2026-11-23T08:00:00Z'},shop:{shopId:'00000000-0000-4000-8000-000000000052',name:'합성 운영규정 가게',licenseStatus:'verified'}};
globalThis.fetch=async(input,init)=>{
 const path=String(input);
 if(path==='/api/owner/me')return json({...profile,shop:shopGone?null:profile.shop});
 if(init?.method==='DELETE')return new Response(null,{status:204});
 if(path==='/api/owner/operating-rules'){
  reads++;refresh();
  if(scenario==='loading')return new Promise(()=>{});
  if(scenario==='load-error')return problem('read','internal',500);
  if(scenario==='permission')return problem('read','unauthenticated',401);
  if(scenario==='not-registered'){shopGone=true;return problem('read','shop_not_registered',404);}
  return json(current);
 }
 if(path==='/api/owner/operating-rules/versions'&&init?.method==='POST'){
  sends++;const key=new Headers(init.headers).get('Idempotency-Key');
  if(firstKey===null)firstKey=key;else sameKey=key===firstKey;
  refresh();const body=JSON.parse(String(init.body));
  if(scenario==='submitting')return new Promise(()=>{});
  if(scenario==='save-permission')return problem('save','unauthenticated',401);
  if(scenario==='save-not-registered'){shopGone=true;return problem('save','shop_not_registered',404);}
  if(sends===1){
   if(scenario==='error')return problem('save','internal',500);
   if(scenario==='stale'){current={...current,version:3,revision:'synthetic-v3',paymentDueHours:24};return problem('save','version_conflict',409);}
   if(scenario==='field-clauses')return problem('save','validation_failed',422,{errors:[{field:'/clauses',code:'exceeds_card_limit'},{field:'/clauses/0',code:'exceeds_card_limit'}]});
   if(scenario==='key-reused')return problem('save','idempotency_key_reused',422);
   if(scenario==='request-in-progress')return problem('save','request_in_progress',409);
  }
  if(body.baseRevision!==current.revision)return problem('save','version_conflict',409);
  if(current.version!==null&&semantic(body)===semantic(current))return json({outcome:'unchanged',operatingRules:current});
  if(Number(body.preProductionRefundPct)<100&&!body.confirm?.includes('lowered_refund'))return problem('save','confirmation_required',409,{confirm:[{kind:'lowered_refund'}]});
  current={...current,...values(body),version:current.version===null?1:current.version+1,isTemplate:false,current:true,createdAt:'2026-11-24T16:00:00Z',supersededAt:null,revision:'synthetic-saved-'+sends,preProductionLoweredAck:Number(body.preProductionRefundPct)<100};
  return json({outcome:'created',operatingRules:current},201);
 }
 return problem('fallback','not_found',404);
};
function Fixture(){const[g,next]=useState(0),[,tick]=useState(0);refresh=()=>tick(n=>n+1);return <><aside className='qa-control'><label>시험 상태<select value={scenario} onChange={e=>{scenario=e.target.value;current=structuredClone(scenario==='template'?template:normal);reads=sends=0;shopGone=false;firstKey=sameKey=null;next(n=>n+1)}}>{['normal','template','error','confirm','loading','load-error','permission','stale','submitting','done','not-registered','save-permission','save-not-registered','field-clauses','key-reused','request-in-progress','unchanged'].map(v=><option key={v}>{v}</option>)}</select></label><p>합성 응답 · 읽기 {reads} · 저장 {sends} · 두 번째 요청 키 {sameKey===null?'없음':sameKey?'같음':'다름'} · 실제 서비스 쓰기 없음</p></aside><MemoryRouter key={g} initialEntries={['/owner/operating-rules']}><Routes><Route path='/owner/login' element={<main><h1>합성 로그인 화면</h1><p>다시 로그인해 주세요</p></main>}/><Route path='/owner/*' element={<OwnerArea/>}/></Routes></MemoryRouter></>};createRoot(document.getElementById('root')).render(<Fixture/>);`;
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
		nodePaths: [join(root, "app/node_modules")],
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
		join(root, "tools/corthex/page-check.js"),
		"utf8",
	);
	await fs.writeFile(join(out, "page-check.js"), pageCheck);
	await fs.writeFile(
		join(out, "checker.js"),
		"window.__siljangCheck=()=>(\n" +
			pageCheck.trim().replace(/;$/, "") +
			"\n);",
	);
	for (const name of [
		"qa.css",
		"synthetic-photo.svg",
		"qa-observe.js",
		"observer-selftest.js",
	])
		await fs.copyFile(join(support, name), join(out, name));
	await fs.appendFile(
		join(out, "qa.css"),
		"\n@media(min-width:1260px){.qa-control{margin-left:var(--size-menu)}}\n",
	);
	await fs.writeFile(
		join(out, "server.mjs"),
		(await fs.readFile(join(support, "server.mjs"), "utf8")).replace(
			"QA054_READY_",
			"QA051_V6_READY_",
		),
	);
	const head =
		'<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><link rel="icon" href="/synthetic-photo.svg"><title>합성 운영규정 확인</title><link rel="stylesheet" href="/main.css"><link rel="stylesheet" href="/qa.css"><script src="/qa-observe.js"></script><script src="/checker.js"></script></head>';
	await fs.writeFile(
		join(out, "index.html"),
		head +
			'<body><div id="root"></div><script type="module" src="/main.js"></script></body></html>',
	);
	await fs.writeFile(
		join(out, "observer-selftest.html"),
		head +
			'<body><main><h1>분리 관찰기 시험</h1></main><script src="/observer-selftest.js"></script></body></html>',
	);
	const manifest = {
		localProductSourceCommit: source,
		scope:
			"현재 작업 트리의 실제 OwnerArea/운영규정 편집기·공통 초점/대화창. 로컬 컴파일 자료이며 학원컴 화면 성공이 아님",
		primaryStates: 10,
		responseRows: 15,
		browserRun: false,
		outsideServices: 0,
		previousNativeV4: "기존 진행/결과와 별도. 중복 전송/실행하지 않음",
	};
	await fs.writeFile(
		join(out, "manifest.json"),
		JSON.stringify(manifest, null, 2) + "\n",
	);
	return {
		source,
		out,
		entry,
		primaryStates: 10,
		responseRows: 15,
		browserRun: false,
	};
}
if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const { entry, ...metadata } = await buildOperatingRules(
		process.argv[2],
		process.argv[3],
	);
	console.log(JSON.stringify(metadata));
}
