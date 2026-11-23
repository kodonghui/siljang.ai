import { expect, it } from "vitest";
import { operatorAlertsHref, parseOperatorAlertsSearch } from "./operator-alerts-query";

it("처음 알림은20개와 빈 커서다", () => expect(parseOperatorAlertsSearch("")).toEqual({ limit: 20, cursor: null }));
it("공유 주소의 한도와 커서를 왕복한다", () => {
  const query = { limit: 100, cursor: "synthetic_cursor" };
  const href = operatorAlertsHref(query);
  expect(href).toBe("/operator/alerts?limit=100&cursor=synthetic_cursor");
  expect(parseOperatorAlertsSearch(href.split("?")[1] ?? "")).toEqual(query);
  expect(operatorAlertsHref({ limit: 20, cursor: null })).toBe("/operator/alerts");
});
it.each([
  "?limit=0",
  "?limit=101",
  "?limit=1.5",
  "?limit=bad",
  "?cursor=",
  "?cursor=bad%2Fcursor",
  "?cursor=a&cursor=b",
  "?limit=20&limit=30",
])("틀린 페이지 주소 %s", (search) => expect(parseOperatorAlertsSearch(search)).toBeNull());
