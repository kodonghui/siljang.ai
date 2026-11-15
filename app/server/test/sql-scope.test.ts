import { describe, expect, it } from "vitest";
import { namesShopTable, scopeViolations, stripSql } from "../src/sql-scope";

// 가게 조건 검사(TASK-019, 05 A9): 가게 테이블마다 shop_id = $1이 확실히 걸린 SQL만 통과한다.
describe("가게 조건 검사: 지킨 SQL", () => {
  const good: Record<string, string> = {
    "별칭과 가게 조건": "SELECT o.id FROM orders o WHERE o.shop_id = $1 AND o.id = $2",
    "테이블 하나면 별칭 없이": "SELECT id FROM orders WHERE shop_id = $1 AND id = $2",
    "JOIN은 앞 테이블의 shop_id로": `SELECT o.id, c.kakao_user_key FROM orders o
      JOIN customers c ON c.shop_id = o.shop_id AND c.id = o.customer_id WHERE o.shop_id = $1`,
    "LEFT JOIN의 ON에 $1":
      "SELECT o.id FROM orders o LEFT JOIN payments p ON p.shop_id = $1 AND p.order_id = o.id WHERE o.shop_id = $1",
    UPDATE: "UPDATE orders o SET version = o.version + 1 WHERE o.shop_id = $1 AND o.id = $2 RETURNING o.version",
    "UPDATE … FROM": `UPDATE orders o SET status = 'x' FROM customers c
      WHERE o.shop_id = $1 AND c.shop_id = o.shop_id AND c.id = o.customer_id`,
    DELETE: "DELETE FROM designs d WHERE d.shop_id = $1 AND d.id = $2",
    "INSERT VALUES":
      "INSERT INTO designs (shop_id, price_list_id, name, image_key) VALUES ($1, $2, $3, $4) RETURNING id",
    "INSERT 여러 줄": "INSERT INTO price_lists (shop_id, version) VALUES ($1, $2), ($1::uuid, $3)",
    "INSERT … SELECT": `INSERT INTO designs (shop_id, price_list_id, name, image_key)
      SELECT $1, $2, d.name, d.image_key FROM designs d WHERE d.shop_id = $1 AND d.id = ANY($3::uuid[])`,
    "ON CONFLICT 대상에 shop_id": `INSERT INTO slot_holds (shop_id, day, hold_key) VALUES ($1, $2, $3)
      ON CONFLICT (shop_id, hold_key) DO UPDATE SET day = excluded.day`,
    "ON CONFLICT DO NOTHING":
      "INSERT INTO slot_holds (shop_id, day, hold_key) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    "가게 자체": "SELECT s.name FROM shops s WHERE s.id = $1",
    "괄호 안의 OR": "SELECT o.id FROM orders o WHERE o.shop_id = $1 AND (o.status = 'a' OR o.status = 'b')",
    "감싼 괄호": "SELECT o.id FROM orders o WHERE (o.shop_id = $1 AND o.id = $2)",
    "EXISTS 안은 바깥 shop_id로": `SELECT o.id FROM orders o WHERE o.shop_id = $1
      AND EXISTS (SELECT 1 FROM payments p WHERE p.shop_id = o.shop_id AND p.order_id = o.id)`,
    "고른 열의 하위 질의": `SELECT o.id, (SELECT c.kakao_user_key FROM customers c WHERE c.shop_id = o.shop_id AND c.id = o.customer_id) AS k
      FROM orders o WHERE o.shop_id = $1`,
    WITH: "WITH mine AS (SELECT o.id FROM orders o WHERE o.shop_id = $1) SELECT m.id FROM mine m",
    "형 바꾸기": "SELECT count(*) FROM messages m WHERE m.shop_id = $1::uuid",
    "FOR UPDATE": "SELECT o.id FROM orders o WHERE o.shop_id = $1 AND o.id = $2 FOR UPDATE",
    BETWEEN: "SELECT o.id FROM orders o WHERE o.created_at BETWEEN $2 AND $3 AND o.shop_id = $1",
    "글자 값과 주석 안의 이름": `SELECT 'FROM orders' AS label, k.id FROM kakao_channels k -- JOIN customers
      WHERE k.shop_id = $1 /* OR true */`,
    "따옴표 이름": 'SELECT o.id FROM "orders" o WHERE o."shop_id" = $1',
    "public 스키마": "SELECT o.id FROM public.orders o WHERE o.shop_id = $1",
    "함수 안의 FROM": "SELECT extract(epoch from o.created_at) FROM orders o WHERE o.shop_id = $1",
    "가게 테이블이 없음": "SELECT state FROM request_keys WHERE actor_kind = $1 AND actor_id = $2",
  };
  for (const [name, sql] of Object.entries(good)) {
    it(name, () => {
      expect(scopeViolations(sql)).toEqual([]);
    });
  }
});

describe("가게 조건 검사: 어긴 SQL", () => {
  const bad: Record<string, [string, string]> = {
    "가게 조건 없음": ["SELECT o.id FROM orders o WHERE o.id = $2", "unscoped orders o"],
    "OR로 풀린 가게 조건": ["SELECT o.id FROM orders o WHERE o.shop_id = $1 OR o.id = $2", "unscoped orders o"],
    "다른 값과 견줌": [
      "SELECT o.id FROM orders o WHERE o.shop_id = $2",
      "compare shop_id with something other than $1",
    ],
    "ANY로 여러 가게": [
      "SELECT o.id FROM orders o WHERE o.shop_id = ANY($2)",
      "compare shop_id with something other than $1",
    ],
    "JOIN에 가게 조건 없음": [
      "SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.shop_id = $1",
      "unscoped customers c",
    ],
    "쉼표로 이은 FROM": [
      "SELECT o.id FROM orders o, customers c WHERE o.shop_id = $1 AND c.id = o.customer_id",
      "unscoped customers c",
    ],
    "JOIN … USING은 치지 않음": [
      "SELECT o.id FROM orders o JOIN payments p USING (shop_id) WHERE o.shop_id = $1",
      "unscoped payments p",
    ],
    "하위 질의 안의 조건은 바깥을 묶지 않음": [
      "SELECT o.id FROM orders o WHERE o.id = $2 OR EXISTS (SELECT 1 FROM shops s WHERE s.id = $1 AND o.shop_id = $1)",
      "unscoped orders o",
    ],
    "LEFT JOIN의 ON은 앞 테이블을 묶지 않음": [
      "SELECT o.id FROM orders o LEFT JOIN customers c ON c.shop_id = $1 AND o.shop_id = $1",
      "unscoped orders o",
    ],
    "RIGHT JOIN의 ON은 묶지 않음": [
      "SELECT x.id FROM customers c RIGHT JOIN orders x ON x.shop_id = $1 AND c.shop_id = x.shop_id",
      "unscoped orders x",
    ],
    "UNION의 다른 조각": [
      "SELECT o.id FROM orders o WHERE o.shop_id = $1 UNION SELECT p.id FROM orders p",
      "unscoped orders p",
    ],
    "테이블 둘에 별칭 없는 shop_id": [
      "SELECT o.id FROM orders o JOIN customers c ON c.shop_id = o.shop_id WHERE shop_id = $1",
      "unscoped orders o",
    ],
    NOT: ["SELECT id FROM orders WHERE NOT (shop_id = $1)", "unscoped orders orders"],
    "UPDATE에 조건 없음": ["UPDATE orders SET status = 'x'", "unscoped orders orders"],
    "다른 가게로 옮기기": [
      "UPDATE orders o SET shop_id = $2 WHERE o.shop_id = $1 AND o.id = $3",
      "compare shop_id with something other than $1",
    ],
    "DELETE에 조건 없음": ["DELETE FROM designs WHERE id = $2", "unscoped designs designs"],
    "INSERT의 shop_id가 첫 열이 아님": [
      "INSERT INTO designs (price_list_id, shop_id) VALUES ($2, $1)",
      "insert designs designs",
    ],
    "INSERT의 shop_id 값이 $1이 아님": [
      "INSERT INTO designs (shop_id, name) VALUES ($2, $3)",
      "insert designs designs",
    ],
    "INSERT 열 목록 없음": [
      "INSERT INTO designs SELECT * FROM designs d WHERE d.shop_id = $1",
      "insert designs designs",
    ],
    "INSERT 둘째 줄": [
      "INSERT INTO price_lists (shop_id, version) VALUES ($1, $2), ($3, $4)",
      "insert price_lists price_lists",
    ],
    "ON CONFLICT 대상에 shop_id 없음": [
      "INSERT INTO slot_holds (shop_id, id, day) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET day = excluded.day",
      "conflict update without shop_id",
    ],
    "같은 별칭 둘": ["SELECT 1 FROM orders o JOIN payments o ON true WHERE o.shop_id = $1", "alias o repeated"],
    "가게 테이블 이름을 별칭으로": [
      "SELECT customers.id FROM orders customers WHERE customers.shop_id = $1",
      "alias customers is a shop table name",
    ],
    "TABLE 문": ["TABLE orders", "statement table"],
    LOCK: ["LOCK TABLE orders", "name orders outside from"],
    "문장 둘": ["SELECT o.id FROM orders o WHERE o.shop_id = $1; DELETE FROM orders", "statement ;"],
    "테이블 이름을 가린 WITH": [
      "WITH orders AS (SELECT * FROM payments p WHERE p.shop_id = $1) SELECT * FROM orders",
      "name orders outside from",
    ],
  };
  for (const [name, [sql, expected]] of Object.entries(bad)) {
    it(name, () => {
      expect(scopeViolations(sql)).toContain(expected);
    });
  }
});

describe("SQL 글 다듬기", () => {
  it("주석·글자 값·$$ 글을 비우고 소문자로", () => {
    const s = stripSql(
      `SELECT 'orders' , $$customers$$, E'a\\'b orders' FROM "Orders" -- payments\n/* designs /* nested */ x */`,
    );
    expect(s).not.toMatch(/customers|payments|designs/);
    expect(s).toContain("orders");
    expect(s).not.toMatch(/[A-Z]/);
  });

  it("$1·$2는 $$ 글로 보지 않음", () => {
    expect(stripSql("WHERE a = $1 AND b = $2")).toBe("where a = $1 and b = $2");
  });

  it("가게 테이블 이름이 있는 SQL만 고름", () => {
    expect(namesShopTable("SELECT 1 FROM orders o")).toBe(true);
    expect(namesShopTable("SELECT 1 FROM request_keys")).toBe(false);
    expect(namesShopTable("SELECT 'orders'")).toBe(false);
  });
});
