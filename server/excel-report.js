// XLSX é um ZIP de arquivos XML. O modelo contém layout e gráficos; aqui só entram dados validados.
// fflate lê/regrava esse ZIP. Não executa Excel, macros ou fórmulas fornecidas pelo usuário.
import { readFile } from "node:fs/promises";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

const template = readFile(
  new URL("./templates/financial-report.xlsx", import.meta.url),
);
const xmlText = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function updateCell(xml, address, value) {
  // Preserva estilo e fórmula da célula e substitui apenas o valor (inclusive o cache de cálculo).
  const pattern = new RegExp(
    `(<x:c\\b[^>]*\\br="${address}"[^>]*>)([\\s\\S]*?)(</x:c>)`,
  );
  if (!pattern.test(xml))
    throw new Error("Célula ausente no modelo de exportação.");
  return xml.replace(
    pattern,
    (_, opening, content, closing) =>
      opening.replace(
        /\bt="(?:n|str)"/,
        `t="${typeof value === "number" ? "n" : "str"}"`,
      ) +
      content.replace(/<x:v>[\s\S]*?<\/x:v>/, `<x:v>${xmlText(value)}</x:v>`) +
      closing,
  );
}

function chartCache(xml, labels, values) {
  // Além das referências às células, grava caches para leitores que não recalculam na abertura.
  const strings = labels
    .map(
      (value, index) =>
        `<c:pt idx="${index}"><c:v>${xmlText(value)}</c:v></c:pt>`,
    )
    .join("");
  const numbers = values
    .map((value, index) => `<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>`)
    .join("");
  return xml
    .replace(
      /<c:strCache>[\s\S]*?<\/c:strCache>/,
      `<c:strCache><c:ptCount val="${labels.length}"/>${strings}</c:strCache>`,
    )
    .replace(
      /<c:numCache>[\s\S]*?<\/c:numCache>/,
      `<c:numCache><c:formatCode>0.00</c:formatCode><c:ptCount val="${values.length}"/>${numbers}</c:numCache>`,
    );
}

export async function buildFinancialExcel(summary) {
  const files = unzipSync(new Uint8Array(await template));
  let sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  const dateSerial =
    (Date.parse(`${summary.month}-01T00:00:00Z`) - Date.UTC(1899, 11, 30)) /
    86400000;
  const data = {
    C3:
      summary.from && summary.from !== summary.to
        ? `${summary.from.slice(5)}/${summary.from.slice(0, 4)} - ${summary.to.slice(5)}/${summary.to.slice(0, 4)}`
        : dateSerial,
    C4: summary.settings.taxRateBasisPoints / 10000,
    C7: summary.income / 100,
    C8: summary.estimatedTax / 100,
    C9: summary.netRevenue / 100,
    C10: summary.expenses / 100,
    C11: summary.operatingCosts / 100,
    C12: summary.netIncome / 100,
    C21: summary.estimatedTax / 100,
    C22: summary.expenses / 100,
    C23: summary.operatingCosts / 100,
    B3:
      summary.from && summary.from !== summary.to
        ? "Período de referência"
        : "Mês de referência",
    B14: "Regime de caixa. Imposto estimado sobre o bruto do período.",
    B15:
      summary.settings.monthlyOperatingCostsCents == null
        ? "Custos adicionais não informados."
        : `Custo fixo aplicado em ${summary.months || 1} mês(es).`,
  };
  for (const [address, value] of Object.entries(data))
    sheet = updateCell(sheet, address, value);
  files["xl/worksheets/sheet1.xml"] = strToU8(sheet);
  files["xl/drawings/charts/chart1.xml"] = strToU8(
    chartCache(
      strFromU8(files["xl/drawings/charts/chart1.xml"]),
      [
        "Receita bruta",
        "Impostos estimados",
        "Receita após impostos",
        "Despesas pagas",
        "Custos adicionais",
        "Resultado líquido",
      ],
      [data.C7, data.C8, data.C9, data.C10, data.C11, data.C12],
    ),
  );
  files["xl/drawings/charts/chart2.xml"] = strToU8(
    chartCache(
      strFromU8(files["xl/drawings/charts/chart2.xml"]),
      ["Impostos", "Despesas", "Custos adicionais"],
      [data.C21, data.C22, data.C23],
    ),
  );
  // A planilha exportada não altera o sistema; suas fórmulas recalculam apenas esta cópia.
  return Buffer.from(zipSync(files, { level: 6 }));
}
