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
    "public 스키마": "SELECT o.id FROM public.orders o WHERE o.shop_id = $1",
    "함수 안의 FROM": "SELECT extract(epoch from o.created_at) FROM orders o WHERE o.shop_id = $1",
    "가게 테이블이 없음": "SELECT state FROM request_keys WHERE actor_kind = $1 AND actor_id = $2",
    "테이블 이름으로 쓴 열": "SELECT orders.id FROM orders WHERE orders.shop_id = $1",
    "INSERT … SELECT의 하위 질의 안 UNION": `INSERT INTO designs (shop_id, price_list_id, name, image_key)
      SELECT $1, $2, x.name, x.image_key FROM (SELECT d.name, d.image_key FROM designs d WHERE d.shop_id = $1
        UNION ALL SELECT e.name, e.image_key FROM designs e WHERE e.shop_id = $1) x`,
    "여러 열 꼴 SET(shop_id 없음)":
      "UPDATE orders o SET (status, version) = ($2, o.version + 1) WHERE o.shop_id = $1 AND o.id = $3",
    "NOT BETWEEN SYMMETRIC 뒤의 가게 조건":
      "SELECT o.id FROM orders o WHERE o.created_at NOT BETWEEN SYMMETRIC $2 AND $3 AND o.shop_id = $1",
    "CASE … END 뒤의 가게 조건":
      "SELECT o.id FROM orders o WHERE CASE WHEN o.status = $2 THEN 1 ELSE 0 END = 1 AND o.shop_id = $1",
    "배열 [ ] 뒤의 가게 조건": "SELECT o.id FROM orders o WHERE ARRAY[o.status] <@ ARRAY[$2, $3] AND o.shop_id = $1",
    "겹치지 않는 하위 질의 별칭": `SELECT o.id, (SELECT count(*) FROM payments p WHERE p.shop_id = o.shop_id) AS n
      FROM orders o, (SELECT 1) AS x WHERE o.shop_id = $1`,
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
    // Codex 검토(PR #61): INSERT 값의 원천을 UNION으로 이으면 뒤 조각의 shop_id를 보지 않았음
    "INSERT … SELECT를 UNION으로 이은 다른 가게 값": [
      "INSERT INTO price_lists (shop_id, version) SELECT $1, 42 UNION ALL SELECT $2, 42",
      "insert price_lists price_lists",
    ],
    "INSERT VALUES 뒤에 UNION으로 이은 다른 가게 값": [
      "INSERT INTO price_lists (shop_id, version) VALUES ($1, 42) UNION ALL SELECT $2, 43",
      "insert price_lists price_lists",
    ],
    // Codex 검토(PR #61): 여러 열 꼴 SET은 = 옆이 괄호라 shop_id를 넣는 것을 보지 않았음
    "여러 열 꼴 SET으로 다른 가게로 옮기기": [
      "UPDATE price_lists SET (shop_id, version) = ($2, $3) WHERE shop_id = $1",
      "set shop_id",
    ],
    "ON CONFLICT의 여러 열 꼴 SET": [
      `INSERT INTO slot_holds (shop_id, day, hold_key) VALUES ($1, $2, $3)
       ON CONFLICT (shop_id, hold_key) DO UPDATE SET day = excluded.day, (shop_id) = ROW($4)`,
      "set shop_id",
    ],
    "하위 질의의 shop_id를 넣어 옮기기": [
      "UPDATE orders o SET shop_id = x.shop_id FROM (SELECT $2::uuid AS shop_id) x WHERE o.shop_id = $1 AND o.id = $3",
      "set shop_id",
    ],
    // Codex 검토(PR #61): 안쪽의 TABLE 스키마.이름은 테이블로도, 막을 이름으로도 보지 않았음
    "WITH 안의 TABLE public.이름": [
      "WITH leaked AS (TABLE public.orders) SELECT * FROM leaked",
      "name orders outside from",
    ],
    "하위 질의의 TABLE public.이름": ["SELECT * FROM (TABLE public.orders) x", "name orders outside from"],
    // 같은 갈래: 검사가 테이블 이름이나 SQL을 보지 못하는 꼴
    "유니코드 이스케이프 이름": ['SELECT * FROM U&"\\006Frders" o', "unicode escape"],
    "SQL 글을 실행하는 내장 함수": [
      "SELECT query_to_xml('SELECT * FROM orders', true, true, '') FROM shops s WHERE s.id = $1",
      "function query_to_xml",
    ],
    "테이블을 통째로 읽는 내장 함수": [
      "SELECT table_to_xml('orders', true, true, '') FROM shops s WHERE s.id = $1",
      "function table_to_xml",
    ],
    // 같은 갈래: 값을 자르는 형 바꾸기(char는 첫 글자만)로 묶은 것처럼 보임
    "자르는 형 바꾸기로 묶기": ["SELECT o.id FROM orders o WHERE o.shop_id::char = $1::char", "unscoped orders o"],
    "자르는 형 바꾸기로 JOIN": [
      "SELECT o.id FROM orders o JOIN payments p ON p.shop_id::char = o.shop_id::char WHERE o.shop_id = $1",
      "unscoped payments p",
    ],
    "설정을 바꾸는 내장 함수(글 읽기·이름 찾기가 바뀜)": [
      "SELECT set_config('standard_conforming_strings', 'off', false) FROM shops s WHERE s.id = $1",
      "function set_config",
    ],
    // 같은 갈래: SQL 글 다듬기가 PostgreSQL과 다르게 읽어 코드를 글로 지움(PostgreSQL 16.15에서 셋 모두 customers 전체를 읽음)
    "줄 주석은 \\r에서도 끝남": ["SELECT c.kakao_user_key --\rFROM customers c", "unscoped customers c"],
    "ASCII가 아닌 이름 글자 뒤의 $$는 글의 시작이 아님": [
      "SELECT 1 AS é$$ FROM customers c -- $$",
      "unscoped customers c",
    ],
    "ASCII가 아닌 $태그$": ["SELECT $é$ $$ $é$ AS x, c.kakao_user_key FROM customers c -- $$", "unscoped customers c"],
    "숫자 뒤의 $$도 글의 시작(PostgreSQL은 이 꼴을 문법 오류로 거절하지만 읽기를 같게)": [
      "SELECT 1$$ $$ AS x, c.kakao_user_key FROM customers c -- $$",
      "unscoped customers c",
    ],
    // 따옴표 이름은 PostgreSQL에서 이름 하나다(점·공백·=·대문자를 그대로 둠). 검사가 따옴표를 벗겨 여러 낱말로 읽으면
    // 없는 가게 조건을 보게 된다(PostgreSQL 16.15에서 첫 꼴은 customers 전체를 읽음). 소문자 낱말이 아닌 따옴표 이름은 막는다.
    "따옴표 이름 안의 점": [
      'SELECT c.kakao_user_key FROM customers c, (SELECT $1::uuid AS "c.shop_id") s WHERE "c.shop_id" = $1',
      "quoted name",
    ],
    "따옴표 이름 안의 조건 글": [
      'SELECT c.kakao_user_key FROM customers c, (SELECT true AS "c.shop_id = $1") s WHERE "c.shop_id = $1"',
      "quoted name",
    ],
    "대문자 따옴표 이름(소문자 이름과 다른 이름)": ['SELECT o.id FROM "Orders" o WHERE o.shop_id = $1', "quoted name"],
    // 소문자 낱말인 따옴표 이름도 막는다: "and"·"end"처럼 따옴표로 쓴 예약어는 PostgreSQL에서 이름인데 검사는 예약어로 읽는다
    // (아래 둘째 꼴은 PostgreSQL 16.15에서 orders 전체를 읽음). 서버 코드의 SQL은 따옴표 이름을 쓰지 않는다.
    "소문자 따옴표 이름": ['SELECT o.id FROM "orders" o WHERE o."shop_id" = $1', "quoted name"],
    "따옴표로 쓴 예약어": [
      'SELECT o.id FROM orders o, (SELECT false AS "and") d WHERE false BETWEEN "and" AND (o.shop_id = $1)',
      "quoted name",
    ],
    // 잇는 AND가 아닌 AND(Codex 검토): BETWEEN의 짝 AND, CASE … END 안, 배열 [ ] 안. PostgreSQL 16.15에서 셋 모두
    // orders 전체를 읽음(BETWEEN은 false <= (가게 조건)으로 늘 참, 나머지 둘은 상수로 접혀 거르는 조건이 없음).
    "BETWEEN의 짝 AND": [
      "SELECT o.id FROM orders o WHERE false BETWEEN false AND (o.shop_id = $1)",
      "unscoped orders o",
    ],
    "CASE … END 안의 AND": [
      "SELECT o.id FROM orders o WHERE CASE WHEN true THEN true ELSE false AND o.shop_id = $1 AND true END",
      "unscoped orders o",
    ],
    "배열 [ ] 안의 AND": [
      "SELECT o.id FROM orders o WHERE ARRAY[false AND o.shop_id = $1 AND true] = ARRAY[false]",
      "unscoped orders o",
    ],
    // 안쪽 별칭이 바깥 가게 테이블의 별칭을 가리면 가게 조건을 바깥 테이블로 잘못 잇는다(Codex 검토). 하위 질의·함수·
    // JOIN USING의 별칭도 별칭 겹침 검사에 넣는다.
    "하위 질의 별칭이 바깥 별칭을 가림": [
      "SELECT (SELECT count(*) FROM payments p, (SELECT $2::uuid AS shop_id) o WHERE p.shop_id = o.shop_id) FROM orders o WHERE o.shop_id = $1",
      "alias o repeated",
    ],
    "함수 별칭이 바깥 별칭을 가림": [
      "SELECT (SELECT count(*) FROM payments p, unnest(ARRAY[$2::uuid]) AS o(shop_id) WHERE p.shop_id = o.shop_id) FROM orders o WHERE o.shop_id = $1",
      "alias o repeated",
    ],
    "JOIN USING 별칭이 바깥 별칭을 가림": [
      "SELECT (SELECT count(*) FROM payments p JOIN (SELECT $2::uuid AS shop_id) x USING (shop_id) AS o WHERE p.shop_id = o.shop_id) FROM orders o WHERE o.shop_id = $1",
      "alias o repeated",
    ],
    "하위 질의 별칭에 가게 테이블 이름": [
      "SELECT (SELECT count(*) FROM payments p, (SELECT $2::uuid AS shop_id) orders WHERE p.shop_id = orders.shop_id) FROM orders WHERE orders.shop_id = $1",
      "alias orders is a shop table name",
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
      `SELECT 'orders' , $$customers$$, E'a\\'b orders' FROM "orders" -- payments\n/* designs /* nested */ x */`,
    );
    expect(s).not.toMatch(/customers|payments|designs/);
    expect(s).toContain("orders");
    expect(s).not.toMatch(/[A-Z]/);
  });

  it("$1·$2는 $$ 글로 보지 않음", () => {
    expect(stripSql("WHERE a = $1 AND b = $2")).toBe("where a = $1 and b = $2");
  });

  it("PostgreSQL처럼 읽음: \\r로 끝나는 줄 주석, ASCII가 아닌 이름 글자와 $태그$", () => {
    expect(stripSql("a --x\rb")).toMatch(/^a\s+b$/);
    expect(stripSql("x é$$ y")).toBe("x é$$ y");
    expect(stripSql("$é$ orders $é$ z")).not.toContain("orders");
  });

  it('PostgreSQL처럼 읽음: ASCII 글자만 소문자로, 숫자 뒤의 $$, 따옴표 이름은 표시 "로 감쌈', () => {
    expect(stripSql("SELECT \u212A")).toBe("select \u212A"); // 켈빈 기호는 PostgreSQL에서 k가 아님
    expect(stripSql("1$$ x $$ y")).toMatch(/^1 ''\s+y$/);
    expect(stripSql('"c.shop_id"')).toBe(' " c.shop_id " ');
    expect(stripSql('"Orders"."shop_id"')).toBe(' " orders " . " shop_id " ');
    expect(namesShopTable('SELECT 1 FROM "orders"')).toBe(true);
  });

  it("가게 테이블 이름이 있는 SQL만 고름", () => {
    expect(namesShopTable("SELECT 1 FROM orders o")).toBe(true);
    expect(namesShopTable("SELECT 1 FROM request_keys")).toBe(false);
    expect(namesShopTable("SELECT 'orders'")).toBe(false);
  });
});
