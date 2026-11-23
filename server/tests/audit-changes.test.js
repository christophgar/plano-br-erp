import { test } from "node:test";
import assert from "node:assert/strict";
import { auditChanges } from "../audit-changes.js";

test("comparativo registra só campos permitidos que realmente mudaram", () => {
  assert.deepEqual(
    auditChanges(
      "customer",
      { name: "Antes", email: null, city: "Igual" },
      { name: "Depois", email: "novo@example.test", city: "Igual" },
    ),
    [
      { field: "name", before: "Antes", after: "Depois" },
      { field: "email", before: null, after: "novo@example.test" },
    ],
  );
  assert.deepEqual(
    auditChanges("customer", { name: "Igual" }, { name: "Igual" }),
    [],
  );
});
test("senhas, hashes, tokens e escopo de empresa nunca entram nos comparativos", () => {
  const before = {
    active: true,
    password_hash: "hash-antigo",
    password: "senha-antiga",
    token: "token-antigo",
    company_id: "empresa-a",
  };
  const after = {
    active: false,
    password_hash: "hash-novo",
    password: "senha-nova",
    token: "token-novo",
    company_id: "empresa-b",
  };
  assert.deepEqual(auditChanges("user", before, after), [
    { field: "active", before: true, after: false },
  ]);
  assert.deepEqual(auditChanges("desconhecido", before, after), []);
});
test("datas e centavos mantêm os valores exatos do banco", () => {
  const paid = new Date("2026-07-01T03:00:00Z");
  assert.deepEqual(
    auditChanges(
      "transaction",
      { status: "pending", paid_at: null },
      { status: "paid", paid_at: paid },
    ),
    [
      { field: "status", before: "pending", after: "paid" },
      { field: "paidAt", before: null, after: paid.toISOString() },
    ],
  );
  assert.deepEqual(
    auditChanges(
      "business_settings",
      { tax_rate_basis_points: 625 },
      { tax_rate_basis_points: 700 },
    ),
    [{ field: "taxRateBasisPoints", before: 625, after: 700 }],
  );
});
