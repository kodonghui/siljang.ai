// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { OperatingRulesHistory } from "./OperatingRulesHistory";
import { OwnerArea } from "./OwnerArea";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const listPath = "/api/owner/operating-rules/versions";
const examples = api.paths["/owner/operating-rules/versions"].get.responses[200].content["application/json"].examples;
const old =
  api.paths["/owner/operating-rules/versions/{version}"].get.responses[200].content["application/json"].examples
    .old_version.value;
const current =
  api.paths["/owner/operating-rules"].get.responses[200].content["application/json"].examples.current.value;
const traceId = "0123456789abcdef0123456789abcdef";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let items: typeof examples.versions.value;
let listProblem: { status: number; code: string } | null, detailProblem: { status: number; code: string } | null;
let calls: string[], holdList: boolean;
beforeEach(() => {
  items = structuredClone(examples.versions.value);
  calls = [];
  listProblem = detailProblem = null;
  holdList = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const path = String(input);
      calls.push(path);
      if (path === listPath) {
        if (holdList) return new Promise<Response>(() => {});
        return listProblem ? json({ ...listProblem, traceId }, listProblem.status) : json(items);
      }
      return detailProblem
        ? json({ ...detailProblem, traceId }, detailProblem.status)
        : json(path.endsWith("/2") ? current : { ...old, version: Number(path.split("/").at(-1)) });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const node of document.querySelectorAll("[data-announcer]")) node.remove();
});
function area(version: string | null = null, extra: { sessionChecking?: boolean; sessionFailed?: boolean } = {}) {
  const props = {
    shopName: "합성 규정 가게",
    onNavigate: vi.fn(),
    onSessionExpired: vi.fn(),
    onRegisterShop: vi.fn(),
    onLogout: vi.fn(),
    ...extra,
  };
  return { ...render(<OperatingRulesHistory {...props} version={version} />), props };
}
function wide() {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}
it("좁은 목록에서 버전을 고르고 옛 수치·조문·환불을 읽기 전용으로 본다", async () => {
  const view = area();
  fireEvent.click(await screen.findByRole("link", { name: /버전 1/ }));
  expect(view.props.onNavigate).toHaveBeenCalledWith("/owner/operating-rules/versions/1");
  view.unmount();
  area("1");
  const heading = await screen.findByRole("heading", { name: "버전 1 (고른 버전)" });
  expect(heading).toBeTruthy();
  const detail = within(screen.getByRole("region", { name: "고른 운영규정" }));
  for (const row of old.clauses) expect(detail.getByText(row.effectText)).toBeTruthy();
  expect(detail.getByText("취소 수수료(원)")).toBeTruthy();
  expect(detail.getByText("5,000")).toBeTruthy();
  expect(detail.getByText(/72시간 전부터 끝없음/)).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("button", { name: "확정" })).toBeNull();
});
it("넓은 목록은 최신 규정을 함께 보여 주고 같은 버전을 골라도 상세를 다시 받지 않는다", async () => {
  wide();
  const view = area();
  await screen.findByRole("heading", { name: "버전 2 (고른 버전)" });
  expect(screen.getByRole("link", { name: /버전 2/ }).getAttribute("aria-current")).toBe("true");
  view.rerender(<OperatingRulesHistory {...view.props} version="2" sessionChecking />);
  view.rerender(<OperatingRulesHistory {...view.props} version="2" sessionChecking={false} />);
  expect(calls.filter((p) => p === `${listPath}/2`)).toHaveLength(1);
  expect(screen.getByRole("link", { name: /버전 2/ }).getAttribute("aria-current")).toBe("page");
});
it("빈 목록은 현재 규정을 정하는 동작을 제공한다", async () => {
  items.items = [];
  const view = area();
  await screen.findByText("아직 확정한 운영규정이 없어요");
  fireEvent.click(screen.getByRole("button", { name: "운영규정 정하기" }));
  expect(view.props.onNavigate).toHaveBeenCalledWith("/owner/operating-rules");
});
it.each([
  { status: 401, code: "unauthenticated", callback: "onSessionExpired" },
  { status: 404, code: "shop_not_registered", callback: "onRegisterShop" },
] as const)("목록 $code는 권한 경로로 이동한다", async (p) => {
  listProblem = p;
  const view = area();
  await waitFor(() => expect(view.props[p.callback]).toHaveBeenCalledOnce());
});
it("목록 서버 실패는 추적 ID와 재시도 뒤 복구한다", async () => {
  listProblem = { status: 500, code: "internal" };
  area();
  await screen.findByText(`추적 ID: ${traceId}`);
  listProblem = null;
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await screen.findByRole("link", { name: /버전 1/ });
  expect(calls.filter((p) => p === listPath)).toHaveLength(2);
});
it("없는 버전은 다른 가게의 존재를 밝히지 않고 목록으로 돌아간다", async () => {
  detailProblem = { status: 404, code: "not_found" };
  const view = area("1");
  await screen.findByRole("heading", { name: "찾을 수 없어요" });
  fireEvent.click(screen.getByRole("button", { name: "버전 목록으로" }));
  expect(view.props.onNavigate).toHaveBeenCalledWith("/owner/operating-rules/versions");
});
it("상세 세션 만료는 로그인 복귀 경로로 보낸다", async () => {
  detailProblem = { status: 401, code: "unauthenticated" };
  const view = area("1");
  await waitFor(() => expect(view.props.onSessionExpired).toHaveBeenCalledOnce());
});
it("상세 서버 실패 재시도는 목록을 다시 받지 않는다", async () => {
  wide();
  detailProblem = { status: 500, code: "internal" };
  area("1");
  await screen.findByText(`추적 ID: ${traceId}`);
  detailProblem = null;
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await screen.findByRole("heading", { name: "버전 1 (고른 버전)" });
  expect(calls.filter((p) => p === listPath)).toHaveLength(1);
  expect(calls.filter((p) => p === `${listPath}/1`)).toHaveLength(2);
});
it("늦은 목록이 숨은 좁은 상세의 돌아가기와 로그아웃을 막지 않는다", async () => {
  holdList = true;
  const view = area("1");
  await screen.findByRole("heading", { name: /버전 1/ });
  fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
  expect(view.props.onLogout).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "현재 운영규정으로" }));
  expect(view.props.onNavigate).toHaveBeenCalledWith("/owner/operating-rules");
});
it("목록은 최신 20개부터 펼치며 이미 펼친 개수는 선택 뒤에도 남는다", async () => {
  wide();
  const base = items.items[0];
  items.items = Array.from({ length: 61 }, (_, i) => ({
    ...base,
    version: 61 - i,
    supersededAt: i ? base.createdAt : null,
  }));
  const view = area();
  await screen.findByRole("heading", { name: /버전 61/ });
  fireEvent.click(screen.getByRole("button", { name: "버전 더 보기" }));
  fireEvent.click(screen.getByRole("button", { name: "버전 더 보기" }));
  view.rerender(<OperatingRulesHistory {...view.props} version="5" />);
  await screen.findByRole("heading", { name: /버전 5/ });
  expect(screen.getByRole("link", { name: /버전 2\b/ })).toBeTruthy();
  expect(calls.filter((p) => p === listPath)).toHaveLength(1);
});
it.each(["checking", "failed"] as const)("첫 세션 %s 중 새 조회를 막고 확인 뒤 시작한다", async (state) => {
  wide();
  const view = area("1", state === "checking" ? { sessionChecking: true } : { sessionFailed: true });
  await act(async () => {});
  expect(calls).toHaveLength(0);
  view.rerender(<OperatingRulesHistory {...view.props} version="1" sessionChecking={false} sessionFailed={false} />);
  await screen.findByRole("heading", { name: /버전 1/ });
  expect(calls).toHaveLength(2);
});
it.each(["pending", "verified", "on_hold"] as const)(
  "실제 운영규정 이력 경로에서 %s 가게 권한을 먼저 확인한다",
  async (status) => {
    const transport = fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === "/api/owner/me"
          ? json({
              owner: {
                ownerId: "00000000-0000-4000-8000-000000000052",
                alertChannelFriend: false,
                createdAt: "2026-11-23T12:00:00Z",
              },
              shop: { shopId: "00000000-0000-4000-8000-000000000053", name: "합성 규정 가게", licenseStatus: status },
            })
          : transport(input, init),
      ),
    );
    render(
      <MemoryRouter initialEntries={["/owner/operating-rules/versions/1/"]}>
        <Routes>
          <Route path="/owner/shop/license" element={<p>신고 수정 합성 목적지</p>} />
          <Route path="/owner/*" element={<OwnerArea />} />
        </Routes>
      </MemoryRouter>,
    );
    if (status === "on_hold") {
      await screen.findByText("신고 수정 합성 목적지");
      expect(calls).toHaveLength(0);
    } else {
      await screen.findByRole("heading", { name: /버전 1/ });
      expect(calls.filter((p) => p === `${listPath}/1`)).toHaveLength(1);
    }
  },
);

it("좁은 직접 상세는 목록을 미루고 넓어지면 한 번만 읽는다", async () => {
  let change = () => {};
  const query = {
    matches: false,
    addEventListener: (_event: string, callback: () => void) => {
      change = callback;
    },
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("matchMedia", () => query);
  area("1");
  await screen.findByRole("heading", { name: /버전 1/ });
  expect(calls.filter((c) => c === "/api/owner/operating-rules/versions")).toHaveLength(0);
  act(() => {
    query.matches = true;
    change();
  });
  await screen.findByRole("link", { name: /버전 1/ });
  expect(calls.filter((c) => c === "/api/owner/operating-rules/versions")).toHaveLength(1);
});

it("규정 상세의 목록 복귀도 같은 버전 링크로 초점을 돌린다", async () => {
  const view = area("1");
  await screen.findByRole("heading", { name: "버전 1 (고른 버전)" });
  const back = screen.getByRole("button", { name: "버전 목록으로" });
  back.focus();
  fireEvent.click(back);
  view.rerender(<OperatingRulesHistory {...view.props} version={null} />);
  const chosen = await screen.findByRole("link", { name: /버전 1\b/ });
  await waitFor(() => expect(document.activeElement).toBe(chosen));
});

it("넓은 규정의 직접 옛 버전 복귀는 목록 밖이면 영역으로 초점을 돌린다", async () => {
  wide();
  items.items = items.items.filter((item: { version: number }) => item.version !== 1);
  const view = area("1");
  await screen.findByRole("heading", { name: "버전 1 (고른 버전)" });
  const back = screen.getByRole("button", { name: "버전 목록으로" });
  back.focus();
  fireEvent.click(back);
  view.rerender(<OperatingRulesHistory {...view.props} version={null} />);
  await screen.findByRole("heading", { name: "버전 2 (고른 버전)" });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("region", { name: "운영규정 버전 목록" })));
});
