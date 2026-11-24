// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { App } from "./App";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const examples = api.paths["/public/shops/{slug}"].get.responses[200].content["application/json"].examples;
const original = () => structuredClone(examples.page.value);
const slug = "moonlight-cake";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let value: ReturnType<typeof original>;
let result: () => Promise<Response>;
let calls: string[];
const mount = () =>
  render(
    <MemoryRouter initialEntries={[`/s/${slug}`]}>
      <App />
    </MemoryRouter>,
  );
beforeEach(() => {
  value = original();
  calls = [];
  result = async () => json(value);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url !== `/api/public/shops/${slug}`) throw new Error("예상 밖 요청");
      return result();
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  for (const node of document.querySelectorAll("[data-announcer]")) node.remove();
});

it("공개 주소에서 로그인 없이 현재 가격표·60일·가게 신원과 문의 주소를 보인다", async () => {
  mount();
  await screen.findByRole("heading", { name: value.shop.name });
  for (const title of ["포트폴리오", "가격표", "빈 날짜"])
    expect(screen.getByRole("heading", { name: title })).toBeTruthy();
  expect(screen.getByRole("link", { name: "문의하기" }).getAttribute("href")).toBe(value.inquiryUrl);
  expect(screen.getByText("20,000원부터")).toBeTruthy();
  expect(screen.getByText("40,000~60,000원")).toBeTruthy();
  expect(calls).toEqual([`/api/public/shops/${slug}`]);
  expect(screen.queryByText("남은 자리")).toBeNull();
});
it("포트폴리오가 비어도 가격표·문의하기를 유지한다", async () => {
  value.portfolio = [];
  mount();
  await screen.findByText("아직 사진이 없어요");
  expect(screen.getByRole("heading", { name: "가격표" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "문의하기" })).toBeTruthy();
});
it("아직 읽는 동안 실제 가게 정보를 꾸며 내지 않는다", async () => {
  result = () => new Promise(() => {});
  mount();
  await screen.findByText("예약 링크 페이지를 불러오고 있어요");
  expect(screen.queryByText(value.shop.name)).toBeNull();
  expect(screen.queryByRole("link", { name: "문의하기" })).toBeNull();
});
it("404는 가게가 있는지 구분하지 않고 돌아갈 목록 없이 같은 문구를 보인다", async () => {
  result = async () => json({ code: "not_found" }, 404);
  mount();
  await screen.findByText("찾을 수 없어요");
  expect(screen.getByText("가게 주소를 다시 확인해 주세요")).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
});
it("사진 실패가 동시에 와도 한 번만 새로 읽고 모든 사진 주소를 바꾼다", async () => {
  mount();
  await screen.findByRole("heading", { name: value.shop.name });
  const oldImages = screen.getAllByRole("img");
  value = original();
  value.portfolio = value.portfolio.map((photo: { imageUrl: string }) => ({
    imageUrl: `${photo.imageUrl}&refreshed=1`,
  }));
  value.priceList.designs = value.priceList.designs.map((design: { imageUrl: string }) => ({
    ...design,
    imageUrl: `${design.imageUrl}&refreshed=1`,
  }));
  fireEvent.error(oldImages[0] as HTMLElement);
  fireEvent.error(oldImages[1] as HTMLElement);
  await vi.waitFor(() => expect(calls).toHaveLength(2));
  await vi.waitFor(() =>
    expect(screen.getAllByRole("img").every((image) => image.getAttribute("src")?.includes("refreshed=1"))).toBe(true),
  );
  fireEvent.error(screen.getAllByRole("img")[0] as HTMLElement);
  await vi.waitFor(() =>
    expect(within(screen.getByRole("region", { name: "포트폴리오" })).getByRole("status").textContent).toBe(
      "사진을 불러오지 못했어요",
    ),
  );
  expect(calls).toHaveLength(2);
});
it("월 이동은 받은 날짜 안에서만 하며 API를 다시 읽지 않는다", async () => {
  mount();
  await screen.findByRole("heading", { name: value.shop.name });
  expect((screen.getByRole("button", { name: "이전 달" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "다음 달" }));
  fireEvent.click(screen.getByRole("button", { name: "다음 달" }));
  expect((screen.getByRole("button", { name: "다음 달" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("table").textContent).toContain("2027년 1월");
  expect(calls).toHaveLength(1);
});
it("두 달 화면에서도 마지막 달 밖으로 이동하지 않는다", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  mount();
  await screen.findByRole("heading", { name: value.shop.name });
  expect(screen.getAllByRole("table")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "다음 달" }));
  expect((screen.getByRole("button", { name: "다음 달" }) as HTMLButtonElement).disabled).toBe(true);
  expect(calls).toHaveLength(1);
});
it("429는 Retry-After 전에 다시 요청하지 않고 기한 뒤 한 번 자동으로 읽는다", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance"] });
  result = async () =>
    new Response(JSON.stringify({ code: "rate_limited" }), { status: 429, headers: { "Retry-After": "2" } });
  mount();
  await act(async () => {});
  expect(screen.getByText("2초 뒤 자동으로 다시 불러와요")).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(calls).toHaveLength(1);
  result = async () => json(value);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(calls).toHaveLength(2);
  expect(screen.getByRole("heading", { name: value.shop.name })).toBeTruthy();
});
it("열어 둔 페이지도60초마다 공개 사진 철회를 반영한다", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance"] });
  mount();
  await act(async () => {});
  expect(screen.getAllByRole("img")).toHaveLength(4);
  value.portfolio = [];
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(calls).toHaveLength(2);
  expect(screen.getByText("아직 사진이 없어요")).toBeTruthy();
  expect(screen.getAllByRole("img")).toHaveLength(2);
});
it("없는 문의 주소는 버튼을 잠그고 실패 화면에서 가게 신원을 남기지 않는다", async () => {
  value.inquiryUrl = null;
  mount();
  await screen.findByRole("heading", { name: value.shop.name });
  expect((screen.getByRole("button", { name: "문의하기" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("link", { name: "문의하기" })).toBeNull();
  result = async () => json({ code: "not_found" }, 404);
  fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
  await screen.findByText("찾을 수 없어요");
  expect(screen.queryByRole("heading", { name: value.shop.name })).toBeNull();
});

function useRefreshClock() {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance"] });
}
it("같은 사진을 돌려주는60초 정기 조회는 열어 둔 사진 창을 닫지 않는다", async () => {
  useRefreshClock();
  mount();
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "포트폴리오 사진 1 크게 보기" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(calls).toHaveLength(2);
  expect(screen.getByRole("dialog")).toBeTruthy();
});
it("늦은 정기 조회 동안과 완료 뒤에도 고른 달과 접어 둔 그룹을 보존한다", async () => {
  useRefreshClock();
  mount();
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "다음 달" }));
  const group = screen.getByText("크기", { selector: "summary" }).closest("details");
  fireEvent.click(screen.getByText("크기", { selector: "summary" }));
  expect(group?.open).toBe(false);
  let settle: ((response: Response) => void) | undefined;
  result = () =>
    new Promise<Response>((resolve) => {
      settle = resolve;
    });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(screen.getByRole("table").textContent).toContain("2026년 12월");
  expect(group?.open).toBe(false);
  await act(async () => {
    settle?.(json(value));
  });
  expect(screen.getByRole("table").textContent).toContain("2026년 12월");
  expect(group?.open).toBe(false);
});
it("사진 복구 응답의 실패는 멈추되 다음 정기 조회의 새 주소에는 한 번 복구를 허용한다", async () => {
  useRefreshClock();
  mount();
  await act(async () => {});
  const generation = (tag: string) => {
    value = original();
    value.portfolio = value.portfolio.map((p: { imageUrl: string }) => ({
      imageUrl: `${p.imageUrl}&generation=${tag}`,
    }));
    value.priceList.designs = value.priceList.designs.map((d: { imageUrl: string }) => ({
      ...d,
      imageUrl: `${d.imageUrl}&generation=${tag}`,
    }));
  };
  generation("photo");
  await act(async () => {
    fireEvent.error(screen.getAllByRole("img")[0] as HTMLElement);
  });
  expect(calls).toHaveLength(2);
  await act(async () => {
    fireEvent.error(screen.getAllByRole("img")[0] as HTMLElement);
  });
  expect(calls).toHaveLength(2);
  generation("periodic");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(calls).toHaveLength(3);
  generation("second-photo");
  await act(async () => {
    fireEvent.error(screen.getAllByRole("img")[0] as HTMLElement);
  });
  expect(calls).toHaveLength(4);
});
