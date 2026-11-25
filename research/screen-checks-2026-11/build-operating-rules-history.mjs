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
export async function buildOperatingRulesHistory(repositoryRoot, destination) {
	const root = fixtureRepository(import.meta.url, repositoryRoot).replaceAll(
		"\\",
		"/",
	);
	const target = resolve(
		destination ?? join(tmpdir(), "siljang-qa052-rules-history"),
	);
	return publishFixture(root, target, async ({ out, source }) => {
		const support = join(root, "research/screen-checks-2026-11/support");
		const require = createRequire(join(root, "app/package.json"));
		const { build } = require("esbuild"),
			{ parse } = require("yaml");

		await fs.mkdir(out, { recursive: true });
		const api = parse(await fs.readFile(root + "/api/openapi.yaml", "utf8"));
		const listExamples =
			api.paths["/owner/operating-rules/versions"].get.responses[200].content[
				"application/json"
			].examples;
		const old =
			api.paths["/owner/operating-rules/versions/{version}"].get.responses[200]
				.content["application/json"].examples.old_version.value;
		const current =
			api.paths["/owner/operating-rules"].get.responses[200].content[
				"application/json"
			].examples.current.value;
		const template =
			api.paths["/owner/operating-rules"].get.responses[200].content[
				"application/json"
			].examples.template.value;
		const me =
			api.paths["/owner/me"].get.responses[200].content["application/json"]
				.examples.mvp.value;
		const operations = {
			me: api.paths["/owner/me"].get,
			list: api.paths["/owner/operating-rules/versions"].get,
			detail: api.paths["/owner/operating-rules/versions/{version}"].get,
		};
		const problemSamples = {};
		for (const [name, operation] of Object.entries(operations)) {
			const samples = {};
			for (const response of Object.values(operation.responses))
				for (const example of Object.values(
					response.content?.["application/problem+json"]?.examples ?? {},
				))
					samples[example.value.code] ??= example.value;
			problemSamples[name] = samples;
		}
		const entry = `import ${JSON.stringify(root + "/app/web/src/styles")};import ${JSON.stringify(root + "/app/web/src/styles/fonts")};import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter,Routes,Route} from 'react-router';import {OwnerArea} from ${JSON.stringify(root + "/app/web/src/OwnerArea")};
const listExamples=${JSON.stringify(listExamples)},old=${JSON.stringify(old)},current=${JSON.stringify(current)},template=${JSON.stringify(template)},profile=${JSON.stringify(me)},problemSamples=${JSON.stringify(problemSamples)};
let scenario=sessionStorage.getItem('qa052-scenario')||'normal',lists=0,details=0,meReads=0,refresh=()=>{},shopGone=false;
profile.shop.name='합성 운영규정 가게';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const problem=(operation,code,status)=>{const sample=problemSamples[operation][code];if(!sample||sample.status!==status)throw new Error('Unknown synthetic problem');return new Response(JSON.stringify(structuredClone(sample)),{status,headers:{'Content-Type':'application/problem+json','Cache-Control':'no-store'}});};
function items(){if(scenario==='empty')return structuredClone(listExamples.empty.value);if(['maximum','maximum-slow'].includes(scenario))return {items:Array.from({length:1000},(_,i)=>({version:1000-i,createdAt:new Date(Date.UTC(2026,10,24)-i*60000).toISOString(),supersededAt:i===0?null:new Date(Date.UTC(2026,10,24)-(i-1)*60000).toISOString()}))};return structuredClone(listExamples.versions.value);}
globalThis.fetch=async(input,init)=>{const path=String(input);
 if(path==='/api/owner/me'){meReads++;refresh();if(scenario==='maximum-slow'&&meReads>1)await new Promise(r=>setTimeout(r,4500));if(init?.signal?.aborted)throw new DOMException('Aborted','AbortError');return json({...profile,shop:shopGone?null:profile.shop});}
 if(path==='/api/owner/session'&&init?.method==='DELETE')return new Response(null,{status:204});
 if(path==='/api/owner/operating-rules')return json(scenario==='empty'?template:current);
 if(path==='/api/owner/operating-rules/versions'){lists++;refresh();if(scenario==='loading')return new Promise(()=>{});if(scenario==='permission')return problem('list','unauthenticated',401);if(scenario==='not-registered'){shopGone=true;return problem('list','shop_not_registered',404);}if(scenario==='error')return problem('list','internal',500);return json(items());}
 if(path.startsWith('/api/owner/operating-rules/versions/')){details++;refresh();if(scenario==='detail-loading')return new Promise(()=>{});if(scenario==='detail-error')return problem('detail','internal',500);if(scenario==='detail-permission')return problem('detail','unauthenticated',401);if(scenario==='not-found')return problem('detail','not_found',404);const version=Number(path.split('/').at(-1)),row=items().items.find(item=>item.version===version);if(!row)return problem('detail','not_found',404);const value=structuredClone(row.supersededAt===null?current:old);Object.assign(value,{version,current:row.supersededAt===null,createdAt:row.createdAt,supersededAt:row.supersededAt});if(['maximum','maximum-slow'].includes(scenario))value.revision='synthetic-v'+version;return json(value);}
 return problem('detail','not_found',404);
};
function Fixture(){const[g,next]=useState(0),[,tick]=useState(0);refresh=()=>tick(n=>n+1);return <><aside className='qa-control'><label>시험 상태<select value={scenario} onChange={e=>{scenario=e.target.value;sessionStorage.setItem('qa052-scenario',scenario);lists=details=meReads=0;shopGone=false;history.replaceState(null,'','/owner/operating-rules/versions');next(n=>n+1)}}>{['normal','loading','empty','error','permission','not-registered','detail-loading','detail-error','detail-permission','not-found','maximum','maximum-slow'].map(value=><option key={value}>{value}</option>)}</select></label><a className='ui-button ui-button--secondary' href='/owner/operating-rules/versions/1'>첫 목록 밖 옛 버전 주소 직접 열기</a><p>합성 이력 응답 · 목록 {lists} · 상세 {details} · 신원 {meReads} · 실제 서비스 쓰기 없음</p></aside><BrowserRouter key={g}><Routes><Route path='/owner/login' element={<main><h1>합성 로그인 화면</h1><p>다시 로그인해 주세요</p></main>}/><Route path='/owner/*' element={<OwnerArea/>}/></Routes></BrowserRouter></>};if(location.pathname==='/')history.replaceState(null,'','/owner/operating-rules/versions');createRoot(document.getElementById('root')).render(<Fixture/>);`;
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
				"QA052_V8_READY_",
			),
		);
		await fs.appendFile(
			out + "/qa.css",
			"\n@media(min-width:1260px){.qa-control{margin-left:var(--size-menu)}}\n",
		);
		const head =
			'<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><link rel="icon" href="/synthetic-photo.svg"><title>합성 운영규정 이력 검사</title><link rel="stylesheet" href="/main.css"><link rel="stylesheet" href="/qa.css"><script src="/qa-observe.js"></script><script src="/checker.js"></script></head>';
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
				"HEAD와 같은 실제 OwnerArea/운영규정 이력·토큰/폰트·OpenAPI의 합성 자료. 브라우저 성공이 아님",
			primaryStates: 5,
			responseRows: 9,
			browserRun: false,
			outsideServices: 0,
			tabMeDelayMs: 4500,
			previousNativeV6:
				"기존 원문/받은 지시/정지ACK부터 수집. 중복 전송하지 않음",
		};
		await fs.writeFile(
			out + "/manifest.json",
			JSON.stringify(manifest, null, 2) + "\n",
		);
		return {
			source,
			out,
			entry,
			primaryStates: 5,
			responseRows: 9,
			browserRun: false,
		};
	});
}
if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const { entry, ...metadata } = await buildOperatingRulesHistory(
		process.argv[2],
		process.argv[3],
	);
	console.log(JSON.stringify(metadata));
}
