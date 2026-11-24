// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { OwnerArea } from "./OwnerArea";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const originalMe = () =>
  structuredClone(api.paths["/owner/me"].get.responses[200].content["application/json"].examples.mvp.value);
const originalTasks = () =>
  structuredClone(api.paths["/owner/tasks"].get.responses[200].content["application/json"].examples.open_tasks.value);
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
let profile: ReturnType<typeof originalMe>,
  tasks: ReturnType<typeof originalTasks>,
  me: () => Promise<Response>,
  calls: string[];
beforeEach(() => {
  profile = originalMe();
  tasks = originalTasks();
  calls = [];
  me = async () => json(profile);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const p = String(input);
      calls.push(p);
      if (p === "/api/owner/me") return me();
      if (p.startsWith("/api/owner/tasks?")) return json(tasks);
      return json({ code: "internal" }, 500);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const n of document.querySelectorAll("[data-announcer]")) n.remove();
});
function mount() {
  return render(
    <MemoryRouter initialEntries={["/owner"]}>
      <Routes>
        <Route path="/owner/login" element={<h1>합성 로그인 목적지</h1>} />
        <Route path="/owner/*" element={<OwnerArea />} />
      </Routes>
    </MemoryRouter>,
  );
}
function restore() {
  const e = new Event("pageshow");
  Object.defineProperty(e, "persisted", { value: true });
  fireEvent(window, e);
}
it("홈 신원 재확인 중에는 이전 가게 이름·주문번호·요약을 숨긴다", async () => {
  mount();
  const summary = tasks.items[0].summary,
    name = profile.shop.name;
  await screen.findAllByText(summary);
  me = () => new Promise(() => {});
  restore();
  await vi.waitFor(() => expect(calls.filter((x) => x === "/api/owner/me")).toHaveLength(2));
  expect(screen.queryAllByText(name)).toHaveLength(0);
  expect(screen.queryByText(summary)).toBeNull();
  expect(screen.queryByText(tasks.items[0].order.orderNo)).toBeNull();
});
it("홈 신원 재확인이 실패해도 이전 가게 데이터를 보이지 않는다", async () => {
  mount();
  const summary = tasks.items[0].summary,
    name = profile.shop.name;
  await screen.findAllByText(summary);
  me = async () => json({ code: "internal", traceId: "0123456789abcdef0123456789abcdef" }, 500);
  restore();
  await screen.findByText("추적 ID: 0123456789abcdef0123456789abcdef");
  expect(screen.queryAllByText(name)).toHaveLength(0);
  expect(screen.queryByText(summary)).toBeNull();
  expect((screen.getByRole("button", { name: "로그아웃" }) as HTMLButtonElement).disabled).toBe(false);
});
it("탭 복귀는 신원을 먼저 확인하고 계정이 바뀌면 새 가게 데이터만 읽는다", async () => {
  mount();
  const oldName = profile.shop.name,
    oldSummary = tasks.items[0].summary;
  await screen.findAllByText(oldSummary);
  let settle: ((r: Response) => void) | undefined;
  me = () =>
    new Promise((resolve) => {
      settle = resolve;
    });
  tasks.items = [{ ...tasks.items[0], taskId: "00000000-0000-4000-8000-000000009903", summary: "새 가게 할 일" }];
  fireEvent(document, new Event("visibilitychange"));
  await vi.waitFor(() => expect(calls.filter((x) => x === "/api/owner/me")).toHaveLength(2));
  expect(calls.filter((x) => x.startsWith("/api/owner/tasks?"))).toHaveLength(1);
  expect(screen.queryAllByText(oldName)).toHaveLength(0);
  profile.owner.ownerId = "00000000-0000-4000-8000-000000009901";
  profile.shop.shopId = "00000000-0000-4000-8000-000000009902";
  profile.shop.name = "새 합성 가게";
  await act(async () => settle?.(json(profile)));
  await screen.findAllByText("새 가게 할 일");
  expect(screen.getAllByText("새 합성 가게").length).toBeGreaterThan(0);
  expect(screen.queryAllByText(oldName)).toHaveLength(0);
  expect(screen.queryByText(oldSummary)).toBeNull();
  expect(calls.filter((x) => x.startsWith("/api/owner/tasks?"))).toHaveLength(2);
});
