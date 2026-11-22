/** API-078·001·002·003와 사장님/가게 범위 해석기(TASK-020). */
import type { Context } from "hono";
import type { HonoEnv } from "./app";
import { readJsonBody } from "./body";
import { sameOrigin } from "./operator-login";
import { type KakaoOwner, KakaoUnavailableError } from "./owner-auth";
import {
  cookie,
  LOGIN_COOKIE,
  LOGIN_SECONDS,
  loginState,
  OWNER_COOKIE,
  OWNER_SESSION_SECONDS,
  ownerRateKey,
  readCookie,
  verifyLoginState,
} from "./owner-oauth";
import { createOwnerScope, type OwnerScope } from "./owner-scope";
import {
  createOwnerSession,
  endOwnerSession,
  ownerProfile,
  refreshOwnerFriend,
  renewOwnerSession,
} from "./owner-session";
import { ApiError, type FieldError, fieldError } from "./problem";
import { OWNER_LOGIN_RATE } from "./rate-limit";
import { MissingSettingError } from "./request-key";
import type { OwnerRequest } from "./routes";
import type { OwnerAuthSettings, Secret } from "./settings";
import { createShopScope, type ShopScope } from "./shop-scope";
import { toShopIso } from "./time";

interface LoginInput {
  readonly redirectUri: string;
  readonly kakaoCode: string;
  readonly state: string;
}

export function parseOwnerInput(body: unknown, login: boolean): LoginInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw fieldError("/", "bad_format");
  const record = body as Record<string, unknown>;
  const fields = login ? ["redirectUri", "kakaoCode", "state"] : ["redirectUri"];
  const errors: FieldError[] = [];
  for (const name of fields) {
    const value = record[name];
    if (value === undefined) {
      errors.push({ field: `/${name}`, code: "required" });
      continue;
    }
    if (typeof value !== "string" || value.includes("\0")) {
      errors.push({ field: `/${name}`, code: "bad_format" });
      continue;
    }
    const min = name === "state" ? 16 : 1;
    const max = name === "redirectUri" ? 2048 : 512;
    const length = [...value].length;
    if (length < min) errors.push({ field: `/${name}`, code: "too_short" });
    else if (length > max) errors.push({ field: `/${name}`, code: "too_long" });
    else if (name === "redirectUri") {
      try {
        if (!value.startsWith("https://") || new URL(value).protocol !== "https:") throw new Error();
      } catch {
        errors.push({ field: `/${name}`, code: "bad_format" });
      }
    } else if (!(name === "state" ? /^[A-Za-z0-9._-]+$/ : /^[A-Za-z0-9_-]+$/).test(value))
      errors.push({ field: `/${name}`, code: "bad_format" });
  }
  for (const name of Object.keys(record))
    if (!fields.includes(name))
      errors.push({ field: /^[A-Za-z0-9_]{1,100}$/.test(name) ? `/${name}` : "/", code: "unknown_field" });
  if (errors.length > 0) throw new ApiError("validation_failed", { errors: errors.slice(0, 50) });
  return record as unknown as LoginInput;
}

async function input(c: Context<HonoEnv>, login: boolean): Promise<LoginInput> {
  if (!/^application\/json\s*(;\s*charset\s*=\s*"?utf-8"?\s*)?$/i.test(c.req.header("content-type") ?? ""))
    throw fieldError("header:Content-Type", "not_allowed");
  return parseOwnerInput(await readJsonBody(c), login);
}

function hashKey(c: Context<HonoEnv>): Secret {
  const key = c.get("settings").secrets.REQUEST_HASH_KEY;
  if (key === null) throw new MissingSettingError("REQUEST_HASH_KEY is not set");
  return key;
}

function allowedRedirect(c: Context<HonoEnv>, uri: string): OwnerAuthSettings {
  const settings = c.get("settings").ownerAuth;
  if (settings === null) throw new MissingSettingError("KAKAO owner login settings are not set");
  if (!settings.redirectUris.includes(uri)) throw fieldError("/redirectUri", "not_allowed");
  return settings;
}

async function rateLimit(c: Context<HonoEnv>): Promise<void> {
  // 운영에서는 Cloudflare가 덮어쓴 접속지 헤더만 사용한다. 브라우저가 보낸 다른 전달 헤더는 보지 않는다.
  const ip = c.req.header("cf-connecting-ip") ?? (c.get("settings").appEnv === "development" ? "local" : null);
  if (ip === null || ip.length > 64 || !/^[A-Za-z0-9:.]+$/.test(ip))
    throw new MissingSettingError("CF-Connecting-IP is not available");
  if (
    !(await c
      .get("services")
      .limiter(OWNER_LOGIN_RATE)
      .limit(await ownerRateKey(hashKey(c), ip)))
  )
    throw new ApiError("rate_limited", { retryAfterSeconds: 60 });
}

export async function startOwnerLogin(c: Context<HonoEnv>): Promise<Response> {
  if (!sameOrigin(c.req.raw)) throw fieldError("header:Origin", "not_allowed");
  const body = await input(c, false);
  allowedRedirect(c, body.redirectUri);
  await rateLimit(c);
  const services = c.get("services");
  const state = await loginState(hashKey(c), body.redirectUri, services.now());
  return c.json(
    {
      authorizationUrl: services.ownerAuth().authorizeUrl(body.redirectUri, state.state, state.challenge),
      state: state.state,
      expiresAt: toShopIso(state.expiresAt, "Asia/Seoul"),
    },
    200,
    {
      "set-cookie": cookie(LOGIN_COOKIE, state.nonce, LOGIN_SECONDS),
      "cache-control": "no-store",
    },
  );
}

export async function createOwnerLogin(c: Context<HonoEnv>): Promise<Response> {
  if (!sameOrigin(c.req.raw)) throw new ApiError("kakao_login_failed");
  const body = await input(c, true);
  allowedRedirect(c, body.redirectUri);
  const services = c.get("services");
  const verifier = await verifyLoginState(
    hashKey(c),
    body.state,
    readCookie(c.req.header("cookie"), LOGIN_COOKIE),
    body.redirectUri,
    services.now(),
  );
  if (verifier === null) throw new ApiError("kakao_login_failed");
  await rateLimit(c);
  let user: KakaoOwner | null;
  try {
    user = await services.ownerAuth().signIn(body.kakaoCode, body.redirectUri, verifier);
  } catch (error) {
    if (error instanceof KakaoUnavailableError) throw new ApiError("kakao_unavailable");
    throw error;
  }
  if (user === null) throw new ApiError("kakao_login_failed");
  const db = c.get("db");
  const channelEnabled = c.get("settings").ownerAuth?.scopes.includes("plusfriends") ?? false;
  const session = await createOwnerSession(db, user, services.now(), channelEnabled);
  const { profile } = await ownerProfile(db, session.ownerId, channelEnabled);
  c.header("set-cookie", cookie(LOGIN_COOKIE, "", 0), { append: true });
  c.header("set-cookie", cookie(OWNER_COOKIE, session.token, OWNER_SESSION_SECONDS), { append: true });
  return c.json(
    {
      owner: profile.owner,
      shop: profile.shop,
      next:
        profile.shop === null
          ? "register_shop"
          : profile.shop.licenseStatus === "on_hold"
            ? "resubmit_license"
            : "open_tasks",
    },
    200,
    { "cache-control": "no-store" },
  );
}

export async function deleteOwnerLogin(c: Context<HonoEnv>): Promise<Response> {
  const token = readCookie(c.req.header("cookie"), OWNER_COOKIE);
  if (token !== null && sameOrigin(c.req.raw)) await endOwnerSession(c.get("db"), token, c.get("services").now());
  return c.body(null, 204, { "set-cookie": cookie(OWNER_COOKIE, "", 0), "cache-control": "no-store" });
}

export async function resolveOwnerSession(c: Context<HonoEnv>): Promise<OwnerScope> {
  const cached = c.get("ownerScope");
  if (cached !== undefined) return cached;
  const token = readCookie(c.req.header("cookie"), OWNER_COOKIE);
  if (token === null || (c.req.method !== "GET" && c.req.method !== "HEAD" && !sameOrigin(c.req.raw)))
    throw new ApiError("unauthenticated");
  const db = c.get("db");
  const services = c.get("services");
  const ownerId = await renewOwnerSession(db, token, services.now());
  if (ownerId === null) throw new ApiError("unauthenticated");
  const channelEnabled = c.get("settings").ownerAuth?.scopes.includes("plusfriends") ?? false;
  if (channelEnabled) await refreshOwnerFriend(db, services.ownerAuth(), ownerId, services.now());
  const { profile, timeZone } = await ownerProfile(db, ownerId, channelEnabled);
  const owner = createOwnerScope(ownerId, timeZone, profile);
  c.set("ownerScope", owner);
  c.header("set-cookie", cookie(OWNER_COOKIE, token, OWNER_SESSION_SECONDS));
  return owner;
}

export async function resolveOwnerShop(c: Context<HonoEnv>): Promise<ShopScope> {
  const owner = await resolveOwnerSession(c);
  const shop = owner.profile?.shop;
  if (shop === undefined || shop === null) throw new ApiError("shop_not_registered");
  return createShopScope(shop.shopId, { kind: "owner", ownerId: owner.ownerId });
}

export async function getOwnerMe(r: OwnerRequest): Promise<Response> {
  if (r.owner.profile === undefined) throw new MissingSettingError("owner profile is not resolved");
  return r.json(r.owner.profile);
}
