const express = require('express');
const bcrypt = require('bcryptjs');
const { getCompanyPool } = require('../db');
const { requireAuth, requireCompanyAdmin } = require('../auth');

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

router.post('/users/:id/reset-password', requireAuth, requireCompanyAdmin, async (req, res) => {
  const pool = await poolForRequest(req, res);
  if (!pool) return;
  const { newPassword } = req.body || {};
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 5) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 5 caracteres.' });
  }
  try {
    const hash = await bcrypt.hash(newPassword, 10);
    const { rows } = await pool.query(
      'UPDATE users SET password_hash = $1, failed_attempts = 0, locked_until = NULL WHERE id = $2 RETURNING id, email',
      [hash, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ success: true });
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
