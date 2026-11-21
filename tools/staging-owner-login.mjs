/** TASK-020: 배포 뒤 로그인 시작 설정을 확인하며 인가 주소·state·쿠키 원문은 출력하지 않는다. */
import { pathToFileURL } from "node:url";

export async function verifyOwnerLoginStart(options) {
  if (!/^staging\.[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(options.domain ?? ""))
    throw new Error("staging_owner_domain_invalid");
  const origin = `https://${options.domain}`;
  const redirectUri = `${origin}/owner/login/callback`;
  let response;
  try {
    response = await (options.fetch ?? fetch)(`${origin}/api/owner/session/authorization`, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ redirectUri }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("staging_owner_start_unavailable");
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => {});
    throw new Error("staging_owner_start_failed");
  }
  try {
    const body = await response.json();
    const url = new URL(body.authorizationUrl);
    if (
      url.origin !== "https://kauth.kakao.com" ||
      url.pathname !== "/oauth/authorize" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== "" ||
      !url.searchParams.get("client_id") ||
      url.searchParams.get("response_type") !== "code" ||
      url.searchParams.get("redirect_uri") !== redirectUri ||
      typeof body.state !== "string" ||
      body.state.length === 0 ||
      url.searchParams.get("state") !== body.state ||
      url.searchParams.get("code_challenge_method") !== "S256" ||
      !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("code_challenge") ?? "") ||
      url.searchParams.get("scope") !== "plusfriends" ||
      response.headers.get("cache-control") !== "no-store"
    )
      throw new Error();
  } catch {
    throw new Error("staging_owner_start_invalid");
  }
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith("siljang_login=")) ?? "";
  const [pair, ...attributes] = cookie.split(";").map((s) => s.trim());
  const attrs = attributes.map((s) => s.toLowerCase());
  if (
    !/^siljang_login=[A-Za-z0-9_-]{43}$/.test(pair ?? "") ||
    !["httponly", "secure", "samesite=lax", "max-age=600"].every((a) => attrs.includes(a))
  )
    throw new Error("staging_owner_cookie_invalid");
  return { status: 200, pkce: "S256", cookieSeconds: 600 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await verifyOwnerLoginStart({ domain: process.env.SILJANG_STAGING_DOMAIN });
    console.log(JSON.stringify({ event: "staging_owner_start_verified", ...result }));
  } catch (error) {
    const code =
      error instanceof Error && /^staging_owner_[a-z_]+$/.test(error.message)
        ? error.message
        : "staging_owner_start_failed";
    console.error(JSON.stringify({ event: "staging_owner_start_failed", code }));
    process.exitCode = 1;
  }
}
