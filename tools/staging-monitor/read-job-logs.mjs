// 기존 staging 배포 인증으로 최대70초 관찰한다. 원시 tail/오류/요청/헤더는 출력하지 않는다.
import { spawn } from "node:child_process";
import { TailObjects, diagnosticFault, jobLogFacts } from "./job-log-facts.mjs";

const parser=new TailObjects(); let observed=0, failures=0, failed=false, timedOut=false, fault={}, errorBuffer="";
const child=spawn("npx",["--no-install","wrangler","tail","siljang-staging","--format","json"],
  {detached:true,stdio:["ignore","pipe","pipe"],env:{...process.env,WRANGLER_SEND_METRICS:"false"}});
function stop(signal) { try { process.kill(-child.pid,signal); } catch { child.kill(signal); } }
function classify(chunk) {
  errorBuffer=(errorBuffer+chunk).slice(-4096);
  const value=diagnosticFault(errorBuffer);
  if (value.kind) fault=value;
}
child.stderr.setEncoding("utf8");child.stderr.on("data",classify);
child.stdout.setEncoding("utf8");
child.stdout.on("data",chunk=>{
  classify(chunk);
  try {
    for (const envelope of parser.push(chunk)) {
      if (envelope.scriptName!=="siljang-staging" || !Array.isArray(envelope.logs)) continue;
      observed++;
      for (const fact of jobLogFacts(envelope)) { failures++;process.stdout.write(JSON.stringify(fact)+"\n"); }
    }
  } catch { failed=true;stop("SIGTERM"); }
});
const timer=setTimeout(()=>{timedOut=true;stop("SIGINT");},70000);
const force=setTimeout(()=>stop("SIGKILL"),73000);
child.on("error",error=>{failed=true;fault={kind:["ENOENT","EACCES"].includes(error.code)?error.code:"spawn_error"};});
child.on("close",code=>{
  clearTimeout(timer);clearTimeout(force);
  const ok=!failed && observed>0 && (timedOut || code===0);
  process.stdout.write(JSON.stringify({diagnostic:"worker_job_logs",observed,failures,verified:ok,exitCode:code,...(ok?{}:fault)})+"\n");
  process.exitCode=ok?0:1;
});
