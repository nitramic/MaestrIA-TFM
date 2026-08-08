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
    'SELECT slug, display_name, db_host, db_port, db_name, db_user, db_password, active, status, license_count FROM companies WHERE slug = $1',
    [slug]
  );
  return rows[0] || null;
}

async function getCompanyPool(slug) {
  const company = await getCompanyBySlug(slug);
  if (!company || !company.active || company.status !== 'ready') return null;

  const cacheKey = `${company.db_host}:${company.db_port}/${company.db_name}:${company.db_user}:${company.db_password}`;
  const cached = companyConnectionPools.get(slug);

  // A company can be torn down and re-provisioned (new pg-<slug> container,
  // new random db_password) while app1/app2 keep running -- without this
  // check they'd keep reusing a pool built from the old credentials and
  // every query would fail auth against the new database.
  if (cached && cached.cacheKey !== cacheKey) {
    cached.pool.end().catch(() => {});
    companyConnectionPools.delete(slug);
  }

  let entry = companyConnectionPools.get(slug);
  if (!entry) {
    const pool = new Pool({
      host: company.db_host,
      port: company.db_port,
      database: company.db_name,
      user: company.db_user,
      password: company.db_password,
      max: 5,
      connectionTimeoutMillis: 3000,
    });
    entry = { pool, cacheKey };
    companyConnectionPools.set(slug, entry);
  }

  return { pool: entry.pool, company };
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
