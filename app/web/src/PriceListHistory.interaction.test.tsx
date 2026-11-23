// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
function area(selected: string | null = null) {
  const props = {
    shopName: "합성 가게",
    onNavigate: vi.fn(),
    onSessionExpired: vi.fn(),
    onRegisterShop: vi.fn(),
    onLogout: vi.fn(),
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
  expect(calls.every((c) => c.method === "GET")).toBe(true);
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
