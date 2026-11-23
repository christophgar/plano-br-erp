import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { readConfig } from "./config.js";
import { createPool, transaction } from "./db.js";

export async function migrate(pool) {
  // Executa o schema de forma idempotente: IF NOT EXISTS preserva tabelas já criadas.
  const sql = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  const tenancy = await readFile(new URL("./tenancy.sql", import.meta.url), "utf8");
  await transaction(pool, async (db) => {
    // Esse identificador fixo impede duas migrações simultâneas desta aplicação.
    await db.query("SELECT pg_advisory_xact_lock(27814001)");
    await db.query(sql);
    await db.query(tenancy);
  });
}
// Só executa a linha de comando quando chamado diretamente, não quando importado pelos testes.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const pool = createPool(readConfig().databaseUrl);
  try {
    await migrate(pool);
    console.log("Estrutura do banco pronta.");
  } finally {
    await pool.end();
  }
}
