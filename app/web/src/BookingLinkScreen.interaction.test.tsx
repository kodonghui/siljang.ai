// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { BookingLinkScreen } from "./BookingLinkScreen";
import { BOOKING_CONDITIONS } from "./booking-link-api";
import { OwnerArea } from "./OwnerArea";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const example = (name: string) =>
  structuredClone(api.paths["/owner/booking-link"].get.responses[200].content["application/json"].examples[name].value);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const traceId = "0123456789abcdef0123456789abcdef";
let current: ReturnType<typeof example>,
  problem: { status: number; code: string } | null,
  hold: Promise<Response> | null;
let reads: { signal: AbortSignal | null | undefined }[];
beforeEach(() => {
  current = example("issued");
  problem = null;
  hold = null;
  reads = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      reads.push({ signal: init?.signal });
      return hold ?? (problem ? json({ ...problem, traceId }, problem.status) : json(current));
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const node of document.querySelectorAll("[data-announcer]")) node.remove();
});
function area(extra: { sessionChecking?: boolean; sessionFailed?: boolean } = {}) {
  const props = {
    shopName: "합성 예약 가게",
    onNavigate: vi.fn(),
    onSessionExpired: vi.fn(),
    onRegisterShop: vi.fn(),
    onLogout: vi.fn(),
    ...extra,
  };
  return { ...render(<BookingLinkScreen {...props} />), props };
}
const main = () => within(screen.getByRole("main"));
const issued = () => screen.findByLabelText("예약 링크");
it("발급된 주소는 복사/새 탭과 발급 시각·프로필 안내·조회 기준을 보인다", async () => {
  const write = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText: write } });
  area();
  const input = await issued();
  expect((input as HTMLInputElement).value).toBe(current.url);
  const link = main().getByRole("link", { name: "예약 링크 페이지 열기" });
  expect(link.getAttribute("href")).toBe(current.url);
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toContain("noopener");
  expect(main().getByText("카카오톡 채널 프로필과 인스타그램 프로필에 이 주소를 넣어 주세요")).toBeTruthy();
  expect(main().getByText(/발급 시각/)).toBeTruthy();
  expect(main().getByText(/\d{2}:\d{2} 기준/)).toBeTruthy();
  fireEvent.click(main().getByRole("button", { name: "예약 링크 복사" }));
  await main().findByText("복사했어요");
  expect(write).toHaveBeenCalledExactlyOnceWith(current.url);
});
it("조건 미충족은7개 목록과 남은 설정 경로를 보이고 주소/복사는 숨긴다", async () => {
  current = example("not_ready");
  current.missing = [...BOOKING_CONDITIONS];
  area();
  await main().findByText("예약 링크를 만들려면 아래를 마쳐 주세요");
  expect(within(main().getByRole("list", { name: "준비 조건" })).getAllByRole("listitem")).toHaveLength(7);
  expect(main().getByText("운영자가 확인하고 있어요")).toBeTruthy();
  expect(main().getByText("운영자가 준비하고 있어요")).toBeTruthy();
  expect(main().getByRole("link", { name: "결제 수단 등록하기" }).getAttribute("href")).toBe(
    "/owner/payment-destination",
  );
  expect(main().getByRole("link", { name: "채널 연결하기" }).getAttribute("href")).toBe("/owner/kakao-channel");
  expect(screen.queryByLabelText("예약 링크")).toBeNull();
  expect(main().queryByRole("button", { name: "예약 링크 복사" })).toBeNull();
});
it("마친 조건은 체크와 마침으로 표시하고 픽업 장소를 권한다", async () => {
  current = example("not_ready");
  area();
  await main().findByText("예약 링크를 만들려면 아래를 마쳐 주세요");
  expect(main().getAllByText("마침")).toHaveLength(5);
  expect(main().getByText("픽업 장소를 넣으면 전날 안내에 함께 나가요")).toBeTruthy();
});
it("서버 실패는 추적 ID/재시도를 보이고 뒤로 나갈 수 있다", async () => {
  problem = { status: 500, code: "internal" };
  const view = area();
  await main().findByText(`추적 ID: ${traceId}`);
  fireEvent.click(screen.getByRole("link", { name: "뒤로" }));
  expect(view.props.onNavigate).toHaveBeenCalledWith("/owner/shop");
  problem = null;
  fireEvent.click(main().getByRole("button", { name: "다시 시도" }));
  await issued();
  expect(reads).toHaveLength(2);
});
it.each([
  { code: "unauthenticated", status: 401, callback: "onSessionExpired" },
  { code: "shop_not_registered", status: 404, callback: "onRegisterShop" },
] as const)("$code 응답은 권한 경로로 간다", async (row) => {
  problem = row;
  const view = area();
  await waitFor(() => expect(view.props[row.callback]).toHaveBeenCalledOnce());
});
it.each(["checking", "failed"])("첫 세션 %s에는 예약 링크를 읽지 않는다", async (state) => {
  const view = area(state === "checking" ? { sessionChecking: true } : { sessionFailed: true });
  await act(async () => {});
  expect(reads).toHaveLength(0);
  view.rerender(<BookingLinkScreen {...view.props} sessionChecking={false} sessionFailed={false} />);
  await issued();
  expect(reads).toHaveLength(1);
});
it("새로 고침 실패는 기존 발급 주소를 유지하고 재시도할 수 있다", async () => {
  area();
  await issued();
  problem = { status: 500, code: "internal" };
  fireEvent.click(main().getByRole("button", { name: "새로 고침" }));
  await main().findByText(`추적 ID: ${traceId}`);
  expect((screen.getByLabelText("예약 링크") as HTMLInputElement).value).toBe(current.url);
  problem = null;
  fireEvent.click(main().getByRole("button", { name: "다시 시도" }));
  await waitFor(() => expect(reads).toHaveLength(3));
});
it("세션 재확인은 조회를 취소하고 늦은401을 무시한 뒤 다시 읽는다", async () => {
  const view = area();
  await issued();
  let finish: ((response: Response) => void) | undefined;
  hold = new Promise((resolve) => {
    finish = resolve;
  });
  fireEvent.click(main().getByRole("button", { name: "새로 고침" }));
  await waitFor(() => expect(reads).toHaveLength(2));
  view.rerender(<BookingLinkScreen {...view.props} sessionChecking />);
  expect(reads[1]?.signal?.aborted).toBe(true);
  await act(async () => {
    finish?.(json({ code: "unauthenticated", traceId }, 401));
  });
  expect(view.props.onSessionExpired).not.toHaveBeenCalled();
  expect((screen.getByLabelText("예약 링크") as HTMLInputElement).value).toBe(current.url);
  hold = null;
  view.rerender(<BookingLinkScreen {...view.props} sessionChecking={false} />);
  await waitFor(() => expect(reads).toHaveLength(3));
});
it("뒤로 돌아온 페이지는 조건을 다시 읽어 새 발급 주소를 보인다", async () => {
  current = example("not_ready");
  area();
  await main().findByText("예약 링크를 만들려면 아래를 마쳐 주세요");
  current = example("issued");
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  fireEvent(window, event);
  await issued();
  expect(reads).toHaveLength(2);
});
it.each(["verified", "pending"])("실제 경로는 %s 가게의 예약 링크 화면을 연다", async (licenseStatus) => {
  const transport = fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === "/api/owner/me"
        ? json({
            owner: {
              ownerId: "d3898f13-62a2-4e3e-bd60-9797a6dfc506",
              alertChannelFriend: false,
              createdAt: "2026-11-15T00:00:00Z",
            },
            shop: { shopId: "1dc0769d-8fb3-46da-af01-729ec0ea63db", name: "합성 가게", licenseStatus },
          })
        : transport(input, init),
    ),
  );
  render(
    <MemoryRouter initialEntries={["/owner/booking-link/"]}>
      <Routes>
        <Route path="/owner/*" element={<OwnerArea />} />
      </Routes>
    </MemoryRouter>,
  );
  await issued();
  expect(screen.getByRole("heading", { name: "예약 링크" })).toBeTruthy();
});
it("보류 가게는 예약 링크 조회 전에 영업 신고로 간다", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      json({
        owner: {
          ownerId: "d3898f13-62a2-4e3e-bd60-9797a6dfc506",
          alertChannelFriend: false,
          createdAt: "2026-11-15T00:00:00Z",
        },
        shop: { shopId: "1dc0769d-8fb3-46da-af01-729ec0ea63db", name: "합성 가게", licenseStatus: "on_hold" },
      }),
    ),
  );
  render(
    <MemoryRouter initialEntries={["/owner/booking-link"]}>
      <Routes>
        <Route path="/owner/shop/license" element={<p>영업 신고 경로</p>} />
        <Route path="/owner/*" element={<OwnerArea />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByText("영업 신고 경로");
  expect(fetch).toHaveBeenCalledTimes(1);
});
