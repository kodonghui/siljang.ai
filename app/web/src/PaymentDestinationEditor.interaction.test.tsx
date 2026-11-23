// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { OwnerArea } from "./OwnerArea";
import { PaymentDestinationEditor } from "./PaymentDestinationEditor";
import { ERROR_CODES } from "./problems";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const fixture = () =>
  structuredClone(
    api.paths["/owner/payment-destination"].get.responses[200].content["application/json"].examples.account.value,
  );
const path = "/api/owner/payment-destination";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const traceId = "0123456789abcdef0123456789abcdef";
let current: ReturnType<typeof fixture>, reads: number, sends: { body: Record<string, unknown>; key: string | null }[];
let readProblem: { status: number; code: string } | null,
  saveProblem: { status: number; code: string; errors?: { field: string; code: string }[] } | null;
let empty: boolean, confirm: boolean, unchanged: boolean, inProgress: boolean, holdSave: boolean, holdRead: boolean;
beforeEach(() => {
  current = fixture();
  reads = 0;
  sends = [];
  readProblem = saveProblem = null;
  empty = confirm = unchanged = inProgress = holdSave = holdRead = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      if (String(input) !== path) return json({ code: "not_found", traceId }, 404);
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        sends.push({ body, key: new Headers(init.headers).get("Idempotency-Key") });
        if (holdSave) return new Promise<Response>(() => {});
        if (saveProblem && sends.length === 1) {
          if (saveProblem.code === "version_conflict")
            current = {
              ...current,
              bankName: "다른 합성 은행",
              cardPaymentUrl: "https://pay.example.test/remote",
              revision: "synthetic-payment-v2",
            };
          return json({ ...saveProblem, traceId }, saveProblem.status);
        }
        if (inProgress && sends.length === 1) return json({ code: "request_in_progress", traceId }, 409);
        if (confirm && !body.confirm?.includes("holder_mismatch"))
          return json({ code: "confirmation_required", confirm: [{ kind: "holder_mismatch" }], traceId }, 409);
        if (unchanged) return json({ outcome: "unchanged", paymentDestination: current });
        current = {
          ...current,
          ...body,
          holderMismatchConfirmed: body.confirm?.includes("holder_mismatch") ? true : null,
          createdAt: "2026-11-23T16:00:00Z",
          revision: "synthetic-payment-saved",
        };
        return json({ outcome: "created", paymentDestination: current });
      }
      reads++;
      if (holdRead) return new Promise<Response>(() => {});
      if (readProblem) return json({ ...readProblem, traceId }, readProblem.status);
      if (empty) return json({ code: "not_set", traceId }, 404);
      return json(current);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const node of document.querySelectorAll("[data-announcer]")) node.remove();
});
function area(
  extra: {
    sessionChecking?: boolean;
    sessionFailed?: boolean;
    licenseStatus?: "pending" | "verified" | "on_hold";
  } = {},
) {
  const props = {
    shopName: "합성 결제 가게",
    onNavigate: vi.fn(),
    onSessionExpired: vi.fn(),
    onRegisterShop: vi.fn(),
    onLogout: vi.fn(),
    onSaved: vi.fn(),
    ...extra,
  };
  return { ...render(<PaymentDestinationEditor {...props} />), props };
}
const account = () => screen.getByLabelText("계좌번호") as HTMLInputElement;
const loaded = () => screen.findByLabelText("계좌번호");
const save = () => fireEvent.click(screen.getByRole("button", { name: /^저장$/ }));
it("결제 수단 필드의 첫 초점이 실패해도 같은 화면 반영에서 복구한다", async () => {
  area();
  await loaded();
  const target = screen.getByLabelText("은행");
  fireEvent.change(target, { target: { value: "" } });
  screen.getByRole("button", { name: /^저장$/ }).focus();
  const original = HTMLElement.prototype.focus;
  let calls = 0;
  vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
    if (this === target && ++calls === 1) {
      expect(document.activeElement).not.toBe(target);
      return;
    }
    original.call(this, options);
  });
  save();
  expect(calls).toBe(2);
  expect(document.activeElement).toBe(target);
});
it("두 번 실패한 결제 초점은 끝내고 다음 입력의 초점을 가져오지 않는다", async () => {
  const view = area();
  await loaded();
  const target = screen.getByLabelText("은행");
  fireEvent.change(target, { target: { value: "" } });
  screen.getByRole("button", { name: /^저장$/ }).focus();
  const original = HTMLElement.prototype.focus;
  let calls = 0;
  vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
    if (this === target && ++calls <= 2) return;
    original.call(this, options);
  });
  save();
  expect(calls).toBe(2);
  const other = account();
  other.focus();
  fireEvent.change(other, { target: { value: "000000000000" } });
  view.rerender(<PaymentDestinationEditor {...view.props} shopName="다시 그린 합성 가게" />);
  expect(document.activeElement).toBe(other);
  expect(calls).toBe(2);
});
it.each(["holder", "status"] as const)("결제 %s 서버 오류도 첫 초점 실패 뒤 복구한다", async (kind) => {
  saveProblem =
    kind === "holder"
      ? { status: 409, code: "holder_not_verified" }
      : {
          status: 422,
          code: "validation_failed",
          errors: [{ field: "/unknown", code: "not_allowed" }],
        };
  area();
  await loaded();
  const target =
    kind === "holder" ? screen.getByLabelText("예금주") : screen.getByRole("region", { name: "결제 수단 저장 결과" });
  screen.getByRole("button", { name: /^저장$/ }).focus();
  const original = HTMLElement.prototype.focus;
  let calls = 0;
  vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
    if (this === target && ++calls === 1) {
      expect(document.activeElement).not.toBe(target);
      return;
    }
    original.call(this, options);
  });
  save();
  await waitFor(() => expect(sends).toHaveLength(1));
  await waitFor(() => expect(calls).toBe(2));
  expect(document.activeElement).toBe(target);
});
it("현재 결제 계좌를 읽고 바꾼 계좌만 새 버전으로 저장한다", async () => {
  const view = area();
  await loaded();
  expect(account().value).toBe(fixture().accountNumber);
  fireEvent.change(account(), { target: { value: "000000-00-000000" } });
  save();
  await within(screen.getByRole("main")).findByText("저장했어요. 이제부터 나가는 결제 안내에 이 계좌를 써요");
  expect(sends[0]?.body).toMatchObject({
    baseRevision: fixture().revision,
    accountNumber: "000000-00-000000",
    cardPaymentUrl: null,
  });
  expect(view.props.onSaved).not.toHaveBeenCalled();
});
it("미등록은 빈 필드를 보여 주고 필수 오류 뒤 첫 계좌를 저장한다", async () => {
  empty = true;
  area();
  await loaded();
  expect(account().value).toBe("");
  save();
  expect(sends).toHaveLength(0);
  expect(document.activeElement).toBe(screen.getByLabelText("은행"));
  fireEvent.change(screen.getByLabelText("은행"), { target: { value: "합성 은행" } });
  fireEvent.change(account(), { target: { value: "000000000000" } });
  fireEvent.change(screen.getByLabelText("예금주"), { target: { value: "합성 예금주" } });
  save();
  await within(screen.getByRole("main")).findByText("저장했어요. 이제부터 나가는 결제 안내에 이 계좌를 써요");
  expect(sends[0]?.body.baseRevision).toBeNull();
});
it("예금주 불일치는 돌아가기 뒤 입력을 보존하고 새 키/확인 값으로만 저장한다", async () => {
  confirm = true;
  area();
  await loaded();
  fireEvent.change(screen.getByLabelText("예금주"), { target: { value: "다른 합성 예금주" } });
  save();
  const dialog = await screen.findByRole("dialog", { name: "저장하기 전에 확인해 주세요" });
  expect(dialog.textContent).toContain("예금주가 상호·대표자와 달라요");
  fireEvent.click(within(dialog).getByRole("button", { name: "돌아가기" }));
  expect((screen.getByLabelText("예금주") as HTMLInputElement).value).toBe("다른 합성 예금주");
  expect(sends).toHaveLength(1);
  save();
  const again = await screen.findByRole("dialog", { name: "저장하기 전에 확인해 주세요" });
  fireEvent.click(within(again).getByRole("button", { name: "가게 명의가 맞아요" }));
  await within(screen.getByRole("main")).findByText("저장했어요. 이제부터 나가는 결제 안내에 이 계좌를 써요");
  await within(screen.getByRole("main")).findByText("상호·대표자와 다른 가게 명의 계좌임을 확인했어요");
  expect(sends[2]?.body.confirm).toEqual(["holder_mismatch"]);
  expect(sends[2]?.key).not.toBe(sends[1]?.key);
});
it("확인된 예금주 제한은 서버 오류 배열이 없어도 해당 입력 옆에서 알려 준다", async () => {
  saveProblem = { status: 409, code: "holder_not_verified" };
  area();
  await loaded();
  save();
  const holder = screen.getByLabelText("예금주");
  const field = holder.closest("[data-pointer]");
  if (!field) throw new Error("예금주 필드 없음");
  await within(field as HTMLElement).findByText(
    "확인된 예금주와 다른 계좌로는 바꿀 수 없어요. 우리 서비스 채널로 문의해 주세요",
  );
  expect(document.activeElement).toBe(holder);
  expect(sends).toHaveLength(1);
});
it("충돌은 내 계좌를 보존하고 다른 기기의 은행/링크 위에 다시 적용한다", async () => {
  saveProblem = { status: 409, code: "version_conflict" };
  area();
  await loaded();
  fireEvent.change(account(), { target: { value: "111111111111" } });
  save();
  fireEvent.click(await screen.findByRole("button", { name: "내 변경 다시 적용" }));
  save();
  await within(screen.getByRole("main")).findByText("저장했어요. 이제부터 나가는 결제 안내에 이 계좌를 써요");
  expect(sends[1]?.body).toMatchObject({
    baseRevision: "synthetic-payment-v2",
    bankName: "다른 합성 은행",
    accountNumber: "111111111111",
    cardPaymentUrl: "https://pay.example.test/remote",
  });
  expect(sends[1]?.key).not.toBe(sends[0]?.key);
});
it.each([
  { status: 401, code: "unauthenticated", callback: "onSessionExpired" },
  { status: 404, code: "shop_not_registered", callback: "onRegisterShop" },
] as const)("조회 $code는 권한 경로로 보낸다", async (p) => {
  readProblem = p;
  const view = area();
  await waitFor(() => expect(view.props[p.callback]).toHaveBeenCalledOnce());
});
it.each([
  { status: 401, code: "unauthenticated", callback: "onSessionExpired" },
  { status: 404, code: "shop_not_registered", callback: "onRegisterShop" },
] as const)("저장 $code도 권한 경로로 보낸다", async (p) => {
  saveProblem = p;
  const view = area();
  await loaded();
  save();
  await waitFor(() => expect(view.props[p.callback]).toHaveBeenCalledOnce());
});
it("조회 서버 실패는 추적 ID와 재조회 뒤 양식을 연다", async () => {
  readProblem = { status: 500, code: "internal" };
  area();
  await within(screen.getByRole("main")).findByText(`추적 ID: ${traceId}`);
  readProblem = null;
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await loaded();
  expect(reads).toBe(2);
});
it("저장 서버 실패는 원문을 남기고 같은 키로만 재시도한다", async () => {
  saveProblem = { status: 500, code: "internal" };
  area();
  await loaded();
  fireEvent.change(account(), { target: { value: "111111111111" } });
  save();
  await within(screen.getByRole("main")).findByText(`추적 ID: ${traceId}`);
  expect(account().value).toBe("111111111111");
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await within(screen.getByRole("main")).findByText("저장했어요. 이제부터 나가는 결제 안내에 이 계좌를 써요");
  expect(sends[1]?.key).toBe(sends[0]?.key);
});
it("요청 키 재사용은 같은 본문과 새 키로 재시도한다", async () => {
  saveProblem = { status: 422, code: "idempotency_key_reused" };
  area();
  await loaded();
  save();
  fireEvent.click(await screen.findByRole("button", { name: "다시 시도" }));
  await within(screen.getByRole("main")).findByText("저장했어요. 이제부터 나가는 결제 안내에 이 계좌를 써요");
  expect(sends[1]?.body).toEqual(sends[0]?.body);
  expect(sends[1]?.key).not.toBe(sends[0]?.key);
});
it("처리 중409는 같은 본문과 키로 한 번 이어서 저장한다", async () => {
  inProgress = true;
  area();
  await loaded();
  save();
  await within(screen.getByRole("main")).findByText(
    "저장했어요. 이제부터 나가는 결제 안내에 이 계좌를 써요",
    {},
    { timeout: 3000 },
  );
  expect(sends).toHaveLength(2);
  expect(sends[1]).toEqual(sends[0]);
});
it("변경 없는 저장은 재확인 알림과 영업 신고 변경을 만들지 않는다", async () => {
  unchanged = true;
  const view = area({ licenseStatus: "on_hold" });
  await loaded();
  save();
  await within(screen.getByRole("main")).findByText("바뀐 것이 없어요");
  expect(view.props.onSaved).not.toHaveBeenCalled();
});
it("보류 가게가 계좌를 바꾸면 재확인 안내와 가게 상태 재조회를 요청한다", async () => {
  const view = area({ licenseStatus: "on_hold" });
  await loaded();
  fireEvent.change(account(), { target: { value: "111111111111" } });
  save();
  await within(screen.getByRole("main")).findByText("영업 신고를 다시 확인하고 있어요");
  expect(view.props.onSaved).toHaveBeenCalledOnce();
});
it("세션 실패는 입력/확인 전송을 잠그되 로그아웃을 허용한다", async () => {
  confirm = true;
  const view = area();
  await loaded();
  save();
  await screen.findByRole("dialog", { name: "저장하기 전에 확인해 주세요" });
  view.rerender(<PaymentDestinationEditor {...view.props} sessionFailed />);
  expect((screen.getByRole("button", { name: "가게 명의가 맞아요" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "돌아가기" }));
  fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
  expect(view.props.onLogout).toHaveBeenCalledOnce();
  expect(sends).toHaveLength(1);
});
it("저장 처리 중에는 입력과 다른 액션을 잠근다", async () => {
  holdSave = true;
  area();
  await loaded();
  save();
  await waitFor(() => expect(sends).toHaveLength(1));
  expect(account().disabled).toBe(true);
  expect((screen.getByRole("button", { name: "로그아웃" }) as HTMLButtonElement).disabled).toBe(true);
});
it.each(["pending", "verified", "on_hold"] as const)("실제 결제 수단 경로는 %s 가게의 계좌를 연다", async (status) => {
  const transport = fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === "/api/owner/me"
        ? json({
            owner: {
              ownerId: "00000000-0000-4000-8000-000000000053",
              alertChannelFriend: false,
              createdAt: "2026-11-23T12:00:00Z",
            },
            shop: { shopId: "00000000-0000-4000-8000-000000000054", name: "합성 결제 가게", licenseStatus: status },
          })
        : transport(input, init),
    ),
  );
  render(
    <MemoryRouter initialEntries={["/owner/payment-destination"]}>
      <Routes>
        <Route path="/owner/*" element={<OwnerArea />} />
      </Routes>
    </MemoryRouter>,
  );
  await loaded();
  expect(reads).toBe(1);
});

it.each(["checking", "failed"] as const)("처음 세션 %s에는 조회하지 않고 회복하면 한 번만 읽는다", async (state) => {
  const view = area(state === "checking" ? { sessionChecking: true } : { sessionFailed: true });
  await Promise.resolve();
  expect(reads).toBe(0);
  view.rerender(<PaymentDestinationEditor {...view.props} sessionChecking={false} sessionFailed={false} />);
  await loaded();
  expect(reads).toBe(1);
});
it("저장 필드 오류는 계좌와 카드 링크 옆에 붙고 원문을 남긴다", async () => {
  saveProblem = {
    status: 422,
    code: "validation_failed",
    errors: [
      { field: "/accountNumber", code: "bad_format" },
      { field: "/cardPaymentUrl", code: "bad_format" },
    ],
  };
  area();
  await loaded();
  fireEvent.change(account(), { target: { value: "111111111111" } });
  fireEvent.change(screen.getByLabelText("카드 결제 링크(선택)"), {
    target: { value: "https://pay.example.test/mine" },
  });
  save();
  await waitFor(() => expect(account().getAttribute("aria-invalid")).toBe("true"));
  expect(screen.getByLabelText("카드 결제 링크(선택)").getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(account());
  expect(account().value).toBe("111111111111");
});
it("계좌와 카드 링크의 잘못된 입력은 전송하지 않는다", async () => {
  area();
  await loaded();
  fireEvent.change(account(), { target: { value: "１２３４５６７８９０" } });
  fireEvent.change(screen.getByLabelText("카드 결제 링크(선택)"), {
    target: { value: "http://pay.example.test/unsafe" },
  });
  save();
  expect(sends).toHaveLength(0);
  expect(account().value).toBe("１２３４５６７８９０");
  expect(document.activeElement).toBe(account());
});

it("조회 실패에도 뒤로와 메뉴를 잠그지 않고 가게 설정으로 돌아간다", async () => {
  readProblem = { status: 500, code: "internal" };
  const view = area();
  await within(screen.getByRole("main")).findByText(`추적 ID: ${traceId}`);
  const back = screen.getAllByRole("link").find((link) => link.getAttribute("href") === "/owner/shop");
  if (!back) throw new Error("뒤로 링크 없음");
  fireEvent.click(back);
  expect(view.props.onNavigate).toHaveBeenCalledWith("/owner/shop");
});
it("첫 세션 확인 중에는 내용을 가린 조회 골격을 보인다", () => {
  area({ sessionChecking: true });
  expect(screen.getByText("결제 수단을 불러오고 있어요")).toBeTruthy();
  expect(reads).toBe(0);
});

it("429 뒤 입력을 바꿔도 저장 대기는 유지하고 옛 계좌를 자동으로 다시 보내지 않는다", async () => {
  saveProblem = { status: 429, code: "rate_limited" };
  area();
  await loaded();
  const button = screen.getByRole("button", { name: /^저장$/ }) as HTMLButtonElement;
  save();
  await within(screen.getByRole("main")).findByText(ERROR_CODES.rate_limited.message);
  expect(button.disabled).toBe(true);
  fireEvent.change(account(), { target: { value: "111111111111" } });
  expect(account().value).toBe("111111111111");
  expect(button.disabled).toBe(true);
  save();
  expect(sends).toHaveLength(1);
  await waitFor(() => expect(button.disabled).toBe(false), { timeout: 3000 });
  expect(sends).toHaveLength(1);
  save();
  await within(screen.getByRole("main")).findByText("저장했어요. 이제부터 나가는 결제 안내에 이 계좌를 써요");
  expect(sends[1]?.body.accountNumber).toBe("111111111111");
  expect(sends[1]?.key).not.toBe(sends[0]?.key);
});
it("카드 링크 도움말과 길이 초과 사유가 코드 포인트 한도를 알린다", async () => {
  area();
  await loaded();
  const link = screen.getByLabelText("카드 결제 링크(선택)") as HTMLInputElement;
  fireEvent.change(link, { target: { value: `https://pay.example.test/${"a".repeat(2048)}` } });
  const field = link.closest("[data-pointer]");
  if (!field) throw new Error("카드 링크 필드 없음");
  expect(field.textContent).toContain("https 주소를 2,048자까지 등록할 수 있어요");
  expect(field.textContent).toContain("글자 수가 너무 많아요");
});
