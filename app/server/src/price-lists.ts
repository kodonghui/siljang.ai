/** 가격표와 도안 버전(API-016~019). 이전 버전의 항목은 수정하거나 삭제하지 않는다. */
import { ownerOfShopScope } from "./owner-scope";
import { type PriceListInput, type PriceOptionInput, type PriceRuleInput, parsePriceList } from "./price-list-input";
import { ApiError, fieldError } from "./problem";
import type { ShopRequest } from "./routes";
import type { ShopDb } from "./shop-scope";
import { deleteObjects } from "./storage";
import { toShopIso } from "./time";
import {
  checkUploads,
  discardUploads,
  parseUploadId,
  permanentKey,
  promoteUploads,
  type TakenUpload,
  tempKey,
  UPLOAD_RULES,
} from "./uploads";

interface Head {
  id: string;
  version: number;
  created_at: Date;
  superseded_at: Date | null;
  revision: string;
}
interface OptionRow {
  id: string;
  option_group: PriceOptionInput["group"];
  name: string;
  price_kind: PriceOptionInput["priceKind"];
  amount: number;
  amount_max: number | null;
  in_standard: boolean;
  position: number;
}
interface RuleRow {
  rule_kind: PriceRuleInput["kind"];
  option_a_id: string;
  option_b_id: string;
  amount: number | null;
}
interface DesignRow {
  id: string;
  name: string;
  image_key: string;
  price_option_id: string | null;
  in_standard: boolean;
  position: number;
}
interface PreparedDesign {
  name: string;
  imageKey: string;
  optionKey: string | null;
  inStandard: boolean;
  position: number;
  upload?: TakenUpload;
}

export async function current(db: ShopDb): Promise<Head | undefined> {
  return (
    await db.run<Head>(
      "SELECT p.id,p.version,p.created_at,p.superseded_at,p.xmin::text AS revision FROM price_lists p WHERE p.shop_id=$1 AND p.superseded_at IS NULL",
    )
  ).rows[0];
}
export async function contents(db: ShopDb, id: string) {
  const options = (
    await db.run<OptionRow>(
      `SELECT o.id,o.option_group,o.name,o.price_kind,o.amount,o.amount_max,o.in_standard,o.position FROM price_options o WHERE o.shop_id=$1 AND o.price_list_id=$2
    ORDER BY CASE o.option_group WHEN 'size' THEN 0 WHEN 'flavor' THEN 1 WHEN 'design' THEN 2 ELSE 3 END,o.position,o.name,o.id`,
      [id],
    )
  ).rows;
  const rules = (
    await db.run<RuleRow>(
      "SELECT r.rule_kind,r.option_a_id,r.option_b_id,r.amount FROM price_option_rules r WHERE r.shop_id=$1 AND r.price_list_id=$2 ORDER BY r.option_a_id,r.option_b_id",
      [id],
    )
  ).rows;
  const designs = (
    await db.run<DesignRow>(
      "SELECT d.id,d.name,d.image_key,d.price_option_id,d.in_standard,d.position FROM designs d WHERE d.shop_id=$1 AND d.price_list_id=$2 ORDER BY d.position,d.name,d.id",
      [id],
    )
  ).rows;
  return { options, rules, designs };
}

async function render(db: ShopDb, head: Head, r: ShopRequest) {
  const data = await contents(db, head.id);
  const zone = (await db.found<{ time_zone: string }>("SELECT s.time_zone FROM shops s WHERE s.id=$1")).time_zone;
  return {
    version: head.version,
    current: head.superseded_at === null,
    createdAt: toShopIso(head.created_at, zone),
    supersededAt: head.superseded_at === null ? null : toShopIso(head.superseded_at, zone),
    revision: head.revision,
    options: data.options.map((o) => ({
      optionId: o.id,
      group: o.option_group,
      name: o.name,
      priceKind: o.price_kind,
      amount: o.amount,
      amountMax: o.amount_max,
      inStandard: o.in_standard,
      position: o.position,
    })),
    rules: data.rules.map((rule) => ({
      kind: rule.rule_kind,
      optionAId: rule.option_a_id,
      optionBId: rule.option_b_id,
      amount: rule.amount,
    })),
    designs: await Promise.all(
      data.designs.map(async (d) => ({
        designId: d.id,
        name: d.name,
        imageUrl: await r.services.fileUrls().sign(d.image_key, new URL(r.req.url).origin, r.services.now()),
        optionId: d.price_option_id,
        inStandard: d.in_standard,
        position: d.position,
      })),
    ),
  };
}

function imageIdentity(key: string): string {
  const id = key.split("/").at(-1);
  return id && parseUploadId(id)?.purpose === "design_image" ? `upload:${id}` : key;
}
function semantic(options: PriceOptionInput[], rules: PriceRuleInput[], designs: PreparedDesign[]): string {
  const identity = (o: PriceOptionInput) => JSON.stringify([o.group, o.name]);
  const keys = new Map(options.map((o) => [o.key, identity(o)]));
  const sorted = (values: unknown[][]) => values.map((v) => JSON.stringify(v)).sort();
  return JSON.stringify([
    sorted(options.map((o) => [identity(o), o.priceKind, o.amount, o.amountMax, o.inStandard, o.position])),
    sorted(rules.map((rule) => [rule.kind, ...[keys.get(rule.optionA), keys.get(rule.optionB)].sort(), rule.amount])),
    sorted(
      designs.map((d) => [
        d.name,
        imageIdentity(d.imageKey),
        d.optionKey === null ? null : keys.get(d.optionKey),
        d.inStandard,
        d.position,
      ]),
    ),
  ]);
}
async function unchanged(db: ShopDb, head: Head, input: PriceListInput, designs: PreparedDesign[]): Promise<boolean> {
  const data = await contents(db, head.id);
  return (
    semantic(input.options, input.rules, designs) ===
    semantic(
      data.options.map((o) => ({
        key: o.id,
        group: o.option_group,
        name: o.name,
        priceKind: o.price_kind,
        amount: o.amount,
        amountMax: o.amount_max,
        inStandard: o.in_standard,
        position: o.position,
      })),
      data.rules.map((rule) => ({
        kind: rule.rule_kind,
        optionA: rule.option_a_id,
        optionB: rule.option_b_id,
        amount: rule.amount,
      })),
      data.designs.map((d) => ({
        name: d.name,
        imageKey: d.image_key,
        optionKey: d.price_option_id,
        inStandard: d.in_standard,
        position: d.position,
      })),
    )
  );
}

export async function getCurrentPriceList(r: ShopRequest): Promise<Response> {
  return r.json(
    await r.db.transaction(async (db) => {
      const head = await current(db);
      if (!head) throw new ApiError("not_set");
      return render(db, head, r);
    }),
  );
}
export async function getPriceListVersion(r: ShopRequest): Promise<Response> {
  const raw = r.req.param("version");
  if (!raw || !/^\d{1,10}$/.test(raw) || Number(raw) < 1 || Number(raw) > 2147483647) throw new ApiError("not_found");
  return r.json(
    await r.db.transaction(async (db) => {
      const head = await db.found<Head>(
        "SELECT p.id,p.version,p.created_at,p.superseded_at,p.xmin::text AS revision FROM price_lists p WHERE p.shop_id=$1 AND p.version=$2",
        [Number(raw)],
      );
      return render(db, head, r);
    }),
  );
}
export async function listPriceListVersions(r: ShopRequest): Promise<Response> {
  const zone = (await r.db.found<{ time_zone: string }>("SELECT s.time_zone FROM shops s WHERE s.id=$1")).time_zone;
  const rows = await r.db.run<Head>(
    "SELECT p.version,p.created_at,p.superseded_at FROM price_lists p WHERE p.shop_id=$1 ORDER BY p.version DESC LIMIT 1000",
  );
  return r.json({
    items: rows.rows.map((p) => ({
      version: p.version,
      createdAt: toShopIso(p.created_at, zone),
      supersededAt: p.superseded_at === null ? null : toShopIso(p.superseded_at, zone),
    })),
  });
}

export async function createPriceListVersion(r: ShopRequest): Promise<Response> {
  if (!/^application\/json\s*(;\s*charset\s*=\s*"?utf-8"?\s*)?$/i.test(r.req.header("content-type") ?? ""))
    throw fieldError("header:Content-Type", "not_allowed");
  const raw = await r.body(),
    input = parsePriceList(raw);
  const copied: string[] = [];
  let response: Response;
  try {
    response = await r.command({
      command: "API-017",
      pathIds: [],
      body: raw,
      async execute(db) {
        await db.found("SELECT s.id FROM shops s WHERE s.id=$1 FOR NO KEY UPDATE");
        const previous = await current(db);
        if (input.baseRevision !== (previous?.revision ?? null)) throw new ApiError("version_conflict");
        const refs = input.designs.flatMap((d, i) =>
          d.sourceDesignId === undefined ? [] : [{ id: d.sourceDesignId, field: `/designs/${i}/sourceDesignId` }],
        );
        await db.references("designs", refs);
        const sources = refs.length
          ? (
              await db.run<{ id: string; image_key: string }>(
                "SELECT d.id,d.image_key FROM designs d WHERE d.shop_id=$1 AND d.id=ANY($2::uuid[])",
                [refs.map((ref) => ref.id)],
              )
            ).rows
          : [];
        const uploadRefs = input.designs.flatMap((d, i) =>
          d.uploadId === undefined
            ? []
            : [{ id: d.uploadId, field: `/designs/${i}/uploadId`, purpose: "design_image" as const }],
        );
        const uploads = uploadRefs.length
          ? await checkUploads(r.services.storage(), ownerOfShopScope(r.scope), uploadRefs, r.services.now())
          : [];
        for (const upload of uploads)
          if (
            upload.byteSize > UPLOAD_RULES.design_image.maxBytes ||
            !UPLOAD_RULES.design_image.types.includes(upload.contentType)
          )
            throw fieldError(upload.field, "upload_not_found");
        const id = crypto.randomUUID();
        const designs: PreparedDesign[] = input.designs.map((d, i) => {
          const upload = uploads.find((u) => u.field === `/designs/${i}/uploadId`);
          const key = upload
            ? permanentKey(r.scope.shopId, "design_image", upload.uploadId, id)
            : sources.find((s) => s.id === d.sourceDesignId?.toLowerCase())?.image_key;
          if (!key) throw new TypeError("validated design source is missing");
          return {
            name: d.name,
            imageKey: key,
            optionKey: d.optionKey,
            inStandard: d.inStandard,
            position: d.position,
            ...(upload ? { upload } : {}),
          };
        });
        if (previous && (await unchanged(db, previous, input, designs)))
          return {
            status: 200,
            code: "unchanged",
            ref: { priceListId: previous.id },
            body: { outcome: "unchanged", priceList: await render(db, previous, r) },
          };
        if ((previous?.version ?? 0) >= 2147483647) throw fieldError("/", "out_of_range");
        const promoting = designs.flatMap((design) => (design.upload ? [design.upload] : []));
        // 응답 유실/일부 복사 실패도 정리할 수 있게 시도할 모든 새 키를 먼저 남긴다.
        copied.push(...designs.filter((design) => design.upload).map((design) => design.imageKey));
        if (promoting.length) await promoteUploads(r.services.storage(), promoting, r.scope.shopId, id);
        const now = r.services.now();
        if (previous)
          await db.run("UPDATE price_lists SET superseded_at=$3 WHERE shop_id=$1 AND id=$2", [previous.id, now]);
        await db.run("INSERT INTO price_lists (shop_id,id,version,created_at) VALUES ($1,$2,$3,$4)", [
          id,
          (previous?.version ?? 0) + 1,
          now,
        ]);
        const optionIds = new Map(input.options.map((o) => [o.key, crypto.randomUUID()]));
        for (const o of input.options)
          await db.run(
            "INSERT INTO price_options (shop_id,id,price_list_id,option_group,name,price_kind,amount,amount_max,in_standard,position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
            [optionIds.get(o.key), id, o.group, o.name, o.priceKind, o.amount, o.amountMax, o.inStandard, o.position],
          );
        for (const rule of input.rules) {
          const pair = [optionIds.get(rule.optionA), optionIds.get(rule.optionB)].sort();
          await db.run(
            "INSERT INTO price_option_rules (shop_id,price_list_id,rule_kind,option_a_id,option_b_id,amount) VALUES ($1,$2,$3,$4,$5,$6)",
            [id, rule.kind, pair[0], pair[1], rule.amount],
          );
        }
        for (const d of designs)
          await db.run(
            "INSERT INTO designs (shop_id,id,price_list_id,price_option_id,name,image_key,in_standard,position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            [
              crypto.randomUUID(),
              id,
              d.optionKey === null ? null : optionIds.get(d.optionKey),
              d.name,
              d.imageKey,
              d.inStandard,
              d.position,
            ],
          );
        const head = await db.found<Head>(
          "SELECT p.id,p.version,p.created_at,p.superseded_at,p.xmin::text AS revision FROM price_lists p WHERE p.shop_id=$1 AND p.id=$2",
          [id],
        );
        return {
          status: 201,
          code: "created",
          ref: { priceListId: id },
          body: { outcome: "created", priceList: await render(db, head, r) },
        };
      },
      async render(db, stored) {
        const head = await db.found<Head>(
          "SELECT p.id,p.version,p.created_at,p.superseded_at,p.xmin::text AS revision FROM price_lists p WHERE p.shop_id=$1 AND p.id=$2",
          [stored.ref.priceListId],
        );
        return { outcome: stored.code, priceList: await render(db, head, r) };
      },
    });
  } catch (error) {
    if (copied.length)
      try {
        await r.db.transaction(async (db) => {
          // 응답을 잃은 원래 COMMIT이 진행 중이면 같은 가게의 잠금이 풀린 뒤 읽는다.
          await db.found("SELECT s.id FROM shops s WHERE s.id=$1 FOR NO KEY UPDATE");
          const used = await db.run<{ image_key: string }>(
            "SELECT d.image_key FROM designs d WHERE d.shop_id=$1 AND d.image_key=ANY($2::text[])",
            [copied],
          );
          const usedKeys = new Set(used.rows.map((row) => row.image_key));
          await deleteObjects(
            r.services.storage(),
            copied.filter((key) => !usedKeys.has(key)),
          );
        });
      } catch {
        r.log("warn", { event: "price_copy_cleanup_failed", traceId: r.traceId });
      }
    throw error;
  }
  // 성공한 명령의 같은 본문 재전송도 임시 정리를 복구한다. 저장소를 다시 확인하거나 복사하지 않는다.
  const consumed = input.designs.flatMap((design) => {
    const upload = parseUploadId(design.uploadId);
    return upload?.purpose === "design_image" ? [{ tempKey: tempKey(ownerOfShopScope(r.scope), upload.id) }] : [];
  });
  if (response.status === 201 && consumed.length) await discardUploads(r.services.storage(), consumed);
  return response;
}
