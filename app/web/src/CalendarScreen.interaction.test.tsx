// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CalendarScreen } from "./CalendarScreen";
import type { CalendarDay } from "./calendar-api";
import { OwnerArea } from "./OwnerArea";
import { ERROR_CODES } from "./problems";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const traceId = "0123456789abcdef0123456789abcdef";
let days: Map<string, CalendarDay>,
  reads: { signal: AbortSignal | null | undefined; url: string }[],
  sends: { day: string; body: Record<string, unknown>; key: string | null }[];
let getProblem: { code: string; status: number } | null,
  writeProblem: { code: string; status: number; errors?: { field: string; code: string }[] } | null;
let confirmKind: "closed_day_with_orders" | "capacity_below_held" | null;
function dayValue(day: string): CalendarDay {
  return {
    day,
    weekdayClosed: false,
    closed: false,
    capacityOverride: null,
    capacity: 5,
    held: day === "2026-11-21" ? 2 : 0,
    remaining: day === "2026-11-21" ? 3 : 5,
    full: false,
    manuallyClosed: false,
    overbooked: false,
    revision: `synthetic-${day}`,
  };
}
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-19T01:00:00Z"));
  days = new Map();
  reads = [];
  sends = [];
  getProblem = writeProblem = null;
  confirmKind = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "https://example.org");
      if (init?.method === "PATCH") {
        const day = url.pathname.split("/").at(-1) ?? "",
          body = JSON.parse(String(init.body));
        sends.push({ day, body, key: new Headers(init.headers).get("Idempotency-Key") });
        if (writeProblem && sends.length === 1) return json({ ...writeProblem, traceId }, writeProblem.status);
        if (confirmKind && !body.confirm?.includes(confirmKind))
          return json(
            {
              code: "confirmation_required",
              traceId,
              confirm: [{ kind: confirmKind, count: 2, day }],
              conflicts: [
                {
                  day,
                  capacity: 1,
                  held: 2,
                  orders: [
                    {
                      orderId: "11111111-1111-4111-8111-111111111111",
                      orderNo: "SYN001",
                      status: "confirmed",
                      pickupAt: "2026-11-21T14:00:00+09:00",
                    },
                  ],
                },
              ],
            },
            409,
          );
        const prior = days.get(day) ?? dayValue(day);
        const capacity = body.capacityOverride === undefined ? prior.capacity : (body.capacityOverride ?? 5);
        const next = {
          ...prior,
          ...body,
          capacity,
          remaining: Math.max(0, capacity - prior.held),
          full: prior.held >= capacity,
          revision: "synthetic-saved",
        };
        days.set(day, next);
        return json({ outcome: "done", day: next });
      }
      reads.push({ signal: init?.signal, url: String(input) });
      if (getProblem) return json({ ...getProblem, traceId }, getProblem.status);
      const from = url.searchParams.get("from") ?? "",
        to = url.searchParams.get("to") ?? "";
      const date = new Date(`${from}T00:00:00Z`),
        items: CalendarDay[] = [];
      while (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) <= to) {
        const day = date.toISOString().slice(0, 10);
        if (!days.has(day)) days.set(day, dayValue(day));
        items.push(days.get(day) as CalendarDay);
        date.setUTCDate(date.getUTCDate() + 1);
      }
      return json({ items });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const n of document.querySelectorAll("[data-announcer]")) n.remove();
});
it("처리 중 첫 요청은1초 뒤 같은 본문/키로 한 번 더 보내고 결과는 한 번 보인다", async () => {
  area();
  const form = await select();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fireEvent.click(within(form).getByLabelText("그날 주문 마감"));
  writeProblem = { code: "request_in_progress", status: 409 };
  fireEvent.submit(form);
  await act(async () => {});
  expect(sends).toHaveLength(1);
  expect((within(form).getByRole("button", { name: "처리하고 있어요" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(sends).toHaveLength(2);
  expect(sends[1]).toEqual(sends[0]);
  expect(main().getAllByText("그날 주문을 마감했어요")).toHaveLength(1);
});
it("보내는 동안 연속 제출과 날짜 이동/설정 링크를 막는다", async () => {
  const view = area();
  const form = await select();
  fireEvent.click(within(form).getByLabelText("그날 주문 마감"));
  const transport = fetch;
  let finish: ((value: Response) => void) | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        sends.push({
          day: "2026-11-21",
          body: JSON.parse(String(init.body)),
          key: new Headers(init.headers).get("Idempotency-Key"),
        });
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }
      return transport(input, init);
    }),
  );
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(sends).toHaveLength(1);
  expect((screen.getByRole("button", { name: "다음 달" }) as HTMLButtonElement).disabled).toBe(true);
  const link = screen.getByRole("link", { name: "영업 캘린더 설정" });
  expect(link.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(link);
  expect(view.props.onNavigate).not.toHaveBeenCalled();
  await act(async () => {
    finish?.(json({ outcome: "done", day: { ...dayValue("2026-11-21"), manuallyClosed: true } }));
  });
});
it("충돌 후 조회가 실패해도 지금 상태를 다시 읽고 입력을 재적용한다", async () => {
  area();
  const form = await select();
  fireEvent.click(within(form).getByLabelText("그날 주문 마감"));
  days.set("2026-11-21", { ...dayValue("2026-11-21"), revision: "synthetic-latest" });
  writeProblem = { code: "version_conflict", status: 409 };
  getProblem = { code: "internal", status: 500 };
  fireEvent.submit(form);
  await main().findByText(`추적 ID: ${traceId}`);
  const retryLatest = await main().findByRole("button", { name: "지금 상태 다시 읽기" });
  expect((retryLatest as HTMLButtonElement).disabled).toBe(false);
  getProblem = null;
  fireEvent.click(retryLatest);
  fireEvent.click(await main().findByRole("button", { name: "내 변경 다시 적용" }));
  expect((within(form).getByLabelText("그날 주문 마감") as HTMLInputElement).checked).toBe(true);
});
it("잘못 재사용한 키의 다시 시도는 같은 본문과 새 키를 쓴다", async () => {
  area();
  const form = await select();
  fireEvent.click(within(form).getByLabelText("그날 주문 마감"));
  writeProblem = { code: "idempotency_key_reused", status: 422 };
  fireEvent.submit(form);
  await main().findByText(ERROR_CODES.idempotency_key_reused.message);
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await main().findByText("그날 주문을 마감했어요");
  expect(sends[1]?.body).toEqual(sends[0]?.body);
  expect(sends[1]?.key).not.toBe(sends[0]?.key);
});
it("실제 OwnerArea는 bfcache 세션 확인 뒤 한 번 읽고 날짜 초안을 보존한다", async () => {
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
    <MemoryRouter initialEntries={["/owner/calendar"]}>
      <Routes>
        <Route path="/owner/*" element={<OwnerArea />} />
      </Routes>
    </MemoryRouter>,
  );
  const form = await select();
  fireEvent.click(within(form).getByLabelText("그날 주문 마감"));
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  fireEvent(window, event);
  await waitFor(() => expect(identities).toBe(2));
  expect(reads).toHaveLength(1);
  await act(async () => {
    finish?.(json(identity));
  });
  await waitFor(() => expect(reads).toHaveLength(2));
  await waitFor(() => expect((screen.getByLabelText("그날 주문 마감") as HTMLInputElement).disabled).toBe(false));
  expect((screen.getByLabelText("그날 주문 마감") as HTMLInputElement).checked).toBe(true);
});
function OwnerHistoryControls() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate(-1)}>
        시험 뒤로
      </button>
      <button type="button" onClick={() => navigate(1)}>
        시험 앞으로
      </button>
      <OwnerArea />
    </>
  );
}

function area(extra: { sessionChecking?: boolean; sessionFailed?: boolean } = {}, entry = "/owner/calendar") {
  const props = {
    shopName: "합성 달력 가게",
    onNavigate: vi.fn(),
    onSessionExpired: vi.fn(),
    onRegisterShop: vi.fn(),
    onLogout: vi.fn(),
    ...extra,
  };
  const wrap = (options: typeof props) => (
    <MemoryRouter initialEntries={[entry]}>
      <CalendarScreen {...options} />
    </MemoryRouter>
  );
  return { ...render(wrap(props)), props, update: (options: typeof props) => wrap(options) };
}
const main = () => within(screen.getByRole("main"));
const loaded = () => screen.findByRole("button", { name: /2026년 11월 21일/ });
async function select(day = "2026년 11월 21일") {
  const button = await screen.findByRole("button", { name: new RegExp(day) });
  fireEvent.click(button);
  return screen.getByRole("form", { name: "그날 설정" });
}
it("두 달을 조회하고 날짜별 자리/상태와 설정 경로를 보인다", async () => {
  area();
  await loaded();
  expect(reads[0]?.url).toBe("/api/owner/calendar/days?from=2026-11-01&to=2026-12-31");
  expect(screen.getByRole("button", { name: /2026년 11월 21일/ }).textContent).toContain("2/5");
  expect(screen.getByRole("link", { name: "영업 캘린더 설정" }).getAttribute("href")).toBe("/owner/calendar/settings");
});
it("그날 마감은 바뀐 필드/revision만 보내고 날짜와 결과를 갱신한다", async () => {
  area();
  const form = await select();
  fireEvent.click(within(form).getByLabelText("그날 주문 마감"));
  fireEvent.submit(form);
  await main().findByText("그날 주문을 마감했어요");
  expect(sends[0]?.body).toEqual({ baseRevision: "synthetic-2026-11-21", manuallyClosed: true });
  expect(screen.getByRole("button", { name: /2026년 11월 21일/ }).textContent).toContain("마감");
});
it("지난 날짜는 입력/저장을 잠그고 요청하지 않는다", async () => {
  area();
  const form = await select("2026년 11월 18일");
  expect(within(form).getByText("지난 날짜는 보기만 할 수 있어요")).toBeTruthy();
  expect((within(form).getByRole("button", { name: "저장" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(form);
  expect(sends).toHaveLength(0);
});
it("같은 값은 서버로 보내지 않고 이미 그렇게 되어 있다고 알린다", async () => {
  area();
  const form = await select();
  fireEvent.submit(form);
  await main().findByText("이미 그렇게 되어 있어요");
  expect(sends).toHaveLength(0);
});
it.each(["checking", "failed"])("첫 세션 %s에서는 날짜를 요청하지 않는다", async (state) => {
  const view = area(state === "checking" ? { sessionChecking: true } : { sessionFailed: true });
  await act(async () => {});
  expect(reads).toHaveLength(0);
  view.rerender(view.update({ ...view.props, sessionChecking: false, sessionFailed: false }));
  await loaded();
  expect(reads).toHaveLength(1);
});
it.each([
  { code: "unauthenticated", status: 401, callback: "onSessionExpired" },
  { code: "shop_not_registered", status: 404, callback: "onRegisterShop" },
] as const)("조회 $code는 권한 경로로 보낸다", async (p) => {
  getProblem = p;
  const view = area();
  await waitFor(() => expect(view.props[p.callback]).toHaveBeenCalledOnce());
});
it("미설정은 설정하기 경로를 보이고 실패는 추적 ID와 재시도를 제공한다", async () => {
  getProblem = { code: "not_set", status: 404 };
  area();
  await main().findByText("아직 정하지 않았어요");
  expect(screen.getByRole("link", { name: "영업 캘린더 설정하기" }).getAttribute("href")).toBe(
    "/owner/calendar/settings",
  );
});
it("조회500 뒤 재시도하고 월 이동은 새 기간을 읽는다", async () => {
  getProblem = { code: "internal", status: 500 };
  const view = area();
  await main().findByText(`추적 ID: ${traceId}`);
  getProblem = null;
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "다음 달" }));
  expect(view.props.onNavigate).toHaveBeenCalledWith("/owner/calendar?month=2026-12");
});
it("잘못된 월은 오류/처음부터 보기를 보이고 날짜 요청을 보내지 않는다", async () => {
  const view = area({}, "/owner/calendar?month=bad");
  await main().findByText(ERROR_CODES.validation_failed.message);
  expect(reads).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "처음부터 보기" }));
  expect(view.props.onNavigate).toHaveBeenCalledWith("/owner/calendar");
});
it("실제 월 query 이동/뒤로/앞으로도 화면과 겹치는 날짜 초안을 보존한다", async () => {
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
    <MemoryRouter initialEntries={["/owner/calendar"]}>
      <OwnerHistoryControls />
    </MemoryRouter>,
  );
  const panel = await select("2026년 12월 21일");
  fireEvent.click(within(panel).getByLabelText("그날 주문 마감"));
  fireEvent.click(screen.getByRole("button", { name: "다음 달" }));
  await waitFor(() => expect(identities).toBe(2));
  expect(screen.getByRole("heading", { name: "영업 캘린더", level: 1 })).toBeTruthy();
  expect(reads).toHaveLength(1);
  await act(async () => {
    finish?.(json(identity));
  });
  await waitFor(() => expect(reads.at(-1)?.url).toContain("from=2026-12-01"));
  await waitFor(() => expect((screen.getByLabelText("그날 주문 마감") as HTMLInputElement).checked).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "시험 뒤로" }));
  await waitFor(() => expect(reads.at(-1)?.url).toContain("from=2026-11-01"));
  await waitFor(() => expect((screen.getByLabelText("그날 주문 마감") as HTMLInputElement).checked).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "시험 앞으로" }));
  await waitFor(() => expect(reads.at(-1)?.url).toContain("from=2026-12-01"));
  await waitFor(() => expect((screen.getByLabelText("그날 주문 마감") as HTMLInputElement).checked).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "다음 달" }));
  await waitFor(() => expect(reads.at(-1)?.url).toContain("from=2027-01-01"));
  const returnDay = await screen.findByRole("button", { name: "선택한 날짜로 돌아가기" });
  expect((screen.getByLabelText("그날 주문 마감") as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(returnDay);
  await waitFor(() => expect(reads.at(-1)?.url).toContain("from=2026-12-01"));
  await waitFor(() => expect((screen.getByLabelText("그날 주문 마감") as HTMLInputElement).disabled).toBe(false));
  expect((screen.getByLabelText("그날 주문 마감") as HTMLInputElement).checked).toBe(true);
});
it.each([false, true])("같은 revision의 새로 고침은 초안 %s를 보존하고 충돌을 만들지 않는다", async (dirty) => {
  area();
  const panel = await select();
  if (dirty) fireEvent.click(within(panel).getByLabelText("그날 주문 마감"));
  fireEvent.click(screen.getByRole("button", { name: "새로 고침" }));
  await waitFor(() => expect(reads).toHaveLength(2));
  await act(async () => {});
  expect(main().queryByRole("region", { name: "지금 날짜 설정" })).toBeNull();
  expect(main().queryByText("그 사이 바뀌었어요. 지금 상태를 확인해 주세요")).toBeNull();
  expect((within(panel).getByLabelText("그날 주문 마감") as HTMLInputElement).disabled).toBe(false);
  expect((within(panel).getByLabelText("그날 주문 마감") as HTMLInputElement).checked).toBe(dirty);
});
it("초안이 없으면 바뀐 revision도 조용히 새 날짜 값으로 바꾼다", async () => {
  area();
  const panel = await select();
  days.set("2026-11-21", { ...dayValue("2026-11-21"), closed: true, revision: "synthetic-latest" });
  fireEvent.click(screen.getByRole("button", { name: "새로 고침" }));
  await waitFor(() => expect((within(panel).getByLabelText("그날 휴무") as HTMLInputElement).checked).toBe(true));
  expect(main().queryByText("그 사이 바뀌었어요. 지금 상태를 확인해 주세요")).toBeNull();
});
it("충돌 패널은 지금 휴무/마감/잡힌 자리/남은 자리까지 보여 준다", async () => {
  area();
  const panel = await select();
  fireEvent.change(within(panel).getByLabelText("그날 하루 최대 개수"), { target: { value: "3" } });
  days.set("2026-11-21", {
    ...dayValue("2026-11-21"),
    closed: true,
    manuallyClosed: true,
    held: 4,
    remaining: 1,
    revision: "synthetic-latest",
  });
  writeProblem = { code: "version_conflict", status: 409 };
  fireEvent.submit(panel);
  await main().findByText("지금 휴무: 휴무");
  expect(main().getByText("지금 주문 마감: 마감")).toBeTruthy();
  expect(main().getByText("지금 잡힌 자리: 4 · 남은 자리: 1")).toBeTruthy();
});
it("휴무를 켜면서 주문 마감을 풀면 다시 받는다고 알리지 않는다", async () => {
  days.set("2026-11-21", { ...dayValue("2026-11-21"), manuallyClosed: true });
  area();
  const panel = await select();
  fireEvent.click(within(panel).getByLabelText("그날 휴무"));
  fireEvent.click(within(panel).getByLabelText("그날 주문 마감"));
  fireEvent.submit(panel);
  await main().findByText("저장했어요");
  expect(main().queryByText("다시 받아요")).toBeNull();
});
it.each(["closed_day_with_orders", "capacity_below_held"] as const)(
  "%s 확인은 본문을 유지하고 새 키로 저장한다",
  async (kind) => {
    confirmKind = kind;
    area();
    const form = await select();
    if (kind === "closed_day_with_orders") fireEvent.click(within(form).getByLabelText("그날 휴무"));
    else fireEvent.change(within(form).getByLabelText("그날 하루 최대 개수"), { target: { value: "1" } });
    fireEvent.submit(form);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("2");
    expect(within(dialog).getByText("SYN001")).toBeTruthy();
    expect(dialog.textContent).toContain("주문 확정");
    expect(days.get("2026-11-21")?.revision).toBe("synthetic-2026-11-21");
    fireEvent.click(
      within(dialog).getByRole("button", { name: kind === "closed_day_with_orders" ? "휴무로 바꾸기" : "개수 줄이기" }),
    );
    await main().findByText("저장했어요");
    expect(sends[1]?.body).toEqual({ ...sends[0]?.body, confirm: [kind] });
    expect(sends[1]?.key).not.toBe(sends[0]?.key);
    expect(days.get("2026-11-21")?.held).toBe(2);
  },
);
it("확인에서 돌아가면 서버 값은 유지하고 입력을 보존한다", async () => {
  confirmKind = "capacity_below_held";
  area();
  const form = await select();
  fireEvent.change(within(form).getByLabelText("그날 하루 최대 개수"), { target: { value: "1" } });
  fireEvent.submit(form);
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "돌아가기" }));
  expect(sends).toHaveLength(1);
  expect(days.get("2026-11-21")?.capacity).toBe(5);
  expect((within(form).getByLabelText("그날 하루 최대 개수") as HTMLInputElement).value).toBe("1");
});
it("409 뒤 바뀐 필드만 최신 설정에 다시 적용하고 새 키/revision을 쓴다", async () => {
  area();
  const form = await select();
  fireEvent.click(within(form).getByLabelText("그날 주문 마감"));
  days.set("2026-11-21", {
    ...dayValue("2026-11-21"),
    capacityOverride: 8,
    capacity: 8,
    remaining: 6,
    revision: "synthetic-latest",
  });
  writeProblem = { code: "version_conflict", status: 409 };
  fireEvent.submit(form);
  await main().findByText("지금 하루 최대 개수: 8");
  expect((within(form).getByRole("button", { name: "저장" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "내 변경 다시 적용" }));
  expect((within(form).getByLabelText("그날 하루 최대 개수") as HTMLInputElement).value).toBe("8");
  fireEvent.submit(form);
  await main().findByText("그날 주문을 마감했어요");
  expect(sends[1]?.body).toEqual({ baseRevision: "synthetic-latest", manuallyClosed: true });
  expect(sends[1]?.key).not.toBe(sends[0]?.key);
});
it("서버500의 다시 시도는 같은 본문과 요청 키를 쓴다", async () => {
  area();
  const form = await select();
  fireEvent.click(within(form).getByLabelText("그날 주문 마감"));
  writeProblem = { code: "internal", status: 500 };
  fireEvent.submit(form);
  await main().findByText(`추적 ID: ${traceId}`);
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await main().findByText("그날 주문을 마감했어요");
  expect(sends[1]).toEqual(sends[0]);
});
it.each(["101", "-1", "1.5", "Infinity", "1e2"])("잘못된 개수 %s는 원문을 보존하고 보내지 않는다", async (value) => {
  area();
  const form = await select();
  const input = within(form).getByLabelText("그날 하루 최대 개수") as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(form);
  expect(input.value).toBe(value);
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(sends).toHaveLength(0);
});
