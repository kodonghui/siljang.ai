// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { ConsultationMessagesScreen, consultationPhotoExpiry } from "./ConsultationMessagesScreen";
import { OwnerArea } from "./OwnerArea";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const profile = api.paths["/owner/me"].get.responses[200].content["application/json"].examples.mvp.value;
const examples =
  api.paths["/owner/consultations/{consultationId}/messages"].get.responses[200].content["application/json"].examples;
let page: typeof examples.messages.value;
let problem: { status: number; code: string } | null;
let handler: ((path: string, init?: RequestInit) => Promise<Response>) | null;
beforeEach(() => {
  page = structuredClone(examples.messages.value);
  problem = null;
  handler = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const path = String(input);
      return path === "/api/owner/me"
        ? Response.json(profile)
        : path.startsWith("/api/owner/consultations/")
          ? handler
            ? handler(path, init)
            : problem
              ? Response.json({ ...problem, traceId: "0123456789abcdef0123456789abcdef" }, { status: problem.status })
              : Response.json(page)
          : Response.json({ code: "not_found", traceId: "0123456789abcdef0123456789abcdef" }, { status: 404 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function open(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/owner/consultations/${page.consultationId}${search}`]}>
      <Routes>
        <Route path="/owner/login" element={<h1>합성 로그인 목적지</h1>} />
        <Route path="/owner/*" element={<OwnerArea />} />
      </Routes>
    </MemoryRouter>,
  );
}
it("사장님 상담 주소에서 실제 계약의 메시지와 시각·발신자를 표시한다", async () => {
  open();
  expect(await screen.findByRole("heading", { name: "상담 대화" })).toBeTruthy();
  expect((await screen.findAllByText("손님", { exact: true })).length).toBeGreaterThan(0);
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(([input]) =>
        String(input).startsWith(`/api/owner/consultations/${page.consultationId}/messages`),
      ),
  ).toBe(true);
});
it("사장님 답과 다른 안내를 시각 순서에 섞고 끝난 상담도 지우기 전까지 보인다", async () => {
  page = structuredClone(examples.with_owner_reply.value);
  page.status = "ended";
  open();
  expect((await screen.findAllByText("사장님 답", { exact: true })).length).toBeGreaterThan(0);
  expect(screen.getByText(/끝남 ·/)).toBeTruthy();
  expect(document.querySelectorAll(".consultation-timeline li").length).toBe(page.items.length);
});
it("지운 상담은 보관 기간 안내만 보이고 사진/글을 남기지 않는다", async () => {
  page = structuredClone(examples.deleted.value);
  open();
  expect(await screen.findByText("보관 기간 30일이 지나 대화를 지웠어요")).toBeTruthy();
  expect(document.querySelectorAll(".consultation-timeline li, .consultation-photo").length).toBe(0);
});
it.each([
  [404, "not_found", "찾을 수 없어요"],
  [422, "validation_failed", "입력한 내용을 확인해 주세요"],
  [500, "internal", "문제가 생겼어요. 다시 시도해 주세요"],
] as const)("HTTP %s 오류는 정한 말과 복구 경로를 보인다", async (status, code, message) => {
  problem = { status, code };
  open();
  expect(await screen.findByText(message)).toBeTruthy();
  if (status === 404) expect(screen.getByRole("link", { name: "할 일 목록으로" }).getAttribute("href")).toBe("/owner");
  expect(document.querySelector(".consultation-timeline")).toBeNull();
});
it("로그인이 만료되면 원래 상담 주소를 가진 로그인 화면으로 이동한다", async () => {
  problem = { status: 401, code: "unauthenticated" };
  open();
  expect(await screen.findByRole("heading", { name: "합성 로그인 목적지" })).toBeTruthy();
  expect(document.querySelector(".consultation-timeline")).toBeNull();
});
it("틀린 페이지 주소는 상담 API를 부르지 않고 처음부터 보기로 회복한다", async () => {
  open("?limit=0");
  expect(await screen.findByText("입력한 내용을 확인해 주세요")).toBeTruthy();
  expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).startsWith("/api/owner/consultations/"))).toBe(
    false,
  );
});
it("형식이 틀린 상담 ID도 다른 가게/없는 상담과 같은 찾을 수 없음으로 보인다", async () => {
  page.consultationId = "not-a-consultation";
  open();
  expect(await screen.findByText("찾을 수 없어요")).toBeTruthy();
  expect(screen.queryByText("입력한 내용을 확인해 주세요")).toBeNull();
  expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).startsWith("/api/owner/consultations/"))).toBe(
    false,
  );
});
it("사진 창을 열고 취소하면 원래 썸네일 버튼으로 초점을 돌린다", async () => {
  page.items[0].photos = [{ url: "https://images.example/synthetic-photo" }];
  open();
  const thumbnail = await screen.findByRole("button", { name: "참고 사진 1 크게 보기" });
  thumbnail.focus();
  fireEvent.click(thumbnail);
  const dialog = await screen.findByRole("dialog", { name: "참고 사진 크게 보기" });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "닫기" }));
  fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(thumbnail);
});
it("이전 페이지를 위에 더하고 같은 메시지는 중복시키지 않는다", async () => {
  page.items[0].text = "현재 합성 메시지";
  page.nextCursor = "older_page_1";
  const older = structuredClone(page);
  older.nextCursor = null;
  older.items = [
    {
      ...structuredClone(page.items[0]),
      messageId: "00000000-0000-4000-8000-000000000001",
      at: "2025-01-01T00:00:00+09:00",
      text: "이전 합성 메시지",
    },
    structuredClone(page.items[0]),
  ];
  handler = async (path) => Response.json(path.includes("cursor=older_page_1") ? older : page);
  open();
  await screen.findByText("현재 합성 메시지");
  fireEvent.click(screen.getByRole("button", { name: "이전 대화 더 보기" }));
  await screen.findByText("이전 합성 메시지");
  expect(screen.getAllByText("현재 합성 메시지")).toHaveLength(1);
  const contents = document.querySelector(".consultation-timeline")?.textContent ?? "";
  expect(contents.indexOf("이전 합성 메시지")).toBeLessThan(contents.indexOf("현재 합성 메시지"));
});
it("긴 글의 철자/태그를 그대로 보존하고 펼치며 HTML로 실행하지 않는다", async () => {
  const literal = " <script>synthetic()</script>";
  page.items[0].text = "가".repeat(100000 - literal.length) + literal;
  open();
  await screen.findByText(page.items[0].text);
  const buttons = screen.getAllByRole("button", { name: "더 보기" });
  fireEvent.click(buttons[0] as HTMLElement);
  expect(screen.getByRole("button", { name: "접기" }).getAttribute("aria-expanded")).toBe("true");
  expect(document.querySelector("script")).toBeNull();
});
it("글 본문이 비어 있어도 계약의 네 메시지 종류를 바르게 구분한다", async () => {
  page.items = page.items.slice(0, 4).map((item: Record<string, unknown>, index: number) => ({
    ...item,
    kind: ["text", "photo", "card", "unsupported"][index],
    text: null,
    photos: [],
  }));
  open();
  expect(await screen.findByText("글", { exact: true })).toBeTruthy();
  for (const kind of ["참고 사진", "확인 카드", "지원하지 않는 메시지"])
    expect(screen.getByText(kind, { exact: true })).toBeTruthy();
});
it("이전 대화 조회 실패는 현재 대화를 보존하고 다시 시도하며 삭제 결과는 모두 비운다", async () => {
  page.items[0].text = "남아 있는 합성 현재 대화";
  page.nextCursor = "older_page";
  let attempts = 0;
  handler = async (path) => {
    if (!path.includes("cursor=older_page")) return Response.json(page);
    attempts++;
    return attempts === 1
      ? Response.json({ code: "internal", traceId: "0123456789abcdef0123456789abcdef" }, { status: 500 })
      : Response.json(examples.deleted.value);
  };
  open();
  await screen.findByText("남아 있는 합성 현재 대화");
  fireEvent.click(screen.getByRole("button", { name: "이전 대화 더 보기" }));
  await screen.findByText("문제가 생겼어요. 다시 시도해 주세요");
  expect(screen.getByText("남아 있는 합성 현재 대화")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await screen.findByText("보관 기간 30일이 지나 대화를 지웠어요");
  expect(screen.queryByText("남아 있는 합성 현재 대화")).toBeNull();
  expect(document.querySelectorAll(".consultation-photo, .consultation-timeline")).toHaveLength(0);
});
it("사진 주소 만료 후 같은 버튼으로 다시 불러오며 옛 주소를 다시 요청하지 않는다", async () => {
  const start = new Date("2026-11-25T07:00:00Z");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(start);
  page.items[0].photos = [
    { url: `https://images.example/synthetic?exp=${Math.floor(start.getTime() / 1000) + 900}&sig=synthetic` },
  ];
  open();
  const button = await screen.findByRole("button", { name: "참고 사진 1 크게 보기" });
  button.focus();
  vi.setSystemTime(new Date(start.getTime() + 901000));
  fireEvent(document, new Event("visibilitychange"));
  await screen.findByRole("button", { name: "참고 사진 1 다시 불러오기" });
  expect(document.activeElement).toBe(button);
  expect(button.querySelector("img")).toBeNull();
});
it("세션 재확인 중에는 대화/사진을 가리고 늦은 이전 요청도 반영하지 않는다", async () => {
  page.items[0].text = "이전 손님 비공개 합성 글";
  page.nextCursor = "later_page";
  let finish: ((value: Response) => void) | null = null;
  let signal: AbortSignal | null = null;
  handler = async (path, init) =>
    path.includes("cursor=later_page")
      ? new Promise((resolve) => {
          finish = resolve;
          signal = init?.signal ?? null;
        })
      : Response.json(page);
  const props = {
    shopId: profile.shop.shopId,
    shopName: profile.shop.name,
    onNavigate: vi.fn(),
    onSessionExpired: vi.fn(),
    onRegisterShop: vi.fn(),
    onLogout: vi.fn(),
    consultationId: page.consultationId,
  };
  const view = render(
    <MemoryRouter>
      <ConsultationMessagesScreen {...props} />
    </MemoryRouter>,
  );
  await screen.findByText("이전 손님 비공개 합성 글");
  fireEvent.click(screen.getByRole("button", { name: "이전 대화 더 보기" }));
  await waitFor(() => expect(finish).not.toBeNull());
  view.rerender(
    <MemoryRouter>
      <ConsultationMessagesScreen {...props} sessionChecking />
    </MemoryRouter>,
  );
  expect(screen.queryByText("이전 손님 비공개 합성 글")).toBeNull();
  expect(document.querySelectorAll(".consultation-photo")).toHaveLength(0);
  expect((signal as AbortSignal | null)?.aborted).toBe(true);
  await act(async () => {
    if (finish) (finish as (value: Response) => void)(Response.json(page));
  });
  expect(screen.queryByText("이전 손님 비공개 합성 글")).toBeNull();
});
it("사진 주소 수명은 서버 exp와 읽은 뒤15분 중 이른 때로 제한한다", () => {
  const at = 1000000;
  expect(consultationPhotoExpiry("https://images.example/p?exp=1001", at)).toBe(1001000);
  expect(consultationPhotoExpiry("https://images.example/p?exp=9999999", at)).toBe(at + 900000);
});
