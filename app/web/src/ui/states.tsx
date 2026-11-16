// 08 README 4절의 공통 상태를 그리는 부품. 모습은 09 방향 A 목업(research/cake-mockup-2026-11/gen_screens.py의
// statebox·msgbox·bannerx)과 같고, 글은 08 화면 정의(research/cake-screens-2026-11/screens_common.py)의 것.
import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export type Tone = "warning" | "danger" | "success" | "accent";

/** 배너: 막대 하나에 글과 버튼(오래됨·저장 실패·결과·한도·기준 시각). 화면 읽기 알림은 announce가 따로 함 */
export function Banner({
  tone,
  children,
  detail,
  actions,
}: {
  readonly tone: Tone;
  readonly children: ReactNode;
  readonly detail?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <div className={`ui-banner ui-banner--${tone}`} data-tone={tone}>
      <div className="ui-banner__body">
        <span className="ui-banner__text">{children}</span>
        {detail === undefined ? null : <span className="ui-banner__detail">{detail}</span>}
      </div>
      {actions === undefined ? null : <div className="ui-banner__actions">{actions}</div>}
    </div>
  );
}

/** 화면 내용을 보일 수 없을 때 그 자리를 채우는 상자(불러오기 실패·찾을 수 없음·로그인) */
export function StateBox({
  tone = "info",
  icon,
  title,
  children,
  actions,
}: {
  readonly tone?: "error" | "info";
  readonly icon?: IconName;
  readonly title: string;
  readonly children?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <div className={`ui-statebox ui-statebox--${tone}`}>
      <span className="ui-statebox__icon">
        <Icon name={icon ?? (tone === "error" ? "alert" : "info")} size="lg" />
      </span>
      <h2 className="ui-statebox__title">{title}</h2>
      {children === undefined ? null : <p className="ui-statebox__body">{children}</p>}
      {actions === undefined ? null : <div className="ui-actions ui-actions--center">{actions}</div>}
    </div>
  );
}

/** 빈 상태(08 empty): 점선 상자와 글 하나. 글은 화면 정의의 것(예: '지금 처리할 일이 없어요') */
export function EmptyState({ children, actions }: { readonly children: ReactNode; readonly actions?: ReactNode }) {
  return (
    <div className="ui-empty">
      <Icon name="inbox" size="lg" />
      <p>{children}</p>
      {actions === undefined ? null : <div className="ui-actions ui-actions--center">{actions}</div>}
    </div>
  );
}

/** 불러오는 중(08 loading): 레이아웃은 그대로 두고 데이터 자리에 회색 막대 */
export function Skeleton({ rows = 3, label = "불러오고 있어요" }: { readonly rows?: number; readonly label?: string }) {
  return (
    <div className="ui-skeleton" aria-busy="true">
      <span className="ui-sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 막대는 순서만 있고 바뀌지 않음
        <div className="ui-skeleton__row" key={i} aria-hidden="true">
          <span className="ui-skeleton__bar ui-skeleton__bar--mid" />
          <span className="ui-skeleton__bar ui-skeleton__bar--short" />
        </div>
      ))}
    </div>
  );
}

/** 목록이 연 시각 기준임을 알림(08 stale 목록): 'HH:MM 기준이에요'와 '새로 고침' */
export function AsOf({ time, onRefresh }: { readonly time: string; readonly onRefresh: () => void }) {
  return (
    <Banner
      tone="warning"
      actions={
        <button type="button" className="ui-button ui-button--warn" onClick={onRefresh}>
          새로 고침
        </button>
      }
    >
      {time} 기준이에요
    </Banner>
  );
}

/** 그 시각을 가게 시간대의 'HH:MM'으로(04 G8: 화면의 시각은 가게 시간대) */
export function clockText(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("ko-KR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    at,
  );
}
