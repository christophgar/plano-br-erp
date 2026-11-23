// Regras visuais dos cadastros. Elas ajudam a montar as telas; a API valida os dados novamente.
// O banco e a API usam centavos. Só a apresentação divide por 100 para exibir reais.
export const currency = (value) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    value / 100,
  );
export function cents(value) {
  // Ex.: "150,25" vira 15025. Separar parte inteira e decimal evita arredondar 150.25 * 100.
  const text = String(value).trim();
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(text))
    throw new Error(
      "Informe o valor sem separador de milhar, com até duas casas decimais.",
    );
  const [whole, fraction = ""] = text.replace(",", ".").split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result))
    throw new Error("Valor monetário fora do limite permitido.");
  return result;
}
export function dateLabel(value) {
  // Uma data sem hora usa meio-dia local para não aparecer como o dia anterior por fuso.
  if (!value) return "—";
  const date = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value,
  );
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("pt-BR");
}
// A API usa nomes em inglês; esta tabela define o texto que o usuário vê.
export const statusLabels = {
  PF: "Pessoa física",
  PJ: "Pessoa jurídica",
  open: "Aberto",
  in_progress: "Em andamento",
  completed: "Concluído",
  cancelled: "Cancelado",
  pending: "Pendente",
  paid: "Pago",
  reviewed: "Revisado",
  income: "Receita",
  expense: "Despesa",
  invoice: "Nota fiscal",
  receipt: "Recibo",
  other: "Outro",
  operator: "Operador",
  accountant: "Contador",
  admin: "Administrador",
};
// Códigos são estáveis no banco; rótulos da auditoria são apresentados em português.
export const actionLabels = {
  rolled_back: "Alteração desfeita pelo administrador",
  login: "Entrada no sistema",
  created: "Cadastro criado",
  updated: "Cadastro atualizado",
  stock_changed: "Estoque movimentado",
  status_open: "Situação: aberto",
  status_in_progress: "Situação: em andamento",
  status_completed: "Situação: concluído",
  status_cancelled: "Registro cancelado",
  status_paid: "Pagamento/recebimento confirmado",
  status_pending: "Situação: pendente",
  status_reviewed: "Documento conferido",
  activated: "Acesso ativado",
  deactivated: "Acesso desativado",
  password_changed: "Senha alterada",
  privacy_export: "Dados do cliente exportados",
  contact_removed: "Dados pessoais removidos",
  financial_settings_updated: "Impostos e custos atualizados",
  financial_export: "Relatório financeiro exportado",
};
export const entityLabels = {
  user: "Usuário",
  customer: "Cliente",
  product: "Produto",
  order: "Pedido",
  transaction: "Lançamento financeiro",
  document: "Documento fiscal",
  business_settings: "Configuração financeira",
  financial_report: "Relatório financeiro",
};
export const auditDate = (value) =>
  new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
// Atalho para descrever um campo: nome enviado à API, rótulo, tipo e opções adicionais.
const field = (name, label, type = "text", extra = {}) => ({
  name,
  label,
  type,
  ...extra,
});
// Cada cadastro informa título, colunas da lista e campos do formulário genérico.
export const schemas = {
  customers: {
    title: "Clientes",
    singular: "cliente",
    description: "Relacionamentos organizados, informações sempre à mão.",
    columns: [
      ["name", "Nome"],
      ["personType", "Tipo", "status"],
      ["taxId", "CPF / CNPJ"],
      ["email", "E-mail"],
      ["phone", "Telefone"],
    ],
    fields: [
      field("name", "Nome completo ou razão social"),
      field("email", "E-mail", "email", { optional: true }),
      field("phone", "Telefone", "tel", { optional: true }),
    ],
  },
  products: {
    title: "Produtos e estoque",
    singular: "produto",
    description: "Acompanhe seu catálogo e cada movimentação de estoque.",
    columns: [
      ["name", "Produto"],
      ["sku", "Código do produto"],
      ["quantity", "Estoque"],
      ["unitPriceCents", "Preço unitário", "money"],
    ],
    fields: [
      field("name", "Nome do produto"),
      field("sku", "Código do produto"),
      field("quantity", "Quantidade inicial", "integer"),
      field("unitPriceCents", "Preço unitário (R$)", "money"),
    ],
  },
  orders: {
    title: "Pedidos",
    singular: "pedido",
    description: "Do primeiro contato à entrega, acompanhe cada pedido.",
    columns: [
      ["description", "Descrição"],
      ["customerId", "Cliente", "customer"],
      ["amountCents", "Valor", "money"],
      ["status", "Situação", "status"],
    ],
    fields: [
      field("customerId", "Cliente", "customers"),
      field("description", "Descrição"),
      field("amountCents", "Valor (R$)", "money"),
    ],
  },
  transactions: {
    title: "Financeiro",
    singular: "lançamento",
    description: "Receitas, despesas e vencimentos em uma visão clara.",
    columns: [
      ["description", "Descrição"],
      ["type", "Tipo", "status"],
      ["amountCents", "Valor", "money"],
      ["dueDate", "Vencimento", "date"],
      ["status", "Situação", "status"],
    ],
    fields: [
      field("type", "Tipo", "select", { options: ["income", "expense"] }),
      field("description", "Descrição"),
      field("amountCents", "Valor (R$)", "money"),
      field("dueDate", "Vencimento", "date"),
      field("customerId", "Cliente", "customers", { optional: true }),
      field("orderId", "Pedido", "orders", { optional: true }),
    ],
  },
  documents: {
    title: "Documentos fiscais",
    singular: "documento",
    description: "Organize documentos e registre suas revisões.",
    columns: [
      ["number", "Número"],
      ["kind", "Tipo", "status"],
      ["issuedOn", "Emissão", "date"],
      ["amountCents", "Valor", "money"],
      ["status", "Situação", "status"],
    ],
    fields: [
      field("transactionId", "Lançamento financeiro", "transactions"),
      field("number", "Número do documento"),
      field("kind", "Tipo de documento", "select", {
        options: ["invoice", "receipt", "other"],
      }),
      field("issuedOn", "Data de emissão", "date"),
      field("amountCents", "Valor (R$)", "money"),
    ],
  },
  users: {
    title: "Usuários",
    singular: "usuário",
    description: "Gerencie acessos e responsabilidades da sua equipe.",
    columns: [
      ["name", "Nome"],
      ["email", "E-mail"],
      ["role", "Perfil", "status"],
    ],
    fields: [
      field("name", "Nome"),
      field("email", "E-mail", "email"),
      field("password", "Senha inicial", "password"),
      field("role", "Perfil", "select", {
        options: ["operator", "accountant", "admin"],
      }),
    ],
  },
  audit: {
    title: "Auditoria",
    description: "Consulte os eventos registrados pelo servidor.",
    columns: [
      ["createdAt", "Data", "date"],
      ["actor", "Responsável"],
      ["action", "Ação"],
      ["entity", "Entidade"],
      ["details", "Detalhes"],
    ],
  },
};
