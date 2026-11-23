-- Estrutura persistente do ERP. IF NOT EXISTS permite repetir a preparação sem apagar dados.
-- PRIMARY KEY identifica cada linha; REFERENCES liga tabelas; CHECK/UNIQUE impõem integridade.
-- Contas e credenciais: apenas password_hash, nunca a senha em texto puro.
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  email varchar(254) UNIQUE NOT NULL CHECK (email = lower(email)),
  password_hash text NOT NULL,
  role varchar(20) NOT NULL CHECK (role IN ('admin','accountant','operator')),
  active boolean NOT NULL DEFAULT true,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Sessões revogáveis complementam a assinatura e a expiração do JWT.
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
-- Dados de contato dos clientes; anonimização remove contatos apenas conforme as regras da API.
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(120) NOT NULL,
  email varchar(254), phone varchar(30), anonymized boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Catálogo e saldo atual. Valores monetários usam centavos inteiros.
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(120) NOT NULL,
  sku varchar(40) UNIQUE NOT NULL, quantity integer NOT NULL DEFAULT 0 CHECK (quantity BETWEEN 0 AND 1000000),
  unit_price_cents integer NOT NULL CHECK (unit_price_cents BETWEEN 0 AND 100000000),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Histórico de entradas/saídas, com motivo e responsável.
CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid NOT NULL REFERENCES products(id),
  delta integer NOT NULL CHECK (delta <> 0), reason varchar(200) NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
-- Pedidos/ordens vinculados ao cliente; os estados possíveis são limitados.
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES customers(id),
  description varchar(500) NOT NULL, amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 1 AND 100000000),
  status varchar(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','completed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Receitas e despesas. paid_at define o mês do recebimento/pagamento no painel.
CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type varchar(10) NOT NULL CHECK (type IN ('income','expense')),
  description varchar(300) NOT NULL, amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 1 AND 100000000),
  due_date date NOT NULL, status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','cancelled')),
  paid_at timestamptz, customer_id uuid REFERENCES customers(id), order_id uuid REFERENCES orders(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_transaction_per_order ON transactions(order_id) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS transactions_customer ON transactions(customer_id);
-- Metadados documentais vinculados ao financeiro. Não armazena XML/PDF nem emite notas.
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transaction_id uuid UNIQUE NOT NULL REFERENCES transactions(id),
  number varchar(80) NOT NULL, kind varchar(20) NOT NULL CHECK (kind IN ('invoice','receipt','other')),
  issued_on date NOT NULL, amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 1 AND 100000000),
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewed')),
  reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(kind,number)
);
-- Trilha de eventos sem cópia do cadastro inteiro, senha ou token.
CREATE TABLE IF NOT EXISTS audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES users(id), action varchar(60) NOT NULL,
  entity varchar(40) NOT NULL, entity_id uuid, reason varchar(200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_date ON audit_events(created_at DESC);
-- NULL preserva a distinção entre eventos antigos e alterações novas sem diferença de campos.
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS changes jsonb;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS reversible boolean NOT NULL DEFAULT false;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS reverses_event_id bigint REFERENCES audit_events(id);
CREATE UNIQUE INDEX IF NOT EXISTS audit_one_reversal ON audit_events(reverses_event_id) WHERE reverses_event_id IS NOT NULL;
-- Só comparativos de cadastros e configurações antigas podem ser habilitados retrospectivamente.
UPDATE audit_events SET reversible=true WHERE changes IS NOT NULL AND jsonb_array_length(changes)>0
  AND reverses_event_id IS NULL AND ((entity='customer' AND action='updated')
    OR (entity='business_settings' AND action='financial_settings_updated') OR (entity='user' AND action IN ('activated','deactivated')));

-- Uma configuração compartilhada pela empresa desta implantação.
CREATE TABLE IF NOT EXISTS business_settings (
  id smallint PRIMARY KEY CHECK (id = 1),
  tax_rate_basis_points integer NOT NULL DEFAULT 0 CHECK (tax_rate_basis_points BETWEEN 0 AND 10000),
  monthly_operating_costs_cents integer CHECK (monthly_operating_costs_cents BETWEEN 0 AND 100000000),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO business_settings(id) SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM business_settings WHERE id=1);
CREATE INDEX IF NOT EXISTS paid_transactions_date ON transactions(paid_at) WHERE status = 'paid';

-- Expansão aditiva: clientes antigos ficam preservados e podem completar o cadastro na edição.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS person_type varchar(2) DEFAULT 'PF';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tax_id varchar(14);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tax_regime varchar(30);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS trade_name varchar(120);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS state_registration varchar(30);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS municipal_registration varchar(30);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS postal_code varchar(8);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS street varchar(150);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_number varchar(20);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS complement varchar(100);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS district varchar(100);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS city varchar(100);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS state varchar(2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_deducted boolean NOT NULL DEFAULT false;
-- O preço fica copiado no item para preservar o valor histórico do pedido.
CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id),
  product_id uuid NOT NULL REFERENCES products(id), product_name varchar(120) NOT NULL,
  quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 1000000),
  unit_price_cents integer NOT NULL CHECK(unit_price_cents BETWEEN 0 AND 100000000),
  UNIQUE(order_id,product_id)
);
CREATE INDEX IF NOT EXISTS order_items_order ON order_items(order_id);
