// Worker tail에서 업무 내용/ID/주소를 버리고 정해진 오류 분류만 읽는다.
import { JOB_FAILURE_EVENTS } from "./job-policy.mjs";
const EVENTS = new Set(JOB_FAILURE_EVENTS);
const JOBS = new Set(["owner_wait", "consultation_idle", "payment_due", "difference_due", "day_before_notice", "review_request", "ledger_write", "purge", "customer_notice", "owner_alert", "channel_check", "access_log", "refund_send_realert", "kakao_callback_recovery"]);
const ERRORS = new Set(["Error", "TypeError", "RangeError", "DatabaseError", "SettingsError", "MissingSecretError", "AbortError", "JobActTimeoutError"]);

export function diagnosticFault(text) {
  const clean=text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,"");
  const code=clean.match(/\[code:\s*(\d{4,6})\]/);
  if (code) return {kind:"provider_error",providerCode:Number(code[1])};
  if (/unknown arguments?/i.test(clean)) return {kind:"invalid_cli_option"};
  if (/sampling rate must be between/i.test(clean)) return {kind:"invalid_sampling_rate"};
  return {};
}

export function jobLogFacts(envelope) {
  if (envelope?.scriptName !== "siljang-staging" || !Array.isArray(envelope.logs)) return [];
  const result=[];
  for (const log of envelope.logs.slice(0,100)) {
    if (!Number.isFinite(log.timestamp) || log.timestamp<0 || log.timestamp>253402300799999 || !Array.isArray(log.message)) continue;
    for (const message of log.message.slice(0,20)) {
      if (typeof message!=="string" || message.length>4096) continue;
      let value;
      try { value=JSON.parse(message); } catch { continue; }
      if (!value || !EVENTS.has(value.event)) continue;
      const fact={event:value.event,at:new Date(log.timestamp).toISOString()};
      if (JOBS.has(value.job)) fact.job=value.job;
      if (ERRORS.has(value.errorName)) fact.errorName=value.errorName;
      if (typeof value.dbCode==="string" && /^(08|22|23|25|28|3D|3F|40|42|53|54|55|57|58|F0|HV|P0|XX)[0-9A-Z]{3}$/.test(value.dbCode)) fact.dbCode=value.dbCode;
      if (Number.isSafeInteger(value.count) && value.count>=0 && value.count<=1000000) fact.count=value.count;
      result.push(fact);
    }
  }
  return result;
}

export class TailObjects {
  buffer=""; depth=0; quoted=false; escaped=false;
  push(chunk) {
    const results=[];
    for (const ch of chunk) {
      if (this.depth===0 && ch!=="{") continue;
      this.buffer+=ch;
      if (this.buffer.length>262144) { this.buffer="";throw new Error("tail event too large"); }
      if (this.quoted) {
        if (this.escaped) this.escaped=false;
        else if (ch==="\\") this.escaped=true;
        else if (ch==='"') this.quoted=false;
      } else if (ch==='"') this.quoted=true;
      else if (ch==="{") this.depth++;
      else if (ch==="}") this.depth--;
      if (this.depth===0) {
        try { results.push(JSON.parse(this.buffer)); } catch { /* 원문은 내보내지 않는다. */ }
        this.buffer="";
      }
    }
    return results;
  }
}
