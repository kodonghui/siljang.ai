/** 수신 원문에서 주문번호 후보를 정합니다. AI가 번호를 생략해도 다른 주문으로 대신하지 않습니다. */
export type KakaoOrderReference =
  | { readonly kind: "none" }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "explicit"; readonly orderNo: string };

export function kakaoOrderReference(utterance: string): KakaoOrderReference {
  const values = new Set<string>();
  for (const match of utterance.matchAll(/(?<![0-9A-Za-z])[0-9A-Za-z]{6,12}(?![0-9A-Za-z])/g)) {
    values.add(match[0].toUpperCase());
    if (values.size > 1) return { kind: "ambiguous" };
  }
  const orderNo = [...values][0];
  return orderNo === undefined ? { kind: "none" } : { kind: "explicit", orderNo };
}
