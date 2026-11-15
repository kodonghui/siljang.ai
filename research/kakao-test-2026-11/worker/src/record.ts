// 받은 요청 하나의 기록(KV 값). 마스킹한 본문·헤더·Cloudflare 정보와, OPEN-1을 보는 해시들을 담는다.

import { hmacHex, keyPaths, maskJson, maskText, shapeOf, unknownIdLikePaths, type Json } from "./mask.ts";

export const SKILL_KEY_HEADER = "siljang-skill-key";

/** 값을 그대로 둘 헤더. 나머지 헤더는 이름과 꼴·HMAC만(메시지 ID 같은 값이 헤더로 오는지 보려고) */
const KEEP_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "accept-charset",
  "content-type",
  "content-length",
  "user-agent",
  "x-forwarded-proto",
  "cf-ipcountry",
  "cf-visitor",
  "cf-ray",
]);

/** 스킬 요청에서만 남기는 출처 IP 헤더(카카오 서버의 주소, OPEN-10·TASK-010). 로그인 경로에서는 사람의 주소라 남기지 않음 */
const IP_HEADERS = new Set(["cf-connecting-ip", "x-forwarded-for", "x-real-ip", "true-client-ip", "cf-connecting-ipv6"]);

export async function maskHeaders(
  hashKey: string,
  headers: Headers,
  opt: { keepIp: boolean; skillKey?: string },
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, value] of headers) {
    const n = name.toLowerCase();
    if (n === SKILL_KEY_HEADER) {
      out[n] = opt.skillKey && safeEqual(value, opt.skillKey) ? "present:matches" : "present:differs";
    } else if (n === "authorization" || n === "cookie") {
      out[n] = `omitted:${value.length}`;
    } else if (KEEP_HEADERS.has(n)) {
      out[n] = maskText(value);
    } else if (IP_HEADERS.has(n)) {
      if (opt.keepIp) out[n] = value;
    } else {
      out[n] = `${shapeOf(value)}:${(await hmacHex(hashKey, "h\u0000" + value)).slice(0, 12)}`;
    }
  }
  return out;
}

export type CfInfo = Record<string, string | number | null>;

export function cfInfo(cf: unknown): CfInfo {
  const o = cf && typeof cf === "object" ? (cf as Record<string, unknown>) : {};
  const pick = (k: string) => (typeof o[k] === "string" || typeof o[k] === "number" ? (o[k] as string | number) : null);
  return {
    colo: pick("colo"),
    country: pick("country"),
    asn: pick("asn"),
    asOrganization: pick("asOrganization"),
    httpProtocol: pick("httpProtocol"),
    tlsVersion: pick("tlsVersion"),
    clientTcpRtt: pick("clientTcpRtt"),
  };
}

/** OPEN-1의 확인 전 가정: 메시지 ID가 없으면 (봇 ID, 사용자 키, 블록 ID, 발화, 받은 시각을 2초로 내린 값)의 해시 */
export async function dedupCandidate(hashKey: string, p: Record<string, Json>, receivedMs: number): Promise<string> {
  const g = (o: Json | undefined, ...ks: string[]): string => {
    let v: Json | undefined = o;
    for (const k of ks) v = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json>)[k] : undefined;
    return typeof v === "string" ? v : "";
  };
  const parts = [
    g(p, "bot", "id"),
    g(p, "userRequest", "user", "id"),
    g(p, "userRequest", "block", "id"),
    g(p, "userRequest", "utterance"),
    String(Math.floor(receivedMs / 2000)),
  ];
  return "dk:" + (await hmacHex(hashKey, parts.join("\u0000"))).slice(0, 12);
}

export type SkillRecordBase = {
  v: 1;
  receivedAt: string;
  route: string;
  headers: Record<string, string>;
  cf: CfInfo;
  bodyBytes: number;
  bodyHash: string;
  dedupKey: string;
  keys: string[];
  newIdLikePaths: string[];
  payload: Json;
};

export async function skillRecordBase(o: {
  hashKey: string;
  skillKey?: string;
  receivedMs: number;
  route: string;
  headers: Headers;
  cf: unknown;
  raw: string;
  payload: Record<string, Json>;
}): Promise<SkillRecordBase> {
  const keys = keyPaths(o.payload);
  return {
    v: 1,
    receivedAt: new Date(o.receivedMs).toISOString(),
    route: o.route,
    headers: await maskHeaders(o.hashKey, o.headers, { keepIp: true, skillKey: o.skillKey }),
    cf: cfInfo(o.cf),
    bodyBytes: new TextEncoder().encode(o.raw).length,
    bodyHash: "bh:" + (await hmacHex(o.hashKey, "b\u0000" + o.raw)).slice(0, 12),
    dedupKey: await dedupCandidate(o.hashKey, o.payload, o.receivedMs),
    keys,
    newIdLikePaths: unknownIdLikePaths(keys),
    payload: await maskJson(o.hashKey, o.payload),
  };
}

/** 스킬 키 비교. 길이가 달라도 끝까지 견줘 글자마다 걸리는 시간이 같게 */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** 기록 키: rec:<받은 시각 ISO>:<무작위 4자>. 시각 차례로 나열됨 */
export function recordKey(receivedMs: number): string {
  const r = [...crypto.getRandomValues(new Uint8Array(2))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `rec:${new Date(receivedMs).toISOString()}:${r}`;
}
