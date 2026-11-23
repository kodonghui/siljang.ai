// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OwnerArea } from "./OwnerArea";
import { ShopSettings } from "./ShopSettings";
import { shopFixture } from "./test-fixtures/shop-settings";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function gate() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let requests: { body: Record<string, unknown>; key: string | null }[];
let patchGate: ReturnType<typeof gate> | null, failCode: string | null;
let current: Record<string, unknown>;
let getCode: string | null, gets: number;
let logoutGate: ReturnType<typeof gate> | null;
let profileGate: ReturnType<typeof gate> | null;
beforeEach(() => {
  requests = [];
  patchGate = null;
  failCode = null;
  current = shopFixture();
  getCode = null;
  gets = 0;
  logoutGate = profileGate = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (String(_input) === "/api/owner/me")
        return (
          profileGate?.promise ??
          json({
            owner: {
              ownerId: "00000000-0000-4000-8000-000000000047",
              alertChannelFriend: false,
              createdAt: "2026-11-23T08:00:00Z",
            },
            shop: { shopId: current.shopId, name: current.name, licenseStatus: current.licenseStatus },
          })
        );
      if (init?.method === "DELETE")
        return logoutGate?.promise ?? json({ code: "internal", traceId: "0123456789abcdef0123456789abcdef" }, 500);
      if (init?.method !== "PATCH") {
        gets++;
        return getCode
          ? json(
              { code: getCode, traceId: "0123456789abcdef0123456789abcdef" },
              getCode === "unauthenticated" ? 401 : getCode === "shop_not_registered" ? 404 : 500,
            )
          : json(current);
      }
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      requests.push({ body, key: new Headers(init.headers).get("Idempotency-Key") });
      if (patchGate) return patchGate.promise;
      if (failCode && failCode !== "unchanged" && requests.length === 1)
        return json(
          {
            code: failCode,
            traceId: "0123456789abcdef0123456789abcdef",
            ...(failCode === "validation_failed" ? { errors: [{ field: "/contactPhone", code: "bad_format" }] } : {}),
          },
          failCode === "internal"
            ? 500
            : failCode === "unauthenticated"
              ? 401
              : failCode === "shop_not_registered"
                ? 404
                : ["version_conflict", "request_in_progress"].includes(failCode)
                  ? 409
                  : 422,
        );
      const { baseRevision: _base, ...changes } = body;
      current = { ...current, ...changes, revision: "saved-2" };
      return json({ outcome: failCode === "unchanged" ? "unchanged" : "done", shop: current });
    }),
  );
});
afterEach(() => {
  cleanup();
  for (const node of document.querySelectorAll("[data-announcer]")) node.remove();
  vi.unstubAllGlobals();
});
async function area() {
  const navigate = vi.fn(),
    login = vi.fn(),
    register = vi.fn(),
    logout = vi.fn();
  render(
    <ShopSettings
      shopName="합성 가게"
      onNavigate={navigate}
      onSessionExpired={login}
      onRegisterShop={register}
      onLogout={logout}
    />,
  );
  await screen.findByLabelText("가게 이름", {});
  return { navigate, login, register, logout };
}
const input = (name: string) => screen.getByLabelText(name, {}) as HTMLInputElement;

it("설정9개와 현재 상태를 보이고 사업자 신원은 읽기 전용임", async () => {
  await area();
  expect(within(screen.getByRole("navigation", { name: "설정 목록" })).getAllByRole("link")).toHaveLength(9);
  expect(screen.getByText("버전 3", { exact: true })).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "상호" })).toBeNull();
  expect(screen.getByText(String(current.businessRegNo), { exact: true })).toBeTruthy();
});

it("바뀐 필드만 보내고 중복 저장/메뉴 이동/추가 입력을 막음", async () => {
  const { navigate } = await area();
  fireEvent.change(input("가게 이름"), { target: { value: "새 합성 가게" } });
  patchGate = gate();
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  fireEvent.click(screen.getByRole("button", { name: "처리하고 있어요" }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]?.body).toEqual({ baseRevision: current.revision, name: "새 합성 가게" });
  const firstCard = within(screen.getByRole("navigation", { name: "설정 목록" })).getAllByRole("link")[0];
  if (!firstCard) throw new Error("설정 카드 없음");
  fireEvent.click(firstCard);
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.change(input("가게 이름"), { target: { value: "보내는 중 덮어쓰기" } });
  expect(input("가게 이름").value).toBe("새 합성 가게");
  await act(async () =>
    patchGate?.resolve(json({ outcome: "done", shop: { ...current, name: "새 합성 가게", revision: "saved-2" } })),
  );
  await screen.findAllByText("저장했어요", { exact: true });
});

it("필드 오류 뒤 값을 보존하고 첫 잘못된 입력에 포커스를 둠", async () => {
  await area();
  failCode = "validation_failed";
  fireEvent.change(input("가게 이름"), { target: { value: "실패 뒤 남을 가게" } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await screen.findAllByText("입력한 내용을 확인해 주세요", { exact: true });
  expect(input("가게 이름").value).toBe("실패 뒤 남을 가게");
  expect(document.activeElement).toBe(input("연락처"));
});

it.each(["internal", "idempotency_key_reused"])("%s 재시도의 요청 키 규칙을 지킴", async (code) => {
  await area();
  failCode = code;
  fireEvent.change(input("가게 이름"), { target: { value: "재시도 합성 가게" } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  const retry = await screen.findByRole("button", { name: "다시 시도" });
  fireEvent.click(retry);
  await screen.findAllByText("저장했어요", { exact: true });
  expect(requests).toHaveLength(2);
  expect(requests[0]?.key === requests[1]?.key).toBe(code === "internal");
});

it.each([
  ["verified", "확인됨"],
  ["pending", "확인 중"],
  ["on_hold", "보류"],
  ["identity_change_pending", "변경 확인 기다림"],
  ["identity_change_on_hold", "변경 요청 보류"],
])("API009 %s가 가리키는 상태를 표시함", async (name, text) => {
  current = shopFixture(`get_${name}`);
  await area();
  expect(screen.getAllByText(text).length).toBeGreaterThan(0);
});
it.each(["unauthenticated", "shop_not_registered"])("API009 %s는 권한별 다음 화면으로 보냄", async (code) => {
  getCode = code;
  const login = vi.fn(),
    register = vi.fn();
  render(
    <ShopSettings
      shopName="합성 가게"
      onNavigate={vi.fn()}
      onSessionExpired={login}
      onRegisterShop={register}
      onLogout={vi.fn()}
    />,
  );
  await waitFor(() => expect(code === "unauthenticated" ? login : register).toHaveBeenCalledTimes(1));
  expect(screen.queryByLabelText("가게 이름")).toBeNull();
});
it("API009 실패는 폼 없이 추적 ID와 다시 읽기를 제공함", async () => {
  getCode = "internal";
  render(
    <ShopSettings
      shopName="합성 가게"
      onNavigate={vi.fn()}
      onSessionExpired={vi.fn()}
      onRegisterShop={vi.fn()}
      onLogout={vi.fn()}
    />,
  );
  await screen.findByText(/추적 ID/);
  expect(screen.queryByLabelText("가게 이름")).toBeNull();
  getCode = null;
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await screen.findByLabelText("가게 이름");
  expect(gets).toBe(2);
});
it.each(["unauthenticated", "shop_not_registered"])("API010 %s는 권한별 다음 화면으로 보냄", async (code) => {
  const { login, register } = await area();
  failCode = code;
  fireEvent.change(input("가게 이름"), { target: { value: "권한 확인 합성 가게" } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(code === "unauthenticated" ? login : register).toHaveBeenCalledTimes(1));
});
it("충돌409 뒤 현재 상태를 다시 읽어 낡은 글을 교체함", async () => {
  await area();
  failCode = "version_conflict";
  fireEvent.change(input("가게 이름"), { target: { value: "낡은 글" } });
  current = { ...current, name: "다른 기기의 합성 가게", revision: "other-revision" };
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(input("가게 이름").value).toBe("다른 기기의 합성 가게"));
  expect(screen.getAllByText("그 사이 바뀌었어요. 지금 상태를 확인해 주세요").length).toBeGreaterThan(0);
  expect(gets).toBe(2);
});
it("처리 중409는1초 뒤 같은 키로 다시 보내고 결과를 한 번 표시함", async () => {
  await area();
  failCode = "request_in_progress";
  fireEvent.change(input("가게 이름"), { target: { value: "처리 중 합성 가게" } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await screen.findAllByText("저장했어요", {}, { timeout: 2500 });
  expect(requests).toHaveLength(2);
  expect(requests[0]?.key).toBe(requests[1]?.key);
});
it("변경 없음200과 로컬 변경 없음은 알맞게 표시하며 불필요한 요청을 보내지 않음", async () => {
  await area();
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(screen.getAllByText("바뀐 것이 없어요").length).toBeGreaterThan(0);
  expect(requests).toHaveLength(0);
  failCode = "unchanged";
  fireEvent.change(input("가게 이름"), { target: { value: "변경 없음 합성" } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await screen.findAllByText("바뀐 것이 없어요");
  expect(requests).toHaveLength(1);
});
async function ownerArea() {
  render(
    <MemoryRouter initialEntries={["/owner/shop"]}>
      <Routes>
        <Route path="/owner/login" element={<p>합성 로그인 화면</p>} />
        <Route path="/owner/*" element={<OwnerArea />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByLabelText("가게 이름");
}
it("실제 OwnerArea 설정 연결에서 로그아웃 중과 실패 뒤 양식을 보존함", async () => {
  await ownerArea();
  fireEvent.change(input("가게 이름"), { target: { value: "로그아웃 뒤 보존" } });
  logoutGate = gate();
  fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
  expect(input("가게 이름").value).toBe("로그아웃 뒤 보존");
  expect((input("가게 이름").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
  await act(async () =>
    logoutGate?.resolve(json({ code: "internal", traceId: "0123456789abcdef0123456789abcdef" }, 500)),
  );
  await screen.findByRole("region", { name: "로그아웃 결과" });
  expect(input("가게 이름").value).toBe("로그아웃 뒤 보존");
  expect((input("가게 이름").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false);
  logoutGate = null;
});
it("로그아웃204는 로그인 화면으로 이동함", async () => {
  await ownerArea();
  logoutGate = gate();
  fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
  await act(async () => logoutGate?.resolve(new Response(null, { status: 204 })));
  await screen.findByText("합성 로그인 화면");
  expect(screen.queryByLabelText("가게 이름")).toBeNull();
});
it("bfcache 재확인 중 글을 보존하고401 뒤 즉시 로그인으로 이동함", async () => {
  await ownerArea();
  fireEvent.change(input("가게 이름"), { target: { value: "재확인 뒤 보존" } });
  profileGate = gate();
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  fireEvent(window, event);
  expect(input("가게 이름").value).toBe("재확인 뒤 보존");
  expect((input("가게 이름").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
  await act(async () => profileGate?.resolve(json({ code: "unauthenticated" }, 401)));
  await screen.findByText("합성 로그인 화면");
  expect(screen.queryByLabelText("가게 이름")).toBeNull();
});
it("재확인이503으로 끝나면 저장은 잠그되 로그아웃을 허용함", async () => {
  await ownerArea();
  profileGate = gate();
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  fireEvent(window, event);
  await act(async () => profileGate?.resolve(json({ code: "upstream_unavailable" }, 503)));
  expect((input("가게 이름").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "로그아웃" }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByText("로그인 상태를 확인하고 있어요")).toBeNull();
});
it("완성 사진 설정의 접근 가능한 이름이 한 번만 읽힘", async () => {
  await area();
  expect(screen.getByRole("checkbox", { name: "완성 사진 보내기" })).toBeTruthy();
});
