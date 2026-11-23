// Administração da plataforma: nenhuma rota depende de perfil enviado pelo navegador.
import { z } from "zod";
import { transaction, record } from "./db.js";
import { verifyPassword, hashPassword } from "./security.js";
import { body, schemas, password, HttpError } from "./validation.js";
import { validCnpj, normalizeTaxId } from "../shared/brazil.js";
import { rateLimit } from "express-rate-limit";
import { dateRule } from "../shared/fieldRules.js";

const auditQuery = z
  .object({ from: dateRule.optional(), to: dateRule.optional() })
  .strict()
  .refine(
    (p) => !p.from || !p.to || p.from <= p.to,
    "A data inicial deve ser anterior ou igual à final.",
  );

const reason = z.string().trim().min(10).max(200);
const confirmation = { currentPassword: z.string().min(1).max(128), reason };
const companyFields = {
  name: z.string().trim().min(2).max(120),
  taxId: z
    .string()
    .transform(normalizeTaxId)
    .refine(validCnpj, "CNPJ inválido."),
};
export async function platformEvent(db, actor, company, action, reason) {
  await db.query(
    "INSERT INTO platform_events(actor_id,company_id,action,reason) VALUES($1,$2,$3,$4)",
    [actor, company, action, reason.slice(0, 200)],
  );
}

export function platformRoutes(app, pool) {
  app.use("/api/platform", (req, res, next) => {
    if (!req.user.is_platform_admin)
      throw new HttpError(403, "Acesso exclusivo do administrador geral.");
    next();
  });
  const confirmationLimit = rateLimit({
    windowMs: 60000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: "Muitas confirmações administrativas. Aguarde um minuto.",
    },
  });
  app.use("/api/platform", (req, res, next) =>
    req.method === "GET" ? next() : confirmationLimit(req, res, next),
  );
  async function reauthenticate(req, res, next) {
    if (
      !(await verifyPassword(req.input.currentPassword, req.user.password_hash))
    )
      throw new HttpError(403, "Confirmação de senha inválida.");
    next();
  }
  async function companyId(req, res, next) {
    if (!z.uuid().safeParse(req.params.id).success)
      throw new HttpError(400, "Empresa inválida.");
    const exists = await pool.query(
      "SELECT 1 FROM companies WHERE id=$1 AND NOT is_internal",
      [req.params.id],
    );
    if (!exists.rowCount)
      throw new HttpError(404, "Empresa cliente não encontrada.");
    next();
  }
  app.get("/api/platform/companies", async (req, res) => {
    const result =
      await pool.query(`SELECT c.*,(SELECT count(*) FROM users u WHERE u.company_id=c.id AND NOT u.is_platform_admin) AS users_count
      FROM companies c WHERE NOT c.is_internal ORDER BY c.created_at DESC LIMIT 500`);
    res.json({ items: result.rows.map(record) });
  });
  app.post(
    "/api/platform/companies",
    body(
      z
        .object({
          ...companyFields,
          ...confirmation,
          admin: schemas.user.omit({ role: true }),
        })
        .strict(),
    ),
    reauthenticate,
    async (req, res) => {
      const p = req.input,
        hash = await hashPassword(p.admin.password);
      const company = await transaction(pool, async (db) => {
        const result = await db.query(
          "INSERT INTO companies(name,tax_id) VALUES($1,$2) RETURNING *",
          [p.name, p.taxId],
        );
        const company = result.rows[0];
        await db.query(
          "INSERT INTO business_settings(company_id,id) VALUES($1,1)",
          [company.id],
        );
        await db.query(
          "INSERT INTO users(company_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,'admin')",
          [company.id, p.admin.name, p.admin.email, hash],
        );
        await platformEvent(
          db,
          req.user.id,
          company.id,
          "company_created",
          p.reason,
        );
        return company;
      });
      res.status(201).json(record(company));
    },
  );
  app.patch(
    "/api/platform/companies/:id",
    companyId,
    body(
      z
        .object({ ...companyFields, ...confirmation, active: z.boolean() })
        .strict(),
    ),
    reauthenticate,
    async (req, res) => {
      const p = req.input;
      const company = await transaction(pool, async (db) => {
        const result = await db.query(
          "UPDATE companies SET name=$1,tax_id=$2,active=$3 WHERE id=$4 RETURNING *",
          [p.name, p.taxId, p.active, req.params.id],
        );
        if (!result.rowCount)
          throw new HttpError(404, "Empresa não encontrada.");
        if (!p.active) {
          await db.query(
            "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE company_id=$1 AND NOT is_platform_admin)",
            [req.params.id],
          );
          await db.query("DELETE FROM support_access WHERE company_id=$1", [
            req.params.id,
          ]);
        }
        await platformEvent(
          db,
          req.user.id,
          req.params.id,
          p.active ? "company_updated" : "company_suspended",
          p.reason,
        );
        return result.rows[0];
      });
      res.json(record(company));
    },
  );
  app.get("/api/platform/companies/:id/users", companyId, async (req, res) => {
    await platformEvent(
      pool,
      req.user.id,
      req.params.id,
      "company_users_viewed",
      "Consulta de contas para administração da empresa.",
    );
    const result = await pool.query(
      "SELECT id,name,email,role,active FROM users WHERE company_id=$1 AND NOT is_platform_admin ORDER BY name",
      [req.params.id],
    );
    res.json({ items: result.rows });
  });
  app.patch(
    "/api/platform/companies/:id/users/:userId",
    companyId,
    body(
      z
        .object({
          ...confirmation,
          active: z.boolean().optional(),
          newPassword: password.optional(),
        })
        .strict()
        .refine(
          (p) => p.active !== undefined || p.newPassword,
          "Informe uma alteração.",
        ),
    ),
    reauthenticate,
    async (req, res) => {
      if (!z.uuid().safeParse(req.params.userId).success)
        throw new HttpError(400, "Usuário inválido.");
      const p = req.input;
      const hash = p.newPassword ? await hashPassword(p.newPassword) : null;
      await transaction(pool, async (db) => {
        const result = await db.query(
          "UPDATE users SET active=COALESCE($1,active),password_hash=COALESCE($2,password_hash),failed_attempts=0,locked_until=NULL WHERE id=$3 AND company_id=$4 AND NOT is_platform_admin RETURNING id",
          [p.active ?? null, hash, req.params.userId, req.params.id],
        );
        if (!result.rowCount)
          throw new HttpError(404, "Usuário não encontrado nesta empresa.");
        await db.query("DELETE FROM sessions WHERE user_id=$1", [
          req.params.userId,
        ]);
        await platformEvent(
          db,
          req.user.id,
          req.params.id,
          hash ? "company_user_password_reset" : "company_user_access_changed",
          p.reason,
        );
      });
      res.json({ ok: true });
    },
  );
  async function eventsFor(companyId, query) {
    const dates = auditQuery.parse(query);
    // Datas incluem o dia inteiro no horário de Brasília. Filtra ANTES de limitar a 200 linhas.
    return pool.query(
      `SELECT e.id,e.action,e.reason,e.created_at,u.name AS actor_name,c.name AS company_name
      FROM platform_events e JOIN users u ON u.id=e.actor_id LEFT JOIN companies c ON c.id=e.company_id
      WHERE e.company_id IS NOT DISTINCT FROM $1::uuid
      AND ($2::date IS NULL OR e.created_at >= ($2::date::timestamp AT TIME ZONE 'America/Sao_Paulo'))
      AND ($3::date IS NULL OR e.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'))
      ORDER BY e.created_at DESC,e.id DESC LIMIT 200`,
      [companyId, dates.from || null, dates.to || null],
    );
  }
  app.get("/api/platform/events", async (req, res) => {
    const result = await eventsFor(null, req.query);
    res.json({ items: result.rows.map(record) });
  });
  // Filtra pela empresa ANTES do limite: eventos de outra empresa não ocupam esta página.
  app.get("/api/platform/companies/:id/events", companyId, async (req, res) => {
    const result = await eventsFor(req.params.id, req.query);
    res.json({ items: result.rows.map(record) });
  });
  app.post(
    "/api/platform/support",
    body(
      z
        .object({
          ...confirmation,
          companyId: z.uuid(),
          writable: z.boolean().default(false),
        })
        .strict(),
    ),
    reauthenticate,
    async (req, res) => {
      const p = req.input;
      await transaction(pool, async (db) => {
        const company = await db.query(
          "SELECT id FROM companies WHERE id=$1 AND active AND NOT is_internal FOR SHARE",
          [p.companyId],
        );
        if (!company.rowCount)
          throw new HttpError(409, "Empresa inexistente ou suspensa.");
        // Uma única empresa por sessão; trocar exige encerrar o suporte atual.
        const existing = await db.query(
          "SELECT 1 FROM support_access WHERE session_id=$1 AND expires_at>now()",
          [req.sid],
        );
        if (existing.rowCount)
          throw new HttpError(
            409,
            "Encerre o suporte atual antes de trocar de empresa.",
          );
        await db.query(
          `INSERT INTO support_access(session_id,company_id,reason,writable,expires_at) VALUES($1,$2,$3,$4,now()+interval '15 minutes')
        ON CONFLICT(session_id) DO UPDATE SET company_id=EXCLUDED.company_id,reason=EXCLUDED.reason,writable=EXCLUDED.writable,expires_at=EXCLUDED.expires_at`,
          [req.sid, p.companyId, p.reason, p.writable],
        );
        await platformEvent(
          db,
          req.user.id,
          p.companyId,
          p.writable ? "support_started_write" : "support_started_read",
          p.reason,
        );
      });
      res.json({ ok: true });
    },
  );
  app.post("/api/platform/support/end", async (req, res) => {
    await transaction(pool, async (db) => {
      const result = await db.query(
        "DELETE FROM support_access WHERE session_id=$1 RETURNING company_id,reason",
        [req.sid],
      );
      if (result.rowCount)
        await platformEvent(
          db,
          req.user.id,
          result.rows[0].company_id,
          "support_ended",
          result.rows[0].reason,
        );
    });
    res.json({ ok: true });
  });
}
