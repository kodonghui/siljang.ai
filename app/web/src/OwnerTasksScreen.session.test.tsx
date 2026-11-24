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
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
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
function mount(entry = "/owner", outsideFocus = false) {
  return render(
    <>
      {outsideFocus ? <button type="button">다른 초점</button> : null}
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/owner/login" element={<h1>합성 로그인 목적지</h1>} />
          <Route path="/owner/*" element={<OwnerArea />} />
        </Routes>
      </MemoryRouter>
    </>,
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

const tabName = (status: "open" | "closed") => (status === "open" ? "열린 할 일" : "처리한 일");
async function readyTab(status: "open" | "closed") {
  const tab = (await screen.findByRole("tab", { name: tabName(status) })) as HTMLButtonElement;
  await vi.waitFor(() => expect(tab.disabled).toBe(false));
  return tab;
}

it.each([
  { initial: "open", key: "ArrowRight", target: "closed" },
  { initial: "closed", key: "ArrowLeft", target: "open" },
  { initial: "closed", key: "Home", target: "open" },
  { initial: "open", key: "End", target: "closed" },
] as const)("실제 홈의 $key 탭 이동은 신원 재확인 뒤 새 $target 탭에 초점을 돌린다", async (row) => {
  tasks.items = [];
  mount(row.initial === "open" ? "/owner" : "/owner?status=closed");
  const initial = await readyTab(row.initial);
  initial.focus();
  let settle: ((r: Response) => void) | undefined;
  me = () =>
    new Promise((resolve) => {
      settle = resolve;
    });
  fireEvent.keyDown(initial, { key: row.key });
  await vi.waitFor(() => expect(calls.filter((x) => x === "/api/owner/me")).toHaveLength(2));
  expect(screen.queryAllByText(profile.shop.name)).toHaveLength(0);
  expect(screen.queryByRole("tab")).toBeNull();
  await act(async () => settle?.(json(profile)));
  const selected = await readyTab(row.target);
  expect(selected).not.toBe(initial);
  expect(selected.getAttribute("aria-selected")).toBe("true");
  await vi.waitFor(() => expect(document.activeElement).toBe(selected));
  if (row.key === "ArrowRight") {
    me = async () => json(profile);
    fireEvent.keyDown(selected, { key: "ArrowLeft" });
    await vi.waitFor(() => expect(calls.filter((x) => x === "/api/owner/me")).toHaveLength(3));
    const again = await readyTab("open");
    await vi.waitFor(() => expect(document.activeElement).toBe(again));
  }
});

it("직접 연 처리한 일 주소에는 새 초점 요청을 만들지 않는다", async () => {
  tasks.items = [];
  mount("/owner?status=closed");
  const tab = await readyTab("closed");
  expect(document.activeElement).not.toBe(tab);
});

it("탭 신원 재확인 중 사용자가 옮긴 초점은 가로채지 않는다", async () => {
  tasks.items = [];
  mount("/owner", true);
  const initial = await readyTab("open");
  initial.focus();
  let settle: ((r: Response) => void) | undefined;
  me = () =>
    new Promise((resolve) => {
      settle = resolve;
    });
  fireEvent.keyDown(initial, { key: "ArrowRight" });
  await vi.waitFor(() => expect(calls.filter((x) => x === "/api/owner/me")).toHaveLength(2));
  const other = screen.getByRole("button", { name: "다른 초점" });
  other.focus();
  await act(async () => settle?.(json(profile)));
  await readyTab("closed");
  expect(document.activeElement).toBe(other);
});

it("탭 신원 재확인에서 계정이 바뀌면 이전 탭 초점 요청을 버린다", async () => {
  tasks.items = [];
  mount();
  const initial = await readyTab("open");
  initial.focus();
  let settle: ((r: Response) => void) | undefined;
  me = () =>
    new Promise((resolve) => {
      settle = resolve;
    });
  fireEvent.keyDown(initial, { key: "ArrowRight" });
  await vi.waitFor(() => expect(calls.filter((x) => x === "/api/owner/me")).toHaveLength(2));
  profile.owner.ownerId = "00000000-0000-4000-8000-000000009911";
  profile.shop.shopId = "00000000-0000-4000-8000-000000009912";
  profile.shop.name = "바뀐 합성 가게";
  await act(async () => settle?.(json(profile)));
  const selected = await readyTab("closed");
  expect(document.activeElement).not.toBe(selected);
  expect(screen.getAllByText("바뀐 합성 가게").length).toBeGreaterThan(0);
});

it("탭 신원 재확인 중 문서가 초점을 잃으면 탭으로 가로채지 않는다", async () => {
  tasks.items = [];
  mount();
  const initial = await readyTab("open");
  initial.focus();
  let settle: ((r: Response) => void) | undefined;
  me = () =>
    new Promise((resolve) => {
      settle = resolve;
    });
  fireEvent.keyDown(initial, { key: "ArrowRight" });
  await vi.waitFor(() => expect(calls.filter((x) => x === "/api/owner/me")).toHaveLength(2));
  vi.mocked(document.hasFocus).mockReturnValue(false);
  await act(async () => settle?.(json(profile)));
  const selected = await readyTab("closed");
  expect(document.activeElement).not.toBe(selected);
});
