-- Migração aditiva: preserva registros antigos sem criar uma empresa cliente fictícia.
CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(120) NOT NULL,
  tax_id varchar(14) UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;
INSERT INTO companies(id,name,is_internal) VALUES('00000000-0000-4000-8000-000000000001','Registros anteriores',true) ON CONFLICT DO NOTHING;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin boolean NOT NULL DEFAULT false;

-- Papel sem login nem poderes para ignorar isolamento. Só o executor da migração pode assumi-lo.
DO $$ BEGIN
  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='erp_tenant') THEN
    CREATE ROLE erp_tenant NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF EXISTS(SELECT FROM pg_roles WHERE rolname='erp_tenant' AND (rolsuper OR rolbypassrls OR rolcanlogin OR rolcreaterole OR rolcreatedb)) THEN
    RAISE EXCEPTION 'O papel erp_tenant possui privilégios incompatíveis com isolamento seguro';
  END IF;
  EXECUTE format('GRANT erp_tenant TO %I',current_user);
END $$;
GRANT USAGE ON SCHEMA public TO erp_tenant;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['users','customers','products','orders','order_items','transactions','documents','stock_movements','audit_events','business_settings'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS company_id uuid NOT NULL DEFAULT ''00000000-0000-4000-8000-000000000001'' REFERENCES companies(id)',t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN company_id SET DEFAULT COALESCE(NULLIF(current_setting(''app.company_id'',true),''''),''00000000-0000-4000-8000-000000000001'')::uuid',t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(company_id)',t||'_company',t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS company_isolation ON %I',t);
    EXECUTE format('CREATE POLICY company_isolation ON %I TO erp_tenant USING (company_id=NULLIF(current_setting(''app.company_id'',true),'''')::uuid) WITH CHECK (company_id=NULLIF(current_setting(''app.company_id'',true),'''')::uuid)',t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO erp_tenant',t);
    IF t <> 'business_settings' THEN
      EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I(company_id,id)',t||'_company_id',t);
    END IF;
  END LOOP;
END $$;
-- Usuários comuns nunca consultam nem criam administradores gerais.
DROP POLICY IF EXISTS company_isolation ON users;
CREATE POLICY company_isolation ON users TO erp_tenant
  USING(company_id=NULLIF(current_setting('app.company_id',true),'')::uuid AND NOT is_platform_admin)
  WITH CHECK(company_id=NULLIF(current_setting('app.company_id',true),'')::uuid AND NOT is_platform_admin);
-- Não se concede UPDATE irrestrito de usuários: a API só altera essas colunas.
REVOKE UPDATE ON users FROM erp_tenant;
GRANT UPDATE(name,email,password_hash,role,active,failed_attempts,locked_until) ON users TO erp_tenant;
GRANT USAGE,SELECT ON SEQUENCE audit_events_id_seq TO erp_tenant;
REVOKE UPDATE,DELETE ON audit_events FROM erp_tenant;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS actor_name varchar(100) DEFAULT NULLIF(current_setting('app.actor_name',true),'');

-- Códigos e documentos únicos dentro da empresa, não entre negócios diferentes.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_key;
CREATE UNIQUE INDEX IF NOT EXISTS products_company_sku ON products(company_id,sku);
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_kind_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS documents_company_number ON documents(company_id,kind,number);
DROP INDEX IF EXISTS customers_tax_id_unique;
CREATE UNIQUE INDEX IF NOT EXISTS customers_company_tax_id ON customers(company_id,tax_id) WHERE tax_id IS NOT NULL AND anonymized=false;
ALTER TABLE business_settings DROP CONSTRAINT IF EXISTS business_settings_pkey;
ALTER TABLE business_settings ADD PRIMARY KEY(company_id,id);

-- Chaves compostas impedem ligar um pedido/nota/produto de outra empresa mesmo conhecendo seu UUID.
DO $$ DECLARE rel record; BEGIN
  FOR rel IN SELECT * FROM (VALUES
    ('orders','customer_id','customers'),('order_items','order_id','orders'),
    ('order_items','product_id','products'),('transactions','customer_id','customers'),
    ('transactions','order_id','orders'),('documents','transaction_id','transactions'),
    ('stock_movements','product_id','products')
  ) AS r(child,col,parent) LOOP
    IF NOT EXISTS(SELECT FROM pg_constraint WHERE conname=rel.child||'_'||rel.col||'_tenant_fk') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY(company_id,%I) REFERENCES %I(company_id,id)',rel.child,rel.child||'_'||rel.col||'_tenant_fk',rel.col,rel.parent);
    END IF;
  END LOOP;
END $$;
-- Sessões são globais, mas uma alteração dentro da empresa só revoga sessões de seus usuários.
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_sessions ON sessions;
CREATE POLICY company_sessions ON sessions TO erp_tenant
  USING(EXISTS(SELECT 1 FROM users WHERE users.id=sessions.user_id));
GRANT SELECT,DELETE ON sessions TO erp_tenant;

-- Administração geral e suporte ficam fora do alcance do papel de empresa.
CREATE TABLE IF NOT EXISTS platform_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES users(id), company_id uuid REFERENCES companies(id),
  action varchar(60) NOT NULL, reason varchar(200) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_events_company_date ON platform_events(company_id,created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS support_access (
  session_id uuid PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id),
  reason varchar(200) NOT NULL, writable boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL
);

-- O dono da plataforma não pertence a uma empresa cliente.
ALTER TABLE users ALTER COLUMN company_id DROP NOT NULL;
UPDATE users SET company_id=NULL WHERE is_platform_admin;
DO $$ BEGIN
  IF NOT EXISTS(SELECT FROM pg_constraint WHERE conname='users_company_required') THEN
    ALTER TABLE users ADD CONSTRAINT users_company_required CHECK((is_platform_admin AND company_id IS NULL) OR (NOT is_platform_admin AND company_id IS NOT NULL));
  END IF;
END $$;
-- O contêiner técnico só aparece como cadastro a identificar se houver dados reais anteriores.
-- Não exclui clientes, configurações, usuários nem histórico de auditoria.
UPDATE companies c SET
  name=CASE WHEN name='Empresa principal' THEN 'Registros anteriores' ELSE name END,
  is_internal=NOT (
    EXISTS(SELECT 1 FROM users WHERE company_id=c.id AND NOT is_platform_admin) OR
    EXISTS(SELECT 1 FROM customers WHERE company_id=c.id) OR
    EXISTS(SELECT 1 FROM products WHERE company_id=c.id) OR
    EXISTS(SELECT 1 FROM orders WHERE company_id=c.id) OR
    EXISTS(SELECT 1 FROM transactions WHERE company_id=c.id) OR
    EXISTS(SELECT 1 FROM documents WHERE company_id=c.id) OR
    EXISTS(SELECT 1 FROM business_settings WHERE company_id=c.id AND (tax_rate_basis_points<>0 OR monthly_operating_costs_cents IS NOT NULL))
  )
WHERE c.id='00000000-0000-4000-8000-000000000001' AND c.tax_id IS NULL
  AND c.name IN ('Empresa principal','Registros anteriores');
