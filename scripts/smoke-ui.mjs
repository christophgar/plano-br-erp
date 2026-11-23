// Teste de navegador: acessa o ERP real local, navega e confere layout sem criar cadastros.
import { chromium, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";

// Usa a conta local sem imprimir senha ou cookies.
const credentials = await readFile(".local/acesso-local.txt", "utf8");
const email = credentials.match(/E-mail: (.+)/)[1].trim();
const password = credentials.match(/Senha: (.+)/)[1].trim();
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "msedge",
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://localhost:5173");
  await expect(
    page.getByRole("button", { name: "Esqueci minha senha", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar no sistema" }).click();
  // A conta local pode ser o administrador geral. Testa a empresa em suporte somente leitura.
  await page.waitForFunction(
    () =>
      document.querySelector(".platform-shell") ||
      document.querySelector(".app-shell"),
  );
  if (await page.locator(".platform-shell").count()) {
    // Não há empresa principal: verifica uma empresa cliente ativa já cadastrada.
    await page
      .getByRole("button", { name: "Acessar para suporte", exact: true })
      .and(page.locator(":enabled"))
      .first()
      .click();
    await page
      .locator("input[name=actionReason]")
      .fill("Verificação local da interface em somente consulta");
    await page.locator("input[name=authorizationPassword]").fill(password);
    await page
      .getByRole("button", { name: "Confirmar operação", exact: true })
      .click();
  }
  await expect(
    page.getByRole("heading", { name: "Olá, Administrador" }),
  ).toBeVisible();
  await expect(page.getByText("Receita bruta", { exact: true })).toBeVisible();
  await mkdir(".local/screenshots", { recursive: true });
  await page.screenshot({
    path: ".local/screenshots/dashboard.png",
    fullPage: true,
  });
  for (const label of [
    "Clientes",
    "Produtos e estoque",
    "Pedidos",
    "Financeiro",
    "Documentos fiscais",
    "Usuários",
    "Auditoria",
    "Configurações",
  ]) {
    await page
      .getByRole("navigation")
      .getByRole("button", { name: label, exact: true })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Carregando informações…")).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  // O último módulo é Configurações: testa confirmação sem trocar a senha de verdade.
  await page
    .locator("input[name=newPassword]")
    .fill("senha-apenas-do-teste-123");
  await page
    .locator("input[name=confirmation]")
    .fill("confirmacao-diferente-123");
  await page.locator("input[name=confirmation]").blur();
  await expect(page.locator("input[name=confirmation]")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page
    .locator("input[name=confirmation]")
    .fill("senha-apenas-do-teste-123");
  await page.locator("input[name=confirmation]").blur();
  await expect(page.locator("input[name=confirmation]")).not.toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Abrir navegação" }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Visão geral" })
    .click();
  await expect(page.getByText("Receita bruta", { exact: true })).toBeVisible();
  // Confere o download real com a sessão do navegador; o arquivo fica privado em .local.
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar Excel" }).click();
  await page.getByRole("button", { name: "Baixar Excel" }).click();
  const download = await downloading;
  if (!/^financeiro-\d{4}-\d{2}\.xlsx$/.test(download.suggestedFilename()))
    throw new Error("Nome de relatório inesperado.");
  await download.saveAs(".local/financial-smoke.xlsx");
  await page.screenshot({
    path: ".local/screenshots/mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error("Layout excede a largura da tela.");
  await page.getByRole("button", { name: "Abrir navegação" }).click();
  await page.getByRole("button", { name: "Sair da conta" }).click();
  await expect(
    page.getByRole("button", { name: "Entrar no sistema" }),
  ).toBeVisible();
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "Interface: login, oito módulos, validação de senha, Excel, mobile e logout validados.",
  );
} finally {
  await browser.close();
}
