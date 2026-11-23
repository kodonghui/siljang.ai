// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { OwnerArea } from "./OwnerArea";
import { ERROR_CODES } from "./problems";
import { ShopLicense } from "./ShopLicense";

const contract = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const fixture = (name = "verified"): Record<string, unknown> =>
  structuredClone(contract.paths["/owner/shop"].get.responses[200].content["application/json"].examples[name].value);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const traceId = "0123456789abcdef0123456789abcdef";
let current: Record<string, unknown>, reads: number, uploads: number;
let requests: { path: string; body: Record<string, unknown>; key: string | null }[];
let getError: [number, string] | null, sendError: [number, string] | null, uploadError: [number, string] | null;
let holdRead: Promise<Response> | null, holdSend: Promise<Response> | null;
let expiredPhoto: boolean;
let latestOnFailure: Record<string, unknown> | null;
let identityUnchanged: boolean;
let holdUpload: Promise<Response> | null;
beforeEach(() => {
  current = fixture();
  reads = uploads = 0;
  requests = [];
  getError = sendError = uploadError = null;
  holdRead = holdSend = null;
  expiredPhoto = false;
  latestOnFailure = null;
  identityUnchanged = false;
  holdUpload = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/owner/me")
        return json({
          owner: {
            ownerId: "00000000-0000-4000-8000-000000000048",
            alertChannelFriend: false,
            createdAt: "2026-11-23T08:00:00Z",
          },
          shop: { shopId: current.shopId, name: current.name, licenseStatus: current.licenseStatus },
        });
      if (path === "/api/owner/uploads") {
        uploads++;
        if (holdUpload) return holdUpload;
        if (uploadError) return json({ code: uploadError[1], traceId }, uploadError[0]);
        return json(
          {
            uploadId: `upl_${"a".repeat(23)}${uploads}`,
            purpose: "license_photo",
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          },
          201,
        );
      }
      if (init?.method !== "PUT" && init?.method !== "POST") {
        reads++;
        if (holdRead) return holdRead;
        return getError ? json({ code: getError[1], traceId }, getError[0]) : json(current);
      }
      const body = JSON.parse(String(init.body));
      requests.push({ path, body, key: new Headers(init.headers).get("Idempotency-Key") });
      if (holdSend) return holdSend;
      if (sendError && requests.length === 1) {
        if (latestOnFailure) current = latestOnFailure;
        return json(
          {
            code: sendError[1],
            traceId,
            ...(sendError[1] === "validation_failed"
              ? {
                  errors: [
                    {
                      field: expiredPhoto
                        ? path.endsWith("/license")
                          ? "/licensePhotoUploadId"
                          : "/evidencePhotoUploadId"
                        : path.endsWith("/license")
                          ? "/foodLicenseNo"
                          : "/businessName",
                      code: expiredPhoto ? "upload_not_found" : "too_long",
                    },
                  ],
                }
              : {}),
          },
          sendError[0],
        );
      }
      if (path.endsWith("/license"))
        current = {
          ...current,
          foodLicenseNo: body.foodLicenseNo,
          foodBusinessType: body.foodBusinessType,
          licenseStatus: "pending",
          licenseHoldReason: null,
          licenseReviewedAt: null,
          revision: "new-license-revision",
        };
      else if (!identityUnchanged)
        current = {
          ...current,
          identityChange: {
            ...(fixture("identity_change_pending").identityChange as object),
            businessName: body.businessName,
            representativeName: body.representativeName,
            businessRegNo: body.businessRegNo,
          },
          revision: "new-identity-revision",
        };
      return json(
        { outcome: !path.endsWith("/license") && identityUnchanged ? "unchanged" : "done", shop: current },
        path.endsWith("/license") || identityUnchanged ? 200 : 201,
      );
    }),
  );
});
afterEach(() => {
  cleanup();
  for (const n of document.querySelectorAll("[data-announcer]")) n.remove();
  vi.unstubAllGlobals();
});
function area(extra = {}) {
  const login = vi.fn(),
    register = vi.fn(),
    navigate = vi.fn(),
    logout = vi.fn();
  const view = render(
    <ShopLicense
      shopName="합성 가게"
      onNavigate={navigate}
      onSessionExpired={login}
      onRegisterShop={register}
      onLogout={logout}
      {...extra}
    />,
  );
  return { ...view, login, register, navigate, logout };
}
async function photo(name: string) {
  const input = screen.getByLabelText(name, { exact: true });
  fireEvent.change(input, {
    target: { files: [new File([new Uint8Array([1, 2, 3])], "synthetic.png", { type: "image/png" })] },
  });
  await within(input.closest("form") ?? screen.getByRole("main")).findByText(
    "사진을 올렸어요. 1시간 안에 저장해 주세요",
  );
}

it.each(["verified", "pending"])("%s 상태와 번호·종류·현재 신원과 확인 시각을 표시", async (name) => {
  current = fixture(name);
  area();
  await within(screen.getByRole("main")).findByText(name === "verified" ? "확인됨" : "확인 중");
  expect(screen.getByText("2026-0123456")).toBeTruthy();
  expect(reads).toBe(1);
  expect(screen.getByText("즉석판매제조·가공업")).toBeTruthy();
  expect(screen.getByRole("region", { name: "사업자 정보" })).toBeTruthy();
  if (name === "verified") expect(document.querySelector("time")?.dateTime).toBe(current.licenseReviewedAt);
  expect(screen.queryByRole("button", { name: "신고증 다시 올리기" })).toBeNull();
});
it("보류를 새 번호·종류·사진으로 다시 올리고 결과/확인 중을 표시", async () => {
  current = fixture("on_hold");
  area();
  await within(screen.getByRole("main")).findByText("보류");
  fireEvent.change(screen.getByLabelText("영업 신고 번호", { exact: true }), { target: { value: "합성-048" } });
  fireEvent.click(screen.getByRole("radio", { name: "제과점영업" }));
  await photo("새 신고증 사진");
  fireEvent.click(screen.getByRole("button", { name: "신고증 다시 올리기" }));
  await within(screen.getByRole("main")).findByText("신고증을 다시 올렸어요. 운영자가 다시 확인해요");
  expect(screen.getByText("확인 중")).toBeTruthy();
  expect(requests[0]?.body).toEqual({
    baseRevision: fixture("on_hold").revision,
    foodLicenseNo: "합성-048",
    foodBusinessType: "bakery",
    licensePhotoUploadId: `upl_${"a".repeat(23)}1`,
  });
});
it("사업자 변경은 확인된 값을 유지하고 새 값·증빙과 함께 요청", async () => {
  area();
  await within(screen.getByRole("main")).findByText("확인됨");
  fireEvent.click(screen.getByRole("button", { name: "변경 요청" }));
  fireEvent.change(screen.getByLabelText("새 상호", { exact: true }), { target: { value: "합성 새 공방" } });
  await photo("증빙 사진");
  fireEvent.click(
    within(screen.getByRole("form", { name: "사업자 정보 변경 요청" })).getByRole("button", {
      name: "변경 요청",
    }),
  );
  await within(screen.getByRole("main")).findByText("변경을 요청했어요. 운영자가 확인하면 바뀌어요");
  expect(screen.getByText("변경 확인 기다림")).toBeTruthy();
  expect(screen.getByText("합성 새 공방")).toBeTruthy();
  expect(requests[0]?.body).toMatchObject({
    businessName: "합성 새 공방",
    representativeName: fixture().representativeName,
    businessRegNo: fixture().businessRegNo,
    evidencePhotoUploadId: `upl_${"a".repeat(23)}1`,
  });
  expect(
    within(screen.getByRole("region", { name: "사업자 정보" })).getByText(String(fixture().businessName)),
  ).toBeTruthy();
});
it.each(["identity_change_pending", "identity_change_on_hold"])(
  "%s의 새 값·시각/이유와 요청 가능 상태를 표시",
  async (name) => {
    current = fixture(name);
    area();
    await within(screen.getByRole("main")).findByText(name.endsWith("pending") ? "변경 확인 기다림" : "변경 요청 보류");
    if (name.endsWith("pending"))
      expect((screen.getByRole("button", { name: "변경 요청" }) as HTMLButtonElement).disabled).toBe(true);
    else expect(screen.getByRole("button", { name: "다시 요청" })).toBeTruthy();
    expect(screen.getByText("달빛케이크 공방")).toBeTruthy();
  },
);
it.each([
  [401, "unauthenticated"],
  [404, "shop_not_registered"],
] as const)("조회 %s는 권한 경로로 보냄", async (status, code) => {
  getError = [status, code];
  const a = area();
  await waitFor(() => expect(status === 401 ? a.login : a.register).toHaveBeenCalledTimes(1));
});
it("조회 중에는 데이터 자리와 모든 액션을 잠금", async () => {
  holdRead = new Promise(() => {});
  area();
  expect(screen.getByText("영업 신고를 불러오고 있어요")).toBeTruthy();
  expect((screen.getByRole("button", { name: "로그아웃" }) as HTMLButtonElement).disabled).toBe(true);
});
it("필드 오류는 값 보존·첫 필드 포커스", async () => {
  current = fixture("on_hold");
  sendError = [422, "validation_failed"];
  area();
  await within(screen.getByRole("main")).findByText("보류");
  fireEvent.change(screen.getByLabelText("영업 신고 번호", { exact: true }), { target: { value: "합성 보존 번호" } });
  await photo("새 신고증 사진");
  fireEvent.click(screen.getByRole("button", { name: "신고증 다시 올리기" }));
  await within(screen.getByRole("main")).findByText("입력한 내용을 확인해 주세요");
  expect((screen.getByLabelText("영업 신고 번호", { exact: true }) as HTMLInputElement).value).toBe("합성 보존 번호");
  expect(document.activeElement).toBe(screen.getByLabelText("영업 신고 번호", { exact: true }));
});

async function prepared(kind: "license" | "identity") {
  if (kind === "license") current = fixture("on_hold");
  const a = area();
  await within(screen.getByRole("main")).findByText(kind === "license" ? "보류" : "확인됨");
  if (kind === "identity") fireEvent.click(screen.getByRole("button", { name: "변경 요청" }));
  await photo(kind === "license" ? "새 신고증 사진" : "증빙 사진");
  return {
    ...a,
    submit: () =>
      fireEvent.click(
        within(
          screen.getByRole("form", { name: kind === "license" ? "영업 신고 재제출" : "사업자 정보 변경 요청" }),
        ).getByRole("button", { name: kind === "license" ? "신고증 다시 올리기" : "변경 요청" }),
      ),
  };
}

it.each([
  ["license", 401, "unauthenticated"],
  ["license", 404, "shop_not_registered"],
  ["license", 409, "version_conflict"],
  ["license", 409, "invalid_state"],
  ["license", 422, "idempotency_key_reused"],
  ["license", 500, "internal"],
  ["identity", 401, "unauthenticated"],
  ["identity", 404, "shop_not_registered"],
  ["identity", 409, "version_conflict"],
  ["identity", 409, "identity_change_pending"],
  ["identity", 422, "validation_failed"],
  ["identity", 422, "idempotency_key_reused"],
  ["identity", 503, "storage_unavailable"],
  ["identity", 500, "internal"],
] as const)("%s의 %s/%s 응답을 권한·현재 상태·필드·재시도에 연결", async (kind, status, code) => {
  const a = await prepared(kind);
  sendError = [status, code];
  if (code === "identity_change_pending") latestOnFailure = fixture("identity_change_pending");
  if (code === "invalid_state") latestOnFailure = fixture("verified");
  a.submit();
  if (status === 401) await waitFor(() => expect(a.login).toHaveBeenCalledTimes(1));
  else if (status === 404) await waitFor(() => expect(a.register).toHaveBeenCalledTimes(1));
  else {
    const failure = ERROR_CODES[code];
    await within(screen.getByRole("main")).findByText(failure.message);
    if (status === 409) await waitFor(() => expect(reads).toBe(2));
    if (code === "identity_change_pending") {
      await within(screen.getByRole("main")).findByText("변경 확인 기다림");
      expect((screen.getByRole("button", { name: "변경 요청" }) as HTMLButtonElement).disabled).toBe(true);
    }
    if (code === "invalid_state") expect(screen.queryByRole("form", { name: "영업 신고 재제출" })).toBeNull();
    if (code === "storage_unavailable") {
      fireEvent.click(screen.getByRole("button", { name: "다시 올리기" }));
      await within(screen.getByRole("main")).findByText("사진을 올렸어요. 1시간 안에 저장해 주세요");
      a.submit();
      await waitFor(() => expect(requests).toHaveLength(2));
      expect(requests[1]?.key).not.toBe(requests[0]?.key);
      expect(requests[1]?.body.evidencePhotoUploadId).not.toBe(requests[0]?.body.evidencePhotoUploadId);
    }
    if (code === "internal" || code === "idempotency_key_reused") {
      fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
      await waitFor(() => expect(requests).toHaveLength(2));
      expect(requests[1]?.body).toEqual(requests[0]?.body);
      if (code === "idempotency_key_reused") expect(requests[1]?.key).not.toBe(requests[0]?.key);
      else expect(requests[1]?.key).toBe(requests[0]?.key);
    }
  }
});

it.each(["license", "identity"] as const)(
  "%s의 만료 업로드는 옛 성공 안내를 지우고 파일을 남겨 다시 올림",
  async (kind) => {
    const a = await prepared(kind);
    expiredPhoto = true;
    sendError = [422, "validation_failed"];
    a.submit();
    await within(screen.getByRole("main")).findByText("올린 파일을 찾을 수 없어요. 다시 올려 주세요");
    expect(within(screen.getByRole("main")).queryByText("사진을 올렸어요. 1시간 안에 저장해 주세요")).toBeNull();
    expect(screen.getByText("선택한 파일: synthetic.png")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "다시 올리기" }));
    await within(screen.getByRole("main")).findByText("사진을 올렸어요. 1시간 안에 저장해 주세요");
    expect(uploads).toBe(2);
    a.submit();
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(Object.values(requests[1]?.body ?? {})).toContain(`upl_${"a".repeat(23)}2`);
  },
);

it.each([
  [413, "file_too_large"],
  [422, "validation_failed"],
  [429, "rate_limited"],
  [503, "storage_unavailable"],
  [500, "internal"],
] as const)("사진 %s/%s를 오류/대기/다시 올리기에 연결", async (status, code) => {
  current = fixture("on_hold");
  uploadError = [status, code];
  area();
  await within(screen.getByRole("main")).findByText("보류");
  fireEvent.change(screen.getByLabelText("새 신고증 사진"), {
    target: { files: [new File([new Uint8Array([1, 2, 3])], "synthetic.png", { type: "image/png" })] },
  });
  await within(screen.getByRole("main")).findByText(ERROR_CODES[code].message);
  expect(requests).toHaveLength(0);
  if (status === 429) expect((screen.getByLabelText("새 신고증 사진") as HTMLInputElement).disabled).toBe(true);
  if (status === 503 || status === 500) {
    uploadError = null;
    fireEvent.click(screen.getByRole("button", { name: "다시 올리기" }));
    await within(screen.getByRole("main")).findByText("사진을 올렸어요. 1시간 안에 저장해 주세요");
    expect(uploads).toBe(2);
  }
});

it("사진 업로드401은 로그인으로 보냄", async () => {
  current = fixture("on_hold");
  uploadError = [401, "unauthenticated"];
  const a = area();
  await within(screen.getByRole("main")).findByText("보류");
  fireEvent.change(screen.getByLabelText("새 신고증 사진"), {
    target: { files: [new File(["synthetic"], "synthetic.png", { type: "image/png" })] },
  });
  await waitFor(() => expect(a.login).toHaveBeenCalledTimes(1));
});
it("10MB 초과는 보내지 않고 같은 필드에 오류를 표시", async () => {
  current = fixture("on_hold");
  area();
  await within(screen.getByRole("main")).findByText("보류");
  const file = new File(["synthetic"], "too-large.png", { type: "image/png" });
  Object.defineProperty(file, "size", { value: 10 * 1024 * 1024 + 1 });
  fireEvent.change(screen.getByLabelText("새 신고증 사진"), { target: { files: [file] } });
  await within(screen.getByRole("main")).findByText("사진이 너무 커요. 10MB(완성 사진은 20MB)까지 올릴 수 있어요");
  expect(uploads).toBe(0);
});
it("다른 기기가 바꾼 신고 내용으로 다시 읽고 옛 입력을 교체", async () => {
  const a = await prepared("license");
  sendError = [409, "version_conflict"];
  latestOnFailure = { ...fixture("on_hold"), foodLicenseNo: "합성 최신 번호", revision: "latest-synthetic-revision" };
  a.submit();
  await waitFor(() =>
    expect((screen.getByLabelText("영업 신고 번호") as HTMLInputElement).value).toBe("합성 최신 번호"),
  );
  expect(reads).toBe(2);
});
it("조회 기본 실패는 추적 ID와 다시 시도", async () => {
  getError = [500, "internal"];
  area();
  await within(screen.getByRole("main")).findByText(/추적 ID/);
  getError = null;
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await within(screen.getByRole("main")).findByText("확인됨");
});
it.each(["verified", "on_hold"])("실제 OwnerArea의 %s 사장님은 영업 신고 경로로 연결", async (status) => {
  current = fixture(status);
  render(
    <MemoryRouter initialEntries={["/owner/shop/license"]}>
      <Routes>
        <Route path="/owner/*" element={<OwnerArea />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "영업 신고", level: 1 });
  await within(screen.getByRole("main")).findByText(status === "verified" ? "확인됨" : "보류");
  expect(screen.getByRole("heading", { name: "영업 신고", level: 1 })).toBeTruthy();
});
it("처리 중 같은 키 재전송으로 결과는 한 번 표시", async () => {
  current = fixture("on_hold");
  sendError = [409, "request_in_progress"];
  area();
  await within(screen.getByRole("main")).findByText("보류");
  await photo("새 신고증 사진");
  fireEvent.click(screen.getByRole("button", { name: "신고증 다시 올리기" }));
  await screen.findByRole("button", { name: "처리하고 있어요" });
  await waitFor(() => expect(requests).toHaveLength(2), { timeout: 3000 });
  expect(requests[0]?.key).toBe(requests[1]?.key);
  expect(requests[0]?.body).toEqual(requests[1]?.body);
  await within(screen.getByRole("main")).findByText("신고증을 다시 올렸어요. 운영자가 다시 확인해요");
});

it("사업자 변경 처리 중도 같은 키로 다시 보내고 결과는 한 번만 표시", async () => {
  const a = await prepared("identity");
  sendError = [409, "request_in_progress"];
  a.submit();
  await screen.findByRole("button", { name: "처리하고 있어요" });
  await waitFor(() => expect(requests).toHaveLength(2), { timeout: 3000 });
  expect(requests[1]?.key).toBe(requests[0]?.key);
  expect(requests[1]?.body).toEqual(requests[0]?.body);
  await within(screen.getByRole("main")).findByText("변경을 요청했어요. 운영자가 확인하면 바뀌어요");
  expect(within(screen.getByRole("main")).getAllByText("변경을 요청했어요. 운영자가 확인하면 바뀌어요")).toHaveLength(
    1,
  );
});
it("사업자 변경 없음200은 요청 대기 상태를 만들지 않고 알림", async () => {
  const a = await prepared("identity");
  identityUnchanged = true;
  a.submit();
  await within(screen.getByRole("main")).findByText("바뀐 것이 없어요");
  expect(screen.queryByText("변경 확인 기다림")).toBeNull();
  expect(requests).toHaveLength(1);
});
it("저장 중 입력/메뉴/다른 요청/로그아웃은 잠그고 중복 전송하지 않음", async () => {
  const a = await prepared("license");
  const input = screen.getByLabelText("영업 신고 번호") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "합성 잠금 번호" } });
  let release!: (response: Response) => void;
  holdSend = new Promise((resolve) => {
    release = resolve;
  });
  a.submit();
  await screen.findByRole("button", { name: "처리하고 있어요" });
  expect(input.matches(":disabled")).toBe(true);
  expect((screen.getByRole("button", { name: "로그아웃" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("navigation", { name: "사장님 메뉴", hidden: true }).hasAttribute("inert")).toBe(true);
  fireEvent.change(input, { target: { value: "바뀌면 안 되는 합성 값" } });
  expect(input.value).toBe("합성 잠금 번호");
  fireEvent.submit(screen.getByRole("form", { name: "영업 신고 재제출" }));
  expect(requests).toHaveLength(1);
  const uploadCall = vi.mocked(globalThis.fetch).mock.calls.find(([path]) => String(path) === "/api/owner/uploads");
  const uploadBody = uploadCall?.[1]?.body;
  if (!(uploadBody instanceof FormData)) throw new Error("합성 업로드 본문 없음");
  expect(uploadBody.get("purpose")).toBe("license_photo");
  expect(new Headers(uploadCall?.[1]?.headers).has("Idempotency-Key")).toBe(false);
  await act(async () =>
    release(
      json({
        outcome: "done",
        shop: { ...current, licenseStatus: "pending", licenseHoldReason: null, licenseReviewedAt: null },
      }),
    ),
  );
  await within(screen.getByRole("main")).findByText("신고증을 다시 올렸어요. 운영자가 다시 확인해요");
});
it("세션 재확인/실패는 같은 입력을 보존해 잠그고 실패 뒤 로그아웃 허용", async () => {
  const a = await prepared("license");
  const input = screen.getByLabelText("영업 신고 번호") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "합성 보존 입력" } });
  const common = {
    shopName: "합성 가게",
    onNavigate: a.navigate,
    onSessionExpired: a.login,
    onRegisterShop: a.register,
    onLogout: a.logout,
  };
  a.rerender(<ShopLicense {...common} sessionChecking />);
  expect(input.value).toBe("합성 보존 입력");
  expect(input.matches(":disabled")).toBe(true);
  a.rerender(<ShopLicense {...common} sessionFailed />);
  expect(input.value).toBe("합성 보존 입력");
  expect(input.matches(":disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
  expect(a.logout).toHaveBeenCalledTimes(1);
  expect(requests).toHaveLength(0);
});
it("반영된 사업자 정보는 현재 값과 반영 상태로 표시", async () => {
  const pending = fixture("identity_change_pending");
  current = {
    ...pending,
    businessName: "합성 반영된 가게",
    identityChange: { ...(pending.identityChange as object), status: "applied", businessName: "합성 반영된 가게" },
  };
  area();
  await within(screen.getByRole("main")).findByText("변경 반영됨");
  expect(within(screen.getByRole("region", { name: "사업자 정보" })).getByText("합성 반영된 가게")).toBeTruthy();
});

it("세션 실패 뒤 남은 저장 재시도는 요청을 보내지 않음", async () => {
  const a = await prepared("license");
  sendError = [500, "internal"];
  a.submit();
  const retry = await screen.findByRole("button", { name: "다시 시도" });
  a.rerender(
    <ShopLicense
      shopName="합성 가게"
      onNavigate={a.navigate}
      onSessionExpired={a.login}
      onRegisterShop={a.register}
      onLogout={a.logout}
      sessionFailed
    />,
  );
  expect((retry as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(retry);
  expect(requests).toHaveLength(1);
});
it("다른 증빙 사진을 올리는 동안 남은 신고 재시도는 잠금", async () => {
  const a = await prepared("license");
  fireEvent.click(screen.getByRole("button", { name: "변경 요청" }));
  sendError = [500, "internal"];
  a.submit();
  const retry = await screen.findByRole("button", { name: "다시 시도" });
  holdUpload = new Promise(() => {});
  fireEvent.change(screen.getByLabelText("증빙 사진"), {
    target: { files: [new File(["synthetic"], "evidence.png", { type: "image/png" })] },
  });
  expect((retry as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(retry);
  expect(requests).toHaveLength(1);
});
it("사업자 변경 충돌은 신고 양식의 아직 저장하지 않은 입력을 보존", async () => {
  await prepared("license");
  fireEvent.change(screen.getByLabelText("영업 신고 번호"), { target: { value: "내 미저장 신고 번호" } });
  fireEvent.click(screen.getByRole("button", { name: "변경 요청" }));
  await photo("증빙 사진");
  latestOnFailure = { ...fixture("on_hold"), foodLicenseNo: "서버 최신 신고 번호", revision: "latest-review-048" };
  sendError = [409, "version_conflict"];
  fireEvent.submit(screen.getByRole("form", { name: "사업자 정보 변경 요청" }));
  await within(screen.getByRole("main")).findByText("서버 최신 신고 번호");
  expect((screen.getByLabelText("영업 신고 번호") as HTMLInputElement).value).toBe("내 미저장 신고 번호");
});
it("신고 충돌은 열린 사업자 변경 양식과 이미 올린 증빙을 보존", async () => {
  const a = await prepared("license");
  fireEvent.click(screen.getByRole("button", { name: "변경 요청" }));
  fireEvent.change(screen.getByLabelText("새 상호"), { target: { value: "내 미저장 사업자 상호" } });
  await photo("증빙 사진");
  latestOnFailure = { ...fixture(), foodLicenseNo: "서버 확인 번호", revision: "latest-review-048" };
  sendError = [409, "version_conflict"];
  a.submit();
  await within(screen.getByRole("main")).findByText("서버 확인 번호");
  expect((screen.getByLabelText("새 상호") as HTMLInputElement).value).toBe("내 미저장 사업자 상호");
  expect(
    within(screen.getByRole("form", { name: "사업자 정보 변경 요청" })).getByText(
      "사진을 올렸어요. 1시간 안에 저장해 주세요",
    ),
  ).toBeTruthy();
});
it("충돌 재조회 실패는 예전 양식을 잠그며 세션 실패 때 재조회도 막음", async () => {
  const a = await prepared("license");
  sendError = [409, "version_conflict"];
  getError = [500, "internal"];
  a.submit();
  const retry = await screen.findByRole("button", { name: "다시 시도" });
  await waitFor(() => expect(reads).toBe(2));
  expect((screen.getByLabelText("영업 신고 번호") as HTMLInputElement).disabled).toBe(true);
  fireEvent.submit(screen.getByRole("form", { name: "영업 신고 재제출" }));
  expect(requests).toHaveLength(1);
  const common = {
    shopName: "합성 가게",
    onNavigate: a.navigate,
    onSessionExpired: a.login,
    onRegisterShop: a.register,
    onLogout: a.logout,
  };
  a.rerender(<ShopLicense {...common} sessionFailed />);
  expect((retry as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(retry);
  expect(reads).toBe(2);
  a.rerender(<ShopLicense {...common} />);
  getError = null;
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await waitFor(() => expect((screen.getByLabelText("영업 신고 번호") as HTMLInputElement).disabled).toBe(false));
  expect(reads).toBe(3);
});
it("사진 누락 안내 뒤 다시 올리기에 성공하면 누락 안내를 지움", async () => {
  current = fixture("on_hold");
  uploadError = [500, "internal"];
  area();
  await within(screen.getByRole("main")).findByText("보류");
  fireEvent.change(screen.getByLabelText("새 신고증 사진"), {
    target: { files: [new File(["synthetic"], "synthetic.png", { type: "image/png" })] },
  });
  await within(screen.getByRole("main")).findByText(ERROR_CODES.internal.message);
  fireEvent.submit(screen.getByRole("form", { name: "영업 신고 재제출" }));
  await within(screen.getByRole("main")).findByText("사진을 먼저 올려 주세요");
  uploadError = null;
  fireEvent.click(screen.getByRole("button", { name: "다시 올리기" }));
  await within(screen.getByRole("main")).findByText("사진을 올렸어요. 1시간 안에 저장해 주세요");
  await waitFor(() => expect(within(screen.getByRole("main")).queryByText("사진을 먼저 올려 주세요")).toBeNull());
});
