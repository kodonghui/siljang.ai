/** 처리방침의 현재 전체 본문. 고정 문장이 바뀐 배포도 같은 비교 경로를 쓴다. */
import type { OverseasTransfer } from "./privacy-policy-settings";

export function privacyPolicyBody(
  shop: { name: string; contact_email: string; contact_phone: string },
  transfers: readonly OverseasTransfer[],
): string {
  return [
    `${shop.name} 개인정보 처리방침`,
    `개인정보 처리자: ${shop.name}. 문의·열람·정정·삭제·동의 철회: ${shop.contact_email}, ${shop.contact_phone}.`,
    "상담 대화와 도안 사진은 상담·견적에, 주문자 이름과 연락처는 픽업·급한 연락에, 입금자 이름은 입금 대조에 사용합니다.",
    "주문자 이름·연락처·입금자 이름은 AI를 거치지 않는 입력으로 받으며 AI 모델 회사에 보내지 않습니다.",
    "알레르기 정보는 따로 동의한 손님에게서만 AI를 거치지 않는 입력으로 받습니다. 제작 중 알레르기 확인에만 사용하고 가게 사장님만 봅니다. AI 모델 회사에 보내지 않습니다.",
    "상담 대화는 상담이 닫히고 30일 뒤 지웁니다. 주문 개인정보와 알레르기 정보는 주문이 끝나고 30일 뒤 지웁니다. 계약·결제 기록은 별도로 나누어 5년, 문제 신고 기록은 3년 보관합니다.",
    "손님은 위 연락처로 열람·정정·삭제·동의 철회를 신청할 수 있습니다. 법령에 따라 따로 보관하는 기록은 그 보유 기간 뒤 지웁니다.",
    "개인정보 처리 위탁·재위탁 및 국외 이전:",
    ...transfers.map(
      (t) =>
        `받는 자: ${t.recipient}\n나라: ${t.country}\n옮기는 개인정보: ${t.personalData}\n시기·방법: ${t.whenAndHow}\n목적·보유 기간: ${t.purposeAndRetention}\n거부 방법·절차와 결과: ${t.howToRefuse}`,
    ),
  ].join("\n\n");
}
