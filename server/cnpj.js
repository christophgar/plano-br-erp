// Consulta somente dados cadastrais necessários. Nunca retorna sócios ou a resposta inteira.
import { normalizeTaxId, validCnpj, states } from "../shared/brazil.js";
import { HttpError } from "./validation.js";

export async function lookupCnpj(value, fetcher = fetch) {
  const cnpj = normalizeTaxId(value);
  if (!validCnpj(cnpj)) throw new HttpError(400, "CNPJ inválido.");
  // A API pública ainda pode não atender ao formato alfanumérico. O cadastro manual aceita ambos.
  if (!/^\d{14}$/.test(cnpj))
    throw new HttpError(
      400,
      "Consulta pública disponível apenas para CNPJ numérico. Preencha manualmente.",
    );
  try {
    const response = await fetcher(`https://api.opencnpj.org/${cnpj}`, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 404)
      throw new HttpError(
        404,
        "CNPJ não encontrado na base pública. Você pode cadastrar manualmente.",
      );
    if (response.status === 429)
      throw new HttpError(
        503,
        "A base pública atingiu o limite de consultas. Tente mais tarde.",
      );
    if (response.status === 403)
      throw new HttpError(
        503,
        "O OpenCNPJ recusou a consulta (HTTP 403). Tente mais tarde ou preencha manualmente.",
      );
    if (!response.ok) throw new Error("provider");
    const raw = await response.text();
    if (raw.length > 100000) throw new Error("response size");
    const data = JSON.parse(raw);
    if (
      normalizeTaxId(data.cnpj || "") !== cnpj ||
      typeof data.razao_social !== "string" ||
      !data.razao_social.trim()
    )
      throw new Error("invalid response");
    // Limita campos externos; o usuário revisa e a validação normal do cadastro continua valendo.
    const text = (value, max) =>
      typeof value === "string"
        ? value
            .replace(/[\x00-\x1f\x7f]/g, "")
            .trim()
            .slice(0, max)
        : "";
    // OpenCNPJ retorna uma lista de telefones. Importa só um telefone válido, nunca fax.
    const phone =
      (Array.isArray(data.telefones) ? data.telefones : [])
        .filter((item) => item && item.is_fax === false)
        .map((item) =>
          (text(item.ddd, 3) + text(item.numero, 15)).replace(/\D/g, ""),
        )
        .find((value) => /^[1-9]\d{9,10}$/.test(value)) || "";
    // As opções vêm como S/N. Ausência ou N não permite deduzir Lucro Real/Presumido.
    const optedIn = (value) =>
      value === true ||
      (typeof value === "string" &&
        ["S", "SIM"].includes(value.trim().toUpperCase()));
    return {
      source: "OpenCNPJ",
      taxId: cnpj,
      fields: {
        name: text(data.razao_social, 120),
        tradeName: text(data.nome_fantasia, 120),
        postalCode: text(data.cep, 9).replace(/\D/g, ""),
        street: text(
          [data.tipo_logradouro, data.logradouro].filter(Boolean).join(" "),
          150,
        ),
        addressNumber: text(data.numero, 20),
        complement: text(data.complemento, 100),
        district: text(data.bairro, 100),
        city: text(data.municipio, 100),
        state: states.includes(data.uf) ? data.uf : "",
        email: text(data.email, 254).toLowerCase(),
        phone: /^\d{10,11}$/.test(phone) ? phone : "",
      },
      // Não ser optante do Simples não permite deduzir Lucro Real/Presumido.
      suggestedRegime: optedIn(data.opcao_mei)
        ? "mei"
        : optedIn(data.opcao_simples)
          ? "simples_nacional"
          : "",
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      503,
      "Não foi possível consultar o OpenCNPJ agora. Tente novamente ou preencha manualmente.",
    );
  }
}
