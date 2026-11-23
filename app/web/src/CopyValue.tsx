import { useEffect, useRef, useState } from "react";
import { Button, Field } from "./ui";

interface Props {
  readonly label: string;
  readonly value: string;
  readonly disabled?: boolean;
}
export function CopyValue({ label, value, disabled = false }: Props) {
  const input = useRef<HTMLInputElement>(null),
    latest = useRef(value),
    generation = useRef(0),
    mounted = useRef(true);
  latest.current = value;
  const [state, setState] = useState<{ value: string; kind: "copying" | "copied" | "selected" } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const busy = state?.value === value && state.kind === "copying";
  async function copy() {
    if (disabled || busy) return;
    const text = value,
      requestNumber = ++generation.current;
    const current = () => mounted.current && latest.current === text && generation.current === requestNumber;
    setState({ value: text, kind: "copying" });
    try {
      if (!navigator.clipboard?.writeText) throw new Error("클립보드를 사용할 수 없음");
      await navigator.clipboard.writeText(text);
      if (current()) setState({ value: text, kind: "copied" });
    } catch {
      if (!current()) return;
      input.current?.focus();
      input.current?.select();
      setState({ value: text, kind: "selected" });
    }
  }
  return (
    <div className="copy-value">
      <Field pointer="/copy" label={label}>
        {(ids) => (
          <span className="ui-field__box">
            <input
              {...ids}
              ref={input}
              className="ui-field__input"
              readOnly
              value={value}
              disabled={disabled}
              autoComplete="off"
            />
          </span>
        )}
      </Field>
      <Button disabled={disabled} busy={busy} aria-label={`${label} 복사`} onClick={() => void copy()}>
        복사
      </Button>
      {state?.value === value && state.kind !== "copying" ? (
        <p role="status">{state.kind === "copied" ? "복사했어요" : "복사가 막혀 있어요. 선택한 값을 복사해 주세요"}</p>
      ) : null}
    </div>
  );
}
