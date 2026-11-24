import { describe, expect, it, vi } from "vitest";
import { kakaoOwnerEvents, type OwnerAlertEventInput } from "../src/kakao-event";
import { Secret } from "../src/settings";

const BOT = "b".repeat(24),
  ALERT = "10000000-0000-4000-8000-000000000072",
  TASK = "20000000-0000-4000-8000-000000000072",
  NOW = new Date("2026-11-24T00:00:00Z"),
  OWNER = "123456789";
const input = (patch: Partial<OwnerAlertEventInput> = {}): OwnerAlertEventInput => ({
  botId: BOT,
  appUserId: OWNER,
  alertKey: ALERT,
  text: "맞춤 주문 할 일이 생겼어요",
  url: "https://app.example/owner",
  isFriend: true,
  eventAvailable: true,
  status: "pending",
  attemptsDone: 0,
  nextAttemptAt: null,
  timeZone: "Asia/Seoul",
  ...patch,
});
describe("우리 채널 사장님 Event API 수신자(TASK-072)", () => {
  it("사장님 appUserId와 공개 알림 문구·주소만 우리 서비스 봇에 보내고 접수는 확인 중으로 남긴다", async () => {
    const send = vi.fn<typeof fetch>(async () => Response.json({ status: "SUCCESS", taskId: TASK }));
    const client = kakaoOwnerEvents(new Secret("synthetic-owner-rest-key"), { fetch: send });
    expect(await client.requestAlert(input(), NOW)).toEqual({ kind: "accepted", taskId: TASK });
    expect(send).toHaveBeenCalledOnce();
    const [url, init] = send.mock.calls[0] ?? [];
    expect(String(url)).toBe(`https://bot-api.kakao.com/v2/bots/${BOT}/talk`);
    expect(JSON.parse(String(init?.body))).toEqual({
      event: { name: "siljang_owner_alert" },
      user: [{ type: "appUserId", id: OWNER }],
      params: { alertKey: ALERT, text: "맞춤 주문 할 일이 생겼어요", url: "https://app.example/owner" },
    });
    expect(new Headers(init?.headers).has("Cookie")).toBe(false);
  });
  it("친구가 아니면 발신하지 않고 101 결과의 수신자 종류도 대조한다", async () => {
    const send = vi.fn<typeof fetch>(async () =>
      Response.json({
        taskID: TASK,
        status: "1 FAIL",
        allRequestCount: 1,
        successCount: 0,
        fail: { count: 1, list: [{ userID: OWNER, reqUserType: "appUserId", errorType: 101 }] },
      }),
    );
    const client = kakaoOwnerEvents(new Secret("synthetic-owner-rest-key"), { fetch: send });
    expect(await client.requestAlert(input({ isFriend: false }), NOW)).toEqual({
      kind: "not_requested",
      reason: "not_friend",
    });
    expect(send).not.toHaveBeenCalled();
    expect(await client.checkDelivery(TASK, OWNER)).toMatchObject({
      kind: "failed",
      code: "not_friend",
      retryable: false,
    });
  });
  it("봇 사용자 키를 사장님 번호로 받지 않는다", async () => {
    const send = vi.fn<typeof fetch>(),
      client = kakaoOwnerEvents(new Secret("synthetic-owner-rest-key"), { fetch: send });
    await expect(client.requestAlert(input({ appUserId: "synthetic-bot-user" }), NOW)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
  it.each([
    { text: "" },
    { text: "가".repeat(401) },
    { url: "https://app.example/owner?private=value" },
    { url: "http://app.example/owner" },
  ])("잘못된 알림 문구·주소는 HTTP 전에 거절한다: %o", async (patch) => {
    const send = vi.fn<typeof fetch>();
    await expect(
      kakaoOwnerEvents(new Secret("synthetic-owner-rest-key"), { fetch: send }).requestAlert(input(patch), NOW),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
