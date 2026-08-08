const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { directoryPool, getCompanyPool } = require('../db');
const { issueAdminSession, clearAdminSession, requireAdminAuth } = require('../adminAuth');

const router = express.Router();

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 5;
const DUMMY_HASH = '$2b$10$G7xwOt9ZXu76ut/PC4ery.UdBe7k8UY63iKFdHkdwwBSPbraU8HAK';

const ADMIN_WORKER_URL = process.env.ADMIN_WORKER_URL || 'http://admin-worker:3000';
const INTERNAL_ADMIN_TOKEN = process.env.INTERNAL_ADMIN_TOKEN || '';

const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intente nuevamente en unos minutos.' },
});

function minutesLeft(lockedUntil) {
  return Math.max(1, Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 60000));
}

async function callInternal(path, options) {
  const res = await fetch(`${ADMIN_WORKER_URL}/internal${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Token': INTERNAL_ADMIN_TOKEN,
      ...(options && options.headers),
    },
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  return { ok: res.ok, status: res.status, data };
}

// ---------------- Superadmin auth ----------------

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  const INVALID = { error: 'Datos no válidos.' };

  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json(INVALID);
  }

  try {
    const { rows } = await directoryPool.query(
      'SELECT id, email, password_hash, full_name, failed_attempts, locked_until FROM admin_users WHERE lower(email) = lower($1)',
      [email]
    );

    if (rows.length === 0) {
      await bcrypt.compare(password, DUMMY_HASH);
      return res.status(401).json(INVALID);
    }

    const admin = rows[0];

    if (admin.locked_until && new Date(admin.locked_until).getTime() > Date.now()) {
      return res.status(429).json({
        error: `Cuenta bloqueada temporalmente. Intente nuevamente en ${minutesLeft(admin.locked_until)} minuto(s).`,
      });
    }

    const match = await bcrypt.compare(password, admin.password_hash);

    if (!match) {
      const attempts = (admin.failed_attempts || 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await directoryPool.query(
          "UPDATE admin_users SET failed_attempts = $1, locked_until = now() + interval '5 minutes' WHERE id = $2",
          [attempts, admin.id]
        );
        return res.status(429).json({
          error: `Demasiados intentos fallidos. Cuenta bloqueada por ${LOCK_MINUTES} minutos.`,
        });
      }
      await directoryPool.query('UPDATE admin_users SET failed_attempts = $1 WHERE id = $2', [attempts, admin.id]);
      return res.status(401).json(INVALID);
    }

    await directoryPool.query('UPDATE admin_users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [admin.id]);

    issueAdminSession(res, { adminId: admin.id, email: admin.email });
    res.json({ success: true, admin: { email: admin.email, fullName: admin.full_name } });
  } catch (err) {
    res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }
});

router.post('/logout', (req, res) => {
  clearAdminSession(res);
  res.json({ success: true });
});

router.get('/me', requireAdminAuth, (req, res) => {
  res.json({ admin: req.admin });
});

// ---------------- Companies ----------------

async function countPendingPasswordResets(slug) {
  try {
    const entry = await getCompanyPool(slug);
    if (!entry) return 0;
    const { rows } = await entry.pool.query(
      'SELECT count(*)::int AS n FROM users WHERE password_reset_requested_at IS NOT NULL'
    );
    return rows[0].n;
  } catch (err) {
    return 0;
  }
}

router.get('/companies', requireAdminAuth, async (req, res) => {
  try {
    const { rows } = await directoryPool.query(
      `SELECT slug, display_name, db_host, active, status, status_message, created_at
       FROM companies ORDER BY created_at DESC`
    );
    const companies = await Promise.all(
      rows.map(async (c) => ({ ...c, pendingPasswordResets: await countPendingPasswordResets(c.slug) }))
    );
    res.json({ companies });
  } catch (err) {
    res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/companies', requireAdminAuth, async (req, res) => {
  const { slug, displayName, adminPassword, contactEmail, licenseCount } = req.body || {};
  if (!slug || typeof slug !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(slug)) {
    return res.status(400).json({ error: 'Slug inválido (minúsculas, dígitos, - o _).' });
  }
  if (!displayName || typeof displayName !== 'string') {
    return res.status(400).json({ error: 'Falta el nombre visible de la empresa.' });
  }
  if (!contactEmail || typeof contactEmail !== 'string' || !EMAIL_RE.test(contactEmail.trim())) {
    return res.status(400).json({ error: 'Ingresá un email de contacto válido.' });
  }
  const parsedLicenseCount = Number(licenseCount);
  if (!Number.isInteger(parsedLicenseCount) || parsedLicenseCount < 1) {
    return res.status(400).json({ error: 'La cantidad de licencias debe ser un número entero mayor a 0.' });
  }

  try {
    const existing = await directoryPool.query('SELECT 1 FROM companies WHERE slug = $1', [slug]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: `Ya existe una empresa con slug '${slug}'.` });
    }
  } catch (err) {
    return res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }

  const result = await callInternal('/companies', {
    method: 'POST',
    body: JSON.stringify({ slug, displayName, adminPassword, contactEmail: contactEmail.trim(), licenseCount: parsedLicenseCount }),
  });

  if (!result.ok) {
    return res.status(result.status || 502).json(result.data || { error: 'No se pudo aprovisionar la empresa.' });
  }

  res.status(201).json(result.data);
});

router.patch('/companies/:slug', requireAdminAuth, async (req, res) => {
  const { active } = req.body || {};
  if (typeof active !== 'boolean') return res.status(400).json({ error: 'Falta el campo active (boolean).' });

  try {
    const { rows } = await directoryPool.query(
      'UPDATE companies SET active = $1 WHERE slug = $2 RETURNING slug, active',
      [active, req.params.slug]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Empresa no encontrada.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }
});

router.delete('/companies/:slug', requireAdminAuth, async (req, res) => {
  const result = await callInternal(`/companies/${encodeURIComponent(req.params.slug)}`, { method: 'DELETE' });
  if (!result.ok) {
    return res.status(result.status || 502).json(result.data || { error: 'No se pudo eliminar la empresa.' });
  }
  res.json(result.data);
});

// ---------------- Per-company users ----------------

router.get('/companies/:slug/users', requireAdminAuth, async (req, res) => {
  let entry;
  try {
    entry = await getCompanyPool(req.params.slug);
  } catch (err) {
    return res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }
  if (!entry) return res.status(404).json({ error: 'Empresa no encontrada o no disponible.' });

  try {
    const { rows } = await entry.pool.query(
      'SELECT id, email, full_name, role, locked, last_login_at, password_reset_requested_at, created_at FROM users ORDER BY created_at'
    );
    res.json({
      users: rows.map((u) => ({
        id: u.id,
        email: u.email,
        fullName: u.full_name,
        role: u.role,
        locked: u.locked,
        lastLoginAt: u.last_login_at,
        passwordResetRequestedAt: u.password_reset_requested_at,
        createdAt: u.created_at,
      })),
    });
  } catch (err) {
    res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }
});

router.post('/companies/:slug/users/:userId/reset-password', requireAdminAuth, async (req, res) => {
  let entry;
  try {
    entry = await getCompanyPool(req.params.slug);
  } catch (err) {
    return res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }
  if (!entry) return res.status(404).json({ error: 'Empresa no encontrada o no disponible.' });

  const newPassword = crypto.randomBytes(9).toString('base64url');

  try {
    const hash = await bcrypt.hash(newPassword, 10);
    const { rows } = await entry.pool.query(
      `UPDATE users SET password_hash = $1, failed_attempts = 0, locked_until = NULL, password_reset_requested_at = NULL
       WHERE id = $2 RETURNING email`,
      [hash, req.params.userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado.' });
    res.json({ email: rows[0].email, password: newPassword });
  } catch (err) {
    res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }
});

router.post('/companies/:slug/admin-password', requireAdminAuth, async (req, res) => {
  const slug = req.params.slug;
  const adminEmail = `admin@${slug}`;

  let entry;
  try {
    entry = await getCompanyPool(slug);
  } catch (err) {
    return res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }
  if (!entry) return res.status(404).json({ error: 'Empresa no encontrada o no disponible.' });

  const newPassword = crypto.randomBytes(9).toString('base64url');

  try {
    const hash = await bcrypt.hash(newPassword, 10);
    const { rows } = await entry.pool.query(
      'UPDATE users SET password_hash = $1, failed_attempts = 0, locked_until = NULL WHERE lower(email) = lower($2) RETURNING email',
      [hash, adminEmail]
    );
    if (rows.length === 0) return res.status(404).json({ error: `No existe el usuario ${adminEmail}.` });
    res.json({ email: adminEmail, password: newPassword });
  } catch (err) {
    res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }
});

module.exports = router;
