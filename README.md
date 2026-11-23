# Plano BR — Sistema ERP com foco financeiro e fiscal

## Entrega acadêmica — como iniciar

**Autor:** Christian Garmatz.

O pacote contém o código-fonte e a estrutura completa do banco PostgreSQL. O banco é criado vazio no computador de quem recebe, sem dados reais, contas, senhas ou configurações do autor. Os arquivos `server/schema.sql` e `server/tenancy.sql` criam as tabelas, relacionamentos, índices e regras de isolamento entre empresas. Execute-os pelo comando de migração abaixo, que aplica os dois na ordem correta.

### Primeira execução no Windows

1. Instale Node.js 22.18 ou superior e PostgreSQL 18. É necessária internet para instalar as dependências. Git e Word não são necessários para executar o pacote extraído.
2. No GitHub, clique em **Code → Download ZIP** e extraia todo o arquivo. Se recebeu a entrega em RAR, extraia todo o RAR. Não execute de dentro do compactador. Como alternativa, use `git clone https://github.com/christophgar/plano-br-erp.git`.
3. Abra o PowerShell na pasta extraída ou clonada que contém este README e o arquivo `package.json` (`plano-br-erp-main`, `plano-br-erp` ou `Plano_BR`, conforme a forma de download).
4. Execute os comandos abaixo, um de cada vez, aguardando cada um terminar:

```powershell
npm.cmd ci
npm.cmd run setup -- --local-postgres
npm.cmd run db:migrate
npm.cmd run admin:create
npm.cmd run dev
```

5. Mantenha o terminal aberto e acesse **http://localhost:5173** no navegador.
6. Abra o arquivo **`.local/acesso-local.txt`**, criado nesta instalação, para consultar o e-mail e a senha inicial. Cada instalação gera uma senha nova. Não há senha enviada neste pacote.
7. Entre na **Administração geral**, clique em **Nova empresa** e preencha os dados da empresa e do primeiro administrador dela. Use apenas dados autorizados para a demonstração.
8. Saia da conta geral e entre com o usuário da empresa que acabou de criar. Os cadastros e o financeiro ficam dentro desse ambiente; a administração geral é usada para gerenciar as empresas.

O setup usa os executáveis de `C:/Program Files/PostgreSQL/18/bin`, cria um banco próprio na pasta `.local/pgdata` e usa a porta **55439**. Não utiliza a senha escolhida no instalador do PostgreSQL. Se o PostgreSQL estiver em outra pasta, indique o caminho antes do setup:

```powershell
$env:PG_BIN = 'C:/Program Files/PostgreSQL/18/bin'
```

### Abrir novamente em outro dia

Na mesma pasta extraída, inicie o banco se ele ainda não estiver em execução:

```powershell
& 'C:/Program Files/PostgreSQL/18/bin/pg_ctl.exe' -D "$PWD/.local/pgdata" -l "$PWD/.local/postgres.log" -w start
npm.cmd run dev
```

Se aparecer que o banco já está em execução, prossiga com `npm.cmd run dev`. Não repita `admin:create`: esse comando cria somente o primeiro administrador. Para encerrar a aplicação, pressione **Ctrl+C** no terminal. Para parar o banco sem apagar os dados:

```powershell
& 'C:/Program Files/PostgreSQL/18/bin/pg_ctl.exe' -D "$PWD/.local/pgdata" -m fast -w stop
```

### Demonstração sugerida

Dentro de uma empresa: cadastre um cliente, cadastre um produto e registre a entrada de estoque; crie um pedido com esse produto e confira a saída do estoque. No financeiro, registre uma receita e confirme o recebimento. Na Visão geral, selecione o mês correspondente e confira os totais. Edite um cadastro com motivo e consulte o antes/depois na Auditoria.

### Se não iniciar

- **npm não encontrado:** instale o Node.js e reabra o terminal. Confira `node --version` e `npm.cmd --version`.
- **PostgreSQL não encontrado:** confira a instalação e o caminho `PG_BIN`.
- **Porta 55439 ocupada:** encerre a outra cópia deste projeto antes de iniciar uma nova instalação. Não apague a pasta do banco.
- **Portas 3001 ou 5173 ocupadas:** encerre a outra execução do sistema antes de tentar novamente.
- **Login não funciona:** use a senha gerada nesta instalação, em `.local/acesso-local.txt`. Depois de uma troca de senha, use a nova senha escolhida.
- **Consulta de CNPJ indisponível:** preencha o cadastro manualmente; essa consulta depende de um serviço externo.

O pacote não inclui `node_modules`, `.env`, `.env.example`, `.local` ou dados pessoais. Dependências e configurações são criadas pelos comandos acima. Não compartilhe novamente a pasta após a execução sem retirar os arquivos locais gerados. O uso nesta entrega é local; não é necessário publicar na internet.

Protótipo acadêmico do TCC de Christian Garmatz. Integra clientes, estoque, pedidos/ordens de serviço e financeiro, com destaque à organização e conferência fiscal. Estima impostos pela alíquota informada pelo usuário. Não emite NF-e/NFS-e, não realiza apuração tributária oficial e não se conecta à SEFAZ.

## Tecnologias

React 19, Tailwind CSS 4, Node.js 22.18+, Express 5, PostgreSQL e JWT. Vite compila a interface. Zod valida entradas e as consultas SQL usam parâmetros. Valores monetários são centavos inteiros.

## Iniciar no Windows com PostgreSQL 18 instalado

Na raiz do projeto:

```powershell
npm ci
npm run setup -- --local-postgres
npm run db:migrate
npm run admin:create
npm run dev
```

Abra http://localhost:5173. O setup gera credenciais aleatórias em **`.local/acesso-local.txt`**: consulte somente no seu computador e não compartilhe. Não há senha padrão nem cadastro público. O setup não sobrescreve `.env` existente.

O banco isolado fica em `.local/pgdata`, porta 55439, sem alterar outros bancos. Defina `PG_BIN` se os executáveis estiverem em outro diretório. Depois de reiniciar o computador:

```powershell
& 'C:/Program Files/PostgreSQL/18/bin/pg_ctl.exe' -D "$PWD/.local/pgdata" -l "$PWD/.local/postgres.log" -w start
```

Para encerrar:

```powershell
& 'C:/Program Files/PostgreSQL/18/bin/pg_ctl.exe' -D "$PWD/.local/pgdata" -m fast -w stop
```

Não remova a pasta de dados. A opção `--resume-local`, junto de `--local-postgres`, retoma um setup interrompido apenas se este projeto criou o cluster e seu arquivo local de senha ainda existe.

### Alternativa Docker

Com Docker funcionando: `npm ci`, `npm run setup`, `docker compose up -d db`, `npm run db:migrate`, `npm run admin:create`, `npm run dev`. Não execute o banco nativo e o Docker na mesma porta. `docker compose stop` preserva dados; não remova volumes sem backup.

## Funcionalidades e perfis

- Clientes: PF/PJ, CPF/CNPJ com dígitos verificadores, regime tributário, inscrições opcionais, contatos e endereço completo. Cadastros antigos são preservados e podem ser completados na edição.
- Produtos: catálogo e movimentações auditadas, com bloqueio transacional contra estoque negativo.
- Pedidos: produtos do estoque, quantidades, preços históricos e total calculado no servidor. Salvar baixa o estoque; cancelar devolve os itens quando não houver financeiro ativo. O botão **Adicionar nota fiscal** usa a receita existente ou cria uma receita pendente, sem confirmar recebimento nem emitir nota.
- Financeiro: receitas, despesas, vencimentos e baixa. Valores pagos não são reversíveis neste protótipo.
- Fiscal: número, tipo, data e valor do documento, vínculo financeiro e conferência com motivo. Divergências impedem a conferência.
- Painel mensal: receita bruta recebida, imposto estimado pela alíquota cadastrada, receita após impostos, despesas pagas, custos operacionais adicionais opcionais e resultado líquido estimado. Pedidos abertos e pendências documentais mostram a posição geral.
- Administração: usuários, desativação de acesso e auditoria. Troca de senha na tela Configurações encerra todas as sessões.

A auditoria identifica nome/e-mail do responsável, data e hora e ações em português; detalhes mantêm a identificação técnica do registro. A tela Configurações contém a troca de senha, com confirmação e espaçamento entre campos e botão.

| Perfil | Permissões |
| --- | --- |
| Operador | Clientes, cadastro/movimentação de produtos e pedidos |
| Contador | Consulta de produtos/pedidos, clientes, painel, financeiro e fiscal |
| Administrador | Todas, incluindo usuários, auditoria e privacidade |

Permissões são verificadas na API. A plataforma atende **várias empresas, com dados isolados por empresa**. A interface consulta até 200 registros por lista; bases maiores precisam de paginação na interface. A API aceita `limit` e `offset`. Não há exclusão genérica de registros financeiros. Evite dados pessoais desnecessários em descrições e motivos.

### Alíquota e custos do negócio

Na Visão geral, administrador e contador podem abrir **Configurar impostos e custos**. A alíquota aceita de 0% a 100%, com duas casas decimais. Custos operacionais são um valor fixo mensal adicional, opcional. A configuração é compartilhada pela empresa e permanece no PostgreSQL; alterações são auditadas. Atualize o banco existente com `npm run db:migrate`.

O mês usa a data efetiva de pagamento/recebimento (`paid_at`), no fuso America/Sao_Paulo; pendências e cancelamentos não entram nos totais. O cálculo é: **líquido estimado = receita recebida − imposto estimado − despesas pagas − custos adicionais**. Impostos são arredondados para centavos. A alíquota e o custo atuais são aplicados também a meses anteriores; não há histórico de configurações por competência. O custo fixo também é considerado em meses sem receitas, permitindo resultado negativo.

Custos adicionais não devem repetir despesas já lançadas. A estimativa de imposto não cria pagamento ou lançamento financeiro. Para evitar dupla contagem, não use a mesma estimativa e um pagamento de imposto já classificado como despesa para representar a mesma dedução. Este cálculo gerencial não substitui apuração fiscal oficial nem trata regimes ou tributos específicos.

## Verificação

```powershell
npm run test:db
npm run build
npm run check:repo
npm audit
```

`test:db` cria/usa `erp_test` local e limpa suas tabelas de teste. Nunca use dados reais nesse banco. Para CI, defina `TEST_DATABASE_URL` apontando para banco dedicado terminado em `_test` e execute `npm test`.

Com `npm run dev` aberto e a senha inicial válida, `node scripts/smoke-ui.mjs` testa login, navegação, mobile e logout no Edge. Capturas ficam em `.local/screenshots`, fora do Git. `BROWSER_CHANNEL` seleciona outro navegador instalado compatível com Playwright.

Após `npm run build`, `npm run test:workflow` testa cliente fiscal, pedido por itens, estoque, nota, receita, líquido, exportação anual e auditoria no navegador. Cria/usa somente `erp_ui_test` local e limpa seus dados de teste. Não usa o banco `erp`.

## Configuração e GitHub

**Nenhum `.env*`, nem `.env.example`, deve ir ao GitHub.** O setup gera `.env` somente localmente. Variáveis, sem valores secretos:

| Variável | Finalidade |
| --- | --- |
| DATABASE_URL | Conexão PostgreSQL privada |
| JWT_SECRET | Chave aleatória com pelo menos 64 caracteres |
| POSTGRES_PASSWORD | Senha do banco no Compose |
| APP_ORIGIN | Origem exata permitida; local http://localhost:5173 |
| NODE_ENV | development local; production exige HTTPS |
| HOST / PORT | Endereço e porta da API |
| TRUST_PROXY | Número de proxies confiáveis; 0 sem proxy |

Antes de publicar, execute `npm run check:repo` e revise `git status` e o diff staged. `.local`, dependências, builds, dumps e chaves são ignorados. A documentação acadêmica está na pasta irmã `DOCUMENTACAO TCC CHRISTIAN GARMATZ`, fora do sistema; `output`/`tmp` continuam preventivamente ignorados. Não use `git add -f`. Nenhum script envia código ao GitHub. O verificador não substitui revisão manual e scanner de segredos.

Em produção: `npm run build`, `npm start`, proxy HTTPS na mesma origem, `NODE_ENV=production` e `APP_ORIGIN`/`TRUST_PROXY` corretos. O usuário do banco gerado pelo setup é **apenas para desenvolvimento**: use conta de runtime sem superusuário/DDL, migrações separadas, rede privada, gerenciamento de segredos e backups criptografados testados. Não exponha Vite nem PostgreSQL publicamente.

Leia [SECURITY.md](SECURITY.md) antes de usar dados reais. Não há certificação de segurança ou garantia de conformidade com a LGPD.

## Organização

- `client/src`: telas, estilos, cliente da API e conversão monetária.
- `server`: API, autenticação, validações e schema SQL.
- `server/tests`: testes com PostgreSQL real.
- `scripts`: preparação e verificações.
- `compose.yaml`: banco opcional Docker.

Todo o CSS da interface está em `client/src/styles.css`, com seções comentadas para base, tema escuro, financeiro e validação. `ValidatedInput.jsx` aplica máscaras e mensagens de erro; `inputRules.js` formata entradas; `shared/fieldRules.js` compartilha regras básicas com o servidor. A API mantém suas validações mesmo se alguém ignorar a tela. Telefones aceitam 10/11 dígitos com DDD ou o formato internacional com `+`; códigos aceitam letras, números, ponto, traço, barra e sublinhado.

### Exportar resultados para Excel

Na Visão geral, clique em **Exportar Excel**. O menu permite escolher mês e ano, trimestre, semestre, ano inteiro ou intervalo de meses (até 120 meses). Administrador e contador recebem um `.xlsx` com valores numéricos, alíquota, fórmulas e dois gráficos editáveis. A consulta usa uma fotografia consistente do banco, com os mesmos critérios de recebimento/pagamento do painel. O imposto é estimado sobre o bruto total do período e arredondado uma vez, enquanto o custo fixo mensal é multiplicado pela quantidade de meses; pode haver diferença de centavos em relação à soma de estimativas arredondadas mês a mês. A planilha contém totais, sem contatos de clientes; alterações no arquivo não alteram o sistema.

`server/excel-report.js` preenche o modelo `server/templates/financial-report.xlsx` com a biblioteca `fflate`. Esse modelo faz parte da funcionalidade do sistema, não é um documento acadêmico. Ele não contém macros, credenciais nem dados de empresas. Os comentários no código explicam cada etapa e os arquivos principais.

CPF/CNPJ são validados localmente por formato e dígitos; isso não consulta a situação cadastral. O CNPJ aceita o formato alfanumérico conforme o [manual oficial da Receita Federal](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj/manual-dv-cnpj.pdf). O endereço usa CEP e UF brasileiros, sem envio automático a serviços externos.

Os comentários explicam decisões importantes de forma direta. Uma licença de distribuição ainda deve ser escolhida pelo autor antes de liberar reutilização por terceiros.
# Administração e consultas públicas

## Várias empresas e administração geral

`npm run db:migrate` preserva os dados existentes e adiciona
isolamento por empresa no PostgreSQL (RLS + vínculos compostos). Faça backup antes
da atualização. Não crie um banco vazio em substituição ao existente.

Não há empresa principal: todas as empresas cadastradas são clientes do ERP, no
mesmo nível. O administrador geral pertence à plataforma e não a uma empresa.
Um contêiner técnico vazio de migração não aparece na lista. Se uma instalação
antiga tiver dados, eles são preservados em **Registros anteriores**, para
identificar a empresa corretamente, sem descartar cadastros ou configurações.

Para autorizar uma conta já cadastrada como administrador geral, execute localmente:

```sh
npm run platform:grant -- email-da-sua-conta
```

O comando não imprime nem altera senhas e revoga as sessões daquela conta. Entre
novamente para abrir a **Administração geral**. Nenhum cadastro público ou formulário
de usuário permite conceder essa função. Cadastre uma conta separada para o trabalho
diário dentro de uma empresa; evite usar privilégios gerais sem necessidade.

No painel geral você pode cadastrar empresa com CNPJ e seu primeiro administrador,
editar dados, suspender acesso e gerenciar usuários (ativação e redefinição de senha).
E-mails são únicos na plataforma. Senhas nunca podem ser consultadas ou recuperadas.
O administrador de uma empresa só vê e cria usuários daquela empresa.

**Acessar para suporte** pede motivo e sua senha atual. A janela dura até 15 minutos,
é somente consulta por padrão e identifica a empresa no topo. Para editar, autorize
alterações explicitamente. Use **Encerrar suporte e voltar à administração geral**
ao terminar. Inícios, encerramentos e tentativas de acesso ficam na auditoria geral;
alterações concluídas ficam também na auditoria da empresa com sua identidade.

Cada cartão de empresa tem **Ver auditoria**, com os últimos 200 eventos
administrativos e de suporte exclusivamente dela. **Auditoria da plataforma** é
separada e contém apenas eventos sem empresa, como entrada do administrador geral.
A auditoria operacional permanece na aba Auditoria dentro do ambiente de cada empresa.

Nos históricos da administração geral, use **Data inicial**, **Data final** e
**Buscar por data**. Os dias são considerados no horário de Brasília, incluindo o
dia final inteiro. Uma das datas pode ficar vazia; para um único dia, repita a data
nos dois campos. **Limpar filtro** restaura o histórico sem restrição de datas.
O servidor valida as datas e filtra por empresa e período antes do limite de 200 eventos.

Na auditoria da empresa, **Ver alterações** mostra Campo, Antes e Depois para
edições de clientes, estoque (inclusive baixa/devolução por pedido), situações de
pedidos e lançamentos, conferência documental, acesso de usuários e impostos/custos.
Somente campos modificados e permitidos são gravados, na mesma transação da alteração.
Senhas, hashes e tokens nunca entram no comparativo. Eventos anteriores a essa
funcionalidade não possuem os valores antigos e não podem ser reconstruídos.
`server/audit-changes.js` define os campos permitidos; `client/src/AuditChanges.jsx`
formata os valores no detalhe do evento. Atualize o banco com `npm run db:migrate`.

Editar clientes, movimentar estoque, alterar situações, ativar/desativar usuários
ou ajustar impostos/custos exige **Motivo da alteração** de 10 a 200 caracteres.
Espaços nas extremidades não contam. A API também valida e grava o motivo junto
ao antes/depois na auditoria. Cadastros novos não exigem motivo de edição.

## Desfazer alterações pela auditoria

Administradores da empresa podem abrir **Ver alterações → Desfazer alteração**,
informar um motivo de 10 a 200 caracteres e confirmar. Administradores gerais só
podem fazê-lo dentro de suporte com alterações autorizadas. Operadores e contadores
não têm permissão, inclusive se chamarem a API diretamente.

A reversão restaura apenas os campos daquele comparativo, em uma transação, e cria
outro evento com antes/depois e vínculo ao original. O histórico não é apagado.
Não permite repetir a reversão, reverter a própria reversão, restaurar dados removidos,
alterar o próprio acesso ou sobrescrever alterações posteriores do registro.
CPF/CNPJ, limites de valores e isolamento por empresa continuam sendo validados.

São elegíveis edições de clientes com comparativo, impostos/custos, acesso de usuários
e novas movimentações manuais de estoque. Estoque automático de pedidos, situações
de pedidos, pagamentos e conferências documentais não têm reversão genérica:
use os fluxos próprios para preservar os vínculos. Criações, senhas e eventos antigos
sem comparativo não podem ser desfeitos por esse botão.

`server/rollback.js` executa a compensação; `client/src/RollbackForm.jsx` confirma
a ação. `reverses_event_id` possui índice único para impedir duas reversões simultâneas.
Após atualizar o código, execute `npm run db:migrate` antes de usar o recurso.

No cadastro de clientes, CPF/CNPJ é único **dentro de cada empresa**. A tela avisa
quando o documento já está cadastrado e não bloqueia a edição do próprio registro.
Empresas diferentes podem cadastrar o mesmo cliente com o mesmo CPF/CNPJ, sem
compartilhar seus dados. O banco aplica a regra também em gravações simultâneas;
a verificação antecipada na tela não substitui essa garantia. A consulta não informa
se o documento existe em outras empresas. Documentos são normalizados sem pontuação.

Arquivos novos: `server/tenancy.sql` (migração/RLS), `server/tenant-db.js` (conexão
isolada por requisição), `server/platform.js` (rotas gerais e suporte),
`client/src/PlatformAdmin.jsx` (painel) e `scripts/platform-admin.mjs` (autorização local).

O sistema continua em ambiente local: não há hospedagem, domínio ou acesso remoto
pela internet configurado. Antes de publicar, siga `SECURITY.md`, habilite HTTPS,
restrinja o banco e a rede e adote MFA/controle adicional para o administrador geral.

## Consulta de dados cadastrais

No cadastro PJ, informe o CNPJ e clique em **Consultar CNPJ**. A API do ERP consulta
`https://api.opencnpj.org/{cnpj}` (OpenCNPJ) sem chave. Só o CNPJ é enviado ao
fornecedor, sem cookies ou outros dados do cadastro. A consulta exige login e tem
limite de dez chamadas por minuto por IP e timeout de oito segundos.

A prévia não altera os campos até clicar em **Confirmar e preencher cadastro**.
Essa confirmação substitui os campos disponíveis, mas não salva o cliente.
Revise endereço, contatos, inscrições e regime tributário e depois salve.
Lucro Real/Presumido não são deduzidos pela ausência do Simples. Não são importados
dados de sócios. Dados ausentes, CNPJ alfanumérico ou indisponibilidade da fonte
não impedem o preenchimento manual. A base pública pode estar desatualizada.

