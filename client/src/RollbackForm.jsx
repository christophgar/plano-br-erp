// Desfazer cria um novo evento; nunca apaga nem modifica o histórico original.
import React, { useState } from "react";
import { api } from "./api";
import ValidatedInput from "./ValidatedInput";
export default function RollbackForm({ event, onReverted }) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const reason = String(new FormData(e.currentTarget).get("reason")).trim();
    try {
      await api(`/audit/${encodeURIComponent(event.id)}/rollback`, {
        method: "POST",
        body: { reason },
      });
      onReverted();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  return (
    <section className="audit-changes" aria-label="Reversão administrativa">
      {!open ? (
        <button className="danger" type="button" onClick={() => setOpen(true)}>
          Desfazer alteração
        </button>
      ) : (
        <form onSubmit={submit}>
          <h3>Confirmar reversão</h3>
          <p>
            Os campos alterados voltam aos valores da coluna “Antes”. A reversão
            será bloqueada se houver outra alteração posterior e será registrada
            como um novo evento.
          </p>
          <label className="form-section">
            Motivo da reversão (mínimo 10 caracteres)
            <ValidatedInput
              name="reason"
              required
              minLength={10}
              maxLength={200}
              autoComplete="off"
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="heading-actions password-submit">
            <button className="danger" disabled={busy}>
              {busy ? "Desfazendo…" : "Confirmar e desfazer"}
            </button>
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancelar reversão
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
