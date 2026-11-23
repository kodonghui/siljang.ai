/** 공개 경로의 IP 한도. 원 IP를 저장하지 않고 경로별 HMAC으로 센다. */
import type { Context } from "hono";
import type { HonoEnv } from "./app";
import { clientIp } from "./client-ip";
import { ApiError } from "./problem";
import type { RateLimitRule } from "./rate-limit";
import { MissingSettingError, requestHash } from "./request-key";

export async function limitPublicRequest(c: Context<HonoEnv>, rule: RateLimitRule): Promise<void> {
  const settings = c.get("settings");
  const ip = clientIp(c);
  const secret = settings.secrets.REQUEST_HASH_KEY;
  if (secret === null) throw new MissingSettingError("public request rate settings are not available");
  const key = await requestHash(secret, "public-ip-rate", [rule.binding], ip);
  if (!(await c.get("services").limiter(rule).limit(key)))
    throw new ApiError("rate_limited", { retryAfterSeconds: 60 });
}
