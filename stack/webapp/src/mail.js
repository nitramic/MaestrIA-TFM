const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASSWORD = process.env.SMTP_PASSWORD || '';
const SMTP_FROM = process.env.SMTP_FROM || 'FireGuard <no-reply@fireguard.local>';
const APP_BASE_URL = (process.env.APP_BASE_URL || 'http://localhost:8081').replace(/\/$/, '');

let transporter = null;
function getTransporter() {
  if (!SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASSWORD } : undefined,
    });
  }
  return transporter;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function welcomeEmailHtml({ companyName, email, password, verifyUrl }) {
  const safeCompany = escapeHtml(companyName);
  const safeEmail = escapeHtml(email);
  const safePassword = escapeHtml(password);
  return `<!doctype html>
<html lang="es">
<body style="margin:0;padding:0;background:#F3F4F6;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="background:#3B82F6;padding:24px 32px;">
          <span style="color:#ffffff;font-size:20px;font-weight:700;">FireGuard</span>
        </td></tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 12px;font-size:20px;color:#0B1220;">Bienvenido a FireGuard</h1>
          <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#374151;">
            Se creó la cuenta de <strong>${safeCompany}</strong> en FireGuard. Estas son tus credenciales de acceso:
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;border-radius:8px;margin-bottom:20px;">
            <tr><td style="padding:14px 18px;font-size:14px;color:#374151;">Usuario</td>
                <td style="padding:14px 18px;font-size:14px;font-weight:700;color:#0B1220;text-align:right;">${safeEmail}</td></tr>
            <tr><td style="padding:0 18px 14px;font-size:14px;color:#374151;">Contraseña</td>
                <td style="padding:0 18px 14px;font-size:14px;font-weight:700;color:#0B1220;text-align:right;">${safePassword}</td></tr>
          </table>
          <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#374151;">
            Confirmá tu dirección de correo para activar la cuenta:
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr><td style="border-radius:8px;background:#3B82F6;">
              <a href="${verifyUrl}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">Verificar mi correo</a>
            </td></tr>
          </table>
          <p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:#9CA3AF;">
            Si el botón no funciona, copiá y pegá este enlace en tu navegador:<br>
            <a href="${verifyUrl}" style="color:#3B82F6;">${verifyUrl}</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Best-effort: a company is provisioned successfully even if the email can't
// be sent (e.g. SMTP not configured in this environment) -- the admin panel
// still shows the credentials on screen either way.
async function sendWelcomeEmail({ to, companyName, email, password, slug, verifyToken }) {
  const t = getTransporter();
  if (!t) return { sent: false, reason: 'SMTP no configurado (SMTP_HOST vacío).' };
  if (!to) return { sent: false, reason: 'Sin email de contacto.' };

  const verifyUrl = `${APP_BASE_URL}/api/auth/verify-email?slug=${encodeURIComponent(slug)}&token=${encodeURIComponent(verifyToken)}`;

  try {
    await t.sendMail({
      from: SMTP_FROM,
      to,
      subject: `Bienvenido a FireGuard - ${companyName}`,
      html: welcomeEmailHtml({ companyName, email, password, verifyUrl }),
    });
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: (err && err.message) || String(err) };
  }
}

module.exports = { sendWelcomeEmail };
