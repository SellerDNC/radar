-- Radar ML — Migration 001: Schema inicial
-- Aplicada em: setup inicial

CREATE TABLE IF NOT EXISTS searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  keyword TEXT NOT NULL,
  cost REAL DEFAULT 0,
  avg_price REAL DEFAULT 0,
  margin_c REAL DEFAULT 0,
  verdict TEXT,
  score INTEGER DEFAULT 0,
  v1_ok INTEGER DEFAULT 0,
  v2_ok INTEGER DEFAULT 0,
  total_ads INTEGER DEFAULT 0,
  est_monthly INTEGER DEFAULT 0,
  result_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rankings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  keyword TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  item_id TEXT,
  item_title TEXT,
  position INTEGER,
  total_scanned INTEGER DEFAULT 1000,
  price REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tracked_keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  keyword TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  item_id TEXT,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dashboard_orders (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  pack_id TEXT,
  date_closed DATE NOT NULL,
  date_approved DATETIME,
  total REAL DEFAULT 0,
  commission REAL DEFAULT 0,
  freight REAL DEFAULT 0,
  net_revenue REAL DEFAULT 0,
  payment_type TEXT,
  payment_method TEXT,
  item_id TEXT,
  item_title TEXT,
  sku TEXT,
  category TEXT,
  quantity INTEGER DEFAULT 1,
  unit_price REAL DEFAULT 0,
  unit_revenue REAL DEFAULT 0,
  item_type TEXT,
  city TEXT,
  state TEXT,
  region TEXT,
  shipping_method TEXT,
  order_status TEXT,
  mediation_id TEXT,
  mediation_affects_rep INTEGER DEFAULT 0,
  PRIMARY KEY (id, tenant_id)
);

CREATE TABLE IF NOT EXISTS dashboard_sync (
  tenant_id TEXT PRIMARY KEY,
  last_sync DATETIME,
  orders_count INTEGER DEFAULT 0,
  date_from TEXT,
  date_to TEXT,
  status TEXT DEFAULT 'idle'
);

CREATE TABLE IF NOT EXISTS user_profile (
  tenant_id TEXT PRIMARY KEY,
  nickname TEXT,
  seller_id TEXT,
  rbt12 REAL DEFAULT 0,
  meta_mensal REAL DEFAULT 80000,
  taxa_classico REAL DEFAULT 0.115,
  taxa_premium REAL DEFAULT 0.16,
  taxa_fixa REAL DEFAULT 7.0,
  margem_minima REAL DEFAULT 25.0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS listing_diagnoses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_title TEXT,
  score INTEGER DEFAULT 0,
  score_titulo INTEGER DEFAULT 0,
  score_fotos INTEGER DEFAULT 0,
  score_descricao INTEGER DEFAULT 0,
  score_atributos INTEGER DEFAULT 0,
  score_preco INTEGER DEFAULT 0,
  score_frete INTEGER DEFAULT 0,
  score_vendas INTEGER DEFAULT 0,
  ai_recomendacoes TEXT,
  item_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ficha_tecnica (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_title TEXT,
  ficha_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS calendar_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  week_start TEXT NOT NULL,
  day_name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'geral',
  priority TEXT DEFAULT 'normal',
  auto_exec INTEGER DEFAULT 0,
  exec_action TEXT,
  done INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_searches_tenant ON searches(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rankings_tenant ON rankings(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracked_tenant ON tracked_keywords(tenant_id, active);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_date ON dashboard_orders(tenant_id, date_closed DESC);
CREATE INDEX IF NOT EXISTS idx_orders_item ON dashboard_orders(tenant_id, item_id);
CREATE INDEX IF NOT EXISTS idx_orders_state ON dashboard_orders(tenant_id, state);
CREATE INDEX IF NOT EXISTS idx_orders_payment ON dashboard_orders(tenant_id, payment_type);
CREATE INDEX IF NOT EXISTS idx_diag_tenant ON listing_diagnoses(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ficha_tenant ON ficha_tecnica(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calendar_tenant ON calendar_tasks(tenant_id, week_start);
