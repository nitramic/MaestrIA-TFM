const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { Client } = require('pg');
const { directoryPool } = require('../db');
const { createCompanyPostgres, waitForPgReady, removeCompanyPostgres } = require('../docker');
const { sendWelcomeEmail } = require('../mail');

const router = express.Router();
const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const INTERNAL_ADMIN_TOKEN = process.env.INTERNAL_ADMIN_TOKEN || '';

const COMPANY_SCHEMA_SQL = fs.readFileSync(
  path.join(__dirname, '..', '..', 'sql', 'company_schema.sql'),
  'utf8'
);

function genSecret(bytes) {
  return crypto.randomBytes(bytes).toString('base64url');
}

// Only reachable from inside fireguard-net (this service isn't published to
// the host); the shared-secret header plus the docker-socket check below are
// defense in depth against anything else that might land on that network.
router.use((req, res, next) => {
  if (!INTERNAL_ADMIN_TOKEN || req.get('X-Internal-Token') !== INTERNAL_ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!fs.existsSync(DOCKER_SOCKET)) {
    return res.status(503).json({ error: 'Docker socket no disponible en este nodo.' });
  }
  next();
});

router.post('/companies', async (req, res) => {
  const { slug, displayName, adminPassword: providedPassword, contactEmail, licenseCount: rawLicenseCount } = req.body || {};
  if (!slug || typeof slug !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(slug)) {
    return res.status(400).json({ error: 'Slug inválido.' });
  }

  const dbPassword = genSecret(24);
  const adminPassword = providedPassword && String(providedPassword).length >= 5 ? String(providedPassword) : genSecret(9);
  const adminEmail = `admin@${slug}`;
  const name = displayName || slug;
  const licenseCount = Number.isInteger(rawLicenseCount) && rawLicenseCount > 0 ? rawLicenseCount : 5;
  const verifyToken = genSecret(24);

  try {
    await directoryPool.query(
      `INSERT INTO companies (slug, display_name, db_host, db_port, db_name, db_user, db_password, active, status, status_message, contact_email, license_count)
       VALUES ($1, $2, $3, 5432, $4, 'postgres', $5, true, 'provisioning', NULL, $6, $7)
       ON CONFLICT (slug) DO UPDATE SET status = 'provisioning', status_message = NULL, contact_email = EXCLUDED.contact_email, license_count = EXCLUDED.license_count`,
      [slug, name, `pg-${slug}`, slug, dbPassword, contactEmail || null, licenseCount]
    );

    await createCompanyPostgres(slug, dbPassword);
    await waitForPgReady(`pg-${slug}`, 5432, 'postgres', dbPassword, slug, 60000);

    const client = new Client({ host: `pg-${slug}`, port: 5432, user: 'postgres', password: dbPassword, database: slug });
    await client.connect();
    try {
      await client.query(COMPANY_SCHEMA_SQL);
      const hash = await bcrypt.hash(adminPassword, 10);
      await client.query(
        `INSERT INTO users (email, password_hash, full_name, role, email_verify_token, email_verify_expires_at)
         VALUES ($1, $2, $3, 'admin', $4, now() + interval '7 days')
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, email_verify_token = EXCLUDED.email_verify_token, email_verify_expires_at = EXCLUDED.email_verify_expires_at`,
        [adminEmail, hash, `Admin ${name}`, verifyToken]
      );
    } finally {
      await client.end();
    }

    await directoryPool.query("UPDATE companies SET status = 'ready', status_message = NULL WHERE slug = $1", [slug]);

    let emailResult = { sent: false, reason: 'Sin email de contacto.' };
    if (contactEmail) {
      emailResult = await sendWelcomeEmail({
        to: contactEmail, companyName: name, email: adminEmail, password: adminPassword, slug, verifyToken,
      });
    }

    res.status(201).json({
      slug, displayName: name, adminEmail, adminPassword, status: 'ready', licenseCount,
      welcomeEmail: emailResult,
    });
  } catch (err) {
    await directoryPool
      .query('UPDATE companies SET status = $2, status_message = $3 WHERE slug = $1', [slug, 'error', String((err && err.message) || err)])
      .catch(() => {});
    res.status(500).json({ error: `No se pudo aprovisionar la empresa: ${(err && err.message) || err}` });
  }
});

router.delete('/companies/:slug', async (req, res) => {
  const { slug } = req.params;
  try {
    await removeCompanyPostgres(slug);
    await directoryPool.query('DELETE FROM companies WHERE slug = $1', [slug]);
    res.json({ success: true, slug });
  } catch (err) {
    res.status(500).json({ error: `No se pudo eliminar la empresa: ${(err && err.message) || err}` });
  }
});

module.exports = router;
