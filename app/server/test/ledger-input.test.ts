import { expect, it } from "vitest";
import { parseLedgerAuthorization, parseLedgerLink } from "../src/ledger-input";
import { ApiError } from "../src/problem";

const valid = {
  baseRevision: null,
  code: "fixture/code",
  state: "synthetic_state_123456",
  spreadsheetId: "synthetic_sheet_123456789",
  sheetName: "합성 장부",
};
function rejects(run: () => unknown, field: string) {
  try {
    run();
    throw new Error("거절하지 않았어요");
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("validation_failed");
    expect((error as ApiError).extras.errors?.[0]?.field).toBe(field);
    expect(JSON.stringify(error)).not.toContain(valid.code);
    expect(JSON.stringify(error)).not.toContain(valid.state);
  }
}
it("구글 인가 시작은 HTTPS 주소 한 개를 받는다", () => {
  expect(parseLedgerAuthorization({ redirectUri: "https://siljang.example/owner/ledger/callback" })).toEqual({
    redirectUri: "https://siljang.example/owner/ledger/callback",
  });
});
it("장부 연결은 서명·인가 코드·파일·탭과 nullable 버전을 보존한다", () => {
  expect(parseLedgerLink(valid)).toEqual(valid);
  expect(parseLedgerLink({ ...valid, baseRevision: "rev_01-v1.ok", sheetName: " 합성 탭 " })).toEqual({
    ...valid,
    baseRevision: "rev_01-v1.ok",
    sheetName: " 합성 탭 ",
  });
});
it("상한은 코드2048·서명512·파일100·탭100글자·버전64다", () => {
  const input = {
    baseRevision: "v".repeat(64),
    code: "c".repeat(2048),
    state: "s".repeat(512),
    spreadsheetId: "d".repeat(100),
    sheetName: "🍰".repeat(100),
  };
  expect(parseLedgerLink(input)).toEqual(input);
});
it.each([null, [], 1])("본문 객체가 아닌 입력은 값 없는422다(%s)", (input) => {
  rejects(() => parseLedgerAuthorization(input), "/");
  rejects(() => parseLedgerLink(input), "/");
});
it.each([
  "http://siljang.example/callback",
  "https://user:password@siljang.example/callback",
  "https://siljang.example/callback#token",
  "https://siljang.example/\ncallback",
  "not-an-address",
])("안전하지 않은 인가 복귀 주소는422다(%s)", (redirectUri) => {
  rejects(() => parseLedgerAuthorization({ redirectUri }), "/redirectUri");
});
it.each([
  [
    "missing revision",
    () => {
      const { baseRevision: _, ...rest } = valid;
      return rest;
    },
    "/baseRevision",
  ],
  ["bad revision", () => ({ ...valid, baseRevision: "bad/value" }), "/baseRevision"],
  ["blank code", () => ({ ...valid, code: "" }), "/code"],
  ["whitespace code", () => ({ ...valid, code: "synthetic code" }), "/code"],
  ["NUL code", () => ({ ...valid, code: "synthetic\0code" }), "/code"],
  ["long code", () => ({ ...valid, code: "c".repeat(2049) }), "/code"],
  ["short state", () => ({ ...valid, state: "short" }), "/state"],
  ["long state", () => ({ ...valid, state: "s".repeat(513) }), "/state"],
  ["bad state", () => ({ ...valid, state: "synthetic_state?x" }), "/state"],
  ["short file", () => ({ ...valid, spreadsheetId: "short" }), "/spreadsheetId"],
  ["long file", () => ({ ...valid, spreadsheetId: "s".repeat(101) }), "/spreadsheetId"],
  ["file URL", () => ({ ...valid, spreadsheetId: "https://example.com/file" }), "/spreadsheetId"],
  ["blank tab", () => ({ ...valid, sheetName: "  " }), "/sheetName"],
  ["NUL tab", () => ({ ...valid, sheetName: "합성\0탭" }), "/sheetName"],
  ["long tab", () => ({ ...valid, sheetName: "가".repeat(101) }), "/sheetName"],
  ["token field", () => ({ ...valid, accessToken: crypto.randomUUID() }), "/accessToken"],
] as const)("잘못된 장부 연결 %s는 값 없는422다", (_name, input, field) => {
  rejects(() => parseLedgerLink(input()), field);
});
it("인가 시작도 필요한 필드를 검사하고 토큰 같은 별도 필드를 받지 않는다", () => {
  rejects(() => parseLedgerAuthorization({}), "/redirectUri");
  rejects(
    () => parseLedgerAuthorization({ redirectUri: "https://siljang.example/callback", token: valid.code }),
    "/token",
  );
});
