const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TOKEN_TTL = '4h';
const COOKIE_NAME = 'fireguard_admin_session';

function issueAdminSession(res, payload) {
  const token = jwt.sign({ ...payload, scope: 'superadmin' }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.FORCE_HTTPS === 'true',
    maxAge: 4 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearAdminSession(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

function requireAdminAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.scope !== 'superadmin') return res.status(401).json({ error: 'No autenticado' });
    req.admin = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
}

module.exports = { issueAdminSession, clearAdminSession, requireAdminAuth, COOKIE_NAME };
