// Contratos da API. Cada schema define campos, formatos e limites aceitos pelo servidor.
// strict() rejeita campos extras; regras básicas compartilhadas também são usadas na interface.
import { z } from "zod";
import {
  textRule as text,
  emailRule as email,
  phoneRule,
  dateRule as date,
  codeRule,
} from "../shared/fieldRules.js";
import {
  normalizeTaxId,
  validCpf,
  validCnpj,
  states,
  taxRegimes,
} from "../shared/brazil.js";
export const uuid = z.uuid();
const optionalId = uuid.nullable().optional();
export const password = z.string().min(12).max(128);
export const changeReason = text(200).min(
  10,
  "Informe o motivo da alteração com pelo menos 10 caracteres.",
);
const money = z.number().int().min(1).max(100000000);
export const schemas = {
  login: z.object({ email, password: z.string().min(1).max(128) }).strict(),
  user: z
    .object({
      name: text(100),
      email,
      password,
      role: z.enum(["admin", "accountant", "operator"]),
    })
    .strict(),
  customer: z
    .object({
      personType: z.enum(["PF", "PJ"]),
      taxId: z.string().transform(normalizeTaxId),
      taxRegime: z.enum(Object.keys(taxRegimes)),
      name: text(120),
      tradeName: z.union([text(120), z.literal(""), z.null()]).optional(),
      stateRegistration: z
        .union([text(30), z.literal(""), z.null()])
        .optional(),
      municipalRegistration: z
        .union([text(30), z.literal(""), z.null()])
        .optional(),
      postalCode: z
        .string()
        .regex(/^\d{5}-?\d{3}$/)
        .transform((value) => value.replace("-", ""))
        .refine((value) => value !== "00000000"),
      street: text(150),
      addressNumber: text(20),
      district: text(100),
      city: text(100),
      state: z.enum(states),
      complement: z.union([text(100), z.literal(""), z.null()]).optional(),
      email: z.union([email, z.literal(""), z.null()]).optional(),
      phone: z.union([phoneRule, z.literal(""), z.null()]).optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (
        !(value.personType === "PF"
          ? validCpf(value.taxId)
          : validCnpj(value.taxId))
      )
        ctx.addIssue({
          code: "custom",
          path: ["taxId"],
          message: "CPF/CNPJ inválido. Confira os dígitos verificadores.",
        });
      if (
        (value.personType === "PF") !==
        (value.taxRegime === "not_applicable")
      )
        ctx.addIssue({
          code: "custom",
          path: ["taxRegime"],
          message: "Escolha um regime compatível com PF/PJ.",
        });
    }),
  product: z
    .object({
      name: text(120),
      sku: codeRule(40),
      quantity: z.number().int().min(0).max(1000000),
      unitPriceCents: z.number().int().min(0).max(100000000),
    })
    .strict(),
  stock: z
    .object({
      delta: z
        .number()
        .int()
        .min(-1000000)
        .max(1000000)
        .refine((v) => v !== 0),
      reason: changeReason,
    })
    .strict(),
  order: z
    .object({
      customerId: uuid,
      description: text(500),
      items: z
        .array(
          z
            .object({
              productId: uuid,
              quantity: z.number().int().min(1).max(1000000),
            })
            .strict(),
        )
        .min(1)
        .max(100),
    })
    .strict()
    .refine(
      (value) =>
        new Set(value.items.map((item) => item.productId)).size ===
        value.items.length,
      "Não repita o mesmo produto: ajuste a quantidade.",
    ),
  orderDocument: z
    .object({ number: codeRule(80), issuedOn: date, dueDate: date })
    .strict(),
  orderStatus: z
    .object({
      status: z.enum(["open", "in_progress", "completed", "cancelled"]),
      reason: changeReason,
    })
    .strict(),
  transaction: z
    .object({
      type: z.enum(["income", "expense"]),
      description: text(300),
      amountCents: money,
      dueDate: date,
      customerId: optionalId,
      orderId: optionalId,
    })
    .strict(),
  transactionStatus: z
    .object({
      status: z.enum(["pending", "paid", "cancelled"]),
      reason: changeReason,
    })
    .strict(),
  document: z
    .object({
      transactionId: uuid,
      number: codeRule(80),
      kind: z.enum(["invoice", "receipt", "other"]),
      issuedOn: date,
      amountCents: money,
    })
    .strict(),
  documentStatus: z
    .object({ status: z.enum(["pending", "reviewed"]), reason: changeReason })
    .strict(),
  reason: z.object({ reason: text(200) }).strict(),
  changePassword: z
    .object({
      currentPassword: z.string().min(1).max(128),
      newPassword: password,
    })
    .strict(),
  userActive: z.object({ active: z.boolean(), reason: changeReason }).strict(),
  businessSettings: z
    .object({
      taxRateBasisPoints: z.number().int().min(0).max(10000),
      reason: changeReason,
      monthlyOperatingCostsCents: z
        .number()
        .int()
        .min(0)
        .max(100000000)
        .nullable(),
    })
    .strict(),
  dashboardQuery: z
    .object({
      month: z
        .string()
        .regex(/^[2-9]\d{3}-(0[1-9]|1[0-2])$/)
        .optional(),
    })
    .strict(),
  reportQuery: z
    .object({
      month: z
        .string()
        .regex(/^[2-9]\d{3}-(0[1-9]|1[0-2])$/)
        .optional(),
      from: z
        .string()
        .regex(/^[2-9]\d{3}-(0[1-9]|1[0-2])$/)
        .optional(),
      to: z
        .string()
        .regex(/^[2-9]\d{3}-(0[1-9]|1[0-2])$/)
        .optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.month && (value.from || value.to))
        ctx.addIssue({
          code: "custom",
          message: "Escolha mês ou intervalo, não ambos.",
        });
      if (!!value.from !== !!value.to || (value.from && value.from > value.to))
        ctx.addIssue({
          code: "custom",
          message: "Informe um intervalo válido.",
        });
      if (value.from && value.to) {
        const [a, b] = value.from.split("-").map(Number),
          [c, d] = value.to.split("-").map(Number);
        if ((c - a) * 12 + d - b > 119)
          ctx.addIssue({
            code: "custom",
            message: "O intervalo máximo é de 120 meses.",
          });
      }
    }),
};
export function body(schema) {
  // Converte req.body validado em req.input. Erros do Zod chegam ao tratador central da API.
  return (req, res, next) => {
    req.input = schema.parse(req.body);
    next();
  };
}
export function id(req, res, next) {
  // Os parâmetros :id das rotas precisam ser UUIDs antes de qualquer consulta.
  req.entityId = uuid.parse(req.params.id);
  next();
}
export class HttpError extends Error {
  // Representa uma falha de negócio com status HTTP e mensagem segura para a tela.
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function requireRow(result) {
  // UPDATE/SELECT sem registro encontrado vira 404, em vez de retornar dados indefinidos.
  if (!result.rows[0]) throw new HttpError(404, "Registro não encontrado.");
  return result.rows[0];
}
