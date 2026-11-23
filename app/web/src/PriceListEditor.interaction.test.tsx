// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { OwnerArea } from "./OwnerArea";
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
let readProblem: { status: number; code: string } | null;
let sendProblem: { status: number; code: string; errors?: { field: string; code: string }[] } | null;
let photoProblem: { status: number; code: string; errors?: { field: string; code: string }[] } | null;
let unchanged: boolean, uploads: number, holdSave: boolean, holdUpload: boolean;
let photoProblemAt: number;
let ownerStatus: "pending" | "verified" | "on_hold";
beforeEach(() => {
  current = fixture();
  empty = conflict = failReload = holdRead = false;
  reads = 0;
  sends = [];
  ownerStatus = "verified";
  readProblem = sendProblem = photoProblem = null;
  unchanged = holdSave = holdUpload = false;
  uploads = 0;
  photoProblemAt = 1;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      if (String(input) === "/api/owner/me")
        return json({
          owner: {
            ownerId: "00000000-0000-4000-8000-000000000049",
            alertChannelFriend: false,
            createdAt: "2026-11-23T08:00:00Z",
          },
          shop: { shopId: "00000000-0000-4000-8000-000000000050", name: "합성 가게", licenseStatus: ownerStatus },
        });
      if (String(input) === "/api/owner/uploads") {
        uploads++;
        if (holdUpload) return new Promise(() => {});
        if (photoProblem && uploads === photoProblemAt)
          return new Response(JSON.stringify({ ...photoProblem, traceId }), {
            status: photoProblem.status,
            headers: { "Retry-After": "1" },
          });
        return json(
          {
            uploadId: `upl_${"a".repeat(23)}${uploads}`,
            purpose: "design_image",
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          },
          201,
        );
      }
      if (String(input) === "/api/owner/price-list") {
        reads++;
        if (readProblem) return json({ ...readProblem, traceId }, readProblem.status);
        if (holdRead) return new Promise(() => {});
        if (empty) return json({ code: "not_set", traceId }, 404);
        if (failReload && reads > 1) return json({ code: "internal", traceId }, 500);
        return json(current);
      }
      if (String(input) === "/api/owner/price-list/versions") {
        const body = JSON.parse(String(init?.body));
        sends.push({ body, key: new Headers(init?.headers).get("Idempotency-Key") });
        if (holdSave) return new Promise(() => {});
        if (sendProblem && sends.length === 1) return json({ ...sendProblem, traceId }, sendProblem.status);
        if (unchanged) return json({ outcome: "unchanged", priceList: current });
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

it.each(["pending", "verified"] as const)("실제 OwnerArea의 %s 계정이 가격표 편집 경로로 연결", async (status) => {
  ownerStatus = status;
  render(
    <MemoryRouter initialEntries={["/owner/price-list"]}>
      <Routes>
        <Route path="/owner/*" element={<OwnerArea />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "가격표와 도안" });
  await main().findByText(/가격표 버전 4/);
});
it("신고 보류 계정은 가격표를 조회하기 전에 신고 수정으로 이동", async () => {
  ownerStatus = "on_hold";
  render(
    <MemoryRouter initialEntries={["/owner/price-list"]}>
      <Routes>
        <Route path="/owner/shop/license" element={<p>신고 수정 합성 목적지</p>} />
        <Route path="/owner/*" element={<OwnerArea />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByText("신고 수정 합성 목적지");
  expect(reads).toBe(0);
});
afterEach(() => {
  cleanup();
  for (const n of document.querySelectorAll("[data-announcer]")) n.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

const save = () => fireEvent.click(screen.getByRole("button", { name: /^저장$/ }));
const loaded = () => main().findByText(/가격표 버전 4/);
const design = () => within(screen.getByRole("group", { name: "도안 1" }));
const choose = () =>
  fireEvent.change(design().getByLabelText("도안 그림"), {
    target: { files: [new File(["synthetic image"], "synthetic.png", { type: "image/png" })] },
  });
it.each([
  { status: 401, code: "unauthenticated", cb: "onSessionExpired" },
  { status: 404, code: "shop_not_registered", cb: "onRegisterShop" },
] as const)("조회 $code는 권한 경로로 보냄", async (p) => {
  readProblem = p;
  const { props } = area();
  await waitFor(() => expect(props[p.cb]).toHaveBeenCalledTimes(1));
  expect((screen.getByRole("button", { name: /^저장$/ }) as HTMLButtonElement).disabled).toBe(true);
});
it("조회 실패는 양식을 비우고 추적 ID/재시도로 복구", async () => {
  readProblem = { status: 500, code: "internal" };
  area();
  await main().findByText(`추적 ID: ${traceId}`);
  expect(screen.queryByRole("group", { name: "크기 옵션 1" })).toBeNull();
  readProblem = null;
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await loaded();
  expect(reads).toBe(2);
});
it("변경 없음200은 새 버전 성공과 구분", async () => {
  unchanged = true;
  area();
  await loaded();
  save();
  await main().findByText("바뀐 것이 없어 새 버전을 만들지 않았어요");
  expect(sends).toHaveLength(1);
});
it.each([
  { status: 401, code: "unauthenticated", cb: "onSessionExpired" },
  { status: 404, code: "shop_not_registered", cb: "onRegisterShop" },
] as const)("저장 $code는 입력을 보존하고 권한 경로로 보냄", async (p) => {
  sendProblem = p;
  const { props } = area();
  await loaded();
  fireEvent.change(amount(), { target: { value: "38000" } });
  save();
  await waitFor(() => expect(props[p.cb]).toHaveBeenCalledTimes(1));
  expect(amount().value).toBe("38000");
});
it.each([
  { status: 500, code: "internal", same: true },
  { status: 422, code: "idempotency_key_reused", same: false },
])("저장 $code 재시도의 요청 키 정책과 입력 보존", async (p) => {
  sendProblem = p;
  area();
  await loaded();
  fireEvent.change(amount(), { target: { value: "38000" } });
  save();
  await main().findByText(`추적 ID: ${traceId}`);
  expect(amount().value).toBe("38000");
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await main().findByText("저장했어요. 가격표 버전 5");
  expect(sends).toHaveLength(2);
  expect(sends[1]?.body).toEqual(sends[0]?.body);
  expect(sends[1]?.key === sends[0]?.key).toBe(p.same);
});
it("처리 중409는 1초 뒤 같은 본문/키로 한 번 다시 보내고 한 번 완료", async () => {
  sendProblem = { status: 409, code: "request_in_progress" };
  area();
  await loaded();
  save();
  await main().findByText("처리하고 있어요. 잠시 뒤 다시 확인해 주세요");
  await main().findByText("저장했어요. 가격표 버전 5", {}, { timeout: 2500 });
  expect(sends).toHaveLength(2);
  expect(sends[1]).toEqual(sends[0]);
  expect(main().getAllByText("저장했어요. 가격표 버전 5")).toHaveLength(1);
});
it("서버 필드 오류는 해당 그룹과 필드로 이동하고 입력을 보존", async () => {
  const i = current.options.findIndex((o: { group: string }) => o.group === "flavor");
  sendProblem = { status: 422, code: "validation_failed", errors: [{ field: `/options/${i}/name`, code: "too_long" }] };
  area();
  await loaded();
  fireEvent.change(amount(), { target: { value: "38000" } });
  save();
  const flavor = within(await screen.findByRole("group", { name: "맛 옵션 1" }));
  await waitFor(() => expect(flavor.getByLabelText("옵션 이름").getAttribute("aria-invalid")).toBe("true"));
  expect(document.activeElement).toBe(flavor.getByLabelText("옵션 이름"));
  fireEvent.click(screen.getByRole("tab", { name: "크기" }));
  expect(amount().value).toBe("38000");
});
it("저장 중 편집/사진/메뉴/중복 저장을 막음", async () => {
  holdSave = true;
  const { props } = area();
  await loaded();
  save();
  fireEvent.click(screen.getByRole("button", { name: "처리하고 있어요" }));
  expect(sends).toHaveLength(1);
  expect(amount().disabled).toBe(true);
  expect((design().getByLabelText("도안 그림") as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("link", { name: "버전 이력" }));
  expect(props.onNavigate).not.toHaveBeenCalled();
  expect((screen.getByRole("button", { name: "로그아웃" }) as HTMLButtonElement).disabled).toBe(true);
});
it.each([
  { status: 413, code: "file_too_large", text: "사진이 너무 커요. 10MB(완성 사진은 20MB)까지 올릴 수 있어요" },
  {
    status: 422,
    code: "validation_failed",
    errors: [{ field: "/file", code: "bad_format" }],
    text: "입력한 내용을 확인해 주세요",
  },
  { status: 503, code: "storage_unavailable", text: "사진을 저장하지 못했어요. 다시 올려 주세요" },
  { status: 500, code: "internal", text: "문제가 생겼어요. 다시 시도해 주세요" },
])("그림 $code 뒤 원래 파일로 다시 올림", async (p) => {
  photoProblem = p;
  area();
  await loaded();
  choose();
  await design().findByText(p.text);
  expect(design().getByText("synthetic.png")).toBeTruthy();
  fireEvent.click(design().getByRole("button", { name: "다시 올리기" }));
  await design().findByText("사진을 올렸어요. 1시간 안에 저장해 주세요");
  expect(uploads).toBe(2);
});
it("그림401은 로그인으로 보냄", async () => {
  photoProblem = { status: 401, code: "unauthenticated" };
  const { props } = area();
  await loaded();
  choose();
  await waitFor(() => expect(props.onSessionExpired).toHaveBeenCalledTimes(1));
});
it("그림429는 Retry-After 동안 다시 올리기를 막고 해제 뒤 한 번 전송", async () => {
  photoProblem = { status: 429, code: "rate_limited" };
  area();
  await loaded();
  choose();
  await design().findByText("잠시 뒤 다시 시도해 주세요");
  const button = design().getByRole("button", { name: "다시 올리기" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(uploads).toBe(1);
  await waitFor(() => expect(button.disabled).toBe(false), { timeout: 2500 });
  fireEvent.click(button);
  await design().findByText("사진을 올렸어요. 1시간 안에 저장해 주세요");
});
it("그림 업로드 중 다른 그림/저장/편집을 잠금", async () => {
  holdUpload = true;
  area();
  await loaded();
  choose();
  await design().findByText("사진을 올리고 있어요");
  expect(amount().disabled).toBe(true);
  expect((screen.getByRole("button", { name: /^저장$/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(
    (within(screen.getByRole("group", { name: "도안 2" })).getByLabelText("도안 그림") as HTMLInputElement).disabled,
  ).toBe(true);
});
it.each([
  { status: 503, code: "storage_unavailable" },
  { status: 422, code: "validation_failed", errors: [{ field: "/designs/0/uploadId", code: "upload_not_found" }] },
])("저장 $code는 사진 성공 안내를 지우고 같은 파일의 새ID/새키로 저장", async (p) => {
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:synthetic-rejected");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  sendProblem = p;
  area();
  await loaded();
  choose();
  await design().findByText("사진을 올렸어요. 1시간 안에 저장해 주세요");
  save();
  await main().findByText(
    p.code === "validation_failed" ? "입력한 내용을 확인해 주세요" : "사진을 저장하지 못했어요. 다시 올려 주세요",
  );
  await waitFor(() => expect(design().queryByText("사진을 올렸어요. 1시간 안에 저장해 주세요")).toBeNull());
  expect(design().getByRole("img").getAttribute("src")).toBe(current.designs[0].imageUrl);
  expect(
    design().getByText("새 그림 저장이 거절돼 기존 그림을 유지해요. 원래 파일을 다시 올릴 수 있어요."),
  ).toBeTruthy();
  expect(design().getByText("synthetic.png")).toBeTruthy();
  fireEvent.click(design().getByRole("button", { name: "다시 올리기" }));
  await design().findByText("사진을 올렸어요. 1시간 안에 저장해 주세요");
  save();
  await main().findByText("저장했어요. 가격표 버전 5");
  expect(sends[1]?.key).not.toBe(sends[0]?.key);
  expect(sends[0]?.body.designs).toEqual(
    expect.arrayContaining([expect.objectContaining({ uploadId: `upl_${"a".repeat(23)}1` })]),
  );
  expect(sends[1]?.body.designs).toEqual(
    expect.arrayContaining([expect.objectContaining({ uploadId: `upl_${"a".repeat(23)}2` })]),
  );
});

it("부터·범위 옵션은 기본 범위를 끄고 연결된 도안도 범위에서 뺌", async () => {
  area();
  await loaded();
  fireEvent.click(screen.getByRole("tab", { name: "디자인" }));
  const row = within(screen.getByRole("group", { name: "디자인 옵션 1" }));
  fireEvent.change(row.getByLabelText("표시 방식"), { target: { value: "from" } });
  const check = row.getByLabelText("기본 디자인 범위") as HTMLInputElement;
  expect(check.checked).toBe(false);
  expect(check.disabled).toBe(true);
  expect(row.getByText("맞춤 주문으로만")).toBeTruthy();
  expect((design().getByLabelText("기본 디자인 범위") as HTMLInputElement).checked).toBe(false);
  fireEvent.change(row.getByLabelText("표시 방식"), { target: { value: "range" } });
  fireEvent.change(row.getByLabelText("금액"), { target: { value: "20000" } });
  fireEvent.change(row.getByLabelText("최대 금액"), { target: { value: "10000" } });
  save();
  expect(sends).toHaveLength(0);
  expect(row.getByLabelText("최대 금액").getAttribute("aria-invalid")).toBe("true");
});
it.each(["-1", "1.5", "10000001", ""])("금액 %s는 그대로 남기고 서버 전송을 막음", async (value) => {
  area();
  await loaded();
  fireEvent.change(amount(), { target: { value } });
  save();
  expect(sends).toHaveLength(0);
  expect(amount().value).toBe(value);
  expect(amount().getAttribute("aria-invalid")).toBe("true");
});
it("같은 조합의 허용/금지 규칙은 양쪽 행을 표시하고 저장하지 않음", async () => {
  area();
  await loaded();
  const first = within(screen.getByRole("group", { name: "옵션 규칙 1" })),
    second = within(screen.getByRole("group", { name: "옵션 규칙 2" }));
  fireEvent.change(second.getByLabelText("옵션 A"), {
    target: { value: (first.getByLabelText("옵션 A") as HTMLSelectElement).value },
  });
  fireEvent.change(second.getByLabelText("옵션 B"), {
    target: { value: (first.getByLabelText("옵션 B") as HTMLSelectElement).value },
  });
  expect(first.getByText("같은 조합이 허용이자 금지예요")).toBeTruthy();
  expect(second.getByText("같은 조합이 허용이자 금지예요")).toBeTruthy();
  save();
  expect(sends).toHaveLength(0);
});
it("연결 옵션의 순서 변경은 안정된 행을 유지하고 삭제는 규칙/도안 연결을 정리", async () => {
  area();
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "1호 아래로" }));
  expect(
    (within(screen.getByRole("group", { name: "크기 옵션 1" })).getByLabelText("옵션 이름") as HTMLInputElement).value,
  ).toBe("2호");
  fireEvent.click(screen.getByRole("tab", { name: "디자인" }));
  fireEvent.click(
    within(screen.getByRole("group", { name: "디자인 옵션 1" })).getByRole("button", { name: "옵션 삭제" }),
  );
  expect((design().getByLabelText("연결 옵션") as HTMLSelectElement).value).toBe("");
  save();
  await main().findByText("저장했어요. 가격표 버전 5");
  expect(sends[0]?.body.designs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sourceDesignId: fixture().designs[0].designId, optionKey: null }),
    ]),
  );
  expect(sends[0]?.body.designs).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ imageUrl: expect.anything() })]),
  );
});
it("옵션100개와 도안50장 한도는 추가 버튼에서 막음", async () => {
  current.options = Array.from({ length: 100 }, (_, i) => ({
    ...current.options[0],
    optionId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    name: `옵션${i + 1}`,
    position: i + 1,
  }));
  current.rules = [];
  current.designs = Array.from({ length: 50 }, (_, i) => ({
    ...current.designs[0],
    designId: `00000000-0000-4000-8001-${String(i + 1).padStart(12, "0")}`,
    name: `도안${i + 1}`,
    optionId: null,
    position: i + 1,
  }));
  area();
  await loaded();
  expect((screen.getByRole("button", { name: "크기 옵션 추가" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "도안 추가" }) as HTMLButtonElement).disabled).toBe(true);
});
it("큰 사진은 전송하지 않고 잘못된 파일 안내를 보임", async () => {
  area();
  await loaded();
  const file = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "synthetic-large.png", { type: "image/png" });
  fireEvent.change(design().getByLabelText("도안 그림"), { target: { files: [file] } });
  await design().findByText("사진이 너무 커요. 10MB(완성 사진은 20MB)까지 올릴 수 있어요");
  expect(uploads).toBe(0);
  save();
  await main().findByText("저장했어요. 가격표 버전 5");
  expect(sends[0]?.body.designs).toEqual(
    expect.arrayContaining([expect.objectContaining({ sourceDesignId: fixture().designs[0].designId })]),
  );
});
it("새 도안 사진은 미리보기와 다른 입력/사진을 보존한 채 충돌 재적용", async () => {
  conflict = true;
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic-price049"),
    revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const view = area();
  await loaded();
  choose();
  await design().findByText("사진을 올렸어요. 1시간 안에 저장해 주세요");
  save();
  fireEvent.click(await screen.findByRole("button", { name: "내 변경 다시 적용" }));
  expect(design().getByText("synthetic.png")).toBeTruthy();
  expect(design().getByRole("img").getAttribute("src")).toBe("blob:synthetic-price049");
  save();
  await main().findByText("저장했어요. 가격표 버전 6");
  expect(sends[1]?.body.designs).toEqual(
    expect.arrayContaining([expect.objectContaining({ uploadId: `upl_${"a".repeat(23)}1` })]),
  );
  view.unmount();
  expect(revoke).toHaveBeenCalledWith("blob:synthetic-price049");
  create.mockRestore();
  revoke.mockRestore();
});

it("처리 중 재전송 대기에서 세션 재확인이 실패하면 새 요청을 보내지 않음", async () => {
  sendProblem = { status: 409, code: "request_in_progress" };
  const view = area();
  await loaded();
  fireEvent.change(amount(), { target: { value: "38000" } });
  save();
  await main().findByText("처리하고 있어요. 잠시 뒤 다시 확인해 주세요");
  view.rerender(<PriceListEditor {...view.props} sessionFailed />);
  await act(() => new Promise<void>((r) => setTimeout(r, 1150)));
  expect(sends).toHaveLength(1);
  expect(amount().value).toBe("38000");
  expect(amount().disabled).toBe(true);
  expect((screen.getByRole("button", { name: "로그아웃" }) as HTMLButtonElement).disabled).toBe(false);
});
it("직접 고치는 입력이 없는 순서 필드 오류도 폼 위에 사유를 보임", async () => {
  sendProblem = {
    status: 422,
    code: "validation_failed",
    errors: [{ field: "/options/0/position", code: "out_of_range" }],
  };
  area();
  await loaded();
  save();
  await main().findByText("입력한 내용을 확인해 주세요");
  expect(main().getByText("넣을 수 있는 범위를 벗어났어요")).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("region", { name: "가격표 저장 결과" }));
});

it("그림 업로드가 실패해도 기존 도안과 실패한 파일을 충돌 재적용 뒤 보존", async () => {
  photoProblem = { status: 503, code: "storage_unavailable" };
  conflict = true;
  area();
  await loaded();
  choose();
  await design().findByText("사진을 저장하지 못했어요. 다시 올려 주세요");
  expect(design().getByRole("img").getAttribute("src")).toBe(fixture().designs[0].imageUrl);
  save();
  fireEvent.click(await screen.findByRole("button", { name: "내 변경 다시 적용" }));
  expect(design().getByText("synthetic.png")).toBeTruthy();
  expect(design().getByRole("button", { name: "다시 올리기" })).toBeTruthy();
});
it("둘째 페이지 규칙의 입력 오류는 해당 페이지와 첫 필드로 이동", async () => {
  const options = current.options;
  current.rules = [];
  for (let a = 0; a < options.length; a++)
    for (let b = a + 1; b < options.length; b++)
      if (current.rules.length < 21)
        current.rules.push({
          kind: "exclude",
          optionAId: options[a].optionId,
          optionBId: options[b].optionId,
          amount: null,
        });
  area();
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "다음 규칙" }));
  const last = within(screen.getByRole("group", { name: "옵션 규칙 21" }));
  fireEvent.change(last.getByLabelText("옵션 B"), {
    target: { value: (last.getByLabelText("옵션 A") as HTMLSelectElement).value },
  });
  fireEvent.click(screen.getByRole("button", { name: "이전 규칙" }));
  save();
  const error = within(screen.getByRole("group", { name: "옵션 규칙 21" }));
  expect(document.activeElement).toBe(error.getByLabelText("옵션 B"));
  expect(sends).toHaveLength(0);
});
it("이름을 아직 넣지 않은 옵션 두 개는 중복 오류를 먼저 보이지 않음", async () => {
  empty = true;
  area();
  await main().findByText("첫 가격표를 만들어 주세요");
  fireEvent.click(screen.getByRole("button", { name: "크기 옵션 추가" }));
  fireEvent.click(screen.getByRole("button", { name: "크기 옵션 추가" }));
  for (const row of screen.getAllByRole("group", { name: /크기 옵션/ }))
    expect(within(row).getByLabelText("옵션 이름").getAttribute("aria-invalid")).toBeNull();
});

it.each([
  { field: "/options/0/priceKind", label: "표시 방식", group: "크기 옵션 1" },
  { field: "/rules/0/kind", label: "규칙 종류", group: "옵션 규칙 1" },
])("서버 $field 오류는 선택 필드에 표시", async (p) => {
  sendProblem = { status: 422, code: "validation_failed", errors: [{ field: p.field, code: "not_allowed" }] };
  area();
  await loaded();
  save();
  await main().findByText("입력한 내용을 확인해 주세요");
  expect(
    within(screen.getByRole("group", { name: p.group }))
      .getByLabelText(p.label)
      .getAttribute("aria-invalid"),
  ).toBe("true");
});
it("두 번째 그림 업로드가 실패해도 마지막 성공 그림의 미리보기 주소를 유지", async () => {
  let id = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:synthetic-saved-${++id}`);
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const view = area();
  await loaded();
  choose();
  await design().findByText("사진을 올렸어요. 1시간 안에 저장해 주세요");
  photoProblem = { status: 503, code: "storage_unavailable" };
  photoProblemAt = 2;
  choose();
  await design().findByText("사진을 저장하지 못했어요. 다시 올려 주세요");
  const src = design().getByRole("img").getAttribute("src");
  expect(src).toMatch(/^blob:synthetic-saved-/);
  expect(revoke).not.toHaveBeenCalledWith(src);
  expect(design().getByText("새 그림을 올리지 못해 기존 그림을 유지해요. 다시 올리면 바꿀 수 있어요.")).toBeTruthy();
  view.unmount();
  expect(revoke).toHaveBeenCalledWith(src);
});
it("업로드 성공 뒤 같은 파일의 미리보기 URL은 하나만 소유하고 한 번 해제", async () => {
  const create = vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:synthetic-shared");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const view = area();
  await loaded();
  choose();
  await design().findByText("사진을 올렸어요. 1시간 안에 저장해 주세요");
  expect(create).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:synthetic-shared");
});

it("새 그림 저장 거절 뒤 다시 올리지 않아도 기존 도안 ID로 새 요청을 저장할 수 있다", async () => {
  sendProblem = { status: 503, code: "storage_unavailable" };
  area();
  await loaded();
  const previousId = current.designs[0].designId;
  choose();
  await design().findByText("사진을 올렸어요. 1시간 안에 저장해 주세요");
  save();
  await design().findByText("새 그림 저장이 거절돼 기존 그림을 유지해요. 원래 파일을 다시 올릴 수 있어요.");
  save();
  await main().findByText("저장했어요. 가격표 버전 5");
  const sent = sends[1];
  if (!sent) throw new Error("두 번째 저장 없음");
  const bodyDesign = (sent.body.designs as Record<string, unknown>[])[0];
  expect(bodyDesign).toMatchObject({ sourceDesignId: previousId });
  expect(bodyDesign).not.toHaveProperty("uploadId");
  expect(sends[1]?.key).not.toBe(sends[0]?.key);
  expect(uploads).toBe(1);
});
