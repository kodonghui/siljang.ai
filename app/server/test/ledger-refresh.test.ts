import { describe, expect, it, vi } from "vitest";
import { googleLedgerRefresh } from "../src/ledger-refresh";
import { Secret } from "../src/settings";

describe("장부 OAuth 갱신", () => {
  it("고정 토큰 주소에 갱신 토큰을 보내고 접근 토큰을 비밀로 반환한다", async () => {
    const send = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(url).toBe("https://oauth2.googleapis.com/token");
      expect(init?.redirect).toBe("manual");
      expect(Object.fromEntries(new URLSearchParams(init?.body as string))).toEqual({
        grant_type: "refresh_token",
        client_id: "client",
        client_secret: "secret",
        refresh_token: "refresh",
      });
      return Response.json({
        access_token: "access",
        token_type: "Bearer",
        expires_in: 3600,
      });
    });
    const result = await googleLedgerRefresh(
      { clientId: new Secret("client"), clientSecret: new Secret("secret") },
      new Secret("refresh"),
      { fetch: send },
    );
    expect(result?.reveal()).toBe("access");
  });
  it("invalid_grant만 권한 상실이고 설정 오류와 서버 장애는 재시도한다", async () => {
    const config = {
      clientId: new Secret("client"),
      clientSecret: new Secret("secret"),
    };
    expect(
      await googleLedgerRefresh(config, new Secret("refresh"), {
        fetch: async () => Response.json({ error: "invalid_grant" }, { status: 400 }),
      }),
    ).toBeNull();
    await expect(
      googleLedgerRefresh(config, new Secret("refresh"), {
        fetch: async () => Response.json({ error: "invalid_client" }, { status: 401 }),
      }),
    ).rejects.toThrow();
    await expect(
      googleLedgerRefresh(config, new Secret("refresh"), {
        fetch: async () => new Response(null, { status: 503 }),
      }),
    ).rejects.toThrow();
  });
});
