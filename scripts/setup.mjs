// Preparação inicial: gera segredos locais e, opcionalmente, um PostgreSQL isolado.
// Não execute novamente para trocar senhas: o script preserva um .env existente.
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import pg from "pg";

// Arquivos gerados aqui são locais e ignorados pelo Git.
if (existsSync(".env")) {
  console.log("O .env já existe. Nenhuma configuração foi sobrescrita.");
  process.exit(0);
}
await mkdir(".local", { recursive: true });
// Cada instalação recebe credenciais novas. O terminal imprime caminhos, nunca as senhas.
let dbPassword = randomBytes(32).toString("hex");
const jwtSecret = randomBytes(64).toString("hex");
const adminPassword = randomBytes(24).toString("base64url");
const native = process.argv.includes("--local-postgres");
let dbUser = "erp";
if (native) {
  // --local-postgres cria um cluster próprio; não usa o banco instalado como serviço no Windows.
  const bin = process.env.PG_BIN || "C:/Program Files/PostgreSQL/18/bin";
  const exe = (name) =>
    path.join(bin, name + (process.platform === "win32" ? ".exe" : ""));
  if (!existsSync(exe("initdb")))
    throw new Error(
      "Informe PG_BIN apontando para os executáveis do PostgreSQL.",
    );
  const data = path.resolve(".local/pgdata");
  const resume = process.argv.includes("--resume-local") && existsSync(data);
  if (existsSync(data) && !resume)
    throw new Error(
      "Já existe um cluster local. Use --resume-local somente para retomar este setup interrompido.",
    );
  const pwfile = path.resolve(".local/pg-init-password");
  if (resume) dbPassword = (await readFile(pwfile, "utf8")).trim();
  else await writeFile(pwfile, dbPassword, { mode: 0o600 });
  // Executa utilitários oficiais do PostgreSQL com argumentos separados, sem montar comando SQL em shell.
  const run = (name, args) => {
    const result = spawnSync(exe(name), args, {
      encoding: "utf8",
      windowsHide: true,
      stdio: "ignore",
    });
    if (result.status !== 0)
      throw new Error(
        `${name} falhou: ${result.stderr || result.error?.message || "verifique a porta 55439"}`,
      );
  };
  if (!resume)
    run("initdb", [
      "-D",
      data,
      "-U",
      "erp",
      "--pwfile",
      pwfile,
      "--auth=scram-sha-256",
      "--encoding=UTF8",
      "--locale=C",
    ]);
  await writeFile(
    path.join(data, "postgresql.auto.conf"),
    "listen_addresses = '127.0.0.1'\nport = 55439\n",
    { mode: 0o600 },
  );
  const running =
    spawnSync(exe("pg_ctl"), ["-D", data, "status"], {
      stdio: "ignore",
      windowsHide: true,
    }).status === 0;
  if (!running)
    run("pg_ctl", [
      "-D",
      data,
      "-l",
      path.resolve(".local/postgres.log"),
      "-w",
      "start",
    ]);
  const admin = new pg.Client({
    connectionString: `postgresql://${dbUser}:${dbPassword}@127.0.0.1:55439/postgres`,
  });
  try {
    await admin.connect();
    if (
      !(await admin.query("SELECT 1 FROM pg_database WHERE datname='erp'"))
        .rowCount
    )
      await admin.query("CREATE DATABASE erp");
  } finally {
    await admin.end();
  }
  // O arquivo de senha inicial também permanece em diretório privado e ignorado.
}
// Estes valores são gravados só no .env ignorado. flag wx impede sobrescrever arquivo existente.
const env = [
  "NODE_ENV=development",
  "HOST=127.0.0.1",
  "PORT=3001",
  "APP_ORIGIN=http://localhost:5173",
  "TRUST_PROXY=0",
  `DATABASE_URL=postgresql://${dbUser}:${dbPassword}@127.0.0.1:55439/erp`,
  `POSTGRES_PASSWORD=${dbPassword}`,
  `JWT_SECRET=${jwtSecret}`,
  "",
].join("\n");
await writeFile(".env", env, { flag: "wx", mode: 0o600 });
await writeFile(
  ".local/bootstrap.json",
  JSON.stringify({
    name: "Administrador",
    email: "admin@erp.test",
    password: adminPassword,
  }),
  { flag: "wx", mode: 0o600 },
);
await writeFile(
  ".local/acesso-local.txt",
  `Acesso inicial local\nE-mail: admin@erp.test\nSenha: ${adminPassword}\n\nGuarde a senha em local seguro. Este arquivo não deve ser compartilhado.\n`,
  { mode: 0o600 },
);
console.log(
  "Configuração local criada. Credenciais em .local/acesso-local.txt (não versionado).",
);
console.log(
  native
    ? "PostgreSQL isolado iniciado na porta 55439."
    : "Próximo passo: docker compose up -d db",
);
console.log("Depois execute: npm run db:migrate e npm run admin:create");
