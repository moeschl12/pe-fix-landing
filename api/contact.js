const { Resend } = require('resend');

function sanitize(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// In-memory rate limiter – 5 requests per IP per hour
// Hinweis: In Vercel Serverless wird bei Cold Starts zurückgesetzt.
// Dient als Schutz auf Long-Running-Instanzen und im Dev-Server.
const rateLimitMap = new Map();
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting via IP
  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    'unknown';

  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Zu viele Anfragen. Bitte versuche es später erneut.' });
  }

  const { name, firma, branche, telefon, stadt, nachricht, dsgvo, website_url } = req.body || {};

  // Honeypot: Bot-Schutz – Feld muss leer sein
  if (website_url && String(website_url).trim() !== '') {
    return res.status(200).json({ success: true });
  }

  if (!name || !firma || !branche || !telefon || !stadt) {
    return res.status(400).json({ error: 'Pflichtfelder fehlen' });
  }
  if (dsgvo !== true) {
    return res.status(400).json({ error: 'Bitte stimmen Sie der Datenschutzerklärung zu' });
  }

  const n = sanitize(name.toString().trim().slice(0, 100));
  const f = sanitize(firma.toString().trim().slice(0, 100));
  const b = sanitize(branche.toString().trim().slice(0, 100));
  const t = sanitize(telefon.toString().trim().slice(0, 30));
  const s = sanitize(stadt.toString().trim().slice(0, 100));
  const msg = nachricht ? sanitize(nachricht.toString().trim().slice(0, 2000)) : '';

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'Kontaktformular pe-fix.de <noreply@pe-fix.de>',
      to: 'info@pe-fix.de',
      subject: `Neue Anfrage: ${n} – ${f}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#1a1a2e;border-bottom:2px solid #C9A84C;padding-bottom:10px;">
            Neue Anfrage über pe-fix.de
          </h2>
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px 0;color:#666;width:120px;"><strong>Name:</strong></td><td style="padding:8px 0;">${n}</td></tr>
            <tr><td style="padding:8px 0;color:#666;"><strong>Firma:</strong></td><td style="padding:8px 0;">${f}</td></tr>
            <tr><td style="padding:8px 0;color:#666;"><strong>Branche:</strong></td><td style="padding:8px 0;">${b}</td></tr>
            <tr><td style="padding:8px 0;color:#666;"><strong>Telefon:</strong></td><td style="padding:8px 0;">${t}</td></tr>
            <tr><td style="padding:8px 0;color:#666;"><strong>Stadt:</strong></td><td style="padding:8px 0;">${s}</td></tr>
            ${msg ? `<tr><td style="padding:8px 0;color:#666;vertical-align:top;"><strong>Nachricht:</strong></td><td style="padding:8px 0;">${msg.replace(/\n/g, '<br>')}</td></tr>` : ''}
          </table>
          <hr style="border:none;border-top:1px solid #eee;margin:20px 0;" />
          <p style="color:#999;font-size:12px;">Gesendet über pe-fix.de</p>
        </div>
      `,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Email error:', err);
    return res.status(500).json({ error: 'Fehler beim Senden' });
  }
};
