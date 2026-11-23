// Cria/usa erp_test no PostgreSQL local e executa os testes sem tocar no banco erp.
import { spawnSync } from "node:child_process";
import "dotenv/config";
import pg from "pg";
const source = process.env.DATABASE_URL;
if (!source) throw new Error("Execute npm run setup primeiro.");
const url = new URL(source);
if (!["localhost", "127.0.0.1"].includes(url.hostname))
  throw new Error("Este auxiliar cria banco de testes somente no host local.");
url.pathname = "/postgres";
const client = new pg.Client({ connectionString: url.toString() });
try {
  await client.connect();
  const exists = await client.query(
    "SELECT 1 FROM pg_database WHERE datname='erp_test'",
  );
  if (!exists.rowCount) await client.query("CREATE DATABASE erp_test");
} finally {
  await client.end();
}
url.pathname = "/erp_test";
const result = spawnSync(
  process.execPath,
  [
    "--test",
    "--test-concurrency=1",
    "server/tests/input-rules.test.js",
    "server/tests/cnpj.test.js",
    "server/tests/audit-changes.test.js",
    "server/tests/integration.test.js",
  ],
  {
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, TEST_DATABASE_URL: url.toString() },
  },
);
process.exit(result.status ?? 1);
