// Mostra itens históricos e cadastra a nota ligada à receita do pedido; não emite nota fiscal.
import React, { useEffect, useState } from "react";
import { api } from "./api";
import { currency, dateLabel, statusLabels } from "./model";
import ValidatedInput from "./ValidatedInput";
export default function OrderDetails({ orderId, user, addInvoice, onSaved }) {
  const [order, setOrder] = useState(null),
    [showInvoice, setShowInvoice] = useState(addInvoice);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
  async function load() {
    setOrder(await api("/orders/" + orderId));
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [orderId]);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const fields = new FormData(event.currentTarget);
    try {
      await api(`/orders/${orderId}/document`, {
        method: "POST",
        body: Object.fromEntries(fields),
      });
      setShowInvoice(false);
      await load();
      onSaved("Nota fiscal vinculada ao pedido.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-body">
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {!order ? (
        <p>Carregando pedido…</p>
      ) : (
        <>
          <p>
            {order.description} · {statusLabels[order.status]} ·{" "}
            <strong>{currency(order.amountCents)}</strong>
          </p>
          <h3 className="form-section">Itens do pedido</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Quantidade</th>
                  <th>Preço</th>
                  <th>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.productName}</td>
                    <td>{item.quantity}</td>
                    <td>{currency(item.unitPriceCents)}</td>
                    <td>{currency(item.unitPriceCents * item.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!order.items.length && (
            <p>Este pedido antigo não possui itens registrados.</p>
          )}
          <h3 className="form-section">Nota fiscal</h3>
          {order.document ? (
            <p>
              Número {order.document.number} ·{" "}
              {dateLabel(order.document.issuedOn)} ·{" "}
              {statusLabels[order.document.status]} ·{" "}
              {currency(order.document.amountCents)}
            </p>
          ) : user.support && !user.support.writable ? (
            <p>
              Suporte em modo somente consulta: não é possível vincular nota
              fiscal.
            </p>
          ) : !["admin", "accountant"].includes(user.role) ? (
            <p>O administrador ou contador pode vincular a nota fiscal.</p>
          ) : order.status === "cancelled" ? (
            <p>Pedido cancelado: vínculo fiscal indisponível.</p>
          ) : showInvoice ? (
            <form onSubmit={submit}>
              <div className="form-grid two-columns">
                <label>
                  Número da nota fiscal
                  <ValidatedInput
                    name="number"
                    format="code"
                    required
                    maxLength={80}
                  />
                </label>
                <label>
                  Data de emissão
                  <ValidatedInput
                    name="issuedOn"
                    format="date"
                    type="date"
                    required
                    min="1900-01-01"
                    max="9999-12-31"
                    defaultValue={today}
                  />
                </label>
                <label>
                  Vencimento da receita
                  <ValidatedInput
                    name="dueDate"
                    format="date"
                    type="date"
                    required
                    min="1900-01-01"
                    max="9999-12-31"
                    defaultValue={today}
                  />
                </label>
              </div>
              <p className="settings-footnote">
                Valor: {currency(order.amountCents)}. Se ainda não existir
                receita vinculada, será criada uma receita pendente. O cadastro
                não confirma pagamento nem emite a nota.
              </p>
              <button className="primary password-submit" disabled={busy}>
                {busy ? "Salvando…" : "Vincular nota fiscal"}
              </button>
            </form>
          ) : (
            <button className="primary" onClick={() => setShowInvoice(true)}>
              Adicionar nota fiscal
            </button>
          )}
        </>
      )}
    </div>
  );
}
