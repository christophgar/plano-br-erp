// Painel geral não carrega clientes/financeiro por padrão. Suporte é uma ação separada e temporária.
import React, { useEffect, useRef, useState } from "react";
import { api } from "./api";
import ValidatedInput from "./ValidatedInput";
import { maskTaxId } from "../../shared/brazil.js";

const eventNames = {
  platform_granted: "Conta autorizada como administrador geral",
  platform_login: "Entrada na administração geral",
  company_created: "Empresa cadastrada",
  company_updated: "Empresa atualizada",
  company_suspended: "Empresa suspensa",
  company_users_viewed: "Consulta de usuários",
  company_user_password_reset: "Senha de usuário redefinida",
  company_user_access_changed: "Acesso de usuário alterado",
  support_started_read: "Suporte iniciado: somente consulta",
  support_started_write: "Suporte iniciado: alterações autorizadas",
  support_ended: "Suporte encerrado",
  support_request: "Solicitação de suporte (tentativa de acesso)",
  own_password_changed: "Senha pessoal alterada",
};
export default function PlatformAdmin({
  user,
  onSessionChanged,
  onLogout,
  logoutBusy,
  themeButton,
  account,
}) {
  const [companies, setCompanies] = useState([]);
  const [events, setEvents] = useState([]);
  const [auditScope, setAuditScope] = useState(null);
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditDates, setAuditDates] = useState({ from: "", to: "" });
  const [appliedDates, setAppliedDates] = useState({ from: "", to: "" });
  const [dateError, setDateError] = useState("");
  const auditRequest = useRef(0);
  const [users, setUsers] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [editor, setEditor] = useState(null);
  const [editorRevision, setEditorRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  async function load() {
    const list = await api("/platform/companies");
    setCompanies(list.items);
    if (auditScope) await showAudit(auditScope, appliedDates);
  }
  async function showAudit(scope, dates = { from: "", to: "" }) {
    const request = ++auditRequest.current;
    setAuditScope(scope);
    setEvents([]);
    setAuditBusy(true);
    setError("");
    setDateError("");
    setAuditDates(dates);
    setAppliedDates(dates);
    try {
      const query = new URLSearchParams(
        Object.entries(dates).filter(([, value]) => value),
      );
      const history = await api(
        (scope.id
          ? `/platform/companies/${scope.id}/events`
          : "/platform/events") + (query.size ? `?${query}` : ""),
      );
      // Respostas antigas não podem aparecer no painel de outra empresa.
      if (request === auditRequest.current) setEvents(history.items);
    } catch (e) {
      if (request === auditRequest.current) setError(e.message);
    } finally {
      if (request === auditRequest.current) setAuditBusy(false);
    }
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  function open(mode, company = null, target = null) {
    // Remonta o formulário: nunca reaproveita a senha digitada em uma autorização anterior.
    setEditorRevision((previous) => previous + 1);
    setEditor({ mode, company, target });
    setError("");
    setNotice("");
  }
  async function showUsers(company) {
    setError("");
    try {
      const result = await api(`/platform/companies/${company.id}/users`);
      setUsers(result.items);
      setSelectedCompany(company);
      setEditor(null);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }
  async function submit(event) {
    event.preventDefault();
    const p = Object.fromEntries(new FormData(event.currentTarget));
    const { mode, company, target } = editor;
    setBusy(true);
    setError("");
    try {
      const confirmation = {
        currentPassword: p.authorizationPassword,
        reason: p.actionReason,
      };
      if (mode === "support") {
        await api("/platform/support", {
          method: "POST",
          body: {
            ...confirmation,
            companyId: company.id,
            writable: p.writable === "yes",
          },
        });
        await onSessionChanged();
        return;
      }
      if (mode === "reset" || mode === "access") {
        await api(`/platform/companies/${company.id}/users/${target.id}`, {
          method: "PATCH",
          body: {
            ...confirmation,
            ...(mode === "reset"
              ? { newPassword: p.newPassword }
              : { active: !target.active }),
          },
        });
        await showUsers(company);
      } else {
        const payload = { ...confirmation, name: p.name, taxId: p.taxId };
        if (mode === "create")
          payload.admin = {
            name: p.adminName,
            email: p.adminEmail,
            password: p.adminPassword,
          };
        else payload.active = p.active === "yes";
        await api(
          "/platform/companies" + (mode === "edit" ? `/${company.id}` : ""),
          {
            method: mode === "edit" ? "PATCH" : "POST",
            body: payload,
          },
        );
      }
      setEditor(null);
      setNotice("Operação concluída e registrada na auditoria.");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function input(name, label, format = "text", maxLength = 120, extra = {}) {
    return (
      <label>
        {label}
        <ValidatedInput
          name={name}
          format={format}
          type={
            format === "password"
              ? "password"
              : format === "email"
                ? "email"
                : "text"
          }
          required
          maxLength={maxLength}
          autoComplete={format === "password" ? "new-password" : "off"}
          {...extra}
        />
      </label>
    );
  }
  const titles = {
    create: "Cadastrar empresa",
    edit: "Editar empresa e acesso",
    support: "Iniciar suporte temporário",
    reset: "Redefinir senha de usuário",
    access: "Alterar acesso de usuário",
  };
  return (
    <div className="platform-shell">
      <header className="platform-header">
        <div>
          <h1>Administração geral</h1>
          <img className="platform-brand" src="/plano-br-logo.png" alt="Plano BR — Sistema ERP" />
          <p>Plano BR · {user.name}</p>
        </div>
        <div className="heading-actions">
          {themeButton}
          <button className="secondary" onClick={() => open("account")}>
            Minha senha
          </button>
          <button
            className="secondary"
            disabled={logoutBusy}
            onClick={onLogout}
          >
            Sair da conta
          </button>
        </div>
      </header>
      <main id="main-content">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <p>
          Empresas têm cadastros e dados separados. Consultar ou alterar dados
          internos exige iniciar suporte com motivo e confirmação de senha.
          Nenhuma senha armazenada pode ser consultada.
        </p>
        <div className="heading-actions">
          <button className="primary" onClick={() => open("create")}>
            Nova empresa
          </button>
          <button
            className="secondary"
            onClick={() => load().catch((e) => setError(e.message))}
          >
            Atualizar lista
          </button>
        </div>
        {editor?.mode === "account" ? (
          <section className="panel platform-editor">
            {account}
            <button className="secondary" onClick={() => setEditor(null)}>
              Fechar
            </button>
          </section>
        ) : (
          editor && (
            <section
              className="panel platform-editor"
              aria-label={titles[editor.mode]}
            >
              <h2>{titles[editor.mode]}</h2>
              {editor.company && (
                <p>
                  Empresa: {editor.company.name}
                  {editor.target && ` · Usuário: ${editor.target.name}`}
                </p>
              )}
              <form
                key={`${editorRevision}-${editor.mode}-${editor.company?.id || "new"}-${editor.target?.id || ""}`}
                onSubmit={submit}
                autoComplete="off"
              >
                <div className="form-grid two-columns">
                  {["create", "edit"].includes(editor.mode) && (
                    <>
                      {input("name", "Nome da empresa", "text", 120, {
                        defaultValue: editor.company?.name || "",
                        minLength: 2,
                      })}
                      {input("taxId", "CNPJ da empresa", "cnpj", 18, {
                        defaultValue: maskTaxId(
                          editor.company?.taxId || "",
                          "PJ",
                        ),
                      })}
                      {editor.mode === "create" ? (
                        <>
                          {input(
                            "adminName",
                            "Nome do administrador da empresa",
                            "text",
                            100,
                          )}
                          {input(
                            "adminEmail",
                            "E-mail do administrador",
                            "email",
                            254,
                          )}
                          {input(
                            "adminPassword",
                            "Senha inicial (12 a 128 caracteres)",
                            "password",
                            128,
                            { minLength: 12 },
                          )}
                          {input(
                            "confirmAdminPassword",
                            "Confirmar senha inicial",
                            "password",
                            128,
                            { minLength: 12, matchName: "adminPassword" },
                          )}
                        </>
                      ) : (
                        <label>
                          Acesso da empresa
                          <select
                            name="active"
                            defaultValue={editor.company.active ? "yes" : "no"}
                          >
                            <option value="yes">Ativo</option>
                            <option value="no">
                              Suspenso — encerra as sessões dos usuários
                            </option>
                          </select>
                        </label>
                      )}
                    </>
                  )}
                  {editor.mode === "support" && (
                    <label>
                      Permissão durante o suporte
                      <select name="writable" defaultValue="no">
                        <option value="no">Somente consulta</option>
                        <option value="yes">
                          Permitir alterações nesta empresa
                        </option>
                      </select>
                      <small>
                        Acesso por até 15 minutos, com sua identidade e registro
                        de solicitações. Não há troca para a conta de outro
                        usuário.
                      </small>
                    </label>
                  )}
                  {editor.mode === "reset" && (
                    <>
                      {input(
                        "newPassword",
                        "Nova senha do usuário",
                        "password",
                        128,
                        { minLength: 12 },
                      )}
                      {input(
                        "confirmNewPassword",
                        "Confirmar nova senha",
                        "password",
                        128,
                        { minLength: 12, matchName: "newPassword" },
                      )}
                    </>
                  )}
                  {editor.mode === "access" && (
                    <p>
                      {editor.target.active ? "Desativar" : "Ativar"} o usuário.
                      As sessões existentes serão encerradas.
                    </p>
                  )}
                  {input(
                    "actionReason",
                    "Motivo ou número do atendimento (mínimo 10 caracteres)",
                    "text",
                    200,
                    {
                      minLength: 10,
                      autoComplete: "off",
                      "data-lpignore": "true",
                      "data-1p-ignore": "true",
                    },
                  )}
                  {input(
                    "authorizationPassword",
                    "Sua senha para autorizar esta ação",
                    "password",
                    128,
                    // new-password evita sugerir a senha de login salva; não muda a senha da conta.
                    {
                      autoComplete: "new-password",
                      "data-lpignore": "true",
                      "data-1p-ignore": "true",
                      "data-bwignore": "true",
                    },
                  )}
                </div>
                <div className="heading-actions password-submit">
                  <button className="primary" disabled={busy}>
                    {busy ? "Processando…" : "Confirmar operação"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => setEditor(null)}
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            </section>
          )
        )}
        <label className="platform-search">
          Pesquisar empresas
          <ValidatedInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxLength={120}
          />
        </label>
        <section
          className="platform-companies"
          aria-label="Empresas cadastradas"
        >
          {companies
            .filter((c) =>
              `${c.name} ${c.taxId || ""}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((company) => (
              <article key={company.id} className="panel platform-company">
                <h2>{company.name}</h2>
                <p>
                  {company.taxId
                    ? maskTaxId(company.taxId, "PJ")
                    : "CNPJ ainda não informado"}
                </p>
                <p>
                  {company.active ? "Ativa" : "Suspensa"} · {company.usersCount}{" "}
                  usuário(s)
                </p>
                <div className="heading-actions">
                  <button
                    className="secondary"
                    onClick={() => open("edit", company)}
                  >
                    Editar empresa
                  </button>
                  <button
                    className="secondary"
                    onClick={() => showUsers(company)}
                  >
                    Gerenciar usuários
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      showAudit({ id: company.id, name: company.name })
                    }
                  >
                    Ver auditoria
                  </button>
                  <button
                    className="primary"
                    disabled={!company.active}
                    onClick={() => open("support", company)}
                  >
                    Acessar para suporte
                  </button>
                </div>
              </article>
            ))}
        </section>
        {selectedCompany && (
          <section
            className="panel platform-editor"
            aria-label="Usuários da empresa"
          >
            <h2>Usuários de {selectedCompany.name}</h2>
            {!users.length && (
              <p>
                Nenhum usuário de empresa cadastrado. Inicie suporte com
                alterações para cadastrar um administrador na aba Usuários.
              </p>
            )}
            {users.map((target) => (
              <div className="platform-user" key={target.id}>
                <p>
                  <strong>{target.name}</strong> · {target.email} ·{" "}
                  {target.active ? "Ativo" : "Inativo"}
                </p>
                <div className="heading-actions">
                  <button
                    className="secondary"
                    onClick={() => open("reset", selectedCompany, target)}
                  >
                    Redefinir senha
                  </button>
                  <button
                    className="secondary"
                    onClick={() => open("access", selectedCompany, target)}
                  >
                    {target.active ? "Desativar usuário" : "Ativar usuário"}
                  </button>
                </div>
              </div>
            ))}
            <button
              className="secondary"
              onClick={() => setSelectedCompany(null)}
            >
              Fechar usuários
            </button>
          </section>
        )}
        <button
          className="secondary"
          onClick={() => showAudit({ name: "Plataforma" })}
        >
          Auditoria da plataforma
        </button>
        {auditScope && (
          <section
            className="panel platform-editor"
            aria-label="Auditoria selecionada"
          >
            <h2>
              {auditScope.id
                ? `Auditoria — ${auditScope.name}`
                : "Auditoria da plataforma"}
            </h2>
            <p>
              {auditScope.id
                ? "Somente eventos administrativos e de suporte desta empresa. A auditoria das operações fica dentro do ambiente da própria empresa."
                : "Somente eventos da plataforma, como entrada e autorização de administradores gerais. Não inclui eventos das empresas."}{" "}
              Até 200 eventos mais recentes do período. Solicitações de suporte
              registram tentativas de acesso, não comprovam conclusão.
            </p>
            <form
              className="audit-date-filter"
              onSubmit={(event) => {
                event.preventDefault();
                if (
                  auditDates.from &&
                  auditDates.to &&
                  auditDates.from > auditDates.to
                ) {
                  setDateError(
                    "A data inicial deve ser anterior ou igual à final.",
                  );
                  return;
                }
                showAudit(auditScope, auditDates);
              }}
            >
              <div className="form-grid two-columns">
                <label>
                  Data inicial
                  <ValidatedInput
                    type="date"
                    format="date"
                    min="1900-01-01"
                    max="9999-12-31"
                    value={auditDates.from}
                    onChange={(e) =>
                      setAuditDates((previous) => ({
                        ...previous,
                        from: e.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Data final
                  <ValidatedInput
                    type="date"
                    format="date"
                    min="1900-01-01"
                    max="9999-12-31"
                    value={auditDates.to}
                    onChange={(e) =>
                      setAuditDates((previous) => ({
                        ...previous,
                        to: e.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <p>
                Datas no horário de Brasília, incluindo o dia final. Para um
                único dia, repita a data nos dois campos.
              </p>
              {dateError && (
                <p className="error" role="alert">
                  {dateError}
                </p>
              )}
              <div className="heading-actions password-submit">
                <button className="primary" disabled={auditBusy}>
                  Buscar por data
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={auditBusy}
                  onClick={() => showAudit(auditScope)}
                >
                  Limpar filtro
                </button>
              </div>
            </form>
            <p role="status">
              Período aplicado:{" "}
              {appliedDates.from
                ? appliedDates.from.split("-").reverse().join("/")
                : "início do histórico"}{" "}
              até{" "}
              {appliedDates.to
                ? appliedDates.to.split("-").reverse().join("/")
                : "data mais recente"}
              .
            </p>
            <div className="heading-actions">
              <button
                className="secondary"
                disabled={auditBusy}
                onClick={() => showAudit(auditScope, appliedDates)}
              >
                Atualizar auditoria
              </button>
              <button
                className="secondary"
                onClick={() => {
                  auditRequest.current++;
                  setAuditScope(null);
                  setEvents([]);
                }}
              >
                Fechar auditoria
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Data e hora</th>
                    <th>Responsável</th>
                    <th>Ação</th>
                    <th>Motivo / solicitação</th>
                  </tr>
                </thead>
                <tbody>
                  {auditBusy ? (
                    <tr>
                      <td colSpan={4}>Carregando auditoria…</td>
                    </tr>
                  ) : (
                    !events.length && (
                      <tr>
                        <td colSpan={4}>Nenhum evento neste histórico.</td>
                      </tr>
                    )
                  )}
                  {events.map((event) => (
                    <tr key={event.id}>
                      <td>
                        {new Date(event.createdAt).toLocaleString("pt-BR", {
                          timeZone: "America/Sao_Paulo",
                        })}
                      </td>
                      <td>{event.actorName}</td>
                      <td>
                        {eventNames[event.action] || "Evento administrativo"}
                      </td>
                      <td>{event.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
