// Verifica os arquivos que podem entrar no Git, incluindo novos arquivos ainda não adicionados.
// É uma triagem de segredos e arquivos locais, não uma publicação ou um commit.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
const run = (args) =>
  execFileSync("git", args, { encoding: "utf8" }).split("\n").filter(Boolean);
// Combina arquivos versionados e arquivos novos não ignorados, removendo repetições.
const files = [
  ...new Set([
    ...run(["ls-files"]),
    ...run(["ls-files", "--others", "--exclude-standard"]),
  ]),
];
const forbidden =
  /(^|\/)(\.env[^/]*|\.local|node_modules|tmp|output)(\/|$)|\.(pem|pfx|p12|dump|backup)$/i;
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /postgres(?:ql)?:\/\/[^\s:'"`]+:[^\s$<{`][^\s@]*@/,
];
const problems = [];
for (const file of files) {
  if (forbidden.test(file)) {
    problems.push(`${file}: arquivo privado ou local`);
    continue;
  }
  if (!statSync(file).isFile() || statSync(file).size > 2_000_000) continue;
  const content = readFileSync(file, "utf8");
  if (secretPatterns.some((pattern) => pattern.test(content)))
    problems.push(`${file}: possível segredo`);
}
// Inclusive .env.example deve continuar ignorado, conforme decisão do autor.
for (const file of [
  ".env",
  ".env.example",
  "client/.env.local",
  ".local/acesso-local.txt",
]) {
  try {
    execFileSync("git", ["check-ignore", "--quiet", file]);
  } catch {
    problems.push(`${file}: não está ignorado`);
  }
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(
  `${files.length} arquivos candidatos verificados. Nenhum .env* ou diretório privado incluído.`,
);
console.log(
  "Esta checagem complementa a revisão manual do diff; não substitui um scanner de segredos.",
);
