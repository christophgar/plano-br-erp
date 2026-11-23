// Ponto único para chamadas HTTP: evita repetir cookie, CSRF e tratamento de erros nas telas.
// O token CSRF fica só na memória desta aba; o JWT é um cookie que o JavaScript não lê.
let csrfToken = null;
let onUnauthorized = () => {};

export function setSession(token) {
  csrfToken = token || null;
}
export function setUnauthorizedHandler(handler) {
  // App registra aqui a função que mostra o login quando a sessão expira.
  onUnauthorized = handler;
}

export async function api(path, { method = "GET", body, signal } = {}) {
  // GET consulta. POST/PATCH/PUT alteram dados e precisam de JSON e proteção CSRF.
  if (!["GET", "HEAD"].includes(method) && body === undefined) body = {};
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;
  if (method !== "GET" && path !== "/auth/login" && !csrfToken) {
    throw new Error("Sessão sem token de segurança. Entre novamente.");
  }
  let response;
  try {
    // /api é atendido pelo proxy do Vite no desenvolvimento e pelo Express em produção.
    // credentials envia o cookie só à mesma origem; signal permite cancelar uma busca.
    response = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error(
      "Não foi possível conectar à API. Verifique sua conexão e tente novamente.",
    );
  }
  // Ler como texto antes do JSON permite tratar respostas vazias e respostas inválidas.
  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  // Status fora de 200-299 viram uma mensagem que o formulário consegue mostrar.
  if (!response.ok) {
    if (response.status === 401 && path !== "/auth/login") onUnauthorized();
    const message =
      typeof data?.message === "string"
        ? data.message
        : typeof data?.error === "string"
          ? data.error
          : null;
    throw new Error(
      message ||
        {
          401: "E-mail ou senha inválidos, ou sessão expirada.",
          403: "Você não tem permissão para esta ação.",
          409: "O registro foi alterado ou possui vínculos que impedem a operação.",
          429: "Muitas tentativas. Aguarde e tente novamente.",
        }[response.status] ||
        `A operação falhou (${response.status}). Tente novamente.`,
    );
  }
  if (raw && data === null)
    throw new Error(
      "A API retornou uma resposta inválida. Verifique a configuração do servidor.",
    );
  return data;
}

// Download autenticado separado do JSON: recebe o binário e solicita salvar no navegador.
export async function downloadFinancialExcel(period) {
  const { from, to } =
    typeof period === "string" ? { from: period, to: period } : period;
  const response = await fetch(
    `/api/reports/financial.xlsx?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { credentials: "same-origin" },
  );
  if (!response.ok) {
    if (response.status === 401) onUnauthorized();
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || "Não foi possível exportar o relatório.");
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `financeiro-${from}${from === to ? "" : "_a_" + to}.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
