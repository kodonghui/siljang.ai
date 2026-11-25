/** 서버의 현재 초안/견적만으로 주문 카드의 표시를 준비한다. 값을 고치거나 주문을 실행하지 않는다. */
import type { ShopDb } from "./shop-scope";
export interface OrderCardQuote {
  readonly amount: number;
  readonly amountMax: number | null;
  readonly displayKind: "fixed" | "from" | "range";
  readonly orderKind: "standard" | "custom";
  readonly priceListId: string;
}
interface SummaryRow {
  pickup_day: string | null;
  pickup_time: string | null;
  courier_pickup: boolean;
  size_name: string | null;
  flavor_name: string | null;
  design_name: string | null;
  design_notes: string | null;
  lettering: string | null;
  colors: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  allergy_consent: string | null;
  allergy_answer: string | null;
  excluded_ingredients: string | null;
  order_kind: string | null;
  time_zone: string;
  has_photos: boolean;
}
export function orderCardDeadline(text: string, timeZone: string, expiresAt: Date): string {
  const time = new Intl.DateTimeFormat("ko-KR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(expiresAt);
  return `${text}\n${time}까지 눌러 주세요`;
}
export async function readPreparedOrderSummary(
  db: ShopDb,
  input: {
    readonly draftId: string;
    readonly consultationId: string;
    readonly quote: OrderCardQuote;
    readonly expiresAt: Date;
  },
): Promise<{ readonly text: string; readonly timeZone: string } | null> {
  const row = (
    await db.run<SummaryRow>(
      `SELECT d.pickup_day::text,d.pickup_time::text,d.courier_pickup,d.design_notes,d.lettering,d.colors,
      d.customer_name,d.customer_phone,d.allergy_consent,d.allergy_answer,d.excluded_ingredients,d.order_kind,
      sz.name AS size_name,fl.name AS flavor_name,coalesce(de.name,ds.name) AS design_name,s.time_zone,
      EXISTS(SELECT 1 FROM reference_photos ph WHERE ph.shop_id=$1 AND ph.draft_id=d.id) AS has_photos
      FROM order_drafts d JOIN shops s ON s.id=$1
      LEFT JOIN price_options sz ON sz.shop_id=$1 AND sz.price_list_id=d.price_list_id AND sz.id=d.size_option_id
      LEFT JOIN price_options fl ON fl.shop_id=$1 AND fl.price_list_id=d.price_list_id AND fl.id=d.flavor_option_id
      LEFT JOIN price_options ds ON ds.shop_id=$1 AND ds.price_list_id=d.price_list_id AND ds.id=d.design_option_id
      LEFT JOIN designs de ON de.shop_id=$1 AND de.price_list_id=d.price_list_id AND de.id=d.design_id
      WHERE d.shop_id=$1 AND d.id=$2 AND d.consultation_id=$3 AND d.price_list_id=$4 AND d.status='active'`,
      [input.draftId, input.consultationId, input.quote.priceListId],
    )
  ).rows[0];
  if (
    !row?.pickup_day ||
    !row.pickup_time ||
    !row.size_name ||
    !row.flavor_name ||
    (!row.design_name && !row.design_notes && !row.has_photos) ||
    row.lettering === null ||
    row.colors === null ||
    !row.customer_name?.trim() ||
    !row.customer_phone ||
    !/^[0-9-]{8,14}$/.test(row.customer_phone) ||
    row.order_kind !== input.quote.orderKind ||
    !["agreed", "declined", "not_required"].includes(row.allergy_consent ?? "") ||
    (row.allergy_consent !== "declined" && !row.allergy_answer?.trim())
  )
    return null;
  const q = input.quote;
  if (
    !Number.isInteger(q.amount) ||
    q.amount < 1 ||
    q.amount > 10000000 ||
    (q.displayKind === "range" && (q.amountMax === null || q.amountMax < q.amount))
  )
    return null;
  const money =
    q.displayKind === "from"
      ? `${q.amount.toLocaleString("ko-KR")}원부터`
      : q.displayKind === "range"
        ? `${q.amount.toLocaleString("ko-KR")}~${q.amountMax?.toLocaleString("ko-KR")}원`
        : `${q.amount.toLocaleString("ko-KR")}원`;
  const lines = [
    `픽업 ${row.pickup_day} ${row.pickup_time.slice(0, 5)}${row.courier_pickup ? " · 퀵" : ""}`,
    `크기 ${row.size_name} · 맛 ${row.flavor_name}`,
    `디자인 ${row.design_name ?? row.design_notes ?? "참고 사진"}`,
    ...(row.design_name && row.design_notes ? [`디자인 설명 ${row.design_notes}`] : []),
    `문구 ${row.lettering || "없음"}`,
    `색 ${row.colors || "없음"}`,
    `주문자 ${row.customer_name} · ${row.customer_phone}`,
    row.allergy_consent === "declined" ? "알레르기 정보 동의 안 함" : `알레르기 ${row.allergy_answer}`,
    ...(row.excluded_ingredients ? [`빼야 할 재료 ${row.excluded_ingredients}`] : []),
    `금액 ${money} · ${q.orderKind === "standard" ? "기본 디자인" : "맞춤 주문"}`,
    ...(q.orderKind === "custom"
      ? ["사장님이 보고 금액을 정해 수락한 뒤 결제 안내가 가요. 보신 금액보다 높으면 먼저 확인을 받아요"]
      : []),
  ];
  const text = lines.join("\n");
  // 새 카드의 변경 고지도 자르지 않고 같은 카드에 넣을 수 있어야 한다.
  if (
    [
      ..."주문 요청 확인",
      ...orderCardDeadline(text, row.time_zone, input.expiresAt),
      ..."\n내용이 바뀌었어요. 새 카드를 확인해 주세요",
    ].length > 400
  )
    return null;
  return { text, timeZone: row.time_zone };
}
