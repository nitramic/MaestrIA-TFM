const express = require('express');
const { getCompanyPool } = require('../db');
const { requireAuth } = require('../auth');
const { computeStatus } = require('../status');

const router = express.Router();

async function poolForRequest(req, res) {
  const entry = await getCompanyPool(req.session.slug);
  if (!entry) {
    res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
    return null;
  }
  return entry.pool;
}

router.get('/summary', requireAuth, async (req, res) => {
  const pool = await poolForRequest(req, res);
  if (!pool) return;
  try {
    const { rows } = await pool.query('SELECT next_due FROM extinguishers');
    const summary = { ok: 0, dueSoon: 0, overdue: 0 };
    for (const row of rows) {
      const status = computeStatus(row.next_due);
      if (status === 'ok') summary.ok += 1;
      else if (status === 'due_soon') summary.dueSoon += 1;
      else summary.overdue += 1;
    }
    res.json(summary);
  } catch (err) {
    res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }
});

router.get('/activity', requireAuth, async (req, res) => {
  const pool = await poolForRequest(req, res);
  if (!pool) return;
  const days = Math.max(1, parseInt(req.query.days, 10) || 30);
  try {
    const { rows } = await pool.query(
      `SELECT action, previous_status, new_status FROM inspection_history
       WHERE performed_at >= now() - ($1 || ' days')::interval`,
      [days]
    );
    const inspected = rows.filter((r) => r.action === 'inspected').length;
    const statusChangedToOk = rows.filter((r) => r.new_status === 'ok' && r.previous_status && r.previous_status !== 'ok').length;
    res.json({ days, inspected, statusChangedToOk });
  } catch (err) {
    res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }
});

router.get('/forecast', requireAuth, async (req, res) => {
  const pool = await poolForRequest(req, res);
  if (!pool) return;
  const months = Math.min(24, Math.max(1, parseInt(req.query.months, 10) || 12));
  try {
    const { rows } = await pool.query('SELECT next_due FROM extinguishers');
    const buckets = buildMonthBuckets(months);
    for (const row of rows) {
      const key = monthKey(row.next_due);
      if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1);
    }
    res.json({ months: Array.from(buckets, ([month, count]) => ({ month, count })) });
  } catch (err) {
    res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }
});

router.get('/forecast-by-type', requireAuth, async (req, res) => {
  const pool = await poolForRequest(req, res);
  if (!pool) return;
  const months = Math.min(24, Math.max(1, parseInt(req.query.months, 10) || 12));
  try {
    const { rows } = await pool.query('SELECT type, next_due FROM extinguishers');
    const monthLabels = Array.from(buildMonthBuckets(months).keys());
    const byType = new Map();
    for (const row of rows) {
      if (!byType.has(row.type)) byType.set(row.type, buildMonthBuckets(months));
      const key = monthKey(row.next_due);
      const buckets = byType.get(row.type);
      if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1);
    }
    const series = Array.from(byType, ([type, buckets]) => ({
      type,
      counts: monthLabels.map((m) => buckets.get(m)),
    }));
    res.json({ months: monthLabels, series });
  } catch (err) {
    res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }
});

router.get('/recent', requireAuth, async (req, res) => {
  const pool = await poolForRequest(req, res);
  if (!pool) return;
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
  try {
    const { rows } = await pool.query(
      `SELECT h.id, h.action, h.previous_status, h.new_status, h.performed_at,
              e.code, e.type, u.email AS performed_by_email
       FROM inspection_history h
       JOIN extinguishers e ON e.id = h.extinguisher_id
       LEFT JOIN users u ON u.id = h.performed_by
       ORDER BY h.performed_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        code: r.code,
        type: r.type,
        action: r.action,
        previousStatus: r.previous_status,
        newStatus: r.new_status,
        performedAt: r.performed_at,
        performedBy: r.performed_by_email,
      })),
    });
  } catch (err) {
    res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }
});

function buildMonthBuckets(months) {
  const buckets = new Map();
  const now = new Date();
  for (let i = 0; i < months; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    buckets.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, 0);
  }
  return buckets;
}

function monthKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

module.exports = router;
