import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { fetchCalendarDays, saveCalendarDay } from "./calendar-api";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const base = "/owner/calendar/days";
const routes = [
  { path: base, method: "get" },
  { path: `${base}/{day}`, method: "patch" },
];
const cases = routes.flatMap((route) =>
  Object.entries(api.paths[route.path][route.method].responses).flatMap(([status, response]) =>
    Object.entries(
      Object.values(
        (response as { content: Record<string, { examples: Record<string, { value: unknown }> }> }).content,
      )[0]?.examples ?? {},
    ).map(([name, row]) => ({ ...route, status: status === "default" ? 500 : Number(status), name, value: row.value })),
  ),
);
const days = () => structuredClone(api.paths[base].get.responses[200].content["application/json"].examples.days.value);
afterEach(() => vi.unstubAllGlobals());
it.each(cases)("$method $status $name 응답과 요청 경계", async (row) => {
  const transport = vi.fn(async () => new Response(JSON.stringify(row.value), { status: row.status }));
  vi.stubGlobal("fetch", transport);
  const controller = new AbortController();
  const result =
    row.method === "get"
      ? await fetchCalendarDays("2026-11-19", "2026-11-23", controller.signal)
      : await saveCalendarDay(
          "2026-11-21",
          { baseRevision: "synthetic-day", manuallyClosed: true },
          "synthetic-calendar-request",
        );
  expect(result.ok).toBe(row.status === 200);
  if (!result.ok) expect(result.status).toBe(row.status);
  const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
  expect(init.credentials).toBe("same-origin");
  if (row.method === "get") {
    expect(url).toBe("/api/owner/calendar/days?from=2026-11-19&to=2026-11-23");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBe(controller.signal);
  } else {
    expect(url).toBe("/api/owner/calendar/days/2026-11-21");
    expect(init.method).toBe("PATCH");
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe("synthetic-calendar-request");
    expect(JSON.parse(String(init.body))).toEqual({ baseRevision: "synthetic-day", manuallyClosed: true });
  }
});

it.each([
  "빈 목록",
  "날짜 형식",
  "없는 날짜",
  "중복 날짜",
  "날짜 순서",
  "누락 날짜",
  "범위 밖",
  "하루 최대 개수",
  "잡힌 자리 상한",
  "남은 자리",
  "참거짓",
  "revision",
  "누락 속성",
])("잘못된 성공 목록 %s을 거절", async (kind) => {
  const value = days();
  if (kind === "빈 목록") value.items = [];
  if (kind === "날짜 형식") value.items[0].day = "2026-1-19";
  if (kind === "없는 날짜") value.items[0].day = "2026-02-30";
  if (kind === "중복 날짜") value.items[1].day = value.items[0].day;
  if (kind === "날짜 순서") value.items.reverse();
  if (kind === "누락 날짜") value.items.splice(2, 1);
  if (kind === "범위 밖") value.items[0].day = "2026-11-18";
  if (kind === "하루 최대 개수") value.items[0].capacity = 101;
  if (kind === "잡힌 자리 상한") value.items[0].held = 10001;
  if (kind === "남은 자리") value.items[0].remaining = -1;
  if (kind === "참거짓") value.items[0].closed = "false";
  if (kind === "revision") value.items[0].revision = "";
  if (kind === "누락 속성") delete value.items[0].weekdayClosed;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(value))),
  );
  const result = await fetchCalendarDays("2026-11-19", "2026-11-23");
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.status).toBe(502);
});
it("응답의 내부 필드를 복사하지 않는다", async () => {
  const value = days();
  value.ownerId = "synthetic-owner";
  value.items[0].shopId = "synthetic-shop";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(value))),
  );
  const result = await fetchCalendarDays("2026-11-19", "2026-11-23");
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.data).not.toHaveProperty("ownerId");
    expect(result.data.items[0]).not.toHaveProperty("shopId");
  }
});
it("저장 결과의 날짜가 요청과 다르면 거절한다", async () => {
  const value = { outcome: "done", day: days().items[0] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(value))),
  );
  const result = await saveCalendarDay("2026-11-21", { baseRevision: "synthetic", closed: true }, "synthetic-request");
  expect(result.ok).toBe(false);
});
it.each(["../shop", "2026-02-30", "2026-11-21/other"])("잘못된 날짜 경로 %s은 보내지 않는다", async (day) => {
  const transport = vi.fn();
  vi.stubGlobal("fetch", transport);
  const result = await saveCalendarDay(day, { baseRevision: "synthetic", closed: true }, "synthetic-request");
  expect(result.ok).toBe(false);
  expect(transport).not.toHaveBeenCalled();
});
