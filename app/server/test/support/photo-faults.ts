import { type DbConnector, pgConnector, type Queryable, type RequestDb } from "../../src/db";
import type { MemoryStore } from "./storage";

/** 선점 뒤 읽기 또는 결과 저장 뒤 전달 확정에서 한 번만 끊는다. */
export function photoFailureConnector(at: "turn" | "finish"): DbConnector {
  let failed = false;
  return (url) => {
    const db = pgConnector(url);
    const wrap =
      (query: Queryable["query"]): Queryable["query"] =>
      (sql, params) => {
        const target =
          at === "turn" ? /SELECT trace_id FROM messages/ : /UPDATE messages SET kakao_callback_enc = NULL/;
        if (!failed && target.test(sql)) {
          failed = true;
          throw new Error("합성 사진 처리 중단");
        }
        return query(sql, params);
      };
    return {
      query: wrap(db.query.bind(db)),
      transaction: (work) => db.transaction((tx) => work({ query: wrap(tx.query.bind(tx)) })),
      abort: db.abort.bind(db),
      close: db.close.bind(db),
    };
  };
}

export function photoGate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** PUT 뒤 확정 트랜잭션이 실제 PostgreSQL 행 잠금을 기다리게 한다. */
export function lockPhotoCustomer(store: MemoryStore, db: RequestDb, shopId: string) {
  const entered = photoGate(),
    finish = photoGate();
  const put = store.put.bind(store);
  let held: Promise<void> | undefined;
  store.put = async (...args) => {
    await put(...args);
    held = db.transaction(async (tx) => {
      await tx.query("SELECT id FROM customers WHERE shop_id=$1 FOR UPDATE", [shopId]);
      entered.release();
      await finish.promise;
    });
    await entered.promise;
  };
  return {
    entered: entered.promise,
    async release() {
      finish.release();
      await held;
      await db.close();
    },
  };
}
