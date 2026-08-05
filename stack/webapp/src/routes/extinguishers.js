const express = require('express');
const { getCompanyPool } = require('../db');
const { requireAuth } = require('../auth');
const { computeStatus, serialize } = require('../status');

const router = express.Router();

async function poolForRequest(req, res) {
  const entry = await getCompanyPool(req.session.slug);
  if (!entry) {
    res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
    return null;
  }
  return entry.pool;
}

async function logHistory(pool, extinguisherId, action, previousStatus, newStatus, userId) {
  if (action === 'inspected' && previousStatus === newStatus) return;
  await pool.query(
    `INSERT INTO inspection_history (extinguisher_id, action, previous_status, new_status, performed_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [extinguisherId, action, previousStatus, newStatus, userId || null]
  );
}

router.get('/', requireAuth, async (req, res) => {
  const pool = await poolForRequest(req, res);
  if (!pool) return;

  const conditions = [];
  const params = [];
  if (req.query.siteId) {
    params.push(req.query.siteId);
    conditions.push(`site_id = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const { rows } = await pool.query(
      `SELECT code, site_id, location, type, weight_kg, pressure_bar, serial_number, last_inspected, next_due
       FROM extinguishers ${where} ORDER BY code`,
      params
    );
    let items = rows.map(serialize);

    if (req.query.status) {
      const statuses = String(req.query.status).split(',').map((s) => s.trim()).filter(Boolean);
      if (statuses.length) items = items.filter((i) => statuses.includes(i.status));
    }

    const summary = {
      total: items.length,
      ok: items.filter((i) => i.status === 'ok').length,
      dueSoon: items.filter((i) => i.status === 'due_soon').length,
      overdue: items.filter((i) => i.status === 'overdue').length,
    };
    res.json({ summary, items });
  } catch (err) {
    res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }
});

router.get('/:code', requireAuth, async (req, res) => {
  const pool = await poolForRequest(req, res);
  if (!pool) return;
  try {
    const { rows } = await pool.query(
      'SELECT code, site_id, location, type, weight_kg, pressure_bar, serial_number, last_inspected, next_due FROM extinguishers WHERE code = $1',
      [req.params.code]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Extintor no encontrado' });
    res.json(serialize(rows[0]));
  } catch (err) {
    res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }
});

router.put('/:code', requireAuth, async (req, res) => {
  const pool = await poolForRequest(req, res);
  if (!pool) return;

  const { location, type, pressureBar, serialNumber, lastInspected, nextDue } = req.body || {};

  try {
    const before = await pool.query('SELECT id, next_due FROM extinguishers WHERE code = $1', [req.params.code]);
    if (before.rows.length === 0) return res.status(404).json({ error: 'Extintor no encontrado' });
    const previousStatus = computeStatus(before.rows[0].next_due);

    const { rows } = await pool.query(
      `UPDATE extinguishers SET
         location = COALESCE($1, location),
         type = COALESCE($2, type),
         pressure_bar = COALESCE($3, pressure_bar),
         serial_number = COALESCE($4, serial_number),
         last_inspected = COALESCE($5, last_inspected),
         next_due = COALESCE($6, next_due),
         updated_at = now()
       WHERE code = $7
       RETURNING id, code, site_id, location, type, weight_kg, pressure_bar, serial_number, last_inspected, next_due`,
      [location, type, pressureBar, serialNumber, lastInspected, nextDue, req.params.code]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Extintor no encontrado' });

    const item = serialize(rows[0]);
    if (lastInspected) {
      await logHistory(pool, rows[0].id, 'inspected', previousStatus, item.status, req.session.userId);
    } else if (previousStatus !== item.status) {
      await logHistory(pool, rows[0].id, 'status_change', previousStatus, item.status, req.session.userId);
    }

    res.json(item);
  } catch (err) {
    res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }
});

// Sets Last Inspected = today and Next Due = today + 1 year in one shot.
router.post('/:code/inspect-now', requireAuth, async (req, res) => {
  const pool = await poolForRequest(req, res);
  if (!pool) return;
  try {
    const before = await pool.query('SELECT next_due FROM extinguishers WHERE code = $1', [req.params.code]);
    if (before.rows.length === 0) return res.status(404).json({ error: 'Extintor no encontrado' });
    const previousStatus = computeStatus(before.rows[0].next_due);

    const { rows } = await pool.query(
      `UPDATE extinguishers SET
         last_inspected = CURRENT_DATE,
         next_due = CURRENT_DATE + INTERVAL '1 year',
         updated_at = now()
       WHERE code = $1
       RETURNING id, code, site_id, location, type, weight_kg, pressure_bar, serial_number, last_inspected, next_due`,
      [req.params.code]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Extintor no encontrado' });

    const item = serialize(rows[0]);
    await logHistory(pool, rows[0].id, 'inspected', previousStatus, item.status, req.session.userId);

    res.json(item);
  } catch (err) {
    res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }
});

module.exports = router;
