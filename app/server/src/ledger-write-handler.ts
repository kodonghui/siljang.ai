import type { DueItem, LeaseContext, LeasedHandler } from "./job-runner";
import type { Secret } from "./settings";
import type { ShopDb } from "./shop-scope";

export interface LedgerWriteSnapshot {
  readonly shopId: string;
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
      };
    }
  | { readonly status: "auth_lost" | "retry" };
interface Prepared {
  readonly row: LedgerWriteSnapshot;
  readonly credential: Secret | null;
  readonly credentialError: boolean;
}
interface Dependencies {
  claim(db: ShopDb, item: DueItem, ctx: LeaseContext): Promise<LedgerWriteSnapshot | null>;
  credential(db: ShopDb, linkId: string, writeId: string, lease: Date): Promise<Secret | null>;
  write(row: LedgerWriteSnapshot, credential: Secret): Promise<Exclude<Result, { readonly status: "retry" }>>;
  finish(db: ShopDb, item: DueItem, ctx: LeaseContext, result: Result): Promise<void>;
}

/** 외부 호출은 트랜잭션 밖에서 하며 결과는 같은 임대일 때만 반영한다. */
export function createLedgerWriteHandler(deps: Dependencies): LeasedHandler<Prepared, Result> {
  return {
    mode: "leased",
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
    async act(prepared) {
      if (prepared.credentialError) throw new Error("ledger credential unavailable");
      if (prepared.credential === null) return { status: "auth_lost" };
      return deps.write(prepared.row, prepared.credential);
    },
    async record(db, item, _prepared, outcome, ctx) {
      await deps.finish(db, item, ctx, outcome.ok ? outcome.value : { status: "retry" });
    },
  };
}
