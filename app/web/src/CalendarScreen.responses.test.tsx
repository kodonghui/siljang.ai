// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { CalendarScreen } from "./CalendarScreen";
import { ERROR_CODES, type ErrorCode } from "./problems";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const path = "/owner/calendar/days";
const rows = [
  { path, method: "get" },
  { path: `${path}/{day}`, method: "patch" },
].flatMap((route) =>
  Object.entries(api.paths[route.path][route.method].responses).flatMap(([status, response]) =>
    Object.entries(
      Object.values(
        (response as { content: Record<string, { examples: Record<string, { value: unknown }> }> }).content,
      )[0]?.examples ?? {},
    ).map(([name, row]) => ({
      ...route,
      status: status === "default" ? 500 : Number(status),
      name,
      value: row.value as { code?: ErrorCode; outcome?: string; items?: { day: string }[] },
    })),
  ),
);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function completeDays(url: string) {
  const query = new URL(url, "https://example.org").searchParams;
  const day = new Date(`${query.get("from")}T00:00:00Z`),
    to = query.get("to") ?? "";
  const examples = api.paths[path].get.responses[200].content["application/json"].examples.days.value.items;
  const items = [];
  while (day.toISOString().slice(0, 10) <= to) {
    const date = day.toISOString().slice(0, 10);
    items.push(
      examples.find((item: { day: string }) => item.day === date) ?? {
        day: date,
        weekdayClosed: false,
        closed: false,
        capacityOverride: null,
        capacity: 5,
        held: 0,
        remaining: 5,
        full: false,
        manuallyClosed: false,
        overbooked: false,
        revision: "synthetic-matrix",
      },
    );
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return { items };
}
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-19T01:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const node of document.querySelectorAll("[data-announcer]")) node.remove();
});
it.each(rows)("API 화면 응답: $method $status $name", async (row) => {
  const props = {
    shopName: "합성 응답 가게",
    onNavigate: vi.fn(),
    onSessionExpired: vi.fn(),
    onRegisterShop: vi.fn(),
    onLogout: vi.fn(),
  };
  let wrote = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        wrote = true;
        return json(row.value, row.status);
      }
      return row.method === "get" && row.status !== 200
        ? json(row.value, row.status)
        : json({
            items: completeDays(String(input)).items.map((item) =>
              wrote && row.value.code === "version_conflict" ? { ...item, revision: "synthetic-latest" } : item,
            ),
          });
    }),
  );
  render(
    <MemoryRouter>
      <CalendarScreen {...props} />
    </MemoryRouter>,
  );
  if (row.method === "patch") {
    fireEvent.click(await screen.findByRole("button", { name: /2026년 11월 21일/ }));
    fireEvent.click(screen.getByLabelText("그날 주문 마감"));
    fireEvent.submit(screen.getByRole("form", { name: "그날 설정" }));
  }
  if (row.status === 200) {
    if (row.method === "get") expect(await screen.findByRole("button", { name: /2026년 11월 21일/ })).toBeTruthy();
    else
      expect(
        (
          await screen.findAllByText(
            row.value.outcome === "unchanged" ? "이미 그렇게 되어 있어요" : "그날 주문을 마감했어요",
          )
        ).length,
      ).toBeGreaterThan(0);
  } else if (row.value.code === "unauthenticated")
    await waitFor(() => expect(props.onSessionExpired).toHaveBeenCalledOnce());
  else if (row.value.code === "shop_not_registered")
    await waitFor(() => expect(props.onRegisterShop).toHaveBeenCalledOnce());
  else if (row.value.code === "not_set") {
    expect(await screen.findByRole("link", { name: "영업 캘린더 설정하기" })).toBeTruthy();
    expect(screen.queryByRole("form", { name: "그날 설정" })).toBeNull();
  } else if (row.value.code === "confirmation_required") expect(await screen.findByRole("dialog")).toBeTruthy();
  else if (row.value.code === "request_in_progress")
    expect(await screen.findByRole("button", { name: "처리하고 있어요" })).toBeTruthy();
  else
    expect((await screen.findAllByText(ERROR_CODES[row.value.code ?? "internal"].message)).length).toBeGreaterThan(0);
});
