// Escolhe o intervalo do relatório sem alterar o mês atualmente exibido no painel.
import React, { useState } from "react";
import { downloadFinancialExcel } from "./api";
import ValidatedInput from "./ValidatedInput";
const months = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];
export default function ExportReportForm({ month, onClose }) {
  const [type, setType] = useState("month"),
    [year, setYear] = useState(month.slice(0, 4)),
    [selected, setSelected] = useState(Number(month.slice(5))),
    [part, setPart] = useState("1");
  const [from, setFrom] = useState(month),
    [to, setTo] = useState(month),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setError("");
    let start, end;
    if (type === "custom") {
      start = from;
      end = to;
    } else {
      const first =
        type === "year"
          ? 1
          : type === "quarter"
            ? (Number(part) - 1) * 3 + 1
            : type === "semester"
              ? (Number(part) - 1) * 6 + 1
              : Number(selected);
      const last =
        type === "year"
          ? 12
          : type === "quarter"
            ? first + 2
            : type === "semester"
              ? first + 5
              : first;
      start = `${year}-${String(first).padStart(2, "0")}`;
      end = `${year}-${String(last).padStart(2, "0")}`;
    }
    if (start > end) {
      setError("O início deve ser anterior ou igual ao fim.");
      return;
    }
    const [a, b] = start.split("-").map(Number),
      [c, d] = end.split("-").map(Number);
    if ((c - a) * 12 + d - b > 119) {
      setError("Escolha no máximo 120 meses.");
      return;
    }
    setBusy(true);
    try {
      await downloadFinancialExcel({ from: start, to: end });
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <div className="modal-body">
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="form-grid two-columns">
          <label>
            Tipo de período
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPart("1");
              }}
            >
              <option value="month">Mês</option>
              <option value="quarter">Trimestre</option>
              <option value="semester">Semestre</option>
              <option value="year">Ano inteiro</option>
              <option value="custom">Intervalo de meses</option>
            </select>
          </label>
          {type !== "custom" && (
            <label>
              Ano
              <ValidatedInput
                format="integer"
                minValue={2000}
                type="number"
                min={2000}
                max={9999}
                required
                value={year}
                onChange={(e) => setYear(e.target.value)}
              />
            </label>
          )}
          {type === "month" && (
            <label>
              Mês
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                {months.map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {["quarter", "semester"].includes(type) && (
            <label>
              {type === "quarter" ? "Trimestre" : "Semestre"}
              <select value={part} onChange={(e) => setPart(e.target.value)}>
                {Array.from({ length: type === "quarter" ? 4 : 2 }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1}º {type === "quarter" ? "trimestre" : "semestre"}
                  </option>
                ))}
              </select>
            </label>
          )}
          {type === "custom" && (
            <>
              <label>
                Mês inicial
                <ValidatedInput
                  type="month"
                  format="month"
                  required
                  min="2000-01"
                  max="9999-12"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label>
                Mês final
                <ValidatedInput
                  type="month"
                  format="month"
                  required
                  min="2000-01"
                  max="9999-12"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
            </>
          )}
        </div>
        <p className="settings-footnote">
          O arquivo contém o total do período e gráficos. Usa a alíquota atual e
          os custos adicionais multiplicados pela quantidade de meses. O imposto
          é estimado sobre o bruto total do período, com arredondamento final em
          centavos.
        </p>
      </div>
      <div className="modal-footer">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={onClose}
        >
          Cancelar
        </button>
        <button className="primary" disabled={busy}>
          {busy ? "Exportando…" : "Baixar Excel"}
        </button>
      </div>
    </form>
  );
}
