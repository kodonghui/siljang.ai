const seoulDateTime = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul",
  dateStyle: "short",
  timeStyle: "short",
});
/** 저장한 시각을 사장님 화면에서 서울 시각으로 같은 형식으로 보여 준다. */
export const formatSeoulDateTime = (value: string): string => seoulDateTime.format(new Date(value));
const seoulDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", dateStyle: "short" });
export const formatSeoulDate = (value: string): string => seoulDate.format(new Date(value));

const koreanDateTime = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  dateStyle: "medium",
  timeStyle: "short",
});
export const formatKoreanDateTime = (value: string): string => koreanDateTime.format(new Date(value));

const seoulTime = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
export const formatSeoulTime = (value: string | number): string => seoulTime.format(new Date(value));

export const formatKoreanDate = (day: string): string =>
  `${Number(day.slice(0, 4))}년 ${Number(day.slice(5, 7))}월 ${Number(day.slice(8))}일`;
