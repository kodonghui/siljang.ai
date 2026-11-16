// 필드와 필드 옆 오류(04 G7 필드 오류, 08 error의 입력 오류, 설계 재검토 M19 RE-05). 모습은 09 목업의 field·ferr.
// 오류는 06 Problem의 errors[].field(JSON 포인터)로 그 필드에 붙고, 넣은 값은 그대로 둔다.
// 입력에는 aria-invalid와 aria-describedby(오류 줄 → 도움말 순서)를 단다.
import { type InputHTMLAttributes, type ReactNode, useId } from "react";
import { type FieldError, type FieldReason, fieldReasonText } from "../problems";
import { Icon } from "./Icon";

export interface FieldIds {
  readonly id: string;
  readonly "aria-invalid": true | undefined;
  readonly "aria-describedby": string | undefined;
}

export interface FieldProps {
  /** 이 필드가 받는 06 요청 본문의 위치(JSON 포인터, 예: /dailyLimit) */
  readonly pointer: string;
  readonly label: string;
  /** 이 필드의 오류(fieldErrorsFor로 고름). 여럿이면 줄마다 */
  readonly errors?: readonly FieldReason[] | undefined;
  /** 오류 사유마다 이 필드에 맞는 글(없으면 problems.ts의 글) */
  readonly messages?: Partial<Record<FieldReason, string>>;
  /** 사유 코드 없이 이 필드 옆에 보일 글(예: 06 holder_not_verified의 말) */
  readonly note?: string | undefined;
  readonly help?: ReactNode;
  readonly children: (ids: FieldIds) => ReactNode;
}

/** 이름표·입력·오류 줄·도움말 묶음. 입력은 children이 ids를 받아 그림(input·select·textarea 무엇이든) */
export function Field({ pointer, label, errors, messages, note, help, children }: FieldProps) {
  const id = useId();
  const lines = [
    ...(errors ?? []).map((code) => fieldReasonText(code, messages)),
    ...(note === undefined ? [] : [note]),
  ];
  const invalid = lines.length > 0;
  const errorId = `${id}-e`;
  const helpId = `${id}-h`;
  const describedBy = [invalid ? errorId : null, help === undefined ? null : helpId]
    .filter((x) => x !== null)
    .join(" ");
  return (
    <div className="ui-field" data-pointer={pointer}>
      <label htmlFor={id} className="ui-field__label">
        {label}
      </label>
      {children({ id, "aria-invalid": invalid ? true : undefined, "aria-describedby": describedBy || undefined })}
      {invalid ? (
        <span id={errorId} className="ui-field__error">
          <Icon name="alert" size="sm" />
          <span>{lines.join(" · ")}</span>
        </span>
      ) : null}
      {help === undefined ? null : (
        <span id={helpId} className="ui-field__help">
          {help}
        </span>
      )}
    </div>
  );
}

export type TextFieldProps = Omit<FieldProps, "children"> &
  Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className" | "aria-invalid" | "aria-describedby">;

/** 한 줄 입력(09 목업의 입력: 높이 size.control, 테두리 line-control, 오류면 danger) */
export function TextField({ pointer, label, errors, messages, note, help, type = "text", ...input }: TextFieldProps) {
  return (
    <Field pointer={pointer} label={label} errors={errors} messages={messages ?? {}} note={note} help={help}>
      {(ids) => (
        <span className={`ui-field__box${ids["aria-invalid"] ? " ui-field__box--invalid" : ""}`}>
          <input {...input} {...ids} type={type} className="ui-field__input" />
        </span>
      )}
    </Field>
  );
}

/**
 * 06 errors[]를 필드마다 나눔. fields(화면이 그린 필드의 포인터)에 없는 위치의 오류(본문 전체 '/', 헤더·쿼리, 화면에 없는 필드)는
 * rest로 모아 폼 위 오류 상자에 보인다(아무 오류도 버리지 않음).
 */
export function fieldErrorsFor(
  errors: readonly FieldError[],
  fields: readonly string[],
): { readonly byField: ReadonlyMap<string, readonly FieldReason[]>; readonly rest: readonly FieldError[] } {
  const known = new Set(fields);
  const byField = new Map<string, FieldReason[]>();
  const rest: FieldError[] = [];
  for (const e of errors) {
    if (!known.has(e.field)) {
      rest.push(e);
      continue;
    }
    const list = byField.get(e.field) ?? [];
    if (!list.includes(e.code)) list.push(e.code);
    byField.set(e.field, list);
  }
  return { byField, rest };
}
