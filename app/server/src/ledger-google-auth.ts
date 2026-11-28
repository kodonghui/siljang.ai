import { readBytesLimited } from "./body";
import { Secret } from "./settings";

// API035는 서버에서 고른 시트 ID를 연다. Picker에 OAuth 토큰을 넘기지 않으므로 Sheets 권한 하나만 요청한다.
export const LEDGER_GOOGLE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
export class GoogleLedgerUnavailableError extends Error {
  override readonly name = "GoogleLedgerUnavailableError";
  constructor() {
    super("Google ledger is unavailable");
  }
}
export interface GoogleLedgerOAuthSettings {
  readonly clientId: Secret;
  readonly clientSecret: Secret;
  readonly redirectUris: readonly string[];
}
export interface GoogleLedgerCredential {
  readonly accessToken: Secret;
  readonly refreshToken: Secret;
  readonly expiresAt: Date;
}
export interface GoogleLedgerOAuth {
  authorizeUrl(redirect: string, state: string, challenge: string): string;
  exchange(code: string, redirect: string, verifier: string): Promise<GoogleLedgerCredential | null>;
}
export function googleLedgerOAuth(
  settings: GoogleLedgerOAuthSettings,
  options: { readonly fetch?: typeof fetch; readonly timeoutMs?: number; readonly now?: () => Date } = {},
): GoogleLedgerOAuth {
  const send = options.fetch ?? fetch;
  function allowed(redirect: string): void {
    if (!settings.redirectUris.includes(redirect)) throw new TypeError("ledger redirect is not allowed");
  }
  function token(value: unknown): value is string {
    return (
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= 8192 &&
      [...value].every((char) => char.charCodeAt(0) >= 33 && char.charCodeAt(0) <= 126)
    );
  }
  return {
    authorizeUrl(redirect, state, challenge) {
      allowed(redirect);
      return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
        client_id: settings.clientId.reveal(),
        redirect_uri: redirect,
        response_type: "code",
        scope: LEDGER_GOOGLE_SCOPE,
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "false",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      })}`;
    },
    async exchange(code, redirect, verifier) {
      allowed(redirect);
      try {
        const response = await send("https://oauth2.googleapis.com/token", {
          method: "POST",
          redirect: "manual",
          signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: settings.clientId.reveal(),
            client_secret: settings.clientSecret.reveal(),
            redirect_uri: redirect,
            code,
            code_verifier: verifier,
          }).toString(),
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          if ([400, 401, 403].includes(response.status)) return null;
          throw new GoogleLedgerUnavailableError();
        }
        const bytes = await readBytesLimited(response, 65536, () => new GoogleLedgerUnavailableError());
        const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (typeof value !== "object" || value === null || Array.isArray(value))
          throw new GoogleLedgerUnavailableError();
        const data = value as Record<string, unknown>;
        if (
          !token(data.access_token) ||
          data.token_type !== "Bearer" ||
          typeof data.expires_in !== "number" ||
          !Number.isSafeInteger(data.expires_in) ||
          data.expires_in < 1 ||
          data.expires_in > 86400
        )
          throw new GoogleLedgerUnavailableError();
        if (!token(data.refresh_token)) return null;
        if (
          data.scope !== undefined &&
          (typeof data.scope !== "string" || !data.scope.split(/\s+/).includes(LEDGER_GOOGLE_SCOPE))
        )
          return null;
        const expiresAt = new Date((options.now?.() ?? new Date()).getTime() + data.expires_in * 1000);
        if (!Number.isFinite(expiresAt.getTime())) throw new GoogleLedgerUnavailableError();
        return { accessToken: new Secret(data.access_token), refreshToken: new Secret(data.refresh_token), expiresAt };
      } catch (error) {
        if (error instanceof GoogleLedgerUnavailableError) throw error;
        throw new GoogleLedgerUnavailableError();
      }
    },
  };
}
