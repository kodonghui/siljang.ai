// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { App } from "./App";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const responses = api.paths["/public/shops/{slug}/privacy-policy"].get.responses;
const policy = () => structuredClone(responses[200].content["application/json"].examples.policy.value);
const slug = "synthetic-shop",
  path = `/s/${slug}/privacy`;
const traceId = "0123456789abcdef0123456789abcdef";
const json = (body: unknown, status = 200, seconds = 2) =>
  new Response(JSON.stringify(body), {
    status,
    ...(status === 429 ? { headers: { "Retry-After": String(seconds) } } : {}),
  });
const problem = (code: string) => ({
  type: "about:blank",
  title: code,
  status: code === "rate_limited" ? 429 : 500,
  code,
  traceId,
});
let value: ReturnType<typeof policy>, result: () => Promise<Response>;
let calls: { url: string; init: RequestInit }[];
const mount = (pathname = path) =>
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <App />
    </MemoryRouter>,
  );
const main = () => within(screen.getByRole("main"));
const loaded = () => screen.findByRole("heading", { name: "처리방침 본문" });
beforeEach(() => {
  value = policy();
  calls = [];
  result = async () => json(value);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url !== `/api/public/shops/${slug}/privacy-policy`) throw new Error(`예상 밖 요청: ${url}`);
      return result();
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const node of document.querySelectorAll("[data-announcer]")) node.remove();
});

it("로그인 없이 공개 처리방침과 게시 버전·서울 날짜를 읽는다", async () => {
  value.publishedAt = "2026-11-22T16:10:00Z";
  mount();
  await loaded();
  expect(main().getByRole("heading", { level: 1 }).textContent).toBe("개인정보 처리방침");
  expect(screen.getByRole("main").textContent).toContain(value.shopName);
  expect(screen.getByRole("main").textContent).toContain(`버전 ${value.version} · 2026-11-23 게시`);
  expect(main().getByRole("link", { name: "예약 링크 페이지로" }).getAttribute("href")).toBe(`/s/${slug}`);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.init.cache).toBe("no-store");
});
it("아직 읽는 동안 본문을 꾸며 내지 않고 요청을 취소한다", async () => {
  result = () => new Promise<Response>(() => {});
  const view = mount();
  await screen.findByText("개인정보 처리방침을 불러오고 있어요");
  expect(main().queryByText(value.shopName)).toBeNull();
  expect(main().getByRole("navigation", { name: "처리방침 목차" })).toBeTruthy();
  for (const label of ["예약 링크 페이지로", "처리방침 본문", "국외 이전"])
    expect((main().getByRole("button", { name: label }) as HTMLButtonElement).disabled).toBe(true);
  view.unmount();
  expect(calls[0]?.init.signal?.aborted).toBe(true);
});
it("본문의 문단과 줄바꿈을 보존하고 HTML처럼 실행하지 않는다", async () => {
  value.body = '첫 합성 문단\n같은 문단의 다음 줄\n\n<img src=x onerror="alert(1)">\n\n마지막 합성 문단';
  mount();
  await loaded();
  const body = screen.getByRole("region", { name: "처리방침 본문" });
  expect(body.querySelectorAll("p")).toHaveLength(3);
  expect(body.textContent).toContain("첫 합성 문단\n같은 문단의 다음 줄");
  expect(body.textContent).toContain('<img src=x onerror="alert(1)">');
  expect(body.querySelector("img, script")).toBeNull();
});
it("같은 수령인이 여러 번 나와도 국외 이전의 모든 항목을 보인다", async () => {
  value.overseasTransfers = Array.from({ length: 2 }, (_, i) => ({
    recipient: "합성 수령인",
    country: `국가 ${i}`,
    personalData: `항목 ${i}`,
    whenAndHow: `시기와 방법 ${i}`,
    purposeAndRetention: `목적과 기간 ${i}`,
    howToRefuse: `거부 방법 ${i}`,
  }));
  mount();
  await loaded();
  const region = screen.getByRole("region", { name: "국외 이전" });
  expect(within(region).getByRole("table").querySelectorAll("tbody tr")).toHaveLength(2);
  expect(within(region).getByRole("list").children).toHaveLength(2);
  for (const row of value.overseasTransfers)
    for (const text of Object.values(row)) expect(region.textContent).toContain(text);
});
it("목차는 본문 안으로 이동하며 API를 다시 읽지 않는다", async () => {
  mount();
  await loaded();
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "처리방침 목차" })).getByRole("link", { name: "국외 이전" }),
  );
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "국외 이전" }));
  expect(calls).toHaveLength(1);
});
it("최대 본문10만자와 국외 이전20개를 자르지 않는다", async () => {
  value.body = "합".repeat(100000);
  value.overseasTransfers = Array.from({ length: 20 }, () => value.overseasTransfers[0]);
  mount();
  await loaded();
  expect(screen.getByRole("region", { name: "처리방침 본문" }).querySelector("p")?.textContent).toHaveLength(100000);
  expect(main().getByRole("table").querySelectorAll("tbody tr")).toHaveLength(20);
});
it("404는 주소 재확인만 안내하고 없는 목록으로 보내지 않는다", async () => {
  result = async () => json({ ...problem("not_found"), status: 404 }, 404);
  mount();
  await main().findByText("찾을 수 없어요");
  expect(main().getByText("가게 주소를 다시 확인해 주세요")).toBeTruthy();
  expect(document.querySelector('[data-announcer="assertive"]')?.textContent).toContain(
    "가게 주소를 다시 확인해 주세요",
  );
  expect(main().queryByRole("link")).toBeNull();
});
it("틀린 slug는 API를 요청하지 않고 같은404 안내를 보인다", async () => {
  mount("/s/BAD/privacy");
  await main().findByText("찾을 수 없어요");
  expect(calls).toHaveLength(0);
});
it("서버 실패는 추적 ID와 재시도로 복구한다", async () => {
  result = async () => json(problem("internal"), 500);
  mount();
  await main().findByText("문제가 생겼어요. 다시 시도해 주세요");
  expect(screen.getByRole("main").textContent).toContain(traceId);
  result = async () => json(value);
  fireEvent.click(main().getByRole("button", { name: "다시 시도" }));
  await loaded();
  expect(calls).toHaveLength(2);
});
it("뒤로 복원하면 이전 본문을 숨기고 현재 게시 버전을 다시 읽는다", async () => {
  mount();
  await loaded();
  let release: (response: Response) => void = () => {};
  result = () =>
    new Promise<Response>((resolve) => {
      release = resolve;
    });
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  fireEvent(window, event);
  expect(main().queryByRole("region", { name: "처리방침 본문" })).toBeNull();
  value.version += 1;
  await act(async () => release(json(value)));
  await loaded();
  expect(screen.getByRole("main").textContent).toContain(`버전 ${value.version}`);
  expect(calls).toHaveLength(2);
});
it("429는 컴퓨터 시각이 바뀌어도 Retry-After만큼 기다린 뒤 한 번 자동으로 읽는다", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "performance"] });
  result = async () => json(problem("rate_limited"), 429);
  mount();
  await act(async () => {});
  expect(main().getByText("2초 뒤 자동으로 다시 불러와요")).toBeTruthy();
  vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
  result = async () => json(value);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1999);
  });
  expect(calls).toHaveLength(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(main().getByRole("region", { name: "처리방침 본문" })).toBeTruthy();
  expect(calls).toHaveLength(2);
});
it.each(["pageshow-first", "visibility-first"])(
  "429 기한 뒤 복원 두 이벤트가 겹쳐도 한 번만 읽는다 %s",
  async (order) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    result = async () => json(problem("rate_limited"), 429, 30);
    mount();
    await act(async () => {});
    expect(calls).toHaveLength(1);
    now = 40000;
    result = async () => json(value);
    const restore = new Event("pageshow");
    Object.defineProperty(restore, "persisted", { value: true });
    const visibility = new Event("visibilitychange");
    await act(async () => {
      if (order === "pageshow-first") {
        window.dispatchEvent(restore);
        document.dispatchEvent(visibility);
      } else {
        document.dispatchEvent(visibility);
        window.dispatchEvent(restore);
      }
    });
    expect(calls).toHaveLength(2);
  },
);
it("429는 시작 안내를 한 번 알리고 매초 남은 시간을 읽어 주지 않는다", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "performance"] });
  result = async () => json(problem("rate_limited"), 429);
  mount();
  await act(async () => {});
  const region = document.querySelector('[data-announcer="polite"]');
  expect(region?.textContent).toContain("잠시 뒤 다시 시도해 주세요");
  const line = region?.firstElementChild;
  expect(main().queryByRole("status")).toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(main().getByText("1초 뒤 자동으로 다시 불러와요")).toBeTruthy();
  expect(region?.firstElementChild).toBe(line);
});
it("국외 이전 해시로 처음 열어도 본문을 받은 뒤 그 제목으로 이동한다", async () => {
  mount(`${path}#privacy-transfers`);
  await loaded();
  await act(async () => {});
  expect(document.activeElement).toBe(main().getByRole("heading", { name: "국외 이전" }));
});
function BackProbe() {
  const navigate = useNavigate(),
    location = useLocation();
  return (
    <>
      <button type="button" onClick={() => navigate(-1)}>
        시험 뒤로
      </button>
      <output aria-label="시험 경로">{location.pathname}</output>
    </>
  );
}
it("목차 이동 뒤 뒤로 가기는 목차 전 주소를 쌓지 않고 앞 페이지로 간다", async () => {
  render(
    <MemoryRouter initialEntries={["/previous", path]}>
      <App />
      <BackProbe />
    </MemoryRouter>,
  );
  await loaded();
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "처리방침 목차" })).getByRole("link", { name: "국외 이전" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "시험 뒤로" }));
  expect(screen.getByLabelText("시험 경로").textContent).toBe("/previous");
});
it("429 화면을 닫으면 남은 자동 재시도를 취소한다", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "performance"] });
  result = async () => json(problem("rate_limited"), 429);
  const view = mount();
  await act(async () => {});
  expect(main().getByText("2초 뒤 자동으로 다시 불러와요")).toBeTruthy();
  view.unmount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(calls).toHaveLength(1);
});
it("429가 반복되면 새 대기 시간을 적용하고 표시 복귀가 중복 요청을 만들지 않는다", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "performance"] });
  result = async () => json(problem("rate_limited"), 429, calls.length === 1 ? 1 : 3);
  mount();
  await act(async () => {});
  expect(main().getByText("1초 뒤 자동으로 다시 불러와요")).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(main().getByText("3초 뒤 자동으로 다시 불러와요")).toBeTruthy();
  fireEvent(document, new Event("visibilitychange"));
  fireEvent(document, new Event("visibilitychange"));
  expect(calls).toHaveLength(2);
  result = async () => json(value);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(main().getByRole("region", { name: "처리방침 본문" })).toBeTruthy();
  expect(calls).toHaveLength(3);
});
