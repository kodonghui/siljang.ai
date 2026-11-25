import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

import {
	assertFixtureSource,
	fixtureRepository,
	publishFixture,
} from "./fixture-source.mjs";
export async function buildPaymentDestination(repositoryRoot, destination) {
	const root = fixtureRepository(import.meta.url, repositoryRoot).replaceAll(
		"\\",
		"/",
	);
	const target = resolve(
		destination ?? join(tmpdir(), "siljang-qa053-payment-destination"),
	);
	return publishFixture(root, target, async ({ out, source }) => {
		const support = join(root, "research/screen-checks-2026-11/support");
		const require = createRequire(join(root, "app/package.json"));
		const { build } = require("esbuild"),
			{ parse } = require("yaml");

		await fs.mkdir(out, { recursive: true });
		const api = parse(await fs.readFile(root + "/api/openapi.yaml", "utf8"));
		const operation = api.paths["/owner/payment-destination"];
		const original =
			operation.get.responses[200].content["application/json"].examples.account
				.value;
		const profile =
			api.paths["/owner/me"].get.responses[200].content["application/json"]
				.examples.mvp.value;
		const operations = {
			me: api.paths["/owner/me"].get,
			read: operation.get,
			save: operation.put,
			fallback: api.paths["/owner/operating-rules/versions/{version}"].get,
		};
		const problemSamples = {},
			problemExamples = {};
		for (const [name, operation] of Object.entries(operations)) {
			const samples = {},
				examples = {};
			for (const response of Object.values(operation.responses))
				for (const [label, example] of Object.entries(
					response.content?.["application/problem+json"]?.examples ?? {},
				)) {
					samples[example.value.code] ??= example.value;
					examples[label] = example.value;
				}
			problemSamples[name] = samples;
			problemExamples[name] = examples;
		}
		const inputName = operation.put.requestBody.content[
			"application/json"
		].schema.$ref
			.split("/")
			.at(-1);
		const inputFields = Object.keys(
			api.components.schemas[inputName].properties,
		).filter((name) => !["baseRevision", "confirm"].includes(name));
		const entry = `import ${JSON.stringify(root + "/app/web/src/styles")};import ${JSON.stringify(root + "/app/web/src/styles/fonts")};import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter,Routes,Route} from 'react-router';import {OwnerArea} from ${JSON.stringify(root + "/app/web/src/OwnerArea")};
const original=${JSON.stringify(original)},profile=${JSON.stringify(profile)},problemSamples=${JSON.stringify(problemSamples)},problemExamples=${JSON.stringify(problemExamples)},inputFields=${JSON.stringify(inputFields)};
profile.shop.name='합성 결제 가게';profile.shop.licenseStatus='pending';
let scenario='normal',reads=0,sends=[],meReads=0,refresh=()=>{},shopGone=false,current=structuredClone(original),completed=new Map(),licenseReleased=false;
function selectScenario(value){scenario=value;reads=meReads=0;sends=[];shopGone=false;current=value==='empty'?null:structuredClone(original);completed=new Map();licenseReleased=false;}
const shopLicenseStatus=()=>scenario==='save-holder'?'verified':scenario==='on-hold'&&!licenseReleased?'on_hold':'pending';
const json=(value,status=200,extraHeaders={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...extraHeaders}});
const problem=(operation,code,status,exampleName)=>{const sample=exampleName?problemExamples[operation][exampleName]:problemSamples[operation][code];if(!sample||sample.status!==status)throw new Error('Unknown synthetic problem');return new Response(JSON.stringify(structuredClone(sample)),{status,headers:{'Content-Type':'application/problem+json','Cache-Control':'no-store',...(code==='request_in_progress'?{'Retry-After':'1'}:{})}});};
const values=body=>Object.fromEntries(inputFields.map(field=>[field,body[field]]));
const canonical=value=>Array.isArray(value)?value.map(canonical):value!==null&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
globalThis.fetch=async(input,init)=>{const path=String(input);
 if(path==='/api/owner/me'){meReads++;refresh();if(scenario==='session-pending')return new Promise(()=>{});if(scenario==='session-failed')return problem('me','internal',500);return json({...profile,shop:shopGone?null:{...profile.shop,licenseStatus:shopLicenseStatus()}});}
 if(path==='/api/owner/session'&&init?.method==='DELETE')return new Response(null,{status:204});
 if(path!=='/api/owner/payment-destination')return problem('fallback','not_found',404);
 if(init?.method==='PUT'){
  const key=new Headers(init.headers).get('Idempotency-Key');
  if(!key)return problem('save','validation_failed',422,'missing_idempotency_key');
  const body=JSON.parse(String(init.body)),signature=JSON.stringify(canonical(body));sends.push({body,key});refresh();
  const prior=completed.get(key);if(prior)return prior.body===signature?json(prior.response,200,{'Idempotency-Replayed':'true'}):problem('save','idempotency_key_reused',422);
  const first=sends.length===1;
  if(scenario==='submitting')return new Promise(()=>{});
  if(first){
   if(scenario==='save-401')return problem('save','unauthenticated',401);
   if(scenario==='save-no-shop'){shopGone=true;return problem('save','shop_not_registered',404);}
   if(scenario==='stale'){current={...(current??original),bankName:'다른 합성 은행',cardPaymentUrl:'https://pay.example.test/remote',revision:'synthetic-payment-latest'};return problem('save','version_conflict',409);}
   if(scenario==='save-progress')return problem('save','request_in_progress',409);
   if(scenario==='save-key')return problem('save','idempotency_key_reused',422);
   if(scenario==='save-500')return problem('save','internal',500);
   if(scenario==='error')return problem('save','validation_failed',422);
  }
  if(body.baseRevision!==(current?.revision??null))return problem('save','version_conflict',409);
  if(current&&inputFields.every(field=>current[field]===body[field])){const response={outcome:'unchanged',paymentDestination:structuredClone(current)};completed.set(key,{body:signature,response});return json(response);}
  const matchesIdentity=body.holderName===original.holderName||body.holderName===profile.shop.name;
  if(shopLicenseStatus()==='verified'&&!matchesIdentity)return problem('save','holder_not_verified',409);
  if(!matchesIdentity&&!body.confirm?.includes('holder_mismatch'))return problem('save','confirmation_required',409);
  licenseReleased=true;
  current={...(current??original),...values(body),holderMismatchConfirmed:matchesIdentity?null:body.confirm?.includes('holder_mismatch')||current?.holderName===body.holderName&&current?.holderMismatchConfirmed===true?true:null,createdAt:'2026-11-24T19:00:00Z',revision:'synthetic-payment-saved-'+sends.length};
  const response={outcome:'created',paymentDestination:structuredClone(current)};completed.set(key,{body:signature,response});return json(response);
 }
 reads++;refresh();if(scenario==='loading')return new Promise(()=>{});if(scenario==='load-failed')return problem('read','internal',500);if(scenario==='permission')return problem('read','unauthenticated',401);if(scenario==='read-no-shop'){shopGone=true;return problem('read','shop_not_registered',404);}if(current===null)return problem('read','not_set',404);return json(current);
};
function Fixture(){const[g,next]=useState(0),[,tick]=useState(0);refresh=()=>tick(n=>n+1);const first=sends[0],last=sends.at(-1),sameBody=!!first&&!!last&&JSON.stringify(first.body)===JSON.stringify(last.body);return <><aside className='qa-control'><label>시험 상태<select value={scenario} onChange={e=>{selectScenario(e.target.value);history.replaceState(null,'','/owner/payment-destination');next(n=>n+1)}}>{['normal','empty','error','confirm','loading','load-failed','permission','stale','submitting','done','read-no-shop','save-401','save-no-shop','save-holder','save-progress','save-key','save-500','unchanged','on-hold','session-pending','session-failed'].map(value=><option key={value}>{value}</option>)}</select></label><p>합성 응답 · 읽기 {reads} · 저장 {sends.length} · 신원 {meReads} · 요청키 종류 {new Set(sends.map(x=>x.key)).size} · 첫본문일치 {String(sameBody)} · 실제 서비스 쓰기 없음</p></aside><BrowserRouter key={g}><Routes><Route path='/owner/login' element={<main><h1>합성 로그인 화면</h1><p>다시 로그인해 주세요</p></main>}/><Route path='/owner/*' element={<OwnerArea/>}/></Routes></BrowserRouter></>};if(location.pathname==='/')history.replaceState(null,'','/owner/payment-destination');createRoot(document.getElementById('root')).render(<Fixture/>);`;
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
		const pageCheck = await fs.readFile(
			root + "/tools/corthex/page-check.js",
			"utf8",
		);
		await fs.writeFile(out + "/page-check.js", pageCheck);
		await fs.writeFile(
			out + "/checker.js",
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
			await fs.copyFile(support + "/" + name, out + "/" + name);
		await fs.writeFile(
			out + "/server.mjs",
			(await fs.readFile(support + "/server.mjs", "utf8")).replace(
				"QA054_READY_",
				"QA053_V3_READY_",
			),
		);
		await fs.appendFile(
			out + "/qa.css",
			"\n@media(min-width:1260px){.qa-control{margin-left:var(--size-menu)}}\n",
		);
		const head =
			'<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><link rel="icon" href="/synthetic-photo.svg"><title>합성 결제 수단 검사</title><link rel="stylesheet" href="/main.css"><link rel="stylesheet" href="/qa.css"><script src="/qa-observe.js"></script><script src="/checker.js"></script></head>';
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
		assertFixtureSource(root, source);
		const manifest = {
			localProductSourceCommit: source,
			scope:
				"HEAD와 같은 실제 OwnerArea/결제 수단 편집기·토큰/폰트/OpenAPI의 합성 자료. 실제 금융기관/브라우저 성공이 아님",
			primaryStates: 10,
			responseRows: 16,
			headerExtraRows: 1,
			browserRun: false,
			outsideServices: 0,
			confirmation:
				"다른 합성 예금주로 실제 입력/저장하면 확인 창. 같은 값은 unchanged가 먼저",
			previousNative:
				"기존 D4 진행/원문·받은 지시/정지ACK부터 수집. 새 자료 중복 전송 없음",
		};
		await fs.writeFile(
			out + "/manifest.json",
			JSON.stringify(manifest, null, 2) + "\n",
		);
		return {
			source,
			out,
			entry,
			primaryStates: 10,
			responseRows: 16,
			browserRun: false,
		};
	});
}
if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const { entry, ...metadata } = await buildPaymentDestination(
		process.argv[2],
		process.argv[3],
	);
	console.log(JSON.stringify(metadata));
}
