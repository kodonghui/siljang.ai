// 목록 부품(TASK-182, 08 W4 '목록은 1280에서 표, 360에서 카드', 09 gen_screens.py의 tablex·cards·rowlink).
// 열 정의 하나로 표(넓은 화면, 제목 열이 링크 셀)와 카드(좁은 화면, 제목이 링크, 나머지 열은 자리마다)를 함께 그리고,
// 한쪽은 CSS로 숨겨(display: none) 화면 읽기 프로그램이 두 번 읽지 않는다. 빈 목록은 EmptyState(08 empty).
// 불러오는 중(Skeleton)·불러오기 실패(LoadFailure)·기준 시각(AsOf)은 화면이 이 부품 대신 또는 위에 그린다.
import type { MouseEvent, ReactNode } from "react";
import type { Navigate } from "./Layout";
import { EmptyState } from "./states";

/** 카드에서의 자리: title(링크, 열 하나), tag(제목 오른쪽 라벨), meta('열 이름 값' 줄), body(문단), foot(아래 줄: 금액·버튼) */
export type CardSlot = "title" | "tag" | "meta" | "body" | "foot";

export interface ListColumn<Row> {
  /** 표 머리와 카드 meta의 이름 */
  readonly label: string;
  readonly cell: (row: Row) => ReactNode;
  readonly card: CardSlot;
  /** 표 열 너비: narrow는 size.thumb, wide는 size.aside, 없으면 남은 너비를 나눔 */
  readonly width?: "narrow" | "wide";
}

export interface ListViewProps<Row> {
  /** 목록 이름(표 caption, 카드 목록의 aria-label) */
  readonly label: string;
  readonly columns: readonly ListColumn<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  /** 행의 상세 화면 주소(07 경로) */
  readonly href?: (row: Row) => string | null;
  readonly onNavigate?: Navigate;
  /** 빈 목록의 글(08 화면 정의의 empty 글) */
  readonly empty: ReactNode;
}

export function ListView<Row>({ label, columns, rows, rowKey, href, onNavigate, empty }: ListViewProps<Row>) {
  const titles = columns.filter((c) => c.card === "title");
  const title = titles[0];
  if (title === undefined || titles.length > 1) throw new Error(`${label}: 제목 열(card: "title")은 하나여야 함`);
  if (rows.length === 0) return <EmptyState>{empty}</EmptyState>;

  const link = (row: Row, strong: boolean) => {
    const to = href?.(row);
    if (to === undefined || to === null)
      return <span className={`ui-list__title${strong ? " ui-list__title--strong" : ""}`}>{title.cell(row)}</span>;
    return (
      <a
        className={`ui-list__link${strong ? " ui-list__link--strong" : ""}`}
        href={to}
        onClick={(e: MouseEvent<HTMLAnchorElement>) => onNavigate?.(to, e)}
      >
        {title.cell(row)}
      </a>
    );
  };
  const slot = (s: CardSlot) => columns.filter((c) => c.card === s);

  return (
    <div className="ui-list">
      <table className="ui-list__table">
        <caption className="ui-sr-only">{label}</caption>
        <colgroup>
          {columns.map((c) => (
            <col key={c.label} className={c.width === undefined ? undefined : `ui-list__col--${c.width}`} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.label} scope="col">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) =>
                c === title ? (
                  <td key={c.label} className={href?.(row) == null ? undefined : "ui-list__linkcell"}>
                    {link(row, false)}
                  </td>
                ) : (
                  <td key={c.label}>{c.cell(row)}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="ui-list__cards" aria-label={label}>
        {rows.map((row) => {
          const tags = slot("tag");
          const meta = slot("meta");
          const foot = slot("foot");
          return (
            <li key={rowKey(row)} className="ui-list__card">
              <div className="ui-list__cardhead">
                <span className="ui-list__cardtitle">{link(row, true)}</span>
                {tags.length === 0 ? null : (
                  <span className="ui-list__tags">
                    {tags.map((c) => (
                      <span key={c.label}>{c.cell(row)}</span>
                    ))}
                  </span>
                )}
              </div>
              {slot("body").map((c) => (
                <p key={c.label} className="ui-list__body">
                  {c.cell(row)}
                </p>
              ))}
              {meta.length === 0 ? null : (
                <dl className="ui-list__meta">
                  {meta.map((c) => (
                    <div key={c.label} className="ui-list__metarow">
                      <dt>{c.label}</dt>
                      <dd>{c.cell(row)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {foot.length === 0 ? null : (
                <div className="ui-list__foot">
                  {foot.map((c) => (
                    <span key={c.label}>{c.cell(row)}</span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
