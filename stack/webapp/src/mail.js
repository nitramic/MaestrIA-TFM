// Brevo por su API HTTPS (puerto 443), no SMTP: varios proveedores de VPS
// (incluida la VM de demo, Clouding.io) bloquean los puertos SMTP salientes
// (587/465) por defecto para cuentas nuevas/de prueba, y en Clouding esa
// opcion ni siquiera se puede activar en esa fase -- ver "The option to
// allow/block SMTP is not available" al pedir el unlock por su API. El 443
// (HTTPS normal) sale sin problema en cualquier lado, asi que la API evita
// el problema de raiz en vez de depender de que cada VM tenga el puerto
// abierto.
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const SMTP_FROM = process.env.SMTP_FROM || 'FireGuard <no-reply@fireguard.local>';
const APP_BASE_URL = (process.env.APP_BASE_URL || 'http://localhost:8081').replace(/\/$/, '');

function parseFrom(fromHeader) {
  const m = String(fromHeader).match(/^\s*"?([^"<]*)"?\s*<(.+)>\s*$/);
  if (m) return { name: m[1].trim() || undefined, email: m[2].trim() };
  return { email: String(fromHeader).trim() };
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

// Best-effort: la accion que dispara el mail (alta de empresa, cambio de
// password, bloqueo, desbloqueo) ya se aplico igual -- si el mail no sale
// (API key no configurada, destinatario invalido, Brevo devuelve error,
// etc.) no se revierte nada, solo se informa en la respuesta.
async function sendViaBrevo({ to, subject, html }) {
  if (!BREVO_API_KEY) return { sent: false, reason: 'BREVO_API_KEY no configurada.' };
  if (!to) return { sent: false, reason: 'Sin email de destino.' };

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'api-key': BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: parseFrom(SMTP_FROM),
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
    });
    if (!res.ok) {
      let reason = `Brevo respondió ${res.status}`;
      try {
        const data = await res.json();
        if (data && data.message) reason = data.message;
      } catch (e) { /* sin body json */ }
      return { sent: false, reason };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: (err && err.message) || String(err) };
  }
}

async function sendWelcomeEmail({ to, companyName, email, password, slug, licenseCount, verifyToken }) {
  const verifyUrl = `${APP_BASE_URL}/api/auth/verify-email?slug=${encodeURIComponent(slug)}&token=${encodeURIComponent(verifyToken)}`;
  return sendViaBrevo({
    to,
    subject: `Bienvenido a FireGuard - ${companyName}`,
    html: welcomeEmailHtml({ companyName, email, password, licenseCount, verifyUrl }),
  });
}

async function sendPasswordChangedEmail({ to, companyName, email, password }) {
  return sendViaBrevo({
    to,
    subject: 'FireGuard - Tu contraseña fue actualizada',
    html: passwordChangedEmailHtml({ companyName, email, password }),
  });
}

async function sendAccountLockedEmail({ to, companyName, email, minutes }) {
  return sendViaBrevo({
    to,
    subject: 'FireGuard - Tu cuenta fue bloqueada temporalmente',
    html: accountLockedEmailHtml({ companyName, email, minutes }),
  });
}

async function sendAccountUnlockedEmail({ to, companyName, email }) {
  return sendViaBrevo({
    to,
    subject: 'FireGuard - Tu cuenta fue desbloqueada',
    html: accountUnlockedEmailHtml({ companyName, email }),
  });
}

module.exports = {
  sendWelcomeEmail,
  sendPasswordChangedEmail,
  sendAccountLockedEmail,
  sendAccountUnlockedEmail,
};
