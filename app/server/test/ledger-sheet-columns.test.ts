import { describe, expect, it } from "vitest";
import {
  LEDGER_HEADERS,
  LEDGER_MAX_COLUMNS,
  LedgerColumnsOverflowError,
  type LedgerSheetScope,
  ledgerColumnName,
  planLedgerColumns,
  signLedgerColumns,
  verifyLedgerColumns,
} from "../src/ledger-sheet-columns";
import { Secret } from "../src/settings";

const scope: LedgerSheetScope = {
  shopId: "10000000-0000-4000-8000-000000000001",
  spreadsheetId: "sheet_fixture_id_000000000000000000000001",
  sheetId: 3,
};
const key = () => new Secret(crypto.randomUUID() + crypto.randomUUID());
const N = LEDGER_HEADERS.length;
describe("장부 열은 가게/시트/위치/헤더 버전의 서명으로만 재사용한다", () => {
  it.each([
    [0, "A"],
    [25, "Z"],
    [26, "AA"],
    [701, "ZZ"],
    [702, "AAA"],
    [18277, "ZZZ"],
  ] as const)("0부터 센 열 %s는 %s다", (n, label) => {
    expect(ledgerColumnName(n)).toBe(label);
  });
  it.each([-1, 1.5, 18278, Number.NaN])("잘못된 열 번호 %s를 거절한다", (n) => {
    expect(() => ledgerColumnName(n)).toThrow();
  });
  it("빈 표도 기존 열 바깥을 늘려 아래쪽에 있던 사장님 자료를 덮지 않는다", () => {
    const plan = planLedgerColumns(26, []);
    expect(plan).toMatchObject({ start: 26, end: 26 + N, movedRight: false, needsWrite: true });
    expect(plan.columns).toEqual(LEDGER_HEADERS.map((header, i) => ({ header, column: ledgerColumnName(26 + i) })));
  });
  it("우리와 같은 이름의 사장님 열은 고치지 않고 오른쪽에 만든다고 알린다", () => {
    const headers = ["주문번호", "사장님 메모", "금액"];
    const before = [...headers],
      plan = planLedgerColumns(26, headers);
    expect(plan).toMatchObject({ start: 26, end: 26 + N, movedRight: true, needsWrite: true });
    expect(headers).toEqual(before);
  });
  it("서명된 실제 위치와 헤더가 모두 같으면 재연결에서 외부 쓰기가 없다", async () => {
    const secret = key(),
      token = await signLedgerColumns(secret, scope, 26, false);
    expect(token).toMatch(/^c1\.[a-z0-9]+\.[01]\.[A-Za-z0-9_-]{43}$/);
    expect(token).not.toContain(scope.shopId);
    expect(token).not.toContain(scope.spreadsheetId);
    const verified = await verifyLedgerColumns(secret, scope, token, 26, 26 + N);
    expect(verified).not.toBeNull();
    const headers = [...Array(26).fill(""), ...LEDGER_HEADERS];
    expect(planLedgerColumns(26 + N, headers, verified)).toMatchObject({
      start: 26,
      end: 26 + N,
      movedRight: false,
      needsWrite: false,
    });
  });
  it.each([
    { ...scope, shopId: "10000000-0000-4000-8000-000000000002" },
    { ...scope, spreadsheetId: `${scope.spreadsheetId}2` },
    { ...scope, sheetId: 4 },
  ])("다른 가게/시트 파일/탭의 서명은 재사용하지 못한다 %j", async (altered) => {
    const secret = key(),
      token = await signLedgerColumns(secret, scope, 26, true);
    expect(await verifyLedgerColumns(secret, scope, token, 26, 26 + N)).not.toBeNull();
    expect(await verifyLedgerColumns(secret, altered, token, 26, 26 + N)).toBeNull();
  });
  it("범위 이동·알림 값/서명 변조·다른 키·비표준 인코딩은 닫는다", async () => {
    const secret = key(),
      token = await signLedgerColumns(secret, scope, 26, true);
    expect(await verifyLedgerColumns(secret, scope, token, 26, 26 + N)).not.toBeNull();
    for (const [a, b] of [
      [25, 25 + N],
      [26, 27 + N],
      [26, 25 + N],
    ])
      expect(await verifyLedgerColumns(secret, scope, token, a as number, b as number)).toBeNull();
    expect(await verifyLedgerColumns(key(), scope, token, 26, 26 + N)).toBeNull();
    for (const changed of [token.replace(".1.", ".0."), `${token}=`, token.replace("c1.", "c2."), token.slice(0, -1)])
      expect(await verifyLedgerColumns(secret, scope, changed, 26, 26 + N)).toBeNull();
  });
  it("흉내 낸 검증 결과는 위치가 맞아도 사장님 열을 덮을 근거가 아니다", () => {
    expect(() => planLedgerColumns(26, [...LEDGER_HEADERS], { start: 0, end: N, movedRight: false })).toThrow();
  });
  it("우리 헤더를 지우거나 고쳤으면 그 열을 덮지 않고 새 열을 만든다", async () => {
    const secret = key(),
      token = await signLedgerColumns(secret, scope, 0, false),
      verified = await verifyLedgerColumns(secret, scope, token, 0, N);
    expect(verified).not.toBeNull();
    const headers: string[] = [...LEDGER_HEADERS];
    headers[0] = "사장님 메모";
    expect(planLedgerColumns(26, headers, verified)).toMatchObject({
      start: 26,
      end: 26 + N,
      needsWrite: true,
      movedRight: true,
    });
    expect(headers[0]).toBe("사장님 메모");
  });
  it("열 상한이어도 검증한 열은 쓰고 새 열을 늘릴 수 없으면 거절한다", async () => {
    expect(() => planLedgerColumns(LEDGER_MAX_COLUMNS, [])).toThrow(LedgerColumnsOverflowError);
    const secret = key(),
      start = LEDGER_MAX_COLUMNS - N,
      token = await signLedgerColumns(secret, scope, start, true),
      verified = await verifyLedgerColumns(secret, scope, token, start, LEDGER_MAX_COLUMNS);
    expect(verified).not.toBeNull();
    expect(
      planLedgerColumns(LEDGER_MAX_COLUMNS, [...Array(start).fill(""), ...LEDGER_HEADERS], verified),
    ).toMatchObject({ start, end: LEDGER_MAX_COLUMNS, movedRight: true, needsWrite: false });
  });
  it.each([0, -1, 1.5, 18279])("잘못된 표 너비 %s에서는 쓰기 계획을 만들지 않는다", (n) => {
    expect(() => planLedgerColumns(n, [])).toThrow();
  });
});
