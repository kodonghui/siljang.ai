// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { PriceListEditor } from "./PriceListEditor";

const contract = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const fixture = () =>
  structuredClone(
    contract.paths["/owner/price-list"].get.responses[200].content["application/json"].examples.current.value,
  );
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
const traceId = "0123456789abcdef0123456789abcdef";
let current: ReturnType<typeof fixture>, empty: boolean, conflict: boolean, failReload: boolean, holdRead: boolean;
let reads: number, sends: { body: Record<string, unknown>; key: string | null }[];
beforeEach(() => {
  current = fixture();
  empty = conflict = failReload = holdRead = false;
  reads = 0;
  sends = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      if (String(input) === "/api/owner/price-list") {
        reads++;
        if (holdRead) return new Promise(() => {});
        if (empty) return json({ code: "not_set", traceId }, 404);
        if (failReload && reads > 1) return json({ code: "internal", traceId }, 500);
        return json(current);
      }
      if (String(input) === "/api/owner/price-list/versions") {
        const body = JSON.parse(String(init?.body));
        sends.push({ body, key: new Headers(init?.headers).get("Idempotency-Key") });
        if (conflict && sends.length === 1) {
          current = {
            ...current,
            version: 5,
            revision: "synthetic-v5",
            options: current.options.map((o: { name: string }) => (o.name === "초코" ? { ...o, amount: 4000 } : o)),
          };
          return json({ code: "version_conflict", traceId }, 409);
        }
        current = {
          ...current,
          version: empty ? 1 : current.version + 1,
          revision: "synthetic-saved",
          options: current.options.map((o: { optionId: string; amount: number }) => ({
            ...o,
            amount: body.options.find((x: { key: string }) => x.key === o.optionId)?.amount ?? o.amount,
          })),
        };
        empty = false;
        return json({ outcome: "created", priceList: current }, 201);
      }
      return json({ code: "not_found", traceId }, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  for (const n of document.querySelectorAll("[data-announcer]")) n.remove();
  vi.unstubAllGlobals();
});
function area(extra = {}) {
  const props = {
    shopName: "합성 가게",
    onNavigate: vi.fn(),
    onSessionExpired: vi.fn(),
    onRegisterShop: vi.fn(),
    onLogout: vi.fn(),
  };
  return { ...render(<PriceListEditor {...props} {...extra} />), props };
}
const main = () => within(screen.getByRole("main"));
const amount = () =>
  within(screen.getByRole("group", { name: "크기 옵션 1" })).getByLabelText("금액") as HTMLInputElement;
it("현재 가격표의 한 셀을 바꾸고 새 버전 저장 뒤 변경 수를 비움", async () => {
  area();
  await main().findByText(/가격표 버전 4/);
  fireEvent.change(amount(), { target: { value: "38000" } });
  expect(main().getByText("저장 전 바뀐 셀 1개")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /^저장$/ }));
  await main().findByText("저장했어요. 가격표 버전 5");
  expect(sends[0]?.body.baseRevision).toBe(fixture().revision);
  expect(main().getByText("저장 전 바뀐 셀 0개")).toBeTruthy();
});
it("미설정이면 첫 옵션을 넣고 기준 버전 null로 저장", async () => {
  empty = true;
  area();
  await main().findByText("첫 가격표를 만들어 주세요");
  fireEvent.click(screen.getByRole("button", { name: "크기 옵션 추가" }));
  const group = within(screen.getByRole("group", { name: "크기 옵션 1" }));
  fireEvent.change(group.getByLabelText("옵션 이름"), { target: { value: "1호" } });
  fireEvent.change(group.getByLabelText("금액"), { target: { value: "35000" } });
  fireEvent.click(screen.getByRole("button", { name: /^저장$/ }));
  await main().findByText("저장했어요. 가격표 버전 1");
  expect(sends[0]?.body.baseRevision).toBeNull();
});
it("충돌 때 입력을 남기고 최신 버전의 다른 변경 위에 내 변경만 적용", async () => {
  conflict = true;
  area();
  await main().findByText(/가격표 버전 4/);
  fireEvent.change(amount(), { target: { value: "38000" } });
  fireEvent.click(screen.getByRole("button", { name: /^저장$/ }));
  await main().findByRole("button", { name: "내 변경 다시 적용" });
  expect(amount().value).toBe("38000");
  expect((screen.getByRole("button", { name: /^저장$/ }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "내 변경 다시 적용" }));
  fireEvent.click(screen.getByRole("button", { name: /^저장$/ }));
  await main().findByText("저장했어요. 가격표 버전 6");
  expect(sends[1]?.body.baseRevision).toBe("synthetic-v5");
  expect(sends[1]?.body.options).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "1호", amount: 38000 }),
      expect.objectContaining({ name: "초코", amount: 4000 }),
    ]),
  );
});
it("충돌 재조회 실패는 이전 값을 잠그고 복구 조회 뒤에도 내 입력을 보존", async () => {
  conflict = failReload = true;
  area();
  await main().findByText(/가격표 버전 4/);
  fireEvent.change(amount(), { target: { value: "38000" } });
  fireEvent.click(screen.getByRole("button", { name: /^저장$/ }));
  await main().findByRole("button", { name: "다시 시도" });
  expect(amount().value).toBe("38000");
  expect((screen.getByRole("button", { name: /^저장$/ }) as HTMLButtonElement).disabled).toBe(true);
  failReload = false;
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await main().findByRole("button", { name: "내 변경 다시 적용" });
  expect(amount().value).toBe("38000");
  expect(reads).toBe(3);
});
it("처음 읽는 중에는 저장을 보낼 수 없음", () => {
  holdRead = true;
  area();
  expect(screen.getByText("가격표를 불러오고 있어요")).toBeTruthy();
  expect((screen.getByRole("button", { name: /^저장$/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(sends).toHaveLength(0);
});
it("세션 재확인 실패는 입력을 보존하고 저장을 잠그되 로그아웃은 허용", async () => {
  const a = area();
  await main().findByText(/가격표 버전 4/);
  fireEvent.change(amount(), { target: { value: "38000" } });
  a.rerender(<PriceListEditor {...a.props} sessionFailed />);
  expect(amount().value).toBe("38000");
  expect(amount().disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: /^저장$/ }));
  expect(sends).toHaveLength(0);
  await waitFor(() =>
    expect((screen.getByRole("button", { name: "로그아웃" }) as HTMLButtonElement).disabled).toBe(false),
  );
});
