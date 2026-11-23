// Regras básicas usadas tanto pela tela quanto pela API, evitando limites diferentes.
import { z } from "zod";

export const emailRule = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
export const codeRule = (max) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(
      /^[\p{L}\p{N}._/-]+$/u,
      "Use letras, números, ponto, traço, barra ou sublinhado.",
    );
export const textRule = (max) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (value) => !/[\u0000-\u001F\u007F]/.test(value),
      "O texto contém caracteres de controle inválidos.",
    );
export const phoneRule = z
  .string()
  .trim()
  .refine((value) => {
    const digits = value.replace(/\D/g, "");
    return value.startsWith("+")
      ? /^\+[\d ()-]+$/.test(value) && /^[1-9]\d{9,14}$/.test(digits)
      : /^[\d ()-]+$/.test(value) && /^[1-9]\d{9,10}$/.test(digits);
  }, "Informe DDD e telefone com 10 ou 11 dígitos, ou + e o código internacional.");
export const dateRule = z
  .string()
  .regex(/^(19\d{2}|[2-9]\d{3})-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(value + "T00:00:00Z");
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    );
  }, "Informe uma data válida entre 1900 e 9999.");

// Limites dos campos livres; os tipos numéricos têm seus próprios limites.
export const fieldLimits = (page, name) =>
  ({
    name: page === "users" ? 100 : 120,
    email: 254,
    phone: 20,
    sku: 40,
    number: 80,
    reason: 200,
    description: page === "transactions" ? 300 : 500,
    password: 128,
  })[name] ?? 200;
