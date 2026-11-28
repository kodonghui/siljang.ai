import type { DueItem, LeaseContext, LeasedHandler } from "./job-runner";
import type { Secret } from "./settings";
import type { ShopDb } from "./shop-scope";

export interface LedgerWriteSnapshot {
  readonly shopId: string;
  readonly eventId: string;
  readonly orderId: string;
  readonly expectedDigest?: string | null;
  readonly uncertain: boolean;
  readonly auditing: boolean;
  readonly linkId: string;
  readonly file: string;
  readonly tab: string;
  readonly values: readonly (string | number)[];
}
type Result =
  | {
      readonly status: "written";
      readonly columns: {
        readonly columns: readonly { readonly header: string; readonly column: string }[];
        readonly movedRight: boolean;
        readonly ownershipToken: string;
        readonly sheetHash?: string;
      };
    }
  | {
      readonly status:
        | "auth_lost"
        | "retry"
        | "uncertain"
        | "duplicate"
        | "conflict"
        | "audit_ok"
        | "audit_missing"
        | "audit_duplicate"
        | "audit_retry";
    };
interface Prepared {
  readonly row: LedgerWriteSnapshot;
  readonly credential: Secret | null;
  readonly credentialError: boolean;
}
interface Dependencies {
  claim(db: ShopDb, item: DueItem, ctx: LeaseContext): Promise<LedgerWriteSnapshot | null>;
  credential(db: ShopDb, linkId: string, writeId: string, lease: Date): Promise<Secret | null>;
  guard?(db: ShopDb, row: LedgerWriteSnapshot, item: DueItem, ctx: LeaseContext): Promise<boolean>;
  write(
    row: LedgerWriteSnapshot,
    credential: Secret,
    guard?: { readonly signal: AbortSignal; readonly revalidate: () => Promise<boolean> },
  ): Promise<Exclude<Result, { readonly status: "retry" }>>;
  finish(db: ShopDb, item: DueItem, ctx: LeaseContext, result: Result): Promise<void>;
}

/** 외부 호출은 트랜잭션 밖에서 하며 결과는 같은 임대일 때만 반영한다. */
export function createLedgerWriteHandler(deps: Dependencies): LeasedHandler<Prepared, Result> {
  const guard = deps.guard;
  return {
    mode: "leased",
    ...(guard
      ? {
          guard: (db: ShopDb, item: DueItem, prepared: Prepared, ctx: LeaseContext) =>
            guard(db, prepared.row, item, ctx),
        }
      : {}),
    async lease(db, item, ctx) {
      const row = await deps.claim(db, item, ctx);
      if (row === null) return null;
      try {
        const credential = await deps.credential(db, row.linkId, item.id, ctx.leaseUntil);
        return { row, credential, credentialError: false };
      } catch {
        return { row, credential: null, credentialError: true };
      }
    },
    async act(prepared, _ctx, guard) {
      if (prepared.credentialError) throw new Error("ledger credential unavailable");
      if (prepared.credential === null) return { status: prepared.row.auditing ? "audit_retry" : "auth_lost" };
      return deps.write(prepared.row, prepared.credential, guard);
    },
    async record(db, item, prepared, outcome, ctx) {
      await deps.finish(
        db,
        item,
        ctx,
        outcome.ok
          ? outcome.value
          : {
              status: prepared.row.auditing
                ? "audit_retry"
                : outcome.errorName === "LedgerUncertainError" || outcome.errorName === "JobActTimeoutError"
                  ? "uncertain"
                  : outcome.errorName === "LedgerDuplicateError"
                    ? "duplicate"
                    : outcome.errorName === "LedgerConflictError"
                      ? "conflict"
                      : "retry",
            },
      );
    },
  };
}
