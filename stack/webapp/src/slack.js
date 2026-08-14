const SLACK_APP_EVENTS_WEBHOOK_URL = process.env.SLACK_APP_EVENTS_WEBHOOK_URL || '';

// Best-effort, igual que mail.js: el evento que dispara el aviso (bloqueo,
// reset de password, alta/baja de empresa) ya se aplico igual -- si Slack
// no responde no se revierte nada, solo se loguea.
async function notifyAppEvent(text, emoji = ':bell:') {
  if (!SLACK_APP_EVENTS_WEBHOOK_URL) {
    return { sent: false, reason: 'SLACK_APP_EVENTS_WEBHOOK_URL no configurado.' };
  }
  try {
    const res = await fetch(SLACK_APP_EVENTS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `${emoji} [FireGuard] ${text}`, channel: '#app-events' }),
    });
    if (!res.ok) return { sent: false, reason: `Slack respondio ${res.status}` };
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: (err && err.message) || String(err) };
  }
}

module.exports = { notifyAppEvent };
