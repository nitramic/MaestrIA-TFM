const { Pool } = require('pg');

const DIRECTORY_HOST = process.env.DIRECTORY_DB_HOST || 'pg-directory';
const DIRECTORY_PORT = parseInt(process.env.DIRECTORY_DB_PORT || '5432', 10);
const DIRECTORY_NAME = process.env.DIRECTORY_DB_NAME || 'directory';
const DIRECTORY_USER = process.env.DIRECTORY_DB_USER || 'postgres';
const DIRECTORY_PASSWORD = process.env.DIRECTORY_DB_PASSWORD || 'postgres';

const directoryPool = new Pool({
  host: DIRECTORY_HOST,
  port: DIRECTORY_PORT,
  database: DIRECTORY_NAME,
  user: DIRECTORY_USER,
  password: DIRECTORY_PASSWORD,
  max: 5,
  connectionTimeoutMillis: 3000,
});

// slug -> pg.Pool (connection pool only; company metadata is re-checked on
// every call so a suspend/delete from the admin panel takes effect right
// away instead of only after this process restarts).
const companyConnectionPools = new Map();

async function getCompanyBySlug(slug) {
  const { rows } = await directoryPool.query(
    'SELECT slug, display_name, db_host, db_port, db_name, db_user, db_password, active, status FROM companies WHERE slug = $1',
    [slug]
  );
  return rows[0] || null;
}

async function getCompanyPool(slug) {
  const company = await getCompanyBySlug(slug);
  if (!company || !company.active || company.status !== 'ready') return null;

  let pool = companyConnectionPools.get(slug);
  if (!pool) {
    pool = new Pool({
      host: company.db_host,
      port: company.db_port,
      database: company.db_name,
      user: company.db_user,
      password: company.db_password,
      max: 5,
      connectionTimeoutMillis: 3000,
    });
    companyConnectionPools.set(slug, pool);
  }

  return { pool, company };
}

async function checkDirectoryHealth() {
  try {
    await directoryPool.query('SELECT 1');
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = {
  directoryPool,
  getCompanyBySlug,
  getCompanyPool,
  checkDirectoryHealth,
};
