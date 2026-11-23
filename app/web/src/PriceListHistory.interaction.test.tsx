// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { OwnerArea } from "./OwnerArea";
import { PriceListHistory } from "./PriceListHistory";

const contract = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const fixture = () =>
  structuredClone(
    contract.paths["/owner/price-list/versions"].get.responses[200].content["application/json"].examples.versions.value,
  );
const version = () =>
  structuredClone(
    contract.paths["/owner/price-list/versions/{version}"].get.responses[200].content["application/json"].examples
      .old_version.value,
  );
const traceId = "0123456789abcdef0123456789abcdef";
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
let items: ReturnType<typeof fixture>,
  problem: { status: number; code: string } | null,
  detailProblem: { status: number; code: string } | null,
  hold: boolean;
let calls: { path: string; method: string }[];
beforeEach(() => {
  items = fixture();
  problem = detailProblem = null;
  hold = false;
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const path = String(input);
      calls.push({ path, method: init?.method ?? "GET" });
      if (path === "/api/owner/me")
        return json({
          owner: {
            ownerId: "00000000-0000-4000-8000-000000000050",
            alertChannelFriend: false,
            createdAt: "2026-11-23T08:00:00Z",
          },
          shop: { shopId: "00000000-0000-4000-8000-000000000051", name: "합성 가게", licenseStatus: "verified" },
        });
      if (path === "/api/owner/price-list/versions") {
        if (hold) return new Promise(() => {});
        return problem ? json({ ...problem, traceId }, problem.status) : json(items);
      }
      return detailProblem
        ? json({ ...detailProblem, traceId }, detailProblem.status)
        : json({ ...version(), version: Number(path.split("/").at(-1)) });
    }),
  );
});
afterEach(() => {
  cleanup();
  for (const n of document.querySelectorAll("[data-announcer]")) n.remove();
  vi.unstubAllGlobals();
});
function area(selected: string | null = null, extra: { sessionChecking?: boolean; sessionFailed?: boolean } = {}) {
  const props = {
    shopName: "합성 가게",
    onNavigate: vi.fn(),
    onSessionExpired: vi.fn(),
    onRegisterShop: vi.fn(),
    onLogout: vi.fn(),
    ...extra,
  };
  return { ...render(<PriceListHistory {...props} version={selected} />), props };
}
it("좁은 화면 목록과 고른 옛 버전은 읽기 전용이며 저장 요청이 없음", async () => {
  const v = area();
  await screen.findByRole("link", { name: /버전 3/ });
  fireEvent.click(screen.getByRole("link", { name: /버전 3/ }));
  expect(v.props.onNavigate).toHaveBeenCalledWith("/owner/price-list/versions/3");
  v.unmount();
  area("3");
  await screen.findByRole("heading", { name: /버전 3/ });
  expect(screen.queryByRole("button", { name: "저장" })).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(within(screen.getByRole("region", { name: "고른 가격표" })).queryByRole("link")).toBeNull();
  expect(calls.every((c) => c.method === "GET")).toBe(true);
});
it("넓은 화면은 최신 상세를 함께 읽고 폭이 좁아지면 목록만 남긴다", async () => {
  let change = () => {};
  const query = {
    matches: true,
    addEventListener: (_event: string, callback: () => void) => {
      change = callback;
    },
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("matchMedia", () => query);
  area();
  await screen.findByRole("heading", { name: `버전 ${items.items[0].version} (고른 버전)` });
  expect(screen.getByRole("link", { name: /현재/ }).getAttribute("aria-current")).toBe("page");
  act(() => {
    query.matches = false;
    change();
  });
  await waitFor(() => expect(screen.queryByRole("region", { name: "고른 가격표" })).toBeNull());
  expect(screen.getByRole("link", { name: /버전 3/ })).toBeTruthy();
});
it("앞자리0 상세도 정규화한 같은 버전을 선택 표시한다", async () => {
  area("03");
  await screen.findByRole("heading", { name: /버전 3/ });
  expect(screen.getByRole("link", { name: /버전 3/ }).getAttribute("aria-current")).toBe("page");
  expect(calls.some((call) => call.path.endsWith("/03"))).toBe(false);
});
it("이전 상세의 늦은 권한 실패는 새 버전과 로그인 상태를 덮지 못한다", async () => {
  const transport = fetch;
  let finish!: (response: Response) => void;
  let oldSignal: AbortSignal | null | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith("/versions/3")) {
        oldSignal = init?.signal;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }
      return transport(url, init);
    }),
  );
  const view = area("3");
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  view.rerender(<PriceListHistory {...view.props} version="2" />);
  await screen.findByRole("heading", { name: /버전 2/ });
  await act(async () => {
    finish(json({ code: "unauthenticated", traceId }, 401));
  });
  expect(oldSignal?.aborted).toBe(true);
  expect(view.props.onSessionExpired).not.toHaveBeenCalled();
  expect(screen.getByRole("heading", { name: /버전 2/ })).toBeTruthy();
});
it("세션 재확인 실패는 이동과 재시도를 막되 로그아웃은 허용한다", async () => {
  problem = { status: 500, code: "internal" };
  const view = area(null, { sessionFailed: true });
  await screen.findByText(`추적 ID: ${traceId}`);
  for (const name of ["현재 가격표로", "다시 시도"])
    expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
  expect(view.props.onLogout).toHaveBeenCalledOnce();
  expect(calls).toHaveLength(1);
});
it("관측 영역 진입은 다음20개를 추가하고 관측자를 해제한다", async () => {
  const base = items.items[0];
  items.items = Array.from({ length: 41 }, (_, i) => ({
    ...base,
    version: 41 - i,
    supersededAt: i ? base.createdAt : null,
  }));
  let advance!: (entries: { isIntersecting: boolean }[]) => void;
  const disconnect = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: typeof advance) {
        advance = callback;
      }
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
  const view = area();
  await screen.findByRole("link", { name: /버전 41/ });
  expect(screen.queryByRole("link", { name: /버전 21\b/ })).toBeNull();
  act(() => advance([{ isIntersecting: true }]));
  await screen.findByRole("link", { name: /버전 21\b/ });
  expect(screen.queryByRole("link", { name: /버전 1\b/ })).toBeNull();
  view.unmount();
  expect(disconnect).toHaveBeenCalled();
});
it("빈 목록은 가격표 만들기로 돌아가는 동작을 제공", async () => {
  items.items = [];
  const v = area();
  await screen.findByText("아직 저장한 가격표가 없어요");
  fireEvent.click(screen.getByRole("button", { name: "가격표 만들기" }));
  expect(v.props.onNavigate).toHaveBeenCalledWith("/owner/price-list");
});
it.each([
  { status: 401, code: "unauthenticated", cb: "onSessionExpired" },
  { status: 404, code: "shop_not_registered", cb: "onRegisterShop" },
] as const)("목록 $code는 권한 경로로 이동", async (p) => {
  problem = p;
  const v = area();
  await waitFor(() => expect(v.props[p.cb]).toHaveBeenCalledTimes(1));
});
it("목록 실패의 추적 ID와 재시도", async () => {
  problem = { status: 500, code: "internal" };
  area();
  await screen.findByText(`추적 ID: ${traceId}`);
  problem = null;
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await screen.findByRole("link", { name: /버전 3/ });
});
it.each([
  { status: 401, code: "unauthenticated", text: "다시 로그인해 주세요" },
  { status: 404, code: "not_found", text: "찾을 수 없어요" },
  { status: 500, code: "internal", text: "문제가 생겼어요. 다시 시도해 주세요" },
])("상세 $code는 그 상태와 목록 복귀를 제공", async (p) => {
  detailProblem = p;
  const v = area("3");
  await screen.findByText(p.text);
  if (p.code === "unauthenticated") expect(v.props.onSessionExpired).toHaveBeenCalledTimes(1);
  if (p.code === "not_found") {
    fireEvent.click(screen.getByRole("button", { name: "버전 목록으로" }));
    expect(v.props.onNavigate).toHaveBeenCalledWith("/owner/price-list/versions");
  }
});
it("불러오는 동안 다른 화면 액션을 막음", async () => {
  hold = true;
  area();
  expect((screen.getByRole("button", { name: "현재 가격표로" }) as HTMLButtonElement).disabled).toBe(true);
});
it("이력1000개는20개부터 표시하고 더 표시하면 다음20개만 추가", async () => {
  const base = items.items[0];
  items.items = Array.from({ length: 1000 }, (_, i) => ({
    ...base,
    version: 1000 - i,
    supersededAt: i ? base.createdAt : null,
  }));
  area();
  await screen.findByRole("link", { name: /버전 1000/ });
  expect(screen.queryByRole("link", { name: /버전 980\b/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "버전 더 보기" }));
  await screen.findByRole("link", { name: /버전 980\b/ });
  expect(screen.queryByRole("link", { name: /버전 960\b/ })).toBeNull();
});
it("실제 상세 경로는 로그인 복귀와 OwnerArea에서 보존", async () => {
  render(
    <MemoryRouter initialEntries={["/owner/price-list/versions/3"]}>
      <Routes>
        <Route path="/owner/*" element={<OwnerArea />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "가격표 버전 이력" });
  await screen.findByRole("heading", { name: /버전 3/ });
});

it("도안 그림을 읽지 못해도 버전 내용과 대체 안내를 남긴다", async () => {
  area("3");
  const detail = await screen.findByRole("region", { name: "고른 가격표" });
  await screen.findByRole("heading", { name: /버전 3/ });
  const image = within(detail).getAllByRole("img")[0];
  if (!image) throw new Error("합성 도안 그림 없음");
  fireEvent.error(image);
  await within(detail).findByText("도안 그림을 불러오지 못했어요.");
  expect(within(detail).getByRole("heading", { name: "옵션" })).toBeTruthy();
  expect(calls.every((c) => c.method === "GET")).toBe(true);
});
it("목록과 상세가 동시에401이어도 로그인 전환은 한 번만 요청한다", async () => {
  problem = detailProblem = { status: 401, code: "unauthenticated" };
  const view = area("3");
  await waitFor(() => expect(view.props.onSessionExpired).toHaveBeenCalledOnce());
  await act(async () => {});
  expect(view.props.onSessionExpired).toHaveBeenCalledOnce();
});
it("상세 서버 실패는 같은 버전만 다시 읽고 저장하지 않는다", async () => {
  detailProblem = { status: 500, code: "internal" };
  area("3");
  await screen.findByText(`추적 ID: ${traceId}`);
  detailProblem = null;
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await screen.findByRole("heading", { name: /버전 3/ });
  expect(calls.filter((c) => c.path.endsWith("/versions/3"))).toHaveLength(2);
  expect(calls.every((c) => c.method === "GET")).toBe(true);
});
it("신고 보류 계정은 버전 API를 읽기 전에 신고 수정으로 간다", async () => {
  const transport = fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      if (String(input) === "/api/owner/me") {
        const response = await transport(String(input), init),
          data = await response.json();
        return json({ ...data, shop: { ...data.shop, licenseStatus: "on_hold" } });
      }
      return transport(String(input), init);
    }),
  );
  render(
    <MemoryRouter initialEntries={["/owner/price-list/versions/3"]}>
      <Routes>
        <Route path="/owner/shop/license" element={<p>신고 수정 합성 목적지</p>} />
        <Route path="/owner/*" element={<OwnerArea />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByText("신고 수정 합성 목적지");
  expect(calls.some((c) => c.path.includes("price-list"))).toBe(false);
});
