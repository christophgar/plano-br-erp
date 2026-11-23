// CPF/CNPJ são identificadores, não números monetários: preservar zeros à esquerda.
// CNPJ alfanumérico: Receita Federal, manual do DV (ASCII do caractere menos 48).
export const normalizeTaxId = (value) =>
  String(value)
    .replace(/[.\s/-]/g, "")
    .toUpperCase();
export function validCpf(value) {
  const code = normalizeTaxId(value);
  if (!/^\d{11}$/.test(code) || /^(.)\1+$/.test(code)) return false;
  const digit = (length) => {
    const sum = [...code.slice(0, length)].reduce(
      (total, char, index) => total + Number(char) * (length + 1 - index),
      0,
    );
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(code[9]) && digit(10) === Number(code[10]);
}
export function validCnpj(value) {
  const code = normalizeTaxId(value);
  if (!/^[A-Z0-9]{12}\d{2}$/.test(code) || /^(.)\1+$/.test(code)) return false;
  const digit = (base, weights) => {
    const sum = [...base].reduce(
      (total, char, index) =>
        total + (char.charCodeAt(0) - 48) * weights[index],
      0,
    );
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const first = digit(code.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = digit(
    code.slice(0, 12) + first,
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  );
  return code.endsWith(`${first}${second}`);
}
export function maskTaxId(value, type) {
  const code = normalizeTaxId(value);
  if (type === "PF")
    return code
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/(\.\d{3})(\d{1,2})$/, "$1-$2");
  return code
    .replace(/^(.{2})(.)/, "$1.$2")
    .replace(/^(.{2})\.(.{3})(.)/, "$1.$2.$3")
    .replace(/^(..\....\....)(.)/, "$1/$2")
    .replace(/(\/.{4})(.{1,2})$/, "$1-$2");
}
export const states = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
];
export const taxRegimes = {
  not_applicable: "Não se aplica (pessoa física)",
  mei: "MEI / SIMEI",
  simples_nacional: "Simples Nacional",
  lucro_presumido: "Lucro Presumido",
  lucro_real: "Lucro Real",
  imune_isenta: "Imune / isenta",
  outro: "Outro",
};
