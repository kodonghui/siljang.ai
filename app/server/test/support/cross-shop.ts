import type { Hono } from "hono";
import { expect } from "vitest";
import { createApp, type HonoEnv } from "../../src/app";
import type { Queryable } from "../../src/db";
import type { FieldCrypto } from "../../src/field-crypto";
import { deriveKakaoSkillKey } from "../../src/kakao-skill-auth";
import { OWNER_COOKIE } from "../../src/owner-oauth";
import { createOwnerSession } from "../../src/owner-session";
import { readPrivacyPolicySettings } from "../../src/privacy-policy-settings";
import { REQUEST_KEY_HEADER } from "../../src/request-key";
import { type Method, type RouteDecl, routeKey } from "../../src/routes";
import { Secret } from "../../src/settings";
import { newUploadId } from "../../src/uploads";
import { CLIENT_IP_HEADER, TEST_IPV4 } from "./access-log";
import { comparableProblem, expectProblem } from "./contract";
import { newRequestKey, newUuid, TEST_HASH_KEY, testDb, testEnv } from "./db";
import { seedOperatorSession } from "./operator";
import { MemoryLimiter } from "./rate-limit";
import {
  createShopPair,
  issueTestBookingLink,
  malformedIds,
  missingIds,
  type RecordIds,
  recordIds,
  type ShopFixture,
  snapshotShop,
} from "./shops";

/**
 * 교차 가게 시험 묶음(TASK-019; 04 SPEC-068 수락 기준 1·2, G1; 06 DEC-02).
 *
 * 가게 범위 경로(routes.ts의 shopRoute)는 하나도 빠짐없이 CROSS_SHOP_CASES에 등록한다. 시험(test/cross-shop.test.ts)이
 * 앱의 선언(app.ts의 APP_ROUTES)과 이 목록을 견주어, 등록되지 않은 가게 범위 경로가 있으면 실패한다(새 API가 빠지면 CI 실패).
 * 등록한 사례는 모두 앱의 선언을 붙인 앱에서 실제로 부른다(시험용 경로의 사례와 함께).
 * operator_review는 사장님401/인증된 운영자의 선택한 가게 접근과 가린 계좌만 따로 대조한다.
 *
 * 등록한 경로마다 가게 A 사장님으로 다음을 부른다.
 * - 경로의 ID(kind 'path'): 가게 B의 ID, 어느 가게에도 없는 ID, B의 ID를 대문자로, 형식이 틀린 ID 둘('not-a-uuid', 101자)
 *   → 모두 같은 404 not_found(상태·헤더 이름·본문이 traceId·instance 말고 같음).
 * - 본문·쿼리의 ID(kind 'reference'): 가게 B의 ID, 없는 ID, B의 ID를 대문자로 → 모두 같은 422 validation_failed와
 *   같은 필드의 reference_not_found.
 * - 그 사이 두 가게의 기록(가게 테이블 54개와 가게 행)이 하나도 생기거나 바뀌거나 지워지지 않음(남는 기록 0).
 *   B 사장님의 요청 키도 늘지 않는다. A가 낸 명령의 요청 키는 06 DEC-04대로 404를 남길 수 있지만 B의 기록 ID를 담지 않는다.
 * - 응답 본문 어디에도(경로를 되돌려 주는 instance 말고) B의 기록 ID가 없음.
 * - 대조: A 자신의 ID로 부르면 ownStatus(경로가 실제로 일하는지).
 */
export interface CrossShopRequest {
  /** /api 뒤의 주소(쿼리 포함). */
  readonly url: string;
  readonly body?: unknown;
}

interface OwnerCrossShopCase {
  readonly method: Method;
  /** 선언의 경로(/api 뒤, :이름). 등록 열쇠다. */
  readonly path: string;
  readonly kind: "path" | "reference";
  /** own은 부르는 사장님 가게의 ID, target은 바꿔 넣을 ID(path면 경로에, reference면 본문·쿼리에). */
  request(own: RecordIds, target: RecordIds): CrossShopRequest;
  /** A 자신의 ID로 부르면 나올 상태. */
  readonly ownStatus: number;
}

interface SkillCrossShopCase {
  readonly method: "POST";
  readonly path: string;
  readonly kind: "channel";
}

interface OwnShopCase {
  readonly method: "GET";
  readonly path: "/owner/shop";
  readonly kind: "self";
}

interface OwnerTaskListCase {
  readonly method: "GET";
  readonly path: "/owner/tasks";
  readonly kind: "owner_tasks";
}

interface ShopSettingsCase {
  readonly method: "PATCH";
  readonly path: "/owner/shop";
  readonly kind: "shop_settings";
}

interface CalendarShopCase {
  readonly method: "GET" | "PUT" | "PATCH";
  readonly path: "/owner/calendar" | "/owner/calendar/days" | "/owner/calendar/days/:day";
  readonly kind: "calendar";
}

interface PriceShopCase {
  readonly method: "GET" | "POST";
  readonly path: "/owner/price-list" | "/owner/price-list/versions" | "/owner/price-list/versions/:version";
  readonly kind: "prices";
}

interface RulesShopCase {
  readonly method: "GET" | "POST";
  readonly path:
    | "/owner/operating-rules"
    | "/owner/operating-rules/versions"
    | "/owner/operating-rules/versions/:version";
  readonly kind: "rules";
}

interface PaymentShopCase {
  readonly method: "GET" | "PUT";
  readonly path: "/owner/payment-destination";
  readonly kind: "payment";
}

interface ChannelSetupShopCase {
  readonly method: "GET" | "PUT" | "POST";
  readonly path: "/owner/kakao-channel" | "/owner/kakao-channel/skill-key";
  readonly kind: "channel_setup";
}

interface OperatorReviewShopCase {
  readonly method: "GET" | "POST";
  readonly path: "/operator/shops/:shopId" | "/operator/shops/:shopId/license-review";
  readonly kind: "operator_review";
}
interface OperatorRecordShopCase {
  readonly method: "GET" | "POST";
  readonly path:
    | "/operator/shops/:shopId/orders/:orderId"
    | "/operator/shops/:shopId/records"
    | "/operator/shops/:shopId/originals"
    | "/operator/shops/:shopId/consultations/:consultationId";
  readonly kind: "operator_records";
}

interface ChannelCheckShopCase {
  readonly method: "POST";
  readonly path: "/owner/kakao-channel/check";
  readonly kind: "channel_check";
}
interface IdentityChangeShopCase {
  readonly method: "POST";
  readonly path: "/owner/shop/identity-changes" | "/operator/identity-changes/:changeId/review";
  readonly kind: "identity_change";
}

interface BookingCase {
  readonly method: "GET";
  readonly path: "/owner/booking-link" | "/public/shops/:slug/privacy-policy" | "/public/shops/:slug";
  readonly kind: "booking";
}

interface LicenseResubmissionCase {
  readonly method: "PUT";
  readonly path: "/owner/shop/license";
  readonly kind: "license_resubmission";
}

export type CrossShopCase =
  | BookingCase
  | OwnerCrossShopCase
  | SkillCrossShopCase
  | OwnShopCase
  | OwnerTaskListCase
  | ShopSettingsCase
  | LicenseResubmissionCase
  | CalendarShopCase
  | PriceShopCase
  | RulesShopCase
  | PaymentShopCase
  | ChannelSetupShopCase
  | ChannelCheckShopCase
  | IdentityChangeShopCase
  | OperatorRecordShopCase
  | OperatorReviewShopCase;

export const CROSS_SHOP_CASES: readonly CrossShopCase[] = [
  {
    method: "GET",
    path: "/owner/consultations/:consultationId/messages",
    kind: "path",
    ownStatus: 200,
    request: (_own, target) => ({ url: `/owner/consultations/${target.consultationId}/messages` }),
  },
  { method: "GET", path: "/owner/booking-link", kind: "booking" },
  { method: "GET", path: "/public/shops/:slug/privacy-policy", kind: "booking" },
  { method: "GET", path: "/public/shops/:slug", kind: "booking" },
  ...["message", "card", "review", "event"].map(
    (kind) =>
      ({
        method: "POST",
        path: `/kakao/skills/${kind}`,
        kind: "channel",
      }) as const,
  ),
  { method: "GET", path: "/owner/shop", kind: "self" },
  { method: "GET", path: "/owner/tasks", kind: "owner_tasks" },
  { method: "PATCH", path: "/owner/shop", kind: "shop_settings" },
  { method: "PUT", path: "/owner/shop/license", kind: "license_resubmission" },
  { method: "POST", path: "/owner/shop/identity-changes", kind: "identity_change" },
  { method: "POST", path: "/operator/identity-changes/:changeId/review", kind: "identity_change" },
  { method: "GET", path: "/owner/kakao-channel", kind: "channel_setup" },
  { method: "PUT", path: "/owner/kakao-channel", kind: "channel_setup" },
  { method: "POST", path: "/owner/kakao-channel/skill-key", kind: "channel_setup" },
  { method: "POST", path: "/owner/kakao-channel/check", kind: "channel_check" },
  { method: "GET", path: "/owner/payment-destination", kind: "payment" },
  { method: "PUT", path: "/owner/payment-destination", kind: "payment" },
  { method: "GET", path: "/owner/calendar", kind: "calendar" },
  { method: "PUT", path: "/owner/calendar", kind: "calendar" },
  { method: "GET", path: "/owner/calendar/days", kind: "calendar" },
  { method: "PATCH", path: "/owner/calendar/days/:day", kind: "calendar" },
  { method: "GET", path: "/owner/price-list", kind: "prices" },
  { method: "POST", path: "/owner/price-list/versions", kind: "prices" },
  { method: "GET", path: "/owner/price-list/versions", kind: "prices" },
  { method: "GET", path: "/owner/price-list/versions/:version", kind: "prices" },
  { method: "GET", path: "/owner/operating-rules", kind: "rules" },
  { method: "POST", path: "/owner/operating-rules/versions", kind: "rules" },
  { method: "GET", path: "/owner/operating-rules/versions", kind: "rules" },
  { method: "GET", path: "/owner/operating-rules/versions/:version", kind: "rules" },
  { method: "GET", path: "/operator/shops/:shopId", kind: "operator_review" },
  { method: "GET", path: "/operator/shops/:shopId/orders/:orderId", kind: "operator_records" },
  { method: "GET", path: "/operator/shops/:shopId/records", kind: "operator_records" },
  { method: "POST", path: "/operator/shops/:shopId/originals", kind: "operator_records" },
  { method: "GET", path: "/operator/shops/:shopId/consultations/:consultationId", kind: "operator_records" },
  { method: "POST", path: "/operator/shops/:shopId/license-review", kind: "operator_review" },
];

/** 선언된 가게 범위 경로 가운데 등록되지 않은 것(missing)과, 등록됐지만 선언이 없는 것(stale). */
export function registryGaps(
  routes: readonly RouteDecl[],
  cases: readonly CrossShopCase[],
): { readonly missing: string[]; readonly stale: string[] } {
  const shop = new Set(routes.filter((r) => r.kind === "shop").map((r) => routeKey(r.method, r.path)));
  const registered = new Set(cases.map((c) => routeKey(c.method, c.path)));
  return {
    missing: [...shop].filter((k) => !registered.has(k)).sort(),
    stale: [...registered].filter((k) => !shop.has(k)).sort(),
  };
}

/** 라우터에 붙은 경로 가운데 선언(RouteDecl)에 없는 것(선언 없이 app.get 따위로 붙인 경로). */
export function undeclaredRoutes(app: Hono<HonoEnv>, routes: readonly RouteDecl[]): string[] {
  const declared = new Set(routes.map((r) => routeKey(r.method, `/api${r.path}`)));
  return app.routes
    .filter((r) => !(r.method === "ALL" && r.path.endsWith("*")))
    .map((r) => routeKey(r.method, r.path))
    .filter((k) => !declared.has(k));
}

export interface CrossShopEnv {
  readonly fieldCrypto?: FieldCrypto;
  readonly app: Hono<HonoEnv>;
  /** 부르는 사장님의 가게. */
  readonly a: ShopFixture;
  /** 다른 가게. */
  readonly b: ShopFixture;
  /** 그 가게 사장님으로 부르는 헤더(TASK-020 전에는 시험용 해석기의 헤더). */
  readonly as: (f: ShopFixture) => Record<string, string>;
}

interface Sent {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  readonly body: Record<string, unknown> | null;
  readonly requestKey: string | null;
}

async function send(env: CrossShopEnv, method: Method, req: CrossShopRequest): Promise<Sent> {
  const headers: Record<string, string> = { ...env.as(env.a), "cf-connecting-ip": "203.0.113.24" };
  const requestKey = method === "GET" ? null : newRequestKey();
  if (requestKey !== null) headers[REQUEST_KEY_HEADER] = requestKey;
  const init: RequestInit = { method, headers };
  if (req.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(req.body);
  }
  const res = await env.app.request(`/api${req.url}`, init, testEnv({ FILE_URL_KEY: TEST_HASH_KEY }));
  const text = await res.text();
  const body = text === "" ? null : (JSON.parse(text) as Record<string, unknown>);
  return { status: res.status, headers: res.headers, text, body, requestKey };
}

/** 견줄 수 있는 모양: 상태, 헤더 이름(길이 빼고)과 content-type, traceId·instance를 뺀 본문. */
function comparable(r: Sent) {
  const { traceId: _t, instance: _i, ...rest } = r.body ?? {};
  return {
    status: r.status,
    contentType: r.headers.get("content-type"),
    headerNames: [...r.headers.keys()].filter((h) => h !== "content-length").sort(),
    body: rest,
  };
}

function upper(ids: RecordIds): RecordIds {
  return Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, v.toUpperCase()])) as unknown as RecordIds;
}

/**
 * 두 가게의 기록 모습. A 사장님의 요청 키 수는 뺀다: A가 낸 명령이 404로 끝나면 06 DEC-04대로 그 요청 키에 결과가 남는다
 * (같은 키로 다시 보내면 같은 404). 그 요청 키에 B의 기록 ID가 없는지는 따로 본다.
 */
async function snapshots(db: Queryable, env: CrossShopEnv): Promise<Record<string, string>[]> {
  const { request_keys: _ownKeys, ...a } = await snapshotShop(db, env.a);
  return [a, await snapshotShop(db, env.b)];
}

async function checkSkillChannel(env: CrossShopEnv, c: SkillCrossShopCase, db: Queryable): Promise<void> {
  const key = await deriveKakaoSkillKey(new Secret(TEST_HASH_KEY), env.a.channelId, 1);
  async function call(botId: string) {
    return env.app.request(
      `/api${c.path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Siljang-Skill-Key": key },
        body: JSON.stringify({
          bot: { id: botId },
          userRequest: { utterance: "합성 시험", user: { id: env.a.userKey, type: "botUserKey" } },
          action: { id: "test", params: {} },
        }),
      },
      testEnv(),
    );
  }

  const before = await snapshots(db, env);
  const other = await call(env.b.botId);
  const unknown = await call(newUuid().replaceAll("-", "").slice(0, 24));
  const otherBody = await expectProblem(other, "skill_key_invalid");
  const unknownBody = await expectProblem(unknown, "skill_key_invalid");
  expect(comparableProblem(otherBody)).toEqual(comparableProblem(unknownBody));
  expect(await snapshots(db, env)).toEqual(before);
  expect((await call(env.a.botId)).status).toBe(200);
}

/** 등록한 경로 하나를 위 규칙대로 부르고 본다. 어기면 expect가 던진다. */
export async function runCrossShopCase(env: CrossShopEnv, c: CrossShopCase): Promise<void> {
  const db = testDb();
  try {
    if (c.kind === "booking") {
      if (c.path === "/owner/booking-link") {
        await send(env, "GET", { url: c.path });
        const before = await snapshots(db, env);
        for (const target of [env.b.shopId, newUuid(), "not-a-uuid"]) {
          const response = await send(env, "GET", { url: `${c.path}?shopId=${target}&ownerId=${env.b.ownerId}` });
          expect(response.status, response.text).toBe(200);
          expect(response.body).toMatchObject({ status: "not_ready", url: null });
          expect(response.text).not.toContain(env.b.shopId);
          expect(response.text).not.toContain(env.b.ownerId);
        }
        expect(await snapshots(db, env)).toEqual(before);
      } else {
        const pair = await createShopPair(db);
        const publicEnv = { ...env, ...pair };
        const app = createApp({
          services: {
            privacyPolicy: readPrivacyPolicySettings(
              {
                PUBLIC_APP_ORIGIN: "https://siljang.example",
                PRIVACY_TRANSFER_SETTINGS: JSON.stringify(
                  ["anthropic", "supabase", "cloudflare"].map((provider) => ({
                    provider,
                    recipient: `${provider} 합성 회사`,
                    country: "합성 국가",
                    whenAndHow: "이용 시 암호화 전송",
                    purposeAndRetention: "합성 목적과 기간",
                    howToRefuse: "가게에 거부하면 온라인 상담을 쓰지 않습니다.",
                  })),
                ),
              },
              "anthropic",
            ),
            limiters: {
              PUBLIC_PRIVACY_RATE_LIMITER: new MemoryLimiter(1000),
              PUBLIC_BOOKING_RATE_LIMITER: new MemoryLimiter(1000),
            },
          },
        });
        const suffix = c.path.endsWith("privacy-policy") ? "/privacy-policy" : "";
        for (const shop of [pair.a, pair.b]) await issueTestBookingLink(db, shop);
        // 현재 설정으로 발행을 마친 뒤 쿼리의 다른 가게 ID가 상태/본문을 바꾸지 않는지 비교한다.
        for (const shop of [pair.a, pair.b]) {
          const row = (
            await db.query<{ booking_slug: string }>("SELECT booking_slug FROM shops WHERE id=$1", [shop.shopId])
          ).rows[0];
          const ready = await app.request(
            `https://siljang.example/api/public/shops/${row?.booking_slug}/privacy-policy`,
            {},
            testEnv(),
          );
          expect(ready.status, await ready.clone().text()).toBe(200);
        }
        const before = await snapshots(db, publicEnv);
        for (const shop of [pair.a, pair.b]) {
          const row = (
            await db.query<{ booking_slug: string; name: string }>("SELECT booking_slug,name FROM shops WHERE id=$1", [
              shop.shopId,
            ])
          ).rows[0];
          expect(row).toBeDefined();
          const response = await app.request(
            `https://siljang.example/api/public/shops/${row?.booking_slug}${suffix}?shopId=${shop === pair.a ? pair.b.shopId : pair.a.shopId}`,
            {},
            testEnv({ FILE_URL_KEY: TEST_HASH_KEY }),
          );
          expect(response.status, await response.clone().text()).toBe(200);
          const body = (await response.json()) as { shopName?: string; shop?: { name: string } };
          expect(suffix ? body.shopName : body.shop?.name).toBe(row?.name);
          for (const id of [
            pair.a.ownerId,
            pair.b.ownerId,
            pair.a.shopId,
            pair.b.shopId,
            pair.a.paymentAccountId,
            pair.b.paymentAccountId,
          ])
            expect(JSON.stringify(body)).not.toContain(id);
        }
        await expectProblem(
          await app.request(`https://siljang.example/api/public/shops/missing-slug${suffix}`, {}, testEnv()),
          "not_found",
        );
        expect(await snapshots(db, publicEnv)).toEqual(before);
      }
      return;
    }
    if (c.kind === "license_resubmission") {
      const account = (
        await db.query<{ kakao_account_id: string }>("SELECT kakao_account_id FROM owners WHERE id=$1", [env.a.ownerId])
      ).rows[0];
      if (!account) throw new Error("사장님 없음");
      const session = await createOwnerSession(
        db,
        { accountId: account.kakao_account_id, friend: false },
        new Date(),
        false,
      );
      const authenticated: CrossShopEnv = {
        ...env,
        as: (shop) => ({ ...env.as(shop), cookie: `${OWNER_COOKIE}=${session.token}` }),
      };
      const before = await snapshots(db, authenticated),
        current = await send(authenticated, "GET", { url: "/owner/shop" });
      const body = {
        baseRevision: current.body?.revision,
        foodLicenseNo: "2026-합성재업로드",
        foodBusinessType: "bakery",
        licensePhotoUploadId: newUploadId("license_photo", new Date()),
      };
      const wrong = await send(authenticated, "PUT", { url: c.path, body: { ...body, shopId: env.b.shopId } });
      expect(wrong.status, wrong.text).toBe(422);
      for (const shopId of [env.b.shopId, newUuid(), "not-a-uuid"]) {
        const response = await send(authenticated, "PUT", {
          url: `${c.path}?shopId=${shopId}&ownerId=${env.b.ownerId}`,
          body,
        });
        expect(response.status, response.text).toBe(409);
        expect(response.body?.code).toBe("invalid_state");
        expect(response.text).not.toContain(env.b.shopId);
        expect(response.text).not.toContain(env.b.ownerId);
      }
      expect(await snapshots(db, authenticated)).toEqual(before);
      return;
    }
    if (c.kind === "identity_change") {
      if (c.path.startsWith("/owner/")) {
        await db.query("UPDATE shops SET business_reg_no='1234567891' WHERE id=$1", [env.a.shopId]);
        const before = await snapshots(db, env),
          current = await send(env, "GET", { url: "/owner/shop" });
        const body = {
          baseRevision: current.body?.revision,
          businessName: current.body?.businessName,
          representativeName: current.body?.representativeName,
          businessRegNo: current.body?.businessRegNo,
          evidencePhotoUploadId: newUploadId("license_photo", new Date()),
        };
        const invalid = await send(env, "POST", { url: c.path, body: { ...body, shopId: env.b.shopId } });
        expect(invalid.status, invalid.text).toBe(422);
        for (const target of [env.b.shopId, newUuid(), "not-a-uuid"]) {
          const response = await send(env, "POST", {
            url: `${c.path}?shopId=${target}&ownerId=${env.b.ownerId}`,
            body,
          });
          expect(response.status, response.text).toBe(200);
          expect(response.body).toMatchObject({ outcome: "unchanged", shop: { shopId: env.a.shopId } });
          expect(response.text).not.toContain(env.b.shopId);
          expect(response.text).not.toContain(env.b.ownerId);
        }
        expect(await snapshots(db, env)).toEqual(before);
        return;
      }
      const ids: string[] = [];
      for (const shop of [env.a, env.b]) {
        const id = newUuid();
        ids.push(id);
        await db.query(
          "INSERT INTO shop_identity_changes (id,shop_id,business_name,representative_name,business_reg_no,prev_business_name,prev_representative_name,prev_business_reg_no,evidence_photo_key) SELECT $2,s.id,'새 합성 상호',s.representative_name,s.business_reg_no,s.business_name,s.representative_name,s.business_reg_no,s.license_photo_key FROM shops s WHERE s.id=$1",
          [shop.shopId, id],
        );
      }
      const before = await snapshots(db, env),
        owner = await send(env, "POST", {
          url: c.path.replace(":changeId", ids[1] ?? ""),
          body: { baseRevision: "revision", decision: "applied" },
        });
      expect(owner.status).toBe(401);
      expect(await snapshots(db, env)).toEqual(before);
      const session = await seedOperatorSession(db, new Date());
      const call = (id: string, body: unknown) =>
        env.app.request(
          `https://siljang.example/api/operator/identity-changes/${id}/review`,
          {
            method: "POST",
            headers: {
              cookie: session.cookie,
              origin: "https://siljang.example",
              "content-type": "application/json",
              "Idempotency-Key": newRequestKey(),
            },
            body: JSON.stringify(body),
          },
          testEnv({ FILE_URL_KEY: TEST_HASH_KEY }),
        );
      const detail = await env.app.request(
        `https://siljang.example/api/operator/shops/${env.a.shopId}`,
        { headers: { cookie: session.cookie } },
        testEnv({ FILE_URL_KEY: TEST_HASH_KEY }),
      );
      const item = ((await detail.json()) as { pendingIdentityChange: { revision: string } }).pendingIdentityChange;
      const response = await call(ids[0] ?? "", {
        baseRevision: item.revision,
        decision: "on_hold",
        holdReason: "합성 보류",
      });
      expect(response.status, await response.clone().text()).toBe(200);
      expect(((await response.json()) as { change: { shop: { shopId: string } } }).change.shop.shopId).toBe(
        env.a.shopId,
      );
      expect(await snapshotShop(db, env.b)).toEqual(before[1]);
      for (const id of [newUuid(), "not-a-uuid", "x".repeat(101)])
        await expectProblem(await call(id, { baseRevision: "revision", decision: "applied" }), "not_found");
      return;
    }
    if (c.kind === "shop_settings") {
      const other = await snapshotShop(db, env.b);
      let current = await send(env, "GET", { url: "/owner/shop" });
      const invalid = await send(env, "PATCH", {
        url: c.path,
        body: { baseRevision: current.body?.revision, name: "다른 가게 ID 거절", shopId: env.b.shopId },
      });
      expect(invalid.status, invalid.text).toBe(422);
      for (const shopId of [env.b.shopId, newUuid(), "not-a-uuid"]) {
        current = await send(env, "GET", { url: "/owner/shop" });
        const response = await send(env, "PATCH", {
          url: `${c.path}?shopId=${shopId}&ownerId=${env.b.ownerId}`,
          body: { baseRevision: current.body?.revision, contactEmail: "own-settings@example.com" },
        });
        expect(response.status, response.text).toBe(200);
        expect(response.body).toMatchObject({
          shop: { shopId: env.a.shopId, contactEmail: "own-settings@example.com" },
        });
        expect(response.text).not.toContain(env.b.shopId);
        expect(response.text).not.toContain(env.b.ownerId);
        expect(await snapshotShop(db, env.b)).toEqual(other);
      }
      return;
    }
    if (c.kind === "channel_check") {
      const current = await send(env, "GET", { url: "/owner/kakao-channel" });
      expect(current.status).toBe(200);
      const saved = await send(env, "PUT", {
        url: "/owner/kakao-channel",
        body: {
          baseRevision: current.body?.revision,
          botId: env.a.botId,
          channelPublicId: current.body?.channelPublicId,
          blockIds: {
            card: "card",
            ordererInfo: "orderer",
            allergyAnswer: "allergy",
            depositorName: "depositor",
            review: "review",
          },
        },
      });
      expect(saved.status, saved.text).toBe(200);
      const before = await snapshotShop(db, env.b);
      for (const shopId of [env.b.shopId, newUuid(), "not-a-uuid"]) {
        const response = await send(env, "POST", { url: `${c.path}?shopId=${shopId}&connectionId=${env.b.channelId}` });
        expect(response.status, response.text).toBe(200);
        expect(response.body).toMatchObject({ kakaoChannel: { connectionId: env.a.channelId } });
        expect(response.text).not.toContain(env.b.channelId);
        expect(response.text).not.toContain(env.b.botId);
        expect(await snapshotShop(db, env.b)).toEqual(before);
      }
      return;
    }
    if (c.kind === "operator_records" && c.path.endsWith("/records")) {
      const beforeOwner = await snapshots(db, env);
      expect((await send(env, "GET", { url: `/operator/shops/${env.b.shopId}/records` })).status).toBe(401);
      expect(await snapshots(db, env)).toEqual(beforeOwner);
      const session = await seedOperatorSession(db, new Date());
      const call = async (shopId: string, kind = "orders", extra = "") =>
        env.app.request(
          `https://siljang.example/api/operator/shops/${shopId}/records?kind=${kind}${extra}`,
          { headers: { cookie: session.cookie, [CLIENT_IP_HEADER]: TEST_IPV4 } },
          testEnv(),
        );
      for (const kind of ["orders", "consultations"])
        for (const target of [env.a, env.b]) {
          const response = await call(target.shopId, kind, `&shopId=${target === env.a ? env.b.shopId : env.a.shopId}`);
          expect(response.status).toBe(200);
          const body = (await response.json()) as {
            orders: { orderId: string }[];
            consultations: { consultationId: string }[];
          };
          if (kind === "orders") expect(body.orders.map((row) => row.orderId)).toEqual([target.orderId]);
          else expect(body.consultations.map((row) => row.consultationId)).toEqual([target.consultationId]);
        }
      const before = await snapshots(db, env);
      let missing: unknown;
      for (const shopId of [newUuid(), "not-a-uuid", "x".repeat(101)]) {
        const response = await call(shopId),
          body = await expectProblem(response, "not_found"),
          comparable = comparableProblem(body);
        if (missing === undefined) missing = comparable;
        else expect(comparable).toEqual(missing);
        expect(await snapshots(db, env)).toEqual(before);
      }
      return;
    }
    if (c.kind === "operator_records" && c.method === "POST") {
      const beforeOwner = await snapshots(db, env);
      expect(
        (
          await send(env, "POST", {
            url: `/operator/shops/${env.a.shopId}/originals`,
            body: { targetKind: "order_contact", targetId: env.b.orderId, reason: "합성 손님 문의 확인" },
          })
        ).status,
      ).toBe(401);
      expect(await snapshots(db, env)).toEqual(beforeOwner);
      const session = await seedOperatorSession(db, new Date());
      const call = (shopId: string, targetKind: string, targetId: string) =>
        env.app.request(
          `https://siljang.example/api/operator/shops/${shopId}/originals`,
          {
            method: "POST",
            headers: {
              origin: "https://siljang.example",
              cookie: session.cookie,
              [CLIENT_IP_HEADER]: TEST_IPV4,
              "content-type": "application/json",
              "Idempotency-Key": newRequestKey(),
            },
            body: JSON.stringify({ targetKind, targetId, reason: "합성 손님 문의 확인" }),
          },
          testEnv(),
        );
      for (const target of [env.a, env.b])
        for (const kind of ["order_contact", "consultation_text"]) {
          const id = kind === "order_contact" ? target.orderId : target.consultationId;
          const response = await call(target.shopId, kind, id);
          expect(response.status, await response.clone().text()).toBe(200);
          expect(await response.json()).toMatchObject({ targetKind: kind, targetId: id });
        }
      const before = await snapshots(db, env);
      const audits = await db.query("SELECT count(*)::int AS n FROM access_logs WHERE shop_id=$1", [env.a.shopId]);
      let missing: unknown;
      for (const [kind, id] of [
        ["order_contact", env.b.orderId],
        ["consultation_text", env.b.consultationId],
        ["order_contact", newUuid()],
        ["consultation_text", newUuid()],
      ] as const) {
        const body = comparableProblem(await expectProblem(await call(env.a.shopId, kind, id), "not_found"));
        if (missing === undefined) missing = body;
        else expect(body).toEqual(missing);
        expect(await snapshots(db, env)).toEqual(before);
      }
      for (const shopId of [newUuid(), "not-a-uuid"])
        await expectProblem(await call(shopId, "order_contact", env.a.orderId), "not_found");
      expect(
        (await db.query("SELECT count(*)::int AS n FROM access_logs WHERE shop_id=$1", [env.a.shopId])).rows,
      ).toEqual(audits.rows);
      return;
    }
    if (c.kind === "operator_records") {
      const consultation = c.path.includes("/consultations/");
      const idOf = (target: ShopFixture) => (consultation ? target.consultationId : target.orderId);
      const url = (shopId: string, resourceId: string) =>
        `/operator/shops/${shopId}/${consultation ? "consultations" : "orders"}/${resourceId}`;
      const beforeOwner = await snapshots(db, env);
      expect((await send(env, "GET", { url: url(env.a.shopId, idOf(env.b)) })).status).toBe(401);
      expect(await snapshots(db, env)).toEqual(beforeOwner);
      const session = await seedOperatorSession(db, new Date());
      const call = async (shopId: string, orderId: string) =>
        env.app.request(
          `https://siljang.example/api${url(shopId, orderId)}`,
          { headers: { cookie: session.cookie, [CLIENT_IP_HEADER]: TEST_IPV4 } },
          testEnv(),
        );
      for (const target of [env.a, env.b]) {
        const response = await call(target.shopId, idOf(target));
        expect(response.status).toBe(200);
        const body = (await response.json()) as Record<string, unknown>;
        expect(body[consultation ? "consultationId" : "orderId"]).toBe(idOf(target));
        if (!consultation) {
          expect(body.customerNameMasked).toMatch(/^[^*]\*+$/);
          expect(body.customerPhoneMasked).toMatch(/^[*-]+[0-9]{4}$/);
        }
      }
      const before = await snapshots(db, env);
      let missing: unknown;
      for (const id of [newUuid(), idOf(env.b), idOf(env.b).toUpperCase(), "not-a-uuid"]) {
        const response = await call(env.a.shopId, id);
        expect(response.status).toBe(404);
        const body = await expectProblem(response, "not_found");
        const comparable = comparableProblem(body);
        if (missing === undefined) missing = comparable;
        else expect(comparable).toEqual(missing);
        expect(await snapshots(db, env)).toEqual(before);
      }
      return;
    }
    if (c.kind === "operator_review") {
      const before = await snapshots(db, env);
      const url = `/operator/shops/${env.b.shopId}${c.method === "POST" ? "/license-review" : ""}`;
      const owner = await send(env, c.method, {
        url,
        ...(c.method === "POST"
          ? { body: { baseRevision: "stale", decision: "on_hold", holdReason: "합성 보류" } }
          : {}),
      });
      expect(owner.status).toBe(401);
      expect(await snapshots(db, env)).toEqual(before);
      const session = await seedOperatorSession(db, new Date());
      const call = (method: "GET" | "POST", shopId: string, body?: unknown) =>
        env.app.request(
          `https://siljang.example/api/operator/shops/${shopId}${method === "POST" ? "/license-review" : ""}`,
          {
            method,
            headers: {
              origin: "https://siljang.example",
              cookie: session.cookie,
              "content-type": "application/json",
              "Idempotency-Key": newRequestKey(),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          },
          testEnv({ FILE_URL_KEY: TEST_HASH_KEY }),
        );
      for (const target of [env.a, env.b]) {
        const response = await call("GET", target.shopId);
        expect(response.status).toBe(200);
        const detail = (await response.json()) as { shopId: string; paymentAccount: { accountLast4: string } };
        expect(detail.shopId).toBe(target.shopId);
        const expected = (
          await db.query<{ account_last4: string }>(
            "SELECT account_last4 FROM payment_accounts WHERE shop_id=$1 AND retired_at IS NULL",
            [target.shopId],
          )
        ).rows[0];
        expect(detail.paymentAccount.accountLast4).toBe(expected?.account_last4);
        expect(JSON.stringify(detail)).not.toContain(target.customerId);
        expect(JSON.stringify(detail)).not.toContain("accountNumber");
      }
      if (c.method === "GET") {
        expect(await snapshots(db, env)).toEqual(before);
        return;
      }
      const detail = (await (await call("GET", env.a.shopId)).json()) as { revision: string };
      const response = await call("POST", env.a.shopId, {
        baseRevision: detail.revision,
        decision: "on_hold",
        holdReason: "합성 신고증 확인",
      });
      expect(response.status, await response.clone().text()).toBe(200);
      expect(((await response.json()) as { shop: { shopId: string } }).shop.shopId).toBe(env.a.shopId);
      expect(await snapshotShop(db, env.b)).toEqual(before[1]);
      return;
    }
    if (c.kind === "channel_setup") {
      const before = await snapshots(db, env);
      const current = await send(env, "GET", {
        url: `/owner/kakao-channel?shopId=${env.b.shopId}&connectionId=${env.b.channelId}`,
      });
      expect(current.status, current.text).toBe(200);
      expect(current.body?.connectionId).toBe(env.a.channelId);
      expect(current.text).not.toContain(env.b.botId);
      expect(current.text).not.toContain(env.b.channelId);
      if (c.method === "GET") {
        expect(await snapshots(db, env)).toEqual(before);
        return;
      }
      const body =
        c.method === "PUT"
          ? {
              baseRevision: current.body?.revision,
              botId: env.a.botId,
              channelPublicId: current.body?.channelPublicId,
              blockIds: current.body?.blockIds,
            }
          : { baseRevision: current.body?.revision, previousKey: "keep_24h" };
      const wrong = await send(env, c.method, { url: c.path, body: { ...body, connectionId: env.b.channelId } });
      expect(wrong.status, wrong.text).toBe(422);
      expect(await snapshots(db, env)).toEqual(before);
      if (c.method === "PUT") {
        const other = await send(env, "PUT", { url: c.path, body: { ...body, botId: env.b.botId } });
        expect(other.status, other.text).toBe(409);
        expect(other.body?.code).toBe("channel_linked_elsewhere");
        expect((await snapshots(db, env))[1]).toEqual(before[1]);
      }
      const own = await send(env, c.method, {
        url: `${c.path}?shopId=${env.b.shopId}&connectionId=${env.b.channelId}`,
        body,
      });
      expect(own.status, own.text).toBe(200);
      if (c.method === "PUT") expect(own.body?.outcome).toBe("unchanged");
      expect(own.text).not.toContain(env.b.botId);
      expect(own.text).not.toContain(env.b.channelId);
      expect((await snapshots(db, env))[1]).toEqual(before[1]);
      return;
    }
    if (c.kind === "rules") {
      await db.query("UPDATE operating_rules SET quote_valid_hours=99 WHERE shop_id=$1", [env.b.shopId]);
      if (c.path.endsWith(":version"))
        await db.query("UPDATE operating_rules SET version=1000 WHERE shop_id=$1", [env.b.shopId]);
      const marker = `다른 가게의 합성 규정 ${env.b.shopId}`;
      await db.query(
        "INSERT INTO rule_clauses (shop_id,operating_rules_id,clause_key,position,title,condition_text,effect_text) VALUES ($1,$2,'custom',32767,'합성 조문','합성 조건',$3) ON CONFLICT (operating_rules_id,position) DO NOTHING",
        [env.b.shopId, env.b.operatingRulesId, marker],
      );
      const before = await snapshots(db, env);
      const current = await send(env, "GET", { url: "/owner/operating-rules" });
      expect(current.status, current.text).toBe(200);
      expect(current.body).toMatchObject({ quoteValidHours: 72 });
      const version = current.body?.version;
      if (typeof version !== "number") throw new Error("합성 규정 버전 없음");
      const url = c.path.replace(":version", "1");
      if (c.method === "GET") {
        for (const shopId of [env.b.shopId, newUuid(), "not-a-uuid"]) {
          const response = await send(env, "GET", { url: `${url}?shopId=${shopId}&ownerId=${env.b.ownerId}` });
          expect(response.status, response.text).toBe(200);
          expect(response.text).not.toContain(marker);
          expect(response.text).not.toContain(env.b.ownerId);
          if (c.path.endsWith("/versions"))
            expect(response.body).toMatchObject({
              items: Array.from({ length: version }, (_, i) => ({ version: version - i })),
            });
          else
            expect(response.body).toMatchObject({
              quoteValidHours: 72,
              version: c.path.endsWith(":version") ? 1 : version,
            });
        }
        if (c.path.endsWith(":version")) {
          const other = await send(env, "GET", { url: "/owner/operating-rules/versions/1000" });
          const absent = await send(env, "GET", { url: "/owner/operating-rules/versions/999" });
          expect(other.status).toBe(404);
          expect(comparable(other)).toEqual(comparable(absent));
        }
        expect(await snapshots(db, env)).toEqual(before);
      } else {
        const body = {
          baseRevision: current.body?.revision,
          quoteValidHours: 72,
          paymentDueHours: 12,
          issueReportHours: 24,
          changeDeadlineHours: 48,
          cancellationFeeKrw: 0,
          preProductionRefundPct: 100,
          dateChangeRefundBasis: "original_pickup",
          clauses: [
            {
              key: "pre_production_cancel",
              position: 1,
              title: "제작 전 취소",
              conditionText: "제작 전인 경우",
              effectText: "취소 수수료를 빼고 모두 돌려드립니다.",
            },
          ],
          refundTiers: [],
        };
        for (const shopId of [env.b.shopId, newUuid(), "not-a-uuid"]) {
          const response = await send(env, "POST", { url, body: { ...body, shopId } });
          expect(response.status, response.text).toBe(422);
          expect(response.body).toMatchObject({ errors: [{ field: "/shopId", code: "unknown_field" }] });
        }
        expect(await snapshots(db, env)).toEqual(before);
        const own = await send(env, "POST", { url, body });
        expect(own.status, own.text).toBe(201);
        expect(own.body).toMatchObject({ outcome: "created", operatingRules: { version: version + 1 } });
        expect((await snapshots(db, env))[1]).toEqual(before[1]);
      }
      return;
    }
    if (c.kind === "payment") {
      if (!env.fieldCrypto) throw new Error("계좌 시험 키 없음");
      const ownNumber = "123456-01-234567",
        otherNumber = "999999-98-765432";
      for (const [shop, number] of [
        [env.a, ownNumber],
        [env.b, otherNumber],
      ] as const) {
        const enc = await env.fieldCrypto.seal(number, {
          shopId: shop.shopId,
          purpose: "payment_accounts.account_number",
        });
        await db.query("UPDATE payment_accounts SET account_number_enc=$2 WHERE shop_id=$1 AND retired_at IS NULL", [
          shop.shopId,
          enc,
        ]);
      }
      const before = await snapshots(db, env);
      const current = await send(env, "GET", {
        url: `${c.path}?shopId=${env.b.shopId}&paymentAccountId=${env.b.paymentAccountId}`,
      });
      expect(current.status, current.text).toBe(200);
      expect(current.body?.accountNumber).toBe(ownNumber);
      expect(current.text).not.toContain(otherNumber);
      expect(current.text).not.toContain(env.b.paymentAccountId);
      if (c.method === "PUT") {
        const body = {
          baseRevision: current.body?.revision,
          bankName: "가게A 은행",
          accountNumber: "222222-01-234567",
          holderName: "시험사장",
          cardPaymentUrl: null,
        };
        const wrong = await send(env, "PUT", { url: c.path, body: { ...body, shopId: env.b.shopId } });
        expect(wrong.status, wrong.text).toBe(422);
        expect(await snapshots(db, env)).toEqual(before);
        const own = await send(env, "PUT", { url: `${c.path}?shopId=${env.b.shopId}`, body });
        expect(own.status, own.text).toBe(200);
        expect(own.text).not.toContain(otherNumber);
        const after = await snapshots(db, env);
        expect(after[1]).toEqual(before[1]);
      } else expect(await snapshots(db, env)).toEqual(before);
      return;
    }
    if (c.kind === "prices") {
      if (c.path.endsWith(":version"))
        await db.query("UPDATE price_lists SET version = 1000 WHERE shop_id = $1", [env.b.shopId]);
      const before = await snapshots(db, env);
      const current = await send(env, "GET", { url: "/owner/price-list" });
      expect(current.status, current.text).toBe(200);
      if (c.method === "GET") {
        const url = c.path.replace(":version", "1");
        for (const target of [env.b.shopId, newUuid(), "not-a-uuid"]) {
          const response = await send(env, "GET", { url: `${url}?shopId=${target}&ownerId=${env.b.ownerId}` });
          expect(response.status, response.text).toBe(200);
          for (const id of [env.b.shopId, env.b.ownerId, env.b.priceListId, env.b.designId, env.b.designOptionId])
            expect(response.text).not.toContain(id);
          if (!url.endsWith("/versions")) expect(response.text).toContain(env.a.designId);
        }
        if (c.path.endsWith(":version")) {
          const other = await send(env, "GET", { url: "/owner/price-list/versions/1000" });
          const absent = await send(env, "GET", { url: "/owner/price-list/versions/999" });
          expect(other.status).toBe(404);
          expect(comparable(other)).toEqual(comparable(absent));
        }
        expect(await snapshots(db, env)).toEqual(before);
      } else {
        const body = {
          baseRevision: current.body?.revision,
          options: [
            {
              key: "flower",
              group: "design",
              name: "꽃",
              priceKind: "fixed",
              amount: 5000,
              amountMax: null,
              inStandard: true,
              position: 0,
            },
          ],
          rules: [],
          designs: [
            { name: "꽃 도안", sourceDesignId: env.a.designId, optionKey: "flower", inStandard: false, position: 0 },
          ],
        };
        let first: Sent | undefined;
        for (const sourceDesignId of [env.b.designId, newUuid(), env.b.designId.toUpperCase()]) {
          const response = await send(env, "POST", {
            url: c.path,
            body: { ...body, designs: [{ ...body.designs[0], sourceDesignId }] },
          });
          expect(response.status, response.text).toBe(422);
          expect(response.body).toMatchObject({
            code: "validation_failed",
            errors: [{ field: "/designs/0/sourceDesignId", code: "reference_not_found" }],
          });
          if (first) expect(comparable(response)).toEqual(comparable(first));
          else first = response;
          expect(response.text).not.toContain(env.b.designId);
        }
        for (const target of [env.b.shopId, newUuid(), "not-a-uuid"]) {
          const response = await send(env, "POST", { url: c.path, body: { ...body, shopId: target } });
          expect(response.status).toBe(422);
          expect(response.body).toMatchObject({ errors: [{ field: "/shopId", code: "unknown_field" }] });
        }
        expect(await snapshots(db, env)).toEqual(before);
        const own = await send(env, "POST", { url: c.path, body });
        expect(own.status, own.text).toBe(201);
        expect(own.body).toMatchObject({
          outcome: "created",
          priceList: { version: 2, designs: [{ inStandard: false }] },
        });
        expect((await snapshots(db, env))[1]).toEqual(before[1]);
      }
      return;
    }
    if (c.kind === "calendar") {
      const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
      for (const [shop, capacity] of [
        [env.a, 3],
        [env.b, 9],
      ] as const)
        await db.query(
          `INSERT INTO business_calendars (shop_id, daily_capacity, order_cutoff_days, order_cutoff_time)
          VALUES ($1, $2, 2, '18:00') ON CONFLICT (shop_id) DO UPDATE SET daily_capacity = EXCLUDED.daily_capacity`,
          [shop.shopId, capacity],
        );
      const before = await snapshots(db, env);
      const read = await send(env, "GET", { url: `/owner/calendar?shopId=${env.b.shopId}&ownerId=${env.b.ownerId}` });
      expect(read.status).toBe(200);
      expect(read.body?.dailyCapacity).toBe(3);
      if (!read.body) throw new Error("시험 설정 없음");
      const { updatedAt: _at, revision, ...settings } = read.body;
      const url = c.path.includes("/days") ? c.path.replace(":day", day) : c.path;
      if (c.method === "GET") {
        const response = await send(env, "GET", { url: `${url}?from=${day}&to=${day}&shopId=${env.b.shopId}` });
        expect(response.status).toBe(200);
        if (c.path.endsWith("/days")) expect(response.body).toMatchObject({ items: [{ capacity: 3 }] });
        else expect(response.body?.dailyCapacity).toBe(3);
        expect(await snapshots(db, env)).toEqual(before);
      } else {
        const listed = await send(env, "GET", { url: `/owner/calendar/days?from=${day}&to=${day}` });
        const items = listed.body?.items as { revision: string }[];
        const body =
          c.method === "PUT"
            ? { ...settings, baseRevision: revision, dailyCapacity: 4 }
            : { baseRevision: items[0]?.revision, manuallyClosed: true };
        for (const target of [env.b.shopId, newUuid(), "not-a-uuid"]) {
          const response = await send(env, c.method, { url, body: { ...body, shopId: target } });
          expect(response.status).toBe(422);
          expect(response.body).toMatchObject({ errors: [{ field: "/shopId", code: "unknown_field" }] });
          expect(JSON.stringify(response.body)).not.toContain(env.b.shopId);
        }
        expect(await snapshots(db, env)).toEqual(before);
        const response = await send(env, c.method, { url, body });
        expect(response.status, response.text).toBe(200);
        const after = await snapshots(db, env);
        expect(after[1]).toEqual(before[1]);
        if (c.method === "PUT") expect(response.body).toMatchObject({ calendar: { dailyCapacity: 4 } });
        else expect(response.body).toMatchObject({ day: { capacity: 3, manuallyClosed: true } });
      }
      return;
    }
    if (c.kind === "channel") {
      await checkSkillChannel(env, c, db);
      return;
    }
    if (c.kind === "owner_tasks") {
      const ids = [newUuid(), newUuid()];
      for (const [i, shop] of [env.a, env.b].entries())
        await db.query("INSERT INTO owner_tasks(id,shop_id,kind,event_key) VALUES($1,$2,'ledger_relink',$3)", [
          ids[i],
          shop.shopId,
          `task:ledger_relink:${ids[i]}`,
        ]);
      const before = await snapshots(db, env);
      for (const target of [env.b.shopId, newUuid(), "not-a-uuid"]) {
        const response = await env.app.request(
          `/api/owner/tasks?shopId=${target}&ownerId=${env.b.ownerId}`,
          { headers: { ...env.as(env.a), "cf-connecting-ip": "203.0.113.24" } },
          testEnv(),
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as { items: { taskId: string }[] };
        expect(body.items.map((row) => row.taskId)).toEqual([ids[0]]);
        expect(JSON.stringify(body)).not.toContain(ids[1]);
      }
      const after = await snapshots(db, env);
      expect(after[1]).toEqual(before[1]);
      const clean = (row: Record<string, string> | undefined) => {
        const { access_logs: _access, ...rest } = row ?? {};
        return rest;
      };
      expect(clean(after[0])).toEqual(clean(before[0]));
      return;
    }
    if (c.kind === "self") {
      const before = await snapshots(db, env);
      for (const target of [env.b.shopId, newUuid(), "not-a-uuid"]) {
        const response = await env.app.request(
          `/api/owner/shop?shopId=${target}&ownerId=${env.b.ownerId}`,
          {
            headers: env.as(env.a),
          },
          testEnv({ FILE_URL_KEY: TEST_HASH_KEY }),
        );
        const body = (await response.json()) as Record<string, unknown>;
        expect(response.status, JSON.stringify(body)).toBe(200);
        expect(body.shopId).toBe(env.a.shopId);
        expect(JSON.stringify(body)).not.toContain(env.b.shopId);
        expect(JSON.stringify(body)).not.toContain(env.b.ownerId);
      }
      expect(await snapshots(db, env)).toEqual(before);
      return;
    }
    const own = recordIds(env.a);
    const other = recordIds(env.b);
    const variants: [string, RecordIds][] = [
      ["다른 가게 ID", other],
      ["없는 ID", missingIds()],
      ["다른 가게 ID(대문자)", upper(other)],
    ];
    if (c.kind === "path") {
      variants.push(["형식이 틀린 ID", malformedIds("not-a-uuid")], ["101자 ID", malformedIds("a".repeat(101))]);
    }
    const before = await snapshots(db, env);
    const results: [string, Sent][] = [];
    for (const [name, ids] of variants) results.push([name, await send(env, c.method, c.request(own, ids))]);
    const after = await snapshots(db, env);
    const label = routeKey(c.method, c.path);

    // 남는 기록 0: 두 가게의 기록이 그대로(B 사장님의 요청 키 포함). A 사장님의 요청 키는 아래에서 따로 본다
    expect(after, `${label}: 가게 기록이 바뀜`).toEqual(before);

    const expected =
      c.kind === "path" ? { status: 404, code: "not_found" } : { status: 422, code: "validation_failed" };
    const [first] = results;
    for (const [name, r] of results) {
      expect(r.status, `${label} ${name}`).toBe(expected.status);
      expect(r.body?.code, `${label} ${name}`).toBe(expected.code);
      expect(comparable(r), `${label} ${name}: 없는 ID와 다른 응답`).toEqual(comparable((first as [string, Sent])[1]));
      if (c.kind === "reference") {
        const errors = (r.body?.errors ?? []) as { code: string }[];
        expect(errors.length, `${label} ${name}`).toBeGreaterThan(0);
        for (const e of errors) expect(e.code, `${label} ${name}`).toBe("reference_not_found");
      }
      // B의 기록이 있는지 알릴 내용 없음: instance(보낸 경로를 되돌려 줌) 말고 본문에 B의 ID가 없다
      const { instance: _i, ...rest } = r.body ?? {};
      const shown = JSON.stringify(rest).toLowerCase();
      for (const id of Object.values(other)) expect(shown, `${label} ${name}`).not.toContain(id);
    }

    // A의 명령이 남긴 요청 키(06 DEC-04: 404는 남김)에는 B의 기록 ID가 없다
    const keys = results.flatMap(([, r]) => (r.requestKey === null ? [] : [r.requestKey]));
    if (keys.length > 0) {
      const stored = await db.query<{ ref: string }>(
        "SELECT response_ref::text AS ref FROM request_keys WHERE actor_kind = 'owner' AND actor_id = $1 AND request_key = ANY($2)",
        [env.a.ownerId, keys],
      );
      for (const row of stored.rows) {
        for (const id of Object.values(other)) expect(row.ref.toLowerCase(), label).not.toContain(id);
      }
    }

    // 대조: A 자신의 ID로는 일한다
    const mine = await send(env, c.method, c.request(own, own));
    expect(mine.status, `${label}: 자기 가게 ID로 부름 ${mine.text}`).toBe(c.ownStatus);
  } finally {
    await db.close();
  }
}
