// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { CalendarSettingsScreen } from "./CalendarSettingsScreen";
import { ERROR_CODES, type ErrorCode } from "./problems";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const path = "/owner/calendar";
const example = api.paths[path].get.responses[200].content["application/json"].examples.settings.value;
const rows = ["get", "put"].flatMap((method) =>
  Object.entries(api.paths[path][method].responses).flatMap(([status, response]) =>
    Object.entries(
      Object.values(
        (response as { content: Record<string, { examples: Record<string, { value: unknown }> }> }).content,
      )[0]?.examples ?? {},
    ).map(([name, row]) => ({
      method,
      status: status === "default" ? 500 : Number(status),
      name,
      value: row.value as { code?: ErrorCode; outcome?: string; conflicts?: unknown[] },
    })),
  ),
);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const node of document.querySelectorAll("[data-announcer]")) node.remove();
});
it.each(rows)("API 화면 응답: $method $status $name", async (row) => {
  const props = {
    shopName: "합성 설정 가게",
    onNavigate: vi.fn(),
    onSessionExpired: vi.fn(),
    onRegisterShop: vi.fn(),
    onLogout: vi.fn(),
  };
  let wrote = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        wrote = true;
        return json(row.value, row.status);
      }
      return row.method === "get"
        ? json(row.value, row.status)
        : json(wrote && row.value.code === "version_conflict" ? { ...example, revision: "synthetic-latest" } : example);
    }),
  );
  render(
    <MemoryRouter>
      <CalendarSettingsScreen {...props} />
    </MemoryRouter>,
  );
  if (row.method === "put") {
    fireEvent.change(await screen.findByLabelText("하루 최대 개수"), { target: { value: "4" } });
    fireEvent.submit(screen.getByRole("form", { name: "영업 캘린더 설정" }));
  }
  if (row.status === 200) {
    if (row.method === "get")
      expect(((await screen.findByLabelText("하루 최대 개수")) as HTMLInputElement).value).toBe("5");
    else
      expect(
        await within(screen.getByRole("main")).findByText(
          row.value.outcome === "unchanged"
            ? "바뀐 것이 없어요"
            : row.value.conflicts?.length
              ? "저장했어요. 새 기준을 넘는 날이 있어요"
              : "저장했어요",
        ),
      ).toBeTruthy();
  } else if (row.value.code === "unauthenticated")
    await waitFor(() => expect(props.onSessionExpired).toHaveBeenCalledOnce());
  else if (row.value.code === "shop_not_registered")
    await waitFor(() => expect(props.onRegisterShop).toHaveBeenCalledOnce());
  else if (row.value.code === "not_set")
    expect(
      await within(screen.getByRole("main")).findByText("처음 정해요. 기본값을 확인하고 저장해 주세요"),
    ).toBeTruthy();
  else if (row.value.code === "confirmation_required") expect(await screen.findByRole("dialog")).toBeTruthy();
  else if (row.value.code === "request_in_progress")
    expect(await screen.findByRole("button", { name: "처리하고 있어요" })).toBeTruthy();
  else
    expect((await screen.findAllByText(ERROR_CODES[row.value.code ?? "internal"].message)).length).toBeGreaterThan(0);
});
