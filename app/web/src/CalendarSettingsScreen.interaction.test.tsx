// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { CalendarSettingsScreen } from "./CalendarSettingsScreen";
import { OwnerArea } from "./OwnerArea";
import { ERROR_CODES } from "./problems";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const example = () =>
  structuredClone(api.paths["/owner/calendar"].get.responses[200].content["application/json"].examples.settings.value);
const conflictExample = () =>
  structuredClone(
    api.paths["/owner/calendar"].put.responses[200].content["application/json"].examples.updated_with_conflicts.value
      .conflicts,
  );
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const traceId = "0123456789abcdef0123456789abcdef";
let current: ReturnType<typeof example>, empty: boolean, conflicts: ReturnType<typeof conflictExample>;
let reads: number, writes: { body: Record<string, unknown>; key: string | null }[];
let getProblem: { code: string; status: number } | null, saveProblem: { code: string; status: number } | null;
let confirmation: "closed_day_with_orders" | "capacity_below_held" | null;
beforeEach(() => {
  current = example();
  empty = false;
  conflicts = [];
  reads = 0;
  writes = [];
  getProblem = saveProblem = null;
  confirmation = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        writes.push({ body, key: new Headers(init.headers).get("Idempotency-Key") });
        if (saveProblem && writes.length === 1) return json({ ...saveProblem, traceId }, saveProblem.status);
        if (confirmation && !body.confirm?.includes(confirmation))
          return json(
            {
              code: "confirmation_required",
              traceId,
              confirm: [{ kind: confirmation, count: 2, day: "2026-11-20" }],
              conflicts: conflicts.length ? conflicts : conflictExample(),
            },
            409,
          );
        const outcome = empty ? "created" : "updated";
        empty = false;
        current = { ...current, ...body, revision: "synthetic-saved" };
        return json({ outcome, calendar: current, conflicts });
      }
      reads++;
      return getProblem
        ? json({ ...getProblem, traceId }, getProblem.status)
        : empty
          ? json({ code: "not_set", traceId }, 404)
          : json(current);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const node of document.querySelectorAll("[data-announcer]")) node.remove();
});
function conflictDays(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const day = `2026-12-${String(index + 1).padStart(2, "0")}`;
    return {
      ...conflictExample()[0],
      day,
      orders: [
        {
          ...conflictExample()[0].orders[0],
          orderId: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
          orderNo: `SYN${String(index).padStart(3, "0")}`,
          pickupAt: `${day}T15:00:00+09:00`,
        },
      ],
    };
  });
}
function area(extra: { sessionChecking?: boolean; sessionFailed?: boolean } = {}) {
  const props = {
    shopName: "합성 캘린더 가게",
    onNavigate: vi.fn(),
    onSessionExpired: vi.fn(),
    onRegisterShop: vi.fn(),
    onLogout: vi.fn(),
    ...extra,
  };
  return {
    ...render(
      <MemoryRouter>
        <CalendarSettingsScreen {...props} />
      </MemoryRouter>,
    ),
    props,
  };
}
const main = () => within(screen.getByRole("main"));
const loaded = () => screen.findByLabelText("하루 최대 개수");
const form = () => screen.getByRole("form", { name: "영업 캘린더 설정" });
it.each([false, true])("설정 GET 진행 중에는 최초/새로 고침 %s 모두 로그아웃과 저장을 잠근다", async (background) => {
  let view = background ? area() : null;
  if (view) {
    await loaded();
    fireEvent.change(screen.getByLabelText("하루 최대 개수"), { target: { value: "6" } });
  }
  const previousFetch = globalThis.fetch;
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const read = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    init?.method === "PUT" ? previousFetch(input, init) : pending,
  );
  vi.stubGlobal("fetch", read);
  if (view) fireEvent.click(screen.getByRole("button", { name: "새로 고침" }));
  else view = area();
  await waitFor(() => expect(read).toHaveBeenCalledOnce());
  const logout = screen.getByRole("button", { name: "로그아웃" }) as HTMLButtonElement;
  fireEvent.click(logout);
  expect(view.props.onLogout).not.toHaveBeenCalled();
  expect(logout.disabled).toBe(true);
  expect((screen.getByRole("button", { name: "처리하고 있어요" }) as HTMLButtonElement).disabled).toBe(true);
  if (background) {
    expect((screen.getByLabelText("하루 최대 개수") as HTMLInputElement).disabled).toBe(true);
    fireEvent.submit(form());
  }
  expect(writes).toHaveLength(0);
  await act(async () => finish(json(current)));
  await waitFor(() => expect(logout.disabled).toBe(false));
  expect((screen.getByLabelText("하루 최대 개수") as HTMLInputElement).value).toBe(
    background ? "6" : String(current.dailyCapacity),
  );
  fireEvent.click(logout);
  expect(view.props.onLogout).toHaveBeenCalledOnce();
});
it("처음 정하는 기본값은 저장하기 전까지 보내지 않고 baseRevision null로 저장한다", async () => {
  empty = true;
  area();
  await loaded();
  await main().findByText("처음 정해요. 기본값을 확인하고 저장해 주세요");
  expect((screen.getByLabelText("답하는 시간 시작") as HTMLInputElement).value).toBe("09:00");
  expect((screen.getByLabelText("답하는 시간 끝") as HTMLInputElement).value).toBe("21:00");
  expect(writes).toHaveLength(0);
  fireEvent.submit(form());
  await main().findByText("저장했어요");
  expect(writes[0]?.body.baseRevision).toBeNull();
});
it("요일은 눌린 상태를 알리고 바꾼 기준을 저장한다", async () => {
  area();
  await loaded();
  const sunday = screen.getByRole("button", { name: "일요일" });
  fireEvent.click(sunday);
  expect(sunday.getAttribute("aria-pressed")).toBe("true");
  fireEvent.submit(form());
  await main().findByText("저장했어요");
  expect(writes[0]?.body).toMatchObject({ closedWeekdays: [1, 7], baseRevision: "9fd223a65f5a" });
  expect(writes[0]?.body).not.toHaveProperty("updatedAt");
});
it("그대로 저장하면 전송 없이 바뀐 것이 없다고 알린다", async () => {
  area();
  await loaded();
  fireEvent.submit(form());
  await main().findByText("바뀐 것이 없어요");
  expect(writes).toHaveLength(0);
});
it.each([false, true])("같은 revision의 설정 새로 고침은 초안 %s를 조용히 보존한다", async (dirty) => {
  area();
  await loaded();
  if (dirty) fireEvent.change(screen.getByLabelText("후기 부탁 시각"), { target: { value: "12:00" } });
  fireEvent.click(screen.getByRole("button", { name: "새로 고침" }));
  await waitFor(() => expect(reads).toBe(2));
  await act(async () => {});
  expect(main().queryByText("그 사이 바뀌었어요. 지금 상태를 확인해 주세요")).toBeNull();
  expect((screen.getByLabelText("후기 부탁 시각") as HTMLInputElement).disabled).toBe(false);
  expect((screen.getByLabelText("후기 부탁 시각") as HTMLInputElement).value).toBe(dirty ? "12:00" : "11:00");
});
it("설정 초안이 없으면 다른 기기의 새 revision을 조용히 반영한다", async () => {
  area();
  await loaded();
  current = { ...current, dailyCapacity: 8, revision: "synthetic-latest" };
  fireEvent.click(screen.getByRole("button", { name: "새로 고침" }));
  await waitFor(() => expect((screen.getByLabelText("하루 최대 개수") as HTMLInputElement).value).toBe("8"));
  expect(main().queryByText("그 사이 바뀌었어요. 지금 상태를 확인해 주세요")).toBeNull();
});
it("조용히 바뀐 새 값에는 지난 변경 없음 안내를 지운다", async () => {
  area();
  await loaded();
  fireEvent.submit(form());
  await main().findByText("바뀐 것이 없어요");
  current = { ...current, dailyCapacity: 8, revision: "synthetic-latest" };
  fireEvent.click(screen.getByRole("button", { name: "새로 고침" }));
  await waitFor(() => expect((screen.getByLabelText("하루 최대 개수") as HTMLInputElement).value).toBe("8"));
  expect(main().queryByText("바뀐 것이 없어요")).toBeNull();
});
it("처음 정하는 중 다시 읽어도 미저장 초안은 남긴다", async () => {
  empty = true;
  area();
  await loaded();
  fireEvent.change(screen.getByLabelText("하루 최대 개수"), { target: { value: "4" } });
  fireEvent.click(screen.getByRole("button", { name: "새로 고침" }));
  await waitFor(() => expect(reads).toBe(2));
  await act(async () => {});
  expect((screen.getByLabelText("하루 최대 개수") as HTMLInputElement).value).toBe("4");
  expect(writes).toHaveLength(0);
});
it("처음 정하는 동안 다른 기기가 저장하면 최신 값과 내 초안을 대조한다", async () => {
  empty = true;
  area();
  await loaded();
  fireEvent.change(screen.getByLabelText("하루 최대 개수"), { target: { value: "4" } });
  empty = false;
  fireEvent.click(screen.getByRole("button", { name: "새로 고침" }));
  await main().findByText("지금 하루 최대 개수: 5");
  expect(main().queryByText("처음 정해요. 기본값을 확인하고 저장해 주세요")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "내 변경 다시 적용" }));
  expect((screen.getByLabelText("하루 최대 개수") as HTMLInputElement).value).toBe("4");
});
it("요일 충돌은 다른 기기의 화요일과 내 일요일을 함께 남긴다", async () => {
  area();
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "일요일" }));
  current = { ...current, closedWeekdays: [1, 2], revision: "synthetic-latest" };
  saveProblem = { code: "version_conflict", status: 409 };
  fireEvent.submit(form());
  await main().findByText("지금 쉬는 요일: 월요일 · 화요일");
  fireEvent.click(screen.getByRole("button", { name: "내 변경 다시 적용" }));
  expect(screen.getByRole("button", { name: "화요일" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "일요일" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.submit(form());
  await main().findByText("저장했어요");
  expect(writes[1]?.body.closedWeekdays).toEqual([1, 2, 7]);
});
it("범위/시각 오류는 입력을 보존하고 첫 오류로 초점을 옮긴다", async () => {
  area();
  const input = (await loaded()) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "101" } });
  fireEvent.change(screen.getByLabelText("후기 부탁 시각"), { target: { value: "20:51" } });
  fireEvent.submit(form());
  await waitFor(() => expect(input.getAttribute("aria-invalid")).toBe("true"));
  expect(input.value).toBe("101");
  expect(document.activeElement).toBe(input);
  expect(writes).toHaveLength(0);
});
it.each(["checking", "failed"])("첫 세션 %s에는 설정을 읽지 않고 회복 뒤 한 번 읽는다", async (state) => {
  const view = area(state === "checking" ? { sessionChecking: true } : { sessionFailed: true });
  await act(async () => {});
  expect(reads).toBe(0);
  view.rerender(
    <MemoryRouter>
      <CalendarSettingsScreen {...view.props} sessionChecking={false} sessionFailed={false} />
    </MemoryRouter>,
  );
  await loaded();
  expect(reads).toBe(1);
});
it.each([
  { code: "unauthenticated", status: 401, callback: "onSessionExpired" },
  { code: "shop_not_registered", status: 404, callback: "onRegisterShop" },
] as const)("조회 $code는 권한 경로로 간다", async (problem) => {
  getProblem = problem;
  const view = area();
  await waitFor(() => expect(view.props[problem.callback]).toHaveBeenCalledOnce());
});
it("조회500은 추적 ID/재시도를 보이고 캘린더로 돌아갈 수 있다", async () => {
  getProblem = { code: "internal", status: 500 };
  const view = area();
  await main().findByText(`추적 ID: ${traceId}`);
  fireEvent.click(screen.getByRole("link", { name: "뒤로" }));
  expect(view.props.onNavigate).toHaveBeenCalledWith("/owner/calendar");
  getProblem = null;
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await loaded();
});
it.each(["closed_day_with_orders", "capacity_below_held"] as const)(
  "%s 확인은 주문/픽업을 보이고 새 키로 저장한다",
  async (kind) => {
    confirmation = kind;
    area();
    await loaded();
    fireEvent.change(screen.getByLabelText("하루 최대 개수"), { target: { value: "4" } });
    fireEvent.submit(form());
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("K7Q3M9")).toBeTruthy();
    expect(dialog.textContent).toContain("주문 확정");
    expect(current.dailyCapacity).toBe(5);
    fireEvent.click(
      within(dialog).getByRole("button", { name: kind === "closed_day_with_orders" ? "휴무로 바꾸기" : "개수 줄이기" }),
    );
    await main().findByText("저장했어요");
    expect(writes[1]?.body).toEqual({ ...writes[0]?.body, confirm: [kind] });
    expect(writes[1]?.key).not.toBe(writes[0]?.key);
  },
);
it("저장 후 새 기준을 넘는 날짜/주문은10일씩 더 본다", async () => {
  conflicts = conflictDays(11);
  area();
  await loaded();
  fireEvent.change(screen.getByLabelText("하루 최대 개수"), { target: { value: "4" } });
  fireEvent.submit(form());
  await main().findByText("저장했어요. 새 기준을 넘는 날이 있어요");
  expect(main().queryByText("SYN010")).toBeNull();
  fireEvent.click(main().getByRole("button", { name: "더 보기" }));
  expect(main().getByText("SYN010")).toBeTruthy();
  expect(main().getByRole("heading", { name: "2026년 12월 11일 관련 주문" })).toBeTruthy();
});
it("확인에서 돌아가면 서버와 주문은 그대로 두고 초안을 남긴다", async () => {
  confirmation = "capacity_below_held";
  area();
  await loaded();
  fireEvent.change(screen.getByLabelText("하루 최대 개수"), { target: { value: "4" } });
  fireEvent.submit(form());
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "돌아가기" }));
  expect(writes).toHaveLength(1);
  expect(current.dailyCapacity).toBe(5);
  expect((screen.getByLabelText("하루 최대 개수") as HTMLInputElement).value).toBe("4");
});
it("서버500 재시도는 같은 본문과 요청 키를 쓴다", async () => {
  area();
  await loaded();
  fireEvent.change(screen.getByLabelText("하루 최대 개수"), { target: { value: "4" } });
  saveProblem = { code: "internal", status: 500 };
  fireEvent.submit(form());
  await main().findByText(`추적 ID: ${traceId}`);
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await main().findByText("저장했어요");
  expect(writes[1]).toEqual(writes[0]);
});
it("다른 기기의 필드는 남기고 내 변경만 최신 revision으로 다시 저장한다", async () => {
  area();
  await loaded();
  fireEvent.change(screen.getByLabelText("후기 부탁 시각"), { target: { value: "12:00" } });
  current = { ...current, dailyCapacity: 8, replyStart: "10:00", revision: "synthetic-latest" };
  saveProblem = { code: "version_conflict", status: 409 };
  fireEvent.submit(form());
  await main().findByText("지금 하루 최대 개수: 8");
  expect(main().getByText("지금 쉬는 요일: 월요일")).toBeTruthy();
  expect(main().getByText("지금 주문 마감: 픽업일 2일 전 18:00")).toBeTruthy();
  expect(main().getByText("지금 전날 안내 시각: 18:00")).toBeTruthy();
  expect(main().getByText("지금 후기 부탁 시각: 11:00")).toBeTruthy();
  expect((screen.getByLabelText("후기 부탁 시각") as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "내 변경 다시 적용" }));
  expect((screen.getByLabelText("하루 최대 개수") as HTMLInputElement).value).toBe("8");
  expect((screen.getByLabelText("답하는 시간 시작") as HTMLInputElement).value).toBe("10:00");
  fireEvent.submit(form());
  await main().findByText("저장했어요");
  expect(writes[1]?.body).toMatchObject({
    baseRevision: "synthetic-latest",
    dailyCapacity: 8,
    replyStart: "10:00",
    reviewRequestTime: "12:00",
  });
  expect(writes[1]?.key).not.toBe(writes[0]?.key);
});
it("충돌 조회가 실패해도 다시 읽고 초안을 재적용한다", async () => {
  area();
  await loaded();
  fireEvent.change(screen.getByLabelText("하루 최대 개수"), { target: { value: "4" } });
  current = { ...current, revision: "synthetic-latest" };
  saveProblem = { code: "version_conflict", status: 409 };
  getProblem = { code: "internal", status: 500 };
  fireEvent.submit(form());
  const retry = await screen.findByRole("button", { name: "지금 상태 다시 읽기" });
  expect((retry as HTMLButtonElement).disabled).toBe(false);
  getProblem = null;
  fireEvent.click(retry);
  fireEvent.click(await screen.findByRole("button", { name: "내 변경 다시 적용" }));
  expect((screen.getByLabelText("하루 최대 개수") as HTMLInputElement).value).toBe("4");
});
it("처리 중은1초 뒤 같은 본문/키로 다시 보내고 연속 제출은 막는다", async () => {
  area();
  await loaded();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fireEvent.change(screen.getByLabelText("하루 최대 개수"), { target: { value: "4" } });
  saveProblem = { code: "request_in_progress", status: 409 };
  fireEvent.submit(form());
  fireEvent.submit(form());
  await act(async () => {});
  expect(writes).toHaveLength(1);
  expect((screen.getByRole("button", { name: "일요일" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(writes[1]).toEqual(writes[0]);
  expect(main().getAllByText("저장했어요")).toHaveLength(1);
});
it("키 재사용 오류는 본문을 유지하고 새 요청 키로 보낸다", async () => {
  area();
  await loaded();
  fireEvent.change(screen.getByLabelText("하루 최대 개수"), { target: { value: "4" } });
  saveProblem = { code: "idempotency_key_reused", status: 422 };
  fireEvent.submit(form());
  await main().findByText(ERROR_CODES.idempotency_key_reused.message);
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await main().findByText("저장했어요");
  expect(writes[1]?.body).toEqual(writes[0]?.body);
  expect(writes[1]?.key).not.toBe(writes[0]?.key);
});
it("실제 OwnerArea의 bfcache 재확인 뒤 한 번 읽고 설정 초안을 보존한다", async () => {
  const transport = fetch;
  let identities = 0,
    finish: ((value: Response) => void) | undefined;
  const identity = {
    owner: {
      ownerId: "d3898f13-62a2-4e3e-bd60-9797a6dfc506",
      alertChannelFriend: false,
      createdAt: "2026-11-15T00:00:00Z",
    },
    shop: { shopId: "1dc0769d-8fb3-46da-af01-729ec0ea63db", name: "합성 가게", licenseStatus: "verified" },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/owner/me") {
        if (++identities === 2)
          return new Promise<Response>((resolve) => {
            finish = resolve;
          });
        return json(identity);
      }
      return transport(input, init);
    }),
  );
  render(
    <MemoryRouter initialEntries={["/owner/calendar/settings"]}>
      <Routes>
        <Route path="/owner/*" element={<OwnerArea />} />
      </Routes>
    </MemoryRouter>,
  );
  await loaded();
  fireEvent.change(screen.getByLabelText("후기 부탁 시각"), { target: { value: "12:00" } });
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  fireEvent(window, event);
  await waitFor(() => expect(identities).toBe(2));
  expect(reads).toBe(1);
  await act(async () => {
    finish?.(json(identity));
  });
  await waitFor(() => expect(reads).toBe(2));
  await waitFor(() => expect((screen.getByLabelText("후기 부탁 시각") as HTMLInputElement).disabled).toBe(false));
  expect((screen.getByLabelText("후기 부탁 시각") as HTMLInputElement).value).toBe("12:00");
});
it("신고 보류 가게는 실제 경로에서 설정을 읽기 전에 영업 신고로 간다", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      json({
        owner: {
          ownerId: "d3898f13-62a2-4e3e-bd60-9797a6dfc506",
          alertChannelFriend: false,
          createdAt: "2026-11-15T00:00:00Z",
        },
        shop: { shopId: "1dc0769d-8fb3-46da-af01-729ec0ea63db", name: "합성 가게", licenseStatus: "on_hold" },
      }),
    ),
  );
  render(
    <MemoryRouter initialEntries={["/owner/calendar/settings"]}>
      <Routes>
        <Route path="/owner/shop/license" element={<p>영업 신고 경로</p>} />
        <Route path="/owner/*" element={<OwnerArea />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByText("영업 신고 경로");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("확인 창에서 마지막 더 보기 뒤 새 날짜로 초점을 옮긴다", async () => {
  confirmation = "capacity_below_held";
  conflicts = conflictDays(11);
  area();
  await loaded();
  fireEvent.change(screen.getByLabelText("하루 최대 개수"), { target: { value: "4" } });
  fireEvent.submit(form());
  const dialog = await screen.findByRole("dialog"),
    more = within(dialog).getByRole("button", { name: "더 보기" });
  more.focus();
  fireEvent.click(more);
  const headings = within(dialog).getAllByRole("heading", { level: 3 });
  expect(headings).toHaveLength(11);
  expect(document.activeElement).toBe(headings[10]);
  expect(dialog.contains(document.activeElement)).toBe(true);
});
