-- Runs against a per-company database (e.g. pg-emp01 / db "emp01").
-- Applied once per company when it's onboarded.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  role VARCHAR(32) NOT NULL DEFAULT 'inspector',
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  language VARCHAR(5) NOT NULL DEFAULT 'es',
  theme VARCHAR(10) NOT NULL DEFAULT 'system',
  timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Madrid',
  locked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Safe to re-run on an existing table (older deployments).
ALTER TABLE users ADD COLUMN IF NOT EXISTS language VARCHAR(5) NOT NULL DEFAULT 'es';
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme VARCHAR(10) NOT NULL DEFAULT 'system';
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Madrid';
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT false;

-- A site is a physical location (building/warehouse), shown as one bubble on the Units map.
CREATE TABLE IF NOT EXISTS sites (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL,
  lat NUMERIC(9,6) NOT NULL,
  lng NUMERIC(9,6) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS extinguishers (
  id SERIAL PRIMARY KEY,
  code VARCHAR(32) UNIQUE NOT NULL,
  site_id INTEGER REFERENCES sites(id),
  location VARCHAR(255) NOT NULL,
  type VARCHAR(64) NOT NULL,
  weight_kg NUMERIC(5,2),
  pressure_bar NUMERIC(6,2),
  serial_number VARCHAR(64),
  last_inspected DATE NOT NULL,
  next_due DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Safe to re-run on an existing table (older deployments).
ALTER TABLE extinguishers ADD COLUMN IF NOT EXISTS site_id INTEGER REFERENCES sites(id);

-- One row per inspection performed / status change, for the Reports log and stats.
CREATE TABLE IF NOT EXISTS inspection_history (
  id SERIAL PRIMARY KEY,
  extinguisher_id INTEGER NOT NULL REFERENCES extinguishers(id) ON DELETE CASCADE,
  action VARCHAR(32) NOT NULL, -- 'inspected' | 'status_change'
  previous_status VARCHAR(16),
  new_status VARCHAR(16),
  performed_by INTEGER REFERENCES users(id),
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inspection_history_performed_at ON inspection_history (performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_extinguishers_site_id ON extinguishers (site_id);
