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

function emailShell(heading, bodyHtml) {
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
          <h1 style="margin:0 0 12px;font-size:20px;color:#0B1220;">${heading}</h1>
          ${bodyHtml}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function fieldsTable(rows) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;border-radius:8px;margin-bottom:20px;">
    ${rows
      .map(
        ([label, value]) => `<tr>
          <td style="padding:10px 18px;font-size:14px;color:#374151;">${label}</td>
          <td style="padding:10px 18px;font-size:14px;font-weight:700;color:#0B1220;text-align:right;">${value}</td>
        </tr>`
      )
      .join('')}
  </table>`;
}

function welcomeEmailHtml({ companyName, email, password, licenseCount, verifyUrl }) {
  const safeCompany = escapeHtml(companyName);
  const safeEmail = escapeHtml(email);
  const safePassword = escapeHtml(password);
  const body = `
    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#374151;">
      Se creó la cuenta de <strong>${safeCompany}</strong> en FireGuard. Estas son tus credenciales de acceso:
    </p>
    ${fieldsTable([
      ['Dirección', `<a href="${APP_BASE_URL}" style="color:#0B1220;text-decoration:none;">${APP_BASE_URL}</a>`],
      ['Usuario', safeEmail],
      ['Contraseña', safePassword],
      ['Licencias', String(licenseCount)],
    ])}
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
    </p>`;
  return emailShell('Bienvenido a FireGuard', body);
}

function passwordChangedEmailHtml({ companyName, email, password }) {
  const safeCompany = escapeHtml(companyName);
  const safeEmail = escapeHtml(email);
  const safePassword = escapeHtml(password);
  const body = `
    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#374151;">
      Se actualizó la contraseña de tu cuenta en FireGuard (empresa <strong>${safeCompany}</strong>).
      Si no reconocés este cambio, contactá a tu administrador.
    </p>
    ${fieldsTable([
      ['Cuenta', safeEmail],
      ['Contraseña nueva', safePassword],
    ])}`;
  return emailShell('Tu contraseña fue actualizada', body);
}

function accountLockedEmailHtml({ companyName, email, minutes }) {
  const safeCompany = escapeHtml(companyName);
  const safeEmail = escapeHtml(email);
  const body = `
    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#374151;">
      Tu cuenta <strong>${safeEmail}</strong> en FireGuard (empresa <strong>${safeCompany}</strong>)
      quedó bloqueada temporalmente por demasiados intentos fallidos de inicio de sesión
      (${minutes} minuto${minutes === 1 ? '' : 's'}). Si no reconocés esta actividad,
      contactá a tu administrador.
    </p>`;
  return emailShell('Tu cuenta fue bloqueada', body);
}

function accountUnlockedEmailHtml({ companyName, email }) {
  const safeCompany = escapeHtml(companyName);
  const safeEmail = escapeHtml(email);
  const body = `
    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#374151;">
      Tu administrador desbloqueó tu cuenta <strong>${safeEmail}</strong> en FireGuard
      (empresa <strong>${safeCompany}</strong>). Ya podés iniciar sesión normalmente.
    </p>`;
  return emailShell('Tu cuenta fue desbloqueada', body);
}

// Best-effort en las cuatro: la accion que dispara el mail (alta de
// empresa, cambio de password, bloqueo, desbloqueo) ya se aplico
// igual -- si el mail no sale (SMTP no configurado, destinatario
// invalido, etc.) no se revierte nada, solo se informa en la respuesta.
async function sendWelcomeEmail({ to, companyName, email, password, slug, licenseCount, verifyToken }) {
  const t = getTransporter();
  if (!t) return { sent: false, reason: 'SMTP no configurado (SMTP_HOST vacío).' };
  if (!to) return { sent: false, reason: 'Sin email de contacto.' };

  const verifyUrl = `${APP_BASE_URL}/api/auth/verify-email?slug=${encodeURIComponent(slug)}&token=${encodeURIComponent(verifyToken)}`;

  try {
    await t.sendMail({
      from: SMTP_FROM,
      to,
      subject: `Bienvenido a FireGuard - ${companyName}`,
      html: welcomeEmailHtml({ companyName, email, password, licenseCount, verifyUrl }),
    });
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: (err && err.message) || String(err) };
  }
}

async function sendPasswordChangedEmail({ to, companyName, email, password }) {
  const t = getTransporter();
  if (!t) return { sent: false, reason: 'SMTP no configurado (SMTP_HOST vacío).' };
  if (!to) return { sent: false, reason: 'Sin email de destino.' };

  try {
    await t.sendMail({
      from: SMTP_FROM,
      to,
      subject: 'FireGuard - Tu contraseña fue actualizada',
      html: passwordChangedEmailHtml({ companyName, email, password }),
    });
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: (err && err.message) || String(err) };
  }
}

async function sendAccountLockedEmail({ to, companyName, email, minutes }) {
  const t = getTransporter();
  if (!t) return { sent: false, reason: 'SMTP no configurado (SMTP_HOST vacío).' };
  if (!to) return { sent: false, reason: 'Sin email de destino.' };

  try {
    await t.sendMail({
      from: SMTP_FROM,
      to,
      subject: 'FireGuard - Tu cuenta fue bloqueada temporalmente',
      html: accountLockedEmailHtml({ companyName, email, minutes }),
    });
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: (err && err.message) || String(err) };
  }
}

async function sendAccountUnlockedEmail({ to, companyName, email }) {
  const t = getTransporter();
  if (!t) return { sent: false, reason: 'SMTP no configurado (SMTP_HOST vacío).' };
  if (!to) return { sent: false, reason: 'Sin email de destino.' };

  try {
    await t.sendMail({
      from: SMTP_FROM,
      to,
      subject: 'FireGuard - Tu cuenta fue desbloqueada',
      html: accountUnlockedEmailHtml({ companyName, email }),
    });
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: (err && err.message) || String(err) };
  }
}

module.exports = {
  sendWelcomeEmail,
  sendPasswordChangedEmail,
  sendAccountLockedEmail,
  sendAccountUnlockedEmail,
};
