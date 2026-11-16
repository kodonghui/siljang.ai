// 09 목업(research/cake-mockup-2026-11의 gen.py·gen_screens.py ICONS)과 같은 선 아이콘. 크기는 size.icon-* 토큰.
// 글과 함께 쓰는 장식이라 늘 aria-hidden(뜻은 옆의 글이 전함).

const PATHS = {
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5" />
      <path d="M12 16.5h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <path d="M12 7.5h.01" />
    </>
  ),
  inbox: (
    <>
      <path d="M3 13h5l2 3h4l2-3h5" />
      <path d="M5 5h14l2 8v6H3v-6Z" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = "md" }: { readonly name: IconName; readonly size?: "sm" | "md" | "lg" }) {
  return (
    <svg
      className={`ui-icon ui-icon--${size}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
