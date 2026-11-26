/** 확정 시점의 표시를 저장하고, 주문에 고정한 규정과 연결 채널의 버튼만 읽는다. */

import type { KakaoMessageContent } from "./kakao-message-content";
import { kakaoOrderTerms } from "./kakao-order-request-content";
import type { ClauseInput } from "./operating-rules-input";
import type { ShopDb } from "./shop-scope";

/** 손님 이름·연락처·알레르기는 확정 안내의 주문 내용에서 읽지 않는다. */
export async function readOrderNoticeSummary(db: ShopDb, orderId: string, version: number): Promise<string | null> {
  const row = (
    await db.run<{
      size_name: string | null;
      flavor_name: string | null;
      design_name: string | null;
      design_notes: string | null;
      lettering: string | null;
      colors: string | null;
      extras: string[];
    }>(
      `SELECT sz.name AS size_name,fl.name AS flavor_name,coalesce(de.name,ds.name) AS design_name,
      d.design_notes,d.lettering,d.colors,
      ARRAY(SELECT px.name FROM order_detail_extras ex JOIN price_options px
        ON px.shop_id=$1 AND px.price_list_id=ex.price_list_id AND px.id=ex.option_id
        WHERE ex.shop_id=$1 AND ex.order_detail_id=d.id ORDER BY px.name,px.id) AS extras
      FROM order_details d
      LEFT JOIN price_options sz ON sz.shop_id=$1 AND sz.price_list_id=d.price_list_id AND sz.id=d.size_option_id
      LEFT JOIN price_options fl ON fl.shop_id=$1 AND fl.price_list_id=d.price_list_id AND fl.id=d.flavor_option_id
      LEFT JOIN price_options ds ON ds.shop_id=$1 AND ds.price_list_id=d.price_list_id AND ds.id=d.design_option_id
      LEFT JOIN designs de ON de.shop_id=$1 AND de.price_list_id=d.price_list_id AND de.id=d.design_id
      WHERE d.shop_id=$1 AND d.order_id=$2 AND d.version=$3`,
      [orderId, version],
    )
  ).rows[0];
  if (!row) return null;
  const lines = [
    "주문 내용",
    ...(row.size_name ? [`크기 ${row.size_name}`] : []),
    ...(row.flavor_name ? [`맛 ${row.flavor_name}`] : []),
    ...(row.design_name ? [`디자인 ${row.design_name}`] : []),
    ...(row.design_notes ? [`디자인 설명 ${row.design_notes}`] : []),
    ...(row.lettering !== null ? [`문구 ${row.lettering || "없음"}`] : []),
    ...(row.colors !== null ? [`색 ${row.colors || "없음"}`] : []),
    ...(row.extras.length ? [`더하는 옵션 ${row.extras.join(" · ")}`] : []),
  ];
  return lines.join("\n");
}

interface NoticeIdentity {
  readonly id: string;
  readonly customerId: string;
}
export async function confirmedNoticeContents(
  db: ShopDb,
  notice: NoticeIdentity,
): Promise<readonly KakaoMessageContent[] | null> {
  const row = (
    await db.run<{
      body: string;
      template_key: string;
      order_id: string;
      operating_rules_id: string;
      rules_version: number;
    }>(
      `SELECT n.body,n.template_key,o.id AS order_id,o.operating_rules_id,r.version AS rules_version
      FROM notifications n JOIN orders o ON o.shop_id=$1 AND o.id=n.order_id AND o.customer_id=n.customer_id
      JOIN consultations c ON c.shop_id=$1 AND c.id=n.consultation_id AND c.customer_id=n.customer_id
      JOIN operating_rules r ON r.shop_id=$1 AND r.id=o.operating_rules_id
      WHERE n.shop_id=$1 AND n.id=$2 AND n.customer_id=$3 AND n.kind='order_confirmed' AND n.status<>'dropped'
        AND o.status IN ('confirmed','received','no_pickup') AND o.personal_data_purged_at IS NULL AND c.status<>'deleted'`,
      [notice.id, notice.customerId],
    )
  ).rows[0];
  if (!row) return null;
  // v3는 신원/결제 사실과 확정 당시의 불변 주문 버전을 분리해 보존한다. v1은 첫 버전, v2는 본문에 이미 담긴 내용을 쓴다.
  const bound = /^order_confirmed:v3:([1-9]\d{0,9})$/.exec(row.template_key);
  const version = bound ? Number(bound[1]) : 1;
  if (row.template_key.startsWith("order_confirmed:v3:") && (!bound || version > 2147483647)) return null;
  const summary =
    row.template_key === "order_confirmed:v2" ? null : await readOrderNoticeSummary(db, row.order_id, version);
  if (row.template_key !== "order_confirmed:v2" && summary === null) return null;
  const clauses = (
    await db.run<{
      clause_key: ClauseInput["key"];
      position: number;
      title: string;
      condition_text: string;
      effect_text: string;
    }>(
      "SELECT clause_key,position,title,condition_text,effect_text FROM rule_clauses WHERE shop_id=$1 AND operating_rules_id=$2 ORDER BY position",
      [row.operating_rules_id],
    )
  ).rows;
  const regulation = kakaoOrderTerms({
    version: row.rules_version,
    clauses: clauses.map((c) => ({
      key: c.clause_key,
      position: c.position,
      title: c.title,
      condition: c.condition_text,
      effect: c.effect_text,
    })),
  });
  return [
    {
      kind: "customer_notice",
      view: {
        state: "normal",
        notice: {
          kind: "order_confirmed_saved",
          text: summary === null ? row.body : `${row.body}\n${summary}`,
          regulation,
        },
      },
    },
  ];
}

export async function reviewNoticeContents(
  db: ShopDb,
  notice: NoticeIdentity,
): Promise<readonly KakaoMessageContent[] | null> {
  const row = (
    await db.run<{ order_no: string; review_block_id: string | null }>(
      `SELECT o.order_no,ch.review_block_id FROM notifications n
      JOIN orders o ON o.shop_id=$1 AND o.id=n.order_id AND o.customer_id=n.customer_id
      JOIN consultations c ON c.shop_id=$1 AND c.id=n.consultation_id AND c.customer_id=n.customer_id
      JOIN customers u ON u.shop_id=$1 AND u.id=n.customer_id
      JOIN kakao_channels ch ON ch.shop_id=$1 AND ch.id=u.kakao_channel_id AND ch.status='linked'
      WHERE n.shop_id=$1 AND n.id=$2 AND n.customer_id=$3 AND n.kind='review_request' AND n.status<>'dropped'
        AND o.personal_data_purged_at IS NULL AND c.status<>'deleted'`,
      [notice.id, notice.customerId],
    )
  ).rows[0];
  if (!row?.review_block_id) return null;
  return [
    {
      kind: "customer_notice",
      view: {
        state: "normal",
        notice: {
          kind: "review_request",
          orderNo: row.order_no,
          blockId: row.review_block_id,
        },
      },
    },
  ];
}
