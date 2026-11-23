// Preços e estoque são conferidos no servidor; o navegador exibe uma prévia do total.
import React, { useEffect, useState } from "react";
import { api } from "./api";
import { currency } from "./model";
import ValidatedInput from "./ValidatedInput";
export default function OrderForm({ onClose, onSaved }) {
  const [customers, setCustomers] = useState([]),
    [products, setProducts] = useState([]);
  const [items, setItems] = useState([{ productId: "", quantity: "1" }]);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api("/customers", { signal: controller.signal }),
      api("/products", { signal: controller.signal }),
    ])
      .then(([clients, catalog]) => {
        setCustomers(clients.items.filter((c) => !c.anonymized));
        setProducts(catalog.items);
        setLoading(false);
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, []);
  const productFor = (item) =>
    products.find((product) => product.id === item.productId);
  const total = items.reduce(
    (sum, item) =>
      sum +
      (productFor(item)?.unitPriceCents || 0) * Number(item.quantity || 0),
    0,
  );
  function update(index, values) {
    setItems((current) =>
      current.map((item, i) => (i === index ? { ...item, ...values } : item)),
    );
  }
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const fields = new FormData(event.currentTarget);
    try {
      await api("/orders", {
        method: "POST",
        body: {
          customerId: fields.get("customerId"),
          description: fields.get("description").trim(),
          items: items.map((item) => ({
            productId: item.productId,
            quantity: Number(item.quantity),
          })),
        },
      });
      onSaved("Pedido salvo e estoque atualizado.");
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
        {loading ? (
          <p>Carregando clientes e produtos…</p>
        ) : (
          <>
            <div className="form-grid two-columns">
              <label>
                Cliente
                <select name="customerId" required>
                  <option value="">Selecione…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Descrição do pedido
                <ValidatedInput name="description" required maxLength={500} />
              </label>
            </div>
            <h3 className="form-section">Itens do estoque</h3>
            {items.map((item, index) => {
              const product = productFor(item);
              return (
                <div className="order-item" key={index}>
                  <label>
                    Produto {index + 1}
                    <select
                      required
                      value={item.productId}
                      onChange={(e) =>
                        update(index, { productId: e.target.value })
                      }
                    >
                      <option value="">Selecione…</option>
                      {products
                        .filter(
                          (p) =>
                            !items.some(
                              (other, i) =>
                                i !== index && other.productId === p.id,
                            ),
                        )
                        .map((p) => (
                          <option
                            key={p.id}
                            value={p.id}
                            disabled={p.quantity === 0}
                          >
                            {p.name} · {p.quantity} em estoque ·{" "}
                            {currency(p.unitPriceCents)}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Quantidade
                    <ValidatedInput
                      format="integer"
                      minValue={1}
                      type="number"
                      min={1}
                      max={product?.quantity || 1000000}
                      required
                      value={item.quantity}
                      onChange={(e) =>
                        update(index, { quantity: e.target.value })
                      }
                    />
                  </label>
                  <div className="line-total">
                    <small>Subtotal</small>
                    <strong>
                      {currency(
                        (product?.unitPriceCents || 0) *
                          Number(item.quantity || 0),
                      )}
                    </strong>
                  </div>
                  <button
                    type="button"
                    className="text-button"
                    disabled={items.length === 1}
                    onClick={() =>
                      setItems((current) =>
                        current.filter((_, i) => index !== i),
                      )
                    }
                  >
                    Remover item
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              className="secondary"
              disabled={items.length >= 100 || busy}
              onClick={() =>
                setItems((current) => [
                  ...current,
                  { productId: "", quantity: "1" },
                ])
              }
            >
              Adicionar item
            </button>
            <p className="order-total">
              Total do pedido: <strong>{currency(total)}</strong>
            </p>
            <p className="settings-footnote">
              O estoque é baixado ao salvar. O cancelamento devolve os itens se
              não existir lançamento financeiro ativo. Os preços são conferidos
              no servidor.
            </p>
          </>
        )}
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
        <button
          className="primary"
          disabled={busy || loading || !products.length || total < 1}
        >
          {busy ? "Salvando…" : "Salvar pedido"}
        </button>
      </div>
    </form>
  );
}
