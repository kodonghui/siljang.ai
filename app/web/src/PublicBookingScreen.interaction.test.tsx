// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  await vi.waitFor(() => expect(screen.getByText("사진을 불러오지 못했어요")).toBeTruthy());
  expect(calls).toHaveLength(2);
});
