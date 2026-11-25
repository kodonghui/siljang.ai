/** SCR011의 표시 함수. 업무의 이벤트/본인 확인과 발신/동의 저장은 이 모듈에서 실행하지 않는다. */
export interface KakaoCustomerNoticeView {
  readonly state: "normal";
  readonly notice: { readonly kind: "owner_reply"; readonly text: string };
}
export function kakaoCustomerNoticeMessage(view: KakaoCustomerNoticeView) {
  if (
    view.state !== "normal" ||
    view.notice.kind !== "owner_reply" ||
    typeof view.notice.text !== "string" ||
    !view.notice.text.trim() ||
    [...view.notice.text].length > 1000 ||
    view.notice.text.includes("\0")
  )
    throw new RangeError("invalid customer notice text");
  return { version: "2.0" as const, template: { outputs: [{ simpleText: { text: view.notice.text } }] } };
}
