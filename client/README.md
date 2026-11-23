# Vértice — frontend do protótipo ERP fiscal

Interface React 19, Vite 6 e Tailwind CSS 4, em português. Requer Node.js 22.18 ou superior.

## Execução

Na raiz, execute `npm ci` e siga o setup do README principal. `npm run dev` inicia API e interface. `npm run build` gera `client/dist/`.

Todas as chamadas usam `/api` na mesma origem. Vite encaminha `/api` para `127.0.0.1:3001` no desenvolvimento. Em produção, Express serve o frontend compilado. Não crie arquivos de ambiente no frontend nem coloque segredos em variáveis `VITE_*`.

## Sessão e permissões

O JWT não é lido nem armazenado pelo frontend. O backend deve configurar o cookie HttpOnly e demais atributos de sessão. O token CSRF retornado por login/me fica em memória e é enviado em `X-CSRF-Token` nas mutações autenticadas. Login não exige um token prévio. Não há credenciais padrão.

Operador: clientes, estoque e pedidos. Contador: também dashboard, financeiro e documentos. Administrador: também usuários, auditoria, exportação e anonimização. A API deve validar as permissões independentemente da navegação. A informação de privacidade é acessível a todos os perfis autenticados.

## Integração e verificação

As listas usam `{items: [...]}`. O dashboard usa centavos inteiros. Campos monetários aceitam `1234,56` ou `1234.56`, sem separador de milhar. A interface pesquisa os primeiros 200 registros retornados; a API permite `limit` e `offset`, mas a navegação entre páginas ainda não está implementada.

A auditoria aceita `createdAt`, `action`, `actor`/`user`/`actorId`/`userId` e `entityType`/`entity`; cada evento também pode ser inspecionado integralmente em JSON, pois os campos de auditoria não foram detalhados no contrato.

Verificar com backend disponível: login/logout e expiração, acesso por cada perfil, cadastro e edição de cliente, exportação e anonimização, cadastro e movimentação de produtos, pedidos e status, lançamentos e status, documentos e revisão com motivo, criação de usuários, auditoria, falhas HTTP e navegação por teclado em celular e desktop. Exportação de cliente contém dados pessoais. Anonimização exige confirmação explícita com motivo na interface.

Este frontend não emite documentos fiscais nem garante conformidade legal. Retenção, autorização, validações de negócio e auditoria são responsabilidades do backend. Nenhum dado de demonstração substitui respostas da API.
