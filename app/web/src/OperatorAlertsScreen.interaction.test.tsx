// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { OperatorArea } from "./OperatorArea";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const responses = api.paths["/operator/alerts"].get.responses;
const value = (status: number | "default", name: string) =>
  structuredClone(
    responses[status].content[status === 200 ? "application/json" : "application/problem+json"].examples[name].value,
  );
const page = () => value(200, "alerts"),
  identity = api.paths["/operator/me"].get.responses[200].content["application/json"].examples.operator.value;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function Login() {
  const location = useLocation();
  return (
    <main>
      다시 로그인해 주세요 <span>{location.state?.returnTo}</span>
    </main>
  );
}
function mount(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/operator/alerts${search}`]}>
      <Routes>
        <Route path="/operator/alerts" element={<OperatorArea />} />
        <Route path="/operator/login" element={<Login />} />
      </Routes>
    </MemoryRouter>,
  );
}
function transport(load: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const fetch = vi.fn(async (url: string, init: RequestInit) =>
    url === "/api/operator/me" ? json(identity) : load(new URL(url, "https://example.org"), init),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const node of document.querySelectorAll("[data-announcer]")) node.remove();
});

it("알림은 종류·가게·천 단위 건수·서울 시각만 최근 순으로 보인다", async () => {
  const data = page();
  data.items[0] = { ...data.items[0], count: 1000000, message: "합성 손님 내용", phone: "합성 연락처" };
  data.items.push({
    ...data.items[0],
    alertId: "11111111-1111-4111-8111-111111111111",
    kind: "privacy_transfer_missing",
    shop: null,
    count: 0,
  });
  transport(() => json(data));
  mount();
  const table = await screen.findByRole("table", { name: "운영자 알림 목록" });
  expect(table.textContent).toContain("AI 실패 반복(5분에 5번)");
  expect(table.textContent).toContain("1,000,000");
  expect(table.textContent).toContain("처리방침 국외 이전 항목 누락");
  expect(table.textContent).toContain("가게 정보 없음");
  expect(table.textContent).toContain(data.items[0].shop.name);
  expect(document.body.textContent).not.toContain("합성 손님 내용");
  expect(document.body.textContent).not.toContain("합성 연락처");
  expect(within(table).queryByRole("link")).toBeNull();
  expect(screen.getByText(/\d{2}:\d{2} 기준/)).toBeTruthy();
});
it("인증 전 알림 조회와 운영자 기록은0이다", async () => {
  let release!: (value: Response) => void;
  const fetch = vi.fn((url: string) =>
    url.endsWith("/me")
      ? new Promise<Response>((resolve) => {
          release = resolve;
        })
      : Promise.resolve(json(page())),
  );
  vi.stubGlobal("fetch", fetch);
  mount();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).not.toContain(page().items[0].shop.name);
  await act(async () => release(json(identity)));
  expect(await screen.findByRole("table")).toBeTruthy();
});
it("추가 실패는 기존 행을 보존하고 같은 커서로 재시도한 뒤 완료 안내에 초점을 보낸다", async () => {
  const first = page();
  first.nextCursor = "synthetic_next";
  const next = page();
  next.items = [
    {
      ...next.items[0],
      alertId: "11111111-1111-4111-8111-111111111111",
      shop: { shopId: "11111111-1111-4111-8111-111111111112", name: "다음 합성 가게" },
    },
  ];
  let more = 0;
  const fetch = transport((url) =>
    url.searchParams.has("cursor")
      ? ++more === 1
        ? json(value("default", "internal"), 500)
        : json(next)
      : json(first),
  );
  mount();
  await screen.findByRole("table");
  const button = screen.getByRole("button", { name: "더 보기" });
  button.focus();
  fireEvent.click(button);
  const retry = await screen.findByRole("button", { name: "다시 시도" });
  expect(screen.getByRole("table").textContent).toContain(first.items[0].shop.name);
  retry.focus();
  fireEvent.click(retry);
  await waitFor(() => expect(screen.getByRole("table").textContent).toContain("다음 합성 가게"));
  expect(fetch.mock.calls.filter(([url]) => url.includes("cursor=synthetic_next"))).toHaveLength(2);
  expect(document.activeElement?.textContent).toContain("알림 1개를 더 불러왔어요");
});
it("새로 고침 실패도 기존 목록과 기준 시각을 보존한다", async () => {
  let reads = 0;
  transport(() => (++reads === 1 ? json(page()) : json(value("default", "internal"), 500)));
  mount();
  const table = await screen.findByRole("table");
  const before = screen.getByText(/기준이에요/).textContent;
  fireEvent.click(screen.getByRole("button", { name: "새로 고침" }));
  await screen.findByRole("button", { name: "다시 시도" });
  expect(screen.getByRole("table")).toBe(table);
  expect(screen.getByText(/기준이에요/).textContent).toBe(before);
});
it("추가 조회401은 보이던 알림을 제거하고 돌아갈 주소를 남긴다", async () => {
  const first = page();
  first.nextCursor = "synthetic_next";
  transport((url) => (url.searchParams.has("cursor") ? json(value(401, "unauthenticated"), 401) : json(first)));
  mount("?limit=20");
  await screen.findByRole("table");
  fireEvent.click(screen.getByRole("button", { name: "더 보기" }));
  await screen.findByText("/operator/alerts?limit=20");
  expect(document.body.textContent).not.toContain(first.items[0].shop.name);
});
it("틀린 페이지 주소는 알림을 부르지 않고 처음부터 볼 수 있다", async () => {
  const fetch = transport(() => json(value(200, "empty")));
  mount("?limit=0");
  await screen.findByText("입력한 내용을 확인해 주세요");
  expect(fetch.mock.calls.every(([url]) => url.endsWith("/me"))).toBe(true);
  fireEvent.click(screen.getByRole("link", { name: "처음부터 보기" }));
  await screen.findByText("운영자 알림이 없어요");
});
const rows = Object.entries(responses).flatMap(([status, response]) =>
  Object.entries(
    Object.values(
      (response as { content: Record<string, { examples: Record<string, { value: unknown }> }> }).content,
    )[0]?.examples ?? {},
  ).map(([name, row]) => ({ status: status === "default" ? 500 : Number(status), name, body: row.value })),
);
it("SCR-049 원본5행을 빠짐없이 대조한다", () => expect(rows).toHaveLength(5));
it.each(rows)("SCR-049 $status $name", async (row) => {
  transport(() => json(row.body, row.status));
  mount();
  if (row.status === 401) {
    await screen.findByText("/operator/alerts");
    expect(screen.queryByRole("table")).toBeNull();
  } else if (row.status === 422) {
    await screen.findByText("입력한 내용을 확인해 주세요");
    expect(screen.getByRole("link", { name: "처음부터 보기" })).toBeTruthy();
  } else if (row.status === 500) {
    await waitFor(() =>
      expect(within(screen.getByRole("main")).getByText("문제가 생겼어요. 다시 시도해 주세요")).toBeTruthy(),
    );
    expect(screen.getByRole("main").textContent).toContain((row.body as { traceId: string }).traceId);
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeTruthy();
  } else if (row.name === "empty") await screen.findByText("운영자 알림이 없어요");
  else expect(await screen.findByRole("table")).toBeTruthy();
});
it("새로 고친 목록에는 지난 추가 완료 안내를 남기지 않는다", async () => {
  const first = page();
  first.nextCursor = "synthetic_next";
  let roots = 0;
  transport((url) =>
    url.searchParams.has("cursor") ? json(page()) : ++roots === 1 ? json(first) : json(value(200, "empty")),
  );
  mount();
  await screen.findByRole("table");
  fireEvent.click(screen.getByRole("button", { name: "더 보기" }));
  await screen.findByText("알림 2개를 더 불러왔어요");
  fireEvent.click(screen.getByRole("button", { name: "새로 고침" }));
  await screen.findByText("운영자 알림이 없어요");
  expect(within(screen.getByRole("main")).queryByText(/더 불러왔어요/)).toBeNull();
});
it("bfcache 인증 재확인 중에는 알림을 숨기고 만료되면 새 조회 없이 이동한다", async () => {
  let me = 0,
    release!: (response: Response) => void;
  const fetch = vi.fn((url: string) =>
    url.endsWith("/me")
      ? ++me === 1
        ? Promise.resolve(json(identity))
        : new Promise<Response>((resolve) => {
            release = resolve;
          })
      : Promise.resolve(json(page())),
  );
  vi.stubGlobal("fetch", fetch);
  mount();
  await screen.findByRole("table");
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  fireEvent(window, event);
  expect(document.body.textContent).not.toContain(page().items[0].shop.name);
  await act(async () => release(json(value(401, "unauthenticated"), 401)));
  await screen.findByText("/operator/alerts");
  expect(fetch.mock.calls.filter(([url]) => url.includes("/alerts?"))).toHaveLength(1);
});
it("추가 조회 중 중복 요청을 막고 사용자가 옮긴 초점은 가져오지 않는다", async () => {
  const first = page();
  first.nextCursor = "synthetic_next";
  let release!: (response: Response) => void;
  const fetch = transport((url) =>
    url.searchParams.has("cursor")
      ? new Promise<Response>((resolve) => {
          release = resolve;
        })
      : json(first),
  );
  mount();
  await screen.findByRole("table");
  const more = screen.getByRole("button", { name: "더 보기" });
  more.focus();
  fireEvent.click(more);
  fireEvent.click(more);
  expect(fetch.mock.calls.filter(([url]) => url.includes("cursor="))).toHaveLength(1);
  const elsewhere = screen.getAllByRole("link", { name: "영업 신고 확인" })[0];
  if (!elsewhere) throw new Error("운영자 메뉴 없음");
  elsewhere.focus();
  await act(async () => release(json(page())));
  expect(document.activeElement).toBe(elsewhere);
});
