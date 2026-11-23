// 사장님·운영자 화면 레이아웃(TASK-182, 08 W4, 09 방향 A 목업의 side_menu·topbar·desk·phone·setup_wide·login_frame).
// - 넓은 화면(1280): 왼쪽 메뉴(size.menu)와 가운데 열(size.content까지). 하위 화면은 제목 왼쪽에 '뒤로'.
// - 좁은 화면(360): 위쪽 막대(size.bar)에 '메뉴 열기'(메뉴 항목 화면) 또는 '뒤로'(하위 화면)와 제목. '메뉴 열기'는 같은 메뉴를
//   왼쪽에서 여는 모달 <dialog>(09에 그리지 않은 상태).
// 넓고 좁음을 가르는 너비는 src/styles/layout.css의 @media 하나(size.menu + size.content, styles.test.ts가 토큰에서 계산해 대조)이고,
// 한쪽에만 쓰는 것은 CSS로 숨겨(display: none) 화면 읽기 프로그램이 두 번 읽지 않는다.
// 라우터는 아직 없다: 링크는 07 경로의 보통 <a>이고, 화면 작업이 라우터를 붙일 때 onNavigate로 가로챈다.
import {
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { focusables, keepFocusInside } from "./focus";
import {
  CLOSE_MENU_LABEL,
  GO_BACK_LABEL,
  isMenuScreen,
  LOGOUT_LABEL,
  MENU_BRAND,
  MENU_NAME,
  MENUS,
  type MenuShell,
  OPEN_MENU_LABEL,
  sectionOf,
} from "./menus";

/** 서비스 이름(09 목업 SERVICE) */
export const SERVICE_NAME = "Siljang";

/** 링크를 누를 때(라우터가 붙으면 e.preventDefault() 뒤 화면을 바꿈). 없으면 보통 링크로 이동 */
export type Navigate = (href: string, e: MouseEvent<HTMLAnchorElement>) => void;

interface MenuLayoutBase {
  /** 지금 화면(07 SCR ID). 메뉴에서 이 화면이 속한 1뎁스를 표시함 */
  readonly screen: string;
  /** 제목(08 레이아웃의 위쪽 막대 제목) */
  readonly title: string;
  /** 제목 아래 한 줄(08·09의 meta, 예: '확인 필요 3건') */
  readonly meta?: ReactNode;
  readonly busy?: boolean;
  /** '뒤로'의 목적지: 07 상위 화면의 주소. 메뉴 항목 화면이 아니면 꼭 줌(브라우저 뒤로가 아님) */
  readonly back?: string;
  readonly onNavigate?: Navigate;
  readonly children: ReactNode;
}

export interface OwnerLayoutProps extends MenuLayoutBase {
  /** 메뉴 머리와 360 위쪽 막대 오른쪽의 가게 이름 */
  readonly shopName: string;
  /** '할 일' 옆 수(없거나 0이면 안 보임) */
  readonly todoCount?: number;
}

export interface OperatorLayoutProps extends MenuLayoutBase {
  /** 메뉴 머리와 1280 제목 줄 오른쪽의 운영자 이름 */
  readonly operatorName: string;
  /** 메뉴 아래 '로그아웃'(API-006 연결은 운영자 화면 작업) */
  readonly onLogout: () => void;
}

export function OwnerLayout({ shopName, todoCount, ...rest }: OwnerLayoutProps) {
  return <MenuLayout {...rest} shell="owner" who={shopName} todoCount={todoCount} />;
}

export function OperatorLayout({ operatorName, onLogout, ...rest }: OperatorLayoutProps) {
  return <MenuLayout {...rest} shell="operator" who={operatorName} onLogout={onLogout} />;
}

interface MenuLayoutProps extends MenuLayoutBase {
  readonly shell: MenuShell;
  readonly who: string;
  readonly todoCount?: number | undefined;
  readonly onLogout?: (() => void) | undefined;
}

function MenuLayout({
  shell,
  screen,
  title,
  meta,
  back,
  onNavigate,
  who,
  todoCount,
  onLogout,
  children,
  busy = false,
}: MenuLayoutProps) {
  const top = isMenuScreen(shell, screen);
  if (!top && back === undefined) throw new Error(`${screen}: 메뉴 항목 화면이 아니면 '뒤로'의 목적지(back)가 필요함`);
  const [open, setOpen] = useState(false);
  const sheetId = useId();
  const openButton = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const menu = (inSheet: boolean) => (
    <MenuBody
      shell={shell}
      screen={screen}
      who={who}
      todoCount={todoCount}
      onLogout={onLogout}
      onNavigate={(href, e) => {
        if (busy) {
          e.preventDefault();
          return;
        }
        if (inSheet) setOpen(false);
        onNavigate?.(href, e);
      }}
    />
  );
  const backLink =
    back === undefined ? null : (
      <a className="ui-layout__lead" href={back} aria-label={GO_BACK_LABEL} onClick={(e) => onNavigate?.(back, e)}>
        <LeadIcon name="back" />
      </a>
    );
  return (
    <div className={`ui-layout ui-layout--${shell}`}>
      <nav className="ui-layout__side ui-menu" aria-label={MENU_NAME[shell]} inert={busy}>
        {menu(false)}
      </nav>
      <div className="ui-layout__page">
        <header className="ui-layout__head">
          {top ? (
            <button
              ref={openButton}
              type="button"
              disabled={busy}
              className="ui-layout__lead ui-layout__open"
              aria-label={OPEN_MENU_LABEL}
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-controls={sheetId}
              onClick={() => setOpen(true)}
            >
              <LeadIcon name="menu" />
            </button>
          ) : (
            backLink
          )}
          <div className="ui-layout__titles">
            <h1 className="ui-layout__title">{title}</h1>
            {meta === undefined ? null : <p className="ui-layout__meta">{meta}</p>}
          </div>
          {shell === "owner" && top ? <span className="ui-layout__who ui-narrow-only">{who}</span> : null}
          {shell === "operator" ? <span className="ui-layout__who ui-wide-only">{who}</span> : null}
        </header>
        <main className="ui-layout__main">{children}</main>
      </div>
      {top ? (
        <MenuSheet id={sheetId} shell={shell} open={open} onClose={close} opener={openButton}>
          {menu(true)}
        </MenuSheet>
      ) : null}
    </div>
  );
}

function MenuBody({
  shell,
  screen,
  who,
  todoCount,
  onLogout,
  onNavigate,
}: {
  readonly shell: MenuShell;
  readonly screen: string;
  readonly who: string;
  readonly todoCount?: number | undefined;
  readonly onLogout?: (() => void) | undefined;
  readonly onNavigate: Navigate;
}) {
  const section = sectionOf(shell, screen);
  return (
    <>
      <div className="ui-menu__brand">
        <span className="ui-menu__name">{MENU_BRAND[shell]}</span>
        <span className="ui-menu__who">{who}</span>
      </div>
      <ul className="ui-menu__list">
        {MENUS[shell].map((m) => {
          // 1뎁스 화면 자체는 page, 그 아래 화면에서 속한 1뎁스를 표시할 때는 true(지금 페이지가 아니라 지금 있는 묶음)
          const current = m.screen === screen ? "page" : m === section ? "true" : undefined;
          const count = m.screen === "SCR-016" && todoCount !== undefined && todoCount > 0 ? todoCount : null;
          return (
            <li key={m.screen}>
              <a
                className="ui-menu__item"
                href={m.path}
                aria-current={current}
                data-screen={m.screen}
                onClick={(e) => onNavigate(m.path, e)}
              >
                <span>{m.label}</span>
                {count === null ? null : (
                  <span className="ui-menu__count">
                    <span className="ui-sr-only"> </span>
                    {count}
                    <span className="ui-sr-only">건</span>
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
      {shell === "operator" ? (
        <button type="button" className="ui-menu__logout" onClick={onLogout}>
          {LOGOUT_LABEL}
        </button>
      ) : null}
    </>
  );
}

/**
 * 360 열린 메뉴: 왼쪽에서 여는 모달 <dialog>(showModal, 뒤는 막힘). 09에 그리지 않은 상태라 확인 창(ConfirmDialog)과 같은 방식으로 만듦.
 * - 열면 지금 화면이 속한 메뉴 항목(없으면 첫 항목)에 포커스. Tab·Shift+Tab은 창 안에서 돎.
 * - Esc·'메뉴 닫기'·바깥(scrim) 누르기·메뉴 항목 누르기로 닫히고, 닫히면 '메뉴 열기'로 포커스가 돌아감.
 * - 열린 채 넓은 화면이 되면('메뉴 열기'가 안 보이면) 닫음.
 */
function MenuSheet({
  id,
  shell,
  open,
  onClose,
  opener,
  children,
}: {
  readonly id: string;
  readonly shell: MenuShell;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly opener: { readonly current: HTMLButtonElement | null };
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      dialog.showModal();
      const target =
        dialog.querySelector<HTMLElement>(".ui-menu__item[aria-current]") ??
        dialog.querySelector<HTMLElement>(".ui-menu__item") ??
        focusables(dialog)[0];
      target?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      const button = opener.current;
      if (button === null || getComputedStyle(button).display === "none") onClose();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, onClose, opener]);

  const handleClose = () => {
    if (ref.current?.open) return;
    const button = opener.current;
    if (button?.isConnected && getComputedStyle(button).display !== "none") button.focus();
    // 브라우저가 스스로 닫았어도 화면 상태를 맞춤
    onClose();
  };

  const cancelByEscape = (e: SyntheticEvent<HTMLDialogElement>) => {
    e.preventDefault();
    onClose();
  };

  // 창 바깥(scrim)을 누르면 닫음: 안쪽은 .ui-sheet__inner가 다 채우므로 dialog 자체가 대상이면 바깥.
  // 키보드로는 Esc(cancel)와 '메뉴 닫기'로 닫는다
  const closeOnScrim = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <dialog
      ref={ref}
      id={id}
      className="ui-sheet"
      aria-label={MENU_NAME[shell]}
      onCancel={cancelByEscape}
      onClose={handleClose}
      onKeyDown={keepFocusInside}
      onClick={closeOnScrim}
    >
      <div className="ui-sheet__inner ui-menu">
        <button type="button" className="ui-sheet__close" onClick={onClose}>
          {CLOSE_MENU_LABEL}
        </button>
        {children}
      </div>
    </dialog>
  );
}

const LEAD_PATHS = {
  menu: (
    <>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </>
  ),
  back: (
    <>
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </>
  ),
} as const;

/** 위쪽 막대의 아이콘(09 gen.py ICONS의 menu·back, 크기 size.icon-lg) */
function LeadIcon({ name }: { readonly name: keyof typeof LEAD_PATHS }) {
  return (
    <svg
      className="ui-icon ui-icon--lg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {LEAD_PATHS[name]}
    </svg>
  );
}

/** 화면 본문의 한 묶음: 360은 띠(좌우 여백 space.lg, 사이 선), 1280은 블록(사이 선과 위 여백 space.xl). 09 gen.py의 band·block */
export function PageSection({ title, children }: { readonly title?: string; readonly children: ReactNode }) {
  return (
    <section className="ui-section">
      {title === undefined ? null : <h2 className="ui-section__title">{title}</h2>}
      {children}
    </section>
  );
}

/**
 * 가게 등록 전 사장님 화면(SCR-015, 메뉴 없음). 360은 위쪽 막대에 제목만, 1280은 위쪽 막대에 'Siljang 사장님'과
 * 가운데 좁은 열(size.content − size.aside)의 제목(09 setup_wide).
 */
export function SetupLayout({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="ui-setup">
      <header className="ui-setup__bar">
        <h1 className="ui-setup__title ui-narrow-only">{title}</h1>
        <span className="ui-setup__brand ui-wide-only">{MENU_BRAND.owner}</span>
      </header>
      <main className="ui-setup__main">
        <h1 className="ui-setup__heading ui-wide-only">{title}</h1>
        {children}
      </main>
    </div>
  );
}

/** 로그인(SCR-014 사장님 로그인·SCR-046 운영자 로그인, 메뉴 없음): 가운데 카드(최대 size.aside)에 서비스 이름과 제목(09 login_frame) */
export function LoginLayout({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="ui-login">
      <main className="ui-login__card">
        <span className="ui-login__service">{SERVICE_NAME}</span>
        <h1 className="ui-login__title">{title}</h1>
        {children}
      </main>
    </div>
  );
}
