// Fluxo completo no navegador com banco próprio erp_ui_test. Não altera o banco usado no ERP.
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import pg from "pg";
import { chromium, expect } from "@playwright/test";
import { migrate } from "../server/migrate.js";
import { createApp } from "../server/app.js";
import { hashPassword } from "../server/security.js";

const url = new URL(process.env.DATABASE_URL);
if (!["127.0.0.1", "localhost"].includes(url.hostname))
  throw new Error("Este teste usa somente banco local isolado.");
url.pathname = "/postgres";
const admin = new pg.Client({ connectionString: url.toString() });
await admin.connect();
if (
  !(await admin.query("SELECT 1 FROM pg_database WHERE datname='erp_ui_test'"))
    .rowCount
)
  await admin.query("CREATE DATABASE erp_ui_test");
await admin.end();
url.pathname = "/erp_ui_test";
const pool = new pg.Pool({ connectionString: url.toString() });
const password = randomBytes(24).toString("base64url");
let server, browser;
try {
  await migrate(pool);
  await pool.query(
    "TRUNCATE business_settings,audit_events,documents,transactions,order_items,orders,stock_movements,products,customers,sessions,users RESTART IDENTITY CASCADE",
  );
  await pool.query("INSERT INTO business_settings(id) VALUES(1)");
  await pool.query(
    "DELETE FROM companies WHERE id<>'00000000-0000-4000-8000-000000000001'",
  );
  await pool.query(
    "INSERT INTO users(name,email,password_hash,role) VALUES('Administrador de teste','ui@example.test',$1,'admin')",
    [await hashPassword(password)],
  );
  const config = {
    production: false,
    trustProxy: 0,
    cookieName: "erp_ui_session",
    jwtSecret: randomBytes(64).toString("hex"),
    appOrigin: "",
  };
  const app = createApp(pool, config);
  server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  config.appOrigin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(config.appOrigin);
  await page.locator("input[name=email]").fill("ui@example.test");
  await page.locator("input[name=password]").fill(password);
  await page.getByRole("button", { name: "Entrar no sistema" }).click();
  const nav = (name) =>
    page
      .getByRole("navigation")
      .getByRole("button", { name, exact: true })
      .click();
  await nav("Clientes");
  await page.getByRole("button", { name: "Novo cliente", exact: true }).click();
  // Simula o fornecedor para testar conferência sem depender da internet nem cadastrar empresa real.
  await page.route("**/api/company-lookup/*", (route) =>
    route.fulfill({
      json: {
        source: "OpenCNPJ",
        taxId: "00000000000191",
        suggestedRegime: "simples_nacional",
        fields: {
          name: "Empresa de consulta fictícia",
          street: "Rua importada",
          city: "Brasília",
          state: "DF",
        },
      },
    }),
  );
  await page.locator("select[name=personType]").selectOption("PJ");
  await page.locator("input[name=taxId]").fill("00000000000191");
  await page
    .getByRole("button", { name: "Consultar CNPJ", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Confira os dados encontrados" }),
  ).toBeVisible();
  await expect(page.locator("input[name=name]")).toHaveValue("");
  await page
    .getByRole("button", { name: "Confirmar e preencher cadastro" })
    .click();
  await expect(page.locator("input[name=name]")).toHaveValue(
    "Empresa de consulta fictícia",
  );
  await expect(page.locator("select[name=state]")).toHaveValue("DF");
  await expect(page.locator("select[name=taxRegime]")).toHaveValue(
    "simples_nacional",
  );
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.unroute("**/api/company-lookup/*");
  await page.getByRole("button", { name: "Novo cliente", exact: true }).click();
  for (const [field, value] of Object.entries({
    name: "Cliente fictício do teste",
    taxId: "12345678909",
    postalCode: "12345678",
    street: "Rua fictícia",
    addressNumber: "10",
    district: "Centro",
    city: "Cidade de Teste",
  }))
    await page.locator(`input[name=${field}]`).fill(value);
  await page.locator("select[name=state]").selectOption("SC");
  await mkdir(".local/screenshots", { recursive: true });
  await page.screenshot({
    path: ".local/screenshots/cadastro-completo.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Novo cliente", exact: true }).click();
  await page.locator("input[name=taxId]").fill("12345678909");
  await expect(
    page.getByText(
      "Este CPF/CNPJ já está cadastrado na sua empresa. Use o cadastro existente.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Salvar", exact: true }),
  ).toBeDisabled();
  await page.locator("input[name=taxId]").fill("52998224725");
  await expect(
    page.getByRole("button", { name: "Salvar", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Anonimizar", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Exportar", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await page.locator("input[name=email]").fill("depois@example.test");
  await page.locator("input[name=street]").fill("Rua atualizada");
  await page.locator("input[name=reason]").fill("curto");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.locator("input[name=reason]")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page
    .locator("input[name=reason]")
    .fill("Atualização de contato e endereço solicitada pelo cliente");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await nav("Produtos e estoque");
  await page.getByRole("button", { name: "Novo produto", exact: true }).click();
  for (const [field, value] of Object.entries({
    name: "Produto de teste",
    sku: "UI-ITEM",
    quantity: "5",
    unitPriceCents: "50",
  }))
    await page.locator(`input[name=${field}]`).fill(value);
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await nav("Pedidos");
  await page.getByRole("button", { name: "Novo pedido", exact: true }).click();
  await page
    .locator("select[name=customerId]")
    .selectOption({ label: "Cliente fictício do teste" });
  await page
    .locator("input[name=description]")
    .fill("Pedido completo de teste");
  await page.locator(".order-item select").selectOption({ index: 1 });
  await page.locator(".order-item input").fill("2");
  await page.screenshot({
    path: ".local/screenshots/pedido-itens.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Salvar pedido", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  assertStock: {
    const result = await pool.query(
      "SELECT quantity FROM products WHERE sku='UI-ITEM'",
    );
    if (result.rows[0].quantity !== 3)
      throw new Error("Baixa de estoque incorreta.");
  }
  await page
    .getByRole("button", { name: "Adicionar nota fiscal", exact: true })
    .click();
  await page.locator("input[name=number]").fill("NF-UI-1");
  await page.getByRole("button", { name: "Vincular nota fiscal" }).click();
  await expect(page.getByText("Número NF-UI-1")).toBeVisible();
  await page.getByRole("button", { name: "Fechar janela" }).click();
  await nav("Financeiro");
  await page
    .getByRole("button", { name: "Alterar situação", exact: true })
    .click();
  await page.locator("select[name=status]").selectOption("paid");
  await page
    .locator("input[name=reason]")
    .fill("Recebimento confirmado no extrato da empresa");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await nav("Visão geral");
  await page
    .getByRole("button", { name: "Configurar impostos e custos" })
    .click();
  const taxInput = page.locator("input[name=taxRate]");
  await taxInput.fill("0,00");
  await taxInput.press("End");
  await taxInput.pressSequentially("1");
  await expect(taxInput).toHaveValue("0,01");
  await taxInput.pressSequentially("00");
  await expect(taxInput).toHaveValue("1,00");
  await taxInput.press("Backspace");
  await expect(taxInput).toHaveValue("0,10");
  await taxInput.fill("625");
  await expect(taxInput).toHaveValue("6,25");
  await page.locator("input[name=operatingCosts]").fill("2000");
  await page
    .locator("input[name=reason]")
    .fill("Revisão dos impostos e custos informados pelo contador");
  await page.getByRole("button", { name: "Salvar configuração" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".metric.balance strong")).toHaveText(/73,75/);
  await page.getByRole("button", { name: "Exportar Excel" }).click();
  await page.getByLabel("Tipo de período").selectOption("year");
  await page.screenshot({
    path: ".local/screenshots/exportacao-periodo.png",
    fullPage: true,
  });
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar Excel" }).click();
  const download = await downloading;
  await download.saveAs(".local/workflow-anual.xlsx");
  if (!/_a_\d{4}-12\.xlsx$/.test(download.suggestedFilename()))
    throw new Error("O relatório anual não usou o intervalo.");
  await nav("Auditoria");
  const updated = page.getByRole("row").filter({
    has: page.getByRole("cell", { name: "Cadastro atualizado", exact: true }),
  });
  await updated
    .getByRole("button", { name: "Ver alterações", exact: true })
    .click();
  const diff = page
    .getByRole("dialog")
    .getByRole("region", { name: "Campos alterados" });
  const addressChange = diff.getByRole("row").filter({
    has: page.getByRole("cell", { name: "Logradouro", exact: true }),
  });
  await expect(addressChange).toContainText("Rua fictícia");
  await expect(addressChange).toContainText("Rua atualizada");
  await expect(
    diff.getByRole("cell", { name: "depois@example.test", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText(
    "Atualização de contato e endereço solicitada pelo cliente",
  );
  await page.screenshot({
    path: ".local/screenshots/auditoria-antes-depois.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Desfazer alteração", exact: true })
    .click();
  await page.getByRole("dialog").locator("input[name=reason]").fill("curto");
  await page
    .getByRole("button", { name: "Confirmar e desfazer", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page
    .getByRole("dialog")
    .locator("input[name=reason]")
    .fill("Reversão autorizada após revisão do cadastro");
  await page.screenshot({
    path: ".local/screenshots/reversao-administrativa.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Confirmar e desfazer", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("cell", {
      name: "Alteração desfeita pelo administrador",
      exact: true,
    }),
  ).toBeVisible();
  const restoredCustomer = (
    await pool.query(
      "SELECT street,email FROM customers WHERE tax_id='12345678909'",
    )
  ).rows[0];
  if (
    restoredCustomer.street !== "Rua fictícia" ||
    restoredCustomer.email !== null
  )
    throw new Error(
      "A reversão não restaurou os valores anteriores do cadastro.",
    );
  await expect(
    page
      .getByRole("cell", { name: "Administrador de teste", exact: true })
      .first(),
  ).toBeVisible();
  await expect(
    page
      .getByRole("cell", {
        name: "Relatório financeiro exportado",
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await page.screenshot({
    path: ".local/screenshots/auditoria-legivel.png",
    fullPage: true,
  });
  // Confirma a edição de acesso pelo novo formulário com motivo obrigatório.
  await pool.query(
    "INSERT INTO users(name,email,password_hash,role) VALUES('Operador secundário de teste','operator-ui@example.test',$1,'operator')",
    [await hashPassword(password)],
  );
  await nav("Usuários");
  await page
    .getByRole("row")
    .filter({
      has: page.getByRole("cell", {
        name: "Operador secundário de teste",
        exact: true,
      }),
    })
    .getByRole("button", { name: "Desativar acesso", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Desativar acesso do usuário",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .locator("input[name=reason]")
    .fill("Desativação de acesso autorizada no teste");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  if (
    (
      await pool.query(
        "SELECT active FROM users WHERE email='operator-ui@example.test'",
      )
    ).rows[0].active
  )
    throw new Error("A alteração de acesso com motivo não foi salva.");
  await nav("Configurações");
  const spacing = await page.evaluate(
    () =>
      document.querySelector(".password-submit").getBoundingClientRect().top -
      document.querySelector("input[name=confirmation]").getBoundingClientRect()
        .bottom,
  );
  if (spacing < 20) throw new Error("Espaçamento da senha insuficiente.");
  if (
    (await page.locator("body").innerText()).toLowerCase().includes("protótipo")
  )
    throw new Error("Texto de protótipo ainda visível.");
  await expect(
    page.getByRole("heading", { name: "Dados a serviço da gestão" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: ".local/screenshots/conta-simplificada.png",
    fullPage: true,
  });
  // Promove somente a conta fictícia do banco isolado para validar o painel geral.
  await pool.query(
    "UPDATE users SET is_platform_admin=true,company_id=NULL WHERE email='ui@example.test'",
  );
  await page
    .getByRole("button", { name: "Sair da conta", exact: true })
    .click();
  await page.locator("input[name=email]").fill("ui@example.test");
  await page.locator("input[name=password]").fill(password);
  await page.getByRole("button", { name: "Entrar no sistema" }).click();
  await expect(
    page.getByRole("heading", { name: "Administração geral", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Nova empresa", exact: true }).click();
  for (const [name, value] of Object.entries({
    name: "Empresa de teste da plataforma",
    taxId: "00000000000191",
    adminName: "Gestor da empresa",
    adminEmail: "tenant@example.test",
    adminPassword: password,
    confirmAdminPassword: password,
    actionReason: "Cadastro fictício para teste completo",
    authorizationPassword: password,
  }))
    await page.locator(`input[name=${name}]`).fill(value);
  await page
    .getByRole("button", { name: "Confirmar operação", exact: true })
    .click();
  const companyCard = page.getByRole("article").filter({
    has: page.getByRole("heading", {
      name: "Empresa de teste da plataforma",
      exact: true,
    }),
  });
  await expect(companyCard).toBeVisible();
  await companyCard
    .getByRole("button", { name: "Ver auditoria", exact: true })
    .click();
  const companyAudit = page.getByRole("region", {
    name: "Auditoria selecionada",
  });
  await expect(
    companyAudit.getByRole("heading", {
      name: "Auditoria — Empresa de teste da plataforma",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    companyAudit.getByRole("cell", { name: "Empresa cadastrada", exact: true }),
  ).toBeVisible();
  await expect(
    companyAudit.getByRole("cell", {
      name: "Entrada na administração geral",
      exact: true,
    }),
  ).toHaveCount(0);
  await companyAudit
    .getByLabel("Data inicial", { exact: true })
    .fill("1900-01-01");
  await companyAudit
    .getByLabel("Data final", { exact: true })
    .fill("1900-01-01");
  await companyAudit
    .getByRole("button", { name: "Buscar por data", exact: true })
    .click();
  await expect(
    companyAudit.getByRole("cell", {
      name: "Nenhum evento neste histórico.",
      exact: true,
    }),
  ).toBeVisible();
  await companyAudit
    .getByRole("button", { name: "Limpar filtro", exact: true })
    .click();
  await expect(
    companyAudit.getByRole("cell", { name: "Empresa cadastrada", exact: true }),
  ).toBeVisible();
  await companyAudit.getByRole("button", { name: "Fechar auditoria" }).click();
  await page
    .getByRole("button", { name: "Auditoria da plataforma", exact: true })
    .click();
  await expect(
    companyAudit.getByRole("cell", {
      name: "Entrada na administração geral",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    companyAudit.getByRole("cell", { name: "Empresa cadastrada", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: ".local/screenshots/administracao-geral.png",
    fullPage: true,
  });
  await companyCard
    .getByRole("button", { name: "Acessar para suporte" })
    .click();
  await page
    .locator("input[name=actionReason]")
    .fill("Conferência autorizada em somente leitura");
  const authorization = page.locator("input[name=authorizationPassword]");
  await expect(authorization).toHaveValue("");
  await expect(authorization).toHaveAttribute("autocomplete", "new-password");
  await expect(authorization).toHaveAttribute("data-lpignore", "true");
  await authorization.fill(password);
  // Cancelar e reabrir o mesmo atendimento também deve limpar a confirmação.
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await companyCard
    .getByRole("button", { name: "Acessar para suporte" })
    .click();
  await expect(authorization).toHaveValue("");
  await expect(page.locator("input[name=actionReason]")).toHaveValue("");
  await page
    .locator("input[name=actionReason]")
    .fill("Conferência autorizada em somente leitura");
  await authorization.fill(password);
  await page
    .getByRole("button", { name: "Confirmar operação", exact: true })
    .click();
  await expect(page.locator(".support-banner")).toContainText(
    "Somente consulta",
  );
  await nav("Clientes");
  await expect(
    page.getByText("Cliente fictício do teste", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: ".local/screenshots/suporte-temporario.png",
    fullPage: true,
  });
  await page
    .getByRole("button", {
      name: "Encerrar suporte e voltar à administração geral",
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Administração geral", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("article")
    .filter({
      has: page.getByRole("heading", {
        name: "Empresa de teste da plataforma",
        exact: true,
      }),
    })
    .getByRole("button", { name: "Ver auditoria", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Auditoria selecionada" })
      .getByRole("cell", { name: "Suporte encerrado", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: ".local/screenshots/administracao-mobile.png",
    fullPage: true,
  });
  if (
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    )
  )
    throw new Error("Administração geral ultrapassou a largura do celular.");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "Fluxo completo: cliente fiscal, itens/estoque, nota, receita, líquido, exportação anual, auditoria e senha OK em banco isolado.",
  );
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end();
}
