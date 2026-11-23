// Comando local explícito: promove uma conta existente. Nunca aceita promoção pela API pública.
import { readConfig } from "../server/config.js";
import { createPool, transaction } from "../server/db.js";
const email = process.argv[2]?.trim().toLowerCase();
if (!email || !email.includes("@"))
  throw new Error("Use npm run platform:grant -- email-da-sua-conta");
const pool = createPool(readConfig().databaseUrl);
try {
  await transaction(pool, async (db) => {
    const result = await db.query(
      "UPDATE users SET is_platform_admin=true,role='admin',company_id=NULL WHERE email=$1 AND active RETURNING id",
      [email],
    );
    if (!result.rowCount)
      throw new Error("Conta ativa não encontrada. Nenhuma conta foi criada.");
    await db.query("DELETE FROM sessions WHERE user_id=$1", [
      result.rows[0].id,
    ]);
    await db.query(
      "INSERT INTO platform_events(actor_id,action,reason) VALUES($1,'platform_granted','Promoção explícita por comando local do responsável pela implantação.')",
      [result.rows[0].id],
    );
  });
  console.log(
    "Conta autorizada como administrador geral. Entre novamente no sistema.",
  );
} finally {
  await pool.end();
}
