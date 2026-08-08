const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getCompanyPool, directoryPool } = require('../db');
const { requireAuth, requireCompanyAdmin } = require('../auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;
const ROLES = new Set(['admin', 'inspector']);

function generatePassword() {
  return crypto.randomBytes(9).toString('base64url');
}

const router = express.Router();

async function poolForRequest(req, res) {
  const entry = await getCompanyPool(req.session.slug);
  if (!entry) {
    res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
    return null;
  }
  return entry.pool;
}

router.get('/me', requireAuth, async (req, res) => {
  const pool = await poolForRequest(req, res);
  if (!pool) return;
  try {
    const { rows } = await pool.query(
      'SELECT email, full_name, role, timezone FROM users WHERE id = $1',
      [req.session.userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    const u = rows[0];
    res.json({ email: u.email, fullName: u.full_name, role: u.role, timezone: u.timezone });
  } catch (err) {
    res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }
});

router.put('/me', requireAuth, async (req, res) => {
  const pool = await poolForRequest(req, res);
  if (!pool) return;
  const { timezone } = req.body || {};

  if (timezone !== undefined && (typeof timezone !== 'string' || timezone.length > 64)) {
    return res.status(400).json({ error: 'Zona horaria inválida.' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE users SET timezone = COALESCE($1, timezone)
       WHERE id = $2
       RETURNING email, full_name, role, timezone`,
      [timezone, req.session.userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    const u = rows[0];
    res.json({ email: u.email, fullName: u.full_name, role: u.role, timezone: u.timezone });
  } catch (err) {
    res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }
});

router.put('/password', requireAuth, async (req, res) => {
  const pool = await poolForRequest(req, res);
  if (!pool) return;
  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword || typeof newPassword !== 'string' || newPassword.length < 5) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 5 caracteres.' });
  }

  try {
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.session.userId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

    const match = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'La contraseña actual no es correcta.' });

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.session.userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }
});

// ---------------- Company-admin user management ----------------

router.get('/users', requireAuth, requireCompanyAdmin, async (req, res) => {
  const pool = await poolForRequest(req, res);
  if (!pool) return;
  try {
    const { rows } = await pool.query(
      'SELECT id, email, full_name, role, locked, created_at FROM users ORDER BY created_at'
    );
    res.json({ users: rows.map((u) => ({ id: u.id, email: u.email, fullName: u.full_name, role: u.role, locked: u.locked, createdAt: u.created_at })) });
  } catch (err) {
    res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }
});

router.post('/users', requireAuth, requireCompanyAdmin, async (req, res) => {
  const pool = await poolForRequest(req, res);
  if (!pool) return;
  const { email, fullName, role, password } = req.body || {};

  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: 'Ingresá un email válido.' });
  }
  const finalRole = ROLES.has(role) ? role : 'inspector';
  if (password !== undefined && password !== '' && (typeof password !== 'string' || password.length < 5)) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 5 caracteres.' });
  }
  const finalPassword = password || generatePassword();

  try {
    const { rows: limitRows } = await directoryPool.query(
      'SELECT license_count FROM companies WHERE slug = $1', [req.session.slug]
    );
    const licenseCount = limitRows[0] ? limitRows[0].license_count : 5;
    const { rows: countRows } = await pool.query('SELECT count(*)::int AS n FROM users');
    if (countRows[0].n >= licenseCount) {
      return res.status(403).json({ error: `Se alcanzó el límite de ${licenseCount} usuario(s) para esta empresa.` });
    }
  } catch (err) {
    return res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }

  try {
    const hash = await bcrypt.hash(finalPassword, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, full_name, role, locked, created_at`,
      [email.trim().toLowerCase(), hash, fullName || null, finalRole]
    );
    const u = rows[0];
    res.status(201).json({
      id: u.id, email: u.email, fullName: u.full_name, role: u.role, locked: u.locked, createdAt: u.created_at,
      password: finalPassword,
    });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un usuario con ese email.' });
    res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }
});

router.delete('/users/:id', requireAuth, requireCompanyAdmin, async (req, res) => {
  const pool = await poolForRequest(req, res);
  if (!pool) return;
  if (String(req.params.id) === String(req.session.userId)) {
    return res.status(400).json({ error: 'No podés eliminar tu propio usuario.' });
  }
  try {
    const { rows } = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ success: true });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({ error: 'No se puede eliminar: el usuario tiene historial de inspecciones asociado.' });
    }
    res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }
});

router.post('/users/:id/reset-password', requireAuth, requireCompanyAdmin, async (req, res) => {
  const pool = await poolForRequest(req, res);
  if (!pool) return;
  const newPassword = generatePassword();
  try {
    const hash = await bcrypt.hash(newPassword, 10);
    const { rows } = await pool.query(
      'UPDATE users SET password_hash = $1, failed_attempts = 0, locked_until = NULL WHERE id = $2 RETURNING id, email',
      [hash, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ email: rows[0].email, password: newPassword });
  } catch (err) {
    res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }
});

router.post('/users/:id/lock', requireAuth, requireCompanyAdmin, async (req, res) => {
  const pool = await poolForRequest(req, res);
  if (!pool) return;
  try {
    const { rows } = await pool.query('UPDATE users SET locked = true WHERE id = $1 RETURNING id, email, locked', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }
});

router.post('/users/:id/unlock', requireAuth, requireCompanyAdmin, async (req, res) => {
  const pool = await poolForRequest(req, res);
  if (!pool) return;
  try {
    const { rows } = await pool.query(
      'UPDATE users SET locked = false, failed_attempts = 0, locked_until = NULL WHERE id = $1 RETURNING id, email, locked',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }
});

module.exports = router;
