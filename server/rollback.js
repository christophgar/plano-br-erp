// Reversão compensatória: preserva o evento original e registra outra alteração com vínculo a ele.
import { audit, transaction } from "./db.js";
import { auditChanges, auditFields } from "./audit-changes.js";
import { schemas, requireRow, HttpError } from "./validation.js";

const camel = (field) =>
  field.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
const definitions = {
  customer: {
    table: "customers",
    actions: ["updated"],
    fields: auditFields.customer,
  },
  product: {
    table: "products",
    actions: ["stock_changed"],
    fields: ["quantity"],
  },
  user: {
    table: "users",
    actions: ["activated", "deactivated"],
    fields: ["active"],
  },
  business_settings: {
    table: "business_settings",
    actions: ["financial_settings_updated"],
    fields: auditFields.business_settings,
  },
};

export async function rollbackChange(
  pool,
  actor,
  eventId,
  reason,
  hasGeneralChange,
) {
  return transaction(pool, async (db) => {
    // RLS esconde eventos de outras empresas inclusive quando o identificador é conhecido.
    const event = requireRow(
      await db.query("SELECT * FROM audit_events WHERE id=$1", [eventId]),
    );
    const definition = definitions[event.entity];
    if (
      !event.reversible ||
      !definition?.actions.includes(event.action) ||
      !Array.isArray(event.changes) ||
      !event.changes.length
    )
      throw new HttpError(
        409,
        "Este evento não permite reversão automática. Use o fluxo normal da operação.",
      );
    if (event.entity === "user" && event.entity_id === actor.id)
      throw new HttpError(
        409,
        "Não é permitido reverter o acesso da própria conta.",
      );
    // Identificadores SQL vêm apenas da tabela fixa acima; todos os valores usam parâmetros.
    const current = requireRow(
      await db.query(
        `SELECT * FROM ${definition.table} WHERE id=$1 FOR UPDATE`,
        [event.entity === "business_settings" ? 1 : event.entity_id],
      ),
    );
    const reversed = await db.query(
      "SELECT 1 FROM audit_events WHERE reverses_event_id=$1",
      [eventId],
    );
    if (reversed.rowCount)
      throw new HttpError(409, "Esta alteração já foi desfeita.");
    const later = await db.query(
      `SELECT 1 FROM audit_events WHERE entity=$1 AND entity_id IS NOT DISTINCT FROM $2::uuid
      AND id>$3::bigint AND changes IS NOT NULL AND jsonb_array_length(changes)>0 LIMIT 1`,
      [event.entity, event.entity_id, event.id],
    );
    if (later.rowCount)
      throw new HttpError(
        409,
        "O registro foi alterado novamente. Não é seguro desfazer este evento antigo.",
      );
    if (event.entity === "customer" && current.anonymized)
      throw new HttpError(
        409,
        "Não é permitido restaurar dados pessoais removidos.",
      );
    if (event.entity === "user") {
      // Mudanças de acesso feitas no painel geral também impedem reverter um evento anterior.
      if (await hasGeneralChange(current.company_id, event.created_at))
        throw new HttpError(
          409,
          "Houve uma alteração de contas pela administração geral. Faça uma nova alteração de acesso em vez de reverter o histórico.",
        );
    }
    const restored = { ...current };
    const columns = [];
    for (const change of event.changes) {
      const field = definition.fields.find(
        (column) => camel(column) === change.field,
      );
      if (!field || columns.includes(field))
        throw new HttpError(
          409,
          "Comparativo incompatível com uma reversão segura.",
        );
      if ((current[field] ?? null) !== change.after)
        throw new HttpError(
          409,
          "O valor atual é diferente do evento. Atualize a auditoria.",
        );
      restored[field] = change.before;
      columns.push(field);
    }
    // Valida o cadastro completo, inclusive CPF/CNPJ e limites de valores, antes de restaurar.
    if (event.entity === "customer")
      schemas.customer.parse(
        Object.fromEntries(
          definition.fields.map((field) => [camel(field), restored[field]]),
        ),
      );
    if (event.entity === "business_settings")
      schemas.businessSettings.parse({
        taxRateBasisPoints: restored.tax_rate_basis_points,
        monthlyOperatingCostsCents: restored.monthly_operating_costs_cents,
        reason,
      });
    if (event.entity === "user" && typeof restored.active !== "boolean")
      throw new HttpError(409, "Valor de acesso inválido no evento.");
    if (
      event.entity === "product" &&
      (!Number.isInteger(restored.quantity) ||
        restored.quantity < 0 ||
        restored.quantity > 1000000)
    )
      throw new HttpError(
        409,
        "A reversão ultrapassaria os limites de estoque.",
      );
    const updateColumns =
      event.entity === "business_settings"
        ? [...columns, "updated_by"]
        : columns;
    const result = requireRow(
      await db.query(
        `UPDATE ${definition.table} SET ${updateColumns.map((field, index) => `${field}=$${index + 1}`).join(",")}${event.entity === "business_settings" ? ",updated_at=now()" : ""}
      WHERE id=$${updateColumns.length + 1} RETURNING *`,
        [
          ...updateColumns.map((field) =>
            field === "updated_by" ? actor.id : restored[field],
          ),
          current.id,
        ],
      ),
    );
    if (event.entity === "user")
      await db.query("DELETE FROM sessions WHERE user_id=$1", [current.id]);
    if (event.entity === "product")
      await db.query(
        "INSERT INTO stock_movements(product_id,delta,reason,actor_id) VALUES($1,$2,$3,$4)",
        [current.id, result.quantity - current.quantity, reason, actor.id],
      );
    const newEventId = await audit(
      db,
      actor.id,
      "rolled_back",
      event.entity,
      event.entity_id,
      reason,
      auditChanges(event.entity, current, result),
      false,
      event.id,
    );
    return { ok: true, eventId: newEventId, reversesEventId: event.id };
  });
}
