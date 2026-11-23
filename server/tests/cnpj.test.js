// Respostas simuladas: testes não consomem a cota de serviços externos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lookupCnpj } from "../cnpj.js";

const cnpj = "00000000000191";
test("consulta normaliza, limita dados e não deduz regime desconhecido", async () => {
  const result = await lookupCnpj(cnpj, async (url, options) => {
    assert.equal(url, `https://api.opencnpj.org/${cnpj}`);
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Cookie, undefined);
    return new Response(
      JSON.stringify({
        cnpj,
        razao_social: "Empresa Teste",
        uf: "DF",
        tipo_logradouro: "Rua",
        logradouro: "Teste",
        numero: "10",
        opcao_simples: "N",
        telefones: [
          { ddd: "11", numero: "33334444", is_fax: true },
          { ddd: "48", numero: "999999999", is_fax: false },
        ],
        qsa: [{ nome: "Não deve retornar" }],
      }),
    );
  });
  assert.equal(result.fields.name, "Empresa Teste");
  assert.equal(result.fields.street, "Rua Teste");
  assert.equal(result.source, "OpenCNPJ");
  assert.equal(result.fields.phone, "48999999999");
  assert.equal(result.suggestedRegime, "");
  assert.equal(JSON.stringify(result).includes("Não deve retornar"), false);
});

test("OpenCNPJ sugere MEI ou Simples apenas com indicação positiva", async () => {
  for (const [mei, simples, expected] of [
    ["S", "S", "mei"],
    ["N", "S", "simples_nacional"],
    [null, null, ""],
  ]) {
    const result = await lookupCnpj(
      cnpj,
      async () =>
        new Response(
          JSON.stringify({
            cnpj,
            razao_social: "Teste",
            opcao_mei: mei,
            opcao_simples: simples,
          }),
        ),
    );
    assert.equal(result.suggestedRegime, expected);
    assert.equal(result.fields.phone, "");
  }
});
test("erros externos, documentos inválidos e CNPJ divergente não viram cadastro", async () => {
  await assert.rejects(
    lookupCnpj("123", () => {
      throw new Error("não consultar");
    }),
    /CNPJ inválido/,
  );
  await assert.rejects(
    lookupCnpj(cnpj, async () => new Response("", { status: 404 })),
    /não encontrado/,
  );
  await assert.rejects(
    lookupCnpj(cnpj, async () => {
      throw new Error("timeout");
    }),
    /preencha manualmente/,
  );
  await assert.rejects(
    lookupCnpj(
      cnpj,
      async () =>
        new Response(JSON.stringify({ cnpj: "123", razao_social: "Errada" })),
    ),
    /preencha manualmente/,
  );
});
