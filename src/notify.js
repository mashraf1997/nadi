'use strict';

// Instant notifications to the owner's phone through a Telegram bot.
// Free, no extra dependencies: one HTTPS call per message.

const TOKEN_RE = /^\d{5,}:[\w-]{30,}$/;
const CHAT_RE = /^(-?\d{3,}|@\w{4,})$/;
const API = 'https://api.telegram.org';

const validToken = (t) => typeof t === 'string' && TOKEN_RE.test(t.trim());
const validChat = (c) => typeof c === 'string' && CHAT_RE.test(c.trim());

async function call(token, method, body, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(8000),
  });
  return res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
}

/**
 * Sends a message. WhatsApp-style *bold* is rendered with Telegram Markdown;
 * if that fails to parse (e.g. a name with an underscore), it is resent as plain text.
 */
async function sendTelegram(cfg, text, fetchImpl) {
  if (!cfg || !validToken(cfg.telegramToken) || !validChat(cfg.telegramChat)) return { ok: false, skipped: true };
  const base = { chat_id: cfg.telegramChat.trim(), text, disable_web_page_preview: true };
  try {
    let r = await call(cfg.telegramToken.trim(), 'sendMessage', { ...base, parse_mode: 'Markdown' }, fetchImpl);
    if (!r.ok && /parse/i.test(r.description || '')) r = await call(cfg.telegramToken.trim(), 'sendMessage', base, fetchImpl);
    return { ok: !!r.ok, error: r.ok ? '' : r.description || 'error' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Chats that recently messaged the bot (after the owner presses Start), newest first. */
async function detectChats(token, fetchImpl) {
  if (!validToken(token)) return { ok: false, error: 'invalid_token' };
  try {
    const r = await call(token.trim(), 'getUpdates', { limit: 20 }, fetchImpl);
    if (!r.ok) return { ok: false, error: r.description || 'error' };
    const seen = new Map();
    for (const u of [...(r.result || [])].reverse()) {
      const chat = (u.message || u.channel_post || u.my_chat_member || {}).chat;
      if (chat && !seen.has(String(chat.id))) {
        seen.set(String(chat.id), { id: String(chat.id), name: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || '' });
      }
    }
    return { ok: true, chats: [...seen.values()] };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Fire-and-forget: never let a notification problem break an order/booking. */
function notifyInBackground(cfg, text, log = console) {
  if (!cfg || !cfg.telegramToken || !cfg.telegramChat) return;
  sendTelegram(cfg, text).then((r) => {
    if (!r.ok && !r.skipped) log.warn(`Telegram notification failed: ${r.error}`);
  });
}

/** What the admin may see: never the token itself. */
function publicView(cfg) {
  const token = (cfg && cfg.telegramToken) || '';
  return {
    telegramChat: (cfg && cfg.telegramChat) || '',
    hasToken: !!token,
    tokenHint: token ? `…${token.slice(-4)}` : '',
    connected: validToken(token) && validChat((cfg && cfg.telegramChat) || ''),
  };
}

/**
 * Admin endpoints: GET/PUT /notify, POST /notify/detect, POST /notify/test.
 * Settings live in store.db.notify (never exported in backups).
 */
function mountRoutes(router, store, { guard, appName }) {
  const cfg = () => {
    if (!store.db.notify) store.db.notify = { telegramToken: '', telegramChat: '' };
    return store.db.notify;
  };
  router.get('/notify', (req, res) => res.json(publicView(cfg())));
  router.put('/notify', guard, (req, res) => {
    const b = req.body || {};
    const c = cfg();
    if (b.clear) {
      c.telegramToken = '';
      c.telegramChat = '';
    }
    if (typeof b.telegramToken === 'string' && b.telegramToken.trim()) {
      if (!validToken(b.telegramToken)) return res.status(400).json({ error: 'invalid_token' });
      c.telegramToken = b.telegramToken.trim();
    }
    if (typeof b.telegramChat === 'string') {
      const chat = b.telegramChat.trim();
      if (chat && !validChat(chat)) return res.status(400).json({ error: 'invalid_chat' });
      c.telegramChat = chat;
    }
    store.save();
    res.json(publicView(c));
  });
  router.post('/notify/detect', guard, async (req, res) => {
    const token = (req.body && typeof req.body.telegramToken === 'string' && req.body.telegramToken.trim()) || cfg().telegramToken;
    const r = await detectChats(token);
    res.status(r.ok ? 200 : 400).json(r);
  });
  router.post('/notify/test', guard, async (req, res) => {
    const text = typeof (req.body && req.body.text) === 'string' ? req.body.text.slice(0, 300) : '';
    const r = await sendTelegram(cfg(), `✅ ${appName}\n${text || 'Notifications are working.'}`);
    res.status(r.ok ? 200 : 400).json(r);
  });
}

module.exports = { sendTelegram, detectChats, notifyInBackground, publicView, validToken, validChat, mountRoutes };
