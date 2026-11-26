/** API-077: 열기 응답과 접속기록은 같은 트랜잭션. 요청 키에는 대상 식별자만 둔다. */
import type { AccessEntry } from "./access-log";
import { accountLast4, isAccountNumber, openAccountNumber } from "./account-number";
import { requireJson } from "./body";
import { FieldCryptoError } from "./field-crypto";
import { openStoredMaskedValue, type StoredMaskedValue } from "./masked-values";
import { type OriginalOpenInput, parseOriginalOpen } from "./operator-record-input";
import {
  type OperatorRecordPage,
  OperatorRecordPageError,
  openOperatorRecordPage,
  operatorRecordPageHash,
} from "./operator-record-page";
import { ApiError, fieldError } from "./problem";
import type { AccessRequest } from "./routes";
import type { ShopDb } from "./shop-scope";

const VALUE_FIELD = {
  masked_value: "maskedValue",
  order_contact: "orderContact",
  refund_account: "refundAccount",
  kept_record: "keptRecord",
  consultation_text: "consultationText",
} as const;
interface OriginalSource {
  readonly state: "ready" | "erased" | "not_kept";
  readonly value?: unknown;
}
interface MaskedSource extends StoredMaskedValue {
  readonly placeholder: string;
  readonly consultationId: string;
  readonly valueHmac: string;
}
interface RefundSource {
  readonly enc: string;
  readonly last4: string;
  readonly bankName: string | null;
  readonly holderName: string | null;
}
export async function openOperatorOriginal(r: AccessRequest): Promise<Response> {
  if (r.scope.via.kind !== "operator") throw new ApiError("not_found");
  const operatorId = r.scope.via.operatorId;
  requireJson(r.req.raw);
  const raw = await r.body(),
    input = parseOriginalOpen(raw);
  const read = async (db: ShopDb) => {
    let page: OperatorRecordPage | null = null;
    if (input.targetKind === "consultation_text") {
      const header = (
        await db.run<{ body: { status: string } }>("SELECT body FROM read_operator_consultation($1,$2,$3)", [
          operatorId,
          input.targetId,
        ])
      ).rows[0];
      if (!header) throw new ApiError("not_found");
      if (header.body.status === "deleted") throw new ApiError("original_erased");
      try {
        page = await openOperatorRecordPage(
          r.services.fieldCrypto(),
          { shopId: r.scope.shopId, consultationId: input.targetId, operatorId },
          input.cursor as string,
          r.services.now(),
        );
      } catch (error) {
        if (error instanceof OperatorRecordPageError) throw fieldError("/cursor", "bad_format");
        throw error;
      }
    }
    const found = await db.run<{ source: OriginalSource; customer_id: string }>(
      "SELECT source,customer_id FROM read_operator_original($1,$2,$3,$4,$5::jsonb,$6)",
      [
        operatorId,
        input.targetKind,
        input.targetId,
        JSON.stringify(page ? { first: page.first, last: page.last } : {}),
        r.services.now(),
      ],
    );
    const row = found.rows[0];
    if (row === undefined) throw new ApiError("not_found");
    if (row.source.state === "erased") throw new ApiError("original_erased");
    if (row.source.state === "not_kept") throw new ApiError("original_not_kept");
    if (row.source.state !== "ready" || row.source.value === undefined) throw new Error("invalid original source");
    if (page !== null) {
      const items = (row.source.value as { items: { messageId: string }[] }).items;
      if ((await operatorRecordPageHash(items.map((item) => item.messageId))) !== page.idsHash)
        throw fieldError("/cursor", "bad_format");
    }
    const value = await decryptOriginal(r, input, row.source.value);
    const body: Record<string, unknown> = {
      targetKind: input.targetKind,
      targetId: input.targetId,
      openedAt: r.services.now().toISOString(),
      maskedValue: null,
      orderContact: null,
      refundAccount: null,
      keptRecord: null,
      consultationText: null,
      [VALUE_FIELD[input.targetKind]]: value,
    };
    const access: AccessEntry =
      input.targetKind === "kept_record"
        ? {
            action: "open_kept",
            subjects: [row.customer_id],
            target: { kind: "kept_record", id: input.targetId },
            reason: input.reason,
          }
        : {
            action: "open_original",
            subjects: [row.customer_id],
            target: { kind: input.targetKind, id: input.targetId },
            reason: input.reason,
          };
    return { body, access };
  };
  return r.command({
    pathIds: [r.scope.shopId],
    body: raw,
    async execute(db) {
      const out = await read(db);
      return {
        result: {
          status: 200,
          code: "original_opened",
          ref: { targetKind: input.targetKind, targetId: input.targetId },
          body: out.body,
        },
        access: out.access,
      };
    },
    async render(db, stored) {
      if (
        stored.code !== "original_opened" ||
        stored.ref.targetKind !== input.targetKind ||
        stored.ref.targetId !== input.targetId
      )
        throw new Error("invalid original reference");
      return read(db);
    },
  });
}
async function decryptOriginal(r: AccessRequest, input: OriginalOpenInput, value: unknown): Promise<unknown> {
  if (input.targetKind === "masked_value") {
    const stored = value as MaskedSource,
      fc = r.services.fieldCrypto(),
      opened = await openStoredMaskedValue(stored, r.scope.shopId, () => fc);
    if (opened.original === null || !["phone", "account"].includes(opened.kind))
      throw new ApiError("original_not_kept");
    const hashes = await fc.valueHashes([
      "masked_values",
      r.scope.shopId,
      stored.consultationId,
      stored.kind,
      opened.original,
    ]);
    if (!hashes.includes(stored.valueHmac) || opened.original.slice(-4) !== stored.last4)
      throw new FieldCryptoError("masked value integrity mismatch");
    return { placeholder: stored.placeholder, kind: stored.kind, value: opened.original };
  }
  if (input.targetKind === "refund_account") {
    const stored = value as RefundSource,
      account = await openAccountNumber(r.services.fieldCrypto(), stored.enc, "refunds.refund_account", r.scope.shopId);
    if (!isAccountNumber(account) || accountLast4(account) !== stored.last4)
      throw new FieldCryptoError("refund account integrity mismatch");
    return { bankName: stored.bankName, accountNumber: account, holderName: stored.holderName };
  }
  return value;
}
