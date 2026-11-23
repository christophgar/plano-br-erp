// Lê .env local ou variáveis do ambiente; nenhum valor secreto é escrito no código.
import "dotenv/config";

export function readConfig(env = process.env) {
  // Falha cedo se uma configuração essencial estiver ausente, antes de abrir o servidor.
  const production = env.NODE_ENV === "production";
  const jwtSecret = env.JWT_SECRET || "";
  if (jwtSecret.length < 64)
    throw new Error(
      "Configure JWT_SECRET com pelo menos 64 caracteres aleatórios.",
    );
  const appOrigin = env.APP_ORIGIN || "http://localhost:5173";
  const url = new URL(appOrigin);
  if (url.origin !== appOrigin)
    throw new Error("APP_ORIGIN deve conter somente protocolo, host e porta.");
  if (production && url.protocol !== "https:")
    throw new Error("Produção exige APP_ORIGIN com HTTPS.");
  if (!env.DATABASE_URL)
    throw new Error("Configure DATABASE_URL no ambiente local.");
  return {
    production,
    jwtSecret,
    appOrigin,
    databaseUrl: env.DATABASE_URL,
    port: Number(env.PORT || 3001),
    host: env.HOST || "127.0.0.1",
    trustProxy: Number(env.TRUST_PROXY || 0),
    cookieName: production ? "__Secure-erp_session" : "erp_session",
  };
}
