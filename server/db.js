// Camada pequena de acesso ao PostgreSQL, sem ORM: os comandos SQL ficam explícitos.
import pg from "pg";

// DATE não tem fuso: preservar YYYY-MM-DD evita mudar o vencimento no navegador.
pg.types.setTypeParser(1082, (value) => value);

// O driver mantém a validação TLS padrão quando a URL exige SSL.
export const createPool = (connectionString) =>
  // Reutiliza até dez conexões em vez de abrir uma nova a cada consulta.
  new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
  });

export async function transaction(pool, work) {
  // work recebe uma conexão exclusiva: ou todas as alterações são confirmadas ou todas desfeitas.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function record(row) {
  // O SQL usa snake_case (amount_cents); o JSON da tela usa camelCase (amountCents).
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
      value,
    ]),
  );
}

// Comparativos são montados por lista de campos permitidos; nunca recebem senha ou token.
export async function audit(
  db,
  userId,
  action,
  entity,
  entityId,
  reason = null,
  changes = null,
  reversible = false,
  reversesEventId = null,
) {
  const result = await db.query(
    "INSERT INTO audit_events (actor_id,action,entity,entity_id,reason,changes,reversible,reverses_event_id) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING id",
    [
      userId,
      action,
      entity,
      entityId,
      reason,
      changes === null ? null : JSON.stringify(changes),
      !!(reversible && changes?.length),
      reversesEventId,
    ],
  );
  return result.rows[0].id;
}
