// Cadastro fiscal e endereço. CPF/CNPJ são mascarados na tela e normalizados pela API.
import React, { useEffect, useRef, useState } from "react";
import { api } from "./api";
import ValidatedInput from "./ValidatedInput";
import {
  states,
  taxRegimes,
  maskTaxId,
  normalizeTaxId,
  validCnpj,
  validCpf,
} from "../../shared/brazil.js";

export default function CustomerForm({ record, onSaved, onClose }) {
  const [personType, setPersonType] = useState(record?.personType || "PF");
  const [regime, setRegime] = useState(record?.taxRegime || "not_applicable");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState(record || {});
  const [document, setDocument] = useState(
    record?.taxId ? maskTaxId(record.taxId, record.personType) : "",
  );
  const [preview, setPreview] = useState(null);
  const [looking, setLooking] = useState(false);
  const [notice, setNotice] = useState("");
  const requestNumber = useRef(0);
  const [documentCheck, setDocumentCheck] = useState("idle");
  useEffect(() => {
    const taxId = normalizeTaxId(document);
    if (!(personType === "PF" ? validCpf(taxId) : validCnpj(taxId))) {
      setDocumentCheck("idle");
      return;
    }
    const controller = new AbortController();
    let canceled = false;
    setDocumentCheck("checking");
    // Aguarda o fim da digitação e cancela verificações antigas para não mostrar aviso do documento errado.
    const timer = setTimeout(async () => {
      try {
        const result = await api("/customers/check-document", {
          method: "POST",
          signal: controller.signal,
          body: {
            personType,
            taxId,
            ...(record?.id ? { excludeId: record.id } : {}),
          },
        });
        if (!canceled)
          setDocumentCheck(result.exists ? "duplicate" : "available");
      } catch {
        if (!canceled) setDocumentCheck("unavailable");
      }
    }, 350);
    return () => {
      canceled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [document, personType, record?.id]);
  function changeDocument(value) {
    requestNumber.current++;
    setLooking(false);
    setDocument(value);
    setPreview(null);
    setNotice("");
    setDocumentCheck("idle");
  }
  async function lookup() {
    setError("");
    setNotice("");
    setPreview(null);
    if (!validCnpj(document)) {
      setError("Informe um CNPJ válido para consultar.");
      return;
    }
    const request = ++requestNumber.current;
    setLooking(true);
    try {
      const result = await api(
        `/company-lookup/${encodeURIComponent(normalizeTaxId(document))}`,
      );
      // Ignora respostas antigas se o usuário trocar o documento durante a consulta.
      if (request === requestNumber.current) setPreview(result);
    } catch (e) {
      if (request === requestNumber.current) setError(e.message);
    } finally {
      if (request === requestNumber.current) setLooking(false);
    }
  }
  function confirmImport() {
    if (!preview || preview.taxId !== normalizeTaxId(document)) return;
    // Só substitui campos disponíveis na fonte após confirmação; nunca salva automaticamente.
    const available = Object.fromEntries(
      Object.entries(preview.fields).filter(([, value]) => value !== ""),
    );
    setFields((previous) => ({ ...previous, ...available }));
    if (preview.suggestedRegime) setRegime(preview.suggestedRegime);
    setPreview(null);
    setNotice(
      "Dados preenchidos. Revise todos os campos e o regime tributário antes de salvar.",
    );
  }
  async function submit(event) {
    event.preventDefault();
    if (documentCheck === "duplicate" || documentCheck === "checking") return;
    setError("");
    setBusy(true);
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api("/customers" + (record ? "/" + record.id : ""), {
        method: record ? "PATCH" : "POST",
        body: data,
      });
      onSaved("Cliente salvo.");
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  function field(
    name,
    label,
    format = "text",
    maxLength = 100,
    optional = false,
  ) {
    return (
      <label>
        {label}
        {optional && <span className="optional">opcional</span>}
        <ValidatedInput
          name={name}
          format={format}
          type={
            format === "email" ? "email" : format === "phone" ? "tel" : "text"
          }
          inputMode={["cpf", "postal"].includes(format) ? "numeric" : undefined}
          required={!optional}
          maxLength={maxLength}
          value={fields[name] || ""}
          onChange={(event) =>
            setFields((previous) => ({
              ...previous,
              [name]: event.target.value,
            }))
          }
        />
      </label>
    );
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
            Tipo de pessoa
            <select
              name="personType"
              value={personType}
              onChange={(event) => {
                setPersonType(event.target.value);
                setRegime(event.target.value === "PF" ? "not_applicable" : "");
                changeDocument("");
              }}
            >
              <option value="PF">Pessoa física (PF)</option>
              <option value="PJ">Pessoa jurídica (PJ)</option>
            </select>
          </label>
          <label>
            Regime tributário
            <select
              name="taxRegime"
              required
              value={regime}
              onChange={(event) => setRegime(event.target.value)}
            >
              <option value="">Selecione…</option>
              {Object.entries(taxRegimes)
                .filter(([key]) =>
                  personType === "PF"
                    ? key === "not_applicable"
                    : key !== "not_applicable",
                )
                .map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
            </select>
          </label>
          {field(
            "name",
            personType === "PF" ? "Nome completo" : "Razão social",
            "text",
            120,
          )}
          <label>
            {personType === "PF" ? "CPF" : "CNPJ"}
            <ValidatedInput
              key={personType}
              name="taxId"
              format={personType === "PF" ? "cpf" : "cnpj"}
              required
              maxLength={personType === "PF" ? 14 : 18}
              value={document}
              onChange={(event) => changeDocument(event.target.value)}
              aria-describedby="customer-document-check"
            />
            <small
              id="customer-document-check"
              role={documentCheck === "duplicate" ? "alert" : "status"}
              className={
                documentCheck === "duplicate" ? "field-error" : undefined
              }
            >
              {documentCheck === "checking"
                ? "Verificando cadastro nesta empresa…"
                : documentCheck === "duplicate"
                  ? "Este CPF/CNPJ já está cadastrado na sua empresa. Use o cadastro existente."
                  : documentCheck === "unavailable"
                    ? "Não foi possível verificar agora. A conferência também ocorre ao salvar."
                    : "O documento deve ser único nesta empresa; outras empresas do ERP podem cadastrar o mesmo cliente."}
            </small>
            {personType === "PJ" && (
              <>
                <button
                  type="button"
                  className="secondary"
                  onClick={lookup}
                  disabled={
                    looking ||
                    busy ||
                    ["checking", "duplicate"].includes(documentCheck)
                  }
                >
                  {looking ? "Consultando…" : "Consultar CNPJ"}
                </button>
                <small>
                  A consulta envia apenas o CNPJ ao OpenCNPJ. Nenhum dado é
                  salvo automaticamente.
                </small>
              </>
            )}
          </label>
          {personType === "PJ" && (
            <>
              {field("tradeName", "Nome fantasia", "text", 120, true)}
              {field(
                "stateRegistration",
                "Inscrição estadual (ou ISENTO)",
                "text",
                30,
                true,
              )}
              {field(
                "municipalRegistration",
                "Inscrição municipal",
                "text",
                30,
                true,
              )}
            </>
          )}
          {field("email", "E-mail", "email", 254, true)}
          {field("phone", "Telefone", "phone", 20, true)}
        </div>
        {preview && (
          <section
            className="cnpj-preview"
            aria-label="Conferir dados do OpenCNPJ"
          >
            <h3>Confira os dados encontrados</h3>
            <p>
              Fonte: OpenCNPJ. Pode haver informações desatualizadas. A
              confirmação substitui os campos listados abaixo; dados ausentes e
              inscrições precisam ser preenchidos manualmente.
            </p>
            <dl>
              {Object.entries(preview.fields)
                .filter(([, value]) => value)
                .map(([key, value]) => (
                  <React.Fragment key={key}>
                    <dt>
                      {
                        {
                          name: "Razão social",
                          tradeName: "Nome fantasia",
                          postalCode: "CEP",
                          street: "Logradouro",
                          addressNumber: "Número",
                          complement: "Complemento",
                          district: "Bairro",
                          city: "Cidade",
                          state: "UF",
                          email: "E-mail",
                          phone: "Telefone",
                        }[key]
                      }
                    </dt>
                    <dd>{value}</dd>
                  </React.Fragment>
                ))}
            </dl>
            <p>
              Regime sugerido:{" "}
              {taxRegimes[preview.suggestedRegime] ||
                "Não informado — selecione manualmente"}
              . Confirme com o responsável contábil.
            </p>
            <div className="heading-actions">
              <button type="button" className="primary" onClick={confirmImport}>
                Confirmar e preencher cadastro
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setPreview(null)}
              >
                Descartar consulta
              </button>
            </div>
          </section>
        )}
        {notice && <p role="status">{notice}</p>}
        <h3 className="form-section">Endereço completo</h3>
        <div className="form-grid two-columns">
          {field("postalCode", "CEP", "postal", 9)}
          {field("street", "Logradouro", "text", 150)}
          {field("addressNumber", "Número (ou S/N)", "text", 20)}
          {field("complement", "Complemento", "text", 100, true)}
          {field("district", "Bairro")}
          {field("city", "Cidade")}
          <label>
            Estado (UF)
            <select
              name="state"
              required
              value={fields.state || ""}
              onChange={(event) =>
                setFields((previous) => ({
                  ...previous,
                  state: event.target.value,
                }))
              }
            >
              <option value="">Selecione…</option>
              {states.map((state) => (
                <option key={state}>{state}</option>
              ))}
            </select>
          </label>
        </div>
        {record && (
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
        )}
      </div>
      <div className="modal-footer">
        <button
          type="button"
          className="secondary"
          onClick={onClose}
          disabled={busy}
        >
          Cancelar
        </button>
        <button
          className="primary"
          disabled={busy || ["checking", "duplicate"].includes(documentCheck)}
        >
          {busy ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </form>
  );
}
