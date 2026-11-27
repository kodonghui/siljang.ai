import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../staging-monitor/", import.meta.url));
const event = JSON.stringify({scriptName:"siljang-staging",logs:[],event:{request:{url:"https://example.com/private-value/[code:4321]"}}});

function runFake(body, extraEnv = {}) {
  const root = mkdtempSync(join(tmpdir(), "siljang-tail-test-"));
  try {
    const monitor = join(root, "tools", "staging-monitor");
    mkdirSync(dirname(monitor), {recursive:true});
    cpSync(source, monitor, {recursive:true});
    const fake = join(root, "app", "node_modules", "wrangler", "wrangler-dist", "cli.js");
    mkdirSync(dirname(fake), {recursive:true});
    writeFileSync(fake, body);
    const preload=join(root,"fast.cjs");
    writeFileSync(preload, 'const t=global.setTimeout; global.setTimeout=(fn,ms,...args)=>t(fn,ms===70000?500:ms===73000?1200:ms,...args);');
    const result=spawnSync(process.execPath,[join(monitor,"read-job-logs.mjs")],{cwd:root,env:{...process.env,...extraEnv,NODE_OPTIONS:`--require=${preload}`},encoding:"utf8",timeout:5000});
    assert.equal(result.error, undefined);
    assert.equal(result.stderr, "");
    return result;
  } finally {rmSync(root,{recursive:true,force:true});}
}

test("요청 주소의 숫자를 제공자 오류로 내보내지 않는다", () => {
  const result=runFake(`process.stdout.write(${JSON.stringify(event)});process.exitCode=1;`);
  assert.equal(result.status,1);
  assert.deepEqual(JSON.parse(result.stdout), {diagnostic:"worker_job_logs",observed:1,failures:0,verified:false,exitCode:1});
  assert.doesNotMatch(result.stdout,/4321|private-value|example\.com/);
});

test("표준 오류에서는 제공자 코드만 남긴다", () => {
  const result=runFake(`process.stderr.write('[ERROR] private-value https://example.com/private-value [code:10000]');process.exitCode=1;`);
  assert.equal(result.status,1);
  assert.deepEqual(JSON.parse(result.stdout), {diagnostic:"worker_job_logs",observed:0,failures:0,verified:false,exitCode:1,kind:"provider_error",providerCode:10000});
  assert.doesNotMatch(result.stdout,/private-value|example\.com/);
});

test("시간 제한 뒤 Wrangler 오류 종료는 실패다", () => {
  const result=runFake(`process.stdout.write(${JSON.stringify(event)});process.on('SIGINT',()=>{process.stderr.write('[ERROR] [code:10000]');process.exit(1)});setInterval(()=>{},1000);`);
  assert.equal(result.status,1);
  assert.equal(JSON.parse(result.stdout).verified,false);
  assert.equal(JSON.parse(result.stdout).providerCode,10000);
});

test("관찰 뒤 의도한 종료 신호는 성공이다", () => {
  const result=runFake(`process.stdout.write(${JSON.stringify(event)});setInterval(()=>{},1000);`);
  assert.equal(result.status,0);
  assert.equal(JSON.parse(result.stdout).verified,true);
});

test("관찰 뒤 강제 종료는 실패다", () => {
  const result=runFake(`process.stdout.write(${JSON.stringify(event)});process.on('SIGINT',()=>{});setInterval(()=>{},1000);`);
  assert.equal(result.status,1);
  assert.equal(JSON.parse(result.stdout).verified,false);
});

test("자식의 디스크 로그와 마스킹 환경을 강제한다", () => {
  const result=runFake(`if(process.env.WRANGLER_WRITE_LOGS!=='false' || process.env.WRANGLER_LOG_SANITIZE!=='true') process.exit(1);process.stdout.write(${JSON.stringify(event)});`,{WRANGLER_WRITE_LOGS:"true",WRANGLER_LOG_SANITIZE:"false"});
  assert.equal(result.status,0);
});
