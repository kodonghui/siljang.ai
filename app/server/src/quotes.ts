import { recordKakaoHandoff } from "./kakao-handoff";
import { ApiError } from "./problem";
import type { ShopRequestDb } from "./shop-scope";

interface Option {
  id: string;
  option_group: string;
  name: string;
  price_kind: "fixed" | "from" | "range";
  amount: number;
  amount_max: number | null;
  in_standard: boolean;
}
export interface Quote {
  readonly id: string;
  readonly amount: number;
  readonly amountMax: number | null;
  readonly displayKind: "fixed" | "from" | "range";
  readonly orderKind: "standard" | "custom";
  readonly priceListVersion: number;
  readonly operatingRulesVersion: number;
  readonly validUntil: string;
  readonly basis: unknown;
}

export function customerQuote(quote: Quote) {
  return {
    amount: quote.amount,
    amountMax: quote.amountMax,
    displayKind: quote.displayKind,
    validUntil: quote.validUntil,
  };
}

/** 금액은 가격표로만 계산하고 선택한 버전과 근거를 견적에 남긴다. */
export async function quoteDraft(
  db: ShopRequestDb,
  input: {
    readonly draftId: string;
    readonly sourceMessageId: string;
    readonly now: Date;
    readonly priceListVersion?: number;
    readonly operatingRulesVersion?: number;
    readonly selection?: {
      readonly size?: string;
      readonly flavor?: string;
      readonly design?: string;
      readonly extras?: readonly string[];
    };
  },
): Promise<
  { readonly kind: "quoted"; readonly quote: Quote } | { readonly kind: "cannot_calculate"; readonly reason: string }
> {
  return db.transaction(async (tx) => {
    const draftId = await tx.owned("order_drafts", input.draftId);
    const draft = await tx.found<{
      consultation_id: string;
      revision: number;
      price_list_id: string | null;
      size_option_id: string | null;
      flavor_option_id: string | null;
      design_option_id: string | null;
      design_id: string | null;
      excluded_ingredients: string | null;
    }>(
      "SELECT consultation_id,revision,price_list_id,size_option_id,flavor_option_id,design_option_id,design_id,excluded_ingredients FROM order_drafts WHERE shop_id=$1 AND id=$2 FOR UPDATE",
      [draftId],
    );
    await tx.found(
      "SELECT id FROM messages WHERE shop_id=$1 AND id=$2 AND consultation_id=$3 AND direction='inbound'",
      [input.sourceMessageId, draft.consultation_id],
    );
    const fail = async (reason: string) => {
      await recordKakaoHandoff(tx, draft.consultation_id, input.sourceMessageId, "cannot_answer", input.now);
      return { kind: "cannot_calculate", reason } as const;
    };
    const frozen = (
      await tx.run<{ price_list_id: string; operating_rules_id: string }>(
        "SELECT price_list_id,operating_rules_id FROM orders WHERE shop_id=$1 AND draft_id=$2 LIMIT 1",
        [draftId],
      )
    ).rows[0];
    const price = (
      await tx.run<{ id: string; version: number }>(
        frozen
          ? "SELECT id,version FROM price_lists WHERE shop_id=$1 AND id=$2"
          : input.priceListVersion === undefined
            ? "SELECT id,version FROM price_lists WHERE shop_id=$1 AND (id=$2 OR ($2::uuid IS NULL AND superseded_at IS NULL)) LIMIT 1"
            : "SELECT id,version FROM price_lists WHERE shop_id=$1 AND version=$2",
        [frozen?.price_list_id ?? input.priceListVersion ?? draft.price_list_id],
      )
    ).rows[0];
    const rules = (
      await tx.run<{ id: string; version: number; quote_valid_hours: number }>(
        frozen
          ? "SELECT id,version,quote_valid_hours FROM operating_rules WHERE shop_id=$1 AND id=$2"
          : input.operatingRulesVersion === undefined
            ? "SELECT id,version,quote_valid_hours FROM operating_rules WHERE shop_id=$1 AND superseded_at IS NULL"
            : "SELECT id,version,quote_valid_hours FROM operating_rules WHERE shop_id=$1 AND version=$2",
        frozen
          ? [frozen.operating_rules_id]
          : input.operatingRulesVersion === undefined
            ? []
            : [input.operatingRulesVersion],
      )
    ).rows[0];
    if (!price || !rules) throw new ApiError("not_found");
    const options = (
      await tx.run<Option>(
        "SELECT id,option_group,name,price_kind,amount,amount_max,in_standard FROM price_options WHERE shop_id=$1 AND price_list_id=$2",
        [price.id],
      )
    ).rows;
    const extras = (
      await tx.run<{ option_id: string }>("SELECT option_id FROM order_draft_extras WHERE shop_id=$1 AND draft_id=$2", [
        draftId,
      ])
    ).rows;
    const ids = [
      draft.size_option_id,
      draft.flavor_option_id,
      draft.design_option_id,
      ...extras.map((row) => row.option_id),
    ].filter((id): id is string => id !== null);
    let standardDesign = true;
    if (draft.design_id !== null) {
      const design = (
        await tx.run<{ name: string; price_option_id: string | null; in_standard: boolean }>(
          "SELECT name,price_option_id,in_standard FROM designs WHERE shop_id=$1 AND id=$2 AND price_list_id=$3",
          [draft.design_id, price.id],
        )
      ).rows[0];
      if (!design) return fail("design_missing");
      standardDesign = design.in_standard;
      if (design.price_option_id !== null) ids.push(design.price_option_id);
    }
    const old = (
      await tx.run<{ id: string; option_group: string; name: string }>(
        "SELECT id,option_group,name FROM price_options WHERE shop_id=$1 AND id=ANY($2::uuid[])",
        [ids],
      )
    ).rows;
    const names = {
      size: input.selection?.size ?? old.find((x) => x.id === draft.size_option_id)?.name,
      flavor: input.selection?.flavor ?? old.find((x) => x.id === draft.flavor_option_id)?.name,
      design: input.selection?.design ?? old.find((x) => x.option_group === "design")?.name,
      extras: input.selection?.extras ?? old.filter((x) => x.option_group === "extra").map((x) => x.name),
    };
    if (!names.size || !names.flavor) return fail("option_missing");
    const chosen = new Map<string, Option>();
    for (const [group, values] of [
      ["size", [names.size]],
      ["flavor", [names.flavor]],
      ["design", names.design ? [names.design] : []],
      ["extra", names.extras],
    ] as const) {
      for (const name of values) {
        const option = options.find((x) => x.option_group === group && x.name === name);
        if (!option) return fail("option_missing");
        chosen.set(option.id, option);
      }
    }
    const applied = (
      await tx.run<{ id: string; rule_kind: string; option_a_id: string; option_b_id: string; amount: number | null }>(
        "SELECT id,rule_kind,option_a_id,option_b_id,amount FROM price_option_rules WHERE shop_id=$1 AND price_list_id=$2",
        [price.id],
      )
    ).rows
      .filter((x) => chosen.has(x.option_a_id) && chosen.has(x.option_b_id))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (applied.some((x) => x.rule_kind === "exclude")) return fail("combination_excluded");
    const rows = [...chosen.values()].sort((a, b) => a.id.localeCompare(b.id));
    const surcharge = applied.reduce((sum, x) => sum + (x.amount ?? 0), 0);
    const amount = rows.reduce((sum, x) => sum + x.amount, surcharge);
    const displayKind = rows.some((x) => x.price_kind === "from")
      ? "from"
      : rows.some((x) => x.price_kind === "range")
        ? "range"
        : "fixed";
    const amountMax =
      displayKind === "range" ? rows.reduce((sum, x) => sum + (x.amount_max ?? x.amount), surcharge) : null;
    if (amount < 1 || amount > 10000000 || (amountMax !== null && amountMax > 10000000))
      return fail(amount === 0 ? "zero_amount" : "amount_out_of_range");
    const photo =
      (await tx.run("SELECT id FROM reference_photos WHERE shop_id=$1 AND draft_id=$2 LIMIT 1", [draftId])).rowCount >
      0;
    const orderKind =
      displayKind === "fixed" &&
      rows.every((x) => x.in_standard) &&
      standardDesign &&
      !photo &&
      !draft.excluded_ingredients?.trim()
        ? "standard"
        : "custom";
    const basis = {
      priceListVersion: price.version,
      operatingRulesVersion: rules.version,
      options: rows,
      rules: applied,
    };
    const validUntil = new Date(input.now.getTime() + rules.quote_valid_hours * 3600000).toISOString();
    const prior = (
      await tx.run<{ id: string; valid_until: Date }>(
        "SELECT id,valid_until FROM quotes WHERE shop_id=$1 AND draft_id=$2 AND draft_revision=$3 AND price_list_id=$4 AND operating_rules_id=$5 AND amount=$6 AND quoted_at<=$7 AND valid_until>$7 AND display_kind=$8 AND order_kind=$9 AND amount_max IS NOT DISTINCT FROM $10::integer AND basis=$11::jsonb ORDER BY quoted_at DESC,id LIMIT 1",
        [
          draftId,
          draft.revision,
          price.id,
          rules.id,
          amount,
          input.now,
          displayKind,
          orderKind,
          amountMax,
          JSON.stringify(basis),
        ],
      )
    ).rows[0];
    const id =
      prior?.id ??
      (
        await tx.found<{ id: string }>(
          "INSERT INTO quotes (shop_id,draft_id,draft_revision,price_list_id,operating_rules_id,order_kind,display_kind,amount,amount_max,basis,valid_until,quoted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12) RETURNING id",
          [
            draftId,
            draft.revision,
            price.id,
            rules.id,
            orderKind,
            displayKind,
            amount,
            amountMax,
            JSON.stringify(basis),
            validUntil,
            input.now,
          ],
        )
      ).id;
    return {
      kind: "quoted",
      quote: {
        id,
        amount,
        amountMax,
        displayKind,
        orderKind,
        priceListVersion: price.version,
        operatingRulesVersion: rules.version,
        validUntil: prior?.valid_until.toISOString() ?? validUntil,
        basis,
      },
    } as const;
  });
}
