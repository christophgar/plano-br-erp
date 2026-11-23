import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import request from "supertest";
import pg from "pg";
import { unzipSync, strFromU8 } from "fflate";
import { migrate } from "../migrate.js";
import { createApp } from "../app.js";
import { hashPassword, safeEqual } from "../security.js";
import { financialSummary, loadFinancialReport } from "../finance.js";
import { tenantPool, withCompany } from "../tenant-db.js";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !new URL(connectionString).pathname.endsWith("_test"))
  throw new Error(
    "Use npm run test:db ou TEST_DATABASE_URL com banco terminado em _test. Nunca use o banco real.",
  );
const pool = new pg.Pool({ connectionString });
const origin = "http://localhost:5173";
const secret = randomBytes(64).toString("hex");
const config = {
  production: false,
  jwtSecret: secret,
  appOrigin: origin,
  cookieName: "erp_session",
  trustProxy: 0,
};
const app = createApp(pool, config);
const password = randomBytes(20).toString("base64url");
let admin, operator, accountant;
const clients = [];
let customerSequence = 0;
function customerFixture(data) {
  let cpf = "12345" + String(++customerSequence).padStart(4, "0");
  for (const length of [9, 10]) {
    const sum = [...cpf].reduce(
      (total, char, index) => total + Number(char) * (length + 1 - index),
      0,
    );
    const digit = (sum * 10) % 11;
    cpf += digit === 10 ? 0 : digit;
  }
  return {
    personType: "PF",
    taxId: cpf,
    taxRegime: "not_applicable",
    postalCode: "12345678",
    street: "Rua de Teste",
    addressNumber: "10",
    district: "Centro",
    city: "Cidade de Teste",
    state: "SC",
    ...data,
  };
}
const mutation = (session, method, path, data) => {
  // Os cenários existentes informam um motivo padrão; casos inválidos usam chamadas diretas abaixo.
  const editing =
    !path.startsWith("/platform/") &&
    ((method === "patch" &&
      (/^\/customers\/[\da-f-]+$/.test(path) ||
        /\/(status|active)$/.test(path))) ||
      (method === "put" && path === "/business-settings") ||
      (method === "post" && /^\/products\/[^/]+\/stock$/.test(path)));
  const values =
    (method === "post" && path === "/customers") ||
    (method === "patch" && /^\/customers\/[\da-f-]+$/.test(path))
      ? customerFixture(data)
      : data;
  return session.agent[method]("/api" + path)
    .set("Origin", origin)
    .set("X-CSRF-Token", session.csrfToken)
    .send(
      editing
        ? { reason: "Atualização justificada no cenário de teste", ...values }
        : values,
    );
};
async function login(email) {
  const agent = request.agent(app);
  const result = await agent
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({ email, password });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.match(result.headers["set-cookie"][0], /HttpOnly/);
  assert.match(result.headers["set-cookie"][0], /SameSite=Strict/);
  const session = { agent, ...result.body };
  clients.push(session);
  return session;
}
before(async () => {
  await migrate(pool);
  // Somente o banco de testes explicitamente identificado é esvaziado.
  await pool.query(
    "TRUNCATE business_settings,audit_events,documents,transactions,order_items,orders,stock_movements,products,customers,sessions,users RESTART IDENTITY CASCADE",
  );
  await pool.query("INSERT INTO business_settings(id) VALUES(1)");
  await pool.query(
    "DELETE FROM companies WHERE id<>'00000000-0000-4000-8000-000000000001'",
  );
  const hash = await hashPassword(password);
  for (const role of ["admin", "operator", "accountant"])
    await pool.query(
      "INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4)",
      [role, `${role}@erp.test`, hash, role],
    );
  admin = await login("admin@erp.test");
  operator = await login("operator@erp.test");
  accountant = await login("accountant@erp.test");
});
after(async () => {
  await pool.end();
});

test("comparação de tokens rejeita bytes e tamanhos diferentes sem erro", () => {
  assert.equal(safeEqual("é", "a"), false);
  assert.equal(safeEqual(undefined, "a"), false);
  assert.equal(safeEqual("token", "token"), true);
});

test("datas civis não sofrem conversão de fuso", async () => {
  assert.equal(
    (await pool.query("SELECT DATE '2026-07-01' AS value")).rows[0].value,
    "2026-07-01",
  );
});

test("rotas privadas, CSRF, origem e validação", async () => {
  assert.equal((await request(app).get("/api/customers")).status, 401);
  assert.equal(
    (
      await admin.agent
        .post("/api/customers")
        .set("Origin", origin)
        .send({ name: "Teste" })
    ).status,
    403,
  );
  assert.equal(
    (
      await admin.agent
        .post("/api/customers")
        .set("Origin", "https://evil.test")
        .set("X-CSRF-Token", admin.csrfToken)
        .send({ name: "Teste" })
    ).status,
    403,
  );
  assert.equal(
    (
      await mutation(admin, "post", "/customers", {
        name: "Teste",
        role: "admin",
      })
    ).status,
    400,
  );
  assert.equal(
    (await admin.agent.get("/api/customers?limit=10000")).status,
    400,
  );
  const response = await admin.agent.get("/api/customers");
  assert.match(response.headers["cache-control"], /no-store/);
  assert.ok(response.headers["content-security-policy"]);
});
test("perfil operador não acessa financeiro, fiscal ou usuários", async () => {
  for (const path of [
    "/transactions",
    "/documents",
    "/users",
    "/audit",
    "/dashboard",
  ])
    assert.equal((await operator.agent.get("/api" + path)).status, 403);
  assert.equal(
    (
      await mutation(operator, "post", "/users", {
        name: "Invasor",
        email: "bad@erp.test",
        password,
        role: "admin",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await mutation(accountant, "post", "/products", {
        name: "Teste",
        sku: "NO",
        quantity: 1,
        unitPriceCents: 1,
      })
    ).status,
    403,
  );
});
test("fluxo cliente → ordem → receita → documento → conferência e painel", async () => {
  const customer = await mutation(admin, "post", "/customers", {
    name: "Cliente Fictício",
    email: "cliente@example.test",
  });
  assert.equal(customer.status, 201);
  const itemProduct = await mutation(operator, "post", "/products", {
    name: "Item do pedido de teste",
    sku: "ORDER-ITEM",
    quantity: 3,
    unitPriceCents: 15000,
  });
  const order = await mutation(operator, "post", "/orders", {
    customerId: customer.body.id,
    description: "Serviço de teste",
    items: [{ productId: itemProduct.body.id, quantity: 1 }],
  });
  assert.equal(order.status, 201);
  const tx = await mutation(accountant, "post", "/transactions", {
    type: "income",
    description: "Receita de teste",
    amountCents: 15000,
    dueDate: "2026-10-21",
    orderId: order.body.id,
  });
  assert.equal(tx.status, 201);
  assert.equal(tx.body.customerId, customer.body.id);
  assert.equal(
    (
      await mutation(admin, "post", "/transactions", {
        type: "income",
        description: "Duplicada",
        amountCents: 15000,
        dueDate: "2026-10-21",
        orderId: order.body.id,
      })
    ).status,
    409,
  );
  const doc = await mutation(accountant, "post", "/documents", {
    transactionId: tx.body.id,
    number: "TEST-1",
    kind: "invoice",
    issuedOn: "2026-10-21",
    amountCents: 15000,
  });
  assert.equal(doc.status, 201);
  assert.equal(
    (
      await mutation(accountant, "patch", `/documents/${doc.body.id}/status`, {
        status: "reviewed",
        reason: "Conferência do caso de teste",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await mutation(
        accountant,
        "patch",
        `/transactions/${tx.body.id}/status`,
        { status: "paid" },
      )
    ).status,
    200,
  );
  const dashboard = await admin.agent.get("/api/dashboard");
  assert.equal(dashboard.body.income, 15000);
  assert.equal(dashboard.body.balance, 15000);
  assert.equal(dashboard.body.pendingDocuments, 0);
  assert.equal(
    (
      await mutation(operator, "patch", `/orders/${order.body.id}/status`, {
        status: "cancelled",
      })
    ).status,
    409,
  );
  const exported = await admin.agent.get(
    `/api/customers/${customer.body.id}/export`,
  );
  assert.equal(exported.body.orders.length, 1);
  assert.equal(exported.body.documents.length, 1);
  assert.equal(
    (
      await mutation(
        admin,
        "post",
        `/customers/${customer.body.id}/anonymize`,
        { reason: "Solicitação de teste" },
      )
    ).status,
    409,
  );
});
test("divergência documental não pode ser marcada como conferida", async () => {
  const tx = await mutation(admin, "post", "/transactions", {
    type: "expense",
    description: "Despesa teste",
    amountCents: 1000,
    dueDate: "2026-10-21",
  });
  const doc = await mutation(admin, "post", "/documents", {
    transactionId: tx.body.id,
    number: "TEST-2",
    kind: "receipt",
    issuedOn: "2026-10-21",
    amountCents: 2000,
  });
  assert.equal(
    (
      await mutation(admin, "patch", `/documents/${doc.body.id}/status`, {
        status: "reviewed",
        reason: "Teste de divergência",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await mutation(admin, "post", "/transactions", {
        type: "expense",
        description: "Inválida",
        amountCents: 1.5,
        dueDate: "2026-02-30",
      })
    ).status,
    400,
  );
});
test("estoque não fica negativo em movimentações concorrentes", async () => {
  const product = await mutation(operator, "post", "/products", {
    name: "Produto teste",
    sku: "TEST-1",
    quantity: 5,
    unitPriceCents: 100,
  });
  const results = await Promise.all(
    [1, 2].map(() =>
      mutation(operator, "post", `/products/${product.body.id}/stock`, {
        delta: -4,
        reason: "Teste concorrente",
      }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const row = await pool.query("SELECT quantity FROM products WHERE id=$1", [
    product.body.id,
  ]);
  assert.equal(row.rows[0].quantity, 1);
});
test("SQL é parametrizado e remoção de contato exige administrador", async () => {
  const name = "Teste'); DROP TABLE users; --";
  const customer = await mutation(admin, "post", "/customers", {
    name,
    email: "remover@example.test",
    phone: "(49) 99999-9999",
  });
  assert.equal(customer.status, 201);
  assert.equal(customer.body.name, name);
  assert.equal(
    (
      await mutation(
        operator,
        "post",
        `/customers/${customer.body.id}/anonymize`,
        { reason: "Teste" },
      )
    ).status,
    403,
  );
  const result = await mutation(
    admin,
    "post",
    `/customers/${customer.body.id}/anonymize`,
    { reason: "Solicitação de exclusão validada" },
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.email, null);
  assert.equal(result.body.name, "Cadastro removido");
  assert.equal(
    (
      await mutation(admin, "patch", `/customers/${customer.body.id}`, {
        name: "Reverter",
      })
    ).status,
    404,
  );
  const audit = await admin.agent.get("/api/audit");
  assert.ok(audit.body.items.length > 0);
  assert.ok(!JSON.stringify(audit.body).includes(password));
});
test("logout revoga o JWT e não apenas apaga o cookie", async () => {
  const fresh = await login("admin@erp.test");
  const sessionId = (
    await pool.query(
      "SELECT id FROM sessions WHERE user_id=$1 ORDER BY expires_at DESC LIMIT 1",
      [fresh.user.id],
    )
  ).rows[0].id;
  const { signToken } = await import("../security.js");
  const saved = signToken(fresh.user.id, sessionId, secret);
  assert.equal((await mutation(fresh, "post", "/auth/logout", {})).status, 200);
  assert.equal(
    (
      await request(app)
        .get("/api/auth/me")
        .set("Cookie", `erp_session=${saved}`)
    ).status,
    401,
  );
});
test("estimativa usa arredondamento em centavos e permite resultado negativo", () => {
  assert.deepEqual(
    financialSummary(1, 0, {
      taxRateBasisPoints: 5000,
      monthlyOperatingCostsCents: null,
    }),
    { estimatedTax: 1, operatingCosts: 0, netRevenue: 0, netIncome: 0 },
  );
  assert.equal(
    financialSummary(10000, 2000, {
      taxRateBasisPoints: 10000,
      monthlyOperatingCostsCents: 3000,
    }).netIncome,
    -5000,
  );
  assert.equal(
    financialSummary(0, 0, {
      taxRateBasisPoints: 0,
      monthlyOperatingCostsCents: null,
    }).netIncome,
    0,
  );
});

test("alíquota e custos persistem; painel filtra mês e não repete despesas", async () => {
  assert.equal(
    (await operator.agent.get("/api/business-settings")).status,
    403,
  );
  assert.equal(
    (
      await mutation(operator, "put", "/business-settings", {
        taxRateBasisPoints: 625,
        monthlyOperatingCostsCents: 2000,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await admin.agent
        .put("/api/business-settings")
        .set("Origin", origin)
        .send({ taxRateBasisPoints: 625, monthlyOperatingCostsCents: 2000 })
    ).status,
    403,
  );
  for (const data of [
    { taxRateBasisPoints: -1, monthlyOperatingCostsCents: null },
    { taxRateBasisPoints: 10001, monthlyOperatingCostsCents: null },
    { taxRateBasisPoints: 625.5, monthlyOperatingCostsCents: null },
    { taxRateBasisPoints: 625, monthlyOperatingCostsCents: -1 },
  ])
    assert.equal(
      (await mutation(admin, "put", "/business-settings", data)).status,
      400,
    );
  const fixtures = [];
  try {
    const changed = await mutation(accountant, "put", "/business-settings", {
      taxRateBasisPoints: 625,
      monthlyOperatingCostsCents: 2000,
    });
    assert.equal(changed.status, 200);
    const loaded = await admin.agent.get("/api/business-settings");
    assert.equal(loaded.body.taxRateBasisPoints, 625);
    assert.equal(loaded.body.monthlyOperatingCostsCents, 2000);
    for (const [type, amount, paidAt, status] of [
      ["income", 99999, "2026-07-01T02:59:59Z", "paid"],
      ["income", 10000, "2026-07-01T03:00:00Z", "paid"],
      ["income", 1, "2026-08-01T02:59:59Z", "paid"],
      ["income", 99999, "2026-08-01T03:00:00Z", "paid"],
      ["expense", 1000, "2026-07-15T12:00:00Z", "paid"],
      ["income", 99999, null, "pending"],
      ["income", 99999, "2026-07-15T12:00:00Z", "cancelled"],
    ]) {
      const row = await pool.query(
        `INSERT INTO transactions(type,description,amount_cents,due_date,status,paid_at)
        VALUES($1,'Cenário fiscal mensal de teste',$2,'2026-07-01',$3,$4) RETURNING id`,
        [type, amount, status, paidAt],
      );
      fixtures.push(row.rows[0].id);
    }
    const result = await admin.agent.get("/api/dashboard?month=2026-07");
    assert.equal(result.status, 200);
    assert.equal(result.body.income, 10001);
    assert.equal(result.body.expenses, 1000);
    assert.equal(result.body.estimatedTax, 625);
    assert.equal(result.body.operatingCosts, 2000);
    assert.equal(result.body.netRevenue, 9376);
    assert.equal(result.body.netIncome, 6376);
    // O download precisa corresponder ao mesmo mês/valores e conter gráficos nativos.
    assert.equal(
      (await request(app).get("/api/reports/financial.xlsx?month=2026-07"))
        .status,
      401,
    );
    assert.equal(
      (await operator.agent.get("/api/reports/financial.xlsx?month=2026-07"))
        .status,
      403,
    );
    assert.equal(
      (await admin.agent.get("/api/reports/financial.xlsx?month=2026-13"))
        .status,
      400,
    );
    const exported = await admin.agent
      .get("/api/reports/financial.xlsx?month=2026-07")
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    assert.equal(exported.status, 200);
    assert.equal(exported.headers["cache-control"], "no-store");
    assert.match(
      exported.headers["content-disposition"],
      /financeiro-2026-07.xlsx/,
    );
    const workbook = unzipSync(exported.body);
    const xml = strFromU8(workbook["xl/worksheets/sheet1.xml"]);
    assert.match(xml, /r="C12"[^>]*><x:f>C9-C10-C11<\/x:f><x:v>63.76<\/x:v>/);
    assert.equal(
      Object.keys(workbook).filter((name) =>
        /charts\/chart\d+\.xml$/.test(name),
      ).length,
      2,
    );
    assert.match(
      strFromU8(workbook["xl/drawings/charts/chart1.xml"]),
      /<c:v>63.76<\/c:v>/,
    );
    assert.equal(
      (await admin.agent.get("/api/dashboard?month=2026-13")).status,
      400,
    );
    assert.equal(
      (await admin.agent.get("/api/dashboard?month=2026-07&unknown=1")).status,
      400,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*) FROM audit_events WHERE action='financial_settings_updated'",
        )
      ).rows[0].count,
      "1",
    );
    await mutation(admin, "put", "/business-settings", {
      taxRateBasisPoints: 0,
      monthlyOperatingCostsCents: null,
    });
    const noCost = await admin.agent.get("/api/dashboard?month=2026-07");
    assert.equal(noCost.body.estimatedTax, 0);
    assert.equal(noCost.body.operatingCosts, 0);
    assert.equal(noCost.body.netIncome, 9001);
  } finally {
    await pool.query("DELETE FROM transactions WHERE id=ANY($1::uuid[])", [
      fixtures,
    ]);
    await pool.query(
      "UPDATE business_settings SET tax_rate_basis_points=0,monthly_operating_costs_cents=NULL WHERE id=1",
    );
  }
});

test("cadastro PF/PJ valida documento, evita duplicação e remove todos os dados pessoais", async () => {
  const payload = customerFixture({
    name: "Empresa de teste",
    personType: "PJ",
    taxId: "12ABC34501DE35",
    taxRegime: "simples_nacional",
    tradeName: "Teste",
    stateRegistration: "ISENTO",
  });
  const pj = await mutation(admin, "post", "/customers", payload);
  assert.equal(pj.status, 201);
  assert.equal(pj.body.taxId, "12ABC34501DE35");
  assert.equal(pj.body.city, "Cidade de Teste");
  assert.equal(
    (await mutation(admin, "post", "/customers", payload)).status,
    409,
  );
  assert.equal(
    (
      await mutation(admin, "post", "/customers", {
        ...payload,
        taxId: "12ABC34501DE36",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await mutation(admin, "post", "/customers", {
        ...payload,
        taxRegime: "not_applicable",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await mutation(admin, "post", "/customers", {
        ...payload,
        postalCode: "abc12345678",
      })
    ).status,
    400,
  );
  const exported = await admin.agent.get(`/api/customers/${pj.body.id}/export`);
  assert.equal(exported.body.customer.taxId, payload.taxId);
  const removed = await mutation(
    admin,
    "post",
    `/customers/${pj.body.id}/anonymize`,
    { reason: "Remoção do cenário de teste" },
  );
  assert.equal(removed.status, 200);
  for (const key of [
    "taxId",
    "street",
    "postalCode",
    "city",
    "stateRegistration",
    "tradeName",
  ])
    assert.equal(removed.body[key], null);
});

test("pedidos baixam estoque sem concorrência negativa e nota cria receita pendente", async () => {
  const customer = await mutation(admin, "post", "/customers", {
    name: "Cliente dos itens",
  });
  const product = await mutation(operator, "post", "/products", {
    name: "Produto com itens",
    sku: "ITEMS-TEST",
    quantity: 5,
    unitPriceCents: 2000,
  });
  const draft = {
    customerId: customer.body.id,
    description: "Pedido por itens",
    items: [{ productId: product.body.id, quantity: 4 }],
  };
  const results = await Promise.all([
    mutation(admin, "post", "/orders", draft),
    mutation(operator, "post", "/orders", draft),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const order = results.find((r) => r.status === 201).body;
  assert.equal(order.amountCents, 8000);
  assert.equal(
    (
      await pool.query("SELECT quantity FROM products WHERE id=$1", [
        product.body.id,
      ])
    ).rows[0].quantity,
    1,
  );
  const details = await operator.agent.get(`/api/orders/${order.id}`);
  assert.equal(details.body.items[0].quantity, 4);
  assert.equal(
    (
      await mutation(operator, "post", `/orders/${order.id}/document`, {
        number: "NF-ITEMS",
        issuedOn: "2026-10-21",
        dueDate: "2026-10-30",
      })
    ).status,
    403,
  );
  const note = await mutation(
    accountant,
    "post",
    `/orders/${order.id}/document`,
    { number: "NF-ITEMS", issuedOn: "2026-10-21", dueDate: "2026-10-30" },
  );
  assert.equal(note.status, 201);
  assert.equal(note.body.amountCents, 8000);
  const tx = (
    await pool.query("SELECT * FROM transactions WHERE order_id=$1", [order.id])
  ).rows[0];
  assert.equal(tx.status, "pending");
  assert.equal(
    (
      await mutation(admin, "post", `/orders/${order.id}/document`, {
        number: "NF-ITEMS-2",
        issuedOn: "2026-10-21",
        dueDate: "2026-10-30",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await mutation(admin, "patch", `/orders/${order.id}/status`, {
        status: "cancelled",
      })
    ).status,
    409,
  );
  await mutation(admin, "patch", `/transactions/${tx.id}/status`, {
    status: "cancelled",
  });
  assert.equal(
    (
      await mutation(admin, "patch", `/orders/${order.id}/status`, {
        status: "cancelled",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await pool.query("SELECT quantity FROM products WHERE id=$1", [
        product.body.id,
      ])
    ).rows[0].quantity,
    5,
  );
  assert.equal(
    (
      await mutation(admin, "patch", `/orders/${order.id}/status`, {
        status: "cancelled",
      })
    ).status,
    409,
  );
  const events = (await admin.agent.get("/api/audit")).body.items;
  assert.ok(
    events.some(
      (event) =>
        event.actorName === "accountant" && event.entity === "document",
    ),
  );
  assert.ok(events.every((event) => !("passwordHash" in event)));
});

test("relatório anual usa intervalo, custo mensal por mês e rejeita períodos inválidos", async () => {
  await mutation(admin, "put", "/business-settings", {
    taxRateBasisPoints: 625,
    monthlyOperatingCostsCents: 10000,
  });
  try {
    const year = (await admin.agent.get("/api/dashboard")).body.month.slice(
      0,
      4,
    );
    const report = await loadFinancialReport(pool, `${year}-01`, `${year}-12`);
    assert.equal(report.months, 12);
    assert.equal(report.operatingCosts, 120000);
    assert.equal(
      report.netIncome,
      report.income - report.estimatedTax - report.expenses - 120000,
    );
    for (const query of [
      "from=2026-12&to=2026-01",
      "from=2026-01",
      "from=2000-01&to=2026-12",
      "month=2026-01&from=2026-01&to=2026-02",
    ])
      assert.equal(
        (await admin.agent.get("/api/reports/financial.xlsx?" + query)).status,
        400,
      );
    const exported = await admin.agent
      .get(`/api/reports/financial.xlsx?from=${year}-01&to=${year}-12`)
      .buffer(true)
      .parse((res, callback) => {
        const parts = [];
        res.on("data", (part) => parts.push(part));
        res.on("end", () => callback(null, Buffer.concat(parts)));
      });
    assert.equal(exported.status, 200);
    assert.match(
      exported.headers["content-disposition"],
      new RegExp(`${year}-01_a_${year}-12`),
    );
    const workbook = unzipSync(exported.body);
    const xml = strFromU8(workbook["xl/worksheets/sheet1.xml"]);
    assert.match(xml, /C3"[^>]*t="str"/);
    assert.match(xml, /12 mês\(es\)/);
    const lastYear = await loadFinancialReport(pool, "9999-12", "9999-12");
    assert.equal(lastYear.months, 1);
  } finally {
    await mutation(admin, "put", "/business-settings", {
      taxRateBasisPoints: 0,
      monthlyOperatingCostsCents: null,
    });
  }
});

test("auditoria conserva antes/depois reais, inclusive em edições simultâneas", async () => {
  const original = customerFixture({
    name: "Cliente antes",
    email: "antes@example.test",
  });
  const created = await mutation(admin, "post", "/customers", original);
  assert.equal(created.status, 201);
  const payload = {
    ...original,
    name: "Cliente depois",
    email: "depois@example.test",
  };
  for (const reason of [
    undefined,
    "",
    "         ",
    "123456789",
    "   curto   ",
  ]) {
    const invalid = await admin.agent
      .patch(`/api/customers/${created.body.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({ ...payload, reason });
    assert.equal(invalid.status, 400);
  }
  assert.equal(
    (await mutation(admin, "patch", `/customers/${created.body.id}`, payload))
      .status,
    200,
  );
  let events = (await admin.agent.get("/api/audit")).body.items.filter(
    (e) => e.entityId === created.body.id && e.action === "updated",
  );
  assert.deepEqual(events[0].changes, [
    { field: "name", before: "Cliente antes", after: "Cliente depois" },
    {
      field: "email",
      before: "antes@example.test",
      after: "depois@example.test",
    },
  ]);
  assert.equal(events[0].actorId, admin.user.id);
  assert.equal(events[0].reason, "Atualização justificada no cenário de teste");
  assert.equal(
    (await mutation(admin, "patch", `/customers/${created.body.id}`, payload))
      .status,
    200,
  );
  events = (await admin.agent.get("/api/audit")).body.items.filter(
    (e) => e.entityId === created.body.id && e.action === "updated",
  );
  assert.deepEqual(events[0].changes, []);
  const simultaneous = await Promise.all([
    mutation(admin, "patch", `/customers/${created.body.id}`, {
      ...payload,
      name: "Versão A",
    }),
    mutation(admin, "patch", `/customers/${created.body.id}`, {
      ...payload,
      name: "Versão B",
    }),
  ]);
  assert.ok(simultaneous.every((r) => r.status === 200));
  const history = (
    await pool.query(
      "SELECT changes FROM audit_events WHERE entity_id=$1 AND action='updated' ORDER BY id",
      [created.body.id],
    )
  ).rows;
  assert.equal(history[2].changes[0].before, "Cliente depois");
  assert.equal(history[3].changes[0].before, history[2].changes[0].after);
  assert.notEqual(history[3].changes[0].after, history[3].changes[0].before);
  const countBefore = history.length;
  assert.equal(
    (
      await mutation(admin, "patch", `/customers/${created.body.id}`, {
        ...payload,
        taxId: "123",
      })
    ).status,
    400,
  );
  assert.equal(
    Number(
      (
        await pool.query(
          "SELECT count(*) FROM audit_events WHERE entity_id=$1 AND action='updated'",
          [created.body.id],
        )
      ).rows[0].count,
    ),
    countBefore,
  );
});

test("reversão só por administrador, uma única vez, com histórico e proteção contra registro posterior", async () => {
  const payload = customerFixture({
    name: "Original da reversão",
    email: "original@example.test",
  });
  const customer = (await mutation(admin, "post", "/customers", payload)).body;
  const latest = async (entity, id) =>
    (
      await pool.query(
        "SELECT * FROM audit_events WHERE entity=$1 AND entity_id IS NOT DISTINCT FROM $2::uuid ORDER BY id DESC LIMIT 1",
        [entity, id],
      )
    ).rows[0];
  const reverse = (
    session,
    event,
    reason = "Correção autorizada pelo administrador",
  ) => mutation(session, "post", `/audit/${event.id}/rollback`, { reason });
  await mutation(admin, "patch", `/customers/${customer.id}`, {
    ...payload,
    name: "Nome incorreto",
  });
  const changed = await latest("customer", customer.id);
  assert.equal(changed.reversible, true);
  assert.equal((await reverse(operator, changed)).status, 403);
  assert.equal((await reverse(accountant, changed)).status, 403);
  assert.equal((await reverse(admin, changed, "curto")).status, 400);
  const concurrent = await Promise.all([
    reverse(admin, changed),
    reverse(admin, changed),
  ]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (await pool.query("SELECT name FROM customers WHERE id=$1", [customer.id]))
      .rows[0].name,
    payload.name,
  );
  const undo = await latest("customer", customer.id);
  assert.equal(undo.action, "rolled_back");
  assert.equal(undo.reverses_event_id, changed.id);
  assert.equal(undo.actor_id, admin.user.id);
  assert.equal(undo.reversible, false);
  assert.deepEqual(undo.changes, [
    { field: "name", before: "Nome incorreto", after: payload.name },
  ]);
  assert.equal((await reverse(admin, undo)).status, 409);
  const original = (await admin.agent.get("/api/audit")).body.items.find(
    (e) => e.id === changed.id,
  );
  assert.equal(original.isReverted, true);
  assert.deepEqual(original.changes, changed.changes);
  await mutation(admin, "patch", `/customers/${customer.id}`, {
    ...payload,
    name: "Primeira edição",
  });
  const stale = await latest("customer", customer.id);
  await mutation(admin, "patch", `/customers/${customer.id}`, {
    ...payload,
    name: "Segunda edição",
  });
  assert.equal((await reverse(admin, stale)).status, 409);
  // Não restaura um CPF que passou a pertencer a outro cadastro ativo na mesma empresa.
  await mutation(admin, "patch", `/customers/${customer.id}`, {
    ...payload,
    taxId: "52998224725",
  });
  const documentEvent = await latest("customer", customer.id);
  assert.equal(
    (
      await mutation(admin, "post", "/customers", {
        ...payload,
        name: "Cadastro que agora usa o CPF anterior",
      })
    ).status,
    201,
  );
  assert.equal((await reverse(admin, documentEvent)).status, 409);
  assert.equal(
    (
      await pool.query("SELECT tax_id FROM customers WHERE id=$1", [
        customer.id,
      ])
    ).rows[0].tax_id,
    "52998224725",
  );
  // A configuração é restaurada dentro da mesma empresa e registra quem a restaurou.
  const previousSettings = (await admin.agent.get("/api/business-settings"))
    .body;
  await mutation(admin, "put", "/business-settings", {
    taxRateBasisPoints: 725,
    monthlyOperatingCostsCents: 1234,
  });
  const settingsEvent = await latest("business_settings", null);
  assert.equal((await reverse(admin, settingsEvent)).status, 200);
  const restoredSettings = (await admin.agent.get("/api/business-settings"))
    .body;
  assert.equal(
    restoredSettings.taxRateBasisPoints,
    previousSettings.taxRateBasisPoints,
  );
  assert.equal(
    restoredSettings.monthlyOperatingCostsCents,
    previousSettings.monthlyOperatingCostsCents,
  );
  // Estoque manual gera compensação no histórico, sem simplesmente apagar a movimentação anterior.
  const product = (
    await mutation(admin, "post", "/products", {
      name: "Estoque reversível",
      sku: "ROLLBACK",
      quantity: 10,
      unitPriceCents: 100,
    })
  ).body;
  await mutation(admin, "post", `/products/${product.id}/stock`, {
    delta: 3,
    reason: "Entrada manual conferida no teste",
  });
  const stockEvent = await latest("product", product.id);
  assert.equal((await reverse(admin, stockEvent)).status, 200);
  assert.equal(
    (
      await pool.query("SELECT quantity FROM products WHERE id=$1", [
        product.id,
      ])
    ).rows[0].quantity,
    10,
  );
  const order = await mutation(admin, "post", "/orders", {
    customerId: customer.id,
    description: "Baixa não reversível pelo log",
    items: [{ productId: product.id, quantity: 1 }],
  });
  assert.equal(order.status, 201);
  assert.equal(
    (await reverse(admin, await latest("product", product.id))).status,
    409,
  );
  assert.equal(
    (await reverse(admin, await latest("order", order.body.id))).status,
    409,
  );
  const target = (
    await mutation(admin, "post", "/users", {
      name: "Conta de reversão",
      email: "rollback@erp.test",
      role: "admin",
      password,
    })
  ).body;
  await mutation(admin, "patch", `/users/${target.id}/active`, {
    active: false,
  });
  const access = await latest("user", target.id);
  assert.equal((await reverse(admin, access)).status, 200);
  assert.equal(
    (await pool.query("SELECT active FROM users WHERE id=$1", [target.id]))
      .rows[0].active,
    true,
  );
  await mutation(admin, "patch", `/users/${target.id}/active`, {
    active: false,
  });
  await mutation(admin, "patch", `/users/${target.id}/active`, {
    active: true,
  });
  const ownAccess = await latest("user", target.id);
  const ownSession = await login("rollback@erp.test");
  assert.equal((await reverse(ownSession, ownAccess)).status, 409);
  assert.equal(
    (
      await admin.agent
        .post("/api/audit/999999999999999999999/rollback")
        .set("Origin", origin)
        .set("X-CSRF-Token", admin.csrfToken)
        .send({ reason: "Evento inválido deve ser rejeitado" })
    ).status,
    400,
  );
});

test("troca de senha revoga sessões e exige a senha atual", async () => {
  const first = await login("accountant@erp.test");
  const second = await login("accountant@erp.test");
  const newPassword = randomBytes(24).toString("base64url");
  assert.equal(
    (
      await mutation(first, "post", "/auth/password", {
        currentPassword: "senha-errada",
        newPassword,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await mutation(first, "post", "/auth/password", {
        currentPassword: password,
        newPassword,
      })
    ).status,
    200,
  );
  assert.equal((await first.agent.get("/api/auth/me")).status, 401);
  assert.equal((await second.agent.get("/api/auth/me")).status, 401);
  assert.equal(
    (
      await request(app)
        .post("/api/auth/login")
        .set("Origin", origin)
        .send({ email: "accountant@erp.test", password: newPassword })
    ).status,
    200,
  );
});

test("desativação de conta invalida sessões existentes", async () => {
  assert.equal(
    (
      await mutation(admin, "patch", `/users/${operator.user.id}/active`, {
        active: false,
      })
    ).status,
    200,
  );
  assert.equal((await operator.agent.get("/api/customers")).status, 401);
  assert.equal(
    (
      await mutation(admin, "patch", `/users/${admin.user.id}/active`, {
        active: false,
      })
    ).status,
    409,
  );
});

test("multiempresa isola dados, vínculos e sessões; suporte exige confirmação, prazo e auditoria", async () => {
  const hash = await hashPassword(password);
  await pool.query(
    "INSERT INTO users(name,email,password_hash,role,is_platform_admin,company_id) VALUES('Responsável geral','platform@erp.test',$1,'admin',true,NULL)",
    [hash],
  );
  const owner = await login("platform@erp.test");
  const confirm = {
    currentPassword: password,
    reason: "Atendimento de teste autorizado",
  };
  assert.equal((await admin.agent.get("/api/platform/companies")).status, 403);
  assert.equal((await owner.agent.get("/api/customers")).status, 403);
  assert.equal(
    (
      await mutation(owner, "post", "/platform/companies", {
        ...confirm,
        name: "Empresa B",
        taxId: "00000000000191",
        admin: { name: "Administrador B", email: "b@erp.test", password },
      })
    ).status,
    201,
  );
  const companyB = (
    await owner.agent.get("/api/platform/companies")
  ).body.items.find((c) => c.name === "Empresa B");
  const companyId = companyB.id;
  const b = await login("b@erp.test");
  assert.equal(b.user.companyId, companyId);
  const foreignEvent = (
    await pool.query(
      "SELECT id FROM audit_events WHERE company_id<>$1 ORDER BY id DESC LIMIT 1",
      [companyId],
    )
  ).rows[0];
  assert.equal(
    (
      await mutation(b, "post", `/audit/${foreignEvent.id}/rollback`, {
        reason: "Tentativa de reversão em outra empresa",
      })
    ).status,
    404,
  );
  const customer = await mutation(b, "post", "/customers", {
    name: "Cliente exclusivo B",
  });
  assert.equal(customer.status, 201, JSON.stringify(customer.body));
  const aCustomer = (await admin.agent.get("/api/customers")).body.items[0];
  assert.ok(aCustomer);
  const [aProducts, bProducts] = await Promise.all([
    mutation(admin, "post", "/products", {
      name: "Produto A",
      sku: "MESMO-CODIGO",
      quantity: 2,
      unitPriceCents: 100,
    }),
    mutation(b, "post", "/products", {
      name: "Produto B",
      sku: "MESMO-CODIGO",
      quantity: 3,
      unitPriceCents: 200,
    }),
  ]);
  assert.equal(aProducts.status, 201);
  assert.equal(bProducts.status, 201);
  const listB = await b.agent
    .get("/api/customers")
    .set("X-Company-Id", aCustomer.companyId);
  assert.deepEqual(
    listB.body.items.map((c) => c.name),
    ["Cliente exclusivo B"],
  );
  assert.equal(
    (
      await mutation(
        b,
        "patch",
        `/customers/${aCustomer.id}`,
        customerFixture({ name: "Invasão" }),
      )
    ).status,
    404,
  );
  assert.equal(
    (await b.agent.get(`/api/customers/${aCustomer.id}/export`)).status,
    404,
  );
  assert.equal(
    (
      await mutation(b, "post", "/orders", {
        customerId: customer.body.id,
        description: "Produto alheio",
        items: [{ productId: aProducts.body.id, quantity: 1 }],
      })
    ).status,
    404,
  );
  assert.equal((await b.agent.get("/api/transactions")).body.items.length, 0);
  assert.equal((await b.agent.get("/api/documents")).body.items.length, 0);
  assert.equal(
    (await b.agent.get("/api/business-settings")).body.taxRateBasisPoints,
    0,
  );
  const accounts = (await b.agent.get("/api/users")).body.items;
  assert.deepEqual(
    accounts.map((u) => u.email),
    ["b@erp.test"],
  );
  assert.ok(!JSON.stringify(accounts).includes("password"));
  assert.equal(
    (
      await mutation(b, "post", "/users", {
        name: "Tentativa",
        email: "escape@erp.test",
        password,
        role: "admin",
        isPlatformAdmin: true,
      })
    ).status,
    400,
  );
  // Mesmo SQL sem WHERE é isolado pelo papel real do banco; uma FK composta rejeita vínculos cruzados.
  const scoped = tenantPool(pool);
  await withCompany({ id: companyId }, async () => {
    const check = await scoped.query(
      "SELECT current_user AS role,(SELECT count(*) FROM customers) AS total",
    );
    assert.equal(check.rows[0].role, "erp_tenant");
    assert.equal(Number(check.rows[0].total), 1);
    await assert.rejects(
      scoped.query(
        "INSERT INTO transactions(type,description,amount_cents,due_date,customer_id) VALUES('income','Outro cliente',100,CURRENT_DATE,$1)",
        [aCustomer.id],
      ),
      (e) => e.code === "23503",
    );
  });
  await assert.rejects(scoped.query("SELECT * FROM customers"), /sem contexto/);
  assert.equal(
    (
      await mutation(owner, "post", "/platform/support", {
        ...confirm,
        currentPassword: "senha-errada",
        companyId,
        writable: false,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await mutation(owner, "post", "/platform/support", {
        ...confirm,
        companyId,
        writable: false,
      })
    ).status,
    200,
  );
  assert.equal(
    (await owner.agent.get("/api/auth/me")).body.user.support.companyId,
    companyId,
  );
  assert.equal(
    (await owner.agent.get("/api/customers")).body.items[0].name,
    "Cliente exclusivo B",
  );
  // Mesmo CNPJ pode existir em duas empresas. Dentro da mesma empresa, nem uma corrida duplica.
  const sameClient = customerFixture({
    name: "Pessoa jurídica compartilhada",
    personType: "PJ",
    taxId: "00.000.000/0001-91",
    taxRegime: "simples_nacional",
  });
  const aShared = await mutation(admin, "post", "/customers", sameClient);
  assert.equal(aShared.status, 201);
  const checkInput = { personType: "PJ", taxId: "00000000000191" };
  assert.deepEqual(
    (await mutation(b, "post", "/customers/check-document", checkInput)).body,
    { exists: false },
  );
  const simultaneous = await Promise.all([
    mutation(b, "post", "/customers", sameClient),
    mutation(b, "post", "/customers", {
      ...sameClient,
      taxId: "00000000000191",
    }),
  ]);
  assert.deepEqual(simultaneous.map((r) => r.status).sort(), [201, 409]);
  assert.match(
    simultaneous.find((r) => r.status === 409).body.error,
    /CPF\/CNPJ nesta empresa/,
  );
  const bShared = simultaneous.find((r) => r.status === 201).body;
  assert.deepEqual(
    (await mutation(b, "post", "/customers/check-document", checkInput)).body,
    { exists: true },
  );
  assert.deepEqual(
    (
      await mutation(b, "post", "/customers/check-document", {
        ...checkInput,
        excludeId: bShared.id,
      })
    ).body,
    { exists: false },
  );
  assert.deepEqual(
    (
      await mutation(b, "post", "/customers/check-document", {
        ...checkInput,
        excludeId: aShared.body.id,
      })
    ).body,
    { exists: true },
  );
  assert.equal(
    (await mutation(b, "patch", `/customers/${bShared.id}`, sameClient)).status,
    200,
  );
  assert.equal(
    (await mutation(b, "patch", `/customers/${customer.body.id}`, sameClient))
      .status,
    409,
  );
  assert.equal(
    (
      await mutation(b, "post", "/customers/check-document", {
        personType: "PJ",
        taxId: "123",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await mutation(owner, "post", "/products", {
        name: "Não permitido",
        sku: "NO",
        quantity: 0,
        unitPriceCents: 100,
      })
    ).status,
    403,
  );
  assert.equal(
    (await mutation(owner, "post", "/platform/support/end", {})).status,
    200,
  );
  assert.equal(
    (
      await mutation(owner, "post", "/platform/support", {
        ...confirm,
        companyId,
        writable: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await mutation(owner, "post", "/products", {
        name: "Suporte autorizado",
        sku: "SUP",
        quantity: 1,
        unitPriceCents: 100,
      })
    ).status,
    201,
  );
  const auditB = (await b.agent.get("/api/audit")).body.items;
  assert.ok(
    auditB.some(
      (e) => e.actorName === "Responsável geral" && e.action === "created",
    ),
  );
  // Uma empresa muito ativa não pode esconder os eventos de outra pelo limite de 200.
  const companyC = (
    await pool.query(
      "INSERT INTO companies(name,tax_id) VALUES('Empresa C','11222333000181') RETURNING id",
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO platform_events(actor_id,company_id,action,reason) SELECT $1,$2,'company_updated','Evento exclusivo da empresa C' FROM generate_series(1,205)",
    [owner.user.id, companyC],
  );
  const platformEvents = (
    await owner.agent.get(`/api/platform/companies/${companyId}/events`)
  ).body.items;
  assert.ok(platformEvents.some((e) => e.action === "support_request"));
  assert.ok(platformEvents.every((e) => e.companyName === "Empresa B"));
  assert.ok(platformEvents.some((e) => e.action === "company_created"));
  const eventsC = (
    await owner.agent.get(`/api/platform/companies/${companyC}/events`)
  ).body.items;
  assert.equal(eventsC.length, 200);
  assert.ok(eventsC.every((e) => e.companyName === "Empresa C"));
  // 00h de Brasília é 03h UTC nestas datas; o dia final precisa ser incluído por inteiro.
  for (const [createdAt, reason] of [
    ["2026-07-01T02:59:59Z", "Antes do dia"],
    ["2026-07-01T03:00:00Z", "Inicio do dia"],
    ["2026-07-02T02:59:59.999Z", "Final do dia"],
    ["2026-07-02T03:00:00Z", "Depois do dia"],
  ])
    await pool.query(
      "INSERT INTO platform_events(actor_id,company_id,action,reason,created_at) VALUES($1,$2,'company_updated',$3,$4)",
      [owner.user.id, companyId, reason, createdAt],
    );
  const dated = await owner.agent.get(
    `/api/platform/companies/${companyId}/events?from=2026-07-01&to=2026-07-01`,
  );
  assert.equal(dated.status, 200);
  assert.deepEqual(
    dated.body.items.map((e) => e.reason),
    ["Final do dia", "Inicio do dia"],
  );
  await pool.query(
    "INSERT INTO platform_events(actor_id,action,reason,created_at) VALUES($1,'platform_login','Evento da plataforma no dia','2026-07-01T03:00:00Z')",
    [owner.user.id],
  );
  const platformDay = await owner.agent.get(
    "/api/platform/events?from=2026-07-01&to=2026-07-01",
  );
  assert.deepEqual(
    platformDay.body.items.map((e) => e.reason),
    ["Evento da plataforma no dia"],
  );
  for (const query of [
    "from=2026-02-30",
    "from=2026-07-02&to=2026-07-01",
    "to=qualquer-coisa",
    "unknown=1",
  ])
    assert.equal(
      (
        await owner.agent.get(
          `/api/platform/companies/${companyId}/events?${query}`,
        )
      ).status,
      400,
    );
  const generalEvents = (await owner.agent.get("/api/platform/events")).body
    .items;
  assert.ok(generalEvents.every((e) => e.companyName === null));
  assert.ok(!generalEvents.some((e) => e.action === "support_request"));
  assert.equal(
    (await b.agent.get(`/api/platform/companies/${companyId}/events`)).status,
    403,
  );
  await pool.query(
    "UPDATE support_access SET expires_at=now()-interval '1 minute' WHERE company_id=$1",
    [companyId],
  );
  assert.equal((await owner.agent.get("/api/products")).status, 403);
  const freshPassword = randomBytes(24).toString("base64url");
  assert.equal(
    (
      await mutation(
        owner,
        "patch",
        `/platform/companies/${companyId}/users/${b.user.id}`,
        { ...confirm, newPassword: freshPassword },
      )
    ).status,
    200,
  );
  assert.equal((await b.agent.get("/api/products")).status, 401);
  const renewed = request.agent(app);
  const entered = await renewed
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({ email: "b@erp.test", password: freshPassword });
  assert.equal(entered.status, 200);
  assert.equal(
    (
      await mutation(owner, "patch", `/platform/companies/${companyId}`, {
        ...confirm,
        name: "Empresa B",
        taxId: "00000000000191",
        active: false,
      })
    ).status,
    200,
  );
  assert.equal((await renewed.get("/api/customers")).status, 401);
  assert.equal((await admin.agent.get("/api/products")).status, 200);
  // A migração é repetível mesmo com códigos idênticos entre empresas.
  await migrate(pool);
  assert.equal((await admin.agent.get("/api/products")).status, 200);
});
