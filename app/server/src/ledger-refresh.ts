import { readBytesLimited } from "./body";
import {
  GoogleLedgerUnavailableError,
  LEDGER_GOOGLE_SCOPE,
} from "./ledger-google-auth";
import { Secret } from "./settings";

/** 갱신 토큰은 요청 본문에만 보낸다. 권한 해제와 일시 장애를 구분한다. */
export async function googleLedgerRefresh(
  config: { readonly clientId: Secret; readonly clientSecret: Secret },
  refreshToken: Secret,
  options: { readonly fetch?: typeof fetch; readonly timeoutMs?: number } = {},
): Promise<Secret | null> {
  try {
    const response = await (options.fetch ?? fetch)(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: config.clientId.reveal(),
          client_secret: config.clientSecret.reveal(),
          refresh_token: refreshToken.reveal(),
        }).toString(),
      },
    );
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if ([400, 401, 403].includes(response.status)) return null;
      throw new GoogleLedgerUnavailableError();
    }
    const bytes = await readBytesLimited(
      response,
      65536,
      () => new GoogleLedgerUnavailableError(),
    );
    const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof data !== "object" || data === null || Array.isArray(data))
      throw new GoogleLedgerUnavailableError();
    const value = data as Record<string, unknown>;
    if (
      typeof value.access_token !== "string" ||
      value.access_token.length < 1 ||
      value.access_token.length > 8192 ||
      [...value.access_token].some(
        (char) => char.charCodeAt(0) < 33 || char.charCodeAt(0) > 126,
      ) ||
      value.token_type !== "Bearer" ||
      typeof value.expires_in !== "number" ||
      !Number.isSafeInteger(value.expires_in) ||
      value.expires_in < 1 ||
      value.expires_in > 86400 ||
      (value.scope !== undefined && value.scope !== LEDGER_GOOGLE_SCOPE)
    )
      throw new GoogleLedgerUnavailableError();
    return new Secret(value.access_token);
  } catch {
    throw new GoogleLedgerUnavailableError();
  }
}
