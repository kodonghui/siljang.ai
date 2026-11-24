/** 카카오 토큰은 이 요청에서만 쓰고 저장·로그·응답에 싣지 않는다(REQ-135). */
import { readBytesLimited } from "./body";
import type { OwnerAuthSettings } from "./settings";

export class KakaoUnavailableError extends Error {
  override readonly name = "KakaoUnavailableError";
}

export interface KakaoOwner {
  readonly accountId: string;
  readonly friend: boolean | null;
}

export interface OwnerAuth {
  authorizeUrl(redirect: string, state: string, challenge: string): string;
  signIn(code: string, redirect: string, verifier: string): Promise<KakaoOwner | null>;
  channelFriend(accountId: string): Promise<boolean | null>;
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export function kakaoOwnerAuth(
  settings: OwnerAuthSettings,
  options: { readonly fetch?: Fetch; readonly timeoutMs?: number } = {},
): OwnerAuth {
  const send = options.fetch ?? fetch;
  async function request(url: string, init: RequestInit): Promise<Record<string, unknown> | null> {
    try {
      const response = await send(url, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        if (response.status === 400 || response.status === 401 || response.status === 403) return null;
        throw new KakaoUnavailableError();
      }
      const raw = await readBytesLimited(response, 65536, () => new KakaoUnavailableError());
      const data: unknown = JSON.parse(new TextDecoder().decode(raw));
      if (typeof data !== "object" || data === null || Array.isArray(data)) throw new KakaoUnavailableError();
      return data as Record<string, unknown>;
    } catch (error) {
      if (error instanceof KakaoUnavailableError) throw error;
      throw new KakaoUnavailableError();
    }
  }

  async function friend(headers: Record<string, string>, accountId?: string): Promise<boolean | null> {
    try {
      const query =
        accountId === undefined ? "" : `?${new URLSearchParams({ target_id_type: "user_id", target_id: accountId })}`;
      const data = await request(`https://kapi.kakao.com/v2/api/talk/channels${query}`, { method: "GET", headers });
      if (!Array.isArray(data?.channels)) return null;
      const channel = data.channels.find(
        (c: unknown) =>
          typeof c === "object" &&
          c !== null &&
          "channel_public_id" in c &&
          c.channel_public_id === settings.alertChannelId,
      );
      if (channel === undefined) return false;
      return channel.relation === "ADDED"
        ? true
        : channel.relation === "BLOCKED" || channel.relation === "NONE"
          ? false
          : null;
    } catch {
      return null;
    }
  }

  return {
    authorizeUrl(redirect, state, challenge) {
      const query = new URLSearchParams({
        client_id: settings.clientId.reveal(),
        redirect_uri: redirect,
        response_type: "code",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      });
      if (settings.scopes.length > 0) query.set("scope", settings.scopes.join(","));
      return `https://kauth.kakao.com/oauth/authorize?${query}`;
    },
    async signIn(code, redirect, verifier) {
      const token = await request("https://kauth.kakao.com/oauth/token", {
        method: "POST",
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
      if (token === null) return null;
      if (typeof token.access_token !== "string" || token.access_token.length === 0 || token.access_token.length > 8192)
        throw new KakaoUnavailableError();
      const headers = { Authorization: `Bearer ${token.access_token}` };
      const user = await request("https://kapi.kakao.com/v2/user/me", { method: "GET", headers });
      if (user === null) return null;
      // 카카오 사용자 번호의 정수 정밀도를 잃은 응답은 다른 계정으로 저장하지 않고 닫는다.
      if (typeof user.id !== "number" || !Number.isSafeInteger(user.id) || user.id <= 0)
        throw new KakaoUnavailableError();
      return {
        accountId: String(user.id),
        friend: settings.scopes.includes("plusfriends") ? await friend(headers) : null,
      };
    },
    channelFriend: (accountId) =>
      !settings.scopes.includes("plusfriends") || settings.adminKey === null
        ? Promise.resolve(null)
        : friend({ Authorization: `KakaoAK ${settings.adminKey.reveal()}` }, accountId),
  };
}
