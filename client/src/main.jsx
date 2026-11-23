// Interface do ERP: componentes, formulários, navegação e sessão do usuário.
// useState guarda valores da tela; useEffect reage a mudanças; useRef aponta para elementos.
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronRight,
  FileText,
  Download,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  Moon,
  Package,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Sun,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { api, setSession, setUnauthorizedHandler } from "./api";
import {
  cents,
  currency,
  dateLabel,
  schemas,
  statusLabels,
  actionLabels,
  entityLabels,
  auditDate,
} from "./model";
import { useTheme } from "./theme";
import BusinessSettingsForm from "./BusinessSettingsForm";
import ValidatedInput from "./ValidatedInput";
import CustomerForm from "./CustomerForm";
import OrderForm from "./OrderForm";
import OrderDetails from "./OrderDetails";
import ExportReportForm from "./ExportReportForm";
import PlatformAdmin from "./PlatformAdmin";
import AuditChanges from "./AuditChanges";
import RollbackForm from "./RollbackForm";
import { maskTaxId } from "../../shared/brazil.js";
import { fieldLimits } from "../../shared/fieldRules.js";
import "./styles.css";
// Todo o visual (claro, escuro, financeiro e celular) está em styles.css.

// Cada item informa a página, o rótulo, o ícone e os perfis que podem vê-la.
// Essa filtragem é visual: o servidor também verifica as permissões de cada operação.
const navigation = [
  ["dashboard", "Visão geral", LayoutDashboard, ["admin", "accountant"]],
  ["customers", "Clientes", Users],
  ["products", "Produtos e estoque", Package],
  ["orders", "Pedidos", ShoppingBag],
  ["transactions", "Financeiro", Wallet, ["admin", "accountant"]],
  ["documents", "Documentos fiscais", FileText, ["admin", "accountant"]],
  ["users", "Usuários", Users, ["admin"]],
  ["audit", "Auditoria", Activity, ["admin"]],
  ["privacy", "Configurações", ShieldCheck],
];
const allowed = (page, role) =>
  navigation.some(
    ([key, , , roles]) => key === page && (!roles || roles.includes(role)),
  );
const home = (user) => (user.role === "operator" ? "customers" : "dashboard");
// Componentes pequenos reaproveitados em todas as telas.
function ErrorBox({ message }) {
  return message ? (
    <div className="error" role="alert">
      {message}
    </div>
  ) : null;
}
function Busy() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} /> Carregando informações…
    </div>
  );
}
function Brand() {
  return (
    <div className="brand">
      <img src="/plano-br-logo.png" alt="Plano BR — Sistema ERP" width="2172" height="724" />
    </div>
  );
}

// O estado do tema fica no hook useTheme; este botão só solicita a alternância.
function ThemeToggle({ theme, toggleTheme }) {
  const dark = theme === "dark";
  const label = dark ? "Ativar modo claro" : "Ativar modo escuro";
  return (
    <button
      type="button"
      className="theme-toggle secondary"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
    >
      {dark ? (
        <Sun size={18} aria-hidden="true" />
      ) : (
        <Moon size={18} aria-hidden="true" />
      )}
      <span>{dark ? "Modo claro" : "Modo escuro"}</span>
    </button>
  );
}

// Envia credenciais para a API. onLogin entrega a sessão recebida ao componente App.
function Login({ onLogin, notice, theme, toggleTheme }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    // Impede o recarregamento padrão do formulário e lê seus campos pelo atributo name.
    event.preventDefault();
    setError("");
    setBusy(true);
    const values = new FormData(event.currentTarget);
    try {
      onLogin(
        await api("/auth/login", {
          method: "POST",
          body: {
            email: values.get("email").trim(),
            password: values.get("password"),
          },
        }),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <div className="login-theme">
        <ThemeToggle theme={theme} toggleTheme={toggleTheme} />
      </div>
      <section className="login-story">
        <Brand />
        <div>
          <span className="eyebrow">CLAREZA PARA GERIR</span>
          <h1>
            Seu negócio.
            <br />
            Uma visão completa.
          </h1>
          <p>
            Clientes, operações e controle financeiro conectados em um só lugar.
          </p>
          <div className="story-card">
            <Activity size={24} />
            <div>
              Da operação à organização
              <span>Informação que acompanha sua rotina.</span>
            </div>
          </div>
        </div>
        <small>Gestão empresarial e fiscal</small>
      </section>
      <section className="login-panel">
        <form className="login-form" onSubmit={submit}>
          <span className="section-icon">
            <ShieldCheck />
          </span>
          <h2>Bem-vindo ao Plano BR</h2>
          <p>Entre com as credenciais fornecidas pelo administrador.</p>
          {notice && (
            <div className="notice" role="status">
              {notice}
            </div>
          )}
          <ErrorBox message={error} />
          <label>
            E-mail
            <ValidatedInput
              name="email"
              type="email"
              format="email"
              autoComplete="username"
              required
              maxLength={254}
              placeholder="seu@email.com"
            />
          </label>
          <label>
            Senha
            <ValidatedInput
              name="password"
              type="password"
              format="password"
              maxLength={128}
              autoComplete="current-password"
              required
            />
          </label>
          <button className="primary full" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={18} /> : null}
            {busy ? "Entrando…" : "Entrar no sistema"}
            <ChevronRight size={17} />
          </button>
          {/* Apenas visual: a recuperação por e-mail será implementada separadamente. */}
          <button
            type="button"
            className="forgot-password"
            disabled
            aria-describedby="password-recovery-help"
          >
            Esqueci minha senha
          </button>
          <small id="password-recovery-help">
            Redefinição por e-mail ainda não disponível. Por enquanto, procure o
            administrador.
          </small>
          <small>
            O acesso depende do perfil atribuído à sua conta. Não há credenciais
            padrão nesta interface.
          </small>
        </form>
      </section>
    </main>
  );
}

// Uma única janela serve para cadastro, edição e detalhes, recebidos por children.
function Modal({ title, children, onClose, busy, wide = false }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    // Ao fechar, devolve o foco ao botão que abriu a janela, facilitando o teclado.
    const previous = document.activeElement;
    const dialog = ref.current;
    dialog.showModal();
    return () => {
      dialog.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      className={wide ? "wide-dialog" : undefined}
      ref={ref}
      aria-labelledby="modal-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) closeRef.current();
      }}
    >
      <div className="modal-heading">
        <h2 id="modal-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="Fechar janela"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

// Gera formulários a partir de model.js. mode escolhe cadastro, edição ou ação especial.
function RecordForm({ page, mode, record, onClose, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [options, setOptions] = useState({});
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const schema = schemas[page];
  let fields = schema.fields || [];
  if (mode === "stock")
    fields = [
      {
        name: "delta",
        label: "Variação de estoque (+ entrada / − saída)",
        type: "integer",
        signed: true,
      },
      {
        name: "reason",
        label: "Motivo da movimentação (mínimo 10 caracteres)",
      },
    ];
  if (mode === "status")
    fields = [
      {
        name: "status",
        label: "Nova situação",
        type: "select",
        options:
          page === "orders"
            ? record.status === "open"
              ? ["in_progress", "cancelled"]
              : ["completed", "cancelled"]
            : page === "transactions"
              ? ["paid", "cancelled"]
              : ["pending", "reviewed"],
      },
      { name: "reason", label: "Motivo da alteração (mínimo 10 caracteres)" },
    ];
  if (mode === "active")
    fields = [
      {
        name: "reason",
        label: "Motivo da alteração de acesso (mínimo 10 caracteres)",
      },
    ];
  // Descobre quais listas precisam ser carregadas para os campos de seleção.
  // Set remove repetições; Promise.all busca as listas independentes em paralelo.
  const sources = [
    ...new Set(
      fields
        .map((f) => f.type)
        .filter((t) => ["customers", "orders", "transactions"].includes(t)),
    ),
  ].join(",");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    Promise.all(
      sources
        ? sources.split(",").map(async (source) => {
            const data = await api(`/${source}`, { signal: controller.signal });
            if (!Array.isArray(data?.items))
              throw new Error("Lista de opções inválida recebida da API.");
            // Não oferece cadastros removidos nem operações canceladas para novos vínculos.
            return [
              source,
              data.items.filter((item) =>
                source === "customers"
                  ? !item.anonymized
                  : item.status !== "cancelled",
              ),
            ];
          })
        : [],
    )
      .then((entries) => {
        setOptions(Object.fromEntries(entries));
        setLoading(false);
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          setError(e.message);
          setLoading(false);
        }
      });
    // Cancela a busca se a janela fechar antes de a resposta chegar.
    return () => controller.abort();
  }, [sources, attempt]);
  async function submit(event) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const payload = {};
    try {
      // Monta o JSON conforme o tipo: dinheiro vira centavos e IDs opcionais viram null.
      // A senha preserva espaços; os demais textos perdem espaços apenas nas extremidades.
      for (const f of fields) {
        const raw = String(form.get(f.name) ?? "");
        const value = f.type === "password" ? raw : raw.trim();
        if (!value && !f.optional)
          throw new Error(`Preencha o campo ${f.label}.`);
        if (f.type === "money") payload[f.name] = cents(value);
        else if (f.type === "integer") {
          if (
            !/^-?\d+$/.test(value) ||
            !Number.isSafeInteger(Number(value)) ||
            (!f.signed && Number(value) < 0) ||
            (f.signed && Number(value) === 0)
          )
            throw new Error(`Informe um número inteiro válido em ${f.label}.`);
          payload[f.name] = Number(value);
        } else payload[f.name] = value || (f.name.endsWith("Id") ? null : "");
      }
      if (mode === "active") payload.active = !record.active;
      setBusy(true);
      // Ex.: POST /products cria; PATCH /customers/:id edita; POST /products/:id/stock movimenta.
      const suffix =
        mode === "create"
          ? ""
          : `/${encodeURIComponent(record.id)}${mode === "edit" ? "" : `/${mode}`}`;
      const method = ["edit", "status", "active"].includes(mode)
        ? "PATCH"
        : "POST";
      await api(`/${page}${suffix}`, { method, body: payload });
      onSaved("Alterações salvas com sucesso.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const title = {
    create: `Novo ${schema.singular}`,
    edit: "Editar cliente",
    stock: "Movimentar estoque",
    status: "Alterar situação",
    active: record?.active
      ? "Desativar acesso do usuário"
      : "Ativar acesso do usuário",
  }[mode];
  return (
    <Modal title={title} onClose={onClose} busy={busy}>
      <form onSubmit={submit}>
        <div className="modal-body">
          {record && (
            <p className="record-context">
              {record.name || record.description || record.number}
            </p>
          )}
          {mode === "active" && (
            <p>
              As sessões existentes desse usuário serão encerradas ao confirmar.
            </p>
          )}
          {mode === "stock" && (
            <p>
              Estoque atual: <strong>{record.quantity}</strong> unidades.
            </p>
          )}
          <ErrorBox message={error} />
          {sources && error && (
            <button
              type="button"
              className="secondary"
              onClick={() => setAttempt((v) => v + 1)}
            >
              Recarregar opções
            </button>
          )}
          {loading ? (
            <Busy />
          ) : (
            <div className="form-grid">
              {fields.map((f) => (
                <label key={f.name}>
                  {f.label}
                  {f.optional && <span className="optional">opcional</span>}
                  {f.type === "select" || options[f.type] ? (
                    <select
                      name={f.name}
                      required={!f.optional}
                      defaultValue={
                        mode !== "create" ? (record?.[f.name] ?? "") : ""
                      }
                    >
                      <option value="">
                        {f.optional ? "Sem vínculo" : "Selecione…"}
                      </option>
                      {(f.options || options[f.type]).map((item) => (
                        <option key={item.id || item} value={item.id || item}>
                          {typeof item === "string"
                            ? statusLabels[item]
                            : `${item.name || item.description || item.number || item.id}${item.amountCents != null ? ` · ${currency(item.amountCents)}` : ""}`}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <ValidatedInput
                      name={f.name}
                      format={
                        f.type === "integer"
                          ? f.signed
                            ? "signedInteger"
                            : "integer"
                          : ["sku", "number"].includes(f.name)
                            ? "code"
                            : f.type === "tel"
                              ? "phone"
                              : f.type || "text"
                      }
                      minValue={
                        f.type === "money" && f.name !== "unitPriceCents"
                          ? 0.01
                          : 0
                      }
                      nonZero={!!f.signed}
                      type={
                        ["money", "integer"].includes(f.type)
                          ? "text"
                          : f.type || "text"
                      }
                      inputMode={
                        f.type === "money"
                          ? "decimal"
                          : f.type === "integer"
                            ? "numeric"
                            : undefined
                      }
                      required={!f.optional}
                      maxLength={
                        f.type === "money"
                          ? 10
                          : f.type === "integer"
                            ? 8
                            : fieldLimits(page, f.name)
                      }
                      minLength={
                        f.name === "reason"
                          ? 10
                          : f.type === "password"
                            ? 12
                            : undefined
                      }
                      min={f.type === "date" ? "1900-01-01" : undefined}
                      max={f.type === "date" ? "9999-12-31" : undefined}
                      autoComplete={
                        f.type === "password" ? "new-password" : "off"
                      }
                      defaultValue={
                        mode === "edit" ? (record?.[f.name] ?? "") : ""
                      }
                      placeholder={f.type === "money" ? "0,00" : undefined}
                    />
                  )}
                  {f.type === "money" && (
                    <small>
                      Use vírgula ou ponto decimal, sem separador de milhar.
                    </small>
                  )}
                </label>
              ))}
            </div>
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
            disabled={
              busy ||
              loading ||
              sources
                .split(",")
                .filter(Boolean)
                .some((s) => !options[s])
            }
          >
            {busy && <LoaderCircle size={16} className="spin" />}
            {busy ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Lista reutilizável para clientes, produtos, pedidos, financeiro, documentos e usuários.
function Collection({ page, user, notify }) {
  const canWrite =
    !(user.support && !user.support.writable) &&
    !(user.role === "accountant" && ["products", "orders"].includes(page));
  const [items, setItems] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  // Aumentar revision dispara novamente o efeito de busca depois de salvar ou atualizar.
  const [revision, setRevision] = useState(0);
  const [modal, setModal] = useState(null);
  const [detail, setDetail] = useState(null);
  const schema = schemas[page];
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    Promise.all([
      api(`/${page}`, { signal: controller.signal }),
      page === "orders"
        ? api("/customers", { signal: controller.signal })
        : Promise.resolve({ items: [] }),
    ])
      .then(([data, clients]) => {
        if (!Array.isArray(data?.items) || !Array.isArray(clients?.items))
          throw new Error("A API retornou uma coleção inválida.");
        setItems(data.items);
        setCustomers(clients.items);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [page, revision]);
  // Pesquisa apenas nos registros desta lista já carregada (até 200), sem alterar o banco.
  const filtered = items.filter((item) =>
    JSON.stringify(item)
      .toLocaleLowerCase("pt-BR")
      .includes(query.toLocaleLowerCase("pt-BR")),
  );
  // Converte valores técnicos em textos de tabela: moeda, data e status em português.
  function cell(item, key, type) {
    const value = item[key];
    if (page === "customers" && key === "taxId")
      return value ? maskTaxId(value, item.personType) : "Cadastro incompleto";
    if (page === "audit" && key === "createdAt") return auditDate(value);
    if (page === "audit" && key === "action")
      return actionLabels[value] || value.replaceAll("_", " ");
    if (type === "money")
      return typeof value === "number" ? currency(value) : "—";
    if (type === "date") return dateLabel(value);
    if (type === "status")
      return (
        <span className={`badge ${value}`}>
          {statusLabels[value] || value || "—"}
        </span>
      );
    if (type === "customer")
      return customers.find((c) => c.id === value)?.name || value || "—";
    if (page === "audit") {
      if (key === "actor") return item.actorName || "Sistema";
      if (key === "entity")
        return entityLabels[item.entity] || item.entity || "—";
      if (key === "details")
        return (
          <button className="text-button" onClick={() => setDetail(item)}>
            {item.changes?.length ? "Ver alterações" : "Ver evento"}
          </button>
        );
    }
    return value == null || value === ""
      ? "—"
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ÁREA DE TRABALHO</span>
          <h1>{schema.title}</h1>
          <p>{schema.description}</p>
        </div>
        {schema.fields && canWrite && (
          <button
            className="primary"
            onClick={() => setModal({ mode: "create" })}
          >
            <Plus size={18} /> Novo {schema.singular}
          </button>
        )}
      </div>
      <section className="panel">
        <div className="table-toolbar">
          <label className="search">
            <Search size={18} />
            <ValidatedInput
              aria-label={`Pesquisar em ${schema.title}`}
              maxLength={120}
              placeholder="Pesquisar registros…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <span className="record-count">{filtered.length} registros</span>
          <button
            className="icon-button"
            aria-label="Atualizar registros"
            disabled={busy}
            onClick={() => setRevision((v) => v + 1)}
          >
            <RefreshCw size={18} />
          </button>
        </div>
        <ErrorBox message={error} />
        {busy ? (
          <Busy />
        ) : error ? (
          <div className="empty">
            <p>Não foi possível concluir a operação.</p>
            <button
              className="secondary"
              onClick={() => setRevision((v) => v + 1)}
            >
              Tentar novamente
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <FileText size={32} />
            <h3>
              {query
                ? "Nenhum resultado encontrado"
                : "Tudo pronto para começar"}
            </h3>
            <p>
              {query
                ? "Tente pesquisar por outro termo."
                : "Os registros aparecerão aqui assim que forem cadastrados."}
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {schema.columns.map(([key, label]) => (
                    <th key={key} scope="col">
                      {label}
                    </th>
                  ))}
                  {page !== "audit" && <th scope="col">Ações</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id}>
                    {schema.columns.map(([key, , type]) => (
                      <td key={key}>{cell(item, key, type)}</td>
                    ))}
                    {page !== "audit" && (
                      <td>
                        <div className="row-actions">
                          {page === "customers" && (
                            <>
                              <button
                                disabled={!canWrite}
                                onClick={() =>
                                  setModal({ mode: "edit", record: item })
                                }
                              >
                                Editar
                              </button>
                            </>
                          )}
                          {page === "products" && canWrite && (
                            <button
                              onClick={() =>
                                setModal({ mode: "stock", record: item })
                              }
                            >
                              Movimentar
                            </button>
                          )}
                          {page === "orders" && (
                            <>
                              <button
                                onClick={() =>
                                  setModal({
                                    mode: "orderDetails",
                                    record: item,
                                  })
                                }
                              >
                                Ver itens
                              </button>
                              {["admin", "accountant"].includes(user.role) &&
                                canWrite &&
                                item.status !== "cancelled" && (
                                  <button
                                    onClick={() =>
                                      setModal({
                                        mode: "orderInvoice",
                                        record: item,
                                      })
                                    }
                                  >
                                    Adicionar nota fiscal
                                  </button>
                                )}
                            </>
                          )}
                          {["orders", "transactions", "documents"].includes(
                            page,
                          ) &&
                            canWrite &&
                            (page === "documents" ||
                              (page === "orders"
                                ? ["open", "in_progress"].includes(item.status)
                                : item.status === "pending")) && (
                              <button
                                onClick={() =>
                                  setModal({ mode: "status", record: item })
                                }
                              >
                                Alterar situação
                              </button>
                            )}
                          {page === "users" && (
                            <button
                              disabled={!canWrite || item.id === user.id}
                              onClick={() =>
                                setModal({ mode: "active", record: item })
                              }
                            >
                              {item.active
                                ? "Desativar acesso"
                                : "Ativar acesso"}
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {modal && page === "orders" && modal.mode === "create" ? (
        <Modal wide title="Novo pedido" onClose={() => setModal(null)}>
          <OrderForm
            onClose={() => setModal(null)}
            onSaved={(message) => {
              setModal(null);
              notify(message);
              setRevision((value) => value + 1);
            }}
          />
        </Modal>
      ) : modal && ["orderDetails", "orderInvoice"].includes(modal.mode) ? (
        <Modal
          wide
          title="Itens e nota fiscal do pedido"
          onClose={() => setModal(null)}
        >
          <OrderDetails
            orderId={modal.record.id}
            user={user}
            addInvoice={modal.mode === "orderInvoice"}
            onSaved={notify}
          />
        </Modal>
      ) : modal &&
        page === "customers" &&
        ["create", "edit"].includes(modal.mode) ? (
        <Modal
          wide
          title={modal.mode === "create" ? "Novo cliente" : "Editar cliente"}
          onClose={() => setModal(null)}
        >
          <CustomerForm
            record={modal.record}
            onClose={() => setModal(null)}
            onSaved={(message) => {
              setModal(null);
              notify(message);
              setRevision((value) => value + 1);
            }}
          />
        </Modal>
      ) : (
        modal && (
          <RecordForm
            {...modal}
            page={page}
            onClose={() => setModal(null)}
            onSaved={(message) => {
              setModal(null);
              notify(message);
              setRevision((v) => v + 1);
            }}
          />
        )
      )}
      {detail && (
        <Modal wide title="Detalhes do evento" onClose={() => setDetail(null)}>
          <div className="modal-body">
            <dl className="event-details">
              <dt>Responsável</dt>
              <dd>
                {detail.actorName || "Sistema"}{" "}
                {detail.actorEmail && `(${detail.actorEmail})`}
              </dd>
              <dt>Data e hora</dt>
              <dd>{auditDate(detail.createdAt)}</dd>
              <dt>Ação</dt>
              <dd>
                {actionLabels[detail.action] ||
                  detail.action.replaceAll("_", " ")}
              </dd>
              <dt>Registro</dt>
              <dd>{entityLabels[detail.entity] || detail.entity}</dd>
              <dt>Identificador do registro</dt>
              <dd>{detail.entityId || "Não se aplica"}</dd>
              <dt>Motivo / observação</dt>
              <dd>{detail.reason || "Não informado"}</dd>
            </dl>
            <AuditChanges changes={detail.changes} />
            {detail.reversesEventId && (
              <p className="form-section">
                Reversão do evento nº {detail.reversesEventId}. O histórico
                original foi preservado.
              </p>
            )}
            {detail.isReverted ? (
              <p className="form-section">Esta alteração já foi desfeita.</p>
            ) : user.role === "admin" &&
              !(user.support && !user.support.writable) &&
              detail.reversible ? (
              <RollbackForm
                event={detail}
                onReverted={() => {
                  setDetail(null);
                  setRevision((value) => value + 1);
                  notify(
                    "Alteração desfeita e reversão registrada na auditoria.",
                  );
                }}
              />
            ) : (
              detail.changes?.length > 0 && (
                <p className="form-section">
                  A reversão automática não está disponível para este evento ou
                  modo de acesso. Pedidos, pagamentos e documentos usam seus
                  fluxos próprios para preservar os vínculos.
                </p>
              )
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

// Consulta o resumo calculado pelo servidor. O navegador só formata os valores em reais.
function Dashboard({ user, navigate }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  // O mês financeiro segue Brasília, inclusive se o computador estiver em outro fuso.
  const [month, setMonth] = useState(() =>
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
    }).format(new Date()),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    api(`/dashboard?month=${encodeURIComponent(month)}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (
          ![
            "income",
            "expenses",
            "balance",
            "pendingDocuments",
            "customers",
            "openOrders",
            "estimatedTax",
            "operatingCosts",
            "netRevenue",
            "netIncome",
          ].every((key) => Number.isSafeInteger(result?.[key]))
        )
          throw new Error("Indicadores inválidos recebidos da API.");
        setData(result);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
    // Alterar o mês ou clicar em atualizar faz uma nova consulta, sem recarregar o site.
  }, [revision, month]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SEU NEGÓCIO EM PERSPECTIVA</span>
          <h1>
            Olá, {user.name.split(" ")[0]}{" "}
            <span className="greeting-dot">.</span>
          </h1>
          <p>Receita bruta e resultado líquido do seu negócio.</p>
        </div>
        <div className="heading-actions">
          <button
            className="secondary"
            disabled={!data}
            onClick={() => setExportOpen(true)}
          >
            <Download size={16} />
            Exportar Excel
          </button>
          <button
            className="secondary"
            onClick={() => setRevision((v) => v + 1)}
          >
            <RefreshCw size={16} /> Atualizar
          </button>
        </div>
      </div>
      <div className="financial-toolbar">
        <label htmlFor="dashboard-month">
          Mês de referência
          <ValidatedInput
            id="dashboard-month"
            type="month"
            format="month"
            required
            value={month}
            min="2000-01"
            max="9999-12"
            onChange={(event) => {
              if (/^[2-9]\d{3}-(0[1-9]|1[0-2])$/.test(event.target.value))
                setMonth(event.target.value);
            }}
          />
        </label>
        <p>
          Receitas e despesas pela data de pagamento, no horário de Brasília.
        </p>
        <button
          className="secondary"
          disabled={!data || (user.support && !user.support.writable)}
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 size={17} /> Configurar impostos e custos
        </button>
      </div>
      {saved && (
        <div className="notice" role="status">
          Configuração salva. Os indicadores usam a alíquota e os custos atuais.
        </div>
      )}
      <ErrorBox message={error} />
      {exportOpen && (
        <Modal
          title="Exportar resultados financeiros"
          onClose={() => setExportOpen(false)}
        >
          <ExportReportForm
            month={month}
            onClose={() => setExportOpen(false)}
          />
        </Modal>
      )}
      {!data && !error ? (
        <Busy />
      ) : (
        data && (
          <>
            <div className="metric-grid">
              {[
                [
                  "Receita bruta",
                  data.income,
                  ArrowDownLeft,
                  "income",
                  "Total de receitas recebidas no mês",
                ],
                [
                  "Impostos estimados",
                  data.estimatedTax,
                  FileText,
                  "expense",
                  `Alíquota de ${(data.settings.taxRateBasisPoints / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% sobre a receita bruta`,
                ],
                [
                  "Receita após impostos",
                  data.netRevenue,
                  Wallet,
                  "income",
                  "Receita bruta menos imposto estimado",
                ],
                [
                  "Despesas pagas",
                  data.expenses,
                  ArrowUpRight,
                  "expense",
                  "Despesas já registradas no financeiro",
                ],
                [
                  "Custos operacionais adicionais",
                  data.operatingCosts,
                  Settings2,
                  "expense",
                  data.settings.monthlyOperatingCostsCents == null
                    ? "Opcional: nenhum custo adicional informado"
                    : "Valor fixo mensal informado na configuração",
                ],
                [
                  "Resultado líquido estimado",
                  data.netIncome,
                  Wallet,
                  data.netIncome < 0 ? "negative" : "balance",
                  "Após impostos, despesas e custos adicionais",
                ],
              ].map(([label, value, Icon, kind, description]) => (
                <div className={`metric ${kind}`} key={label}>
                  <div>
                    {label}
                    <span>
                      <Icon size={20} />
                    </span>
                  </div>
                  <strong>{currency(value)}</strong>
                  <small>{description}</small>
                </div>
              ))}
            </div>
            <div className="calculation-note">
              <strong>Como calculamos:</strong> resultado líquido = receita
              bruta − impostos estimados − despesas pagas − custos operacionais
              adicionais. A alíquota é informada por você; não é uma apuração
              tributária oficial. Custos e impostos já lançados como despesas
              não devem ser descontados outra vez nesta estimativa.
            </div>
            {settingsOpen && (
              <Modal
                title="Impostos e custos do negócio"
                onClose={() => setSettingsOpen(false)}
              >
                <BusinessSettingsForm
                  settings={data.settings}
                  onClose={() => setSettingsOpen(false)}
                  onSaved={() => {
                    setSettingsOpen(false);
                    setSaved(true);
                    setRevision((value) => value + 1);
                  }}
                />
              </Modal>
            )}
            <div className="dashboard-grid">
              <section className="panel overview">
                <div className="section-heading">
                  <h2>Na sua rotina</h2>
                  <span className="muted">
                    Posição geral, todos os períodos
                  </span>
                </div>
                {[
                  [
                    "customers",
                    "Clientes cadastrados",
                    "Organize sua base de relacionamentos",
                    data.customers,
                    Users,
                  ],
                  [
                    "orders",
                    "Pedidos em aberto",
                    "Acompanhe o andamento das operações",
                    data.openOrders,
                    ShoppingBag,
                  ],
                  [
                    "documents",
                    "Documentos pendentes",
                    "Confira os registros que precisam de revisão",
                    data.pendingDocuments,
                    FileText,
                  ],
                ].map(([key, title, text, count, Icon]) => (
                  <button
                    className="overview-row"
                    key={key}
                    onClick={() => navigate(key)}
                  >
                    <span className="section-icon">
                      <Icon size={21} />
                    </span>
                    <span>
                      <strong>{title}</strong>
                      <small>{text}</small>
                    </span>
                    <b>{count}</b>
                    <ChevronRight size={18} />
                  </button>
                ))}
              </section>
              <section className="next-card">
                <span className="eyebrow">PRÓXIMO PASSO</span>
                <h2>
                  Organização hoje.
                  <br />
                  Mais clareza amanhã.
                </h2>
                <p>
                  Mantenha seus lançamentos atualizados e revise os documentos
                  vinculados.
                </p>
                <button
                  className="primary"
                  onClick={() => navigate("transactions")}
                >
                  Abrir financeiro <ArrowUpRight size={18} />
                </button>
                <div className="prototype-note">
                  <ShieldCheck size={18} />
                  <span>
                    Organize documentos e acompanhe a conferência fiscal.
                  </span>
                </div>
              </section>
            </div>
          </>
        )
      )}
    </>
  );
}

// A API confirma a senha atual e encerra todas as sessões após a troca.
function PasswordForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      if (data.get("newPassword") !== data.get("confirmation"))
        throw new Error("A confirmação não corresponde à nova senha.");
      await api("/auth/password", {
        method: "POST",
        body: {
          currentPassword: data.get("currentPassword"),
          newPassword: data.get("newPassword"),
        },
      });
      window.location.reload();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <h2>Trocar minha senha</h2>
      <p>
        A nova senha deve ter entre 12 e 128 caracteres. Todas as sessões serão
        encerradas.
      </p>
      <ErrorBox message={error} />
      <div className="form-grid">
        <label>
          Senha atual
          <ValidatedInput
            name="currentPassword"
            type="password"
            format="password"
            required
            autoComplete="current-password"
            maxLength={128}
          />
        </label>
        <label>
          Nova senha
          <ValidatedInput
            name="newPassword"
            type="password"
            format="password"
            required
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
          />
        </label>
        <label>
          Confirmar nova senha
          <ValidatedInput
            name="confirmation"
            type="password"
            format="password"
            matchName="newPassword"
            required
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
          />
        </label>
      </div>
      <button className="primary password-submit" disabled={busy}>
        {busy ? "Atualizando…" : "Atualizar senha"}
      </button>
    </form>
  );
}

// Reúne orientações de privacidade e o formulário de troca de senha do próprio usuário.
function Privacy() {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Configurações</h1>
          <p>Atualize a senha de acesso à sua conta.</p>
        </div>
      </div>
      <section className="panel privacy">
        <ShieldCheck className="privacy-icon" size={32} />
        <PasswordForm />
      </section>
    </>
  );
}

// Componente principal: mantém usuário, página atual, menu mobile e avisos temporários.
function App() {
  const { theme, toggleTheme } = useTheme();
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState("");
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState("dashboard");
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState("");
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [supportError, setSupportError] = useState("");
  const toastTimer = useRef(null);
  function notify(message) {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 6500);
  }
  function acceptSession(data) {
    // Guarda só os dados públicos do usuário e o CSRF; o JWT fica no cookie HttpOnly.
    if (
      !data?.user ||
      !["admin", "accountant", "operator"].includes(data.user.role) ||
      typeof data.user.name !== "string" ||
      !data.csrfToken
    )
      throw new Error("A API retornou uma sessão inválida.");
    setSession(data.csrfToken);
    setUser(data.user);
    setPage(home(data.user));
    setNotice("");
    setBootError("");
  }
  async function bootstrap() {
    // Ao abrir ou atualizar a página, tenta recuperar a sessão pelo cookie existente.
    setBooting(true);
    setBootError("");
    try {
      acceptSession(await api("/auth/me"));
    } catch (e) {
      setBootError(e.message);
    } finally {
      setBooting(false);
    }
  }
  useEffect(() => {
    setUnauthorizedHandler(() => {
      // Qualquer resposta 401 de uma rota protegida retorna o usuário ao login.
      setSession(null);
      setUser(null);
      setToast("");
      setNotice("Entre para iniciar ou renovar sua sessão.");
    });
    bootstrap();
    return () => {
      setUnauthorizedHandler(() => {});
      clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => {
    if (!user?.support) return;
    // Ao vencer o suporte, remove a tela empresarial e recupera o painel geral.
    const timer = setTimeout(
      () => bootstrap(),
      Math.max(0, new Date(user.support.expiresAt).getTime() - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [user?.support?.expiresAt]);
  async function logout() {
    // Só limpa a interface após o servidor revogar a sessão.
    setLogoutBusy(true);
    try {
      await api("/auth/logout", { method: "POST" });
      setSession(null);
      setUser(null);
      setNotice("Você saiu do sistema.");
      setToast("");
    } catch (e) {
      notify(e.message);
    } finally {
      setLogoutBusy(false);
    }
  }
  async function endSupport() {
    setSupportError("");
    try {
      await api("/platform/support/end", { method: "POST" });
      await bootstrap();
    } catch (e) {
      setSupportError(e.message);
    }
  }
  function navigate(next) {
    if (allowed(next, user.role)) {
      setPage(next);
      setMenu(false);
      document.getElementById("main-content")?.focus();
    }
  }
  if (booting)
    return (
      <div className="boot">
        <Brand />
        <Busy />
      </div>
    );
  if (!user)
    return (
      <>
        <Login
          onLogin={acceptSession}
          notice={notice || bootError}
          theme={theme}
          toggleTheme={toggleTheme}
        />
        {bootError && !notice && (
          <button className="retry-session secondary" onClick={bootstrap}>
            Verificar sessão novamente
          </button>
        )}
      </>
    );
  if (user.isPlatformAdmin && !user.support)
    return (
      <PlatformAdmin
        user={user}
        onSessionChanged={bootstrap}
        onLogout={logout}
        logoutBusy={logoutBusy}
        themeButton={<ThemeToggle theme={theme} toggleTheme={toggleTheme} />}
        account={<PasswordForm />}
      />
    );
  const currentPage = allowed(page, user.role) ? page : home(user);
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Ir para o conteúdo
      </a>
      {menu && (
        <button
          className="sidebar-backdrop"
          aria-label="Fechar navegação"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={`sidebar ${menu ? "is-open" : ""}`}>
        <Brand />
        <div className="workspace-label">ESPAÇO DE TRABALHO</div>
        <nav aria-label="Navegação principal">
          {navigation
            .filter(([key]) => allowed(key, user.role))
            .map(([key, label, Icon]) => (
              <button
                key={key}
                className={currentPage === key ? "active" : ""}
                onClick={() => navigate(key)}
                aria-current={currentPage === key ? "page" : undefined}
              >
                <Icon size={19} />
                {label}
                {currentPage === key && <span className="nav-dot" />}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <p>Gestão com uma nova perspectiva.</p>
          <button className="logout" disabled={logoutBusy} onClick={logout}>
            <LogOut size={17} />
            {logoutBusy ? "Saindo…" : "Sair da conta"}
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Abrir navegação"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <Menu size={22} />
          </button>
          <div className="breadcrumb">
            Espaço de trabalho <ChevronRight size={14} />
            <span>{navigation.find(([key]) => key === currentPage)?.[1]}</span>
          </div>
          <div className="profile">
            <ThemeToggle theme={theme} toggleTheme={toggleTheme} />
            <div>
              <strong>{user.name}</strong>
              <small>
                {user.isPlatformAdmin
                  ? "Administrador geral"
                  : statusLabels[user.role]}
              </small>
            </div>
            <span className="avatar" aria-hidden="true">
              {user.name.slice(0, 2).toUpperCase()}
            </span>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="main-content">
          {user.support ? (
            <section className="support-banner" role="status">
              <strong>Suporte: {user.support.companyName}</strong>
              <p>
                {user.support.writable
                  ? "Alterações autorizadas"
                  : "Somente consulta"}{" "}
                · Até{" "}
                {new Date(user.support.expiresAt).toLocaleTimeString("pt-BR", {
                  timeZone: "America/Sao_Paulo",
                })}
                . Acesso com sua identidade e auditoria.
              </p>
              <button className="secondary" onClick={endSupport}>
                Encerrar suporte e voltar à administração geral
              </button>
              {supportError && <p role="alert">{supportError}</p>}
            </section>
          ) : (
            <p className="company-context">Empresa: {user.companyName}</p>
          )}
          {currentPage === "dashboard" ? (
            <Dashboard user={user} navigate={navigate} />
          ) : currentPage === "privacy" ? (
            <Privacy />
          ) : (
            <Collection
              key={currentPage}
              page={currentPage}
              user={user}
              notify={notify}
            />
          )}
        </main>
        <footer className="app-footer">
          Plano BR — Sistema ERP <span>Planejamento financeiro e gestão empresarial</span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          <span>{toast}</span>
          <button aria-label="Fechar mensagem" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

// Conecta o React à div root declarada em client/index.html.
createRoot(document.getElementById("root")).render(<App />);
