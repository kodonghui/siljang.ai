import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { fetchCalendarSettings, saveCalendarSettings } from "./calendar-settings-api";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const path = "/owner/calendar";
const example = () =>
  structuredClone(api.paths[path].get.responses[200].content["application/json"].examples.settings.value);
const result = () =>
  structuredClone(api.paths[path].put.responses[200].content["application/json"].examples.updated_with_conflicts.value);
const rows = ["get", "put"].flatMap((method) =>
  Object.entries(api.paths[path][method].responses).flatMap(([status, response]) =>
    Object.entries(
      Object.values(
        (response as { content: Record<string, { examples: Record<string, { value: unknown }> }> }).content,
      )[0]?.examples ?? {},
    ).map(([name, row]) => ({ method, status: status === "default" ? 500 : Number(status), name, value: row.value })),
  ),
);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
afterEach(() => vi.unstubAllGlobals());
it.each(rows)("$method $status $name 응답과 요청 경계", async (row) => {
  const transport = vi.fn(async () => json(row.value, row.status));
  vi.stubGlobal("fetch", transport);
  const signal = new AbortController().signal;
  const body = { baseRevision: "synthetic-calendar", dailyCapacity: 5 };
  const response =
    row.method === "get" ? await fetchCalendarSettings(signal) : await saveCalendarSettings(body, "synthetic-request");
  expect(response.ok).toBe(row.status === 200);
  if (!response.ok) expect(response.status).toBe(row.status);
  const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/owner/calendar");
  expect(init.credentials).toBe("same-origin");
  if (row.method === "get") {
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBe(signal);
  } else {
    expect(init.method).toBe("PUT");
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe("synthetic-request");
    expect(JSON.parse(String(init.body))).toEqual(body);
  }
});
it.each([
  { closedWeekdays: [0] },
  { closedWeekdays: [8] },
  { closedWeekdays: [1, 1] },
  { closedWeekdays: null },
  { dailyCapacity: -1 },
  { dailyCapacity: 101 },
  { dailyCapacity: 1.5 },
  { orderCutoffDays: 31 },
  { orderCutoffTime: "24:00" },
  { replyStart: "9:00" },
  { replyEnd: "08:00" },
  { dayBeforeNoticeTime: "07:59" },
  { dayBeforeNoticeTime: "20:51" },
  { reviewRequestTime: "21:00" },
  { updatedAt: "invalid" },
  { revision: "bad/value" },
  { reviewRequestTime: undefined },
])("계약 밖 설정은 폼에 넣지 않는다 %#", async (patch) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ ...example(), ...patch })),
  );
  expect(await fetchCalendarSettings()).toMatchObject({ ok: false, status: 502 });
});
it("내부 값은 읽기/저장 DTO에 복사하지 않는다", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: unknown, init?: RequestInit) =>
      json(
        init?.method === "PUT"
          ? { ...result(), internal: "비공개", calendar: { ...result().calendar, internal: "비공개" } }
          : { ...example(), internal: "비공개" },
      ),
    ),
  );
  const read = await fetchCalendarSettings(),
    saved = await saveCalendarSettings({}, "synthetic-request");
  expect(read.ok && read.data).toEqual(example());
  expect(saved.ok && saved.data).toEqual(result());
});
it.each(["outcome", "outcome_array", "calendar", "conflicts", "orders"])(
  "저장 결과의 잘못된 %s은 성공으로 보지 않는다",
  async (key) => {
    const value = result();
    if (key === "outcome") value.outcome = "internal";
    else if (key === "outcome_array") value.outcome = ["created"];
    else if (key === "calendar") value.calendar.dailyCapacity = 101;
    else if (key === "conflicts") delete value.conflicts;
    else value.conflicts[0].orders = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(value)),
    );
    expect(await saveCalendarSettings({}, "synthetic-request")).toMatchObject({ ok: false, status: 502 });
  },
);
