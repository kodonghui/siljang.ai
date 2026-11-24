// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { OwnerTasksScreen } from "./OwnerTasksScreen";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const original = () =>
  structuredClone(api.paths["/owner/tasks"].get.responses[200].content["application/json"].examples.open_tasks.value);
const callbacks = {
  shopName: "합성 가게",
  onNavigate: vi.fn(),
  onSessionExpired: vi.fn(),
  onRegisterShop: vi.fn(),
  onLogout: vi.fn(),
};
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
let value: ReturnType<typeof original>,
  read: (init?: RequestInit) => Promise<Response>,
  signals: (AbortSignal | null | undefined)[];
beforeEach(() => {
  value = original();
  read = async () => json(value);
  signals = [];
  for (const fn of [callbacks.onNavigate, callbacks.onSessionExpired, callbacks.onRegisterShop, callbacks.onLogout])
    fn.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_path: unknown, init?: RequestInit) => {
      signals.push(init?.signal);
      return read(init);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const node of document.querySelectorAll("[data-announcer]")) node.remove();
});
function view(sessionChecking = false, sessionFailed = false) {
  return (
    <MemoryRouter>
      <OwnerTasksScreen
        {...callbacks}
        banners={["license_pending"]}
        sessionChecking={sessionChecking}
        sessionFailed={sessionFailed}
      />
    </MemoryRouter>
  );
}
it("세션을 확인하기 전에는 할 일 요청과 버튼을 열지 않는다", async () => {
  const mounted = render(view(true));
  await act(async () => {});
  expect(fetch).not.toHaveBeenCalled();
  expect((screen.getByRole("tab", { name: "열린 할 일" }) as HTMLButtonElement).disabled).toBe(true);
  mounted.rerender(view());
  await screen.findAllByText(value.items[0].summary);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("세션 재확인은 진행 중 조회를 취소하고 늦은 응답을 버린다", async () => {
  let settle: ((r: Response) => void) | undefined;
  read = () =>
    new Promise((resolve) => {
      settle = resolve;
    });
  const mounted = render(view());
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  mounted.rerender(view(true));
  expect(signals[0]?.aborted).toBe(true);
  const old = structuredClone(value);
  old.items[0].summary = "취소된 응답";
  await act(async () => settle?.(json(old)));
  expect(screen.queryByText("취소된 응답")).toBeNull();
  read = async () => json(value);
  mounted.rerender(view());
  await screen.findAllByText(value.items[0].summary);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("세션 재확인 실패는 내용을 잠그고 로그아웃은 허용한다", async () => {
  const mounted = render(view());
  await screen.findAllByText(value.items[0].summary);
  mounted.rerender(view(false, true));
  expect(document.querySelector(".owner-task-panel [inert]")).toBeTruthy();
  const logout = screen.getByRole("button", { name: "로그아웃" }) as HTMLButtonElement;
  expect(logout.disabled).toBe(false);
  fireEvent.click(logout);
  expect(callbacks.onLogout).toHaveBeenCalledOnce();
});
it("목록을 본 뒤의401도 기존 요약을 버리고 로그인 콜백을 한 번 부른다", async () => {
  render(view());
  const summary = value.items[0].summary;
  await screen.findAllByText(summary);
  read = async () => json({ code: "unauthenticated" }, 401);
  fireEvent.click(screen.getByRole("button", { name: "새로 고침" }));
  await vi.waitFor(() => expect(callbacks.onSessionExpired).toHaveBeenCalledOnce());
  expect(screen.queryByText(summary)).toBeNull();
});
it("추가 조회를 연속 눌러도 하나만 보내고 완료 안내에 초점을 둔다", async () => {
  value.nextCursor = "page2";
  render(view());
  await screen.findAllByText(value.items[0].summary);
  let settle: ((r: Response) => void) | undefined;
  read = () =>
    new Promise((resolve) => {
      settle = resolve;
    });
  const more = screen.getByRole("button", { name: "더 보기" });
  more.focus();
  fireEvent.click(more);
  fireEvent.click(more);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  value.items = [];
  value.nextCursor = null;
  await act(async () => settle?.(json(value)));
  const status = screen.getByRole("status");
  expect(status.textContent).toBe("더 불러올 할 일이 없어요");
  expect(document.activeElement).toBe(status);
});
it("추가 조회 중 사용자가 옮긴 초점은 완료 뒤에도 보존한다", async () => {
  value.nextCursor = "page2";
  const mounted = render(
    <>
      <button type="button">다른 초점</button>
      {view()}
    </>,
  );
  await screen.findAllByText(value.items[0].summary);
  let settle: ((r: Response) => void) | undefined;
  read = () =>
    new Promise((resolve) => {
      settle = resolve;
    });
  fireEvent.click(screen.getByRole("button", { name: "더 보기" }));
  const moved = screen.getByRole("button", { name: "다른 초점" });
  moved.focus();
  value.items = [];
  value.nextCursor = null;
  await act(async () => settle?.(json(value)));
  expect(document.activeElement).toBe(moved);
  mounted.unmount();
});
it("로딩 중에도 알려진 배너는 유지하고 목록 조작을 잠근다", async () => {
  read = () => new Promise(() => {});
  render(view());
  await screen.findByText("할 일을 불러오고 있어요");
  expect(screen.getByText("운영자가 영업 신고를 확인하고 있어요")).toBeTruthy();
  expect(document.querySelector(".owner-task-banners[inert]")).toBeTruthy();
  expect((screen.getByRole("button", { name: "메뉴 열기" }) as HTMLButtonElement).disabled).toBe(true);
});
it("서버의 지연 우선 순서를 화면이 연 시각으로 다시 섞지 않는다", async () => {
  value.items[0].openedAt = "2026-11-24T12:00:00+09:00";
  value.items[1].openedAt = "2026-11-01T12:00:00+09:00";
  render(view());
  await screen.findAllByText(value.items[0].summary);
  const rows = document.querySelectorAll("tbody tr");
  expect(rows[0]?.textContent).toContain(value.items[0].summary);
  expect(rows[1]?.textContent).toContain(value.items[1].summary);
});

it("잘못된 필터도 로그아웃을 막지 않고 목록 요청은 보내지 않는다", async () => {
  render(
    <MemoryRouter initialEntries={["/owner?status=bad"]}>
      <OwnerTasksScreen {...callbacks} />
    </MemoryRouter>,
  );
  await screen.findByText("입력한 내용을 확인해 주세요");
  const logout = screen.getByRole("button", { name: "로그아웃" }) as HTMLButtonElement;
  expect(logout.disabled).toBe(false);
  fireEvent.click(logout);
  expect(callbacks.onLogout).toHaveBeenCalledOnce();
  expect(fetch).not.toHaveBeenCalled();
});
