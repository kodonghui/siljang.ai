import { expect, it } from "vitest";
import { appendReviewRows, operatorEmptyMessage, operatorListHref, parseOperatorList } from "./operator-shops-query";

it("처음에는 확인 중인 가게를 읽는다", () => {
  expect(parseOperatorList("")).toEqual({ tab: "shops", status: "pending", cursor: null });
  expect(operatorListHref({ tab: "shops", status: "pending", cursor: null })).toBe("/operator/shops");
});
it.each(["?status=on_hold", "?status=verified", "?tab=identity", "?tab=identity&status=applied&cursor=opaque_cursor"])(
  "%s는 주소로 왕복한다",
  (search) => {
    const value = parseOperatorList(search);
    expect(value).not.toBeNull();
    if (!value) return;
    expect(parseOperatorList(new URL(operatorListHref(value), "https://example.org").search)).toEqual(value);
  },
);
it.each([
  "?status=applied",
  "?status=",
  "?tab=unknown",
  "?tab=identity&status=verified",
  "?cursor=bad%2Fcursor",
  "?cursor=",
  `?cursor=${"a".repeat(201)}`,
  "?status=pending&status=verified",
])("틀린 필터 %s는 목록을 요청하기 전에 거른다", (search) => expect(parseOperatorList(search)).toBeNull());
it("탭마다 맞는 빈 목록 문구를 낸다", () => {
  expect(operatorEmptyMessage({ tab: "shops", status: "on_hold", cursor: null })).toBe("보류한 가게가 없어요");
  expect(operatorEmptyMessage({ tab: "identity", status: "pending", cursor: null })).toBe("확인할 변경 요청이 없어요");
});
it("페이지를 다시 받아도 같은 행을 두 번 넣지 않고 새 값으로 바꾼다", () => {
  const old = [
      { id: "a", name: "이전 값" },
      { id: "b", name: "유지" },
    ],
    next = [
      { id: "a", name: "새 값" },
      { id: "c", name: "추가" },
    ];
  expect(appendReviewRows(old, next, (row) => row.id)).toEqual([
    { id: "a", name: "새 값" },
    { id: "b", name: "유지" },
    { id: "c", name: "추가" },
  ]);
  expect(old[0]?.name).toBe("이전 값");
});
