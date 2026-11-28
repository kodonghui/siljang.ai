import { requireJson } from "./body";
import { type GoogleLedgerOAuthSettings, googleLedgerOAuth } from "./ledger-google-auth";
import { parseLedgerAuthorization } from "./ledger-input";
import {
  LEDGER_COOKIE,
  LEDGER_OAUTH_SECONDS,
  type LedgerOAuthScope,
  startLedgerOAuth,
  verifyLedgerOAuth,
} from "./ledger-oauth";
import { sameOrigin } from "./operator-login";
import { cookie } from "./owner-oauth";
import { ApiError, fieldError } from "./problem";
import type { ShopRequest } from "./routes";
import type { Secret } from "./settings";

export interface LedgerAuthorizationService {
  start(
    scope: LedgerOAuthScope,
    redirect: string,
    now: Date,
  ): Promise<{ nonce: string; state: string; expiresAt: Date; authorizationUrl: string }>;
  verify(
    scope: LedgerOAuthScope,
    state: string,
    nonce: string | null,
    now: Date,
  ): Promise<{ redirect: string; verifier: string } | null>;
}
export function ledgerAuthorizationService(
  key: Secret,
  settings: GoogleLedgerOAuthSettings,
): LedgerAuthorizationService {
  const google = googleLedgerOAuth(settings);
  return {
    async start(scope, redirect, now) {
      if (!settings.redirectUris.includes(redirect)) throw fieldError("/redirectUri", "not_allowed");
      const state = await startLedgerOAuth(key, scope, redirect, now);
      return {
        nonce: state.nonce,
        state: state.state,
        expiresAt: state.expiresAt,
        authorizationUrl: google.authorizeUrl(redirect, state.state, state.challenge),
      };
    },
    async verify(scope, state, nonce, now) {
      for (const redirect of settings.redirectUris) {
        const verifier = await verifyLedgerOAuth(key, scope, state, nonce, redirect, now);
        if (verifier !== null) return { redirect, verifier };
      }
      return null;
    },
  };
}
export async function authorizeLedger(r: ShopRequest): Promise<Response> {
  if (!sameOrigin(r.req.raw)) throw fieldError("header:Origin", "not_allowed");
  requireJson(r.req.raw);
  const input = parseLedgerAuthorization(await r.body()),
    actor = r.scope.via;
  if (actor.kind !== "owner") throw new ApiError("unauthenticated");
  const result = await r.services
    .ledgerAuthorization()
    .start({ shopId: r.scope.shopId, ownerId: actor.ownerId }, input.redirectUri, r.services.now());
  const response = r.json(
    { authorizationUrl: result.authorizationUrl, state: result.state, expiresAt: result.expiresAt.toISOString() },
    200,
    { "cache-control": "no-store" },
  );
  response.headers.append("set-cookie", cookie(LEDGER_COOKIE, result.nonce, LEDGER_OAUTH_SECONDS));
  return response;
}
