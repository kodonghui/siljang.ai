import { describe, expect, it, vi } from "vitest";
import type { KakaoEvents, NoticeEventInput } from "../src/kakao-event";
import { MissingSettingError } from "../src/request-key";
import { createServices } from "../src/services";
import { readSettings } from "../src/settings";

const NOW = new Date("2026-11-22T03:00:00Z");
const TASK = "10000000-0000-4000-8000-000000000070";
const BOT = "a".repeat(24);
const USER = "synthetic-event-user";
const input: NoticeEventInput = {
  botId: BOT,
  userKey: USER,
  noticeKey: "20000000-0000-4000-8000-000000000070",
  isFriend: true,
  eventAvailable: true,
  status: "pending",
  attemptsDone: 0,
  nextAttemptAt: null,
  scheduledFor: null,
  timeZone: "Asia/Seoul",
};

const env = {
  KAKAO_REST_API_KEY: "fake-event-rest-key",
  KAKAO_CLIENT_SECRET: "fake-owner-secret",
  KAKAO_OWNER_REDIRECT_URIS: "https://owner.example/login/callback",
};

describe("카카오 공통 전송의 요청 서비스 연결(TASK-028, G4/G5)", () => {
  it("키가 없어도 서비스 생성과 관계없는 요청은 되며 사용한 때만 설정 누락을 알림", () => {
    const services = createServices({}, readSettings({}));
    expect(services.aiConfigured).toBe(false);
    expect(() => services.kakaoEvents()).toThrow(MissingSettingError);
  });

  it("시험용 전송은 실제 키나 HTTP 없이 같은 서비스로 주입함", async () => {
    const fake: KakaoEvents = {
      requestNotice: vi.fn<KakaoEvents["requestNotice"]>(async () => ({ kind: "accepted", taskId: TASK })),
      checkDelivery: vi.fn<KakaoEvents["checkDelivery"]>(async () => ({ kind: "delivered" })),
    };
    const services = createServices({}, readSettings({}), { kakaoEvents: fake });
    expect(services.kakaoEvents()).toBe(fake);
    expect(await services.kakaoEvents().requestNotice(input, NOW)).toEqual({ kind: "accepted", taskId: TASK });
    expect(fake.requestNotice).toHaveBeenCalledExactlyOnceWith(input, NOW);
  });

  it("서비스를 만들거나 꺼내는 것만으로 발신하지 않고 우리 REST 키로 접수와 전달을 따로 확인함", async () => {
    const send = vi.fn<typeof fetch>(async (_url, init) =>
      Response.json(
        init?.method === "POST"
          ? { status: "SUCCESS", taskId: TASK }
          : { status: "ALL SUCCESS", taskID: TASK, allRequestCount: 1, successCount: 1 },
      ),
    );
    vi.stubGlobal("fetch", send);
    try {
      const services = createServices(env, readSettings(env));
      expect(send).not.toHaveBeenCalled();
      const client = services.kakaoEvents();
      expect(services.kakaoEvents()).toBe(client);
      expect(send).not.toHaveBeenCalled();
      expect(await client.requestNotice(input, NOW)).toEqual({ kind: "accepted", taskId: TASK });
      expect(await client.checkDelivery(TASK, { type: "botUserKey", id: USER })).toEqual({ kind: "delivered" });
      expect(send).toHaveBeenCalledTimes(2);
      for (const [url, init] of send.mock.calls) {
        expect(new URL(String(url)).origin).toBe("https://bot-api.kakao.com");
        expect(new Headers(init?.headers).get("Authorization")).toBe(`KakaoAK ${env.KAKAO_REST_API_KEY}`);
        expect(new Headers(init?.headers).has("Cookie")).toBe(false);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("서비스에서 받은 실제 전송도 친구가 아니거나 완료된 안내는 보내지 않음", async () => {
    const send = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", send);
    try {
      const client = createServices(env, readSettings(env)).kakaoEvents();
      expect(await client.requestNotice({ ...input, isFriend: false }, NOW)).toEqual({
        kind: "not_requested",
        reason: "not_friend",
      });
      expect(await client.requestNotice({ ...input, status: "sent" }, NOW)).toEqual({
        kind: "not_requested",
        reason: "complete",
      });
      expect(send).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
