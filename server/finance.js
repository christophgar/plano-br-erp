import { record, transaction } from "./db.js";
import { requireRow } from "./validation.js";

// Percentual em centésimos: 6,25% = 625. O cálculo arredonda para centavos.
export function financialSummary(income, expenses, settings) {
  // Entradas e saídas são centavos inteiros; a validação evita calcular com números imprecisos.
  if (
    ![income, expenses].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    )
  ) {
    throw new Error("Totais financeiros fora do limite suportado.");
  }
  // BigInt mantém o produto exato. +5000 antes de /10000 arredonda meio centavo para cima.
  const estimatedTax = Number(
    (BigInt(income) * BigInt(settings.taxRateBasisPoints) + 5000n) / 10000n,
  );
  // ?? usa zero só quando o custo é null/undefined. Um custo informado como zero continua válido.
  const operatingCosts = settings.monthlyOperatingCostsCents ?? 0;
  const netRevenue = income - estimatedTax;
  const netIncome = netRevenue - expenses - operatingCosts;
  if (!Number.isSafeInteger(netIncome))
    throw new Error("Resultado financeiro fora do limite suportado.");
  return { estimatedTax, operatingCosts, netRevenue, netIncome };
}

export function currentBusinessMonth() {
  // O fuso é explícito para o servidor não escolher outro mês perto da virada do dia.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year").value}-${parts.find((part) => part.type === "month").value}`;
}

// Uma única consulta alimenta painel e Excel: os dois usam o mesmo período e os mesmos cálculos.
export async function loadFinancialDashboard(pool, month) {
  const result = await pool.query(
    `WITH paid AS (
    SELECT type,amount_cents FROM transactions WHERE status='paid'
    AND paid_at >= ($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
    AND paid_at < (($1::date + interval '1 month') AT TIME ZONE 'America/Sao_Paulo')
  ) SELECT
    COALESCE((SELECT sum(amount_cents) FROM paid WHERE type='income'),0) AS income,
    COALESCE((SELECT sum(amount_cents) FROM paid WHERE type='expense'),0) AS expenses,
    (SELECT count(*) FROM customers WHERE anonymized=false) AS customers,
    (SELECT count(*) FROM orders WHERE status IN ('open','in_progress')) AS open_orders,
    (SELECT count(*) FROM transactions t LEFT JOIN documents d ON d.transaction_id=t.id
      WHERE t.status<>'cancelled' AND (d.id IS NULL OR d.status='pending' OR d.amount_cents<>t.amount_cents)) AS pending_documents,
    s.tax_rate_basis_points,s.monthly_operating_costs_cents,s.updated_at AS settings_updated_at
    FROM business_settings s WHERE s.id=1`,
    [`${month}-01`],
  );
  const raw = record(requireRow(result));
  const settings = {
    taxRateBasisPoints: raw.taxRateBasisPoints,
    monthlyOperatingCostsCents: raw.monthlyOperatingCostsCents,
    updatedAt: raw.settingsUpdatedAt,
  };
  delete raw.taxRateBasisPoints;
  delete raw.monthlyOperatingCostsCents;
  delete raw.settingsUpdatedAt;
  const totals = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, Number(value)]),
  );
  return {
    ...totals,
    balance: totals.income - totals.expenses,
    month,
    settings,
    ...financialSummary(totals.income, totals.expenses, settings),
  };
}

// Uma fotografia consistente do intervalo inteiro, mesmo se alguém alterar dados durante a exportação.
export async function loadFinancialReport(pool, from, to) {
  return transaction(pool, async (db) => {
    await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    let current = from,
      months = 0,
      income = 0,
      expenses = 0,
      settings;
    while (current <= to) {
      const result = await loadFinancialDashboard(db, current);
      income += result.income;
      expenses += result.expenses;
      settings ??= result.settings;
      months++;
      if (current === to) break;
      const [year, month] = current.split("-").map(Number);
      current =
        month === 12
          ? `${year + 1}-01`
          : `${year}-${String(month + 1).padStart(2, "0")}`;
    }
    // O imposto é estimado sobre o bruto total do intervalo; custo mensal conta uma vez por mês.
    const calculated = financialSummary(income, expenses, {
      ...settings,
      monthlyOperatingCostsCents:
        (settings.monthlyOperatingCostsCents ?? 0) * months,
    });
    return {
      month: from,
      from,
      to,
      months,
      income,
      expenses,
      settings,
      ...calculated,
    };
  });
}
