import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import {
  fetchOperator,
  loginFeedback,
  loginFieldsAfterFailure,
  OPERATOR_ME_API,
  OPERATOR_SESSION_API,
  operatorReturnTo,
  signIn,
  signOut,
} from "./operator";

const fields = { email: "ops@example.org", password: "sample-password", otp: "001234" };
const identity = { operatorId: "00000000-0000-4000-8000-000000000001", displayName: "운영자 예시" };

afterEach(() => vi.unstubAllGlobals());

describe("TASK-031 운영자 화면의 계약", () => {
  it("06 API-004~006 x-corthex ID와 경로를 사용", () => {
    const api = parse(readFileSync(new URL("../../../api/openapi.yaml", import.meta.url), "utf8"));
    expect(api.paths[OPERATOR_SESSION_API].post["x-corthex"].id).toBe("API-004");
    expect(api.paths[OPERATOR_ME_API].get["x-corthex"].id).toBe("API-005");
    expect(api.paths[OPERATOR_SESSION_API].delete["x-corthex"].id).toBe("API-006");
    expect(api.paths[OPERATOR_SESSION_API].post.requestBody.content["application/json"].schema.$ref).toBe(
      "#/components/schemas/OperatorSessionInput",
    );
  });

  it("세 요청만 같은 출처에서 보냄. 로그인에만 본문을 보냄", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(identity)))
      .mockResolvedValueOnce(new Response(JSON.stringify(identity)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const abort = new AbortController();
    expect((await signIn(fields, abort.signal)).ok).toBe(true);
    expect((await fetchOperator(abort.signal)).ok).toBe(true);
    expect((await signOut(abort.signal)).ok).toBe(true);
    expect(
      fetchMock.mock.calls.map(([url, init]) => [url, init.method, init.credentials, init.cache, init.body]),
    ).toEqual([
      ["/api/operator/session", "POST", "same-origin", "no-store", JSON.stringify(fields)],
      ["/api/operator/me", "GET", "same-origin", "no-store", undefined],
      ["/api/operator/session", "DELETE", "same-origin", "no-store", undefined],
    ]);
  });

  it("200 응답에 운영자 객체가 없으면 화면을 열 수 없음", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ownerId: "owner" }))));
    expect((await fetchOperator(new AbortController().signal)).ok).toBe(false);
  });

  it.each([
    "//example.org/operator/shops",
    "https://example.org/operator/shops",
    "/operator/../../owner",
    "/operator/login",
    "/operator/unknown",
    "\\\\example.org\\operator\\shops",
  ])("돌아갈 수 없는 주소 %s", (value) => expect(operatorReturnTo(value)).toBeNull());

  it("07의 운영자 화면 주소와 쿼리·해시로 돌아감", () => {
    const path = "/operator/shops/shop-1/orders/order-1?tab=history#event";
    expect(operatorReturnTo(path)).toBe(path);
  });

  it.each([
    [401, { email: "", password: "", otp: "" }],
    [422, { ...fields, password: "" }],
    [429, fields],
    [503, { ...fields, password: "", otp: "" }],
    [500, { ...fields, password: "", otp: "" }],
  ])("%s 실패 뒤 표시할 필드", (status, expected) => {
    expect(loginFieldsAfterFailure(fields, status)).toEqual(expected);
  });

  it("세션 실패 401은 필드와 무관한 공통 문구", () => {
    expect(loginFeedback({ ok: false, status: 401, problem: null, retryAfterSeconds: null })).toMatchObject({
      message: "로그인 정보가 맞지 않아요",
      fieldErrors: [],
    });
  });

  it("429는 Retry-After 초로 잠금 시간을 표시", () => {
    expect(loginFeedback({ ok: false, status: 429, problem: null, retryAfterSeconds: 37 })).toMatchObject({
      message: "잠시 뒤 다시 로그인해 주세요",
      retryAfterSeconds: 37,
    });
  });
});
