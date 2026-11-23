# Segurança e privacidade

Protótipo acadêmico. Revise a implantação e as obrigações da organização antes de utilizar dados reais.

## Controles implementados

- Senhas com scrypt, salt aleatório e comparação em tempo constante.
- JWT HS256 com emissor, audiência, validade de 30 minutos e sessão revogável no PostgreSQL.
- Cookie HttpOnly, SameSite=Strict e Secure em produção; sem JWT em localStorage.
- CSRF vinculado à sessão, verificação de origem e JSON obrigatório nas mutações.
- Limites de requisições/login e bloqueio temporário por conta.
- Autorização por perfil, validação estrita e SQL parametrizado.
- Transações e constraints para estoque, vínculos e valores.
- Helmet, respostas privadas sem cache e erros sem SQL ou segredos.
- Auditoria de alterações, acesso, exportação e remoção de contatos. Identificadores e motivos ainda podem constituir dados pessoais.
- Novos comparativos antes/depois contêm apenas campos de negócio alterados, definidos em lista permitida. Nunca incluem senhas, hashes ou tokens. Valores antigos de nome, documento, contato e endereço também são dados pessoais: restrinja o acesso, proteja backups e defina a retenção da auditoria. Editar um cadastro não apaga seus valores históricos.
- Segredos aleatórios apenas locais; todos os `.env*` ignorados pelo Git.
- Reversão de eventos elegíveis exige administrador, motivo e estado atual compatível. Usa bloqueio de linha, transação e vínculo único ao evento original; não apaga histórico, não reverte senhas e não libera reversão genérica de pedidos/pagamentos. Reversões de acesso revogam as sessões do usuário e não podem atingir a própria conta.

## LGPD: decisões operacionais necessárias

Defina controlador, canal para titulares, finalidades e bases legais por operação, inventário dos dados, prazos de retenção, acessos, fornecedores e plano de incidentes. Consentimento não deve ser presumido como base para todas as operações.

A exportação exige administrador, que deve validar identidade e direito do solicitante. Após o download, o arquivo não fica protegido pelo sistema.

O botão de anonimização remove nome, CPF/CNPJ, regime, inscrições, contatos e endereço somente de cadastros sem pedidos ou lançamentos. **Não garante anonimização irreversível de todo o ambiente**, incluindo backups, auditoria e campos livres. Vínculos bloqueiam a operação para revisão de retenção fiscal/contratual pelo responsável. Documentos não são apagados automaticamente. A validação de CPF/CNPJ não consulta a situação cadastral nem confirma titularidade.

## Limitações

Sem MFA, recuperação de senha por e-mail, apuração tributária oficial, validação de autenticidade fiscal ou emissão de notas. O painel apenas estima impostos com a alíquota informada e o resultado líquido com despesas e custos adicionais; o regime tributário é cadastrado, não determina automaticamente a alíquota. Cadastro documental não prova regularidade fiscal. Pedidos com itens baixam o estoque ao salvar e devolvem no cancelamento permitido. Não há upload XML/PDF ou conciliação bancária. Auditoria não é imutável contra administradores do banco. Rate limiting em memória atende uma instância; escala horizontal exige armazenamento compartilhado.

## Isolamento entre empresas e suporte

Cada registro empresarial possui `company_id`. A API usa o contexto da conta autenticada
ou um suporte autorizado no servidor, nunca um cabeçalho de empresa enviado pelo navegador.
`server/tenant-db.js` assume o papel PostgreSQL `erp_tenant`, sem superusuário ou BYPASSRLS,
e aplica o identificador com escopo de transação. Políticas RLS restringem leituras e
gravações; chaves estrangeiras compostas impedem vínculos entre empresas. As consultas
de autenticação e administração geral usam uma conexão privilegiada separada logicamente;
essas rotas exigem autorização própria. Não conceda o papel `erp_tenant` a contas externas.

O administrador geral não pode recuperar senhas: pode redefini-las com nova confirmação
da própria senha, motivo e revogação das sessões. Seu acesso aos dados internos exige
uma janela de suporte de 15 minutos, somente consulta por padrão. Alterações precisam
ser autorizadas explicitamente. A trilha geral registra início, fim e tentativas de
solicitações; a trilha da empresa registra mutações concluídas com a identidade real do
responsável. Não equivale a aprovação do cliente: estabeleça autorização de atendimento,
confidencialidade e controles operacionais antes do uso com dados reais.

Suspender empresa revoga suas sessões e acessos de suporte. Usuários comuns não podem
criar administradores gerais nem consultar contas de outras empresas. Cada e-mail pertence
a uma única conta global nesta versão; não há uma conta com associação a várias empresas.

Administradores gerais não pertencem a uma empresa cliente (`company_id` nulo).
O contêiner técnico vazio de migração não é uma empresa cliente e não aparece no
painel nem pode receber suporte. Históricos administrativos são consultados por
empresa com filtro SQL antes do limite de 200; eventos sem empresa ficam em uma
auditoria separada da plataforma. A trilha operacional continua isolada no ambiente
da empresa, acessível via suporte autorizado.

A aplicação continua local. Para disponibilizar remotamente, configure servidor HTTPS,
rede e banco restritos, backups protegidos, monitoramento e MFA/controle de acesso para
administradores gerais. Não exponha Vite ou PostgreSQL à internet. A migração precisa
de permissão de dono das tabelas e criação/configuração do papel do banco; execute-a com
credencial de manutenção e restrinja a credencial privilegiada usada pelo backend.

Scripts locais usam conta administrativa do banco; separe-a da conta de runtime em produção. Restrinja permissões NTFS de `.env` e `.local`: o modo de arquivo do Node não substitui ACLs no Windows. Criptografia em repouso, backups, certificados e monitoramento dependem da implantação.

Revise dependências e realize testes de segurança proporcionais ao risco. Relate falhas ao mantenedor por canal privado, sem publicar credenciais/dados em issues. Segredos expostos devem ser revogados: `.gitignore` não remove histórico.

## Referências

- [Express: segurança em produção](https://expressjs.com/en/advanced/best-practice-security/)
- [OWASP: armazenamento de senhas](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP: prevenção de CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [LGPD: texto legal](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm)
- [ANPD: guia para agentes de pequeno porte](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia-vf.pdf)
