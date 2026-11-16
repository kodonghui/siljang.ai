import type { ButtonHTMLAttributes, MouseEvent } from "react";

/** 보내는 동안 누른 버튼에 보이는 글(08 submitting) */
export const BUSY_LABEL = "처리하고 있어요";

export type ButtonKind = "primary" | "secondary" | "danger" | "warn";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  readonly kind?: ButtonKind;
  /** 누른 명령을 보내는 중: 글이 '처리하고 있어요'로 바뀌고 눌러도 아무것도 하지 않음(포커스는 그대로) */
  readonly busy?: boolean;
  /** 줄 너비를 채움(360의 아래 고정 버튼 등) */
  readonly block?: boolean;
}

/**
 * 09 목업의 버튼(높이 size.control, 너비 최소 size.target, radius.md, semibold).
 * 막힌 버튼은 surface-sunken 바탕(설계 재검토 RE-13). busy는 disabled 대신 aria-disabled라 포커스를 잃지 않는다
 * (확인 창이 닫힌 뒤 포커스가 돌아올 곳이 남음).
 */
export function Button({
  kind = "secondary",
  busy = false,
  block = false,
  type = "button",
  onClick,
  children,
  ...rest
}: ButtonProps) {
  const cls = `ui-button ui-button--${kind}${block ? " ui-button--block" : ""}`;
  const click = (e: MouseEvent<HTMLButtonElement>) => {
    if (busy) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  };
  return (
    <button {...rest} type={type} className={cls} aria-disabled={busy ? true : undefined} onClick={click}>
      {busy ? BUSY_LABEL : children}
    </button>
  );
}
