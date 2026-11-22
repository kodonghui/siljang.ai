/** API-081/082/SPEC-078. 목록은 전용 기능, 판정은 DB에서 찾은 가게 범위로만 처리한다. */
import { requireJson } from "./body";
import { eventKeys, insertOnce } from "./event-keys";
import { parseIdentityChangeList, parseIdentityChangeReview } from "./identity-change-input";
import { identityReviewRevision, readIdentityReview, renderIdentityReview } from "./identity-change-view";
import { reviewCursor } from "./license-review-input";
import { readSessionCookie, tokenHash } from "./operator-session";
import { ApiError } from "./problem";
import type { OperatorRequest, ShopRequest } from "./routes";
import { ForgedScopeError } from "./shop-scope";

export async function listIdentityChanges(r: OperatorRequest): Promise<Response> {
  const input = parseIdentityChangeList(r.req.query()),
    rows = await r.shops.listIdentityChanges(input),
    page = rows.slice(0, input.limit),
    last = page.at(-1);
  return r.json({
    items: await Promise.all(page.map((row) => renderIdentityReview(row, r.services, new URL(r.req.url).origin))),
    nextCursor:
      rows.length > input.limit && last?.cursor_at ? reviewCursor(input.status, last.cursor_at, last.id) : null,
  });
}
export async function reviewIdentityChange(r: ShopRequest): Promise<Response> {
  if (r.scope.via.kind !== "operator") throw new ForgedScopeError("operator required");
  requireJson(r.req.raw);
  const raw = await r.body(),
    input = parseIdentityChangeReview(raw),
    id = r.pathId("changeId"),
    operatorId = r.scope.via.operatorId;
  const cookie = readSessionCookie(r.req.header("cookie"));
  if (cookie === null) throw new ApiError("unauthenticated");
  const cookieHash = await tokenHash(cookie),
    origin = new URL(r.req.url).origin;
  return r.command({
    command: "API-082",
    pathIds: [id],
    body: raw,
    async execute(db) {
      await db.found("SELECT s.id FROM shops s WHERE s.id=$1 FOR NO KEY UPDATE");
      const row = await readIdentityReview(db, id);
      if (!row) throw new ApiError("not_found");
      if (row.status !== "pending") {
        if (row.reviewed_by !== operatorId) throw new ApiError("already_decided");
        if (row.status === input.decision && (row.status === "applied" || row.hold_reason === input.holdReason))
          return {
            status: 200,
            code: "unchanged",
            ref: { changeId: id },
            body: { outcome: "unchanged", change: await renderIdentityReview(row, r.services, origin) },
          };
        throw new ApiError("version_conflict");
      }
      if ((await identityReviewRevision(row)) !== input.baseRevision) throw new ApiError("version_conflict");
      const now = r.services.now();
      const result = await db.found<{ outcome: string }>(
        "SELECT review_shop_identity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS outcome",
        [
          id,
          operatorId,
          cookieHash,
          now,
          row.identity_version,
          row.account_id,
          row.account_version,
          input.decision,
          input.holdReason ?? null,
        ],
      );
      if (!["done", "unchanged"].includes(result.outcome)) {
        if (["unauthenticated", "not_found", "version_conflict", "already_decided"].includes(result.outcome))
          throw new ApiError(
            result.outcome as "unauthenticated" | "not_found" | "version_conflict" | "already_decided",
          );
        throw new Error("unexpected identity review result");
      }
      if (result.outcome === "done") {
        const kind = input.decision === "applied" ? "identity_change_applied" : "identity_change_on_hold";
        await insertOnce(
          db,
          "owner_alerts",
          "INSERT INTO owner_alerts (shop_id, event_key, kind, next_attempt_at, created_at) VALUES ($1, $2, $3, $4, $4) ON CONFLICT (shop_id, event_key) DO NOTHING RETURNING id",
          [eventKeys.alert(kind, id), kind, now],
        );
      }
      const current = await readIdentityReview(db, id);
      if (!current) throw new ApiError("not_found");
      return {
        status: 200,
        code: result.outcome,
        ref: { changeId: id },
        body: { outcome: result.outcome, change: await renderIdentityReview(current, r.services, origin) },
      };
    },
    async render(db, stored) {
      const row = await readIdentityReview(db, id);
      if (!row) throw new ApiError("not_found");
      return { outcome: stored.code, change: await renderIdentityReview(row, r.services, origin) };
    },
  });
}
