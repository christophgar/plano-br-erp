// Entrada da API: configuração -> banco -> aplicação Express -> porta HTTP.
import { readConfig } from "./config.js";
import { createPool } from "./db.js";
import { createApp } from "./app.js";

const config = readConfig();
const pool = createPool(config.databaseUrl);
await pool.query("SELECT 1");
const app = createApp(pool, config);
const server = app.listen(config.port, config.host, () =>
  console.log(`ERP disponível em http://${config.host}:${config.port}`),
);
for (const signal of ["SIGTERM", "SIGINT"])
  // Encerra conexões ao receber Ctrl+C ou o sinal de parada do processo.
  process.on(signal, () => {
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  });
