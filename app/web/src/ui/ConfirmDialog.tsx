// 확인 창(08 confirm·confirm-notify). 09 목업의 dialog와 같은 모습이고, 브라우저의 모달 <dialog>(showModal)로 뒤를 막는다.
// - 열면 첫 버튼('돌아가기', 아무것도 바꾸지 않는 쪽)에 포커스. Tab·Shift+Tab은 창 안에서 돎(포커스 가둠).
// - Esc는 '돌아가기'와 같음. 닫히면 열기 전 포커스가 있던 곳(누른 버튼)으로 돌아감.
// - 버튼은 '돌아가기'와 액션 이름 둘. '취소'만 있는 창은 쓰지 않음(설계 재검토 M19).
import { type ReactNode, type SyntheticEvent, useEffect, useId, useRef } from "react";
import { type ConfirmationNeeded, confirmText, ERROR_CODES } from "../problems";
import { Button } from "./Button";
import { keepFocusInside } from "./focus";

export const BACK_LABEL = "돌아가기";

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly children: ReactNode;
  /** 액션 이름(예: '휴무로 바꾸기', '거절하기') */
  readonly confirmLabel: string;
  readonly confirmDisabled?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const closingByUs = useRef(false);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      closingByUs.current = true;
      dialog.close();
    }
  }, [open]);

  // 창이 열린 채 화면에서 사라지면 포커스를 돌려줌
  useEffect(
    () => () => {
      const back = returnTo.current;
      returnTo.current = null;
      if (back?.isConnected) back.focus();
    },
    [],
  );

  const handleClose = () => {
    const byUs = closingByUs.current;
    closingByUs.current = false;
    if (ref.current?.open) return; // 닫힌 사이에 다시 열림
    const back = returnTo.current;
    returnTo.current = null;
    if (back?.isConnected) back.focus();
    // 브라우저가 스스로 닫았으면(예: 잇달아 누른 Esc라 cancel을 막지 못함) 화면 상태도 '돌아가기'로 맞춤
    if (!byUs) onCancel();
  };

  const cancelByEscape = (e: SyntheticEvent<HTMLDialogElement>) => {
    e.preventDefault();
    onCancel();
  };

  return (
    <dialog
      ref={ref}
      className="ui-dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={cancelByEscape}
      onClose={handleClose}
      onKeyDown={keepFocusInside}
    >
      <h2 id={titleId} className="ui-dialog__title">
        {title}
      </h2>
      <div id={bodyId} className="ui-dialog__body">
        {children}
      </div>
      <div className="ui-dialog__actions">
        <Button kind="secondary" onClick={onCancel}>
          {BACK_LABEL}
        </Button>
        <Button kind="primary" disabled={confirmDisabled} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}

/**
 * 서버가 요구한 확인(409 confirmation_required, 06 DEC-06)의 창. 제목은 06의 말 '저장하기 전에 확인해 주세요',
 * 본문은 확인할 것마다 06 6절의 글(한 창에 여럿이면 모두). 확인하면 useCommand의 confirm(같은 본문 + confirm 값, 새 요청 키).
 */
export function ConfirmRequired({
  items,
  confirmLabel,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: {
  readonly items: readonly ConfirmationNeeded[] | null;
  readonly confirmLabel: string;
  readonly confirmDisabled?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <ConfirmDialog
      open={items !== null && items.length > 0}
      title={ERROR_CODES.confirmation_required.message}
      confirmLabel={confirmLabel}
      confirmDisabled={confirmDisabled}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {(items ?? []).map((item) => (
        <p key={`${item.kind}:${item.day ?? ""}`}>{confirmText(item)}</p>
      ))}
    </ConfirmDialog>
  );
}
