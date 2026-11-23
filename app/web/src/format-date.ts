const seoulDateTime = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul",
  dateStyle: "short",
  timeStyle: "short",
});
/** 저장한 시각을 사장님 화면에서 서울 시각으로 같은 형식으로 보여 준다. */
export const formatSeoulDateTime = (value: string): string => seoulDateTime.format(new Date(value));
