// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { OperatorRecordsScreen } from "./OperatorRecordsScreen";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const sample = (path: string, name: string, method = "get") =>
  structuredClone(api.paths[path][method].responses[200].content["application/json"].examples[name].value);
const shop = "2dc42524-54e3-5d3d-847f-efdb54aa8706";
const list = sample("/operator/shops/{shopId}/records", "orders");
const order = sample("/operator/shops/{shopId}/orders/{orderId}", "order");
const original = sample("/operator/shops/{shopId}/originals", "order_contact", "post");
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("사유를 제출하기 전에는 원문 요청이 없고 닫으면 원문을 지운다", async () => {
  const fetch = vi.fn((url: string) =>
    Promise.resolve(json(url.includes("/originals") ? original : url.includes("/orders/") ? order : list)),
  );
  vi.stubGlobal("fetch", fetch);
  render(
    <MemoryRouter>
      <OperatorRecordsScreen
        shopId={shop}
        path={`/operator/shops/${shop}/records`}
        onNavigate={() => {}}
        onSessionExpired={() => {}}
      />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /K7Q3M9/ }));
  fireEvent.click(await screen.findByRole("button", { name: "주문자 원래 값 열기" }));
  expect(fetch.mock.calls.filter(([url]) => url.includes("/originals"))).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("사유"), { target: { value: "손님 문의 기록 확인" } });
  fireEvent.click(screen.getByRole("button", { name: "사유를 적고 열기" }));
  expect(await screen.findByText("이지우")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  await waitFor(() => expect(document.body.textContent).not.toContain("이지우"));
});
it("401이면 가린 기록도 지우고 로그인으로 이동한다", async () => {
  const expired = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(json({}, 401))),
  );
  render(
    <MemoryRouter>
      <OperatorRecordsScreen
        shopId={shop}
        path={`/operator/shops/${shop}/records`}
        onNavigate={() => {}}
        onSessionExpired={expired}
      />
    </MemoryRouter>,
  );
  await waitFor(() => expect(expired).toHaveBeenCalled());
  expect(document.body.textContent).not.toContain("K7Q3M9");
});
it("상세 주소에서 목록 인증이 만료되면 상세를 요청하지 않는다", async () => {
  const expired = vi.fn();
  const fetch = vi.fn(() => Promise.resolve(json({}, 401)));
  vi.stubGlobal("fetch", fetch);
  const path = `/operator/shops/${shop}/orders/${order.orderId}`;
  render(
    <MemoryRouter>
      <OperatorRecordsScreen shopId={shop} path={path} onNavigate={() => {}} onSessionExpired={expired} />
    </MemoryRouter>,
  );
  await waitFor(() => expect(expired).toHaveBeenCalled());
  expect(fetch.mock.calls).toHaveLength(1);
});
it("상담의 현재 페이지 증표로만 대화 글을 연다", async () => {
  const consultations = sample("/operator/shops/{shopId}/records", "consultations");
  const consultation = sample("/operator/shops/{shopId}/consultations/{consultationId}", "consultation");
  const opened = sample("/operator/shops/{shopId}/originals", "consultation_text", "post");
  const fetch = vi.fn((url: string) =>
    Promise.resolve(
      json(url.includes("/originals") ? opened : url.includes("/consultations/") ? consultation : consultations),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  const path = `/operator/shops/${shop}/consultations/${consultation.consultationId}`;
  render(
    <MemoryRouter>
      <OperatorRecordsScreen shopId={shop} path={path} onNavigate={() => {}} onSessionExpired={() => {}} />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "대화 글 열기" }));
  fireEvent.change(screen.getByLabelText("사유"), { target: { value: "손님 문의 내용 확인" } });
  fireEvent.click(screen.getByRole("button", { name: "사유를 적고 열기" }));
  await screen.findByText(/땅콩 알레르기가/);
  const call = fetch.mock.calls.find(([url]) => url.includes("/originals")) as unknown as [string, RequestInit];
  expect(JSON.parse(String(call[1].body)).cursor).toBe(consultation.textCursor);
});
it("처리 중 응답은 같은 요청 키로 재시도하고 한 번만 연다", async () => {
  let count = 0;
  const problem = {
    type: "about:blank",
    title: "Conflict",
    status: 409,
    code: "request_in_progress",
    traceId: "synthetic-trace",
  };
  const fetch = vi.fn((url: string) =>
    Promise.resolve(
      json(
        url.includes("/originals") ? (++count === 1 ? problem : original) : url.includes("/orders/") ? order : list,
        url.includes("/originals") && count === 1 ? 409 : 200,
      ),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  render(
    <MemoryRouter>
      <OperatorRecordsScreen
        shopId={shop}
        path={`/operator/shops/${shop}/records`}
        onNavigate={() => {}}
        onSessionExpired={() => {}}
      />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /K7Q3M9/ }));
  fireEvent.click(await screen.findByRole("button", { name: "주문자 원래 값 열기" }));
  fireEvent.change(screen.getByLabelText("사유"), { target: { value: "손님 문의 기록 확인" } });
  fireEvent.click(screen.getByRole("button", { name: "사유를 적고 열기" }));
  await screen.findByText("이지우", {}, { timeout: 5000 });
  const calls = fetch.mock.calls.filter(([url]) => url.includes("/originals")) as unknown as [string, RequestInit][];
  expect(calls).toHaveLength(2);
  expect(new Headers(calls[0]?.[1].headers).get("Idempotency-Key")).toBe(
    new Headers(calls[1]?.[1].headers).get("Idempotency-Key"),
  );
});
it("잘못된 목록 필터는 조회하지 않고 입력 오류를 보여 준다", async () => {
  const fetch = vi.fn(() => Promise.resolve(json(list)));
  vi.stubGlobal("fetch", fetch);
  render(
    <MemoryRouter initialEntries={["/?kind=invalid"]}>
      <OperatorRecordsScreen
        shopId={shop}
        path={`/operator/shops/${shop}/records`}
        onNavigate={() => {}}
        onSessionExpired={() => {}}
      />
    </MemoryRouter>,
  );
  expect(await screen.findByText("입력한 내용을 확인해 주세요")).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});
it.each(["masked_value", "order_contact", "refund_account", "kept_record", "consultation_text"])(
  "계약의 원문 응답 %s는 선택한 유형만 전달한다",
  async (name) => {
    const data = sample("/operator/shops/{shopId}/originals", name, "post");
    const { openOperatorOriginal } = await import("./operator-records-api");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(json(data))),
    );
    const body = {
      targetKind: name as "masked_value" | "order_contact" | "refund_account" | "kept_record" | "consultation_text",
      targetId: data.targetId,
      reason: "손님 문의 기록 확인",
      ...(name === "consultation_text" ? { cursor: "example_text_page_cursor" } : {}),
    };
    expect((await openOperatorOriginal(shop, body, "ui-synthetic-record-open-12345678")).ok).toBe(true);
  },
);
it("보관 기록이 된 주문은 가린 목록에서 사유 확인 창을 연다", async () => {
  const fetch = vi.fn(() => Promise.resolve(json(list)));
  vi.stubGlobal("fetch", fetch);
  render(
    <MemoryRouter>
      <OperatorRecordsScreen
        shopId={shop}
        path={`/operator/shops/${shop}/records`}
        onNavigate={() => {}}
        onSessionExpired={() => {}}
      />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /H2W6Y1/ }));
  fireEvent.click(screen.getByRole("button", { name: "보관 기록 열기" }));
  expect(screen.getByRole("dialog").textContent).toContain("보관 기록 H2W6Y1");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("삭제된 상담에는 대화 글 열기가 없다", async () => {
  const consultation = sample("/operator/shops/{shopId}/consultations/{consultationId}", "deleted");
  const consultations = sample("/operator/shops/{shopId}/records", "consultations");
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => Promise.resolve(json(url.includes("/consultations/") ? consultation : consultations))),
  );
  render(
    <MemoryRouter>
      <OperatorRecordsScreen
        shopId={shop}
        path={`/operator/shops/${shop}/consultations/${consultation.consultationId}`}
        onNavigate={() => {}}
        onSessionExpired={() => {}}
      />
    </MemoryRouter>,
  );
  expect(await screen.findByText("보관 기간 30일이 지나 대화를 지웠어요")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "대화 글 열기" })).toBeNull();
});
it("가린 대화 번호의 원문은 해당 번호를 선택한 뒤에만 연다", async () => {
  const consultation = sample("/operator/shops/{shopId}/consultations/{consultationId}", "consultation");
  const consultations = sample("/operator/shops/{shopId}/records", "consultations");
  const opened = sample("/operator/shops/{shopId}/originals", "masked_value", "post");
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        json(url.includes("/originals") ? opened : url.includes("/consultations/") ? consultation : consultations),
      ),
    ),
  );
  render(
    <MemoryRouter>
      <OperatorRecordsScreen
        shopId={shop}
        path={`/operator/shops/${shop}/consultations/${consultation.consultationId}`}
        onNavigate={() => {}}
        onSessionExpired={() => {}}
      />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "원래 값 열기" }));
  fireEvent.change(screen.getByLabelText("사유"), { target: { value: "손님 문의 번호 확인" } });
  fireEvent.click(screen.getByRole("button", { name: "사유를 적고 열기" }));
  expect(await screen.findByText("010-9876-5432")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  expect(screen.queryByText("010-9876-5432")).toBeNull();
});
it("환불 계좌와 보관 기록은 각각 별도 사유를 받아 연다", async () => {
  const withRefund = sample("/operator/shops/{shopId}/orders/{orderId}", "with_refund");
  const refund = sample("/operator/shops/{shopId}/originals", "refund_account", "post");
  const kept = sample("/operator/shops/{shopId}/originals", "kept_record", "post");
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) =>
      Promise.resolve(
        json(
          url.includes("/originals")
            ? JSON.parse(String(init.body)).targetKind === "refund_account"
              ? refund
              : kept
            : url.includes("/orders/")
              ? withRefund
              : list,
        ),
      ),
    ),
  );
  render(
    <MemoryRouter>
      <OperatorRecordsScreen
        shopId={shop}
        path={`/operator/shops/${shop}/records`}
        onNavigate={() => {}}
        onSessionExpired={() => {}}
      />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /K7Q3M9/ }));
  fireEvent.click(await screen.findByRole("button", { name: "환불 계좌 원래 값 열기" }));
  fireEvent.change(screen.getByLabelText("사유"), { target: { value: "환불 문의 계좌 확인" } });
  fireEvent.click(screen.getByRole("button", { name: "사유를 적고 열기" }));
  expect(await screen.findByText("110-123-456789")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  fireEvent.click(screen.getByRole("button", { name: /H2W6Y1/ }));
  fireEvent.click(screen.getByRole("button", { name: "보관 기록 열기" }));
  expect(screen.queryByText("110-123-456789")).toBeNull();
  fireEvent.change(screen.getByLabelText("사유"), { target: { value: "보관 기록 요청 확인" } });
  fireEvent.click(screen.getByRole("button", { name: "사유를 적고 열기" }));
  expect(await screen.findByText("정해밀")).toBeTruthy();
});
const errorCases = [
  ["list", 401, "unauthenticated"],
  ["list", 404, "not_found"],
  ["list", 422, "validation_failed"],
  ["list", 500, "internal"],
  ["consultation", 401, "unauthenticated"],
  ["consultation", 404, "not_found"],
  ["consultation", 422, "validation_failed"],
  ["consultation", 500, "internal"],
  ["order", 401, "unauthenticated"],
  ["order", 404, "not_found"],
  ["order", 500, "internal"],
  ["original", 401, "unauthenticated"],
  ["original", 404, "not_found"],
  ["original", 409, "original_not_kept"],
  ["original", 409, "original_erased"],
  ["original", 422, "validation_failed"],
  ["original", 422, "idempotency_key_reused"],
  ["original", 500, "internal"],
] as const;
it.each(errorCases)("%s의 %s %s 응답을 화면 상태로 표시한다", async (step, status, code) => {
  const { ERROR_CODES } = await import("./problems");
  const consultation = sample("/operator/shops/{shopId}/consultations/{consultationId}", "consultation");
  const consultations = sample("/operator/shops/{shopId}/records", "consultations");
  const endpoint =
    step === "list"
      ? "/operator/shops/{shopId}/records"
      : step === "order"
        ? "/operator/shops/{shopId}/orders/{orderId}"
        : step === "consultation"
          ? "/operator/shops/{shopId}/consultations/{consultationId}"
          : "/operator/shops/{shopId}/originals";
  const response =
    api.paths[endpoint][step === "original" ? "post" : "get"].responses[status === 500 ? "default" : status].content[
      "application/problem+json"
    ].examples[code].value;
  const expired = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const fail =
        step === "list"
          ? url.includes("/records?")
          : step === "order"
            ? url.includes("/orders/")
            : step === "consultation"
              ? url.includes("/consultations/")
              : url.includes("/originals");
      return Promise.resolve(
        fail
          ? json(response, status)
          : json(
              url.includes("/consultations/")
                ? consultation
                : url.includes("/orders/")
                  ? order
                  : step === "consultation"
                    ? consultations
                    : list,
            ),
      );
    }),
  );
  const path =
    step === "consultation"
      ? `/operator/shops/${shop}/consultations/${consultation.consultationId}`
      : `/operator/shops/${shop}/records`;
  render(
    <MemoryRouter>
      <OperatorRecordsScreen shopId={shop} path={path} onNavigate={() => {}} onSessionExpired={expired} />
    </MemoryRouter>,
  );
  if (step === "order" || step === "original") fireEvent.click(await screen.findByRole("button", { name: /K7Q3M9/ }));
  if (step === "original") {
    fireEvent.click(await screen.findByRole("button", { name: "주문자 원래 값 열기" }));
    fireEvent.change(screen.getByLabelText("사유"), { target: { value: "손님 문의 기록 확인" } });
    fireEvent.click(screen.getByRole("button", { name: "사유를 적고 열기" }));
  }
  if (status === 401) await waitFor(() => expect(expired).toHaveBeenCalled());
  else
    expect(
      (await screen.findAllByText(new RegExp(ERROR_CODES[code].message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).length,
    ).toBeGreaterThan(0);
});
it("다섯 줄을 넘는 대화 글은 더 보기로 펼친다", async () => {
  const consultation = sample("/operator/shops/{shopId}/consultations/{consultationId}", "consultation");
  const consultations = sample("/operator/shops/{shopId}/records", "consultations");
  const opened = sample("/operator/shops/{shopId}/originals", "consultation_text", "post");
  opened.consultationText.items[1].textMasked = "긴 합성 상담 글 ".repeat(80);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(240);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(100);
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        json(url.includes("/originals") ? opened : url.includes("/consultations/") ? consultation : consultations),
      ),
    ),
  );
  render(
    <MemoryRouter>
      <OperatorRecordsScreen
        shopId={shop}
        path={`/operator/shops/${shop}/consultations/${consultation.consultationId}`}
        onNavigate={() => {}}
        onSessionExpired={() => {}}
      />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "대화 글 열기" }));
  fireEvent.change(screen.getByLabelText("사유"), { target: { value: "손님 문의 내용 확인" } });
  fireEvent.click(screen.getByRole("button", { name: "사유를 적고 열기" }));
  const more = (await screen.findAllByRole("button", { name: "더 보기" }))[0];
  expect(more).toBeTruthy();
  if (more) fireEvent.click(more);
  expect(screen.getByRole("button", { name: "접기" })).toBeTruthy();
  vi.restoreAllMocks();
});

it("상세 조회를 취소하면 목록을 다시 조작할 수 있다", async () => {
  let finish!: (v: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      url.includes("/orders/")
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(json(list)),
    ),
  );
  render(
    <MemoryRouter>
      <OperatorRecordsScreen
        shopId={shop}
        path={`/operator/shops/${shop}/records`}
        onNavigate={() => {}}
        onSessionExpired={() => {}}
      />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /K7Q3M9/ }));
  fireEvent.click(screen.getByRole("button", { name: "목록으로 돌아가기" }));
  expect((screen.getByRole("button", { name: "상담" }) as HTMLButtonElement).disabled).toBe(false);
  await act(async () => finish(json(order)));
  expect(screen.queryByText(/주문번호 K7Q3M9/)).toBeNull();
});
it("페이지 이탈과 복원 시 열린 원문과 사유를 즉시 지운다", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(json(url.includes("/originals") ? original : url.includes("/orders/") ? order : list)),
    ),
  );
  render(
    <MemoryRouter>
      <OperatorRecordsScreen
        shopId={shop}
        path={`/operator/shops/${shop}/records`}
        onNavigate={() => {}}
        onSessionExpired={() => {}}
      />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /K7Q3M9/ }));
  fireEvent.click(await screen.findByRole("button", { name: "주문자 원래 값 열기" }));
  fireEvent.change(screen.getByLabelText("사유"), { target: { value: "손님 문의 기록 확인" } });
  fireEvent.click(screen.getByRole("button", { name: "사유를 적고 열기" }));
  await screen.findByText("이지우");
  act(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  expect(screen.queryByText("이지우")).toBeNull();
  expect(screen.queryByText(/손님 문의 기록 확인/)).toBeNull();
  act(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  expect(screen.queryByText("이지우")).toBeNull();
});
it("상세 조회 오류의 재시도는 같은 주문을 다시 조회한다", async () => {
  let attempts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(url.includes("/orders/") ? (++attempts === 1 ? json({}, 404) : json(order)) : json(list)),
    ),
  );
  render(
    <MemoryRouter>
      <OperatorRecordsScreen
        shopId={shop}
        path={`/operator/shops/${shop}/records`}
        onNavigate={() => {}}
        onSessionExpired={() => {}}
      />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /K7Q3M9/ }));
  fireEvent.click(await screen.findByRole("button", { name: "다시 시도" }));
  expect(await screen.findByRole("button", { name: "주문자 원래 값 열기" })).toBeTruthy();
  expect(attempts).toBe(2);
});
it("목록에 주문 픽업과 보관 종료 시각, 상담 식별 정보를 보여 준다", async () => {
  const consultations = sample("/operator/shops/{shopId}/records", "consultations");
  consultations.consultations[0].orderNos = ["K7Q3M9"];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => Promise.resolve(json(url.includes("kind=consultations") ? consultations : list))),
  );
  render(
    <MemoryRouter>
      <OperatorRecordsScreen
        shopId={shop}
        path={`/operator/shops/${shop}/records`}
        onNavigate={() => {}}
        onSessionExpired={() => {}}
      />
    </MemoryRouter>,
  );
  const first = await screen.findByRole("button", { name: /K7Q3M9/ });
  expect(first.textContent).toContain("픽업");
  expect(screen.getByRole("button", { name: /H2W6Y1/ }).textContent).toContain("끝남");
  fireEvent.click(screen.getByRole("button", { name: "상담" }));
  expect((await screen.findByRole("button", { name: /K7Q3M9/ })).textContent).toContain("가린 번호 2");
});
it("원문 이름은 상태 코드와 같아도 변환하지 않는다", async () => {
  const value = structuredClone(original);
  value.orderContact.customerName = "paid";
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(json(url.includes("/originals") ? value : url.includes("/orders/") ? order : list)),
    ),
  );
  render(
    <MemoryRouter>
      <OperatorRecordsScreen
        shopId={shop}
        path={`/operator/shops/${shop}/records`}
        onNavigate={() => {}}
        onSessionExpired={() => {}}
      />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /K7Q3M9/ }));
  fireEvent.click(await screen.findByRole("button", { name: "주문자 원래 값 열기" }));
  fireEvent.change(screen.getByLabelText("사유"), { target: { value: "손님 문의 기록 확인" } });
  fireEvent.click(screen.getByRole("button", { name: "사유를 적고 열기" }));
  expect(await screen.findByText("paid")).toBeTruthy();
});
it("원문을 두지 않는 번호는 오류 뒤 다시 열 수 없다", async () => {
  const consultation = sample("/operator/shops/{shopId}/consultations/{consultationId}", "consultation");
  const consultations = sample("/operator/shops/{shopId}/records", "consultations");
  const problem =
    api.paths["/operator/shops/{shopId}/originals"].post.responses[409].content["application/problem+json"].examples
      .original_not_kept.value;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        url.includes("/originals")
          ? json(problem, 409)
          : json(url.includes("/consultations/") ? consultation : consultations),
      ),
    ),
  );
  render(
    <MemoryRouter>
      <OperatorRecordsScreen
        shopId={shop}
        path={`/operator/shops/${shop}/consultations/${consultation.consultationId}`}
        onNavigate={() => {}}
        onSessionExpired={() => {}}
      />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "원래 값 열기" }));
  fireEvent.change(screen.getByLabelText("사유"), { target: { value: "손님 문의 번호 확인" } });
  fireEvent.click(screen.getByRole("button", { name: "사유를 적고 열기" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.queryByRole("button", { name: "원래 값 열기" })).toBeNull();
});
it("삭제된 대화 글은 삭제 상태로 바꾸고 다시 열지 않는다", async () => {
  const consultation = sample("/operator/shops/{shopId}/consultations/{consultationId}", "consultation");
  const consultations = sample("/operator/shops/{shopId}/records", "consultations");
  const problem =
    api.paths["/operator/shops/{shopId}/originals"].post.responses[409].content["application/problem+json"].examples
      .original_erased.value;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        url.includes("/originals")
          ? json(problem, 409)
          : json(url.includes("/consultations/") ? consultation : consultations),
      ),
    ),
  );
  render(
    <MemoryRouter>
      <OperatorRecordsScreen
        shopId={shop}
        path={`/operator/shops/${shop}/consultations/${consultation.consultationId}`}
        onNavigate={() => {}}
        onSessionExpired={() => {}}
      />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "대화 글 열기" }));
  fireEvent.change(screen.getByLabelText("사유"), { target: { value: "손님 문의 내용 확인" } });
  fireEvent.click(screen.getByRole("button", { name: "사유를 적고 열기" }));
  expect(await screen.findByText("보관 기간 30일이 지나 대화를 지웠어요")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "대화 글 열기" })).toBeNull();
});
it("만료된 대화 페이지 증표는 현재 페이지를 다시 불러온다", async () => {
  const consultation = sample("/operator/shops/{shopId}/consultations/{consultationId}", "consultation");
  const consultations = sample("/operator/shops/{shopId}/records", "consultations");
  const problem = structuredClone(
    api.paths["/operator/shops/{shopId}/originals"].post.responses[422].content["application/problem+json"].examples
      .validation_failed.value,
  );
  problem.errors = [{ field: "/cursor", code: "bad_format" }];
  const fetch = vi.fn((url: string) =>
    Promise.resolve(
      url.includes("/originals")
        ? json(problem, 422)
        : json(url.includes("/consultations/") ? consultation : consultations),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  render(
    <MemoryRouter>
      <OperatorRecordsScreen
        shopId={shop}
        path={`/operator/shops/${shop}/consultations/${consultation.consultationId}`}
        onNavigate={() => {}}
        onSessionExpired={() => {}}
      />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "대화 글 열기" }));
  fireEvent.change(screen.getByLabelText("사유"), { target: { value: "손님 문의 내용 확인" } });
  fireEvent.click(screen.getByRole("button", { name: "사유를 적고 열기" }));
  fireEvent.click(await screen.findByRole("button", { name: "대화 페이지 다시 불러오기" }));
  await screen.findByRole("button", { name: "대화 글 열기" });
  expect(fetch.mock.calls.filter(([url]) => url.includes("/consultations/")).length).toBe(2);
});
it("추가 목록 조회 실패는 같은 커서로 다시 시도한다", async () => {
  const first = structuredClone(list);
  first.nextCursor = "next_cursor";
  let attempts = 0;
  const next = structuredClone(list);
  next.orders = [next.orders[1]];
  next.nextCursor = null;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        url.includes("cursor=next_cursor") ? (++attempts === 1 ? json({}, 500) : json(next)) : json(first),
      ),
    ),
  );
  render(
    <MemoryRouter>
      <OperatorRecordsScreen
        shopId={shop}
        path={`/operator/shops/${shop}/records`}
        onNavigate={() => {}}
        onSessionExpired={() => {}}
      />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "더 보기" }));
  fireEvent.click(await screen.findByRole("button", { name: "다시 시도" }));
  await waitFor(() => expect(attempts).toBe(2));
  expect(screen.getByRole("button", { name: /K7Q3M9/ })).toBeTruthy();
});
it("지워진 원문의 404는 목록으로 돌아가 같은 대상을 다시 열지 않는다", async () => {
  const problem =
    api.paths["/operator/shops/{shopId}/originals"].post.responses[404].content["application/problem+json"].examples
      .not_found.value;
  const fetch = vi.fn((url: string) =>
    Promise.resolve(url.includes("/originals") ? json(problem, 404) : json(url.includes("/orders/") ? order : list)),
  );
  vi.stubGlobal("fetch", fetch);
  render(
    <MemoryRouter>
      <OperatorRecordsScreen
        shopId={shop}
        path={`/operator/shops/${shop}/records`}
        onNavigate={() => {}}
        onSessionExpired={() => {}}
      />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /K7Q3M9/ }));
  fireEvent.click(await screen.findByRole("button", { name: "주문자 원래 값 열기" }));
  fireEvent.change(screen.getByLabelText("사유"), { target: { value: "손님 문의 기록 확인" } });
  fireEvent.click(screen.getByRole("button", { name: "사유를 적고 열기" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(await screen.findByText("찾을 수 없어요")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "주문자 원래 값 열기" })).toBeNull();
  await waitFor(() => expect(fetch.mock.calls.filter(([url]) => url.includes("/records?")).length).toBe(2));
});
it("원문을 연 주문이 보관 기록이 되면 갱신한 목록에서 보관 기록을 연다", async () => {
  const problem =
    api.paths["/operator/shops/{shopId}/originals"].post.responses[409].content["application/problem+json"].examples
      .original_erased.value;
  let requests = 0;
  const after = structuredClone(list);
  after.orders = [after.orders[1]];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        url.includes("/originals")
          ? json(problem, 409)
          : json(url.includes("/orders/") ? order : ++requests === 1 ? list : after),
      ),
    ),
  );
  render(
    <MemoryRouter>
      <OperatorRecordsScreen
        shopId={shop}
        path={`/operator/shops/${shop}/records`}
        onNavigate={() => {}}
        onSessionExpired={() => {}}
      />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /K7Q3M9/ }));
  fireEvent.click(await screen.findByRole("button", { name: "주문자 원래 값 열기" }));
  fireEvent.change(screen.getByLabelText("사유"), { target: { value: "손님 문의 기록 확인" } });
  fireEvent.click(screen.getByRole("button", { name: "사유를 적고 열기" }));
  await waitFor(() => expect(requests).toBe(2));
  fireEvent.click(await screen.findByRole("button", { name: /H2W6Y1/ }));
  expect(screen.getByRole("button", { name: "보관 기록 열기" })).toBeTruthy();
});
it("페이지 이탈 중 원문 요청의 늦은 결과를 버린다", async () => {
  let resolveOpen!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      url.includes("/originals")
        ? new Promise<Response>((resolve) => {
            resolveOpen = resolve;
          })
        : Promise.resolve(json(url.includes("/orders/") ? order : list)),
    ),
  );
  render(
    <MemoryRouter>
      <OperatorRecordsScreen
        shopId={shop}
        path={`/operator/shops/${shop}/records`}
        onNavigate={() => {}}
        onSessionExpired={() => {}}
      />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /K7Q3M9/ }));
  fireEvent.click(await screen.findByRole("button", { name: "주문자 원래 값 열기" }));
  fireEvent.change(screen.getByLabelText("사유"), { target: { value: "손님 문의 기록 확인" } });
  fireEvent.click(screen.getByRole("button", { name: "사유를 적고 열기" }));
  act(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  await act(async () => resolveOpen(json(original)));
  expect(screen.queryByText("이지우")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
});
