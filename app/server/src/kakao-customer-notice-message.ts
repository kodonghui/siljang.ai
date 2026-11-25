/** SCR011 표시. 서버가 확인한 값만 받으며 모델/발신/동의 저장을 실행하지 않는다. */
import { kakaoChannelIdentifierError } from "./kakao-channel-input";
import { normalizeLineBreaks } from "./line-breaks";
import { toShopLocal } from "./time";

type Notice =
  | { readonly kind: "owner_reply" | "server_text"; readonly text: string }
  | { readonly kind: "order_confirmed_saved"; readonly text: string; readonly regulation: readonly string[] }
  | { readonly kind: "delay_notice" | "payment_mismatch" }
  | { readonly kind: "no_answer_closed"; readonly target: "custom" | "change" | "handoff" }
  | {
      readonly kind: "day_before";
      readonly orderNo: string;
      readonly pickupAt: string;
      readonly timeZone: string;
      readonly contactPhone: string;
      readonly location?: string;
    }
  | { readonly kind: "review_request"; readonly orderNo: string; readonly blockId: string }
  | {
      readonly kind: "order_confirmed";
      readonly orderNo: string;
      readonly summary: string;
      readonly pickupAt: string;
      readonly timeZone: string;
      readonly paidAmount: number;
      readonly identity: {
        readonly businessName: string;
        readonly representativeName: string;
        readonly address: string;
        readonly contactPhone: string;
      };
      /** 주문 때 고정한 규정 글. 기존 카드 검사가 허용한 1~2개의 1,000자 글을 받는다. */
      readonly regulation: string | readonly string[];
    };
export type KakaoCustomerNoticeButton = {
  readonly label: string;
  readonly action: "block";
  readonly blockId: string;
  readonly extra: { readonly cardKey: string; readonly choice: "confirm" | "decline" } | { readonly orderNo: string };
};
export type KakaoCustomerNoticePhotoOutput = {
  readonly carousel: {
    readonly type: "basicCard";
    readonly items: readonly {
      readonly title: string;
      readonly thumbnail: { readonly imageUrl: string; readonly altText: string; readonly fixedRatio: true };
    }[];
  };
};
export type KakaoCustomerNoticeTextCarouselOutput = {
  readonly carousel: {
    readonly type: "textCard";
    readonly items: readonly { readonly title: string; readonly description?: string }[];
  };
};
export type KakaoCustomerNoticeOutput =
  | { readonly simpleText: { readonly text: string } }
  | {
      readonly textCard: {
        readonly title: string;
        readonly description: string;
        readonly buttons: readonly KakaoCustomerNoticeButton[];
      };
    }
  | KakaoCustomerNoticePhotoOutput
  | KakaoCustomerNoticeTextCarouselOutput;
export interface KakaoCustomerNoticeMessage {
  readonly version: "2.0";
  readonly template: { readonly outputs: readonly KakaoCustomerNoticeOutput[] };
}
export type KakaoCustomerNoticeDisplayView =
  | { readonly state: "normal" | "deferred"; readonly notice: Notice }
  | { readonly state: "stale"; readonly reason: "gone" }
  | { readonly state: "photo-consent"; readonly mode: "saved" }
  | {
      readonly state: "photo-consent";
      readonly mode: "ask";
      readonly orderNo: string;
      readonly photos: readonly { readonly url: string; readonly altText: string }[];
      readonly cardKey: string;
      readonly blockId: string;
      readonly expiresAt: string;
      readonly timeZone: string;
    };
export type KakaoCustomerNoticeView =
  | KakaoCustomerNoticeDisplayView
  | { readonly state: "stale"; readonly reason: "meaningless" }
  | { readonly state: "error" };

function text(value: string, max = 1000) {
  if (typeof value !== "string") throw new RangeError("invalid customer notice text");
  const normalized = normalizeLineBreaks(value);
  if (!normalized.trim() || [...normalized].length > max || normalized.includes("\0"))
    throw new RangeError("invalid customer notice text");
  return normalized;
}
function orderNo(value: string) {
  if (!/^[A-Z0-9]{6,8}$/.test(value)) throw new RangeError("invalid customer notice order");
  return value;
}
function blockId(value: string) {
  if (kakaoChannelIdentifierError(value, 200) !== null) throw new RangeError("invalid customer notice block");
  return value;
}
function date(value: string, zone: string) {
  if (!Number.isFinite(Date.parse(value))) throw new RangeError("invalid customer notice date");
  return toShopLocal(new Date(value), zone);
}
function pickup(value: string, zone: string) {
  const at = date(value, zone);
  return `${Number(at.date.slice(5, 7))}월 ${Number(at.date.slice(8))}일 ${at.time}`;
}
function simple(value: string): KakaoCustomerNoticeOutput {
  return { simpleText: { text: text(value) } };
}
function fragments(value: string, max: number): KakaoCustomerNoticeOutput[] {
  const outputs: KakaoCustomerNoticeOutput[] = [];
  let part = "",
    length = 0;
  for (const { segment } of new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(text(value, max))) {
    const size = [...segment].length;
    if (size > 1000) throw new RangeError("notice grapheme exceeds text limit");
    if (length + size > 1000) {
      outputs.push({ simpleText: { text: part } });
      part = "";
      length = 0;
    }
    part += segment;
    length += size;
  }
  if (part.length) outputs.push({ simpleText: { text: part } });
  return outputs;
}
function body(outputs: readonly KakaoCustomerNoticeOutput[]): KakaoCustomerNoticeMessage {
  if (!outputs.length || outputs.length > 3) throw new RangeError("invalid customer notice outputs");
  return { version: "2.0", template: { outputs } };
}
/** 사실·주문 내용·규정을 제목40자·설명128자로 나누어 세 캐러셀 안에 보존한다. */
function longConfirmedNotice(value: string): KakaoCustomerNoticeMessage {
  const segments = [...new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(text(value, 5040))].map(
    ({ segment }) => ({ text: segment, length: [...segment].length }),
  );
  let index = 0;
  const take = (max: number) => {
    let result = "",
      length = 0;
    while (index < segments.length) {
      const part = segments[index];
      if (!part || length + part.length > max) break;
      result += part.text;
      length += part.length;
      index++;
    }
    return result;
  };
  const items: { title: string; description?: string }[] = [];
  while (index < segments.length) {
    const start = index,
      title = `확정 안내 ${items.length + 1}\n${take(40)}`,
      description = take(128);
    if (index === start || items.length >= 30) throw new RangeError("notice graphemes exceed carousel limit");
    items.push({ title, ...(description.length ? { description } : {}) });
  }
  const outputs: KakaoCustomerNoticeTextCarouselOutput[] = [];
  for (let at = 0; at < items.length; at += 10)
    outputs.push({ carousel: { type: "textCard", items: items.slice(at, at + 10) } });
  return body(outputs);
}
function noticeBody(notice: Notice): KakaoCustomerNoticeMessage {
  switch (notice.kind) {
    case "owner_reply":
      return body([simple(notice.text)]);
    case "server_text":
      return body(fragments(notice.text, 2000));
    case "order_confirmed_saved": {
      if (!Array.isArray(notice.regulation) || notice.regulation.length < 1 || notice.regulation.length > 2)
        throw new RangeError("invalid saved confirmed terms");
      const outputs = [...fragments(notice.text, 5040), ...notice.regulation.map(simple)];
      if (outputs.length <= 3) return body(outputs);
      const combined = [notice.text, ...notice.regulation].join("\n");
      const pieces = fragments(combined, 5040);
      return pieces.length <= 3 ? body(pieces) : longConfirmedNotice(combined);
    }
    case "delay_notice":
      return body([simple("사장님 확인이 늦어지고 있어요. 확인되면 바로 알려 드릴게요")]);
    case "payment_mismatch":
      return body([simple("보내신 금액이 안내와 달라 사장님이 연락드릴게요")]);
    case "no_answer_closed": {
      const values = {
        custom: "사장님이 답하지 못해 주문 요청이 닫혔어요. 다른 날로 다시 요청할 수 있어요",
        change: "사장님이 변경 마감까지 답하지 못해 변경 요청이 닫혔어요. 주문은 원래대로예요",
        handoff: "사장님이 답하지 못해 문의가 닫혔어요. 필요하시면 다시 물어봐 주세요",
      };
      if (!Object.hasOwn(values, notice.target)) throw new RangeError("invalid closed notice");
      return body([simple(values[notice.target])]);
    }
    case "day_before":
      return body([
        simple(
          [
            `주문 ${orderNo(notice.orderNo)} · 내일 ${pickup(notice.pickupAt, notice.timeZone)} 픽업이에요`,
            ...(notice.location?.trim() ? [`픽업 장소: ${text(notice.location, 500)}`] : []),
            `가게 연락처: ${text(notice.contactPhone, 40)}`,
          ].join("\n"),
        ),
      ]);
    case "review_request":
      return body([
        {
          textCard: {
            title: "후기 부탁",
            description: `주문 ${orderNo(notice.orderNo)}의 후기를 남겨 주세요`,
            buttons: [
              {
                label: "후기 남기기",
                action: "block",
                blockId: blockId(notice.blockId),
                extra: { orderNo: notice.orderNo },
              },
            ],
          },
        },
      ]);
    case "order_confirmed": {
      if (!Number.isSafeInteger(notice.paidAmount) || notice.paidAmount < 0 || notice.paidAmount > 10000000)
        throw new RangeError("invalid confirmed amount");
      const terms = typeof notice.regulation === "string" ? [notice.regulation] : notice.regulation;
      if (!Array.isArray(terms) || terms.length < 1 || terms.length > 2)
        throw new RangeError("invalid confirmed terms");
      const facts = [
        "주문이 확정됐어요",
        `주문번호 ${orderNo(notice.orderNo)}`,
        text(notice.summary),
        `픽업 ${pickup(notice.pickupAt, notice.timeZone)}`,
        `결제가 확인된 금액 ${notice.paidAmount.toLocaleString("ko-KR")}원`,
        `상호 ${text(notice.identity.businessName)}`,
        `대표자 ${text(notice.identity.representativeName)}`,
        `사업장 주소 ${text(notice.identity.address)}`,
        `전화번호 ${text(notice.identity.contactPhone, 40)}`,
      ].join("\n");
      return body([simple(facts), ...terms.map(simple)]);
    }
    default:
      throw new RangeError("invalid customer notice");
  }
}
export function kakaoCustomerNoticeMessage(view: KakaoCustomerNoticeDisplayView): KakaoCustomerNoticeMessage;
export function kakaoCustomerNoticeMessage(view: KakaoCustomerNoticeView): KakaoCustomerNoticeMessage | null;
export function kakaoCustomerNoticeMessage(view: KakaoCustomerNoticeView): KakaoCustomerNoticeMessage | null {
  if (view.state === "error") return null;
  if (view.state === "stale") {
    if (view.reason === "meaningless") return null;
    if (view.reason !== "gone") throw new RangeError("invalid stale notice");
    return body([simple("지금은 전할 안내가 없어요")]);
  }
  if (view.state === "normal" || view.state === "deferred") return noticeBody(view.notice);
  if (view.state !== "photo-consent") throw new RangeError("invalid customer notice state");
  if (view.mode === "saved") return body([simple("알려 주셔서 고마워요. 사진 게시 동의는 언제든 철회할 수 있어요")]);
  if (view.mode !== "ask" || !Array.isArray(view.photos) || view.photos.length < 1 || view.photos.length > 5)
    throw new RangeError("invalid notice photos");
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(view.cardKey)) throw new RangeError("invalid photo consent card");
  const items = view.photos.map((photo, index) => {
    const url = new URL(text(photo.url, 2048));
    if (url.protocol !== "https:" || url.username || url.password || url.hash)
      throw new RangeError("invalid notice photo URL");
    return {
      title: `완성 사진 ${index + 1}/${view.photos.length}`,
      thumbnail: { imageUrl: photo.url, altText: text(photo.altText, 50), fixedRatio: true as const },
    };
  });
  const title = `사진 게시 동의 · ${orderNo(view.orderNo)}`;
  const description = [
    "언제든 철회할 수 있으니, 이 사진을 가게 포트폴리오와 예약 링크 페이지에 올려도 될지 알려 주세요",
    `${date(view.expiresAt, view.timeZone).time}까지 눌러 주세요`,
  ].join("\n");
  if ([...title, ...description].length > 400) throw new RangeError("invalid photo consent description");
  return body([
    { carousel: { type: "basicCard", items } },
    simple("바꾸고 싶으시면 말씀해 주세요"),
    {
      textCard: {
        title,
        description,
        buttons: [
          {
            label: "올려도 돼요",
            action: "block",
            blockId: blockId(view.blockId),
            extra: { cardKey: view.cardKey, choice: "confirm" },
          },
          {
            label: "안 돼요",
            action: "block",
            blockId: view.blockId,
            extra: { cardKey: view.cardKey, choice: "decline" },
          },
        ],
      },
    },
  ]);
}
