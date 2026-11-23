import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { EMPTY_REGISTRATION, saveRegistrationDraft } from "./registration-draft";
import { ShopRegistration } from "./ShopRegistration";

const ownerId = "00000000-0000-4000-8000-000000000046";
const noop = () => {};
const html = () =>
  renderToString(
    <ShopRegistration ownerId={ownerId} onRegistered={noop} onSessionExpired={noop} onHome={noop} onLogout={noop} />,
  );
afterEach(() => vi.unstubAllGlobals());
it("가게 미등록 화면은 필수 정보/사진/위탁 버전을 보이고 동의는 기본 비어 있음", () => {
  const out = html();
  for (const label of [
    "가게 이름",
    "사업장 주소",
    "사업자등록번호",
    "영업 신고 번호",
    "제과점영업",
    "즉석판매제조·가공업",
    "신고증 사진",
    "통신판매업 신고 면제 사유",
    "MVP-2026.11.v1",
    "10MB",
  ])
    expect(out).toContain(label);
  expect(out).not.toMatch(/type="checkbox"[^>]*checked/);
  expect(out).not.toContain("메뉴 열기");
  expect(out).not.toContain(ownerId);
});
it("같은 계정의 글 복구는 화면에 이스케이프하고 사진·동의는 복구하지 않음", () => {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
  saveRegistrationDraft(
    ownerId,
    {
      ...EMPTY_REGISTRATION,
      name: "<script>synthetic</script>",
      mailOrderRegNo: "합성-2026",
      mailOrderAuthority: "합성 구청",
    },
    Date.now(),
    storage,
  );
  vi.stubGlobal("window", { sessionStorage: storage });
  const out = html();
  expect(out).toContain("&lt;script&gt;synthetic&lt;/script&gt;");
  expect(out).not.toContain("<script>");
  expect(out).toContain("통신판매업 신고를 받은 기관");
  expect(out).toContain("합성 구청");
  expect(out).not.toMatch(/type="checkbox"[^>]*checked/);
  expect(out).not.toContain("blob:");
});
