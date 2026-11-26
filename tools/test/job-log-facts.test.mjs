import assert from "node:assert/strict";
import test from "node:test";
import { jobLogFacts, TailObjects } from "../staging-monitor/job-log-facts.mjs";

const stamp = 1795700000000;
const tail = (message, extra = {}) => ({scriptName:"siljang-staging",outcome:"ok",logs:[{timestamp:stamp,message:[JSON.stringify(message)]}],...extra});

test("실패 분류만 남기고 내용과 식별자를 내보내지 않는다", () => {
  assert.deepEqual(jobLogFacts(tail({event:"job_find_failed",job:"purge",errorName:"DatabaseError",dbCode:"42501",itemId:"private-value",detail:"private-value"})),
    [{event:"job_find_failed",job:"purge",errorName:"DatabaseError",dbCode:"42501",at:new Date(stamp).toISOString()}]);
});
test("다른 Worker의 로그는 버린다", () => assert.deepEqual(jobLogFacts(tail({event:"job_find_failed"},{scriptName:"other"})),[]));
test("본문 같은 글/다른 사건은 무시한다", () => {
  assert.deepEqual(jobLogFacts(tail({event:"customer_message",detail:"private-value"})),[]);
  assert.deepEqual(jobLogFacts(tail("job_find_failed private-value")),[]);
});
test("정해지지 않은 분류와 원문은 버린다", () => {
  const facts=jobLogFacts(tail({event:"job_run_failed",job:"private-value",errorName:"private-value",dbCode:"ALICE",names:["private-value"]}));
  assert.deepEqual(facts,[{event:"job_run_failed",at:new Date(stamp).toISOString()}]);
});
test("잘못된 시각과 큰 로그는 내보내지 않는다", () => {
  assert.deepEqual(jobLogFacts({scriptName:"siljang-staging",logs:[{timestamp:Infinity,message:['{"event":"job_run_failed"}']}]}),[]);
  assert.deepEqual(jobLogFacts(tail({event:"job_run_failed",detail:"x".repeat(5000)})),[]);
});
test("조각난 JSON과 따옴표 안 괄호를 처리한다", () => {
  const p=new TailObjects(); const value=tail({event:"job_run_failed",detail:'private \\" } {'});const text=JSON.stringify(value);
  assert.deepEqual(p.push("connected\n"+text.slice(0,50)),[]);
  assert.deepEqual(p.push(text.slice(50)),[value]);
});
test("큰 이벤트는 실패 닫힘이며 원문을 오류로 내보내지 않는다", () => {
  assert.throws(()=>new TailObjects().push('{"private":"'+"x".repeat(300000)),/tail event too large/);
});
