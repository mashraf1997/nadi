'use strict';

// Optional automatic WhatsApp messages through Meta's WhatsApp Cloud API.
//
// WhatsApp only lets a business start a conversation with an approved
// *template*, so each automatic message is a template the owner creates once
// in WhatsApp Manager (we show the exact text to paste). Without this set up,
// the apps keep using one-tap wa.me links.
// Settings live in store.db.whatsapp (never sent to the browser or backups).

const GRAPH = 'https://graph.facebook.com/v21.0';
const LOG_SIZE = 40;

const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function cfgOf(store) {
  if (!store.db.whatsapp || typeof store.db.whatsapp !== 'object') store.db.whatsapp = {};
  const c = store.db.whatsapp;
  if (!c.templates || typeof c.templates !== 'object') c.templates = {};
  if (!Array.isArray(c.log)) c.log = [];
  return c;
}

const ready = (c) => !!(c && c.token && /^\d{6,20}$/.test(c.phoneNumberId || ''));

function publicView(c, kinds) {
  return {
    ready: ready(c),
    hasToken: !!c.token,
    tokenHint: c.token ? `…${c.token.slice(-4)}` : '',
    phoneNumberId: c.phoneNumberId || '',
    language: c.language || '',
    kinds: kinds.map((k) => ({
      key: k.key,
      params: k.params,
      sample: k.sample,
      name: (c.templates[k.key] && c.templates[k.key].name) || k.defaultName,
      enabled: !!(c.templates[k.key] && c.templates[k.key].enabled),
    })),
    log: c.log.slice(-15).reverse(),
  };
}

function update(c, b, kinds) {
  if (b.clear) {
    for (const k of Object.keys(c)) delete c[k];
    return {};
  }
  if (str(b.token, 600)) c.token = str(b.token, 600);
  if (b.phoneNumberId !== undefined) {
    const id = str(b.phoneNumberId, 30);
    if (id && !/^\d{6,20}$/.test(id)) return { error: 'invalid_phone_id' };
    c.phoneNumberId = id;
  }
  if (b.language !== undefined) {
    const lang = str(b.language, 10);
    if (lang && !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(lang)) return { error: 'invalid_language' };
    c.language = lang;
  }
  if (b.templates && typeof b.templates === 'object') {
    for (const k of kinds) {
      const t = b.templates[k.key];
      if (!t) continue;
      const name = str(t.name, 60) || k.defaultName;
      if (!/^[a-z0-9_]{1,60}$/.test(name)) return { error: 'invalid_template' };
      c.templates[k.key] = { name, enabled: t.enabled === true || t.enabled === 'true' };
    }
  }
  return {};
}

async function post(c, body, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(`${GRAPH}/${c.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: (data.error && (data.error.error_user_msg || data.error.message)) || `HTTP ${res.status}` };
  return { ok: true, id: data.messages && data.messages[0] && data.messages[0].id };
}

function remember(store, entry) {
  const c = cfgOf(store);
  c.log.push({ at: new Date().toISOString(), ...entry });
  if (c.log.length > LOG_SIZE) c.log = c.log.slice(-LOG_SIZE);
  store.save();
}

/**
 * Sends one automatic message if that kind is switched on.
 * to: international digits (no +). params: strings for {{1}}, {{2}}, …
 * Never throws; returns { ok, skipped, error }.
 */
async function sendKind(store, kind, to, params, fetchImpl) {
  const c = cfgOf(store);
  const t = c.templates[kind];
  const digits = String(to || '').replace(/\D/g, '');
  if (!ready(c) || !t || !t.enabled || digits.length < 8) return { ok: false, skipped: true };
  const r = await post(c, {
    to: digits,
    type: 'template',
    template: {
      name: t.name,
      language: { code: c.language || 'en' },
      components: [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p == null ? '' : p).replace(/\s*\n\s*/g, ' ').slice(0, 1000) || '-' })) }],
    },
  }, fetchImpl).catch((err) => ({ ok: false, error: err.message }));
  remember(store, { kind, to: `…${digits.slice(-4)}`, ok: r.ok, error: r.error || '' });
  return r;
}

/** Fire-and-forget version for request handlers. */
function sendInBackground(store, kind, to, params, log = console) {
  sendKind(store, kind, to, params).then((r) => {
    if (!r.ok && !r.skipped) log.error(`WhatsApp (${kind}): ${r.error}`);
  });
}

/**
 * Admin routes: GET/PUT /whatsapp, POST /whatsapp/test.
 * kinds: [{ key, defaultName, params: ['name', …], sample: 'Hi {{1}}…' }]
 */
function mountAdmin(router, store, { guard, kinds }) {
  router.get('/whatsapp', (req, res) => res.json(publicView(cfgOf(store), kinds)));
  router.put('/whatsapp', guard, (req, res) => {
    const c = cfgOf(store);
    const r = update(c, req.body || {}, kinds);
    if (r.error) return res.status(400).json(r);
    store.save();
    res.json(publicView(c, kinds));
  });
  // Meta's built-in "hello_world" template exists on every account.
  router.post('/whatsapp/test', guard, async (req, res) => {
    const c = cfgOf(store);
    const to = String((req.body && req.body.to) || '').replace(/\D/g, '');
    if (!ready(c)) return res.status(400).json({ error: 'not_ready' });
    if (to.length < 8) return res.status(400).json({ error: 'invalid_phone' });
    const r = await post(c, { to, type: 'template', template: { name: 'hello_world', language: { code: 'en_US' } } }).catch((err) => ({ ok: false, error: err.message }));
    remember(store, { kind: 'test', to: `…${to.slice(-4)}`, ok: r.ok, error: r.error || '' });
    res.status(r.ok ? 200 : 400).json(r);
  });
}

module.exports = { GRAPH, cfgOf, ready, publicView, update, sendKind, sendInBackground, mountAdmin };
