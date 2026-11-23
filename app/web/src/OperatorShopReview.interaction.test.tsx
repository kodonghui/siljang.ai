// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { OperatorArea } from "./OperatorArea";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const detailPath = "/operator/shops/{shopId}",
  licensePath = `${detailPath}/license-review`,
  changePath = "/operator/identity-changes/{changeId}/review";
const example = (path: string, name: string, status: number | "default" = 200, method = "get") =>
  structuredClone(
    api.paths[path][method].responses[status].content[status === 200 ? "application/json" : "application/problem+json"]
      .examples[name].value,
  );
const shopId = example(detailPath, "pending").shopId;
const operator = example("/operator/me", "operator");
const traceId = "0123456789abcdef0123456789abcdef";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
let current: ReturnType<typeof example>, reads: number;
let readFailure: { status: number; code: string } | null;
let saveFailure: { status: number; code: string } | null;
let sends: { path: string; body: Record<string, unknown>; key: string | null }[];
function Login() {
  const location = useLocation();
  return (
    <main>
      다시 로그인해 주세요 <span>{location.state?.returnTo}</span>
    </main>
  );
}
function mount(id = shopId) {
  return render(
    <MemoryRouter initialEntries={[`/operator/shops/${id}`]}>
      <Routes>
        <Route path="/operator/shops/:shopId" element={<OperatorArea />} />
        <Route path="/operator/shops" element={<main>영업 신고 확인 목록으로 돌아왔어요</main>} />
        <Route path="/operator/login" element={<Login />} />
      </Routes>
    </MemoryRouter>,
  );
}
const main = () => within(screen.getByRole("main"));
const loaded = () => screen.findByText("영업 신고 번호");
const reason = () => screen.getByLabelText("보류 사유");
const confirm = async (label: string) =>
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: label }));
beforeEach(() => {
  current = example(detailPath, "pending");
  reads = 0;
  sends = [];
  readFailure = saveFailure = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (url === "/api/operator/me") return json(operator);
      if (url === `/api/operator/shops/${shopId}`) {
        reads++;
        return readFailure ? json({ ...readFailure, traceId }, readFailure.status) : json(current);
      }
      const body = JSON.parse(String(init.body));
      sends.push({ path: url, body, key: new Headers(init.headers).get("Idempotency-Key") });
      if (saveFailure && sends.length === 1) {
        if (saveFailure.code === "version_conflict") current.revision = "synthetic-latest";
        return json({ ...saveFailure, traceId }, saveFailure.status);
      }
      const identity = url.includes("identity-changes");
      const result = example(
        identity ? changePath : licensePath,
        body.decision === "on_hold" ? "on_hold" : identity ? "applied" : "verified",
        200,
        "post",
      );
      if (identity) {
        current.pendingIdentityChange = null;
        if (body.decision === "applied") current.businessName = result.change.businessName;
      } else current = result.shop;
      return json(result);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const node of document.querySelectorAll("[data-announcer]")) node.remove();
});

it("등록 정보와 부분 계좌만 보여 주고 기록 화면으로 연결한다", async () => {
  mount();
  await loaded();
  for (const text of [
    current.businessName,
    current.representativeName,
    current.contactPhone,
    current.businessAddress,
    current.contactEmail,
    current.foodLicenseNo,
    current.paymentAccount.accountLast4,
  ])
    expect(screen.getByRole("main").textContent).toContain(text);
  expect(main().getByRole("link", { name: "가게 기록 보기" }).getAttribute("href")).toBe(
    `/operator/shops/${shopId}/records`,
  );
  expect(main().getByText("예금주가 대표자와 같아요")).toBeTruthy();
});
it("확인됨은 확인 창에서 돌아가면 쓰지 않고 실제 확인은 한 번만 보낸다", async () => {
  mount();
  await loaded();
  fireEvent.click(main().getByRole("button", { name: "확인됨" }));
  await confirm("돌아가기");
  expect(sends).toHaveLength(0);
  fireEvent.click(main().getByRole("button", { name: "확인됨" }));
  const button = within(await screen.findByRole("dialog")).getByRole("button", { name: "확인됨으로 남기기" });
  fireEvent.click(button);
  fireEvent.click(button);
  await main().findByText("확인됨으로 남겼어요");
  expect(sends).toHaveLength(1);
  expect(sends[0]?.body).toEqual({ baseRevision: "4841fd716c98", decision: "verified" });
  expect(main().queryByRole("button", { name: "보류" })).toBeNull();
});
it("보류 사유는 빈 값과200자 초과를 막고 원문과 남은 글자 수를 보존한다", async () => {
  mount();
  await loaded();
  fireEvent.click(main().getByRole("button", { name: "보류" }));
  fireEvent.click(main().getByRole("button", { name: "보류로 남기기" }));
  expect(sends).toHaveLength(0);
  expect(document.activeElement).toBe(reason());
  fireEvent.change(reason(), { target: { value: "가".repeat(201) } });
  fireEvent.click(main().getByRole("button", { name: "보류로 남기기" }));
  expect(sends).toHaveLength(0);
  fireEvent.change(reason(), { target: { value: " 합성 보류 이유 " } });
  expect(main().getByText(/남은 글자/)).toBeTruthy();
  fireEvent.click(main().getByRole("button", { name: "보류로 남기기" }));
  await main().findByText("보류로 남겼어요. 사장님께 사유를 알렸어요");
  expect(sends[0]?.body.holdReason).toBe(" 합성 보류 이유 ");
});
it("계좌가 없으면 확인됨만 막고 보류는 남길 수 있다", async () => {
  current = example(detailPath, "no_account");
  mount();
  await loaded();
  expect(main().getByText("결제 계좌 등록을 기다리고 있어요. 사장님이 계좌를 등록하면 확인할 수 있어요")).toBeTruthy();
  expect((main().getByRole("button", { name: "확인됨" }) as HTMLButtonElement).disabled).toBe(true);
  expect((main().getByRole("button", { name: "보류" }) as HTMLButtonElement).disabled).toBe(false);
});
it("예금주가 다르다는 안내는 확인 액션을 막지 않는다", async () => {
  current = example(detailPath, "holder_different");
  mount();
  await loaded();
  expect(main().getByText("예금주가 대표자·상호와 달라요")).toBeTruthy();
  expect(main().getByText("사장님이 가게 명의가 맞다고 답함")).toBeTruthy();
  expect((main().getByRole("button", { name: "확인됨" }) as HTMLButtonElement).disabled).toBe(false);
});
it("변경 요청이 있으면 먼저 반영하고 최신 가게를 다시 읽는다", async () => {
  current = example(detailPath, "identity_change_pending");
  mount();
  await loaded();
  expect((main().getByRole("button", { name: "확인됨" }) as HTMLButtonElement).disabled).toBe(true);
  const change = main().getByRole("region", { name: "사업자 정보 변경 요청" });
  expect(change.textContent).toContain(current.pendingIdentityChange.businessName);
  fireEvent.click(within(change).getByRole("button", { name: "반영" }));
  await confirm("반영하기");
  await main().findByText("반영했어요. 사장님께 알렸어요");
  await waitFor(() => expect(reads).toBe(2));
  expect(main().queryByRole("region", { name: "사업자 정보 변경 요청" })).toBeNull();
});
it("이미 확인된 가게는 판정자·시각을 보이고 확인/보류 버튼을 없앤다", async () => {
  current = example(licensePath, "verified", 200, "post").shop;
  mount();
  await loaded();
  expect(screen.getByRole("main").textContent).toContain("확인됨");
  expect(screen.getByRole("main").textContent).toContain(current.licenseReviewedBy.displayName);
  expect(main().queryByRole("button", { name: "확인됨" })).toBeNull();
  expect(main().queryByRole("button", { name: "보류" })).toBeNull();
});
it("401이면 상세와 사진을 남기지 않고 원래 주소와 함께 로그인으로 보낸다", async () => {
  readFailure = { status: 401, code: "unauthenticated" };
  mount();
  await screen.findByText(`/operator/shops/${shopId}`);
  expect(document.body.textContent).not.toContain(current.businessName);
  expect(document.querySelector("img")).toBeNull();
});
it("상세500은 추적 ID와 다시 읽기를 제공하고404는 목록으로 보낸다", async () => {
  readFailure = { status: 500, code: "internal" };
  mount();
  await waitFor(() =>
    expect(within(screen.getByRole("main")).getByText("문제가 생겼어요. 다시 시도해 주세요")).toBeTruthy(),
  );
  expect(screen.getByRole("main").textContent).toContain(traceId);
  readFailure = { status: 404, code: "not_found" };
  fireEvent.click(main().getByRole("button", { name: "다시 시도" }));
  await main().findByText("찾을 수 없어요");
  fireEvent.click(main().getByRole("link", { name: "영업 신고 확인 목록으로" }));
  await screen.findByText("영업 신고 확인 목록으로 돌아왔어요");
});
it("판정500은 같은 본문과 키로 재시도한다", async () => {
  saveFailure = { status: 500, code: "internal" };
  mount();
  await loaded();
  fireEvent.click(main().getByRole("button", { name: "확인됨" }));
  await confirm("확인됨으로 남기기");
  fireEvent.click(await main().findByRole("button", { name: "다시 시도" }));
  await main().findByText("확인됨으로 남겼어요");
  expect(sends[1]?.key).toBe(sends[0]?.key);
  expect(sends[1]?.body).toEqual(sends[0]?.body);
});
it("동시 변경 뒤 최신 버전을 다시 읽어도 보류 이유를 버리지 않는다", async () => {
  saveFailure = { status: 409, code: "version_conflict" };
  mount();
  await loaded();
  fireEvent.click(main().getByRole("button", { name: "보류" }));
  fireEvent.change(reason(), { target: { value: "남길 합성 이유" } });
  fireEvent.click(main().getByRole("button", { name: "보류로 남기기" }));
  await waitFor(() => expect(reads).toBe(2));
  expect((reason() as HTMLTextAreaElement).value).toBe("남길 합성 이유");
  fireEvent.click(main().getByRole("button", { name: "보류로 남기기" }));
  await main().findByText("보류로 남겼어요. 사장님께 사유를 알렸어요");
  expect(sends[1]?.body.baseRevision).toBe("synthetic-latest");
  expect(sends[1]?.key).not.toBe(sends[0]?.key);
});
