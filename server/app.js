// API do ERP. Ordem: proteções gerais -> login -> sessão -> cadastros -> indicadores -> erros.
// req representa a requisição; res monta a resposta; next continua a sequência de verificações.
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  currentBusinessMonth,
  loadFinancialDashboard,
  loadFinancialReport,
} from "./finance.js";
import { buildFinancialExcel } from "./excel-report.js";
import { ZodError, z } from "zod";
import { transaction, record, audit } from "./db.js";
import {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  csrfToken,
  safeEqual,
} from "./security.js";
import {
  schemas,
  body,
  id,
  HttpError,
  requireRow,
  changeReason,
} from "./validation.js";
import { lookupCnpj } from "./cnpj.js";
import { tenantPool, withCompany } from "./tenant-db.js";
import { platformRoutes, platformEvent } from "./platform.js";
import { normalizeTaxId, validCpf, validCnpj } from "../shared/brazil.js";
import { auditChanges } from "./audit-changes.js";
import { rollbackChange } from "./rollback.js";

// Mesmo custo de hash para contas inexistentes, sem revelar quem está cadastrado.
const dummyHash = await hashPassword(randomUUID());
// Filtra o usuário antes de enviá-lo à tela, excluindo hash e controles internos de login.
const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  isPlatformAdmin: user.is_platform_admin,
  companyId: user.company_id,
  companyName: user.company_name,
  support: user.support || null,
});
const financial = ["admin", "accountant"];
// Mapeamento fixo: somente valores do cadastro são parâmetros; nomes SQL não vêm da requisição.
const customerFields = [
  ["name", "name"],
  ["email", "email"],
  ["phone", "phone"],
  ["person_type", "personType"],
  ["tax_id", "taxId"],
  ["tax_regime", "taxRegime"],
  ["trade_name", "tradeName"],
  ["state_registration", "stateRegistration"],
  ["municipal_registration", "municipalRegistration"],
  ["postal_code", "postalCode"],
  ["street", "street"],
  ["address_number", "addressNumber"],
  ["complement", "complement"],
  ["district", "district"],
  ["city", "city"],
  ["state", "state"],
];
const customerValues = (input) =>
  customerFields.map(([, key]) => input[key] || null);
// Middleware de autorização: estar conectado não dá permissão para todas as funções.
const allow =
  (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.user.role))
      throw new HttpError(403, "Seu perfil não permite esta operação.");
    next();
  };

export function createApp(rawPool, config) {
  const pool = tenantPool(rawPool);
  // Recebe banco e configuração por parâmetro para usar a mesma API nos testes.
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  // Helmet configura cabeçalhos de proteção. HTTPS é obrigatório na configuração de produção.
  app.use(
    helmet({
      strictTransportSecurity: config.production ? undefined : false,
      contentSecurityPolicy: {
        directives: {
          "upgrade-insecure-requests": config.production ? [] : null,
        },
      },
    }),
  );
  app.use("/api", (req, res, next) => {
    // Evita armazenar respostas com dados da empresa em caches HTTP.
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Muitas requisições. Aguarde um minuto." },
    }),
  );
  // Converte JSON em req.body e rejeita corpos grandes; cookieParser lê os cookies recebidos.
  app.use(express.json({ limit: "32kb" }));
  app.use(cookieParser());

  // Mesmo domínio e JSON obrigatório também protegem o formulário de login.
  app.use("/api", (req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.get("origin") !== config.appOrigin)
        throw new HttpError(403, "Origem da requisição não permitida.");
      if (!req.is("application/json"))
        throw new HttpError(415, "Envie dados no formato JSON.");
    }
    next();
  });
  app.get("/api/health", async (req, res) => {
    // Testa se a API consegue consultar o banco, sem retornar dados de negócio.
    await rawPool.query("SELECT 1");
    res.json({ status: "ok" });
  });
  // HttpOnly impede a leitura do JWT pela tela; Secure envia o cookie via HTTPS em produção.
  const cookieOptions = {
    httpOnly: true,
    secure: config.production,
    sameSite: "strict",
    path: "/api",
    maxAge: 30 * 60 * 1000,
  };
  const loginLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 15,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Muitas tentativas de acesso. Aguarde 15 minutos." },
  });
  // LOGIN: verifica a senha, cria a sessão revogável e devolve os dados públicos e o CSRF.
  app.post(
    "/api/auth/login",
    loginLimit,
    body(schemas.login),
    async (req, res) => {
      const { email, password } = req.input;
      const { rows } = await rawPool.query(
        "SELECT u.*,c.name AS company_name,c.active AS company_active FROM users u LEFT JOIN companies c ON c.id=u.company_id WHERE u.email=$1",
        [email],
      );
      const user = rows[0];
      const valid = await verifyPassword(
        password,
        user?.password_hash || dummyHash,
      );
      const locked =
        user?.locked_until && new Date(user.locked_until) > new Date();
      if (
        !user ||
        !user.active ||
        !valid ||
        locked ||
        (!user.is_platform_admin && !user.company_active)
      ) {
        if (user && !locked)
          await rawPool.query(
            `UPDATE users SET failed_attempts=failed_attempts+1,
        locked_until=CASE WHEN failed_attempts+1>=5 THEN now()+interval '15 minutes' ELSE NULL END WHERE id=$1`,
            [user.id],
          );
        throw new HttpError(
          401,
          "E-mail ou senha inválidos, ou acesso temporariamente indisponível.",
        );
      }
      // sid é o identificador da sessão; não é a senha nem a chave de assinatura.
      const sid = randomUUID();
      await transaction(rawPool, async (db) => {
        await db.query(
          "UPDATE users SET failed_attempts=0,locked_until=NULL WHERE id=$1",
          [user.id],
        );
        await db.query("DELETE FROM sessions WHERE expires_at<now()");
        await db.query(
          "INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '30 minutes')",
          [sid, user.id],
        );
        if (user.is_platform_admin)
          await platformEvent(
            db,
            user.id,
            null,
            "platform_login",
            "Entrada do administrador geral.",
          );
        else
          await db.query(
            "INSERT INTO audit_events(company_id,actor_id,actor_name,action,entity,entity_id) VALUES($1,$2,$3,'login','user',$2)",
            [user.company_id, user.id, user.name],
          );
      });
      res.cookie(
        config.cookieName,
        signToken(user.id, sid, config.jwtSecret),
        cookieOptions,
      );
      res.json({
        user: publicUser(user),
        csrfToken: csrfToken(config.jwtSecret, sid),
      });
    },
  );

  // Todas as rotas /api declaradas abaixo passam por autenticação e proteção CSRF.
  app.use("/api", async (req, res, next) => {
    let claims;
    try {
      claims = verifyToken(req.cookies[config.cookieName], config.jwtSecret);
    } catch {
      throw new HttpError(401, "Sessão expirada. Entre novamente.");
    }
    if (
      !z.uuid().safeParse(claims.sid).success ||
      !z.uuid().safeParse(claims.sub).success
    )
      throw new HttpError(401, "Sessão inválida.");
    // Uma assinatura válida não basta: a sessão precisa existir e o usuário estar ativo.
    const result = await rawPool.query(
      `SELECT u.*,c.name AS company_name,c.active AS company_active FROM users u JOIN sessions s ON s.user_id=u.id LEFT JOIN companies c ON c.id=u.company_id
      WHERE u.id=$1 AND s.id=$2 AND s.expires_at>now() AND u.active=true`,
      [claims.sub, claims.sid],
    );
    if (!result.rows[0])
      throw new HttpError(401, "Sessão expirada. Entre novamente.");
    req.user = result.rows[0];
    if (!req.user.is_platform_admin && !req.user.company_active)
      throw new HttpError(403, "O acesso desta empresa está suspenso.");
    if (req.user.is_platform_admin) {
      const support = await rawPool.query(
        `SELECT a.company_id,c.name AS company_name,a.writable,a.expires_at FROM support_access a
        JOIN companies c ON c.id=a.company_id WHERE a.session_id=$1 AND a.expires_at>now() AND c.active`,
        [claims.sid],
      );
      req.user.support = support.rows[0] ? record(support.rows[0]) : null;
    }
    req.sid = claims.sid;
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !safeEqual(req.get("x-csrf-token"), csrfToken(config.jwtSecret, req.sid))
    ) {
      throw new HttpError(
        403,
        "Token de proteção inválido. Atualize a página.",
      );
    }
    next();
  });
  app.get("/api/auth/me", (req, res) =>
    res.json({
      user: publicUser(req.user),
      csrfToken: csrfToken(config.jwtSecret, req.sid),
    }),
  );
  app.post("/api/auth/logout", async (req, res) => {
    // Apagar a sessão do banco invalida inclusive uma cópia antiga do JWT.
    if (req.user.is_platform_admin && req.user.support)
      await platformEvent(
        rawPool,
        req.user.id,
        req.user.support.companyId,
        "support_ended",
        "Suporte encerrado pela saída da conta.",
      );
    await rawPool.query("DELETE FROM sessions WHERE id=$1", [req.sid]);
    res
      .clearCookie(config.cookieName, { ...cookieOptions, maxAge: undefined })
      .json({ ok: true });
  });
  app.post(
    "/api/auth/password",
    body(schemas.changePassword),
    async (req, res) => {
      if (
        !(await verifyPassword(
          req.input.currentPassword,
          req.user.password_hash,
        ))
      )
        throw new HttpError(400, "Senha atual inválida.");
      // Troca o hash e encerra todas as sessões na mesma transação.
      const hash = await hashPassword(req.input.newPassword);
      await transaction(rawPool, async (db) => {
        await db.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
          hash,
          req.user.id,
        ]);
        await db.query("DELETE FROM sessions WHERE user_id=$1", [req.user.id]);
        if (req.user.is_platform_admin)
          await platformEvent(
            db,
            req.user.id,
            null,
            "own_password_changed",
            "Troca da senha pessoal do administrador geral.",
          );
        else
          await db.query(
            "INSERT INTO audit_events(company_id,actor_id,actor_name,action,entity,entity_id) VALUES($1,$2,$3,'password_changed','user',$2)",
            [req.user.company_id, req.user.id, req.user.name],
          );
      });
      res
        .clearCookie(config.cookieName, { ...cookieOptions, maxAge: undefined })
        .json({ ok: true });
    },
  );

  platformRoutes(app, rawPool);
  // A empresa vem da sessão no servidor, nunca de cabeçalho ou parâmetro do navegador.
  app.use("/api", async (req, res, next) => {
    const support = req.user.support;
    if (req.user.is_platform_admin && !support)
      throw new HttpError(
        403,
        "Selecione uma empresa e inicie um acesso de suporte.",
      );
    if (support && !support.writable && !["GET", "HEAD"].includes(req.method))
      throw new HttpError(
        403,
        "Suporte em modo somente consulta. Encerre e autorize alterações para editar.",
      );
    const companyId = support?.companyId || req.user.company_id;
    if (support)
      await platformEvent(
        rawPool,
        req.user.id,
        companyId,
        "support_request",
        `${req.method} ${req.path}`,
      );
    withCompany({ id: companyId, actorName: req.user.name }, next);
  });
  // Tabelas e colunas são constantes; dados do usuário usam parâmetros SQL.
  const collections = {
    customers: {
      sql: "SELECT * FROM customers",
      roles: ["admin", "accountant", "operator"],
    },
    products: {
      sql: "SELECT * FROM products",
      roles: ["admin", "accountant", "operator"],
    },
    orders: {
      sql: "SELECT * FROM orders",
      roles: ["admin", "accountant", "operator"],
    },
    transactions: { sql: "SELECT * FROM transactions", roles: financial },
    documents: { sql: "SELECT * FROM documents", roles: financial },
    users: {
      sql: "SELECT id,name,email,role,active,created_at FROM users",
      roles: ["admin"],
    },
    audit: {
      sql: "SELECT a.*,COALESCE(u.name,a.actor_name) AS actor_name,u.email AS actor_email,EXISTS(SELECT 1 FROM audit_events r WHERE r.reverses_event_id=a.id) AS is_reverted FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id",
      roles: ["admin"],
    },
  };
  for (const [name, definition] of Object.entries(collections)) {
    // Reaproveita a listagem: no máximo 200 registros; limit e offset são parâmetros validados.
    app.get("/api/" + name, allow(...definition.roles), async (req, res) => {
      const limit = z.coerce
        .number()
        .int()
        .min(1)
        .max(200)
        .default(200)
        .parse(req.query.limit);
      const offset = z.coerce
        .number()
        .int()
        .min(0)
        .max(100000)
        .default(0)
        .parse(req.query.offset);
      const { rows } = await pool.query(
        definition.sql + " ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2",
        [limit, offset],
      );
      res.json({ items: rows.map(record), limit, offset });
    });
  }
  app.post(
    "/api/audit/:eventId/rollback",
    allow("admin"),
    body(z.object({ reason: changeReason }).strict()),
    async (req, res) => {
      const eventId = z
        .string()
        .regex(/^[1-9]\d{0,18}$/)
        .refine((value) => BigInt(value) <= 9223372036854775807n)
        .parse(req.params.eventId);
      const result = await rollbackChange(
        pool,
        req.user,
        eventId,
        req.input.reason,
        async (companyId, since) => {
          const changed = await rawPool.query(
            "SELECT 1 FROM platform_events WHERE company_id=$1 AND action IN ('company_user_access_changed','company_user_password_reset') AND created_at>$2 LIMIT 1",
            [companyId, since],
          );
          return changed.rowCount > 0;
        },
      );
      res.json(result);
    },
  );
  async function create(req, res, entity, sql, values, extra) {
    // Helper de cadastro: executa INSERT, ações extras e auditoria como uma só transação.
    const row = await transaction(pool, async (db) => {
      const row = requireRow(await db.query(sql, values));
      if (extra) await extra(db, row);
      await audit(db, req.user.id, "created", entity, row.id);
      return row;
    });
    res.status(201).json(record(row));
  }
  // Consulta explícita, autenticada e limitada; não grava nada nem repassa cookie ao fornecedor.
  app.get(
    "/api/company-lookup/:cnpj",
    allow("admin", "operator", "accountant"),
    rateLimit({
      windowMs: 60000,
      limit: 10,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Aguarde um minuto antes de consultar novamente." },
    }),
    async (req, res) => res.json(await lookupCnpj(req.params.cnpj)),
  );
  // CLIENTES: criação e edição preservam os limites e impedem restaurar contatos removidos.
  app.post(
    "/api/customers/check-document",
    allow("admin", "operator", "accountant"),
    body(
      z
        .object({
          personType: z.enum(["PF", "PJ"]),
          taxId: z.string().max(18).transform(normalizeTaxId),
          excludeId: z.uuid().optional(),
        })
        .strict()
        .refine(
          (p) =>
            p.personType === "PF" ? validCpf(p.taxId) : validCnpj(p.taxId),
          "CPF/CNPJ inválido.",
        ),
    ),
    async (req, res) => {
      // RLS consulta somente a empresa da sessão. Não expõe nomes, IDs nem cadastros de terceiros.
      const result = await pool.query(
        "SELECT 1 FROM customers WHERE tax_id=$1 AND anonymized=false AND ($2::uuid IS NULL OR id<>$2::uuid) LIMIT 1",
        [req.input.taxId, req.input.excludeId || null],
      );
      res.json({ exists: result.rowCount > 0 });
    },
  );
  app.post(
    "/api/customers",
    allow("admin", "operator", "accountant"),
    body(schemas.customer),
    async (req, res) => {
      const p = req.input;
      await create(
        req,
        res,
        "customer",
        `INSERT INTO customers(${customerFields.map(([column]) => column).join(",")}) VALUES(${customerFields.map((_, index) => "$" + (index + 1)).join(",")}) RETURNING *`,
        customerValues(p),
      );
    },
  );
  app.patch(
    "/api/customers/:id",
    allow("admin", "operator", "accountant"),
    id,
    body(schemas.customer.safeExtend({ reason: changeReason })),
    async (req, res) => {
      const p = req.input;
      const row = await transaction(pool, async (db) => {
        const current = requireRow(
          await db.query(
            "SELECT * FROM customers WHERE id=$1 AND anonymized=false FOR UPDATE",
            [req.entityId],
          ),
        );
        const row = requireRow(
          await db.query(
            `UPDATE customers SET ${customerFields.map(([column], index) => `${column}=$${index + 1}`).join(",")} WHERE id=$${customerFields.length + 1} AND anonymized=false RETURNING *`,
            [...customerValues(p), req.entityId],
          ),
        );
        await audit(
          db,
          req.user.id,
          "updated",
          "customer",
          row.id,
          p.reason,
          auditChanges("customer", current, row),
          true,
        );
        return row;
      });
      res.json(record(row));
    },
  );
  // PRODUTOS: o saldo inicial já gera um registro de movimentação de estoque.
  app.post(
    "/api/products",
    allow("admin", "operator"),
    body(schemas.product),
    async (req, res) => {
      const p = req.input;
      await create(
        req,
        res,
        "product",
        "INSERT INTO products(name,sku,quantity,unit_price_cents) VALUES($1,$2,$3,$4) RETURNING *",
        [p.name, p.sku, p.quantity, p.unitPriceCents],
        async (db, row) => {
          if (p.quantity)
            await db.query(
              "INSERT INTO stock_movements(product_id,delta,reason,actor_id) VALUES($1,$2,$3,$4)",
              [row.id, p.quantity, "Saldo inicial", req.user.id],
            );
        },
      );
    },
  );
  // ESTOQUE: FOR UPDATE faz movimentações do mesmo produto aguardarem umas às outras.
  // Saldo, histórico e auditoria são confirmados juntos, sem permitir quantidade negativa.
  app.post(
    "/api/products/:id/stock",
    allow("admin", "operator"),
    id,
    body(schemas.stock),
    async (req, res) => {
      const row = await transaction(pool, async (db) => {
        const current = requireRow(
          await db.query("SELECT * FROM products WHERE id=$1 FOR UPDATE", [
            req.entityId,
          ]),
        );
        const quantity = current.quantity + req.input.delta;
        if (quantity < 0 || quantity > 1000000)
          throw new HttpError(
            409,
            "Movimentação ultrapassa o limite do estoque.",
          );
        const row = requireRow(
          await db.query(
            "UPDATE products SET quantity=$1 WHERE id=$2 RETURNING *",
            [quantity, current.id],
          ),
        );
        await db.query(
          "INSERT INTO stock_movements(product_id,delta,reason,actor_id) VALUES($1,$2,$3,$4)",
          [row.id, req.input.delta, req.input.reason, req.user.id],
        );
        await audit(
          db,
          req.user.id,
          "stock_changed",
          "product",
          row.id,
          req.input.reason,
          auditChanges("product", current, row),
          true,
        );
        return row;
      });
      res.json(record(row));
    },
  );
  app.get(
    "/api/products/:id/stock",
    allow("admin", "operator", "accountant"),
    id,
    async (req, res) => {
      const { rows } = await pool.query(
        "SELECT * FROM stock_movements WHERE product_id=$1 ORDER BY created_at DESC LIMIT 200",
        [req.entityId],
      );
      res.json({ items: rows.map(record) });
    },
  );
  // PEDIDOS: preços vêm do banco e o estoque é baixado ao salvar, na mesma transação.
  app.post(
    "/api/orders",
    allow("admin", "operator"),
    body(schemas.order),
    async (req, res) => {
      const p = req.input;
      const row = await transaction(pool, async (db) => {
        requireRow(
          await db.query(
            "SELECT id FROM customers WHERE id=$1 AND anonymized=false FOR SHARE",
            [p.customerId],
          ),
        );
        const products = (
          await db.query(
            "SELECT * FROM products WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
            [p.items.map((item) => item.productId)],
          )
        ).rows;
        let amount = 0;
        for (const item of p.items) {
          const product = products.find(
            (product) => product.id === item.productId,
          );
          if (!product) throw new HttpError(404, "Produto não encontrado.");
          if (product.quantity < item.quantity)
            throw new HttpError(
              409,
              `Estoque insuficiente para ${product.name}.`,
            );
          amount += product.unit_price_cents * item.quantity;
        }
        if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100000000)
          throw new HttpError(
            400,
            "O total do pedido deve estar entre R$ 0,01 e R$ 1.000.000,00.",
          );
        const row = requireRow(
          await db.query(
            "INSERT INTO orders(customer_id,description,amount_cents,stock_deducted) VALUES($1,$2,$3,true) RETURNING *",
            [p.customerId, p.description, amount],
          ),
        );
        for (const item of p.items) {
          const product = products.find(
            (product) => product.id === item.productId,
          );
          await db.query(
            "INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price_cents) VALUES($1,$2,$3,$4,$5)",
            [
              row.id,
              product.id,
              product.name,
              item.quantity,
              product.unit_price_cents,
            ],
          );
          await db.query(
            "UPDATE products SET quantity=quantity-$1 WHERE id=$2",
            [item.quantity, product.id],
          );
          await db.query(
            "INSERT INTO stock_movements(product_id,delta,reason,actor_id) VALUES($1,$2,$3,$4)",
            [product.id, -item.quantity, `Pedido ${row.id}`, req.user.id],
          );
          await audit(
            db,
            req.user.id,
            "stock_changed",
            "product",
            product.id,
            `Baixa pelo pedido ${row.id}`,
            auditChanges("product", product, {
              ...product,
              quantity: product.quantity - item.quantity,
            }),
          );
        }
        await audit(db, req.user.id, "created", "order", row.id);
        return row;
      });
      res.status(201).json(record(row));
    },
  );
  app.get(
    "/api/orders/:id",
    allow("admin", "operator", "accountant"),
    id,
    async (req, res) => {
      const order = requireRow(
        await pool.query("SELECT * FROM orders WHERE id=$1", [req.entityId]),
      );
      const items = await pool.query(
        "SELECT * FROM order_items WHERE order_id=$1 ORDER BY product_name",
        [order.id],
      );
      const document = await pool.query(
        "SELECT d.id,d.number,d.issued_on,d.amount_cents,d.status FROM documents d JOIN transactions t ON t.id=d.transaction_id WHERE t.order_id=$1 AND t.status<>'cancelled'",
        [order.id],
      );
      res.json({
        ...record(order),
        items: items.rows.map(record),
        document: document.rows[0] ? record(document.rows[0]) : null,
      });
    },
  );
  // Atalho fiscal: usa a receita existente ou cria uma pendência, sem registrar recebimento.
  app.post(
    "/api/orders/:id/document",
    allow(...financial),
    id,
    body(schemas.orderDocument),
    async (req, res) => {
      const document = await transaction(pool, async (db) => {
        const order = requireRow(
          await db.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [
            req.entityId,
          ]),
        );
        if (order.status === "cancelled")
          throw new HttpError(
            409,
            "Não é possível vincular nota a pedido cancelado.",
          );
        let tx = (
          await db.query(
            "SELECT * FROM transactions WHERE order_id=$1 AND status<>'cancelled' FOR UPDATE",
            [order.id],
          )
        ).rows[0];
        if (!tx) {
          tx = requireRow(
            await db.query(
              "INSERT INTO transactions(type,description,amount_cents,due_date,customer_id,order_id) VALUES('income',$1,$2,$3,$4,$5) RETURNING *",
              [
                `Pedido: ${order.description}`.slice(0, 300),
                order.amount_cents,
                req.input.dueDate,
                order.customer_id,
                order.id,
              ],
            ),
          );
          await audit(db, req.user.id, "created", "transaction", tx.id);
        }
        const doc = requireRow(
          await db.query(
            "INSERT INTO documents(transaction_id,number,kind,issued_on,amount_cents) VALUES($1,$2,'invoice',$3,$4) RETURNING *",
            [tx.id, req.input.number, req.input.issuedOn, tx.amount_cents],
          ),
        );
        await audit(db, req.user.id, "created", "document", doc.id);
        return doc;
      });
      res.status(201).json(record(document));
    },
  );
  app.patch(
    "/api/orders/:id/status",
    allow("admin", "operator"),
    id,
    body(schemas.orderStatus),
    async (req, res) => {
      const row = await transaction(pool, async (db) => {
        const current = requireRow(
          await db.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [
            req.entityId,
          ]),
        );
        const transitions = {
          open: ["in_progress", "cancelled"],
          in_progress: ["completed", "cancelled"],
          completed: [],
          cancelled: [],
        };
        if (!transitions[current.status].includes(req.input.status))
          throw new HttpError(409, "Transição de situação não permitida.");
        if (req.input.status === "cancelled") {
          const linked = await db.query(
            "SELECT id FROM transactions WHERE order_id=$1 AND status<>'cancelled'",
            [current.id],
          );
          if (linked.rowCount)
            throw new HttpError(
              409,
              "A ordem possui lançamento financeiro ativo.",
            );
          if (current.stock_deducted) {
            const items = (
              await db.query(
                "SELECT * FROM order_items WHERE order_id=$1 ORDER BY product_id",
                [current.id],
              )
            ).rows;
            for (const item of items) {
              const product = requireRow(
                await db.query(
                  "SELECT * FROM products WHERE id=$1 FOR UPDATE",
                  [item.product_id],
                ),
              );
              if (product.quantity + item.quantity > 1000000)
                throw new HttpError(
                  409,
                  "A devolução ultrapassaria o limite de estoque.",
                );
              await db.query(
                "UPDATE products SET quantity=quantity+$1 WHERE id=$2",
                [item.quantity, item.product_id],
              );
              await db.query(
                "INSERT INTO stock_movements(product_id,delta,reason,actor_id) VALUES($1,$2,$3,$4)",
                [
                  item.product_id,
                  item.quantity,
                  `Cancelamento do pedido ${current.id}`,
                  req.user.id,
                ],
              );
              await audit(
                db,
                req.user.id,
                "stock_changed",
                "product",
                product.id,
                `Devolução pelo cancelamento do pedido ${current.id}`,
                auditChanges("product", product, {
                  ...product,
                  quantity: product.quantity + item.quantity,
                }),
              );
            }
            await db.query(
              "UPDATE orders SET stock_deducted=false WHERE id=$1",
              [current.id],
            );
          }
        }
        const row = requireRow(
          await db.query(
            "UPDATE orders SET status=$1 WHERE id=$2 RETURNING *",
            [req.input.status, current.id],
          ),
        );
        await audit(
          db,
          req.user.id,
          "status_" + req.input.status,
          "order",
          row.id,
          req.input.reason,
          auditChanges("order", current, row),
        );
        return row;
      });
      res.json(record(row));
    },
  );
  // FINANCEIRO: uma receita vinculada à ordem precisa ter o mesmo cliente e valor.
  // O índice do banco impede duplicar um vínculo financeiro ativo para a mesma ordem.
  app.post(
    "/api/transactions",
    allow(...financial),
    body(schemas.transaction),
    async (req, res) => {
      const p = req.input;
      const row = await transaction(pool, async (db) => {
        let customerId = p.customerId || null;
        if (p.orderId) {
          const order = requireRow(
            await db.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [
              p.orderId,
            ]),
          );
          if (
            order.status === "cancelled" ||
            p.type !== "income" ||
            order.amount_cents !== p.amountCents ||
            (customerId && customerId !== order.customer_id)
          )
            throw new HttpError(
              409,
              "Dados incompatíveis com a ordem de serviço.",
            );
          customerId = order.customer_id;
        }
        if (customerId)
          requireRow(
            await db.query(
              "SELECT id FROM customers WHERE id=$1 AND anonymized=false FOR SHARE",
              [customerId],
            ),
          );
        const row = requireRow(
          await db.query(
            `INSERT INTO transactions(type,description,amount_cents,due_date,customer_id,order_id)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
            [
              p.type,
              p.description,
              p.amountCents,
              p.dueDate,
              customerId,
              p.orderId || null,
            ],
          ),
        );
        await audit(db, req.user.id, "created", "transaction", row.id);
        return row;
      });
      res.status(201).json(record(row));
    },
  );
  // A baixa registra paid_at, que define em qual mês o valor entra no painel.
  app.patch(
    "/api/transactions/:id/status",
    allow(...financial),
    id,
    body(schemas.transactionStatus),
    async (req, res) => {
      const row = await transaction(pool, async (db) => {
        const current = requireRow(
          await db.query("SELECT * FROM transactions WHERE id=$1 FOR UPDATE", [
            req.entityId,
          ]),
        );
        if (current.status !== "pending" || req.input.status === "pending")
          throw new HttpError(
            409,
            "Somente lançamentos pendentes podem ser baixados ou cancelados.",
          );
        const row = requireRow(
          await db.query(
            "UPDATE transactions SET status=$1::varchar,paid_at=CASE WHEN $1::varchar='paid' THEN now() ELSE NULL END WHERE id=$2 RETURNING *",
            [req.input.status, current.id],
          ),
        );
        await audit(
          db,
          req.user.id,
          "status_" + req.input.status,
          "transaction",
          row.id,
          req.input.reason,
          auditChanges("transaction", current, row),
        );
        return row;
      });
      res.json(record(row));
    },
  );
  // DOCUMENTOS: guarda os dados informados e o vínculo; não emite ou valida uma nota na SEFAZ.
  app.post(
    "/api/documents",
    allow(...financial),
    body(schemas.document),
    async (req, res) => {
      const p = req.input;
      const row = await transaction(pool, async (db) => {
        requireRow(
          await db.query(
            "SELECT id FROM transactions WHERE id=$1 AND status<>'cancelled' FOR UPDATE",
            [p.transactionId],
          ),
        );
        const row = requireRow(
          await db.query(
            "INSERT INTO documents(transaction_id,number,kind,issued_on,amount_cents) VALUES($1,$2,$3,$4,$5) RETURNING *",
            [p.transactionId, p.number, p.kind, p.issuedOn, p.amountCents],
          ),
        );
        await audit(db, req.user.id, "created", "document", row.id);
        return row;
      });
      res.status(201).json(record(row));
    },
  );
  // A conferência compara valores e registra o responsável; divergências impedem a revisão.
  app.patch(
    "/api/documents/:id/status",
    allow(...financial),
    id,
    body(schemas.documentStatus),
    async (req, res) => {
      const row = await transaction(pool, async (db) => {
        const doc = requireRow(
          await db.query("SELECT * FROM documents WHERE id=$1 FOR UPDATE", [
            req.entityId,
          ]),
        );
        const tx = requireRow(
          await db.query("SELECT * FROM transactions WHERE id=$1 FOR UPDATE", [
            doc.transaction_id,
          ]),
        );
        if (
          req.input.status === "reviewed" &&
          (doc.amount_cents !== tx.amount_cents || tx.status === "cancelled")
        )
          throw new HttpError(
            409,
            "Corrija a divergência de valor ou o lançamento cancelado antes da conferência.",
          );
        const row = requireRow(
          await db.query(
            "UPDATE documents SET status=$1::varchar,reviewed_by=$2,reviewed_at=CASE WHEN $1::varchar='reviewed' THEN now() ELSE NULL END WHERE id=$3 RETURNING *",
            [
              req.input.status,
              req.input.status === "reviewed" ? req.user.id : null,
              doc.id,
            ],
          ),
        );
        await audit(
          db,
          req.user.id,
          "status_" + req.input.status,
          "document",
          row.id,
          req.input.reason,
          auditChanges("document", doc, row),
        );
        return row;
      });
      res.json(record(row));
    },
  );
  // USUÁRIOS: só administrador cria contas; a resposta nunca contém o hash de senha.
  app.post(
    "/api/users",
    allow("admin"),
    body(schemas.user),
    async (req, res) => {
      const p = req.input,
        hash = await hashPassword(p.password);
      await create(
        req,
        res,
        "user",
        "INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role,active,created_at",
        [p.name, p.email, hash, p.role],
      );
    },
  );
  app.patch(
    "/api/users/:id/active",
    allow("admin"),
    id,
    body(schemas.userActive),
    async (req, res) => {
      if (req.entityId === req.user.id)
        throw new HttpError(409, "Não é permitido desativar o próprio acesso.");
      const row = await transaction(pool, async (db) => {
        const current = requireRow(
          await db.query(
            "SELECT id,name,email,role,active FROM users WHERE id=$1 FOR UPDATE",
            [req.entityId],
          ),
        );
        const row = requireRow(
          await db.query(
            "UPDATE users SET active=$1 WHERE id=$2 RETURNING id,name,email,role,active,created_at",
            [req.input.active, req.entityId],
          ),
        );
        await db.query("DELETE FROM sessions WHERE user_id=$1", [row.id]);
        await audit(
          db,
          req.user.id,
          req.input.active ? "activated" : "deactivated",
          "user",
          row.id,
          req.input.reason,
          auditChanges("user", current, row),
          true,
        );
        return row;
      });
      res.json(record(row));
    },
  );
  // PRIVACIDADE: exporta cliente e vínculos em JSON, registrando quem solicitou.
  app.get("/api/customers/:id/export", allow("admin"), id, async (req, res) => {
    const data = await transaction(pool, async (db) => {
      const customer = requireRow(
        await db.query("SELECT * FROM customers WHERE id=$1 FOR SHARE", [
          req.entityId,
        ]),
      );
      const orders = await db.query(
        "SELECT * FROM orders WHERE customer_id=$1",
        [customer.id],
      );
      const transactions = await db.query(
        "SELECT * FROM transactions WHERE customer_id=$1",
        [customer.id],
      );
      const documents = await db.query(
        "SELECT d.* FROM documents d JOIN transactions t ON t.id=d.transaction_id WHERE t.customer_id=$1",
        [customer.id],
      );
      await audit(db, req.user.id, "privacy_export", "customer", customer.id);
      return {
        customer: record(customer),
        orders: orders.rows.map(record),
        transactions: transactions.rows.map(record),
        documents: documents.rows.map(record),
      };
    });
    res.json(data);
  });
  // Só remove contatos sem operações vinculadas; retenção fiscal exige análise do responsável.
  app.post(
    "/api/customers/:id/anonymize",
    allow("admin"),
    id,
    body(schemas.reason),
    async (req, res) => {
      const row = await transaction(pool, async (db) => {
        requireRow(
          await db.query("SELECT id FROM customers WHERE id=$1 FOR UPDATE", [
            req.entityId,
          ]),
        );
        const links = await db.query(
          "SELECT id FROM orders WHERE customer_id=$1 UNION ALL SELECT id FROM transactions WHERE customer_id=$1",
          [req.entityId],
        );
        if (links.rowCount)
          throw new HttpError(
            409,
            "Cadastro vinculado a operações. Revise a retenção e os registros com o responsável antes da exclusão.",
          );
        const row = requireRow(
          await db.query(
            "UPDATE customers SET name='Cadastro removido',email=NULL,phone=NULL,person_type=NULL,tax_id=NULL,tax_regime=NULL,trade_name=NULL,state_registration=NULL,municipal_registration=NULL,postal_code=NULL,street=NULL,address_number=NULL,complement=NULL,district=NULL,city=NULL,state=NULL,anonymized=true WHERE id=$1 RETURNING *",
            [req.entityId],
          ),
        );
        await audit(
          db,
          req.user.id,
          "contact_removed",
          "customer",
          row.id,
          req.input.reason,
        );
        return row;
      });
      res.json(record(row));
    },
  );
  // CONFIGURAÇÃO FINANCEIRA: uma linha compartilhada pela empresa, persistida e auditada.
  app.get("/api/business-settings", allow(...financial), async (req, res) => {
    res.json(
      record(
        requireRow(
          await pool.query(
            "SELECT tax_rate_basis_points,monthly_operating_costs_cents,updated_at FROM business_settings WHERE id=1",
          ),
        ),
      ),
    );
  });
  app.put(
    "/api/business-settings",
    allow(...financial),
    body(schemas.businessSettings),
    async (req, res) => {
      const row = await transaction(pool, async (db) => {
        const current = requireRow(
          await db.query(
            "SELECT tax_rate_basis_points,monthly_operating_costs_cents FROM business_settings WHERE id=1 FOR UPDATE",
          ),
        );
        const row = requireRow(
          await db.query(
            `UPDATE business_settings SET tax_rate_basis_points=$1,
        monthly_operating_costs_cents=$2,updated_by=$3,updated_at=now() WHERE id=1
        RETURNING tax_rate_basis_points,monthly_operating_costs_cents,updated_at`,
            [
              req.input.taxRateBasisPoints,
              req.input.monthlyOperatingCostsCents,
              req.user.id,
            ],
          ),
        );
        await audit(
          db,
          req.user.id,
          "financial_settings_updated",
          "business_settings",
          null,
          req.input.reason,
          auditChanges("business_settings", current, row),
          true,
        );
        return row;
      });
      res.json(record(row));
    },
  );
  app.get("/api/dashboard", allow(...financial), async (req, res) => {
    // Soma recebimentos/pagamentos do mês. Contadores operacionais continuam sendo globais.
    const query = schemas.dashboardQuery.parse(req.query);
    const month = query.month || currentBusinessMonth();
    res.json(await loadFinancialDashboard(pool, month));
  });
  // EXPORTAÇÃO: somente perfis financeiros; nenhum contato pessoal entra no resumo.
  app.get(
    "/api/reports/financial.xlsx",
    allow(...financial),
    async (req, res) => {
      const query = schemas.reportQuery.parse(req.query);
      const from = query.from || query.month || currentBusinessMonth();
      const to = query.to || from;
      const summary = await loadFinancialReport(pool, from, to);
      const file = await buildFinancialExcel(summary);
      await audit(
        pool,
        req.user.id,
        "financial_export",
        "financial_report",
        null,
        `Período: ${from} a ${to}`,
      );
      res.set(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.set(
        "Content-Disposition",
        `attachment; filename="financeiro-${from}${from === to ? "" : "_a_" + to}.xlsx"`,
      );
      res.send(file);
    },
  );
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Rota não encontrada." }),
  );
  // Em produção, a mesma aplicação também entrega o frontend compilado pelo Vite.
  const dist = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../client/dist",
  );
  app.use(express.static(dist, { index: false }));
  app.get("/{*path}", (req, res, next) =>
    res.sendFile(
      path.join(dist, "index.html"),
      (error) => error && next(error),
    ),
  );
  // Tratamento central: traduz erros de validação, banco e negócio em respostas HTTP.
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof ZodError)
      return res.status(400).json({
        error: "Dados inválidos. Confira os campos.",
        fields: error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
    if (
      error.code === "23505" &&
      error.constraint === "customers_company_tax_id"
    )
      return res.status(409).json({
        error:
          "Já existe um cliente com este CPF/CNPJ nesta empresa. Localize o cadastro existente para editar.",
      });
    if (error.code === "23505")
      return res.status(409).json({
        error: "Já existe um registro com esse identificador ou vínculo.",
      });
    if (error.code === "23503")
      return res
        .status(400)
        .json({ error: "O registro relacionado não existe." });
    if (error.code === "23514")
      return res
        .status(400)
        .json({ error: "A operação viola uma regra de integridade." });
    if (error.type === "entity.too.large")
      return res.status(413).json({ error: "Requisição muito grande." });
    if (error instanceof SyntaxError && error.status === 400)
      return res.status(400).json({ error: "JSON inválido." });
    if (error instanceof HttpError)
      return res.status(error.status).json({ error: error.message });
    // Detalhes de SQL, senhas e dados pessoais não são enviados nem registrados.
    console.error("Falha interna na API:", error.code || error.name);
    res.status(500).json({ error: "Não foi possível concluir a operação." });
  });
  return app;
}
