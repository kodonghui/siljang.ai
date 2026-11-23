// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CalendarScreen } from "./CalendarScreen";
import type { CalendarDay } from "./calendar-api";
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
          return json({ code: "confirmation_required", traceId, confirm: [{ kind: confirmKind, count: 2, day }] }, 409);
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const n of document.querySelectorAll("[data-announcer]")) n.remove();
});
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
  area();
  await main().findByText(`추적 ID: ${traceId}`);
  getProblem = null;
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "다음 달" }));
  await waitFor(() => expect(reads.at(-1)?.url).toBe("/api/owner/calendar/days?from=2026-12-01&to=2027-01-31"));
});
it("잘못된 월은 오류/처음부터 보기를 보이고 날짜 요청을 보내지 않는다", async () => {
  const view = area({}, "/owner/calendar?month=bad");
  await main().findByText(ERROR_CODES.validation_failed.message);
  expect(reads).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "처음부터 보기" }));
  expect(view.props.onNavigate).toHaveBeenCalledWith("/owner/calendar");
});
