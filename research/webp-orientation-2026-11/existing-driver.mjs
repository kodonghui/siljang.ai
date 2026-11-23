import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { activeVersionId, versionConfiguration } from './active-version.mjs';
const worker='siljang-kakao-test', baseline='448d489b-225f-4ddf-84f7-fa3a525a5a18';
const queueName='siljang-kakao-test-callbacks', keyName='PHOTO_RESOURCE_PROBE_KEY', prefix='/__task183_resource';
const folder=process.env.SILJANG_PROBE_FOLDER, cliPath=process.env.SILJANG_WRANGLER_CLI, config=join(folder,'wrangler.json');
const apiBase='https://api.cloudflare.com/client/v4/accounts/'+process.env.CLOUDFLARE_ACCOUNT_ID;
const records=[],results=[];let metrics=null,original,originalQueue,queueId,url,key,apiToken,mutating=false,restored=false,start,end;
mkdirSync(join(folder,'output'),{recursive:true});
function save(){writeFileSync(join(folder,'report.json'),JSON.stringify({worker,baseline,source:process.env.SILJANG_SOURCE_SHA,records,results,metrics},null,2));}
function emit(row){records.push(row);save();console.log(JSON.stringify(row));}
function fail(code){throw new Error(code);}
function localApiToken(){
 if(process.env.CLOUDFLARE_API_TOKEN)return process.env.CLOUDFLARE_API_TOKEN;
 const r=spawnSync(process.execPath,[cliPath,'auth','token','--json'],{encoding:'utf8',timeout:15000});
 if(r.error||r.status!==0)fail('academy_oauth_token_unavailable');
 const credential=JSON.parse(r.stdout);
 if(credential.type!=='oauth'||typeof credential.token!=='string'||!credential.token)fail('academy_oauth_token_unavailable');
 return credential.token;
}
async function api(path,options={}){
 const r=await fetch(apiBase+path,{...options,headers:{Authorization:'Bearer '+apiToken,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(25000)});
 let j;try{j=await r.json();}catch{fail('api_response_invalid');}
 if(!r.ok||!j.success){emit({event:'photo_existing_api_failed',status:r.status,codes:(j.errors??[]).map(e=>e.code).filter(Number.isSafeInteger)});fail('api_failed');}
 return j.result;
}
function cli(args,input){
 const r=spawnSync(process.execPath,[cliPath,...args,'--config',config],{input,encoding:'utf8',timeout:90000,maxBuffer:5000000,stdio:['pipe','pipe','pipe']});
 if(r.error||r.status!==0){emit({event:'photo_existing_cli_failed',operation:args[0],exitCode:r.status,apiCode:/\[code:\s*(\d+)\]/.exec((r.stderr??'')+(r.stdout??''))?.[1]??null});fail('cli_failed');}
 return r.stdout;
}
async function currentVersion(){
 return activeVersionId(await api('/workers/scripts/'+worker+'/deployments'));
}
async function activeConfiguration(){
 const id=await currentVersion();
 const [version,settings]=await Promise.all([api('/workers/scripts/'+worker+'/versions/'+id),api('/workers/scripts/'+worker+'/settings')]);
 return versionConfiguration(version,settings);
}
function bindings(settings){return settings.bindings.map(b=>{
 const shape={name:b.name,type:b.type};
 if(b.type==='plain_text')shape.text=b.text;
 else if(b.type==='kv_namespace')shape.namespace_id=b.namespace_id;
 else if(b.type==='queue')shape.queue_name=b.queue_name;
 else if(!['secret_text','images'].includes(b.type))fail('unsupported_binding');
 return shape;
}).sort((a,b)=>a.name.localeCompare(b.name));}
function queueShape(q){return {settings:q.settings,consumers:(q.consumers??[]).map(c=>({id:c.consumer_id,script:c.script_name??c.script,type:c.type,settings:c.settings})).sort((a,b)=>a.id.localeCompare(b.id))};}
function equal(a,b){return isDeepStrictEqual(a,b);}
async function request(path,options={}){
 const r=await fetch(url+path,{...options,redirect:'error',signal:AbortSignal.timeout(60000)});return r;
}
async function health(){const r=await request('/health');const text=await r.text();return r.status===200&&text.trim()==='ok';}
async function ready(expected,authenticated=false){
 for(let i=0;i<15;i++){
  const r=await request(prefix+'/stream',{headers:authenticated?{Authorization:'Bearer '+key}:{}});const status=r.status;await r.body?.cancel();
  if(status===expected)return;
  if(![401,404].includes(status))fail('probe_unexpected_readiness_status');
  await new Promise(r=>setTimeout(r,1000));
 }
 fail('probe_not_ready');
}
try{
 apiToken=localApiToken();
 original=await activeConfiguration();
 if(await currentVersion()!==baseline)fail('baseline_changed');
 const shape=bindings(original),expected=['CALLBACKS','EVENT_NAME','HASH_KEY','KAKAO_CLIENT_SECRET','KAKAO_REST_API_KEY','RECORDS','RECORD_TTL_SECONDS','SKILL_KEY'].sort();
 if(!equal(shape.map(b=>b.name).sort(),expected)||original.compatibility_date!=='2026-10-01'||original.observability?.enabled===true)fail('baseline_shape_invalid');
 const kv=original.bindings.find(b=>b.name==='RECORDS'&&b.type==='kv_namespace');
 const producer=original.bindings.find(b=>b.name==='CALLBACKS'&&b.type==='queue');
 if(!kv||!/^[a-f0-9]{32}$/.test(kv.namespace_id)||producer?.queue_name!==queueName)fail('binding_scope_invalid');
 const domains=(await api('/workers/domains')).filter(d=>d.service===worker);
 if(domains.length!==1)fail('domain_not_unique');url='https://'+domains[0].hostname;
 if(!await health())fail('baseline_health_failed');
 const queueList=(await api('/queues?name='+queueName)).filter(q=>q.queue_name===queueName);
 if(queueList.length!==1)fail('queue_not_unique');queueId=queueList[0].queue_id;
 originalQueue=await api('/queues/'+queueId);const cs=originalQueue.consumers??[];const c=cs[0];
 if(cs.length!==1||(c.script_name??c.script)!==worker||typeof c.consumer_id!=='string'||c.settings.batch_size!==1||c.settings.max_wait_time_ms!==1000||c.settings.max_retries!==0||c.settings.retry_delay!==0)fail('consumer_shape_invalid');
 const vars=Object.fromEntries(original.bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text]));
 if(Object.values(vars).some(v=>typeof v!=='string'))fail('plain_variables_missing');
 writeFileSync(config,JSON.stringify({name:worker,main:'probe.mjs',compatibility_date:original.compatibility_date,compatibility_flags:original.compatibility_flags??[],preview_urls:false,workers_dev:false,observability:{enabled:false},images:{binding:'IMAGES'},vars,kv_namespaces:[{binding:'RECORDS',id:kv.namespace_id}],queues:{producers:[{binding:'CALLBACKS',queue:queueName}],consumers:[{queue:queueName,max_batch_size:1,max_batch_timeout:1,max_retries:0}]}}));
 emit({event:'photo_existing_baseline_verified',baseline,health:true,bindingNames:shape.map(b=>b.name),queueConsumerCount:1,queueConfigurationMatched:true});
 mutating=true;
 cli(['deploy','--domain',domains[0].hostname,'--keep-vars','--tag','task183-'+process.env.SILJANG_SOURCE_SHA.slice(0,12)]);
 await ready(401);
 if(!await health())fail('wrapped_health_failed');
 emit({event:'photo_existing_default_denial',status:401,healthPreserved:true,version:await currentVersion()});
 key=randomBytes(32).toString('base64url');cli(['secret','put',keyName],key+'\n');
 await ready(405,true);
 const deployed=await activeConfiguration();
 if(!equal(bindings(deployed).filter(b=>!['IMAGES',keyName].includes(b.name)),shape)||!equal(queueShape(await api('/queues/'+queueId)),queueShape(originalQueue)))fail('deployed_configuration_changed');
 emit({event:'photo_existing_probe_ready',version:await currentVersion(),bindingNamesPreserved:true,queuePreserved:true,secretName:keyName});
 const cases=JSON.parse(readFileSync(join(folder,'input','manifest.json'),'utf8'));const deadline=Date.now()+330000;
 start=new Date(Date.now()-1000).toISOString();
 for(const mode of ['stream','multipart'])for(const c of cases){
  if(Date.now()>deadline)fail('validation_deadline');
  if(!/^[a-z0-9-]+$/.test(c.name))fail('case_name_invalid');
  const input=readFileSync(join(folder,'input',c.name+'.webp'));const headers={Authorization:'Bearer '+key};let body;
  if(mode==='multipart'){body=new FormData();body.set('purpose','completion_photo');body.set('file',new File([input],'synthetic.webp',{type:'image/webp'}));}
  else{body=input;headers['Content-Type']='image/webp';}
  const began=performance.now();const r=await request(prefix+'/'+mode,{method:'POST',headers,body});const bytes=new Uint8Array(await r.arrayBuffer());
  const row={name:c.name,mode,status:r.status,contentType:r.headers.get('content-type'),uploadStatus:r.headers.get('x-upload-status'),elapsedMs:Math.round(performance.now()-began),outputBytes:bytes.length};
  if(r.status===200&&row.contentType==='image/webp')writeFileSync(join(folder,'output',mode+'-'+c.name+'.webp'),bytes);
  else row.workerErrorCode=/Error\s+(\d{4})/.exec(new TextDecoder().decode(bytes.subarray(0,8192)))?.[1]??null;
  results.push(row);emit({event:'photo_existing_case',...row});
  if(r.status!==200||row.contentType!=='image/webp'||mode==='multipart'&&row.uploadStatus!=='201')fail('case_failed');
 }
 end=new Date(Date.now()+1000).toISOString();
 emit({event:'photo_existing_http_complete',cases:results.length,start,end});
}catch(error){emit({event:'photo_existing_failed',code:error instanceof Error&&/^[a-z_]+$/.test(error.message)?error.message:'execution_failed'});process.exitCode=1;}
finally{
 end??=new Date(Date.now()+1000).toISOString();
 if(mutating){
  try{
   cli(['rollback',baseline,'--yes','--message','TASK-183 합성 자원 검사 종료']);
   const current=await activeConfiguration();const queue=await api('/queues/'+queueId);
   const r=await request(prefix+'/stream');const status=r.status;await r.body?.cancel();
   const proof={event:'photo_existing_restored',version:await currentVersion(),bindingsRestored:equal(bindings(current),bindings(original)),queueRestored:equal(queueShape(queue),queueShape(originalQueue)),health:await health(),probeGone:status===404};
   restored=proof.version===baseline&&proof.bindingsRestored&&proof.queueRestored&&proof.health&&proof.probeGone;emit({...proof,passed:restored});
   if(!restored)process.exitCode=1;
  }catch(error){emit({event:'photo_existing_restore_failed',code:error instanceof Error&&/^[a-z_]+$/.test(error.message)?error.message:'restore_failed'});process.exitCode=1;}
 }
 save();
}
if(start&&restored){
 try{
  const query='query Metric($account: string, $start: string, $end: string, $script: string) { viewer { accounts(filter: {accountTag: $account}) { workersInvocationsAdaptive(limit: 1000, filter: {scriptName: $script, datetime_geq: $start, datetime_leq: $end}) { sum { requests errors } quantiles { cpuTimeP99 cpuTimeP999 memoryUsageBytesP99 memoryUsageBytesP999 } avg { sampleInterval } dimensions { datetime status } } } } }';
  for(let i=0;i<4;i++){
   const r=await fetch('https://api.cloudflare.com/client/v4/graphql',{method:'POST',headers:{Authorization:'Bearer '+apiToken,'Content-Type':'application/json'},body:JSON.stringify({query,variables:{account:process.env.CLOUDFLARE_ACCOUNT_ID,start,end,script:worker}}),signal:AbortSignal.timeout(25000)});
   const j=await r.json();if(!r.ok||j.errors){emit({event:'photo_existing_metrics_rejected',status:r.status,schemaError:(j.errors??[]).some(e=>/Cannot query field|unknown field|Unknown type/.test(e.message))});break;}
   const rows=j.data.viewer.accounts.flatMap(a=>a.workersInvocationsAdaptive);metrics={start,end,measurement:'GraphQL invocation quantiles; CPU microseconds, V8 isolate memory bytes; quantiles are not peak memory',rows};save();
   if(rows.length){
    const max=field=>{const n=rows.map(v=>v.quantiles?.[field]).filter(Number.isFinite);return n.length?Math.max(...n):null;};
    emit({event:'photo_existing_metrics',groups:rows.length,requests:rows.reduce((n,v)=>n+v.sum.requests,0),errors:rows.reduce((n,v)=>n+v.sum.errors,0),cpuP999MaximumUs:max('cpuTimeP999'),memoryP999MaximumBytes:max('memoryUsageBytesP999'),sampleIntervalMaximum:Math.max(...rows.map(v=>v.avg.sampleInterval))});break;
   }
   emit({event:'photo_existing_metrics_pending',groups:0});if(i<3)await new Promise(r=>setTimeout(r,10000));
  }
 }catch{emit({event:'photo_existing_metrics_failed'});}
}
save();
