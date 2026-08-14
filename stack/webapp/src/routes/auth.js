const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { getCompanyPool } = require('../db');
const { slugFromEmail, issueSession, clearSession, requireAuth, COOKIE_NAME } = require('../auth');
const { loginAttemptsTotal } = require('../metrics');
const { sendAccountLockedEmail } = require('../mail');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

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
  handler: (req, res) => {
    if (req.path === '/login') {
      const slug = slugFromEmail((req.body && req.body.email) || '') || 'unknown';
      loginAttemptsTotal.inc({ result: 'rate_limited', company: slug });
    }
    res.status(429).json({ error: 'Demasiadas solicitudes. Intente nuevamente en unos minutos.' });
  },
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
    loginAttemptsTotal.inc({ result: 'db_error', company: slug });
    return res.status(503).json({ error: 'No se pudo contactar la base de datos.' });
  }

  if (!entry) {
    await bcrypt.compare(password, DUMMY_HASH);
    loginAttemptsTotal.inc({ result: 'unknown_account', company: slug });
    return res.status(401).json(INVALID);
  }

  const { pool, company } = entry;

  try {
    const { rows } = await pool.query(
      `SELECT id, email, password_hash, role, full_name, failed_attempts, locked_until, locked, timezone,
              email_notifications_enabled, notification_email
       FROM users WHERE lower(email) = lower($1)`,
      [email]
    );

    if (rows.length === 0) {
      await bcrypt.compare(password, DUMMY_HASH);
      loginAttemptsTotal.inc({ result: 'unknown_account', company: slug });
      return res.status(401).json(INVALID);
    }

    const user = rows[0];

    if (user.locked) {
      await bcrypt.compare(password, DUMMY_HASH);
      loginAttemptsTotal.inc({ result: 'account_locked_admin', company: slug });
      return res.status(423).json({ error: 'Cuenta bloqueada por el administrador. Contacte a su administrador.' });
    }

    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      loginAttemptsTotal.inc({ result: 'account_locked_temp', company: slug });
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
        loginAttemptsTotal.inc({ result: 'too_many_attempts', company: slug });
        // Fire-and-forget: el login no debe quedar a la espera del SMTP.
        if (user.email_notifications_enabled && user.notification_email) {
          sendAccountLockedEmail({
            to: user.notification_email, companyName: company.display_name, email: user.email, minutes: LOCK_MINUTES,
          }).catch(() => {});
        }
        return res.status(429).json({
          error: `Demasiados intentos fallidos. Cuenta bloqueada por ${LOCK_MINUTES} minutos.`,
        });
      }
      await pool.query('UPDATE users SET failed_attempts = $1 WHERE id = $2', [attempts, user.id]);
      loginAttemptsTotal.inc({ result: 'invalid_credentials', company: slug });
      return res.status(401).json(INVALID);
    }

    // Concurrent-connection cap: only unexpired session rows count, so a
    // stale/abandoned login (past its 8h TTL) never blocks a real one.
    const { rows: activeRows } = await pool.query(
      'SELECT count(*)::int AS n FROM sessions WHERE expires_at > now()'
    );
    if (activeRows[0].n >= company.license_count) {
      loginAttemptsTotal.inc({ result: 'license_limit', company: slug });
      return res.status(403).json({
        error: `Se alcanzó el límite de ${company.license_count} usuario(s) conectado(s) simultáneamente para esta empresa.`,
      });
    }

    await pool.query(
      'UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1',
      [user.id]
    );

    const jti = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    await pool.query(
      'INSERT INTO sessions (user_id, jti, expires_at) VALUES ($1, $2, $3)',
      [user.id, jti, expiresAt]
    );

    issueSession(res, {
      userId: user.id,
      email: user.email,
      slug,
      role: user.role,
      companyName: company.display_name,
      jti,
    });

    loginAttemptsTotal.inc({ result: 'success', company: slug });

    return res.json({
      success: true,
      user: {
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        companyName: company.display_name,
        timezone: user.timezone,
      },
    });
  } catch (err) {
    loginAttemptsTotal.inc({ result: 'db_error', company: slug });
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

router.post('/logout', async (req, res) => {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  clearSession(res);
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const entry = await getCompanyPool(payload.slug);
      if (entry && payload.jti) {
        await entry.pool.query('DELETE FROM sessions WHERE jti = $1', [payload.jti]);
      }
    } catch (err) {
      // token already invalid/expired -- nothing to clean up
    }
  }
  res.json({ success: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ session: req.session });
});

// Public: reached from the link in the welcome email (see src/mail.js).
// Not behind requireAuth -- the token itself is the credential.
router.get('/verify-email', async (req, res) => {
  const { slug, token } = req.query || {};
  const fail = (message) => res.status(400).send(`<h1>Enlace inválido</h1><p>${message}</p>`);

  if (!slug || !token || typeof slug !== 'string' || typeof token !== 'string') {
    return fail('Falta el token de verificación.');
  }

  let entry;
  try {
    entry = await getCompanyPool(slug);
  } catch (err) {
    return res.status(503).send('<h1>Error</h1><p>No se pudo contactar la base de datos.</p>');
  }
  if (!entry) return fail('Empresa no encontrada.');

  try {
    const { rows } = await entry.pool.query(
      `UPDATE users SET email_verified = true, email_verify_token = NULL, email_verify_expires_at = NULL
       WHERE email_verify_token = $1 AND email_verify_expires_at > now()
       RETURNING email`,
      [token]
    );
    if (rows.length === 0) return fail('El enlace expiró o ya fue utilizado.');
    res.send(`<h1>Correo verificado</h1><p>La cuenta ${rows[0].email} quedó confirmada. Ya podés iniciar sesión.</p>`);
  } catch (err) {
    res.status(503).send('<h1>Error</h1><p>No se pudo contactar la base de datos.</p>');
  }
});

module.exports = router;
