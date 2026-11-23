// Mostra somente os campos alterados, com os valores gravados no momento da operação.
import React from "react";
import { currency, statusLabels, auditDate } from "./model";
import { taxRegimes, maskTaxId } from "../../shared/brazil.js";

const labels = {
  name: "Nome / razão social",
  email: "E-mail",
  phone: "Telefone",
  personType: "Tipo de pessoa",
  taxId: "CPF/CNPJ",
  taxRegime: "Regime tributário",
  tradeName: "Nome fantasia",
  stateRegistration: "Inscrição estadual",
  municipalRegistration: "Inscrição municipal",
  postalCode: "CEP",
  street: "Logradouro",
  addressNumber: "Número",
  complement: "Complemento",
  district: "Bairro",
  city: "Cidade",
  state: "UF",
  sku: "Código do produto",
  quantity: "Quantidade em estoque",
  unitPriceCents: "Preço unitário",
  customerId: "Cliente (identificador)",
  description: "Descrição",
  amountCents: "Valor",
  status: "Situação",
  stockDeducted: "Estoque baixado",
  type: "Tipo de lançamento",
  dueDate: "Vencimento",
  paidAt: "Data do pagamento / recebimento",
  orderId: "Pedido (identificador)",
  number: "Número do documento",
  kind: "Tipo de documento",
  issuedOn: "Data de emissão",
  reviewedBy: "Responsável pela conferência (identificador)",
  reviewedAt: "Data da conferência",
  role: "Perfil",
  active: "Acesso ativo",
  taxRateBasisPoints: "Alíquota de impostos",
  monthlyOperatingCostsCents: "Custos operacionais adicionais",
};
function display(field, value) {
  if (value === null || value === undefined || value === "")
    return "Não informado";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (
    ["unitPriceCents", "amountCents", "monthlyOperatingCostsCents"].includes(
      field,
    )
  )
    return currency(value);
  if (field === "taxRateBasisPoints")
    return `${(value / 100).toFixed(2).replace(".", ",")}%`;
  if (["paidAt", "reviewedAt"].includes(field)) return auditDate(value);
  if (["dueDate", "issuedOn"].includes(field))
    return String(value).slice(0, 10).split("-").reverse().join("/");
  if (["status", "type", "kind", "role", "personType"].includes(field))
    return statusLabels[value] || String(value);
  if (field === "taxRegime") return taxRegimes[value] || String(value);
  if (field === "taxId")
    return maskTaxId(String(value), String(value).length === 11 ? "PF" : "PJ");
  return String(value);
}
export default function AuditChanges({ changes }) {
  if (!Array.isArray(changes))
    return (
      <p>
        Este evento não possui comparação de valores. Eventos antigos não
        permitem recuperar o antes e o depois.
      </p>
    );
  if (!changes.length)
    return <p>Nenhum campo de negócio foi alterado nesta operação.</p>;
  return (
    <section className="audit-changes" aria-label="Campos alterados">
      <h3>O que foi alterado</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Campo</th>
              <th>Antes</th>
              <th>Depois</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((change) => (
              <tr key={change.field}>
                <td>{labels[change.field] || "Campo do cadastro"}</td>
                <td>{display(change.field, change.before)}</td>
                <td>{display(change.field, change.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
