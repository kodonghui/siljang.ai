// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { OperatorArea } from "./OperatorArea";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const value = (path: string, name: string, status: number | "default" = 200, method = "get") =>
  structuredClone(
    api.paths[path][method].responses[status].content[status === 200 ? "application/json" : "application/problem+json"]
      .examples[name].value,
  );
const identity = value("/operator/me", "operator");
const shops = () => value("/operator/shops", "pending");
const changes = () => value("/operator/identity-changes", "pending");
const json = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status });
const problem = (status = 500) =>
  value("/operator/shops", status === 401 ? "unauthenticated" : "internal", status === 500 ? "default" : status);
function Login() {
  const location = useLocation();
  return (
    <main>
      다시 로그인해 주세요 <span>{location.state?.returnTo}</span>
    </main>
  );
}
function Detail() {
  const navigate = useNavigate();
  return (
    <main>
      <button type="button" onClick={() => navigate(-1)}>
        목록으로 돌아가기
      </button>
    </main>
  );
}
function mount(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/operator/shops${search}`]}>
      <Routes>
        <Route path="/operator/shops" element={<OperatorArea />} />
        <Route path="/operator/shops/:shopId" element={<Detail />} />
        <Route path="/operator/login" element={<Login />} />
      </Routes>
    </MemoryRouter>,
  );
}
function transport(list: (path: URL, init: RequestInit) => Response | Promise<Response>) {
  const fetch = vi.fn((url: string, init: RequestInit) => {
    const path = new URL(url, "https://example.org");
    return path.pathname === "/api/operator/me" ? Promise.resolve(json(identity)) : Promise.resolve(list(path, init));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("운영자 인증이 끝나기 전에는 목록 요청과 운영자 기록이 없다", async () => {
  let resolveMe!: (response: Response) => void;
  const fetch = vi.fn((url: string) =>
    url.endsWith("/me")
      ? new Promise<Response>((resolve) => {
          resolveMe = resolve;
        })
      : Promise.resolve(json(shops())),
  );
  vi.stubGlobal("fetch", fetch);
  mount();
  expect(screen.getByText("로그인 상태를 확인하고 있어요")).toBeTruthy();
  expect(document.body.textContent).not.toContain(shops().items[0].name);
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => resolveMe(json(identity)));
  expect(await screen.findByRole("table", { name: "영업 신고 확인 목록" })).toBeTruthy();
});
it("상세 경로와 가게 등록 정보만 보여 주고 기준 시각을 새로 읽는다", async () => {
  const row = shops().items[0];
  const fetch = transport(() => json(shops()));
  mount();
  const table = await screen.findByRole("table", { name: "영업 신고 확인 목록" });
  expect(within(table).getByRole("link", { name: row.name }).getAttribute("href")).toBe(
    `/operator/shops/${row.shopId}`,
  );
  for (const text of [row.businessName, row.representativeName, row.businessRegNo, row.foodLicenseNo])
    expect(table.textContent).toContain(text);
  expect(screen.getByText(/\d{2}:\d{2} 기준/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "새로 고침" }));
  await screen.findByRole("table");
  expect(fetch.mock.calls.filter(([url]) => url.includes("/shops?"))).toHaveLength(2);
});
it("상태 탭은 URL과 서버 필터를 함께 바꾸고 이전 목록은 숨긴다", async () => {
  const fetch = transport(() => json({ items: [], nextCursor: null }));
  mount();
  await screen.findByText("확인할 가게가 없어요");
  fireEvent.click(screen.getByRole("link", { name: "보류" }));
  await screen.findByText("보류한 가게가 없어요");
  expect(fetch.mock.calls.some(([url]) => url.includes("status=on_hold"))).toBe(true);
});
it("더 보기 실패는 기존 행을 보존하고 같은 커서로 재시도하며 중복 행은 합친다", async () => {
  const first = shops(),
    second = shops();
  first.nextCursor = "synthetic_next";
  const extra = { ...second.items[0], shopId: "11111111-1111-4111-8111-000000000099", name: "다음 합성 가게" };
  second.items = [second.items[0], extra];
  second.nextCursor = null;
  let more = 0;
  const fetch = transport((url) =>
    url.searchParams.has("cursor") ? (++more === 1 ? json(problem(), 500) : json(second)) : json(first),
  );
  mount();
  await screen.findByRole("table");
  fireEvent.click(screen.getByRole("button", { name: "더 보기" }));
  const retry = await screen.findByRole("button", { name: "다시 시도" });
  expect(screen.getByRole("table").textContent).toContain(first.items[0].name);
  fireEvent.click(retry);
  await waitFor(() => expect(screen.getByRole("table").textContent).toContain(extra.name));
  expect(within(screen.getByRole("table")).getAllByRole("link", { name: first.items[0].name })).toHaveLength(1);
  expect(fetch.mock.calls.filter(([url]) => url.includes("cursor=synthetic_next"))).toHaveLength(2);
});
it("추가 조회가 401이면 이미 보이던 기록도 제거하고 원래 주소로 돌아오게 한다", async () => {
  const first = shops();
  first.nextCursor = "synthetic_next";
  transport((url) => (url.searchParams.has("cursor") ? json(problem(401), 401) : json(first)));
  mount("?status=pending");
  await screen.findByRole("table");
  fireEvent.click(screen.getByRole("button", { name: "더 보기" }));
  await screen.findByText("다시 로그인해 주세요");
  expect(document.body.textContent).not.toContain(first.items[0].name);
  await screen.findByText("/operator/shops?status=pending");
  expect(document.body.textContent).not.toContain(identity.displayName);
});
it("변경 요청에는 지금 값과 새 값·계좌 끝 네 자리만 보이고 예금주 불일치는 막지 않는다", async () => {
  const page = changes();
  page.items[0].paymentAccount.accountNumber = "합성 전체 계좌";
  page.items[0].phone = "합성 연락처";
  transport(() => json(page));
  mount("?tab=identity");
  const table = await screen.findByRole("table", { name: "사업자 정보 변경 요청 목록" });
  expect(table.textContent).toContain(page.items[0].previous.businessName);
  expect(table.textContent).toContain(page.items[0].businessName);
  expect(table.textContent).toContain(page.items[0].paymentAccount.accountLast4);
  expect(table.textContent).toContain("예금주가 새 대표자·상호와 달라요");
  expect(
    within(table)
      .getAllByRole("link")
      .every((link) => !link.hasAttribute("aria-disabled")),
  ).toBe(true);
  expect(document.body.textContent).not.toContain("합성 전체 계좌");
  expect(document.body.textContent).not.toContain("합성 연락처");
  expect(document.body.innerHTML).not.toContain(page.items[0].evidencePhotoUrl);
});
it("잘못된 주소는 목록을 부르지 않고 처음부터 볼 수 있다", async () => {
  const fetch = transport(() => json({ items: [], nextCursor: null }));
  mount("?status=unknown");
  await screen.findByText("입력한 내용을 확인해 주세요");
  expect(fetch.mock.calls.every(([url]) => url.endsWith("/me"))).toBe(true);
  fireEvent.click(screen.getByRole("link", { name: "처음부터 보기" }));
  await screen.findByText("확인할 가게가 없어요");
});
it("상세에서 돌아오면 목록을 다시 조회한다", async () => {
  let reads = 0;
  transport(() => json(++reads === 1 ? shops() : { items: [], nextCursor: null }));
  mount();
  const table = await screen.findByRole("table");
  fireEvent.click(within(table).getByRole("link", { name: shops().items[0].name }));
  fireEvent.click(await screen.findByRole("button", { name: "목록으로 돌아가기" }));
  await screen.findByText("확인할 가게가 없어요");
  expect(reads).toBe(2);
});

const contracts = (
  [
    ["/operator/shops", "get"],
    ["/operator/me", "get"],
    ["/operator/session", "delete"],
    ["/operator/identity-changes", "get"],
  ] as const
).flatMap(([path, method]) =>
  Object.entries(api.paths[path][method].responses).flatMap(([code, response]) => {
    const status = code === "default" ? 500 : Number(code);
    const content = (response as { content?: Record<string, { examples: Record<string, { value: unknown }> }> })
      .content;
    return content
      ? Object.entries(Object.values(content)[0]?.examples ?? {}).map(([name, example]) => ({
          path,
          method,
          status,
          name,
          body: example.value,
        }))
      : [{ path, method, status, name: "no_content", body: null }];
  }),
);
it("SCR-047 원본 응답 15행을 빠짐없이 대조한다", () => expect(contracts).toHaveLength(15));

it("추가 조회 중에는 두 번째 요청을 막고 기존 행을 유지한다", async () => {
  const first = shops();
  first.nextCursor = "synthetic_next";
  let complete!: (response: Response) => void;
  const fetch = transport((url) =>
    url.searchParams.has("cursor")
      ? new Promise<Response>((resolve) => {
          complete = resolve;
        })
      : json(first),
  );
  mount();
  await screen.findByRole("table");
  const more = screen.getByRole("button", { name: "더 보기" });
  fireEvent.click(more);
  fireEvent.click(more);
  expect((more as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("table").textContent).toContain(first.items[0].name);
  expect(fetch.mock.calls.filter(([url]) => url.includes("cursor="))).toHaveLength(1);
  await act(async () => complete(json({ items: [], nextCursor: null })));
  expect(screen.queryByRole("button", { name: "더 보기" })).toBeNull();
});
it("bfcache 복귀는 인증 재확인 전 기록을 숨기고 만료되면 목록을 다시 부르지 않는다", async () => {
  let reads = 0,
    complete!: (response: Response) => void;
  const fetch = vi.fn((url: string) => {
    if (url.endsWith("/me"))
      return ++reads === 1
        ? Promise.resolve(json(identity))
        : new Promise<Response>((resolve) => {
            complete = resolve;
          });
    return Promise.resolve(json(shops()));
  });
  vi.stubGlobal("fetch", fetch);
  mount("?status=pending");
  await screen.findByRole("table");
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  fireEvent(window, event);
  expect(document.body.textContent).not.toContain(shops().items[0].name);
  expect(document.body.textContent).not.toContain(identity.displayName);
  await act(async () => complete(json(problem(401), 401)));
  await screen.findByText("/operator/shops?status=pending");
  expect(fetch.mock.calls.filter(([url]) => url.includes("/shops?"))).toHaveLength(1);
});
it("로그아웃은 전송 중 중복을 막고 실패한 뒤 다시 시도할 수 있다", async () => {
  let deletes = 0,
    complete!: (response: Response) => void;
  const fetch = transport((_url, init) =>
    init.method === "DELETE"
      ? ++deletes === 1
        ? new Promise<Response>((resolve) => {
            complete = resolve;
          })
        : json(null, 204)
      : json(shops()),
  );
  mount();
  await screen.findByRole("table");
  const logout = screen.getByRole("button", { name: "로그아웃" });
  fireEvent.click(logout);
  fireEvent.click(logout);
  expect(document.body.textContent).not.toContain(shops().items[0].name);
  expect(deletes).toBe(1);
  await act(async () => complete(json(problem(), 500)));
  fireEvent.click(await screen.findByRole("button", { name: "다시 시도" }));
  await waitFor(() => expect(screen.queryByRole("table")).toBeNull());
  await screen.findByText("다시 로그인해 주세요");
  expect(fetch.mock.calls.filter(([, init]) => init.method === "DELETE")).toHaveLength(2);
});
it("변경 요청 상태를 바꾸면 새 URL 필터로 읽고 해당 빈 문구를 보인다", async () => {
  const fetch = transport(() => json({ items: [], nextCursor: null }));
  mount("?tab=identity");
  await screen.findByText("확인할 변경 요청이 없어요");
  fireEvent.change(screen.getByRole("combobox", { name: "사업자 정보 변경 상태" }), { target: { value: "applied" } });
  await screen.findByText("반영한 변경 요청이 없어요");
  expect(fetch.mock.calls.some(([url]) => url.includes("identity-changes?status=applied"))).toBe(true);
});
it.each(contracts)("SCR-047 응답 $path $status $name", async (row) => {
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const pathname = new URL(url, "https://example.org").pathname.slice(4);
    if (pathname === row.path && (init.method ?? "GET").toLowerCase() === row.method) return json(row.body, row.status);
    if (pathname === "/operator/me") return json(identity);
    return json(shops());
  });
  vi.stubGlobal("fetch", fetch);
  mount(row.path.endsWith("identity-changes") ? "?tab=identity" : "");
  if (row.method === "delete") {
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
  }
  if (row.status === 401 || row.status === 204) {
    await screen.findByText("다시 로그인해 주세요");
    expect(screen.queryByRole("table")).toBeNull();
    expect(document.body.textContent).not.toContain(shops().items[0].name);
  } else if (row.status === 500) {
    await waitFor(() =>
      expect(within(screen.getByRole("main")).getByText("문제가 생겼어요. 다시 시도해 주세요")).toBeTruthy(),
    );
    expect(document.body.textContent).toContain((row.body as { traceId: string }).traceId);
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeTruthy();
  } else if (row.status === 422) {
    expect(await screen.findByText("입력한 내용을 확인해 주세요")).toBeTruthy();
    expect(screen.getByRole("link", { name: "처음부터 보기" })).toBeTruthy();
  } else if (row.name === "empty") {
    expect(
      await screen.findByText(
        row.path.endsWith("identity-changes") ? "확인할 변경 요청이 없어요" : "확인할 가게가 없어요",
      ),
    ).toBeTruthy();
  } else {
    expect(await screen.findByRole("table")).toBeTruthy();
    if (row.path.endsWith("me")) expect(document.body.textContent).toContain(identity.displayName);
  }
});
