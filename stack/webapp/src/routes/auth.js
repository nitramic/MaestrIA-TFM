const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { getCompanyPool } = require('../db');
const { slugFromEmail, issueSession, clearSession, requireAuth } = require('../auth');

const router = express.Router();

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 5;

// Dummy hash used to keep response timing similar when the account/company
// doesn't exist, so login responses don't leak which part was wrong.
const DUMMY_HASH = '$2b$10$G7xwOt9ZXu76ut/PC4ery.UdBe7k8UY63iKFdHkdwwBSPbraU8HAK';

// Coarse secondary defense against distributed/volumetric guessing, on top
// of the per-account lockout below (which is the primary control).
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

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  const INVALID = { error: 'Datos no válidos.' };

  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json(INVALID);
  }

  const slug = slugFromEmail(email);
  if (!slug) return res.status(400).json(INVALID);

  let entry;
  try {
    entry = await getCompanyPool(slug);
  } catch (err) {
    return res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }

  if (!entry) {
    await bcrypt.compare(password, DUMMY_HASH);
    return res.status(401).json(INVALID);
  }

  const { pool, company } = entry;

  try {
    const { rows } = await pool.query(
      'SELECT id, email, password_hash, role, full_name, failed_attempts, locked_until, locked, language, theme, timezone FROM users WHERE lower(email) = lower($1)',
      [email]
    );

    if (rows.length === 0) {
      await bcrypt.compare(password, DUMMY_HASH);
      return res.status(401).json(INVALID);
    }

    const user = rows[0];

    if (user.locked) {
      await bcrypt.compare(password, DUMMY_HASH);
      return res.status(423).json({ error: 'Cuenta bloqueada por el administrador. Contacte a su administrador.' });
    }

    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      return res.status(429).json({
        error: `Cuenta bloqueada temporalmente. Intente nuevamente en ${minutesLeft(user.locked_until)} minuto(s).`,
      });
    }

    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      const attempts = (user.failed_attempts || 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await pool.query(
          "UPDATE users SET failed_attempts = $1, locked_until = now() + interval '5 minutes' WHERE id = $2",
          [attempts, user.id]
        );
        return res.status(429).json({
          error: `Demasiados intentos fallidos. Cuenta bloqueada por ${LOCK_MINUTES} minutos.`,
        });
      }
      await pool.query('UPDATE users SET failed_attempts = $1 WHERE id = $2', [attempts, user.id]);
      return res.status(401).json(INVALID);
    }

    await pool.query(
      'UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1',
      [user.id]
    );

    issueSession(res, {
      userId: user.id,
      email: user.email,
      slug,
      role: user.role,
      companyName: company.display_name,
    });

    return res.json({
      success: true,
      user: {
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        companyName: company.display_name,
        language: user.language,
        theme: user.theme,
        timezone: user.timezone,
      },
    });
  } catch (err) {
    return res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }
});

// Always responds the same way regardless of whether the email/company
// exists, to avoid leaking account existence. The actual reset happens
// out-of-band: support sees the pending request against the user in the
// admin panel's company user list and resets the password from there.
router.post('/forgot-password', loginLimiter, async (req, res) => {
  const { email } = req.body || {};
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Debe ingresar un email.' });
  }

  const slug = slugFromEmail(email);
  if (slug) {
    try {
      const entry = await getCompanyPool(slug);
      if (entry) {
        await entry.pool.query(
          'UPDATE users SET password_reset_requested_at = now() WHERE lower(email) = lower($1)',
          [email]
        );
      }
    } catch (err) {
      // swallow -- response must not reveal whether anything actually happened
    }
  }

  res.json({ success: true });
});

router.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ success: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ session: req.session });
});

module.exports = router;
