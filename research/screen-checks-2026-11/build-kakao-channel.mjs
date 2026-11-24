import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
export async function buildKakaoChannel(repositoryRoot = '.', destination = join(tmpdir(), 'siljang-qa054-channel')) {
const root = resolve(repositoryRoot).replaceAll('\\', '/'), out = resolve(destination);
const support = join(dirname(fileURLToPath(import.meta.url)), 'support');
const require = createRequire(join(root, 'app/package.json'));
const { build } = require('esbuild'), { parse } = require('yaml');
const entryFile = join(out, 'fixture-source.tsx');
await fs.mkdir(out, { recursive: true });
const api = parse(await fs.readFile(root + '/api/openapi.yaml', 'utf8'));
const routes = [
  { path: '/owner/kakao-channel', method: 'get' },
  { path: '/owner/kakao-channel', method: 'put' },
  { path: '/owner/kakao-channel/check', method: 'post' },
  { path: '/owner/kakao-channel/skill-key', method: 'post' },
];
const rows = routes.flatMap(route => Object.entries(api.paths[route.path][route.method].responses).flatMap(([status, response]) =>
  Object.entries(Object.values(response.content)[0].examples ?? {}).map(([name, example]) => ({
    ...route, name, status: status === 'default' ? 500 : Number(status), value: example.value,
    id: `${route.method.toUpperCase()} ${route.path} ${status}:${name}`,
    extraHeaderCase: name === 'missing_idempotency_key',
  }))));
if (rows.length !== 43 || rows.filter(x => !x.extraHeaderCase).length !== 41) throw new Error('contract rows changed');
const samples = Object.fromEntries(Object.entries(api.paths[routes[0].path].get.responses[200].content['application/json'].examples).map(([k,v]) => [k,v.value]));
const primary = ['normal','loading','empty','error','permission','stale','submitting','checking','event-off','done'];
const extras = ['checking-completes','checking-timeout','session-pending','session-failed','maximum'];
const entry = `import ${JSON.stringify(root+'/app/web/src/styles')};import ${JSON.stringify(root+'/app/web/src/styles/fonts')};import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter,Routes,Route} from 'react-router';import {OwnerArea} from ${JSON.stringify(root+'/app/web/src/OwnerArea')};
const rows=${JSON.stringify(rows)},samples=${JSON.stringify(samples)},primary=${JSON.stringify(primary)},extras=${JSON.stringify(extras)};
let scenario='normal',reads=0,meReads=0,writes=[],refresh=()=>{},shopGone=false,current=null,started=Date.now();
const traceId='0123456789abcdef0123456789abcdef',json=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{'Content-Type':'application/json'}}),problem=(s,code,extra={})=>json({code,traceId,...extra},s),profile={owner:{ownerId:'00000000-0000-4000-8000-000000000054',alertChannelFriend:false,createdAt:'2026-11-23T08:00:00Z'},shop:{shopId:'00000000-0000-4000-8000-000000000055',name:'합성 채널 가게',licenseStatus:'pending'}};
const selected=()=>rows.find(x=>'row:'+x.id===scenario);
function relativeTimes(c){if(c.status==='pending'){if(c.claimExpiresAt!==null)c.claimExpiresAt=new Date(started+1800000).toISOString();if(c.checkStartedAt!==null&&c.checkExpiresAt!==null){c.checkStartedAt=new Date(started).toISOString();c.checkExpiresAt=new Date(started+600000).toISOString()}if(c.proofPhrase!==null)c.proofPhrase='연결 123456'}return c}
function channel(name='linked'){const c=structuredClone(samples[name]);c.botId='synthetic-channel-bot';c.channelPublicId='_synthetic';for(const k of Object.keys(c.blockIds))if(c.blockIds[k]!==null)c.blockIds[k]='synthetic-'+k;c.skill.messageSkillUrl='https://skill.example.test/message';c.skill.cardSkillUrl='https://skill.example.test/card';c.skill.reviewSkillUrl='https://skill.example.test/review';c.skill.eventSkillUrl='https://skill.example.test/event';if(c.status==='pending'){c.checkStartedAt=new Date(started).toISOString();c.checkExpiresAt=new Date(started+(scenario==='checking-timeout'?12000:600000)).toISOString();c.claimExpiresAt=new Date(started+1800000).toISOString();c.proofPhrase='연결 123456'}return c}
function initial(){const row=selected();if(row&&row.method==='post'&&row.path.endsWith('/check')){const c=channel('failed');if(row.name==='channel_setup_incomplete')c.blockIds.review=null;return c}if(scenario==='error')return channel('failed');if(scenario.startsWith('checking'))return channel('pending');if(scenario==='event-off')return channel('event_unavailable');const c=channel();c.eventStatus='unchecked';c.eventCheckedAt=null;c.eventFailReason=null;if(scenario==='maximum'){c.botId='B'.repeat(64);c.blockIds=Object.fromEntries(Object.keys(c.blockIds).map(k=>[k,'X'.repeat(100)]));for(const k of ['messageSkillUrl','cardSkillUrl','reviewSkillUrl','eventSkillUrl'])c.skill[k]='https://skill.example.test/'+'p'.repeat(1950)}return c}
function commandSuccess(p,body){
 const created=current===null,c=created?relativeTimes(structuredClone(rows.find(x=>x.method==='put'&&x.name==='created').value.kakaoChannel)):structuredClone(current);
 if(p.endsWith('/skill-key')){c.skill.keyVersion++;c.skill.keyIssuedAt=new Date().toISOString();c.skill.previousKeyValidUntil=body?.previousKey==='revoke_now'?null:new Date(Date.now()+86400000).toISOString();return {outcome:'done',kakaoChannel:c,skillKey:{headerName:'Siljang-Skill-Key',headerValue:'A'.repeat(43),keyVersion:c.skill.keyVersion}}}
 if(p.endsWith('/check')){started=Date.now();Object.assign(c,channel('pending'));return {outcome:'done',kakaoChannel:c,skillKey:null}}
 if(body){c.botId=body.botId;c.channelPublicId=body.channelPublicId;c.blockIds=body.blockIds}c.revision='synthetic-saved-'+writes.length;if(created)c.skill.keyIssuedAt=new Date().toISOString();return {outcome:created?'created':'done',kakaoChannel:c,skillKey:created?{headerName:'Siljang-Skill-Key',headerValue:'A'.repeat(43),keyVersion:c.skill.keyVersion}:null}
}
globalThis.fetch=async(input,init)=>{const p=String(input),method=(init?.method||'GET').toLowerCase(),row=selected();if(p==='/api/owner/me'){meReads++;refresh();if(scenario==='session-pending')return new Promise(()=>{});if(scenario==='session-failed')return problem(500,'internal');return json({...profile,shop:shopGone?null:profile.shop})}if(method==='delete')return new Response(null,{status:204});if(!p.startsWith('/api/owner/kakao-channel'))return problem(404,'not_found');if(method==='get'){reads++;refresh();if(scenario==='loading')return new Promise(()=>{});if(scenario==='permission')return problem(401,'unauthenticated');if((scenario==='empty'||scenario==='done')&&writes.length===0)return problem(404,'not_set');if(row&&row.method==='get'){if(row.value.code==='shop_not_registered')shopGone=true;const v=structuredClone(row.value);if(v.status==='pending'){v.checkStartedAt=new Date(started).toISOString();v.checkExpiresAt=new Date(started+600000).toISOString();v.claimExpiresAt=new Date(started+1800000).toISOString()}return json(v,row.status)}if(row?.name==='created'&&writes.length===0)return problem(404,'not_set');if(current===null)current=initial();if(scenario==='checking-completes'&&reads>=3){current=channel();current.eventStatus='unchecked';current.eventCheckedAt=null;current.eventFailReason=null}if(scenario==='checking-timeout'&&Date.now()>=started+12000)current=channel('failed');if(scenario==='stale'&&writes.length){current={...current,botId:'synthetic-remote-bot',revision:'synthetic-remote-revision'}}return json(current)}
const body=init?.body?JSON.parse(String(init.body)):null;writes.push({path:p,method,body,key:new Headers(init.headers).get('Idempotency-Key')});refresh();if(scenario==='submitting')return new Promise(()=>{});if(row&&row.path==p.slice(4)&&row.method===method&&writes.length===1){if(row.value.code==='shop_not_registered')shopGone=true;const v=structuredClone(row.value);if(v.kakaoChannel){if(row.name==='started'&&row.path.endsWith('/check'))started=Date.now();current=relativeTimes(v.kakaoChannel)}return json(v,row.status)}if(scenario==='stale'&&writes.length===1)return problem(409,'version_conflict');const v=commandSuccess(p,body);current=v.kakaoChannel;return json(v)};
function Fixture(){const[g,next]=useState(0),[,tick]=useState(0);refresh=()=>tick(n=>n+1);const first=writes[0],last=writes.at(-1),row=selected();return <><aside className='qa-control'><label>시험 상태<select value={scenario} onChange={e=>{scenario=e.target.value;reads=meReads=0;writes=[];shopGone=false;current=null;started=Date.now();history.replaceState(null,'','/owner/kakao-channel');next(n=>n+1)}}><optgroup label='기본10상태'>{primary.map(v=><option key={v}>{v}</option>)}</optgroup><optgroup label='추가확인'>{extras.map(v=><option key={v}>{v}</option>)}</optgroup><optgroup label='계약41행과헤더추가2행'>{rows.map(v=><option key={v.id} value={'row:'+v.id}>{v.id}</option>)}</optgroup></select></label><p>합성 응답 · 읽기 {reads} · 명령 {writes.length} · 신원 {meReads} · 요청키 종류 {new Set(writes.map(x=>x.key)).size} · 첫본문일치 {String(!!first&&!!last&&JSON.stringify(first.body)===JSON.stringify(last.body))} · 키빈값 {String(writes.some(x=>!x.key))} · 실제 서비스 쓰기 없음</p>{row?<p>대상 {row.id} · {row.extraHeaderCase?'화면41행밖추가':'화면계약행'} · {row.method==='get'?'조회즉시':row.path.endsWith('/check')?'다시 확인을누름':row.path.endsWith('/skill-key')?'스킬설정값펼친뒤스킬키바꾸기':row.name==='created'?'빈폼봇ID/블록5개입력후저장':'채널바꾸기뒤봇ID변경/저장'}</p>:<p>stale/submitting은채널바꾸기뒤봇ID한값을바꾸고저장합니다. done은빈폼의봇ID/블록5개를채우고첫저장/일회성키를확인합니다. checking-completes는자연조회3회뒤완료합니다. 전부합성값입니다.</p>}</aside><BrowserRouter key={g}><Routes><Route path='/owner/login' element={<main><h1>합성 로그인 화면</h1><p>다시 로그인해 주세요</p></main>}/><Route path='/owner/*' element={<OwnerArea/>}/></Routes></BrowserRouter></>};if(location.pathname==='/')history.replaceState(null,'','/owner/kakao-channel');createRoot(document.getElementById('root')).render(<Fixture/>);`;
await fs.writeFile(entryFile, entry);
await build({absWorkingDir:root,entryPoints:[entryFile],outdir:out,bundle:true,jsx:'automatic',format:'esm',minify:true,nodePaths:[join(root,'app/node_modules')],define:{'import.meta.env.VITE_API_BASE':'"/api"','process.env.NODE_ENV':'"production"'},loader:{'.woff2':'file','.woff':'file','.png':'file'},assetNames:'assets/[name]-[hash]',entryNames:'main'});
await fs.rm(entryFile,{force:true});
const pageCheck=await fs.readFile(root+'/tools/corthex/page-check.js','utf8');
await fs.writeFile(out+'/checker.js','window.__siljangCheck=()=>(\n'+pageCheck.trim().replace(/;$/, '')+'\n);');
await fs.writeFile(out+'/page-check.js',pageCheck);
for(const p of ['qa-observe.js','observer-selftest.html','observer-selftest.js','qa.css'])await fs.copyFile(support+'/'+p,out+'/'+p);
await fs.writeFile(out+'/index.html','<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><link rel="icon" href="/synthetic-photo.svg"><title>합성 카카오 채널 화면 확인</title><link rel="stylesheet" href="/main.css"><link rel="stylesheet" href="/qa.css"><script src="/qa-observe.js"></script><script src="/checker.js"></script></head><body><div id="root"></div><script type="module" src="/main.js"></script></body></html>');
await fs.copyFile(support+'/synthetic-photo.svg',out+'/synthetic-photo.svg');
await fs.writeFile(out+'/server.mjs',await fs.readFile(support+'/server.mjs','utf8'));
await fs.writeFile(out+'/manifest.json',JSON.stringify({localSourceCommit:execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),primary,extras,responseRows:rows.map(({value,...r})=>r),browserRun:false,syntheticOnly:true,servicesWrite:false,note:'생성된 합성 응답 자료입니다. 실제 브라우저 검사 결과가 아닙니다.'},null,2)+'\n');
return {out,primary:primary.length,responses:rows.length,screenRows:41,browserRun:false,entry};
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const {entry, ...result} = await buildKakaoChannel(process.argv[2], process.argv[3]);
  console.log(JSON.stringify(result));
}
