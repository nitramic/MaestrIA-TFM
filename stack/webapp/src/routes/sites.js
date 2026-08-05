const express = require('express');
const { getCompanyPool } = require('../db');
const { requireAuth } = require('../auth');
const { computeStatus } = require('../status');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const entry = await getCompanyPool(req.session.slug);
  if (!entry) return res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  const { pool } = entry;

  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.lat, s.lng, e.next_due
       FROM sites s
       LEFT JOIN extinguishers e ON e.site_id = s.id
       ORDER BY s.id`
    );

    const bySite = new Map();
    for (const row of rows) {
      if (!bySite.has(row.id)) {
        bySite.set(row.id, { id: row.id, name: row.name, lat: Number(row.lat), lng: Number(row.lng), total: 0, ok: 0, dueSoon: 0, overdue: 0 });
      }
      const site = bySite.get(row.id);
      if (row.next_due) {
        site.total += 1;
        const status = computeStatus(row.next_due);
        if (status === 'ok') site.ok += 1;
        else if (status === 'due_soon') site.dueSoon += 1;
        else site.overdue += 1;
      }
    }

    const sites = Array.from(bySite.values()).map((s) => ({
      ...s,
      needsIntervention: s.dueSoon + s.overdue,
    }));

    res.json({ sites });
  } catch (err) {
    res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }
});

module.exports = router;
