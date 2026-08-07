-- Runs against the "directory" database (pg-directory service).
-- Maps a company slug (the part of the login email after the @, before the
-- first dot) to the Postgres connection details for that company's own
-- database, deployed separately (via deploy-postgres.sh / add-company.sh,
-- or provisioned on demand by the /admin panel).

CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(63) UNIQUE NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  db_host VARCHAR(255) NOT NULL,
  db_port INTEGER NOT NULL DEFAULT 5432,
  db_name VARCHAR(63) NOT NULL,
  db_user VARCHAR(63) NOT NULL,
  db_password VARCHAR(255) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  status VARCHAR(32) NOT NULL DEFAULT 'ready',
  status_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Safe to re-run on an existing table (older deployments).
ALTER TABLE companies ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'ready';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS status_message TEXT;

-- Superadmin accounts for the /admin control panel. Not tied to any company.
CREATE TABLE IF NOT EXISTS admin_users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Login superadmin: el hash se sustituye en tiempo de deploy (deploy-webapp.sh)
-- a partir de SUPERADMIN_PASSWORD_HASH en secrets.env (ver generate-secrets.sh).
INSERT INTO admin_users (email, password_hash, full_name)
VALUES ('superadmin@fireguard.local', '__SUPERADMIN_PASSWORD_HASH__', 'Super Admin')
ON CONFLICT (email) DO NOTHING;
