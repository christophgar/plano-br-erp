// Formatação durante a digitação e validação antes do envio. A API repete as regras.
import {
  emailRule,
  phoneRule,
  dateRule,
  codeRule,
} from "../../shared/fieldRules.js";
import {
  normalizeTaxId,
  validCpf,
  validCnpj,
  maskTaxId,
} from "../../shared/brazil.js";

// Máscara de calculadora: cada dígito entra pelos centavos; apagar desloca de volta.
export function formatShiftedDecimal(raw, previous, format) {
  if (!/^[\d,.]*$/.test(raw))
    return { value: previous, rejected: "Use somente números." };
  const digits = raw.replace(/\D/g, "").replace(/^0+/, "");
  if (!raw) return { value: "" };
  const limit = format === "percent" ? 10000 : 100000000;
  if (digits.length > 9 || Number(digits) > limit)
    return { value: previous, rejected: format === "percent"
      ? "A alíquota deve estar entre 0% e 100%."
      : "O valor máximo é R$ 1.000.000,00." };
  const padded = digits.padStart(3, "0");
  return { value: padded.slice(0, -2) + "," + padded.slice(-2) };
}

export function formatInput(raw, previous, format) {
  if (["cpf", "cnpj"].includes(format)) {
    const code = normalizeTaxId(raw);
    if (
      !(format === "cpf" ? /^\d{0,11}$/ : /^[A-Z0-9]{0,12}\d{0,2}$/).test(code)
    )
      return {
        value: previous,
        rejected: "Use o formato e a quantidade de caracteres do documento.",
      };
    return { value: maskTaxId(code, format === "cpf" ? "PF" : "PJ") };
  }
  if (format === "postal") {
    const digits = raw.replace("-", "");
    if (!/^\d{0,8}$/.test(digits))
      return {
        value: previous,
        rejected: "Use somente os oito números do CEP.",
      };
    return { value: digits.replace(/^(\d{5})(\d)/, "$1-$2") };
  }
  if (format === "money" || format === "percent") {
    const value = raw.replace(".", ",");
    const limit = format === "percent" ? 100 : 1000000;
    if (
      !/^\d*(,\d{0,2})?$/.test(value) ||
      (value && Number(value.replace(",", ".")) > limit)
    )
      return {
        value: previous,
        rejected: `Use números de 0 a ${limit.toLocaleString("pt-BR")}, com até duas casas decimais.`,
      };
    return { value: value.startsWith(",") ? "0" + value : value };
  }
  if (format === "integer" || format === "signedInteger") {
    if (
      !(format === "signedInteger" ? /^-?\d*$/ : /^\d*$/).test(raw) ||
      Math.abs(Number(raw)) > 1000000
    )
      return {
        value: previous,
        rejected: "Use somente números inteiros, de até 1.000.000 em módulo.",
      };
  }
  if (format === "phone") {
    if (
      !/^[+\d ()-]*$/.test(raw) ||
      (raw.includes("+") && !raw.startsWith("+"))
    )
      return {
        value: previous,
        rejected:
          "Use somente DDD, telefone e, se necessário, + e o código do país.",
      };
    const digits = raw.replace(/\D/g, "");
    if (digits.length > (raw.startsWith("+") ? 15 : 11))
      return {
        value: previous,
        rejected: "Telefone acima do limite de dígitos.",
      };
    if (raw.startsWith("+")) return { value: "+" + digits };
    if (!digits) return { value: "" };
    if (digits.length < 3) return { value: "(" + digits };
    const subscriber = digits.slice(2);
    const split = subscriber.length > 8 ? 5 : 4;
    return {
      value: `(${digits.slice(0, 2)}) ${subscriber.slice(0, split)}${subscriber.length > split ? "-" + subscriber.slice(split) : ""}`,
    };
  }
  if (format === "code" && raw && !/^[\p{L}\p{N}._/-]*$/u.test(raw))
    return {
      value: previous,
      rejected: "Use letras, números, ponto, traço, barra ou sublinhado.",
    };
  if (format === "email") return { value: raw.replace(/\s/g, "") };
  return { value: raw };
}

export function validateInput(value, rule = {}) {
  const { required, format, minLength, maxLength, min = 0, nonZero } = rule;
  const checked = format === "password" ? value : value.trim();
  if (!checked) return required ? "Preencha este campo." : "";
  if (format === "cpf" && !validCpf(checked))
    return "CPF inválido. Confira os dígitos verificadores.";
  if (format === "cnpj" && !validCnpj(checked))
    return "CNPJ inválido. Confira os dígitos verificadores.";
  if (
    format === "postal" &&
    (!/^\d{5}-?\d{3}$/.test(checked) || checked.replace("-", "") === "00000000")
  )
    return "Informe um CEP com oito números.";
  if (minLength && checked.length < minLength)
    return `Use pelo menos ${minLength} caracteres.`;
  if (maxLength && checked.length > maxLength)
    return `Use no máximo ${maxLength} caracteres.`;
  if (format === "email" && !emailRule.safeParse(checked).success)
    return "Informe um e-mail válido, como nome@dominio.com.";
  if (format === "phone" && !phoneRule.safeParse(checked).success)
    return "Informe DDD e telefone com 10 ou 11 dígitos, ou + e o código internacional.";
  if (
    format === "code" &&
    !codeRule(maxLength || 80).safeParse(checked).success
  )
    return "Use letras, números, ponto, traço, barra ou sublinhado.";
  if (format === "date" && !dateRule.safeParse(checked).success)
    return "Informe uma data válida entre 1900 e 9999.";
  if (format === "month" && !/^[2-9]\d{3}-(0[1-9]|1[0-2])$/.test(checked))
    return "Selecione um mês válido a partir de 2000.";
  if (["money", "percent"].includes(format)) {
    const number = Number(checked.replace(",", "."));
    const max = format === "percent" ? 100 : 1000000;
    if (!/^\d+([,.]\d{0,2})?$/.test(checked) || number < min || number > max)
      return `Informe um valor entre ${min.toLocaleString("pt-BR")} e ${max.toLocaleString("pt-BR")}, com até duas casas decimais.`;
  }
  if (["integer", "signedInteger"].includes(format)) {
    const number = Number(checked);
    if (
      !/^-?\d+$/.test(checked) ||
      !Number.isSafeInteger(number) ||
      number < (format === "signedInteger" ? -1000000 : min) ||
      number > 1000000 ||
      (nonZero && number === 0)
    )
      return nonZero
        ? "Informe uma quantidade inteira diferente de zero, entre -1.000.000 e 1.000.000."
        : "Informe uma quantidade inteira entre 0 e 1.000.000.";
  }
  if (format !== "password" && /[\u0000-\u001F\u007F]/.test(checked))
    return "Remova os caracteres de controle do texto.";
  return "";
}
