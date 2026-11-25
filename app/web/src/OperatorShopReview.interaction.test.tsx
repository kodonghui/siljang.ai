// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
let holdMe: boolean, releaseMe: (response: Response) => void;
let holdRead: boolean, readSignal: AbortSignal | null, nextOutcome: "done" | "unchanged";
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
  holdMe = false;
  holdRead = false;
  readSignal = null;
  nextOutcome = "done";
  reads = 0;
  sends = [];
  readFailure = saveFailure = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (url === "/api/operator/me")
        return holdMe
          ? new Promise<Response>((resolve) => {
              releaseMe = resolve;
            })
          : json(operator);
      if (url === `/api/operator/shops/${shopId}`) {
        reads++;
        readSignal = init.signal ?? null;
        if (holdRead) return new Promise<Response>(() => {});
        return readFailure ? json({ ...readFailure, traceId }, readFailure.status) : json(current);
      }
      const body = JSON.parse(String(init.body));
      sends.push({ path: url, body, key: new Headers(init.headers).get("Idempotency-Key") });
      if (saveFailure && sends.length === 1) {
        if (saveFailure.code === "version_conflict") current.revision = "synthetic-latest";
        if (saveFailure.code === "already_decided") current = example(licensePath, "verified", 200, "post").shop;
        return json({ ...saveFailure, traceId }, saveFailure.status);
      }
      const identity = url.includes("identity-changes");
      const result = example(
        identity ? changePath : licensePath,
        body.decision === "on_hold" ? "on_hold" : identity ? "applied" : "verified",
        200,
        "post",
      );
      result.outcome = nextOutcome;
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

it("같은 사유로 다시 보류하면 확인됨으로 잘못 안내하지 않는다", async () => {
  mount();
  await loaded();
  fireEvent.click(main().getByRole("button", { name: "보류" }));
  fireEvent.change(reason(), { target: { value: "합성 보류 사유" } });
  fireEvent.click(main().getByRole("button", { name: "보류로 남기기" }));
  await main().findByText("보류로 남겼어요. 사장님께 사유를 알렸어요");
  nextOutcome = "unchanged";
  fireEvent.click(main().getByRole("button", { name: "보류" }));
  fireEvent.click(main().getByRole("button", { name: "보류로 남기기" }));
  await main().findByText("이미 같은 사유로 보류된 가게예요");
  expect(main().queryByText("이미 확인된 가게예요")).toBeNull();
});
it("끝나지 않는 상세 읽기 중에도 목록으로 이동하고 이전 요청을 취소한다", async () => {
  holdRead = true;
  mount();
  await waitFor(() => expect(reads).toBe(1));
  expect((screen.getByRole("button", { name: "로그아웃" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("link", { name: "영업 신고 확인" }));
  await screen.findByText("영업 신고 확인 목록으로 돌아왔어요");
  expect(readSignal?.aborted).toBe(true);
});
it("이미 읽은 상세를 다시 읽다가404가 나면 모든 상세와 사진을 숨긴다", async () => {
  mount();
  await loaded();
  const privateValues = [current.contactPhone, current.businessAddress, current.contactEmail];
  readFailure = { status: 404, code: "not_found" };
  fireEvent.click(main().getByRole("button", { name: "새로 고침" }));
  await main().findByText("찾을 수 없어요");
  for (const value of privateValues) expect(screen.getByRole("main").textContent).not.toContain(value);
  expect(document.querySelector("img")).toBeNull();
  expect(main().queryByRole("button", { name: "확인됨" })).toBeNull();
});
it.each(["license", "identity"] as const)("%s 보류 대상이 사라져도 남은 사유의 폼을 닫을 수 있다", async (target) => {
  if (target === "identity") current = example(detailPath, "identity_change_pending");
  saveFailure = { status: 409, code: "already_decided" };
  mount();
  await loaded();
  const scope = target === "identity" ? within(screen.getByRole("region", { name: "사업자 정보 변경 요청" })) : main();
  fireEvent.click(scope.getByRole("button", { name: "보류" }));
  fireEvent.change(reason(), { target: { value: "없어진 대상의 합성 사유" } });
  fireEvent.click(main().getByRole("button", { name: "보류로 남기기" }));
  await waitFor(() => expect(reads).toBe(2));
  await waitFor(() => expect((reason() as HTMLTextAreaElement).readOnly).toBe(true));
  expect((reason() as HTMLTextAreaElement).value).toBe("없어진 대상의 합성 사유");
  fireEvent.click(main().getByRole("button", { name: "보류 폼 닫기" }));
  expect(main().queryByLabelText("보류 사유")).toBeNull();
  expect(sends).toHaveLength(1);
});
it("두 사진의 실패를 각각 안내하고 판정 결과의 새 주소를 받으면 안내를 지운다", async () => {
  current = example(detailPath, "identity_change_pending");
  mount();
  await loaded();
  for (const image of main().getAllByRole("img")) fireEvent.error(image);
  expect(main().getAllByText("사진을 열 수 없어요. 새 주소로 다시 불러와 주세요")).toHaveLength(2);
  const holdButton = main().getAllByRole("button", { name: "보류" }).at(-1);
  if (!holdButton) throw new Error("영업 신고 보류 버튼이 없어요");
  fireEvent.click(holdButton);
  fireEvent.change(reason(), { target: { value: "합성 보류 사유" } });
  fireEvent.click(main().getByRole("button", { name: "보류로 남기기" }));
  await main().findByText("보류로 남겼어요. 사장님께 사유를 알렸어요");
  expect(main().queryByText("사진을 열 수 없어요. 새 주소로 다시 불러와 주세요")).toBeNull();
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
it.each(["holder-different", "no-account"] as const)(
  "사업자 변경의 %s는 안내만 보이고 확인 뒤 반영을 허용한다",
  async (selected) => {
    current = example(detailPath, "identity_change_pending");
    if (selected === "no-account") {
      current.paymentAccount = null;
      current.pendingIdentityChange.paymentAccount = null;
    } else {
      current.paymentAccount = { ...current.paymentAccount, holderName: "다른 합성 예금주", holderMatches: false };
      current.pendingIdentityChange.paymentAccount = {
        ...current.pendingIdentityChange.paymentAccount,
        holderName: "다른 합성 예금주",
        holderMatchesNew: false,
      };
    }
    const change = structuredClone(current.pendingIdentityChange);
    const previousFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await previousFetch(input, init);
        if (String(input).includes("/identity-changes/") && init?.method === "POST") {
          const value = await response.json();
          current.representativeName = value.change.representativeName;
          current.businessRegNo = value.change.businessRegNo;
          return json({ ...value, change: { ...value.change, paymentAccount: change.paymentAccount } });
        }
        return response;
      }),
    );
    mount();
    await loaded();
    const panel = main().getByRole("region", { name: "사업자 정보 변경 요청" });
    expect(
      within(panel).getByText(
        selected === "no-account" ? "등록된 결제 계좌가 없어요" : "예금주가 새 대표자·상호와 달라요",
      ),
    ).toBeTruthy();
    const apply = within(panel).getByRole("button", { name: "반영" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);
    await screen.findByRole("dialog");
    expect(sends).toHaveLength(0);
    await confirm("반영하기");
    await main().findByText("반영했어요. 사장님께 알렸어요");
    await waitFor(() => expect(reads).toBe(2));
    expect(sends).toHaveLength(1);
    expect(sends[0]?.path).toBe(`/api/operator/identity-changes/${change.changeId}/review`);
    expect(sends[0]?.body).toEqual({ baseRevision: change.revision, decision: "applied" });
    expect(sends[0]?.key).toBeTruthy();
    expect(main().queryByRole("region", { name: "사업자 정보 변경 요청" })).toBeNull();
  },
);
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
it("다른 운영자가 확인한 뒤 보류 이유는 보존하되 이전 판정을 다시 보내지 않는다", async () => {
  saveFailure = { status: 409, code: "already_decided" };
  mount();
  await loaded();
  fireEvent.click(main().getByRole("button", { name: "보류" }));
  fireEvent.change(reason(), { target: { value: "남길 합성 이유" } });
  fireEvent.click(main().getByRole("button", { name: "보류로 남기기" }));
  await waitFor(() => expect(reads).toBe(2));
  await waitFor(() =>
    expect((main().getByRole("button", { name: "보류로 남기기" }) as HTMLButtonElement).disabled).toBe(true),
  );
  expect((reason() as HTMLTextAreaElement).value).toBe("남길 합성 이유");
  fireEvent.click(main().getByRole("button", { name: "보류로 남기기" }));
  expect(sends).toHaveLength(1);
});
it("사진 확대 창에서 열기 실패를 복구하면 새 주소로 바꾸고 창 안에 초점을 유지한다", async () => {
  mount();
  await loaded();
  const opener = main().getByRole("button", { name: "신고증 사진 크게 보기" });
  opener.focus();
  fireEvent.click(opener);
  const dialog = await screen.findByRole("dialog");
  const image = within(dialog).getByRole("img");
  fireEvent.error(image);
  const reload = within(dialog).getByRole("button", { name: "사진 다시 불러오기" });
  const next = `${current.licensePhotoUrl}&synthetic_refresh=1`;
  current.licensePhotoUrl = next;
  reload.focus();
  fireEvent.click(reload);
  await waitFor(() => expect(within(dialog).getByRole("img").getAttribute("src")).toBe(next));
  expect(dialog.contains(document.activeElement)).toBe(true);
});
it("사진을 확대/축소하고 닫으면 원래 사진 버튼으로 초점을 돌려준다", async () => {
  mount();
  await loaded();
  const opener = main().getByRole("button", { name: "신고증 사진 크게 보기" });
  opener.focus();
  fireEvent.click(opener);
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "확대" }));
  expect(dialog.classList.contains("operator-photo-dialog--zoomed")).toBe(true);
  fireEvent.click(within(dialog).getByRole("button", { name: "화면에 맞추기" }));
  const close = within(dialog).getByRole("button", { name: "닫기" });
  close.focus();
  fireEvent.click(close);
  await waitFor(() => expect(document.activeElement).toBe(opener));
});
it("중복 가게 더 보기 뒤 새 첫 가게 링크로 초점을 보낸다", async () => {
  current.duplicates = Array.from({ length: 6 }, (_, index) => ({
    shopId: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
    name: `합성 중복 ${index + 1}`,
    licenseStatus: "pending",
  }));
  mount();
  await loaded();
  expect(main().queryByRole("link", { name: "합성 중복 6" })).toBeNull();
  const more = main().getByRole("button", { name: "더 보기" });
  more.focus();
  fireEvent.click(more);
  expect(document.activeElement).toBe(main().getByRole("link", { name: "합성 중복 6" }));
});
it("인증 전에는 상세를 요청하지 않고 운영자 기록을 DOM에 남기지 않는다", async () => {
  holdMe = true;
  mount();
  expect(screen.getByText("로그인 상태를 확인하고 있어요")).toBeTruthy();
  expect(reads).toBe(0);
  expect(document.querySelector("img")).toBeNull();
  expect(document.body.textContent).not.toContain(current.contactPhone);
  expect(document.body.textContent).not.toContain(operator.displayName);
  await act(async () => releaseMe(json(operator)));
  await loaded();
  expect(reads).toBe(1);
});
it("bfcache 재확인 중에는 상세/사진을 숨기고 만료되면 로그인으로 보낸다", async () => {
  mount();
  await loaded();
  holdMe = true;
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  fireEvent(window, event);
  expect(document.body.textContent).not.toContain(current.contactPhone);
  expect(document.body.textContent).not.toContain(operator.displayName);
  expect(document.querySelector("img")).toBeNull();
  await act(async () => releaseMe(json({ code: "unauthenticated", traceId }, 401)));
  await screen.findByText(`/operator/shops/${shopId}`);
  expect(reads).toBe(1);
});
it.each(["license", "identity"] as const)(
  "%s 처리 중은1초 뒤 같은 본문/키로 확인하고 전송 중 로그아웃을 막는다",
  async (target) => {
    if (target === "identity") current = example(detailPath, "identity_change_pending");
    saveFailure = { status: 409, code: "request_in_progress" };
    mount();
    await loaded();
    const scope =
      target === "identity" ? within(screen.getByRole("region", { name: "사업자 정보 변경 요청" })) : main();
    fireEvent.click(scope.getByRole("button", { name: target === "identity" ? "반영" : "확인됨" }));
    await confirm(target === "identity" ? "반영하기" : "확인됨으로 남기기");
    await waitFor(() => expect(sends).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "로그아웃", hidden: true }));
    await main().findByText(target === "identity" ? "반영했어요. 사장님께 알렸어요" : "확인됨으로 남겼어요");
    expect(sends).toHaveLength(2);
    expect(sends[1]?.key).toBe(sends[0]?.key);
    expect(sends[1]?.body).toEqual(sends[0]?.body);
  },
);
it("통신판매업 면제 사유는 두 줄에서 펼치고 접을 수 있다", async () => {
  current.mailOrderRegNo = null;
  current.mailOrderAuthority = null;
  current.mailOrderExemption = "합성 면제 사유 ".repeat(15);
  mount();
  await loaded();
  const more = main().getByRole("button", { name: "면제 사유 더 보기" });
  expect(more.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(more);
  expect(main().getByRole("button", { name: "면제 사유 접기" }).getAttribute("aria-expanded")).toBe("true");
});
