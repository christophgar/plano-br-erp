// Configuração financeira da empresa: percentual de impostos e custo fixo adicional opcional.
import React, { useState } from "react";
import { api } from "./api";
import { cents } from "./model";
import ValidatedInput from "./ValidatedInput";

export default function BusinessSettingsForm({ settings, onSaved, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setError("");
    const fields = new FormData(event.currentTarget);
    try {
      // Percentual com duas casas: 6,25% é armazenado como 625 centésimos.
      const taxRateBasisPoints = cents(fields.get("taxRate"));
      if (taxRateBasisPoints > 10000)
        throw new Error(
          "A alíquota deve estar entre 0% e 100%, com até duas casas decimais.",
        );
      // Campo vazio vira null (não informado); zero é um valor informado e válido.
      const cost = String(fields.get("operatingCosts")).trim();
      const monthlyOperatingCostsCents = cost ? cents(cost) : null;
      if (monthlyOperatingCostsCents > 100000000)
        throw new Error(
          "Os custos adicionais devem ser de até R$ 1.000.000,00 por mês.",
        );
      setBusy(true);
      // O servidor verifica perfil, salva no PostgreSQL e registra auditoria.
      await api("/business-settings", {
        method: "PUT",
        body: {
          taxRateBasisPoints,
          monthlyOperatingCostsCents,
          reason: String(fields.get("reason")).trim(),
        },
      });
      // A tela principal fecha a janela e consulta novamente os indicadores.
      onSaved();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <div className="modal-body">
        <p className="settings-intro">
          Configuração da empresa, compartilhada entre administrador e contador.
        </p>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="form-grid">
          <label>
            Alíquota de impostos (%)
            <ValidatedInput
              name="taxRate"
              format="percent"
              shiftedDecimal
              inputMode="decimal"
              required
              maxLength={6}
              placeholder="Ex.: 6,25"
              defaultValue={(settings.taxRateBasisPoints / 100)
                .toFixed(2)
                .replace(".", ",")}
              aria-describedby="tax-help"
            />
            <small id="tax-help">
              Digite os números: 625 vira 6,25%. De 0% a 100%, aplicada à
              receita recebida no mês selecionado.
            </small>
          </label>
          <label>
            Custos operacionais adicionais (R$/mês){" "}
            <span className="optional">opcional</span>
            <ValidatedInput
              name="operatingCosts"
              format="money"
              shiftedDecimal
              inputMode="decimal"
              maxLength={12}
              placeholder="Ex.: 500,00"
              defaultValue={
                settings.monthlyOperatingCostsCents == null
                  ? ""
                  : (settings.monthlyOperatingCostsCents / 100)
                      .toFixed(2)
                      .replace(".", ",")
              }
              aria-describedby="cost-help"
            />
            <small id="cost-help">
              Digite os números: 50000 vira 500,00. Valor fixo para cada mês
              consultado. Deixe em branco para não incluir. Não repita custos já
              registrados como despesas no financeiro.
            </small>
          </label>
        </div>
        <label className="form-section">
          Motivo da alteração (mínimo 10 caracteres)
          <ValidatedInput
            name="reason"
            required
            minLength={10}
            maxLength={200}
            autoComplete="off"
          />
        </label>
        <p className="settings-footnote">
          A alíquota e os custos atuais recalculam os meses consultados. O
          imposto é uma estimativa sobre a receita bruta e não gera pagamento
          nem lançamento financeiro.
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
          {busy ? "Salvando…" : "Salvar configuração"}
        </button>
      </div>
    </form>
  );
}
