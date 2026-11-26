/** API-074~077. 운영자 기록은 접속기록을 남기는 가게 범위 트랜잭션에서만 읽는다. */
import { ApiError } from "./problem";
import type { AccessRequest } from "./routes";

export async function getOperatorRecordOrder(r: AccessRequest): Promise<Response> {
  if (r.scope.via.kind !== "operator") throw new ApiError("not_found");
  const operatorId = r.scope.via.operatorId,
    orderId = r.pathId("orderId");
  return r.read(async (db) => {
    const selected = await db.run<{ body: unknown; customer_id: string }>(
      "SELECT body,customer_id FROM read_operator_order($1,$2,$3)",
      [operatorId, orderId],
    );
    const row = selected.rows[0];
    if (row === undefined) throw new ApiError("not_found");
    return { body: row.body, subjects: [row.customer_id] };
  });
}
