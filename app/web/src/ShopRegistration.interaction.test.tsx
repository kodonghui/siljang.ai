// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OwnerArea } from "./OwnerArea";
import { ERROR_CODES } from "./problems";
import {
  clearRegistrationDraft,
  EMPTY_REGISTRATION,
  REGISTRATION_DRAFT_KEY,
  saveRegistrationDraft,
} from "./registration-draft";
import { ShopRegistration } from "./ShopRegistration";

const OWNER = "00000000-0000-4000-8000-000000000046";
const SHOP = "00000000-0000-4000-8000-000000000047";
const NOW = Date.now();
const initial = {
  owner: { ownerId: OWNER, alertChannelFriend: false, createdAt: new Date(NOW).toISOString() },
  shop: null,
};
const photo = {
  uploadId: "upl_synthetic000000000000000046",
  purpose: "license_photo",
  expiresAt: new Date(NOW + 3600000).toISOString(),
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let profile: unknown,
  logoutGate: ReturnType<typeof gate<Response>> | null,
  profileGate: ReturnType<typeof gate<Response>> | null;
let registerCode: "success" | "already_registered" | "upload_expired" | "storage_unavailable" | "internal",
  registered: number,
  uploadStatus: number;
let uploadCount: number;
let registrationBodies: { body: Record<string, unknown>; key: string | null }[];
beforeEach(() => {
  sessionStorage.clear();
  profile = initial;
  logoutGate = profileGate = null;
  registerCode = "success";
  registered = uploadCount = 0;
  registrationBodies = [];
  uploadStatus = 201;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      if (String(input) === "/api/owner/me") return profileGate?.promise ?? json(profile);
      if (String(input) === "/api/owner/session" && init?.method === "DELETE")
        return logoutGate?.promise ?? json({ code: "internal" }, 500);
      if (String(input) === "/api/owner/uploads") {
        uploadCount++;
        return uploadStatus === 401
          ? json({ code: "unauthenticated" }, 401)
          : json({ ...photo, uploadId: `${photo.uploadId}_${uploadCount}` }, 201);
      }
      if (String(input) === "/api/owner/shop") {
        registered++;
        registrationBodies.push({
          body: JSON.parse(String(init?.body)),
          key: new Headers(init?.headers).get("Idempotency-Key"),
        });
        if (registerCode === "storage_unavailable") return json({ code: "storage_unavailable" }, 503);
        if (registerCode === "internal") return json({ code: "internal" }, 500);
        if (registerCode === "already_registered") return json({ code: registerCode }, 409);
        if (registerCode === "upload_expired")
          return json(
            { code: "validation_failed", errors: [{ field: "/licensePhotoUploadId", code: "upload_not_found" }] },
            422,
          );
        profile = { ...initial, shop: { shopId: SHOP, name: "합성 가게", licenseStatus: "pending" } };
        return json({ shopId: SHOP, licenseStatus: "pending" }, 201);
      }
      return json({ code: "not_found" }, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  clearRegistrationDraft();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const field = (name: string) => screen.getByLabelText(name, {}) as HTMLInputElement;
async function area(path = "/owner/shop/new") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/owner/login" element={<p>합성 로그인 화면</p>} />
        <Route path="/owner/*" element={<OwnerArea />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByLabelText("가게 이름", {});
}
async function upload() {
  fireEvent.change(field("신고증 사진"), {
    target: { files: [new File([new Uint8Array([1, 2, 3])], "synthetic.png", { type: "image/png" })] },
  });
  await screen.findAllByText("사진을 올렸어요. 1시간 안에 등록해 주세요");
}
it("로그아웃 중·실패 뒤에도 글·업로드·동의를 유지함", async () => {
  await area();
  fireEvent.change(field("가게 이름"), { target: { value: "실패 뒤 남을 합성 가게" } });
  await upload();
  fireEvent.click(screen.getByRole("checkbox"));
  logoutGate = gate<Response>();
  fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
  expect(field("가게 이름").value).toBe("실패 뒤 남을 합성 가게");
  await act(async () => logoutGate?.resolve(json({ code: "internal" }, 500)));
  await screen.findByText("로그아웃하지 못했어요. 다시 시도해 주세요");
  expect(field("가게 이름").value).toBe("실패 뒤 남을 합성 가게");
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  expect(screen.getByText("synthetic.png")).toBeTruthy();
});
it("bfcache 세션 재확인 중과 성공 뒤에도 같은 양식을 유지함", async () => {
  await area();
  const name = field("가게 이름");
  fireEvent.change(name, { target: { value: "뒤로 와도 남을 합성 가게" } });
  await upload();
  profileGate = gate<Response>();
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  fireEvent(window, event);
  expect(name.isConnected).toBe(true);
  await act(async () => profileGate?.resolve(json(initial)));
  await waitFor(() => expect(field("가게 이름").matches(":disabled")).toBe(false));
  expect(field("가게 이름")).toBe(name);
  expect(name.value).toBe("뒤로 와도 남을 합성 가게");
  expect(screen.getByText("synthetic.png")).toBeTruthy();
});
it("등록 화면을 열지 않아도 다른 계정의 임시 글은 세션 확인 뒤 지움", async () => {
  saveRegistrationDraft("other-owner", { ...EMPTY_REGISTRATION, name: "다른 계정의 합성 가게" });
  profile = { ...initial, shop: { shopId: SHOP, name: "현재 합성 가게", licenseStatus: "verified" } };
  render(
    <MemoryRouter initialEntries={["/owner"]}>
      <OwnerArea />
    </MemoryRouter>,
  );
  await screen.findByText("준비 중입니다.");
  expect(sessionStorage.getItem(REGISTRATION_DRAFT_KEY)).toBeNull();
});
it("기기 시계가 빨라도 방금 올린 사진은 서버에 등록 검사를 맡김", async () => {
  await area();
  await upload();
  fireEvent.click(screen.getByRole("checkbox"));
  vi.spyOn(Date, "now").mockReturnValue(NOW + 2 * 3600000);
  fireEvent.click(screen.getByRole("button", { name: "등록" }));
  await waitFor(() => expect(registered).toBe(1));
});
it("사진401은 글만 저장하고 로그인 이동을 한 번 요청함", async () => {
  uploadStatus = 401;
  const expired = vi.fn();
  render(
    <ShopRegistration
      ownerId={OWNER}
      onRegistered={vi.fn()}
      onSessionExpired={expired}
      onHome={vi.fn()}
      onLogout={vi.fn()}
    />,
  );
  fireEvent.change(field("가게 이름"), { target: { value: "복구할 합성 가게" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(field("신고증 사진"), {
    target: { files: [new File(["synthetic"], "synthetic.png", { type: "image/png" })] },
  });
  await waitFor(() => expect(expired).toHaveBeenCalledOnce());
  const stored = sessionStorage.getItem(REGISTRATION_DRAFT_KEY) ?? "";
  expect(JSON.parse(stored).values.name).toBe("복구할 합성 가게");
  for (const absent of ["licensePhotoUploadId", "entrustmentConsent", "synthetic.png"])
    expect(stored).not.toContain(absent);
});
it("이미 등록됨은 할 일 이동을 제공하고 성공은 임시 글을 지움", async () => {
  registerCode = "already_registered";
  const home = vi.fn(),
    done = vi.fn();
  saveRegistrationDraft(OWNER, { ...EMPTY_REGISTRATION, name: "복구한 합성 가게" });
  render(
    <ShopRegistration
      ownerId={OWNER}
      onRegistered={done}
      onSessionExpired={vi.fn()}
      onHome={home}
      onLogout={vi.fn()}
    />,
  );
  await upload();
  fireEvent.click(screen.getByRole("button", { name: "등록" }));
  await screen.findByText("이미 등록한 가게가 있어요");
  fireEvent.click(screen.getByRole("button", { name: "할 일 목록으로 이동" }));
  expect(home).toHaveBeenCalledOnce();
  expect(done).not.toHaveBeenCalled();
  registerCode = "success";
  fireEvent.change(field("가게 이름"), { target: { value: "새 합성 이름" } });
  fireEvent.click(screen.getByRole("button", { name: "등록" }));
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(sessionStorage.getItem(REGISTRATION_DRAFT_KEY)).toBeNull();
});
it("bfcache 재확인401은 남은 글을 저장한 뒤 로그인으로 이동함", async () => {
  await area();
  fireEvent.change(field("가게 이름"), { target: { value: "다시 로그인할 합성 이름" } });
  profileGate = gate<Response>();
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  fireEvent(window, event);
  await act(async () => profileGate?.resolve(json({ code: "unauthenticated" }, 401)));
  await screen.findByText("합성 로그인 화면");
  expect(JSON.parse(sessionStorage.getItem(REGISTRATION_DRAFT_KEY) ?? "{}").values.name).toBe(
    "다시 로그인할 합성 이름",
  );
});
it("bfcache 재확인이 실패해도 글은 남고 성공하면 같은 입력을 다시 사용할 수 있음", async () => {
  await area();
  const name = field("가게 이름");
  fireEvent.change(name, { target: { value: "연결 실패에도 남을 합성 이름" } });
  profileGate = gate<Response>();
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  fireEvent(window, event);
  await act(async () => profileGate?.resolve(json({ code: "internal" }, 500)));
  await screen.findByRole("button", { name: "다시 시도" });
  expect(field("가게 이름")).toBe(name);
  expect(name.value).toBe("연결 실패에도 남을 합성 이름");
  expect((screen.getByRole("group", { name: "가게와 사업자 정보" }) as HTMLFieldSetElement).disabled).toBe(true);
  fireEvent.change(name, { target: { value: "잠긴 동안 바꾼 합성 이름" } });
  expect(name.value).toBe("연결 실패에도 남을 합성 이름");
  profileGate = null;
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await waitFor(() =>
    expect((screen.getByRole("group", { name: "가게와 사업자 정보" }) as HTMLFieldSetElement).disabled).toBe(false),
  );
  expect(field("가게 이름")).toBe(name);
});
it("사업자등록번호는 하이픈을 포함해 붙여 넣어도 숫자10자리를 유지함", async () => {
  await area();
  fireEvent.change(field("사업자등록번호"), { target: { value: "123-45-67890" } });
  expect(field("사업자등록번호").value).toBe("1234567890");
});
it("등록 완료 안내는 새로 고침에 남을 history state에 저장하지 않음", async () => {
  const router = createMemoryRouter([{ path: "/owner/*", element: <OwnerArea /> }], {
    initialEntries: ["/owner/shop/new"],
  });
  const active = render(<RouterProvider router={router} />);
  await screen.findByLabelText("가게 이름");
  await upload();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "등록" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/owner"));
  await within(active.container).findByText("가게를 등록했어요. 운영자가 영업 신고를 확인하고 있어요");
  expect(router.state.location.state).toBeNull();
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  fireEvent(window, event);
  await within(active.container).findByText("준비 중입니다.");
  expect(within(active.container).queryByText("가게를 등록했어요. 운영자가 영업 신고를 확인하고 있어요")).toBeNull();
  cleanup();
  const reloaded = createMemoryRouter([{ path: "/owner/*", element: <OwnerArea /> }], {
    initialEntries: [{ pathname: "/owner", state: router.state.location.state }],
  });
  const next = render(<RouterProvider router={reloaded} />);
  await within(next.container).findByText("준비 중입니다.");
  expect(within(next.container).queryByText("가게를 등록했어요. 운영자가 영업 신고를 확인하고 있어요")).toBeNull();
});

it("재확인이503으로 끝나면 글/사진을 보존하고 등록은 잠그되 로그아웃은 허용함", async () => {
  await area();
  await upload();
  profileGate = gate<Response>();
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  fireEvent(window, event);
  await act(async () => profileGate?.resolve(json({ code: "upstream_unavailable" }, 503)));
  expect(screen.queryByText("로그인 상태를 확인하고 있어요")).toBeNull();
  expect((screen.getByRole("button", { name: "등록" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "로그아웃" }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByText("synthetic.png")).toBeTruthy();
});
it("서버가 업로드 만료를 알리면 옛 성공 표시를 지우고 같은 파일로 다시 올릴 수 있음", async () => {
  await area();
  await upload();
  registerCode = "upload_expired";
  fireEvent.click(screen.getByRole("button", { name: "등록" }));
  await screen.findAllByText("올린 파일을 찾을 수 없어요. 다시 올려 주세요");
  const form = screen.getByRole("button", { name: "등록" }).closest("form");
  if (!form) throw new Error("등록 양식 없음");
  expect(within(form).queryByText("사진을 올렸어요. 1시간 안에 등록해 주세요")).toBeNull();
  expect(screen.getByText("synthetic.png")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "다시 올리기" }));
  await within(form).findByText("사진을 올렸어요. 1시간 안에 등록해 주세요");
});

it("등록 저장소503은 옛 사진 성공을 지우고 같은 파일을 다시 올린 새 ID와 키로 등록", async () => {
  await area();
  await upload();
  fireEvent.change(field("가게 이름"), { target: { value: "사진 복구를 확인할 합성 가게" } });
  fireEvent.click(screen.getByRole("checkbox"));
  registerCode = "storage_unavailable";
  fireEvent.click(screen.getByRole("button", { name: /^등록$/ }));
  await within(screen.getByRole("main")).findByText("사진을 저장하지 못했어요. 다시 올려 주세요");
  expect(within(screen.getByRole("main")).queryByText("사진을 올렸어요. 1시간 안에 등록해 주세요")).toBeNull();
  expect(screen.getByText("synthetic.png")).toBeTruthy();
  expect(field("가게 이름").value).toBe("사진 복구를 확인할 합성 가게");
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  registerCode = "success";
  fireEvent.click(screen.getByRole("button", { name: /^다시 올리기$/ }));
  await within(screen.getByRole("main")).findByText("사진을 올렸어요. 1시간 안에 등록해 주세요");
  fireEvent.click(screen.getByRole("button", { name: /^등록$/ }));
  await screen.findByText("준비 중입니다.");
  expect(uploadCount).toBe(2);
  expect(registrationBodies).toHaveLength(2);
  expect(registrationBodies[1]?.body.licensePhotoUploadId).not.toBe(registrationBodies[0]?.body.licensePhotoUploadId);
  expect(registrationBodies[1]?.key).not.toBe(registrationBodies[0]?.key);
});

it("등록500 뒤 세션 재확인 실패는 남은 등록 재시도도 잠금", async () => {
  await area();
  await upload();
  registerCode = "internal";
  fireEvent.click(screen.getByRole("button", { name: /^등록$/ }));
  const retry = await within(screen.getByRole("main")).findByRole("button", { name: "다시 시도" });
  profileGate = gate<Response>();
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  fireEvent(window, event);
  await act(async () => profileGate?.resolve(json({ code: "upstream_unavailable" }, 503)));
  expect((retry as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(retry);
  expect(registered).toBe(1);
});

it("올리기 성공 뒤에도 등록 전에 같은 파일을 다시 올릴 수 있음", async () => {
  await area();
  fireEvent.change(field("가게 이름"), { target: { value: "오래 입력할 합성 가게" } });
  await upload();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "다시 올리기" }));
  await waitFor(() => expect(uploadCount).toBe(2));
  await within(screen.getByRole("main")).findByText("사진을 올렸어요. 1시간 안에 등록해 주세요");
  expect(field("가게 이름").value).toBe("오래 입력할 합성 가게");
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  expect(registered).toBe(0);
});
it("429 뒤 편집한 등록도 대기 중에는 버튼과 제출을 잠근다", async () => {
  await area();
  await upload();
  const transport = fetch;
  let limited = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      if (String(input) === "/api/owner/shop" && init?.method === "POST" && !limited) {
        limited = true;
        registered++;
        registrationBodies.push({
          body: JSON.parse(String(init.body)),
          key: new Headers(init.headers).get("Idempotency-Key"),
        });
        return json({ code: "rate_limited" }, 429);
      }
      return transport(input as RequestInfo | URL, init);
    }),
  );
  const button = screen.getByRole("button", { name: "등록" }) as HTMLButtonElement;
  fireEvent.click(button);
  await within(screen.getByRole("main")).findByText(ERROR_CODES.rate_limited.message);
  fireEvent.change(field("가게 이름"), { target: { value: "대기 중 합성 가게" } });
  expect(button.disabled).toBe(true);
  const form = button.closest("form");
  if (!form) throw new Error("등록 양식 없음");
  fireEvent.submit(form);
  expect(registered).toBe(1);
});
