/** Cloudflare가 덮어쓴 접속지. IPv6는 같은 /64를 한도로 묶고 원 IP는 남기지 않는다. */
import type { Context } from "hono";
import type { HonoEnv } from "./app";
import { MissingSettingError } from "./request-key";

export function normalizedClientIp(value: string): string | null {
  if (value.length > 64) return null;
  if (/^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}$/.test(value))
    return value.split(".").every((part) => Number(part) <= 255) ? value : null;
  if (!value.includes(":") || !/^[0-9a-fA-F:.]+$/.test(value)) return null;
  try {
    const host = new URL(`http://[${value}]/`).hostname.slice(1, -1);
    const [left, right] = host.split("::");
    const head = left ? left.split(":") : [];
    const tail = right ? right.split(":") : [];
    const groups = right === undefined ? head : [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail];
    if (groups.length !== 8) return null;
    const words = groups.map((word) => Number.parseInt(word, 16));
    // IPv4를 감싼 IPv6도 원래 IPv4와 같은 한도로 센다.
    if (words.slice(0, 5).every((word) => word === 0) && words[5] === 65535) {
      const a = words[6],
        b = words[7];
      if (a === undefined || b === undefined) return null;
      return [a >> 8, a & 255, b >> 8, b & 255].join(".");
    }
    return `${words
      .slice(0, 4)
      .map((word) => word.toString(16))
      .join(":")}::/64`;
  } catch {
    return null;
  }
}

export function clientIp(c: Context<HonoEnv>): string {
  const supplied = c.req.header("cf-connecting-ip");
  if (supplied === undefined && c.get("settings").appEnv === "development") return "local";
  const result = supplied === undefined ? null : normalizedClientIp(supplied);
  if (result === null) throw new MissingSettingError("CF-Connecting-IP is not available");
  return result;
}
