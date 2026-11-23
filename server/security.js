// Autenticação: senhas com hash, JWT assinado e token de proteção das alterações.
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHmac,
} from "node:crypto";
import { promisify } from "node:util";
import jwt from "jsonwebtoken";
const scrypt = promisify(scryptCallback);

export async function hashPassword(password) {
  // Salt aleatório faz senhas iguais gerarem hashes diferentes. scrypt aumenta o custo de tentativas.
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 3,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${salt}$${hash.toString("hex")}`;
}
export async function verifyPassword(password, encoded) {
  // Recalcula o hash com o salt armazenado e compara bytes, sem recuperar a senha original.
  const [algorithm, salt, digest] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !digest) return false;
  const hash = await scrypt(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 3,
    maxmem: 64 * 1024 * 1024,
  });
  const expected = Buffer.from(digest, "hex");
  return expected.length === hash.length && timingSafeEqual(expected, hash);
}
// HMAC vincula o CSRF à sessão sem precisar armazenar esse token em outra tabela.
export const csrfToken = (secret, sid) =>
  createHmac("sha256", secret).update(`csrf:${sid}`).digest("hex");
export function safeEqual(a, b) {
  // timingSafeEqual evita comparar segredo caractere a caractere com retorno antecipado.
  if (typeof a !== "string" || typeof b !== "string") return false;
  const first = Buffer.from(a);
  const second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}
// O JWT contém IDs e validade; a assinatura não esconde seu conteúdo nem substitui HTTPS.
export const signToken = (userId, sid, secret) =>
  jwt.sign({ sid }, secret, {
    algorithm: "HS256",
    subject: userId,
    issuer: "erp-fiscal",
    audience: "erp-web",
    expiresIn: "30m",
  });
// Restringe o algoritmo e confere emissor, público e expiração esperados para este ERP.
export const verifyToken = (token, secret) =>
  jwt.verify(token, secret, {
    algorithms: ["HS256"],
    issuer: "erp-fiscal",
    audience: "erp-web",
  });
