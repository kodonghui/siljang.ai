export const HTTPS_URL_MAX = 2048;
interface HttpsUrlOptions {
  rejectUserInfo?: boolean;
  requirePrefix?: boolean;
}
export function httpsUrlReason(value: unknown, options: HttpsUrlOptions = {}): "too_long" | "bad_format" | null {
  if (typeof value !== "string") return "bad_format";
  const characters = [...value];
  if (characters.length > HTTPS_URL_MAX) return "too_long";
  if (
    characters.length < 9 ||
    /\s/.test(value) ||
    characters.some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
    (options.requirePrefix && !value.startsWith("https://"))
  )
    return "bad_format";
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" &&
      (!options.rejectUserInfo || (parsed.username === "" && parsed.password === ""))
      ? null
      : "bad_format";
  } catch {
    return "bad_format";
  }
}
export const isHttpsUrl = (value: unknown, options?: HttpsUrlOptions): value is string =>
  typeof value === "string" && httpsUrlReason(value, options) === null;
