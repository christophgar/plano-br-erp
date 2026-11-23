// Contexto por requisição: duas empresas simultâneas nunca compartilham o mesmo identificador.
import { AsyncLocalStorage } from "node:async_hooks";
const context = new AsyncLocalStorage();
export const withCompany = (company, work) => context.run(company, work);

export function tenantPool(rawPool) {
  async function connect() {
    const company = context.getStore();
    if (!company?.id)
      throw new Error("Consulta empresarial sem contexto de empresa.");
    const client = await rawPool.connect();
    let initialized = false;
    return {
      async query(sql, values) {
        // Inicializa depois de BEGIN/SET TRANSACTION para permitir relatórios REPEATABLE READ.
        if (
          !initialized &&
          !/^\s*(BEGIN|SET TRANSACTION|ROLLBACK|COMMIT)\b/i.test(sql)
        ) {
          await client.query("SET LOCAL ROLE erp_tenant");
          await client.query(
            "SELECT set_config('app.company_id',$1,true),set_config('app.actor_name',$2,true)",
            [company.id, company.actorName || ""],
          );
          initialized = true;
        }
        return client.query(sql, values);
      },
      // transaction() sempre confirma/desfaz antes de liberar; SET LOCAL não vaza para a conexão seguinte.
      release: () => client.release(),
    };
  }
  return {
    connect,
    async query(sql, values) {
      const client = await connect();
      try {
        await client.query("BEGIN");
        const result = await client.query(sql, values);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
