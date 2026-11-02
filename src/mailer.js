'use strict';

// Optional email through any SMTP server (Hostinger email, Gmail app
// password, Brevo, Mailgun, Amazon SES…). Used for owner alerts, daily
// backups and, where the app supports it, customer emails.
// Settings live in store.db.smtp (never sent to the browser or backups).


const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cfgOf(store) {
  if (!store.db.smtp || typeof store.db.smtp !== 'object') store.db.smtp = {};
  return store.db.smtp;
}

const ready = (c) => !!(c && c.host && c.port && c.from && EMAIL_RE.test(c.from.replace(/^.*<|>.*$/g, '')));

function publicView(c) {
  return {
    ready: ready(c),
    host: c.host || '',
    port: c.port || 587,
    secure: !!c.secure,
    user: c.user || '',
    hasPass: !!c.pass,
    from: c.from || '',
    ownerEmail: c.ownerEmail || '',
    alerts: c.alerts !== false,
    backups: !!c.backups,
  };
}

function update(c, b) {
  if (b.clear) {
    for (const k of Object.keys(c)) delete c[k];
    return {};
  }
  if (b.host !== undefined) {
    const host = str(b.host, 200);
    if (host && !/^[a-z0-9.-]+$/i.test(host)) return { error: 'invalid_host' };
    c.host = host;
  }
  if (b.port !== undefined) {
    const port = Math.round(Number(b.port));
    if (!(port > 0 && port < 65536)) return { error: 'invalid_port' };
    c.port = port;
  }
  if (b.secure !== undefined) c.secure = b.secure === true || b.secure === 'true';
  if (b.user !== undefined) c.user = str(b.user, 200);
  if (str(b.pass, 300)) c.pass = str(b.pass, 300);
  if (b.from !== undefined) {
    const from = str(b.from, 200);
    if (from && !EMAIL_RE.test(from.replace(/^.*<|>.*$/g, ''))) return { error: 'invalid_email' };
    c.from = from;
  }
  if (b.ownerEmail !== undefined) {
    const e = str(b.ownerEmail, 200);
    if (e && !EMAIL_RE.test(e)) return { error: 'invalid_email' };
    c.ownerEmail = e;
  }
  if (b.alerts !== undefined) c.alerts = b.alerts === true || b.alerts === 'true';
  if (b.backups !== undefined) c.backups = b.backups === true || b.backups === 'true';
  return {};
}

// Loaded on first use so apps without email don't pay for it in memory.
let transportFactory = (opts) => require('nodemailer').createTransport(opts);
/** Tests swap the transport. */
function setTransportFactory(fn) {
  transportFactory = fn;
}

function transport(c) {
  return transportFactory({
    host: c.host,
    port: c.port,
    secure: !!c.secure,
    auth: c.user ? { user: c.user, pass: c.pass || '' } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

/**
 * A simple branded HTML email. body: plain text (line breaks kept);
 * button: { label, url } (optional).
 */
function render({ brand = {}, title, body, button, footer = '', dir = 'ltr' }) {
  const color = /^#[0-9a-f]{6}$/i.test(brand.color || '') ? brand.color : '#111827';
  const html = `<!doctype html><html dir="${dir}"><body style="margin:0;background:#f4f4f5;font-family:-apple-system,'Segoe UI',Tahoma,Arial,sans-serif;color:#111">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden">
<tr><td style="background:${color};color:#fff;padding:18px 24px;font-size:18px;font-weight:700">${esc(brand.name || '')}</td></tr>
<tr><td style="padding:24px;text-align:${dir === 'rtl' ? 'right' : 'left'}">
<h1 style="margin:0 0 12px;font-size:20px">${esc(title)}</h1>
<div style="font-size:15px;line-height:1.6;white-space:pre-line">${esc(body)}</div>
${button ? `<p style="margin:22px 0 4px"><a href="${esc(button.url)}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px">${esc(button.label)}</a></p>` : ''}
</td></tr>
${footer ? `<tr><td style="padding:14px 24px;color:#888;font-size:12px;border-top:1px solid #eee">${esc(footer)}</td></tr>` : ''}
</table></td></tr></table></body></html>`;
  const text = `${title}\n\n${body}${button ? `\n\n${button.label}: ${button.url}` : ''}${footer ? `\n\n${footer}` : ''}`;
  return { html, text };
}

/** Sends one email. Never throws; returns { ok, skipped, error }. */
async function send(store, { to, subject, html, text, attachments }) {
  const c = cfgOf(store);
  if (!ready(c) || !EMAIL_RE.test(String(to || ''))) return { ok: false, skipped: true };
  try {
    const info = await transport(c).sendMail({ from: c.from, to, subject, html, text, attachments });
    return { ok: true, id: info.messageId };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function sendInBackground(store, mail, log = console) {
  send(store, mail).then((r) => {
    if (!r.ok && !r.skipped) log.error(`Email: ${r.error}`);
  });
}

/** Admin routes: GET/PUT /email, POST /email/test. */
function mountAdmin(router, store, { guard, appName }) {
  router.get('/email', (req, res) => res.json(publicView(cfgOf(store))));
  router.put('/email', guard, (req, res) => {
    const c = cfgOf(store);
    const r = update(c, req.body || {});
    if (r.error) return res.status(400).json(r);
    store.save();
    res.json(publicView(c));
  });
  router.post('/email/test', guard, async (req, res) => {
    const c = cfgOf(store);
    const to = str((req.body && req.body.to) || c.ownerEmail, 200);
    if (!ready(c)) return res.status(400).json({ error: 'not_ready' });
    const { html, text } = render({ brand: { name: store.settings.name, color: store.settings.color }, title: `✅ ${appName}`, body: (req.body && str(req.body.text, 300)) || 'Email is working.' });
    const r = await send(store, { to, subject: `${appName}: test email`, html, text });
    res.status(r.ok ? 200 : 400).json(r);
  });
}

module.exports = { EMAIL_RE, cfgOf, ready, publicView, update, render, send, sendInBackground, mountAdmin, setTransportFactory };
