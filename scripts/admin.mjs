// Cria somente o primeiro administrador usando o arquivo privado gerado pelo setup.
import { readFile, unlink } from "node:fs/promises";
import { readConfig } from "../server/config.js";
import { createPool, transaction } from "../server/db.js";
import { hashPassword } from "../server/security.js";
import { schemas } from "../server/validation.js";
const data = JSON.parse(await readFile(".local/bootstrap.json", "utf8"));
const input = schemas.user.parse({ ...data, role: "admin" });
const hash = await hashPassword(input.password);
const pool = createPool(readConfig().databaseUrl);
try {
  await transaction(pool, async (db) => {
    // O bloqueio evita criar dois administradores iniciais ao executar o comando simultaneamente.
    await db.query("LOCK TABLE users IN EXCLUSIVE MODE");
    const count = await db.query("SELECT count(*) FROM users");
    if (Number(count.rows[0].count))
      throw new Error(
        "Já existem usuários. Use a tela administrativa; nenhuma conta foi alterada.",
      );
    await db.query(
      "INSERT INTO users(name,email,password_hash,role,is_platform_admin,company_id) VALUES($1,$2,$3,'admin',true,NULL)",
      [input.name, input.email, hash],
    );
  });
  // A senha já virou hash no banco; remove a cópia temporária usada na inicialização.
  await unlink(".local/bootstrap.json");
  console.log(
    "Administrador inicial criado. A senha está no arquivo local de acesso.",
  );
} finally {
  await pool.end();
}
