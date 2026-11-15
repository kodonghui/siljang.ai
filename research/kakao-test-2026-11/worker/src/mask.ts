// 손님 값 마스킹. 받은 요청의 구조·필드 이름·값의 길이는 두고, 사람을 가리킬 수 있는 값만 바꾼다.
// - 사용자 키(userRequest.user.id, botUserKey, plusfriendUserKey, appUserId): uk:<꼴>:<HMAC 앞 12자>
// - 그 밖의 ID(id, ...Id): id:<꼴>:<HMAC 앞 12자>. 같은 시험 서버 키로는 같은 값이 같은 표시라 요청끼리 견줄 수 있음
// - 주소(콜백·사진): 스킴·호스트와 경로의 꼴만(조각마다 {길이}, 마지막 확장자는 둠), 쿼리는 이름만(expires 값은 둠)
// - 글: 숫자가 7개 이상 이어지면(사이에 빈칸·점·붙임표 하나씩 허용) 숫자를 #으로, 이메일은 {email길이}
// - 글 안의 JSON(보안 이미지 플러그인 값 등)은 풀어서 같은 규칙으로 마스킹한 뒤 다시 글로
// 원래 값은 되살릴 수 없다. HMAC 키(HASH_KEY)는 Worker 비밀 값에만 있다.

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const enc = new TextEncoder();

export async function hmacHex(key: string, value: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 값의 글자 종류와 길이. 개발 채널 봇 ID처럼 끝에 '!'가 붙으면 꼴 끝에 '!' */
export function shapeOf(value: string): string {
  const bang = value.endsWith("!");
  const v = bang ? value.slice(0, -1) : value;
  let cls = "mixed";
  if (v.length === 0) cls = "empty";
  else if (/^[0-9]+$/.test(v)) cls = "digits";
  else if (/^[0-9a-f]+$/.test(v)) cls = "hex";
  else if (/^[0-9A-F]+$/.test(v)) cls = "HEX";
  else if (/^[0-9A-Za-z]+$/.test(v)) cls = "alnum";
  else if (/^[0-9A-Za-z_-]+$/.test(v)) cls = "b64url";
  return `${cls}${v.length}${bang ? "!" : ""}`;
}

export async function userToken(key: string, value: string): Promise<string> {
  return `uk:${shapeOf(value)}:${(await hmacHex(key, "u\u0000" + value)).slice(0, 12)}`;
}

export async function idToken(key: string, value: string): Promise<string> {
  return `id:${shapeOf(value)}:${(await hmacHex(key, "i\u0000" + value)).slice(0, 12)}`;
}

const URL_RE = /https?:\/\/[^\s()"'<>,]+/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 숫자 7개 이상(사이에 빈칸·점·붙임표 하나씩 허용). 전화·계좌·카드 번호 같은 값
const DIGITS_RE = /\d(?:[ .-]?\d){6,}/g;
// 날짜·시각(ISO 꼴)은 사람을 가리키지 않아 둠: 2023-03-31, 2023-03-31T05:25:58+0900
const ISO_RE = /\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/g;

/** 경로 조각 가운데 그대로 둘 짧은 영어 낱말(dn, dna, v1, callbacks 같은 것) */
function keepSegment(s: string): boolean {
  return /^[a-z]{1,10}$/.test(s) || /^v\d{1,2}$/.test(s);
}

export function maskUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `{url${raw.length}}`;
  }
  const parts = url.pathname.split("/");
  const segs = parts.map((s, i) => {
    if (!s) return s;
    if (i === parts.length - 1) {
      const m = s.match(/^(.*)(\.[A-Za-z0-9]{1,5})$/);
      if (m) return `${keepSegment(m[1]) ? m[1] : `{${m[1].length}}`}${m[2]}`;
    }
    return keepSegment(s) ? s : `{${s.length}}`;
  });
  const keys = [...new Set(url.searchParams.keys())];
  const q = keys.length
    ? "?" + keys.map((k) => (k === "expires" ? `expires=${url.searchParams.get("expires")}` : k)).join("&")
    : "";
  // 시험 서버 자신의 workers.dev 주소는 계정마다 다른 하위 도메인이라 지움
  const host = url.host.endsWith(".workers.dev") ? "{worker}.workers.dev" : url.host;
  return `${url.protocol}//${host}${segs.join("/")}${q}`;
}

function maskPlain(s: string): string {
  // ISO 날짜를 잠시 자리표로 바꿔 숫자 규칙에서 빼고, 끝나면 되돌림
  const kept: string[] = [];
  let t = s.replace(ISO_RE, (m) => {
    kept.push(m);
    return `\u0001${kept.length - 1}\u0001`;
  });
  t = t.replace(EMAIL_RE, (e) => `{email${e.length}}`);
  t = t.replace(DIGITS_RE, (d) => d.replace(/\d/g, "#"));
  return t.replace(/\u0001(\d+)\u0001/g, (_, i) => kept[Number(i)]);
}

/** 글 안의 주소는 maskUrl, 나머지는 숫자·이메일 규칙 */
export function maskText(s: string): string {
  let out = "";
  let last = 0;
  for (const m of s.matchAll(URL_RE)) {
    const at = m.index ?? 0;
    out += maskPlain(s.slice(last, at)) + maskUrl(m[0]);
    last = at + m[0].length;
  }
  return out + maskPlain(s.slice(last));
}

const USER_KEY_NAMES = new Set(["botUserKey", "plusfriendUserKey", "appUserId"]);

function isUserKey(path: string[], key: string): boolean {
  if (USER_KEY_NAMES.has(key)) return true;
  // userRequest.user.id, Event API 응답의 userID 같은 것
  if (key === "id" && path[path.length - 1] === "user") return true;
  return /^user_?id$/i.test(key);
}

function isIdKey(key: string): boolean {
  return key === "id" || /[a-z]Id$/.test(key) || /^(id|.*_id)$/i.test(key);
}

async function maskString(hashKey: string, path: string[], key: string, value: string): Promise<string> {
  if (isUserKey(path, key)) return userToken(hashKey, value);
  if (key === "taskId") return value; // 카카오가 만든 작업 ID(콜백·Event API 응답). 사람을 가리키지 않고 문의할 때 씀
  if (isIdKey(key)) return idToken(hashKey, value);
  if (key === "callbackUrl" || key === "webLinkUrl") return maskUrl(value);
  const t = value.trim();
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try {
      const inner = JSON.parse(t) as Json;
      return JSON.stringify(await maskJson(hashKey, inner, [...path, key]));
    } catch {
      // JSON이 아니면 글로 다룸
    }
  }
  return maskText(value);
}

/** 받은 JSON 전체를 마스킹한 사본. 키 이름·배열 길이·숫자·참거짓은 그대로 */
export async function maskJson(hashKey: string, value: Json, path: string[] = []): Promise<Json> {
  if (Array.isArray(value)) {
    const out: Json[] = [];
    for (const v of value) {
      const last = path[path.length - 1] ?? "";
      out.push(typeof v === "string" ? await maskString(hashKey, path, last, v) : await maskJson(hashKey, v, path));
    }
    return out;
  }
  if (value !== null && typeof value === "object") {
    const out: { [k: string]: Json } = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = typeof v === "string" ? await maskString(hashKey, path, k, v) : await maskJson(hashKey, v, [...path, k]);
    }
    return out;
  }
  return value;
}

/** JSON의 모든 경로(배열 자리는 []). 받은 요청에 어떤 필드가 있었는지 보는 증거 */
export function keyPaths(value: Json, prefix = ""): string[] {
  const out = new Set<string>();
  const walk = (v: Json, p: string) => {
    if (Array.isArray(v)) {
      v.forEach((x) => walk(x, `${p}[]`));
    } else if (v !== null && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        const q = p ? `${p}.${k}` : k;
        out.add(q);
        walk(x, q);
      }
    }
  };
  walk(value, prefix);
  return [...out].sort();
}

/** 카카오 문서(2026-11-15 확인)의 스킬 요청에 있는 ID·키 경로. 이것 말고 ID처럼 보이는 경로가 오면 OPEN-1의 메시지 ID 후보 */
export const KNOWN_ID_PATHS = new Set([
  "intent.id",
  "userRequest.block.id",
  "userRequest.user.id",
  "userRequest.user.properties.botUserKey",
  "userRequest.user.properties.plusfriendUserKey",
  "userRequest.user.properties.appUserId",
  "bot.id",
  "action.id",
  "flow.trigger.referrerBlock.id",
  "flow.lastBlock.id",
]);

export function unknownIdLikePaths(paths: string[]): string[] {
  return paths.filter((p) => {
    const last = p.split(".").pop() ?? "";
    return /(^id$|Id$|_id$|Key$|uuid|^key$|messageId|requestId|msgId|logId|eventId)/i.test(last) && !KNOWN_ID_PATHS.has(p);
  });
}
