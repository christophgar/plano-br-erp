// Lista explícita de campos auditáveis: nunca copie o objeto inteiro, senhas, hashes ou tokens.
export const auditFields = {
  customer: [
    "name",
    "email",
    "phone",
    "person_type",
    "tax_id",
    "tax_regime",
    "trade_name",
    "state_registration",
    "municipal_registration",
    "postal_code",
    "street",
    "address_number",
    "complement",
    "district",
    "city",
    "state",
  ],
  product: ["name", "sku", "quantity", "unit_price_cents"],
  order: [
    "customer_id",
    "description",
    "amount_cents",
    "status",
    "stock_deducted",
  ],
  transaction: [
    "type",
    "description",
    "amount_cents",
    "due_date",
    "status",
    "paid_at",
    "customer_id",
    "order_id",
  ],
  document: [
    "number",
    "kind",
    "issued_on",
    "amount_cents",
    "status",
    "reviewed_by",
    "reviewed_at",
  ],
  user: ["name", "email", "role", "active"],
  business_settings: ["tax_rate_basis_points", "monthly_operating_costs_cents"],
};
const value = (input) =>
  input instanceof Date ? input.toISOString() : (input ?? null);
export function auditChanges(entity, before, after) {
  return (auditFields[entity] || []).flatMap((field) => {
    const previous = value(before[field]),
      next = value(after[field]);
    return previous === next
      ? []
      : [
          {
            field: field.replace(/_([a-z])/g, (_, letter) =>
              letter.toUpperCase(),
            ),
            before: previous,
            after: next,
          },
        ];
  });
}
