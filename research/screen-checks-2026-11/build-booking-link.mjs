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
export async function buildBookingLink(repositoryRoot, destination) {
	const root = fixtureRepository(import.meta.url, repositoryRoot).replaceAll(
		"\\",
		"/",
	);
	const target = resolve(
		destination ?? join(tmpdir(), "siljang-qa055-booking-link"),
	);
	return publishFixture(root, target, async ({ out, source }) => {
		const support = join(root, "research/screen-checks-2026-11/support");
		const require = createRequire(join(root, "app/package.json"));
		const { build } = require("esbuild"),
			{ parse } = require("yaml");

		await fs.mkdir(out, { recursive: true });
		const api = parse(await fs.readFile(root + "/api/openapi.yaml", "utf8"));
		const bookingExamples =
			api.paths["/owner/booking-link"].get.responses[200].content[
				"application/json"
			].examples;
		const profile =
			api.paths["/owner/me"].get.responses[200].content["application/json"]
				.examples.mvp.value;
		const schemaName = api.paths[
			"/owner/booking-link"
		].get.responses[200].content["application/json"].schema.$ref
			.split("/")
			.at(-1);
		const allConditions =
			api.components.schemas[schemaName].properties.missing.items.enum;
		const reply = (path, status, label) => ({
			status,
			value:
				api.paths[path].get.responses[status].content[
					status === 200 ? "application/json" : "application/problem+json"
				].examples[label].value,
		});
		const prerequisites = {
			"/owner/shop": {
				condition: "license_verified",
				ready: reply("/owner/shop", 200, "verified"),
				missing: reply("/owner/shop", 200, "pending"),
			},
			"/owner/price-list": {
				condition: "price_list",
				ready: reply("/owner/price-list", 200, "current"),
				missing: reply("/owner/price-list", 404, "not_set"),
			},
			"/owner/operating-rules": {
				condition: "operating_rules",
				ready: reply("/owner/operating-rules", 200, "current"),
				missing: reply("/owner/operating-rules", 200, "template"),
			},
			"/owner/calendar": {
				condition: "calendar",
				ready: reply("/owner/calendar", 200, "settings"),
				missing: reply("/owner/calendar", 404, "not_set"),
			},
			"/owner/payment-destination": {
				condition: "payment_destination",
				ready: reply("/owner/payment-destination", 200, "account"),
				missing: reply("/owner/payment-destination", 404, "not_set"),
			},
			"/owner/kakao-channel": {
				condition: "kakao_channel",
				ready: reply("/owner/kakao-channel", 200, "linked"),
				missing: reply("/owner/kakao-channel", 404, "not_set"),
			},
		};
		const problemSamples = {};
		for (const path of [
			"/owner/me",
			"/owner/booking-link",
			...Object.keys(prerequisites),
			"/owner/operating-rules/versions/{version}",
		]) {
			const samples = {};
			for (const response of Object.values(api.paths[path].get.responses))
				for (const example of Object.values(
					response.content?.["application/problem+json"]?.examples ?? {},
				))
					samples[example.value.code] ??= example.value;
			problemSamples[path] = samples;
		}
		const entry = `import ${JSON.stringify(root + "/app/web/src/styles")};import ${JSON.stringify(root + "/app/web/src/styles/fonts")};import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter,Routes,Route} from 'react-router';import {OwnerArea} from ${JSON.stringify(root + "/app/web/src/OwnerArea")};
const bookingExamples=${JSON.stringify(bookingExamples)},profile=${JSON.stringify(profile)},prerequisites=${JSON.stringify(prerequisites)},problemSamples=${JSON.stringify(problemSamples)},allConditions=${JSON.stringify(allConditions)};
let scenario='normal',bookingReads=0,meReads=0,refresh=()=>{},shopGone=false,missing=[],issuedOnce=true,pickupMissing=false;
function selectScenario(value){scenario=value==='becomes-not-ready'?'conditions-removed':value;bookingReads=meReads=0;shopGone=false;missing=value==='missing-all'?[...allConditions]:['empty','becomes-issued'].includes(value)?[...bookingExamples.not_ready.value.missing]:[];issuedOnce=missing.length===0;pickupMissing=!issuedOnce||scenario==='issued-no-pickup';}
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':status>=400?'application/problem+json':'application/json','Cache-Control':'no-store'}});
const problem=(path,code,status,instance)=>{const sample=problemSamples[path][code];if(!sample||sample.status!==status)throw new Error('Unknown synthetic problem');return json({...structuredClone(sample),...(instance?{instance}:{})},status);};
const issued=()=>({...structuredClone(bookingExamples.issued.value),recommended:pickupMissing?['pickup_address']:[],...(scenario==='long-url'?{url:'https://siljang.example/s/'+'p'.repeat(1900)}:{})});
function setup(path){const definition=prerequisites[path],reply=structuredClone(missing.includes(definition.condition)?definition.missing:definition.ready);if(path==='/owner/shop'){const shop=reply.value;shop.bookingUrl=issuedOnce?issued().url:null;shop.pickupAddress=pickupMissing?null:prerequisites[path].ready.value.pickupAddress;shop.settingsSummary={...shop.settingsSummary,priceListVersion:missing.includes('price_list')?null:prerequisites['/owner/price-list'].ready.value.version,operatingRulesVersion:missing.includes('operating_rules')?null:prerequisites['/owner/operating-rules'].ready.value.version,paymentConfigured:!missing.includes('payment_destination'),kakaoChannelStatus:missing.includes('kakao_channel')?null:prerequisites['/owner/kakao-channel'].ready.value.status};}return json(reply.value,reply.status);}
globalThis.fetch=async(input,init)=>{const raw=String(input),parsed=new URL(raw,'http://example.org'),path=parsed.pathname.startsWith('/api/')?parsed.pathname.slice(4):parsed.pathname,method=(init?.method??'GET').toUpperCase();
 if(path==='/owner/session'&&method==='DELETE')return new Response(null,{status:204});
 if(method!=='GET')return new Response(null,{status:405,headers:{Allow:'GET'}});
 if(path==='/owner/me'){meReads++;refresh();if(scenario==='session-pending')return new Promise(()=>{});if(scenario==='session-failed')return problem(path,'internal',500);return json({...profile,shop:shopGone?null:{...profile.shop,licenseStatus:missing.includes('license_verified')?'pending':'verified'}});}
 if(path==='/owner/booking-link'){bookingReads++;refresh();if(scenario==='loading')return new Promise(()=>{});if(scenario==='permission')return problem(path,'unauthenticated',401);if(scenario==='shop-missing'){shopGone=true;return problem(path,'shop_not_registered',404);}if(scenario==='error'||scenario==='stale'&&bookingReads>1)return problem(path,'internal',500);if(scenario==='conditions-removed'&&bookingReads>1)missing=['payment_destination'];if(scenario==='becomes-issued'&&bookingReads>1){missing=[];pickupMissing=false;}if(issuedOnce||missing.length===0){issuedOnce=true;return json(issued());}return json({...structuredClone(bookingExamples.not_ready.value),missing:[...missing],recommended:pickupMissing?['pickup_address']:[]});}
 if(Object.hasOwn(prerequisites,path))return setup(path);
 return problem('/owner/operating-rules/versions/{version}','not_found',404,parsed.pathname);
};
function Fixture(){const[g,next]=useState(0),[,tick]=useState(0);refresh=()=>tick(value=>value+1);return <><aside className='qa-control'><label>시험 상태<select value={scenario} onChange={event=>{selectScenario(event.target.value);history.replaceState(null,'','/owner/booking-link');next(value=>value+1)}}>{['normal','empty','error','loading','permission','stale','shop-missing','conditions-removed','becomes-issued','issued-no-pickup','missing-all','long-url','session-pending','session-failed'].map(value=><option key={value}>{value}</option>)}</select></label><p>합성 응답 · 예약 링크 {bookingReads} · 신원 {meReads} · 실제 서비스 쓰기 없음</p></aside><BrowserRouter key={g}><Routes><Route path='/owner/login' element={<main><h1>합성 로그인 화면</h1><p>다시 로그인해 주세요</p></main>}/><Route path='/owner/*' element={<OwnerArea/>}/></Routes></BrowserRouter></>};if(location.pathname==='/')history.replaceState(null,'','/owner/booking-link');createRoot(document.getElementById('root')).render(<Fixture/>);`;
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
				"QA055_V3_READY_",
			),
		);
		await fs.appendFile(
			out + "/qa.css",
			"\n@media(min-width:1260px){.qa-control{margin-left:var(--size-menu)}}\n",
		);
		const head =
			'<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><link rel="icon" href="/synthetic-photo.svg"><title>합성 예약 링크 검사</title><link rel="stylesheet" href="/main.css"><link rel="stylesheet" href="/qa.css"><script src="/qa-observe.js"></script><script src="/checker.js"></script></head>';
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
			primaryStates: 6,
			responseRows: 5,
			browserRun: false,
			outsideServices: 0,
			scope:
				"HEAD와 같은 실제 OwnerArea/BookingLinkScreen·토큰/폰트/OpenAPI 합성 자료. 실제 브라우저 성공이 아님",
			prerequisiteReads: Object.keys(prerequisites),
			newTab:
				"예약 주소는 OpenAPI의 예약된 .example 도메인. 실제 발급 주소/도착 화면은 자기 가게 실환경 확인에서 대조",
			setupWrites:
				"다른 설정은 진입 조회만 제공. 저장 확인은 해당 TASK 자료를 사용",
		};
		await fs.writeFile(
			out + "/manifest.json",
			JSON.stringify(manifest, null, 2) + "\n",
		);
		return {
			source,
			out,
			entry,
			primaryStates: 6,
			responseRows: 5,
			browserRun: false,
		};
	});
}
if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const { entry, ...metadata } = await buildBookingLink(
		process.argv[2],
		process.argv[3],
	);
	console.log(JSON.stringify(metadata));
}
