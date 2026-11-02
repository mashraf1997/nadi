'use strict';

/**
 * Agency mode (HUB_MODE=true): one server hosts many independent clients.
 *
 * Every request is routed by its Host header:
 *   - a client's custom domain (shop.com, www.shop.com) or <slug>.<BASE_DOMAIN>
 *     → that client's own, fully isolated app instance (own data folder,
 *       admin account, settings, uploads)
 *   - anything else → the agency panel at /hub
 *
 * Caddy's on-demand TLS asks GET /_hub/tls-check?domain=… before issuing a
 * certificate, so HTTPS works for every client domain without editing config.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const auth = require('./auth');

const RESERVED = new Set(['hub', 'www', 'admin', 'api', 'app', 'mail', 'static', 'cdn', 'ftp', 'ns1', 'ns2']);
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PW_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const randomFrom = (alphabet, n) => [...crypto.randomBytes(n)].map((b) => alphabet[b % alphabet.length]).join('');
const setupCode = () => {
  const c = randomFrom(CODE_ALPHABET, 8);
  return `${c.slice(0, 4)}-${c.slice(4)}`;
};
const newPassword = () => `${randomFrom(PW_ALPHABET, 4)}-${randomFrom(PW_ALPHABET, 4)}-${randomFrom(PW_ALPHABET, 4)}`;
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const clean = (v, max = 200) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const today = () => new Date().toISOString().slice(0, 10);

function addMonths(date, months) {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`Could not read ${file}: ${err.message}`);
  }
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

const hostOf = (req) => String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
const portOf = (req) => (String(req.headers.host || '').match(/:(\d+)$/) || [])[1] || '';

function normalizeDomains(list) {
  const raw = Array.isArray(list) ? list : String(list || '').split(/[\s,]+/);
  const out = [];
  for (const d of raw) {
    const v = String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * @param {object} o
 * @param {string} o.dataDir
 * @param {Function} o.createApp       the app factory: ({dataDir, setupCode, quiet}) => express app
 * @param {string} o.appName           "Dukkan"
 * @param {Function} o.describe        (store) => { name, logo, count30, last }
 * @param {string} [o.baseDomain]      clients get <slug>.<baseDomain>
 * @param {string} [o.hubDomain]       if set, the panel only answers on this host
 * @param {string} [o.setupCode]       fixed code to claim the hub
 * @param {string} o.publicDir
 * @param {boolean} [o.quiet]
 */
function createHub(o) {
  const base = String(o.baseDomain || 'localhost').toLowerCase().replace(/^\.+|\.+$/g, '');
  const hubDomain = String(o.hubDomain || '').toLowerCase();
  const file = path.join(o.dataDir, 'hub.json');
  const tenantsDir = path.join(o.dataDir, 'tenants');
  const trashDir = path.join(o.dataDir, 'trash');
  fs.mkdirSync(tenantsDir, { recursive: true });

  const db = readJson(file) || { version: 1, secret: crypto.randomBytes(32).toString('hex'), auth: null, setupDone: false, settings: { currency: '' }, tenants: [] };
  db.settings = { currency: '', brandName: '', brandUrl: '', hideBranding: false, ...db.settings };
  // White-label: what client pages show instead of "powered by <App>".
  const branding = () => ({ name: db.settings.brandName, url: db.settings.brandUrl, hideBranding: !!db.settings.hideBranding });
  const save = () => writeJsonAtomic(file, db);
  if (!db.setupDone) {
    if (o.setupCode) db.setupCode = o.setupCode;
    else if (!db.setupCode) db.setupCode = setupCode();
    if (!o.quiet) {
      console.log('');
      console.log('  ┌──────────────────────────────────────────────┐');
      console.log(`  │  Agency setup code: ${db.setupCode.padEnd(25)}│`);
      console.log('  │  Open /hub in your browser and enter it.     │');
      console.log('  └──────────────────────────────────────────────┘');
      console.log('');
    }
  }
  save();

  // ---------- tenants ----------
  const apps = new Map();
  const bySlug = (slug) => db.tenants.find((t) => t.slug === slug) || null;
  const byId = (id) => db.tenants.find((t) => t.id === id) || null;

  function appFor(t) {
    let app = apps.get(t.id);
    if (!app) {
      app = o.createApp({ dataDir: path.join(tenantsDir, t.id), setupCode: t.setupCode, quiet: true, branding });
      apps.set(t.id, app);
    }
    return app;
  }

  function tenantForHost(host) {
    if (!host) return null;
    const bare = host.startsWith('www.') ? host.slice(4) : host;
    const t = db.tenants.find((x) => x.domains.includes(bare));
    if (t) return t;
    if (host.endsWith(`.${base}`)) {
      const slug = host.slice(0, -(base.length + 1));
      if (SLUG_RE.test(slug)) return bySlug(slug);
    }
    return null;
  }

  function urlsFor(t, req) {
    const port = portOf(req);
    const proto = req.protocol;
    const withPort = (h) => `${proto}://${h}${port && !t.domains.includes(h) ? `:${port}` : ''}`;
    const list = [...t.domains.map((d) => `${proto}://${d}`), withPort(`${t.slug}.${base}`)];
    return list;
  }

  function view(t, req) {
    const app = appFor(t);
    const store = app.locals.store;
    let info = {};
    try {
      info = o.describe(store) || {};
    } catch {
      info = {};
    }
    const urls = urlsFor(t, req);
    return {
      id: t.id,
      slug: t.slug,
      label: t.label,
      domains: t.domains,
      status: t.status,
      price: t.price,
      paidUntil: t.paidUntil,
      notes: t.notes,
      phone: t.phone,
      createdAt: t.createdAt,
      url: urls[0],
      urls,
      setupDone: !!store.db.setupDone,
      setupCode: store.db.setupDone ? '' : store.db.setupCode || '',
      info,
    };
  }

  // Validates create/update input. Returns { data } or { error }.
  function validate(body, current) {
    const data = {};
    if (body.label !== undefined || !current) {
      data.label = clean(body.label, 80);
      if (!data.label) return { error: 'label_required' };
    }
    if (body.slug !== undefined || !current) {
      const slug = String(body.slug || '').trim().toLowerCase();
      if (!SLUG_RE.test(slug) || RESERVED.has(slug)) return { error: 'invalid_slug' };
      const other = bySlug(slug);
      if (other && other !== current) return { error: 'slug_taken' };
      data.slug = slug;
    }
    if (body.domains !== undefined) {
      const domains = normalizeDomains(body.domains);
      if (domains.length > 5) return { error: 'invalid_domain' };
      for (const d of domains) {
        if (!DOMAIN_RE.test(d) || d === base || d.endsWith(`.${base}`) || d === hubDomain) return { error: 'invalid_domain' };
        const other = db.tenants.find((x) => x !== current && x.domains.includes(d));
        if (other) return { error: 'domain_taken' };
      }
      data.domains = domains;
    }
    if (body.price !== undefined) {
      const p = Number(body.price);
      if (!Number.isFinite(p) || p < 0 || p > 1e9) return { error: 'invalid_price' };
      data.price = Math.round(p * 100) / 100;
    }
    if (body.paidUntil !== undefined) {
      const d = String(body.paidUntil || '');
      if (d && !DATE_RE.test(d)) return { error: 'invalid_date' };
      data.paidUntil = d;
    }
    if (body.notes !== undefined) data.notes = clean(body.notes, 500);
    if (body.phone !== undefined) data.phone = clean(body.phone, 30);
    if (body.status !== undefined) {
      if (!['active', 'suspended'].includes(body.status)) return { error: 'invalid_status' };
      data.status = body.status;
    }
    return { data };
  }

  // ---------- server ----------
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal');

  // Caddy on-demand TLS: only issue certificates for hosts we actually serve.
  app.get('/_hub/tls-check', (req, res) => {
    const d = String(req.query.domain || '').toLowerCase();
    const ok = d && (d === base || d === hubDomain || tenantForHost(d));
    res.status(ok ? 200 : 404).type('text').send(ok ? 'ok' : 'unknown');
  });

  // Route client hosts to their own app instance.
  app.use((req, res, next) => {
    const host = hostOf(req);
    const t = tenantForHost(host);
    if (!t) return next();
    if (t.status === 'suspended') {
      res.status(503).set('Retry-After', '3600').type('html');
      return res.send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unavailable</title>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;color:#444;text-align:center;margin:0">
<div><div style="font-size:52px">🔒</div><h1 style="font-size:22px">This page is temporarily unavailable</h1><p dir="rtl" style="font-size:18px">الصفحة دي مش متاحة دلوقتي</p></div></body>`);
    }
    // A www. alias of a custom domain → the bare domain.
    if (host.startsWith('www.') && t.domains.includes(host.slice(4))) {
      return res.redirect(301, `${req.protocol}://${host.slice(4)}${req.originalUrl}`);
    }
    return appFor(t)(req, res, next);
  });

  // Everything below is the agency panel.
  app.use((req, res, next) => {
    if (hubDomain && hostOf(req) !== hubDomain && !['localhost', '127.0.0.1'].includes(hostOf(req))) {
      return res.status(404).type('text').send('Not found');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  app.use(express.json({ limit: '50kb' }));
  const loginLimited = auth.rateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
  const authed = (req) => auth.isAuthenticated(req, db);
  const api = express.Router();

  api.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.get('x-hub') !== '1') return res.status(403).json({ error: 'forbidden' });
    next();
  });

  api.get('/state', (req, res) => {
    res.json({
      appName: o.appName,
      setupDone: db.setupDone,
      authed: authed(req),
      baseDomain: base,
      hubDomain,
      metric: o.metric || 'orders',
    });
  });

  api.post('/setup', (req, res) => {
    if (db.setupDone) return res.status(409).json({ error: 'already_setup' });
    if (loginLimited(req.ip)) return res.status(429).json({ error: 'rate_limited' });
    const b = req.body || {};
    const given = normCode(b.setupCode);
    const expected = normCode(db.setupCode);
    if (!given || given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
      return res.status(403).json({ error: 'invalid_setup_code' });
    }
    if (typeof b.password !== 'string' || b.password.length < 8) return res.status(400).json({ error: 'weak_password' });
    db.auth = auth.hashPassword(b.password);
    db.setupDone = true;
    db.settings.currency = clean(b.currency, 12);
    delete db.setupCode;
    save();
    res.setHeader('Set-Cookie', auth.createSessionCookie(db, req.secure));
    res.json({ ok: true });
  });

  api.post('/login', (req, res) => {
    if (loginLimited(req.ip)) return res.status(429).json({ error: 'rate_limited' });
    if (!auth.verifyPassword((req.body || {}).password, db.auth)) return res.status(401).json({ error: 'wrong_password' });
    res.setHeader('Set-Cookie', auth.createSessionCookie(db, req.secure));
    res.json({ ok: true });
  });

  api.post('/logout', (req, res) => {
    res.setHeader('Set-Cookie', auth.clearSessionCookie());
    res.json({ ok: true });
  });

  api.use((req, res, next) => (authed(req) ? next() : res.status(401).json({ error: 'unauthorized' })));

  api.get('/tenants', (req, res) => {
    res.json({ settings: db.settings, today: today(), tenants: db.tenants.map((t) => view(t, req)) });
  });

  api.post('/tenants', (req, res) => {
    const b = req.body || {};
    const { data, error } = validate({ domains: [], price: 0, paidUntil: '', notes: '', phone: '', ...b }, null);
    if (error) return res.status(400).json({ error });
    const t = {
      id: crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'x'),
      status: 'active',
      setupCode: setupCode(),
      createdAt: new Date().toISOString(),
      ...data,
    };
    db.tenants.push(t);
    save();
    res.json(view(t, req));
  });

  api.put('/tenants/:id', (req, res) => {
    const t = byId(req.params.id);
    if (!t) return res.status(404).json({ error: 'not_found' });
    const { data, error } = validate(req.body || {}, t);
    if (error) return res.status(400).json({ error });
    Object.assign(t, data);
    save();
    res.json(view(t, req));
  });

  api.post('/tenants/:id/renew', (req, res) => {
    const t = byId(req.params.id);
    if (!t) return res.status(404).json({ error: 'not_found' });
    const months = Math.min(24, Math.max(1, Number((req.body || {}).months) || 1));
    const from = t.paidUntil && t.paidUntil > today() ? t.paidUntil : today();
    t.paidUntil = addMonths(from, months);
    if (t.status === 'suspended' && (req.body || {}).resume) t.status = 'active';
    save();
    res.json(view(t, req));
  });

  // Clients forget passwords: the agency can issue a new one.
  api.post('/tenants/:id/password', (req, res) => {
    const t = byId(req.params.id);
    if (!t) return res.status(404).json({ error: 'not_found' });
    const store = appFor(t).locals.store;
    if (!store.db.setupDone) return res.status(409).json({ error: 'not_setup' });
    const password = newPassword();
    store.db.auth = auth.hashPassword(password); // new salt → signs every session out
    store.save();
    res.json({ password });
  });

  api.delete('/tenants/:id', (req, res) => {
    const t = byId(req.params.id);
    if (!t) return res.status(404).json({ error: 'not_found' });
    if ((req.body || {}).confirm !== t.slug) return res.status(400).json({ error: 'confirm_mismatch' });
    const app = apps.get(t.id);
    if (app && app.locals.store.flushStats) app.locals.store.flushStats();
    apps.delete(t.id);
    db.tenants = db.tenants.filter((x) => x !== t);
    save();
    // Kept in trash/ rather than deleted, in case of a mistake.
    const dir = path.join(tenantsDir, t.id);
    if (fs.existsSync(dir)) {
      fs.mkdirSync(trashDir, { recursive: true });
      fs.renameSync(dir, path.join(trashDir, `${t.slug}-${t.id}-${Date.now()}`));
    }
    res.json({ ok: true });
  });

  api.put('/settings', (req, res) => {
    const b = req.body || {};
    if (b.currency !== undefined) db.settings.currency = clean(b.currency, 12);
    if (b.brandName !== undefined) db.settings.brandName = clean(b.brandName, 60);
    if (b.brandUrl !== undefined) {
      const u = clean(b.brandUrl, 200);
      if (u && !/^https?:\/\/[^\s]+$/i.test(u)) return res.status(400).json({ error: 'invalid_url' });
      db.settings.brandUrl = u;
    }
    if (b.hideBranding !== undefined) db.settings.hideBranding = !!b.hideBranding;
    if (b.password !== undefined) {
      if (!auth.verifyPassword(b.current, db.auth)) return res.status(403).json({ error: 'wrong_password' });
      if (typeof b.password !== 'string' || b.password.length < 8) return res.status(400).json({ error: 'weak_password' });
      db.auth = auth.hashPassword(b.password);
      res.setHeader('Set-Cookie', auth.createSessionCookie(db, req.secure));
    }
    save();
    res.json({ settings: db.settings });
  });

  app.use('/hub/api', api);
  app.get(['/hub', '/hub/'], (req, res) => res.sendFile(path.join(o.publicDir, 'hub.html')));
  app.get('/', (req, res) => res.redirect('/hub'));
  app.use(express.static(o.publicDir, { maxAge: '1h', index: false }));
  app.use((req, res) => res.status(404).type('text').send('Not found'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  });

  app.locals.hub = db;
  app.locals.flushAll = () => {
    for (const a of apps.values()) if (a.locals.store.flushStats) a.locals.store.flushStats();
  };
  return app;
}

module.exports = { createHub, normalizeDomains, addMonths };
