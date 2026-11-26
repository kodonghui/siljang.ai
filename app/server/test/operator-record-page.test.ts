import { expect, it } from "vitest";
import { sealOperatorRecordCursor } from "../src/operator-record-cursor";
import {
  OperatorRecordPageError,
  openOperatorRecordPage,
  operatorRecordPageHash,
  sealOperatorRecordPage,
} from "../src/operator-record-page";
import { newFieldKey, singleKeyCrypto, testFieldCrypto } from "./support/field-keys";

const NOW = new Date("2026-11-28T06:00:00Z"),
  scope = { shopId: crypto.randomUUID(), consultationId: crypto.randomUUID(), operatorId: crypto.randomUUID() },
  id = crypto.randomUUID();
const page = {
  first: { at: "2026-11-28T06:00:00.000001Z", key: "9007199254740993" },
  last: { at: "2026-11-28T06:00:00.000002Z", key: "9223372036854775807" },
  messageIds: [id, crypto.randomUUID()],
};
it("현재 페이지 증표는 세 범위·정밀 위치·ID해시를 보존하고189~191자로 가린다", async () => {
  const { fc } = singleKeyCrypto(),
    token = await sealOperatorRecordPage(fc, scope, page, NOW);
  expect(token).toMatch(/^[A-Za-z0-9_-]{189,191}$/);
  for (const value of [id, scope.operatorId, page.first.key, page.first.at]) expect(token).not.toContain(value);
  expect(await openOperatorRecordPage(fc, scope, token, NOW)).toEqual({
    first: page.first,
    last: page.last,
    idsHash: await operatorRecordPageHash(page.messageIds),
  });
});
it("빈 페이지도 빈 범위와 빈ID해시로만 연다", async () => {
  const { fc } = singleKeyCrypto(),
    token = await sealOperatorRecordPage(fc, scope, { first: null, last: null, messageIds: [] }, NOW);
  expect(await openOperatorRecordPage(fc, scope, token, NOW)).toEqual({
    first: null,
    last: null,
    idsHash: await operatorRecordPageHash([]),
  });
});
it("ID해시는 순서·개수·중간 삽입이 바뀌면 같지 않다", async () => {
  const b = crypto.randomUUID();
  expect(await operatorRecordPageHash([id, b])).not.toBe(await operatorRecordPageHash([b, id]));
  expect(await operatorRecordPageHash([id])).not.toBe(await operatorRecordPageHash([id, b]));
});
it.each(["shopId", "consultationId", "operatorId"] as const)(
  "다른 %s는 같은 키로도 증표를 열지 못한다",
  async (key) => {
    const { fc } = singleKeyCrypto(),
      token = await sealOperatorRecordPage(fc, scope, page, NOW);
    await expect(
      openOperatorRecordPage(fc, { ...scope, [key]: crypto.randomUUID() }, token, NOW),
    ).rejects.toBeInstanceOf(OperatorRecordPageError);
  },
);
it("10분 만료·미래 시계·암호문 변조는 같은 값 없는 오류다", async () => {
  const { fc } = singleKeyCrypto(),
    token = await sealOperatorRecordPage(fc, scope, page, NOW);
  for (const at of [new Date(NOW.getTime() + 600000), new Date(NOW.getTime() - 1)])
    await expect(openOperatorRecordPage(fc, scope, token, at)).rejects.toBeInstanceOf(OperatorRecordPageError);
  const at = token.length - 8;
  const changed = token.slice(0, at) + (token[at] === "A" ? "B" : "A") + token.slice(at + 1);
  await expect(openOperatorRecordPage(fc, scope, changed, NOW)).rejects.toBeInstanceOf(OperatorRecordPageError);
});
it("목록의 다음 페이지 커서를 글 열기 증표로 쓰지 못한다", async () => {
  const { fc } = singleKeyCrypto(),
    token = await sealOperatorRecordCursor(
      fc,
      { shopId: scope.shopId, resourceId: scope.consultationId, kind: "messages" },
      page.last,
    );
  await expect(openOperatorRecordPage(fc, scope, token, NOW)).rejects.toBeInstanceOf(OperatorRecordPageError);
});
it("키를 바꾼 뒤에도 앞 키 증표는 같은 범위에서만 연다", async () => {
  const { keys, fc } = singleKeyCrypto(),
    token = await sealOperatorRecordPage(fc, scope, page, NOW),
    rotated = testFieldCrypto(new Map([...keys, [2, newFieldKey()]]), 2);
  expect((await openOperatorRecordPage(rotated, scope, token, NOW)).idsHash).toBe(
    await operatorRecordPageHash(page.messageIds),
  );
});
it.each(["0001-01-01T00:00:00.000001Z", "1969-12-31T23:59:59.999999Z", "9999-12-31T23:59:59.999999Z"])(
  "시각 경계 %s의 마이크로초를 잃지 않는다",
  async (at) => {
    const { fc } = singleKeyCrypto(),
      bounds = { first: { at, key: "1" }, last: { at, key: "2" }, messageIds: page.messageIds },
      token = await sealOperatorRecordPage(fc, scope, bounds, NOW);
    expect(await openOperatorRecordPage(fc, scope, token, NOW)).toMatchObject({
      first: bounds.first,
      last: bounds.last,
    });
  },
);
it.each([{ ids: [] }, { ids: [id, id] }, { ids: Array.from({ length: 21 }, () => crypto.randomUUID()) }])(
  "빈 범위와 맞지 않거나 중복/과다 ID는 발급하지 않는다",
  async ({ ids }) => {
    const { fc } = singleKeyCrypto();
    await expect(sealOperatorRecordPage(fc, scope, { ...page, messageIds: ids }, NOW)).rejects.toBeInstanceOf(
      OperatorRecordPageError,
    );
  },
);
