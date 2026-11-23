// Campo reutilizável: bloqueia formato incompatível, mostra erro local e impede envio inválido.
import React, { useEffect, useId, useRef, useState } from "react";
import { formatInput, formatShiftedDecimal, validateInput } from "./inputRules";

export default function ValidatedInput({
  format = "text",
  minValue = 0,
  nonZero = false,
  matchName,
  shiftedDecimal = false,
  defaultValue = "",
  value: controlled,
  onChange,
  onBlur,
  ...props
}) {
  const [value, setValue] = useState(String(defaultValue));
  const [touched, setTouched] = useState(false);
  const [rejected, setRejected] = useState("");
  const [error, setError] = useState("");
  const input = useRef(null);
  const errorId = useId();
  const current = controlled === undefined ? value : String(controlled);
  const rule = {
    format,
    min: minValue,
    nonZero,
    required: props.required,
    minLength: props.minLength,
    maxLength: props.maxLength,
  };

  function check(next) {
    let message = validateInput(next, rule);
    if (
      !message &&
      matchName &&
      next !== input.current?.form?.elements.namedItem(matchName)?.value
    )
      message = "A confirmação não corresponde à nova senha.";
    input.current?.setCustomValidity(message);
    setError(message);
  }
  useEffect(() => {
    check(current);
  }, [
    current,
    format,
    minValue,
    nonZero,
    props.required,
    props.minLength,
    props.maxLength,
  ]);
  useEffect(() => {
    if (!matchName) return;
    const form = input.current?.form;
    const update = () => check(input.current?.value || "");
    // change nativo ocorre ao concluir a edição, depois de o React atualizar o valor digitado.
    // Usar input aqui anteciparia o render e poderia apagar a confirmação em campos controlados.
    form?.addEventListener("change", update);
    return () => form?.removeEventListener("change", update);
  }, [matchName]);

  function change(event) {
    const next = shiftedDecimal
      ? formatShiftedDecimal(event.target.value, current, format)
      : formatInput(event.target.value, current, format);
    setRejected(next.rejected || "");
    setValue(next.value);
    event.target.value = next.value;
    check(next.value);
    onChange?.(event);
  }
  function blur(event) {
    setTouched(true);
    setRejected("");
    // Completa centavos na saída, sem alterar a posição do cursor enquanto se digita.
    const text = current.trim();
    let next = current;
    if (
      text &&
      ["money", "percent"].includes(format) &&
      !validateInput(text, rule)
    )
      next = Number(text.replace(",", ".")).toFixed(2).replace(".", ",");
    else if (format === "email") next = text.toLowerCase();
    else if (!["password", "phone"].includes(format)) next = text;
    setValue(next);
    event.target.value = next;
    check(next);
    if (next !== current) onChange?.(event);
    onBlur?.(event);
  }
  const message = rejected || (touched ? error : "");
  return (
    <>
      <input
        {...props}
        ref={input}
        value={current}
        onChange={change}
        onBlur={blur}
        onInvalid={() => {
          setTouched(true);
          check(current);
        }}
        aria-invalid={message ? true : undefined}
        aria-describedby={
          [props["aria-describedby"], message ? errorId : null]
            .filter(Boolean)
            .join(" ") || undefined
        }
      />
      {message && (
        <small className="field-error" id={errorId} role="alert">
          {message}
        </small>
      )}
    </>
  );
}
