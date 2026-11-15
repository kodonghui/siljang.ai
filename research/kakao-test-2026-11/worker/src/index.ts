// 카카오 시험 서버(TASK-008). 대본: docs/10-wbs/kakao-test-script.md, 쓰는 법: research/kakao-test-2026-11/README.md
// 경로: POST /skill(스킬), GET /login/start·/login/callback(카카오 로그인 PKCE, K-11), GET /health
// 기록: KV RECORDS의 rec:* 키(손님 값은 마스킹, RECORD_TTL_SECONDS 뒤 지워짐). 기록을 공개로 읽는 경로는 없고 wrangler로만 읽는다.
// 실패하면 닫힘: SKILL_KEY·HASH_KEY 비밀 값이 없으면 스킬 요청을 받지도 기록하지도 않고 503.

import {
  CALLBACK_DELAYS,
  LATE_MS,
  REVIEW_PARAMS,
  botIdReply,
  callbackDelay,
  callbackReplies,
  classify,
  emptyVariant,
  findUrls,
  imageHostAllowed,
  lateReply,
  loginCard,
  menuReply,
  photoReply,
  reviewAskCard,
  reviewReply,
  sameReply,
  secureImageUrls,
  startReply,
  type ItemId,
  type Payload,
} from "./items.ts";
import { simpleText, useCallback, type SkillResponse } from "./kakao.ts";
import {
  OUTCOME_LABEL,
  TOKEN_URL,
  authorizeUrl,
  isMode,
  isOutcome,
  outcomeOf,
  makeState,
  makeTicket,
  randomB64url,
  resultPage,
  s256,
  stateValid,
  summarizeToken,
  ticketValid,
  tokenForm,
  verdict,
  type LoginMode,
  type Outcome,
  type TokenSummary,
} from "./login.ts";
import { keyPaths, maskJson, maskText, maskUrl, shapeOf, userToken, type Json } from "./mask.ts";
import { SKILL_KEY_HEADER, cfInfo, maskHeaders, recordKey, safeEqual, skillRecordBase } from "./record.ts";

export interface Env {
  RECORDS: KVNamespace;
  CALLBACKS: Queue<CallbackMsg>;
  SKILL_KEY?: string;
  HASH_KEY?: string;
  KAKAO_REST_API_KEY?: string;
  KAKAO_CLIENT_SECRET?: string;
  EVENT_NAME?: string;
  RECORD_TTL_SECONDS?: string;
  /** 사진을 받으러 갈 호스트를 더할 때(쉼표 목록). 기본은 카카오 쪽 도메인만(items.ts IMAGE_HOSTS) */
  EXTRA_IMAGE_HOSTS?: string;
}

/** 콜백을 늦게 보낼 때 큐에 넣는 값. 콜백 주소는 한 번 쓰면 끝나는 주소라 큐에만 잠깐 둠 */
export type CallbackMsg = { callbackUrl: string; delaySec: number; receivedMs: number; recordKey: string; callbackBlockId: string | null };

const MAX_BODY = 256 * 1024;
/** waitUntil은 응답 뒤 30초까지(Workers 한도 문서). 그보다 길면 큐의 delaySeconds로 */
const WAIT_UNTIL_MAX_SEC = 25;
const IMAGE_TIMEOUT_MS = 2500;
const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const IMAGE_MAX_REDIRECTS = 3;
const EVENT_TASK_WAIT_MS = 8000;
const CFG_TTL = 30 * 86400;
/** 키 없이 닿을 수 있는 기록(키가 틀린 스킬 요청, 오류)은 Worker 인스턴스마다 이 수까지만 */
const UNAUTH_RECORD_CAP = 20;
let unauthRecords = 0;

function takeUnauthRecord(): boolean {
  if (unauthRecords >= UNAUTH_RECORD_CAP) return false;
  unauthRecords++;
  return true;
}

type Answer = {
  item: ItemId;
  status?: number;
  body: SkillResponse | string | null;
  /** 기록에 남길 답이 대화창 답과 다를 때(봇 ID 끝 4자) */
  recorded?: SkillResponse;
  extra?: Record<string, Json>;
};

/** skipped: "host"(처음 주소가 허용 호스트 밖), "redirect-host"(리다이렉트가 허용 호스트 밖으로 감). redirects는 꼴만 남긴 주소 */
type Probe = {
  status: number | null;
  contentType: string | null;
  bytes: number | null;
  truncated: boolean;
  ms: number;
  redirects: string[];
  skipped: "host" | "redirect-host" | null;
  error: string | null;
};

function ttl(env: Env): number {
  const n = Number(env.RECORD_TTL_SECONDS);
  return Number.isFinite(n) && n >= 60 ? Math.floor(n) : 14 * 86400;
}

async function putRecord(env: Env, key: string, rec: unknown): Promise<void> {
  await env.RECORDS.put(key, JSON.stringify(rec), { expirationTtl: ttl(env) });
}

/** 설정 값(블록 ID 등)은 저장에 실패해도 답은 보냄 */
async function putQuiet(env: Env, key: string, value: string, expirationTtl: number): Promise<void> {
  try {
    await env.RECORDS.put(key, value, { expirationTtl });
  } catch {
    // 기록 쪽 실패는 답을 막지 않음
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

function errName(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${maskText(e.message).slice(0, 160)}`;
  return "unknown";
}

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function html(status: number, title: string, lines: string[]): Response {
  return new Response(resultPage(title, lines), {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}

/** 사진 주소를 바로 받아 상태·종류·크기만 잼. 대화창에 적힌 아무 주소로나 요청하지 않도록 허용 호스트(카카오 쪽)만 받고,
 *  리다이렉트도 직접 따라가며 호스트마다 다시 확인함(최대 3번) */
async function probeImage(url: string, extraHosts: string | undefined): Promise<Probe> {
  const t = Date.now();
  const redirects: string[] = [];
  const done = (p: Partial<Probe>): Probe => ({
    status: null,
    contentType: null,
    bytes: null,
    truncated: false,
    redirects,
    skipped: null,
    error: null,
    ...p,
    ms: Date.now() - t,
  });
  const signal = AbortSignal.timeout(IMAGE_TIMEOUT_MS);
  let current = url;
  try {
    for (let hop = 0; ; hop++) {
      if (!imageHostAllowed(current, extraHosts)) return done({ skipped: hop === 0 ? "host" : "redirect-host" });
      const r = await fetch(current, { redirect: "manual", signal });
      const location = r.headers.get("location");
      if (r.status >= 300 && r.status < 400 && location) {
        await r.body?.cancel();
        if (hop >= IMAGE_MAX_REDIRECTS) return done({ status: r.status, error: `리다이렉트 ${IMAGE_MAX_REDIRECTS}번 넘음` });
        current = new URL(location, current).toString();
        redirects.push(maskUrl(current));
        continue;
      }
      let bytes = 0;
      let truncated = false;
      if (r.body) {
        const reader = r.body.getReader();
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += (chunk.value as Uint8Array).byteLength;
          if (bytes > IMAGE_MAX_BYTES) {
            truncated = true;
            await reader.cancel();
            break;
          }
        }
      }
      // 사진은 세기만 하고 버림(저장하지 않음)
      return done({ status: r.status, contentType: r.headers.get("content-type"), bytes, truncated });
    }
  } catch (e) {
    return done({ error: errName(e) });
  }
}

function describeProbe(p: Probe): string {
  if (p.skipped) return p.skipped === "host" ? "건너뜀: 카카오 쪽 호스트가 아님(기록에 주소 꼴이 남음)" : "건너뜀: 리다이렉트가 카카오 쪽 밖으로 감";
  const hops = p.redirects.length ? ` · 리다이렉트 ${p.redirects.length}번` : "";
  return `${p.status ?? "받기 실패"} · ${p.contentType ?? "-"} · ${p.bytes ?? "-"}바이트${p.truncated ? "(20MB에서 멈춤)" : ""} · ${p.ms}ms${hops}${p.error ? ` · ${p.error}` : ""}`;
}

type SkillCtx = { env: Env; ctx: ExecutionContext; req: Request; p: Payload; key: string; receivedMs: number; hashKey: string; dedupKey: string; bodyHash: string; newIdPaths: string[]; colo: string };

async function answer(item: ItemId, c: SkillCtx): Promise<Answer> {
  const { env, p } = c;
  const props = p.userRequest?.user?.properties ?? {};
  switch (item) {
    case "K-01":
      return {
        item,
        body: startReply({
          recordKey: c.key,
          ms: Date.now() - c.receivedMs,
          colo: c.colo,
          isFriend: props.isFriend === true,
          hasAppUserId: typeof props.appUserId === "string",
        }),
      };
    case "K-02":
      return { item, body: sameReply({ dedupKey: c.dedupKey, bodyHash: c.bodyHash, newIdPaths: c.newIdPaths }) };
    case "K-03a":
    case "K-03b":
      await sleep((LATE_MS[item] ?? 0) - (Date.now() - c.receivedMs));
      return { item, body: lateReply(item, Date.now() - c.receivedMs), extra: { waitedMs: LATE_MS[item] ?? 0 } };
    case "K-04-1":
    case "K-04-2":
    case "K-04-3":
    case "K-04-4": {
      const v = emptyVariant(item);
      return { item, status: v?.status ?? 200, body: v?.body ?? null };
    }
    case "K-05":
      return callbackItem(c);
    case "K-06": {
      const found = findUrls(p).slice(0, 5);
      const probes = await Promise.all(found.slice(0, 3).map((f) => probeImage(f.url, env.EXTRA_IMAGE_HOSTS)));
      return {
        item,
        body: photoReply(found, probes.map(describeProbe)),
        extra: { photo: { found: found.map((f) => ({ path: f.path, url: maskUrl(f.url) })), probes } },
      };
    }
    case "K-07":
    case "K-08b":
      return reviewItem(item, c);
    case "K-07-setup":
      return {
        item,
        body: simpleText(
          `후기 시험(K-07): 이 요청에는 후기 블록의 파라미터(${REVIEW_PARAMS.text}·${REVIEW_PARAMS.photos}·${REVIEW_PARAMS.consent})가 없어요. 대본 1절대로 '후기 시험' 블록을 만든 뒤 다시 해 주세요.`,
        ),
      };
    case "K-08": {
      const reviewBlockId = await env.RECORDS.get("cfg:reviewBlockId");
      if (!reviewBlockId) {
        return { item, body: simpleText("후기 부탁(K-08): 먼저 K-07 후기 시험을 끝까지 한 번 해 주세요. 그때 서버가 후기 블록을 기억해요.") };
      }
      const orderNo = `T-${randomHex(2).toUpperCase()}`;
      const uk = await userToken(c.hashKey, p.userRequest?.user?.id ?? "");
      await putQuiet(env, `pending:review:${uk}`, JSON.stringify({ orderNo, at: c.receivedMs }), 1800);
      return { item, body: reviewAskCard(reviewBlockId, orderNo), extra: { orderNo } };
    }
    case "K-09": {
      const { reply, recorded } = botIdReply(p.bot?.id ?? "");
      return { item, body: reply, recorded };
    }
    case "K-10":
      return eventItem(c);
    case "K-10b": {
      const sentAt = p.userRequest?.params?.sentAt;
      const lagSec = typeof sentAt === "string" && !Number.isNaN(Date.parse(sentAt)) ? Math.round((c.receivedMs - Date.parse(sentAt)) / 100) / 10 : null;
      return {
        item,
        body: simpleText(`이벤트 시험(K-10b): Event API로 부른 스킬 요청을 받았어요. 부른 지 ${lagSec ?? "?"}초.`),
        extra: { lagSec, utteranceLength: [...(p.userRequest?.utterance ?? "")].length },
      };
    }
    case "K-11": {
      if (!env.KAKAO_REST_API_KEY) {
        return { item, body: simpleText("로그인 시험(K-11): 시험 서버에 REST API 키가 없어 할 수 없어요(README의 배포 2단계).") };
      }
      return { item, body: loginCard(new URL(c.req.url).origin, await makeTicket(c.hashKey, Date.now())) };
    }
    case "K-00":
    default:
      return { item: "K-00", body: menuReply(true) };
  }
}

async function callbackItem(c: SkillCtx): Promise<Answer> {
  const { env, ctx, p } = c;
  const callbackUrl = p.userRequest?.callbackUrl;
  if (!callbackUrl) {
    return {
      item: "K-05",
      body: simpleText("콜백 시험(K-05): 이 블록 요청에는 콜백 주소(callbackUrl)가 없어요. 대본 1절의 '콜백 시험' 블록에서 Callback 설정을 켜고, 배포한 운영 채널에서 해 주세요."),
      extra: { callbackUrl: false },
    };
  }
  const blockId = p.userRequest?.block?.id ?? null;
  if (blockId && (await c.env.RECORDS.get("cfg:callbackBlockId")) !== blockId) await putQuiet(env, "cfg:callbackBlockId", blockId, CFG_TTL);
  const delaySec = callbackDelay(p);
  const msg: CallbackMsg = { callbackUrl, delaySec, receivedMs: c.receivedMs, recordKey: c.key, callbackBlockId: blockId };
  const via = delaySec <= WAIT_UNTIL_MAX_SEC ? "waitUntil" : "queue";
  if (via === "waitUntil") {
    ctx.waitUntil(sleep(delaySec * 1000 - (Date.now() - c.receivedMs)).then(() => sendCallback(env, msg, via)));
  } else {
    await env.CALLBACKS.send(msg, { delaySeconds: delaySec });
  }
  return {
    item: "K-05",
    body: useCallback(`콜백 시험: ${delaySec}초 뒤에 답할게요.`),
    extra: { callbackUrl: true, delaySec, via, nextDelays: CALLBACK_DELAYS },
  };
}

async function sendCallback(env: Env, m: CallbackMsg, via: string): Promise<void> {
  const elapsedSec = Math.round((Date.now() - m.receivedMs) / 100) / 10;
  const body = simpleText(
    `콜백 시험(K-05): ${m.delaySec}초를 기다렸다가 받은 지 ${elapsedSec}초 뒤에 보냈어요. 다음 기다림을 눌러 주세요.`,
    callbackReplies(m.callbackBlockId),
  );
  const t = Date.now();
  let httpStatus: number | null = null;
  let kakao: Json = null;
  let error: string | null = null;
  try {
    const r = await fetch(m.callbackUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    httpStatus = r.status;
    const text = await r.text();
    try {
      kakao = JSON.parse(text) as Json;
    } catch {
      kakao = maskText(text.slice(0, 300));
    }
  } catch (e) {
    error = errName(e);
  }
  await putRecord(env, recordKey(Date.now()), {
    v: 1,
    kind: "callback_result",
    item: "K-05",
    forRecord: m.recordKey,
    via,
    delaySec: m.delaySec,
    elapsedSec,
    postMs: Date.now() - t,
    callbackUrl: maskUrl(m.callbackUrl),
    httpStatus,
    kakao: env.HASH_KEY ? await maskJson(env.HASH_KEY, kakao) : null,
    error,
  });
}

async function reviewItem(item: "K-07" | "K-08b", c: SkillCtx): Promise<Answer> {
  const { env, p } = c;
  const params = p.action?.params ?? {};
  const text = params[REVIEW_PARAMS.text];
  const consent = params[REVIEW_PARAMS.consent];
  const urls = secureImageUrls(params[REVIEW_PARAMS.photos]).slice(0, 10);
  const probes = await Promise.all(urls.map((u) => probeImage(u, env.EXTRA_IMAGE_HOSTS)));
  const clientExtra = p.action?.clientExtra && typeof p.action.clientExtra === "object" ? p.action.clientExtra : {};
  const orderNo = typeof clientExtra.orderNo === "string" ? clientExtra.orderNo : null;
  const uk = await userToken(c.hashKey, p.userRequest?.user?.id ?? "");
  const pendingRaw = await env.RECORDS.get(`pending:review:${uk}`);
  const pending = pendingRaw ? (JSON.parse(pendingRaw) as { orderNo: string; at: number }) : null;
  // 후기 부탁(K-08)을 보낸 뒤라면 extra가 없어도 버튼으로 연 것으로 봄(남지 않았다는 결과)
  const it: "K-07" | "K-08b" = item === "K-08b" || pending ? "K-08b" : "K-07";
  const blockId = p.userRequest?.block?.id;
  if (blockId) await putQuiet(env, "cfg:reviewBlockId", blockId, CFG_TTL);
  if (pending) {
    try {
      await env.RECORDS.delete(`pending:review:${uk}`);
    } catch {
      // 지우지 못해도 30분 TTL로 지워짐
    }
  }
  return {
    item: it,
    body: reviewReply(it, {
      textLen: typeof text === "string" ? [...text].length : null,
      photos: probes.map(describeProbe),
      consent: typeof consent === "string" ? consent : null,
      extraKeys: Object.keys(clientExtra),
      orderNo,
      pending: Boolean(pending),
    }),
    extra: {
      review: {
        textLength: typeof text === "string" ? [...text].length : null,
        photoCount: urls.length,
        probes,
        consentLength: typeof consent === "string" ? [...consent].length : null,
        extraKeys: Object.keys(clientExtra),
        pending: Boolean(pending),
        orderNoMatches: pending ? orderNo === pending.orderNo : null,
        secondsSinceAsk: pending ? Math.round((c.receivedMs - pending.at) / 1000) : null,
      },
    },
  };
}

async function eventItem(c: SkillCtx): Promise<Answer> {
  const { env, ctx, p } = c;
  if (!env.KAKAO_REST_API_KEY) {
    return { item: "K-10", body: simpleText("이벤트 시험(K-10): 시험 서버에 REST API 키가 없어 건너뛰어요. 이 항목은 선택이에요.") };
  }
  const botId = p.bot?.id;
  const userKey = p.userRequest?.user?.id;
  if (!botId || !userKey) return { item: "K-10", body: simpleText("이벤트 시험(K-10): 요청에 봇 ID나 사용자 키가 없어요.") };
  const sentAt = new Date().toISOString();
  ctx.waitUntil(callEventApi(env, { botId, userKey, sentAt, forRecord: c.key }));
  return {
    item: "K-10",
    body: simpleText("이벤트 시험(K-10): Event API를 불렀어요. 몇 초 안에 이 대화창에 이벤트 블록의 말풍선이 오면 성공이에요."),
    extra: { sentAt },
  };
}

async function callEventApi(env: Env, o: { botId: string; userKey: string; sentAt: string; forRecord: string }): Promise<void> {
  const hashKey = env.HASH_KEY ?? "";
  const restKey = env.KAKAO_REST_API_KEY ?? "";
  const eventName = env.EVENT_NAME || "siljang_test_event";
  const body = {
    event: { name: eventName, data: { text: "시험 서버가 부른 이벤트" } },
    user: [{ type: "botUserKey", id: o.userKey }],
    params: { check: "event", sentAt: o.sentAt },
  };
  const attempts: Json[] = [];
  let taskId: string | null = null;
  // 개발 채널은 봇 ID 끝에 '!'(Event API 문서). 받은 봇 ID로 먼저 보내고 'Invalid bot ID'면 '!'를 붙여 한 번 더
  const ids = o.botId.endsWith("!") ? [o.botId] : [o.botId, `${o.botId}!`];
  for (const id of ids) {
    const t = Date.now();
    let httpStatus: number | null = null;
    let res: Json = null;
    let error: string | null = null;
    try {
      const r = await fetch(`https://bot-api.kakao.com/v2/bots/${encodeURIComponent(id)}/talk`, {
        method: "POST",
        headers: { authorization: `KakaoAK ${restKey}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      httpStatus = r.status;
      const text = await r.text();
      try {
        res = JSON.parse(text) as Json;
      } catch {
        res = maskText(text.slice(0, 300));
      }
    } catch (e) {
      error = errName(e);
    }
    attempts.push({ botIdShape: shapeOf(id), httpStatus, ms: Date.now() - t, kakao: await maskJson(hashKey, res), error });
    const o2 = res && typeof res === "object" && !Array.isArray(res) ? (res as Record<string, Json>) : {};
    if (o2.status === "SUCCESS" && typeof o2.taskId === "string") {
      taskId = o2.taskId;
      break;
    }
    if (!/invalid bot id/i.test(String(o2.message ?? ""))) break;
  }
  let task: Json = null;
  if (taskId) {
    await sleep(EVENT_TASK_WAIT_MS);
    try {
      const r = await fetch(`https://bot-api.kakao.com/v1/tasks/${encodeURIComponent(taskId)}`, {
        headers: { authorization: `KakaoAK ${restKey}` },
        signal: AbortSignal.timeout(8000),
      });
      const text = await r.text();
      let parsed: Json;
      try {
        parsed = JSON.parse(text) as Json;
      } catch {
        parsed = maskText(text.slice(0, 300));
      }
      task = { httpStatus: r.status, result: await maskJson(hashKey, parsed) };
    } catch (e) {
      task = { error: errName(e) };
    }
  }
  await putRecord(env, recordKey(Date.now()), { v: 1, kind: "event_result", item: "K-10", forRecord: o.forRecord, eventName, attempts, taskId, task });
}

async function handleSkill(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const receivedMs = Date.now();
  if (!env.SKILL_KEY || !env.HASH_KEY) return new Response("not configured", { status: 503 });
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY) return new Response("too large", { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return new Response("too large", { status: 413 });
  const hashKey = env.HASH_KEY;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const obj = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, Json>) : null;
  const given = req.headers.get(SKILL_KEY_HEADER);
  if (given === null || !safeEqual(given, env.SKILL_KEY)) {
    // 스킬 요청처럼 생긴 것만, 인스턴스마다 정한 수까지만 남김(아무나 보낸 요청으로 KV 쓰기 한도를 쓰지 않게). 출처 IP는 남기지 않음
    if (obj && ("userRequest" in obj || "bot" in obj) && takeUnauthRecord()) {
      ctx.waitUntil(
        (async () =>
          putRecord(env, recordKey(receivedMs), {
            v: 1,
            kind: "skill_rejected",
            receivedAt: new Date(receivedMs).toISOString(),
            route: "/skill",
            headers: await maskHeaders(hashKey, req.headers, { keepIp: false, skillKey: env.SKILL_KEY }),
            cf: cfInfo(req.cf),
            bodyBytes: new TextEncoder().encode(raw).length,
            keys: keyPaths(obj),
          }))(),
      );
    }
    return new Response("unauthorized", { status: 401 });
  }
  if (!obj) return new Response("bad request", { status: 400 });

  const key = recordKey(receivedMs);
  const base = await skillRecordBase({ hashKey, skillKey: env.SKILL_KEY, receivedMs, route: "/skill", headers: req.headers, cf: req.cf, raw, payload: obj });
  const p = obj as Payload;
  const c: SkillCtx = {
    env,
    ctx,
    req,
    p,
    key,
    receivedMs,
    hashKey,
    dedupKey: base.dedupKey,
    bodyHash: base.bodyHash,
    newIdPaths: base.newIdLikePaths,
    colo: String(base.cf.colo ?? "?"),
  };
  const a = await answer(classify(p), c);
  const status = a.status ?? 200;
  const shown = a.recorded ?? a.body;
  const response: Json =
    shown === null ? { status, body: null } : typeof shown === "string" ? { status, bodyText: shown } : { status, body: await maskJson(hashKey, shown as unknown as Json) };
  ctx.waitUntil(putRecord(env, key, { ...base, kind: "skill", item: a.item, durationMs: Date.now() - receivedMs, response, extra: a.extra ?? null }));

  if (a.body === null) return new Response(null, { status });
  if (typeof a.body === "string") return new Response(a.body, { status, headers: { "content-type": "application/json; charset=utf-8" } });
  return json(a.body, status);
}

async function loginStart(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode");
  if (!isMode(mode)) return html(400, "로그인 시험 모드가 없어요", ["대화창의 '로그인 시험' 카드 버튼으로 열어 주세요."]);
  if (!env.HASH_KEY) return html(503, "로그인 시험을 할 수 없어요", ["시험 서버에 비밀 값이 없어요(README의 배포 2단계)."]);
  if (!(await ticketValid(env.HASH_KEY, url.searchParams.get("t"), Date.now())))
    return html(403, "로그인 시험 표가 맞지 않아요", ["카드를 받은 지 30분이 지났거나 카드 버튼이 아닌 곳에서 열었어요. 대화창에서 '로그인 시험'을 다시 보내 주세요."]);
  if (!env.KAKAO_REST_API_KEY) return html(503, "로그인 시험을 할 수 없어요", ["시험 서버에 REST API 키가 없어요(README의 배포 2단계)."]);
  const state = await makeState(env.HASH_KEY);
  const verifier = mode === "plain" ? null : randomB64url(32);
  const challenge = verifier ? await s256(verifier) : undefined;
  await env.RECORDS.put(`login:${state}`, JSON.stringify({ mode, verifier, at: Date.now() }), { expirationTtl: 600 });
  return Response.redirect(authorizeUrl({ clientId: env.KAKAO_REST_API_KEY, redirectUri: `${url.origin}/login/callback`, state, challenge }), 302);
}

const MODE_LABEL: Record<LoginMode, string> = { pkce: "① PKCE", pkce_wrong: "② PKCE 틀린 값", plain: "③ PKCE 없이" };

async function loginCallback(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  const authError = url.searchParams.get("error");
  const authErrorDescription = url.searchParams.get("error_description");
  const again = "10분이 지났거나 이미 끝난 시험이에요. 대화창에서 '로그인 시험'을 다시 보내 주세요.";
  if (!env.HASH_KEY) return html(503, "로그인 시험을 할 수 없어요", ["시험 서버에 비밀 값이 없어요(README의 배포 2단계)."]);
  // 서버가 만든 state가 아니면 KV를 보지도, 기록을 쓰지도 않음
  if (!(await stateValid(env.HASH_KEY, state))) return html(400, "로그인 시험: state가 맞지 않아요", [again]);
  const saved = await env.RECORDS.get(`login:${state}`);
  const at = Date.now();
  if (!saved) {
    ctx.waitUntil(putRecord(env, recordKey(at), { v: 1, kind: "login_result", item: "K-11", stateFound: false, codeReceived: Boolean(code), authError }));
    return html(400, "로그인 시험: state를 찾지 못했어요", [again]);
  }
  await env.RECORDS.delete(`login:${state}`);
  const s = JSON.parse(saved) as { mode: LoginMode; verifier: string | null; at: number };
  let token: TokenSummary | null = null;
  let tokenError: string | null = null;
  if (code && env.KAKAO_REST_API_KEY) {
    // ②는 인가 요청에 보낸 challenge와 맞지 않는 새 verifier를 보냄
    const sentVerifier = s.mode === "pkce" ? s.verifier : s.mode === "pkce_wrong" ? randomB64url(32) : null;
    try {
      const r = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" },
        body: tokenForm({
          clientId: env.KAKAO_REST_API_KEY,
          redirectUri: `${url.origin}/login/callback`,
          code,
          clientSecret: env.KAKAO_CLIENT_SECRET || undefined,
          verifier: sentVerifier ?? undefined,
        }),
        signal: AbortSignal.timeout(8000),
      });
      let body: unknown = null;
      try {
        body = await r.json();
      } catch {
        body = null;
      }
      // 받은 토큰은 여기서 버림. 상태 코드·오류 코드·토큰이 있었는지만 남김
      token = summarizeToken(r.status, body);
    } catch (e) {
      tokenError = errName(e);
    }
  }
  // 인가 코드가 없으면(취소 등) 결과를 남기지 않음. 보내기 실패는 알 수 없는 오류로
  const outcome: Outcome | null = token ? outcomeOf(token) : tokenError ? "inconclusive" : null;
  if (outcome) await putQuiet(env, `cfg:login:${s.mode}`, outcome, 86400);
  const results: Partial<Record<LoginMode, Outcome>> = {};
  for (const m of ["pkce", "pkce_wrong", "plain"] as LoginMode[]) {
    const v = m === s.mode && outcome ? outcome : await env.RECORDS.get(`cfg:login:${m}`);
    if (isOutcome(v)) results[m] = v;
  }
  const judged = verdict(results);
  ctx.waitUntil(
    putRecord(env, recordKey(at), {
      v: 1,
      kind: "login_result",
      item: "K-11",
      mode: s.mode,
      stateFound: true,
      secondsSinceStart: Math.round((at - s.at) / 100) / 10,
      codeReceived: Boolean(code),
      authError,
      authErrorDescription: authErrorDescription ? maskText(authErrorDescription).slice(0, 200) : null,
      token,
      tokenError,
      outcome,
      results,
      verdict: judged,
    }),
  );
  const lines = [
    `인가 코드: ${code ? "받음" : `못 받음(${authError ?? "오류 없음"})`}`,
    token
      ? `토큰 요청: HTTP ${token.httpStatus}, ${token.ok ? "토큰 받음(서버에서 바로 버림)" : `거절(${[token.error, token.errorCode].filter(Boolean).join(", ") || "오류 코드 없음"})`}`
      : `토큰 요청: ${tokenError ?? "보내지 않음"}`,
    `지금까지 결과: ${(["pkce", "pkce_wrong", "plain"] as LoginMode[]).map((m) => `${MODE_LABEL[m]} ${results[m] === undefined ? "아직" : OUTCOME_LABEL[results[m]]}`).join(", ")}`,
    `판단: ${judged}`,
    "이 화면을 사진으로 남기고 대화창으로 돌아가 다음 버튼을 눌러 주세요.",
  ];
  return html(200, `카카오 로그인 시험 ${MODE_LABEL[s.mode]} 결과`, lines);
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/health") return new Response("ok");
      if (url.pathname === "/skill") {
        return req.method === "POST" ? await handleSkill(req, env, ctx) : new Response("method not allowed", { status: 405, headers: { allow: "POST" } });
      }
      if (url.pathname === "/login/start" && req.method === "GET") return await loginStart(req, env);
      if (url.pathname === "/login/callback" && req.method === "GET") return await loginCallback(req, env, ctx);
      return new Response("not found", { status: 404 });
    } catch (e) {
      // 오류 글에 손님 값이 섞일 수 있어 마스킹한 앞부분만. 키 없이 닿는 경로도 있어 인스턴스마다 정한 수까지만
      if (takeUnauthRecord())
        ctx.waitUntil(putRecord(env, recordKey(Date.now()), { v: 1, kind: "error", route: url.pathname, error: errName(e) }).catch(() => undefined));
      return new Response("error", { status: 500 });
    }
  },

  async queue(batch: MessageBatch<CallbackMsg>, env: Env): Promise<void> {
    for (const m of batch.messages) {
      try {
        await sendCallback(env, m.body, "queue");
      } catch (e) {
        await putRecord(env, recordKey(Date.now()), { v: 1, kind: "error", route: "queue", error: errName(e) }).catch(() => undefined);
      } finally {
        // 콜백 주소는 한 번만 쓰므로 다시 보내지 않음(max_retries 0)
        m.ack();
      }
    }
  },
} satisfies ExportedHandler<Env, CallbackMsg>;
