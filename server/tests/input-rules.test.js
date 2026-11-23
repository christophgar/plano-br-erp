// Casos de erro de digitação/colagem e limites compartilhados entre tela e API.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatInput,
  formatShiftedDecimal,
  validateInput,
} from "../../client/src/inputRules.js";
import { schemas } from "../validation.js";
import { validCpf, validCnpj, maskTaxId } from "../../shared/brazil.js";

test("alterações exigem motivo de 10 a 200 caracteres depois de remover espaços nas pontas", () => {
  for (const [schema, data] of [
    [schemas.stock, { delta: 1 }],
    [schemas.orderStatus, { status: "in_progress" }],
    [schemas.transactionStatus, { status: "paid" }],
    [schemas.documentStatus, { status: "reviewed" }],
    [schemas.userActive, { active: false }],
    [
      schemas.businessSettings,
      { taxRateBasisPoints: 625, monthlyOperatingCostsCents: null },
    ],
  ]) {
    for (const reason of [
      undefined,
      "",
      "         ",
      "123456789",
      "  curto  ",
      "x".repeat(201),
    ])
      assert.equal(schema.safeParse({ ...data, reason }).success, false);
    assert.equal(
      schema.safeParse({ ...data, reason: "  1234567890  " }).data.reason,
      "1234567890",
    );
  }
});

test("máscara desloca centavos sem precisar apagar os zeros iniciais", () => {
  assert.equal(formatShiftedDecimal("0,001", "0,00", "percent").value, "0,01");
  assert.equal(formatShiftedDecimal("0,010", "0,01", "percent").value, "0,10");
  assert.equal(formatShiftedDecimal("0,100", "0,10", "percent").value, "1,00");
  assert.equal(formatShiftedDecimal("1,0", "1,00", "percent").value, "0,10");
  assert.equal(formatShiftedDecimal("", "1,00", "money").value, "");
  assert.equal(formatShiftedDecimal("625", "", "percent").value, "6,25");
  assert.equal(
    formatShiftedDecimal("100,001", "100,00", "percent").value,
    "100,00",
  );
  assert.equal(formatShiftedDecimal("abc", "0,00", "percent").value, "0,00");
});

test("percentual e moeda bloqueiam letras, excesso de casas e limites", () => {
  assert.equal(formatInput("100,01", "10", "percent").value, "10");
  assert.equal(formatInput("abc", "6,25", "percent").value, "6,25");
  assert.equal(formatInput("6.25", "", "percent").value, "6,25");
  assert.equal(formatInput("1,234", "1,23", "money").value, "1,23");
  assert.equal(formatInput("1000000,01", "1", "money").value, "1");
  assert.equal(
    validateInput("0", { format: "money", required: true, min: 0.01 }).length >
      0,
    true,
  );
  assert.equal(validateInput("100,00", { format: "percent" }), "");
});
test("inteiros e telefone recebem a formatação apropriada", () => {
  assert.equal(formatInput("1.5", "1", "integer").value, "1");
  assert.equal(formatInput("-2", "", "signedInteger").value, "-2");
  assert.ok(validateInput("0", { format: "signedInteger", nonZero: true }));
  assert.equal(
    formatInput("49999999999", "", "phone").value,
    "(49) 99999-9999",
  );
  assert.equal(validateInput("(49) 99999-9999", { format: "phone" }), "");
  assert.ok(validateInput("000000000", { format: "phone" }));
  assert.equal(validateInput("+5549999999999", { format: "phone" }), "");
});
test("datas, e-mail, textos e códigos são validados também na API", () => {
  assert.ok(validateInput("nome@", { format: "email" }));
  assert.ok(validateInput("2026-02-30", { format: "date" }));
  assert.equal(validateInput("2028-02-29", { format: "date" }), "");
  assert.ok(validateInput("   ", { required: true }));
  assert.ok(validateInput("abc", { format: "password", minLength: 12 }));
  assert.equal(formatInput("A B", "AB", "code").value, "AB");
  assert.equal(
    schemas.customer.safeParse({ name: "Teste", phone: "abc" }).success,
    false,
  );
  assert.equal(
    schemas.customer.safeParse({
      name: "Teste",
      phone: "(49) 99999-9999",
      personType: "PF",
      taxId: "12345678909",
      taxRegime: "not_applicable",
      postalCode: "12345678",
      street: "Rua de Teste",
      addressNumber: "10",
      district: "Centro",
      city: "Teste",
      state: "SC",
    }).success,
    true,
  );
  assert.equal(
    schemas.product.safeParse({
      name: "Teste",
      sku: "A B",
      quantity: 1,
      unitPriceCents: 100,
    }).success,
    false,
  );
  assert.equal(
    schemas.customer.safeParse({ name: "Teste\u0000" }).success,
    false,
  );
});
test("CPF, CNPJ numérico/alfanumérico e CEP têm máscara e validação de dígitos", () => {
  assert.equal(validCpf("123.456.789-09"), true);
  assert.equal(validCpf("11111111111"), false);
  assert.equal(validCnpj("12.ABC.345/01DE-35"), true);
  assert.equal(validCnpj("12.ABC.345/01DE-36"), false);
  assert.equal(maskTaxId("12ABC34501DE35", "PJ"), "12.ABC.345/01DE-35");
  assert.equal(formatInput("12345678", "", "postal").value, "12345-678");
  assert.ok(validateInput("00000-000", { format: "postal" }));
});
