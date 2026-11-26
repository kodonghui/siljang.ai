/** 현재 손님의 모아 둔 신고 자료를 표시한다. 신고 접수·기한 판정·보상은 하지 않는다. */
import type { KakaoIssueReportCard } from "./kakao-issue-report-message";
import { normalizeLineBreaks } from "./line-breaks";
import type { ShopDb } from "./shop-scope";

export interface IssueCardBinding {
  readonly detailsId: string;
  readonly sourceHash: string;
}
export type IssueCardSource =
  | {
      readonly available: true;
      readonly binding: IssueCardBinding;
      readonly presentation: Omit<KakaoIssueReportCard, "cardKey" | "blockId" | "expiresAt">;
    }
  | { readonly available: false; readonly reason: "not_received" | "not_ready"; readonly text: string };
function unavailable(reason: "not_received" | "not_ready"): IssueCardSource {
  return {
    available: false,
    reason,
    text: reason === "not_received" ? "지금은 할 수 없어요: 아직 받지 않은 주문이에요" : "잠시 뒤 다시 말씀해 주세요",
  };
}

export async function readPreparedIssueCard(
  db: ShopDb,
  input: { readonly orderId: string; readonly customerId: string; readonly consultationId: string },
): Promise<IssueCardSource> {
  const order = (
    await db.run<{ order_no: string; status: string; time_zone: string; handed_over_at: Date | null }>(
      `SELECT o.order_no,o.status,s.time_zone,p.handed_over_at FROM orders o
      JOIN shops s ON s.id=$1 LEFT JOIN productions p ON p.shop_id=$1 AND p.order_id=o.id
      WHERE o.shop_id=$1 AND o.id=$2 AND o.customer_id=$3 AND o.personal_data_purged_at IS NULL FOR UPDATE OF o`,
      [input.orderId, input.customerId],
    )
  ).rows[0];
  if (order === undefined) return unavailable("not_ready");
  if (order.status !== "received") return unavailable("not_received");
  if (order.handed_over_at === null || !Number.isFinite(order.handed_over_at.getTime()))
    return unavailable("not_ready");
  // 원본 행을 잠근 다음 사진을 읽는다. 그 사이 새 사진의 외래 키 쓰기도 기다린다.
  const details = (
    await db.run<{ id: string; description: string | null; health_concern: boolean }>(
      `SELECT i.id,i.description,i.health_concern FROM issue_details i
      JOIN consultations c ON c.shop_id=$1 AND c.id=i.consultation_id AND c.customer_id=$4
      WHERE i.shop_id=$1 AND i.order_id=$2 AND i.consultation_id=$3 AND i.status='collecting'
        AND i.content_purged_at IS NULL AND c.status NOT IN ('ended','deleted','dropped') FOR UPDATE OF i`,
      [input.orderId, input.consultationId, input.customerId],
    )
  ).rows[0];
  if (details?.description == null) return unavailable("not_ready");
  const description = normalizeLineBreaks(details.description);
  if (!description.trim()) return unavailable("not_ready");
  const photos = (
    await db.run<{ id: string; position: number }>(
      "SELECT id,position FROM issue_photos WHERE shop_id=$1 AND issue_details_id=$2 ORDER BY position,id",
      [details.id],
    )
  ).rows;
  const receivedAt = order.handed_over_at.toISOString();
  const data = [
    details.id,
    description,
    details.health_concern,
    photos.map((p) => [p.id, p.position]),
    receivedAt,
    order.order_no,
    order.time_zone,
  ];
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(data))));
  return {
    available: true,
    binding: { detailsId: details.id, sourceHash: [...hash].map((x) => x.toString(16).padStart(2, "0")).join("") },
    presentation: {
      orderNo: order.order_no,
      description,
      photoCount: photos.length,
      showMedicalNotice: details.health_concern,
      receivedAt,
      timeZone: order.time_zone,
    },
  };
}
