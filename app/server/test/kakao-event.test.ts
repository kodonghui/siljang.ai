import { describe, expect, it, vi } from "vitest";
import { kakaoEvents, type NoticeEventInput, planKakaoDeliveryCheck, planKakaoEventRequest } from "../src/kakao-event";
import { Secret } from "../src/settings";

const TASK = "10000000-0000-4000-8000-000000000070";
const NOTICE = "20000000-0000-4000-8000-000000000070";
const BOT = "a".repeat(24);
const USER = "synthetic-event-user";
const NOW = new Date("2026-11-22T03:00:00Z");
const input = (patch: Partial<NoticeEventInput> = {}): NoticeEventInput => ({
  botId: BOT,
  userKey: USER,
  noticeKey: NOTICE,
  isFriend: true,
  eventAvailable: true,
  status: "pending",
  attemptsDone: 0,
  nextAttemptAt: null,
  scheduledFor: null,
  timeZone: "Asia/Seoul",
  ...patch,
});
const key = () => new Secret("synthetic-event-rest-key");
const recipient = { type: "botUserKey", id: USER } as const;
const delivered = () => ({ taskID: TASK, status: "ALL SUCCESS", allRequestCount: 1, successCount: 1 });
const failure = (errorType: number, patch: Record<string, unknown> = {}) => ({
  taskID: TASK,
  status: "1 FAIL",
  allRequestCount: 1,
  successCount: 0,
  fail: { count: 1, list: [{ userID: USER, reqUserType: "botUserKey", errorType, ...patch }] },
});

function harness(response: unknown, status = 200) {
  const send = vi.fn<typeof fetch>(async () => Response.json(response, { status }));
  return { send, client: kakaoEvents(key(), { fetch: send }) };
}

describe("카카오 Event API 공통 전송(TASK-028, G4/G5)", () => {
  it.each([301, 302, 303, 307, 308])("%s의 실패 본문을 설정 오류로 분류하거나 재전송하지 않음", async (status) => {
    const response = Response.json(
      { status: "FAIL", message: "Invalid bot ID. Check your Bot ID." },
      { status, headers: { Location: "https://other.example/event" } },
    );
    if (response.body === null) throw new Error("시험 본문 없음");
    const cancel = vi.spyOn(response.body, "cancel");
    const send = vi.fn<typeof fetch>(async () => response);
    const client = kakaoEvents(key(), { fetch: send });
    expect(await client.requestNotice(input(), NOW)).toMatchObject({
      kind: "failed",
      code: "kakao_error",
      retryable: true,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(String(send.mock.calls[0]?.[0])).toBe(`https://bot-api.kakao.com/v2/bots/${BOT}/talk`);
    expect(send.mock.calls[0]?.[1]?.redirect).toBe("manual");
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([301, 302, 303, 307, 308])("%s 전달 확인을 pending으로 두고 본문을 읽지 않음", async (status) => {
    const response = Response.json(delivered(), { status, headers: { Location: "https://other.example/task" } });
    if (response.body === null) throw new Error("시험 본문 없음");
    const cancel = vi.spyOn(response.body, "cancel");
    const send = vi.fn<typeof fetch>(async () => response);
    const client = kakaoEvents(key(), { fetch: send });
    expect(await client.checkDelivery(TASK, recipient)).toEqual({ kind: "pending" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(String(send.mock.calls[0]?.[0])).toBe(`https://bot-api.kakao.com/v1/tasks/${TASK}`);
    expect(send.mock.calls[0]?.[1]?.redirect).toBe("manual");
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("개발 채널 %s의 고정 주소/정한 이벤트/안내 키만 보내고 접수만 표시함", async (development) => {
    const h = harness({ status: "SUCCESS", taskId: TASK });
    expect(await h.client.requestNotice(input({ development }), NOW)).toEqual({ kind: "accepted", taskId: TASK });
    const [url, init] = h.send.mock.calls[0] ?? [];
    expect(String(url)).toBe(`https://bot-api.kakao.com/v2/bots/${BOT}${development ? "!" : ""}/talk`);
    expect(init?.redirect).toBe("manual");
    expect(new Headers(init?.headers).has("Cookie")).toBe(false);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init?.headers).get("Authorization")).toBe("KakaoAK synthetic-event-rest-key");
    expect(JSON.parse(String(init?.body))).toEqual({
      event: { name: "siljang_notice" },
      user: [recipient],
      params: { noticeKey: NOTICE },
    });
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["sent", "complete"],
    ["confirming", "complete"],
    ["delivered_on_reply", "complete"],
    ["dropped", "complete"],
  ] as const)("%s 안내를 다시 요청하지 않음", async (status, reason) => {
    const h = harness({ status: "SUCCESS", taskId: TASK });
    expect(await h.client.requestNotice(input({ status }), NOW)).toEqual({ kind: "not_requested", reason });
    expect(h.send).not.toHaveBeenCalled();
  });

  it.each([
    [{ isFriend: false }, "not_friend"],
    [{ eventAvailable: false }, "cannot_send"],
    [{ attemptsDone: 4 }, "exhausted"],
    [{ nextAttemptAt: new Date(NOW.getTime() + 1) }, "retry_wait"],
    [{ scheduledFor: new Date(NOW.getTime() + 1) }, "scheduled"],
  ] as const)("친구/가게/시도/예약 조건 %j에서는 HTTP를 보내지 않음", async (patch, reason) => {
    const h = harness({ status: "SUCCESS", taskId: TASK });
    expect(await h.client.requestNotice(input(patch), NOW)).toEqual({ kind: "not_requested", reason });
    expect(h.send).not.toHaveBeenCalled();
  });

  it.each([
    ["2026-11-21T22:59:59Z", false],
    ["2026-11-21T23:00:00Z", true],
    ["2026-11-22T11:50:59Z", true],
    ["2026-11-22T11:51:00Z", false],
  ])("정해진 시각 안내 %s는 가게 시간 08:00~20:50에서만 요청함", async (at, allowed) => {
    const h = harness({ status: "SUCCESS", taskId: TASK });
    const result = await h.client.requestNotice(
      input({ scheduledFor: new Date("2026-11-20T23:00:00Z") }),
      new Date(String(at)),
    );
    expect(result.kind).toBe(allowed ? "accepted" : "not_requested");
    expect(h.send).toHaveBeenCalledTimes(allowed ? 1 : 0);
  });

  it("정해진 시각 안내는 서울 외 가게 시간대를 사용하며 즉시 안내에는 시간 창을 적용하지 않음", async () => {
    const h = harness({ status: "SUCCESS", taskId: TASK });
    const at = new Date("2026-11-22T12:00:00Z");
    expect(
      (
        await h.client.requestNotice(
          input({ timeZone: "America/New_York", scheduledFor: new Date("2026-11-20T00:00:00Z") }),
          at,
        )
      ).kind,
    ).toBe("not_requested");
    expect((await h.client.requestNotice(input(), new Date("2026-11-22T18:00:00Z"))).kind).toBe("accepted");
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it.each([
    { botId: "https://example.org/bot" },
    { botId: `${BOT}!` },
    { noticeKey: "../../secret" },
    { userKey: "bad\nuser" },
    { attemptsDone: -1 },
    { attemptsDone: 5 },
    { timeZone: "bad-zone" },
    { scheduledFor: new Date("invalid") },
  ])("잘못된 값 %j는 비공개 값을 오류에 싣지 않고 전송 전에 거절함", async (patch) => {
    const h = harness({ status: "SUCCESS", taskId: TASK });
    await expect(h.client.requestNotice(input(patch), NOW)).rejects.toThrow("invalid Kakao event input");
    expect(h.send).not.toHaveBeenCalled();
  });

  it.each([
    ["Invalid bot ID. Check your Bot ID.", "event_setup", false, true, "owner"],
    ["The channel is not connected.", "event_setup", false, true, "owner"],
    ["Invalid Event name.\nCheck your Event name.", "event_setup", false, true, "owner"],
    ["Wallet not found. Bot must have an activated wallet to use the Event API.", "wallet", false, true, "owner"],
    ["Non-sufficient funds. Check your wallet balance.", "wallet", false, false, "operator"],
    [
      "API request limit exceeded. Please contact KakaoDevelopers technical support.",
      "limit",
      false,
      false,
      "operator",
    ],
    ["Request timed out. Please try again.", "kakao_error", true, false, null],
    ["synthetic-private-unknown-error", "kakao_error", true, false, null],
    ["Invalid appKey. Check your appKey.", "kakao_error", true, false, null],
    ["Skill server IP must be identical to the one set in the app.", "kakao_error", true, false, null],
  ])(
    "요청 실패를 정한 분류로만 돌려주고 자동 재전송하지 않음: %s",
    async (message, code, retryable, disableChannel, attention) => {
      const h = harness({ status: "FAIL", message });
      const result = await h.client.requestNotice(input(), NOW);
      expect(result).toEqual({ kind: "failed", code, retryable, disableChannel, attention });
      expect(JSON.stringify(result)).not.toContain(String(message));
      expect(h.send).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [429, "limit", false],
    [503, "kakao_error", true],
    [408, "kakao_error", true],
  ])("HTTP %s를 고정 분류로 반환함", async (status, code, retryable) => {
    const h = harness({ private: "synthetic-private-body" }, Number(status));
    expect(await h.client.requestNotice(input(), NOW)).toMatchObject({ kind: "failed", code, retryable });
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("연결 예외를 본문 없이 분류하고 taskId가 없는 성공은 접수로 세지 않음", async () => {
    const send = vi.fn<typeof fetch>(async () => {
      throw new Error("synthetic-private-error");
    });
    expect(await kakaoEvents(key(), { fetch: send }).requestNotice(input(), NOW)).toMatchObject({
      kind: "failed",
      code: "kakao_error",
      retryable: true,
    });
    expect((await harness({ status: "SUCCESS" }).client.requestNotice(input(), NOW)).kind).toBe("failed");
  });

  it("응답 선언/실제 스트림의 한도를 넘으면 취소하고 접수로 세지 않음", async () => {
    for (const declared of [false, true]) {
      const cancel = vi.fn();
      const send = vi.fn<typeof fetch>(
        async () =>
          new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(new Uint8Array(20_000));
              },
              cancel,
            }),
            { headers: declared ? { "Content-Length": "20000" } : {} },
          ),
      );
      expect((await kakaoEvents(key(), { fetch: send }).requestNotice(input(), NOW)).kind).toBe("failed");
      expect(cancel).toHaveBeenCalledTimes(1);
    }
  });

  it("응답 본문이 끝나지 않아도 전체 기한에 취소하고 끝냄", async () => {
    const cancel = vi.fn();
    const send = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ cancel })));
    expect((await kakaoEvents(key(), { fetch: send, timeoutMs: 5 }).requestNotice(input(), NOW)).kind).toBe("failed");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("전달 결과는 taskID/한 사용자/성공 수를 확인한 뒤에만 전달 성공으로 반환함", async () => {
    const h = harness(delivered());
    expect(await h.client.checkDelivery(TASK, recipient)).toEqual({ kind: "delivered" });
    expect(String(h.send.mock.calls[0]?.[0])).toBe(`https://bot-api.kakao.com/v1/tasks/${TASK}`);
    expect(h.send.mock.calls[0]?.[1]?.method).toBe("GET");
  });

  it.each([
    { ...delivered(), taskID: NOTICE },
    { ...delivered(), successCount: 0 },
    { ...delivered(), allRequestCount: 2 },
    { status: "SUCCESS", taskID: TASK },
    { ...delivered(), fail: { count: 1, list: [] } },
  ])("불일치/미완성 전달 결과 %j를 보냄으로 세지 않음", async (body) => {
    expect(await harness(body).client.checkDelivery(TASK, recipient)).toEqual({ kind: "pending" });
  });

  it.each([
    [101, "not_friend", false, false, null],
    [102, "cannot_send", false, false, null],
    [103, "cannot_send", false, false, null],
    [201, "skill_error", true, false, null],
    [202, "skill_error", true, false, null],
    [203, "skill_error", true, false, null],
    [204, "skill_error", true, false, null],
    [205, "skill_error", true, false, null],
    [301, "kakao_error", true, false, null],
    [302, "event_setup", false, true, "owner"],
    [311, "event_setup", false, true, "owner"],
    [401, "limit", false, false, "operator"],
    [407, "limit", false, false, "operator"],
    [999, "kakao_error", true, false, null],
    [888, "unknown", false, false, "operator"],
  ])("전달 실패 %s를 사용자/작업과 맞춰 분류함", async (errorType, code, retryable, disableChannel, attention) => {
    expect(await harness(failure(Number(errorType))).client.checkDelivery(TASK, recipient)).toEqual({
      kind: "failed",
      code,
      retryable,
      disableChannel,
      attention,
    });
  });

  it("다른 사용자/유형의 실패 결과를 현재 손님의 결과로 쓰지 않음", async () => {
    for (const patch of [{ userID: "other-synthetic-user" }, { reqUserType: "appUserId" }]) {
      expect(await harness(failure(101, patch)).client.checkDelivery(TASK, recipient)).toEqual({ kind: "pending" });
    }
  });

  it("공식 errorMsg만 온 실패도 본문을 보존하지 않고 분류함", async () => {
    const body = failure(101);
    delete (body.fail.list[0] as { errorType?: number }).errorType;
    Object.assign(body.fail.list[0] ?? {}, { errorMsg: "Request user is not a friend of talk channel's." });
    expect(await harness(body).client.checkDelivery(TASK, recipient)).toMatchObject({
      kind: "failed",
      code: "not_friend",
    });
  });

  it("조회 자체의 실패/본문 오류는 확인 중으로 두고 다시 발신하지 않음", async () => {
    for (const status of [404, 429, 503])
      expect(await harness({}, status).client.checkDelivery(TASK, recipient)).toEqual({ kind: "pending" });
    const h = harness({ status: "SUCCESS", taskId: TASK });
    await expect(h.client.checkDelivery("../../secret", recipient)).rejects.toThrow("invalid Kakao event input");
    expect(h.send).not.toHaveBeenCalled();
  });
});

describe("카카오 접수/전달의 재시도 계획(TASK-028, G4/G5)", () => {
  const failed = {
    kind: "failed",
    code: "kakao_error",
    retryable: true,
    disableChannel: false,
    attention: null,
  } as const;
  it("요청 접수는 보냄이 아니라 확인 중이며 첫 조회는1분 뒤임", () => {
    expect(planKakaoEventRequest(1, NOW, { kind: "accepted", taskId: TASK })).toEqual({
      status: "confirming",
      taskId: TASK,
      requestedAt: NOW,
      nextCheckAt: new Date(NOW.getTime() + 60_000),
    });
  });
  it.each([
    [1, 1],
    [2, 5],
    [3, 30],
  ])("%s번째 실패는 %s분 뒤 다시 요청함", (attempt, minutes) => {
    expect(planKakaoEventRequest(attempt, NOW, failed)).toEqual({
      status: "retrying",
      nextAttemptAt: new Date(NOW.getTime() + minutes * 60_000),
      failure: failed,
    });
  });
  it("네 번째 실패와 다시 못 보내는 실패는 다음 대화로 넘김", () => {
    expect(planKakaoEventRequest(4, NOW, failed)).toEqual({ status: "deferred", failure: failed });
    const permanent = { ...failed, retryable: false, code: "not_friend" } as const;
    expect(planKakaoEventRequest(1, NOW, permanent)).toEqual({ status: "deferred", failure: permanent });
  });
  it.each([
    [1, 5],
    [5, 30],
  ])("요청 뒤 %s분의 미확인은 요청 뒤 %s분에 다시 조회함", (checked, next) => {
    expect(planKakaoDeliveryCheck(NOW, new Date(NOW.getTime() + checked * 60_000), 1, { kind: "pending" })).toEqual({
      status: "confirming",
      nextCheckAt: new Date(NOW.getTime() + next * 60_000),
    });
  });
  it("30분 뒤에도 모르면 unknown으로 다음 대화에 남기고 성공한 조회만 보냄으로 남김", () => {
    const at = new Date(NOW.getTime() + 30 * 60_000);
    expect(planKakaoDeliveryCheck(NOW, at, 1, { kind: "pending" })).toMatchObject({
      status: "deferred",
      failure: { code: "unknown", retryable: false },
    });
    expect(planKakaoDeliveryCheck(NOW, at, 1, { kind: "delivered" })).toEqual({ status: "sent", sentAt: at });
    expect(planKakaoDeliveryCheck(NOW, at, 4, failed)).toEqual({ status: "deferred", failure: failed });
  });
});
