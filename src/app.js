'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const QRCode = require('qrcode');

const { Store, defaultSettings, localDate, newToken } = require('./store');
const auth = require('./auth');
const { LANGS, LANGUAGES, adminStrings } = require('./i18n');
const { cleanTheme, cleanFont, appearanceOptions } = require('./theme');
const { validTimezone } = require('./schedule');
const D = require('./dates');
const M = require('./members');
const { loadSample, GYM_TYPES } = require('./sample');
const { resetDemo } = require('./demo');
const notify = require('./notify');
const payments = require('./payments');
const wa = require('./whatsapp');
const mailer = require('./mailer');
const push = require('./push');
const backup = require('./backup');
const { strings } = require('./i18n');
const { renderGymPage, renderCardPage, renderKioskPage, renderPoster, renderManifest } = require('./views');
const { toCsv } = require('./csv');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const JSQR = require.resolve('jsqr/dist/jsQR.js');
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|curl|wget|headless/i;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// ---------- sanitizers ----------
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v, max = 1e9) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(max, Math.round(n * 100) / 100) : 0;
};
const int = (v, min, max, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const bool = (v) => v === true || v === 'true' || v === 1 || v === 'on';
const imageUrl = (v) => {
  const s = str(v, 500);
  return /^(\/uploads\/[\w.-]+|https?:\/\/\S+)$/i.test(s) ? s : '';
};
const date = (v) => (D.isDate(v) ? v : '');

function cleanWeek(input, fallback) {
  if (!Array.isArray(input) || input.length !== 7) return fallback;
  return input.map((d) => ({
    open: bool(d && d.open),
    from: TIME_RE.test(d && d.from) ? d.from : '06:00',
    to: TIME_RE.test(d && d.to) ? d.to : '23:00',
  }));
}

const SETTINGS_SCHEMA = {
  name: (v) => str(v, 80) || 'My Gym',
  tagline: (v) => str(v, 140),
  about: (v) => str(v, 1000),
  logo: imageUrl,
  cover: imageUrl,
  whatsapp: (v) => str(v, 30).replace(/[^\d+]/g, ''),
  phone: (v) => str(v, 30),
  address: (v) => str(v, 200),
  mapUrl: (v) => (/^https?:\/\//i.test(str(v, 500)) ? str(v, 500) : ''),
  instagram: (v) => str(v, 200),
  facebook: (v) => str(v, 200),
  tiktok: (v) => str(v, 200),
  currency: (v) => str(v, 12),
  lang: (v) => (LANGS.includes(v) ? v : 'en'),
  color: (v) => (/^#[0-9a-f]{6}$/i.test(v) ? v : defaultSettings().color),
  theme: cleanTheme,
  font: cleanFont,
  timezone: validTimezone,
  hours: (v) => cleanWeek(v, defaultSettings().hours),
  acceptingJoins: bool,
  showPrices: bool,
  graceDays: (v) => int(v, 0, 30, 0),
  policy: (v) => str(v, 600),
};

function cleanSettings(input) {
  const out = {};
  for (const [key, fn] of Object.entries(SETTINGS_SCHEMA)) {
    if (input && Object.prototype.hasOwnProperty.call(input, key)) out[key] = fn(input[key]);
  }
  return out;
}

function cleanPlan(input) {
  const months = int(input.months, 0, 36, 1);
  const days = int(input.days, 0, 366, 0);
  return {
    name: str(input.name, 80),
    description: str(input.description, 400),
    emoji: str(input.emoji, 8),
    price: num(input.price),
    months,
    days: months || days ? days : 30,
    visits: int(input.visits, 0, 1000, 0),
    public: input.public === undefined ? true : bool(input.public),
    featured: bool(input.featured),
  };
}

function cleanClass(input) {
  const start = TIME_RE.test(input.start) ? D.toMin(input.start) : int(input.start, 0, 1439, 600);
  const end = TIME_RE.test(input.end) ? D.toMin(input.end) : int(input.end, 0, 1440, start + 60);
  return {
    day: int(input.day, 0, 6, 0),
    start,
    end: end > start ? end : Math.min(1440, start + 60),
    title: str(input.title, 60),
    coach: str(input.coach, 60),
  };
}

function cleanMemberInput(input) {
  return {
    name: str(input.name, 80),
    phone: str(input.phone, 30),
    gender: ['m', 'f'].includes(input.gender) ? input.gender : '',
    birthday: date(input.birthday),
    notes: str(input.notes, 1000),
    photo: imageUrl(input.photo),
  };
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generateSetupCode() {
  const chars = [...crypto.randomBytes(8)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Turns a member's phone into an international number for wa.me.
 * Local numbers ("0101…") borrow the country code from the gym's WhatsApp number.
 */
function intlPhone(phone, gymWhatsapp) {
  const raw = String(phone || '').trim();
  let digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);
  const gym = String(gymWhatsapp || '').replace(/\D/g, '');
  if (digits.startsWith('0') && gym) {
    const national = digits.slice(1);
    const cc = gym.slice(0, gym.length - national.length);
    if (cc.length >= 1 && cc.length <= 3) digits = cc + national;
  }
  return digits;
}

/** A scanned QR / typed code → member. Accepts card URLs, tokens and member numbers. */
function findByCode(store, code) {
  const raw = String(code || '').trim();
  if (!raw) return null;
  const m = /\/m\/([\w-]{8,40})/.exec(raw);
  if (m) return store.memberByToken(m[1]);
  if (/^\d{1,8}$/.test(raw)) return store.memberByNo(raw);
  return store.memberByToken(raw);
}

function createApp({ dataDir, setupCode, demo = null, quiet = false, clock = null, branding = null }) {
  const store = new Store(dataDir);
  const app = express();
  const now = () => (clock ? clock() : D.nowIn(store.settings.timezone));
  const limit = (windowMs, max) => auth.rateLimiter({ windowMs, max });
  const loginLimited = limit(15 * 60 * 1000, 10);
  const setupLimited = limit(15 * 60 * 1000, 10);
  const joinLimited = limit(10 * 60 * 1000, 10);
  const kioskLimited = limit(60 * 1000, 60);

  if (demo) {
    resetDemo(store, demo, now);
    setInterval(() => resetDemo(store, demo, now), demo.resetMinutes * 60 * 1000).unref();
  } else if (!store.db.setupDone) {
    if (setupCode) store.db.setupCode = setupCode;
    else if (!store.db.setupCode) store.db.setupCode = generateSetupCode();
    store.save();
    if (!quiet) {
      console.log('');
      console.log('  ┌──────────────────────────────────────────────┐');
      console.log(`  │  Setup code: ${store.db.setupCode.padEnd(32)}│`);
      console.log('  │  Open /admin in your browser and enter it    │');
      console.log('  │  to set up your gym.                         │');
      console.log('  └──────────────────────────────────────────────┘');
      console.log('');
    }
  }

  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  const baseUrl = (req) => `${req.protocol}://${req.get('host')}/`;
  const cardUrl = (req, m) => `${baseUrl(req)}m/${m.token}`;

  // ---------- integrations ----------
  const rememberBase = (req) => {
    const b = baseUrl(req);
    if (store.db.publicUrl !== b && !/\/\/(localhost|127\.0\.0\.1)[:/]/.test(b)) {
      store.db.publicUrl = b;
      store.save();
    }
  };
  const publicBase = () => store.db.publicUrl || `http://localhost:${process.env.PORT || 3000}/`;
  const snapshot = () => {
    const { settings, plans, classes, leads, nextMemberNo } = store.db;
    return { app: 'nadi', version: 1, exportedAt: new Date().toISOString(), settings, plans, classes, leads, nextMemberNo, members: store.members, subs: store.subs, payments: store.payments, checkins: store.checkins };
  };
  const tx = () => strings(store.settings.lang);
  const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
  const WA_KINDS = [
    { key: 'subscribed', defaultName: 'nadi_subscribed', params: ['name', 'plan', 'until', 'card'], sample: { en: 'Hi {{1}}! Your {{2}} membership is active until {{3}} 💪 Your member card: {{4}}', ar: 'أهلًا يا {{1}}! اشتراك {{2}} شغال لحد {{3}} 💪 كارنيهك: {{4}}' } },
    { key: 'renewal', defaultName: 'nadi_renewal', params: ['name', 'plan', 'date', 'card'], sample: { en: 'Hi {{1}}, your {{2}} membership ends on {{3}}. Renew in one tap from your card: {{4}}', ar: 'أهلًا يا {{1}}، اشتراك {{2}} بيخلص يوم {{3}}. جدد بضغطة من الكارنيه: {{4}}' } },
  ];
  const autoWa = (kind) => {
    const c = wa.cfgOf(store);
    return wa.ready(c) && !!(c.templates[kind] || {}).enabled;
  };
  const untilLabel = (sub) => M.dateLabel(sub.end, store.settings.lang, { day: 'numeric', month: 'long', year: 'numeric' });
  function announceSub(m, sub, base) {
    if (!m || !sub || !m.phone) return;
    wa.sendInBackground(store, 'subscribed', intlPhone(m.phone, store.settings.whatsapp), [firstName(m.name), sub.planName, untilLabel(sub), `${base}m/${m.token}`]);
  }
  /** The plan a member would renew online (their last one, if still sold), or null. */
  function renewPlan(m, st) {
    if (!st || !st.sub || !(st.status === 'expired' || (st.status === 'active' && st.soon))) return null;
    if (store.subsOf(m.id).some((x) => !x.cancelled && x.start > st.sub.end)) return null; // already renewed
    const plan = store.get('plans', st.sub.planId);
    return plan && plan.price > 0 ? plan : null;
  }
  // Online renewals land here once (return page or webhook).
  async function onPaid(kind, id, info) {
    if (kind !== 'renew') return;
    const [memberId, planId] = String(id).split('|');
    const m = store.member(memberId);
    if (!m) return;
    const r = sell(m, { planId, price: info.amount, paid: info.amount, method: 'online' }, now().date);
    if (r.error) return;
    announceSub(m, r.sub, publicBase());
    notify.alertOwner(store, `💳 *${tx().msgRenewedOnline}*\n${m.name} · ${r.sub.planName}\n${M.formatMoney(info.amount, store.settings.currency)}`, { url: `${publicBase()}admin#members`, path: '/admin#members' });
  }
  /** Three days before a plan ends (after 10:00): one reminder, unless already renewed. */
  function sendRenewalReminders() {
    const n = now();
    if (n.minutes < 10 * 60 || !autoWa('renewal')) return 0;
    let sent = 0;
    for (const m of store.members) {
      const subs = store.subsOf(m.id);
      const st = M.memberStatus(subs, n.date);
      if (st.status !== 'active' || !st.sub || st.sub.renewReminded || st.daysLeft > 3) continue;
      if (subs.some((x) => !x.cancelled && x.start > st.sub.end)) continue; // already renewed
      wa.sendInBackground(store, 'renewal', intlPhone(m.phone, store.settings.whatsapp), [firstName(m.name), st.sub.planName, untilLabel(st.sub), `${publicBase()}m/${m.token}`]);
      st.sub.renewReminded = true;
      sent++;
    }
    if (sent) store.saveList('subs');
    return sent;
  }
  const viewSettings = () => (branding ? { ...store.settings, _brand: branding() } : store.settings);
  const pickLang = (req) => (LANGS.includes(req.query.lang) ? req.query.lang : store.settings.lang);
  const requireAuth = (req, res, next) => (auth.isAuthenticated(req, store.db) ? next() : res.status(401).json({ error: 'unauthorized' }));
  const notInDemo = (req, res, next) => (demo ? res.status(403).json({ error: 'demo' }) : next());
  const requireHeader = (req, res, next) => (req.method === 'GET' || req.get('x-nadi') === '1' ? next() : res.status(403).json({ error: 'forbidden' }));

  // ---------- member helpers ----------
  const subsByMember = () => {
    const map = new Map();
    for (const s of store.subs) {
      if (!map.has(s.memberId)) map.set(s.memberId, []);
      map.get(s.memberId).push(s);
    }
    return map;
  };
  const paidBySub = () => {
    const map = new Map();
    for (const p of store.payments) if (p.subId) map.set(p.subId, M.round2((map.get(p.subId) || 0) + p.amount));
    return map;
  };
  const lastVisitByMember = () => {
    const map = new Map();
    for (const c of store.checkins) if (c.ok) map.set(c.memberId, c.date);
    return map;
  };

  function summary(m, today, subsMap, lastMap, paidMap) {
    const st = M.memberStatus(subsMap.get(m.id) || [], today);
    const sub = st.sub;
    const paid = sub ? paidMap.get(sub.id) || 0 : 0;
    return {
      id: m.id,
      no: m.no,
      name: m.name,
      phone: m.phone,
      photo: m.photo,
      gender: m.gender,
      createdAt: m.createdAt,
      status: st.status,
      soon: st.soon,
      daysLeft: st.daysLeft,
      visitsLeft: st.visitsLeft,
      planName: sub ? sub.planName : '',
      emoji: sub ? sub.emoji : '',
      start: sub ? sub.start : '',
      end: sub ? sub.end : '',
      due: sub && !sub.cancelled ? Math.max(0, M.round2(sub.price - paid)) : 0,
      lastVisit: lastMap.get(m.id) || '',
      reminded: m.remindedFor && sub && m.remindedFor === sub.id ? true : false,
    };
  }

  function detail(req, m) {
    const today = now().date;
    const subs = store.subsOf(m.id).sort((a, b) => b.start.localeCompare(a.start));
    const paidMap = paidBySub();
    const st = M.memberStatus(subs, today);
    return {
      member: m,
      ...summary(m, today, new Map([[m.id, subs]]), lastVisitByMember(), paidMap),
      currentSubId: st.sub ? st.sub.id : '',
      frozen: st.status === 'frozen',
      subs: subs.map((s) => ({ ...s, paid: paidMap.get(s.id) || 0 })),
      payments: store.payments.filter((p) => p.memberId === m.id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
      checkins: store.checkins.filter((c) => c.memberId === m.id).slice(-60).reverse(),
      cardUrl: cardUrl(req, m),
    };
  }

  /** Sell a plan to a member: subscription + optional payment. */
  function sell(m, body, today) {
    const plan = store.get('plans', str(body.planId, 20));
    if (!plan) return { error: 'invalid_plan' };
    // Renewing early starts the day after the current plan ends.
    const st = M.memberStatus(store.subsOf(m.id), today);
    const defaultStart = st.sub && ['active', 'frozen', 'upcoming'].includes(st.status) ? D.addDays(st.sub.end, 1) : today;
    const start = date(body.start) || defaultStart;
    const price = body.price === undefined || body.price === '' ? plan.price : num(body.price);
    const sub = store.addRecord('subs', M.buildSub(plan, m.id, { start, price }));
    const paid = body.paid === undefined || body.paid === '' ? price : Math.min(price, num(body.paid));
    if (paid > 0) {
      store.addRecord('payments', { memberId: m.id, subId: sub.id, amount: paid, method: M.PAY_METHODS.includes(body.method) ? body.method : 'cash', date: today, note: '' });
    }
    return { sub };
  }

  function doCheckIn(m, source) {
    const n = now();
    const subs = store.subsOf(m.id);
    const todays = store.checkins.filter((c) => c.memberId === m.id && c.date === n.date);
    const r = M.evaluateCheckIn({ subs, checkins: todays, now: n, graceDays: store.settings.graceDays });
    let record = null;
    if (!r.duplicate) {
      if (r.countVisit) {
        r.state.sub.used = (r.state.sub.used || 0) + 1;
        store.saveList('subs');
      }
      record = store.addRecord('checkins', { memberId: m.id, date: n.date, minutes: n.minutes, source, ok: r.ok, reason: r.reason, subId: r.state.sub ? r.state.sub.id : '' });
    }
    const after = M.memberStatus(store.subsOf(m.id), n.date);
    return {
      ok: r.ok,
      duplicate: r.duplicate,
      reason: r.reason,
      checkinId: record ? record.id : '',
      member: { id: m.id, no: m.no, name: m.name, photo: m.photo },
      status: after.status,
      planName: after.sub ? after.sub.planName : '',
      end: after.sub ? after.sub.end : '',
      daysLeft: after.daysLeft,
      visitsLeft: after.visitsLeft,
      soon: after.soon,
      visitsToday: todays.filter((c) => c.ok).length + (record && record.ok ? 1 : 0),
    };
  }

  payments.mountPublic(app, store, express, { onPaid });
  app.use(express.static(PUBLIC_DIR, { maxAge: '1h', index: false }));
  app.use('/uploads', express.static(store.uploadsDir, { maxAge: '30d', immutable: true }));
  app.get('/js/jsqr.js', (req, res) => res.set('Cache-Control', 'public, max-age=86400').type('js').sendFile(JSQR));
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  // ---------- public pages ----------
  app.get('/', (req, res) => {
    if (!store.db.setupDone) return res.redirect('/admin');
    const preview = req.query.preview === '1';
    const today = localDate();
    if (!preview && !BOT_RE.test(req.get('user-agent') || '') && !(req.headers.cookie || '').includes(`nd_v=${today}`)) {
      store.recordVisit(today);
      res.append('Set-Cookie', `nd_v=${today}; Path=/; Max-Age=86400; SameSite=Lax`);
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(
      renderGymPage({
        settings: viewSettings(),
        plans: store.sorted('plans').filter((p) => p.public !== false),
        classes: [...store.db.classes].sort((a, b) => a.day - b.day || a.start - b.start),
        lang: pickLang(req),
        baseUrl: baseUrl(req),
        now: now(),
        demo: !!demo,
        preview,
        languages: LANGUAGES,
      })
    );
  });

  app.get('/m/:token', async (req, res) => {
    const m = store.memberByToken(req.params.token);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    if (!m) return res.status(404).type('html').send(renderCardPage({ settings: store.settings, lang: pickLang(req), member: null }));
    const today = now().date;
    const subs = store.subsOf(m.id);
    const st = M.memberStatus(subs, today);
    const url = cardUrl(req, m);
    const qr = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#ffffff' } });
    const visits = store.checkins.filter((c) => c.memberId === m.id && c.ok);
    const plan = !demo && payments.ready(payments.cfgOf(store)) ? renewPlan(m, st) : null;
    res.type('html').send(
      renderCardPage({
        renewOnline: plan ? { name: plan.name, price: M.formatMoney(plan.price, store.settings.currency) } : null,
        payPending: req.query.pay === 'pending',
        justPaid: req.query.paid === '1',
        settings: viewSettings(),
        lang: pickLang(req),
        member: m,
        state: st,
        qr,
        url,
        today,
        visits: visits.slice(-8).reverse(),
        visitCount: visits.length,
        baseUrl: baseUrl(req),
      })
    );
  });

  app.get('/kiosk/:token', (req, res) => {
    const ok = req.params.token === store.db.kioskToken;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.status(ok ? 200 : 404).type('html').send(renderKioskPage({ settings: store.settings, lang: pickLang(req), token: ok ? req.params.token : '', languages: LANGUAGES }));
  });

  app.get('/manifest.webmanifest', (req, res) => res.type('application/manifest+json').send(JSON.stringify(renderManifest(store.settings))));
  app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));

  // ---------- public API ----------
  const api = express.Router();
  api.use(express.json({ limit: '6mb' }));
  api.use(requireHeader);

  api.get('/i18n/:lang', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({ strings: adminStrings(req.params.lang), languages: LANGUAGES });
  });

  api.get('/state', (req, res) => {
    res.json({
      setupDone: store.db.setupDone,
      authed: auth.isAuthenticated(req, store.db),
      lang: store.settings.lang,
      needsSetupCode: !store.db.setupDone,
      demo: demo ? { password: demo.password, resetMinutes: demo.resetMinutes } : null,
      languages: LANGUAGES,
      gymTypes: GYM_TYPES,
      brand: branding ? branding() : null,
    });
  });

  // Renew from the member card, paid online (Stripe / Paymob).
  api.post('/members/:token/renew', async (req, res) => {
    if (joinLimited(req.ip)) return res.status(429).json({ error: 'rate_limited' });
    const m = store.memberByToken(req.params.token);
    if (!m) return res.status(404).json({ error: 'not_found' });
    const plan = renewPlan(m, M.memberStatus(store.subsOf(m.id), now().date));
    if (!plan || !payments.ready(payments.cfgOf(store))) return res.status(400).json({ error: 'not_payable' });
    try {
      const r = await payments.createCheckout(store, baseUrl(req), { kind: 'renew', id: `${m.id}|${plan.id}`, amount: plan.price, title: `${store.settings.name} · ${plan.name}`, customer: { name: m.name, phone: m.phone }, returnTo: `/m/${m.token}` });
      res.json({ url: r.url });
    } catch (err) {
      res.status(400).json({ error: err.code || 'provider_error' });
    }
  });

  api.post('/join', (req, res) => {
    if (!store.settings.acceptingJoins) return res.status(400).json({ error: 'closed' });
    if (joinLimited(req.ip)) return res.status(429).json({ error: 'rate_limited' });
    const b = req.body || {};
    const name = str(b.name, 80);
    const phone = str(b.phone, 30);
    if (!name) return res.status(400).json({ error: 'name_required' });
    if (!phone) return res.status(400).json({ error: 'phone_required' });
    const plan = store.get('plans', str(b.planId, 20));
    const lead = { id: crypto.randomBytes(6).toString('base64url'), name, phone, planId: plan ? plan.id : '', planName: plan ? plan.name : '', emoji: plan ? plan.emoji : '', message: str(b.message, 500), createdAt: new Date().toISOString(), handled: false };
    store.db.leads.push(lead);
    if (store.db.leads.length > 2000) store.db.leads = store.db.leads.slice(-2000);
    store.save();
    const text = M.leadMessage(lead, store.settings);
    rememberBase(req);
    notify.alertOwner(store, text, { url: `${baseUrl(req)}admin#members`, path: '/admin#members' });
    res.json({ ok: true, whatsappUrl: M.whatsappUrl(store.settings.whatsapp, text) });
  });

  // Self check-in tablet at the door: the secret link is the credential.
  api.post('/kiosk/:token/checkin', (req, res) => {
    const t = req.params.token;
    if (!t || t.length !== store.db.kioskToken.length || !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(store.db.kioskToken))) {
      return res.status(404).json({ error: 'not_found' });
    }
    if (kioskLimited(req.ip)) return res.status(429).json({ error: 'rate_limited' });
    const m = findByCode(store, (req.body || {}).code);
    if (!m || /^\d+$/.test(String((req.body || {}).code || '').trim())) return res.status(404).json({ error: 'unknown_member' });
    const r = doCheckIn(m, 'kiosk');
    // The kiosk is semi-public: only what the member needs to see.
    res.json({ ok: r.ok, duplicate: r.duplicate, reason: r.reason, name: m.name.split(/\s+/)[0], photo: m.photo, status: r.status, end: r.end, daysLeft: r.daysLeft, visitsLeft: r.visitsLeft, soon: r.soon });
  });

  api.post('/setup', notInDemo, (req, res) => {
    if (store.db.setupDone) return res.status(409).json({ error: 'already_setup' });
    if (setupLimited(req.ip)) return res.status(429).json({ error: 'rate_limited' });
    const b = req.body || {};
    const given = normCode(b.setupCode);
    const expected = normCode(store.db.setupCode);
    if (!given || given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
      return res.status(403).json({ error: 'invalid_setup_code' });
    }
    if (typeof b.password !== 'string' || b.password.length < 8) return res.status(400).json({ error: 'weak_password' });
    store.updateSettings(cleanSettings({ name: b.name, whatsapp: b.whatsapp, currency: b.currency, lang: b.lang, timezone: b.timezone }));
    store.db.auth = auth.hashPassword(b.password);
    store.db.setupDone = true;
    delete store.db.setupCode;
    store.save();
    if (bool(b.sample)) loadSample(store, GYM_TYPES.includes(b.type) ? b.type : 'gym', store.settings.lang, { today: now().date });
    res.setHeader('Set-Cookie', auth.createSessionCookie(store.db, req.secure));
    res.json({ ok: true });
  });

  api.post('/login', (req, res) => {
    if (loginLimited(req.ip)) return res.status(429).json({ error: 'rate_limited' });
    if (!auth.verifyPassword(req.body && req.body.password, store.db.auth)) return res.status(401).json({ error: 'wrong_password' });
    res.setHeader('Set-Cookie', auth.createSessionCookie(store.db, req.secure));
    res.json({ ok: true });
  });

  api.post('/logout', (req, res) => {
    res.setHeader('Set-Cookie', auth.clearSessionCookie());
    res.json({ ok: true });
  });

  // ---------- admin API ----------
  const admin = express.Router();
  admin.use(requireAuth);
  notify.mountRoutes(admin, store, { guard: notInDemo, appName: 'Nadi' });
  payments.mountAdmin(admin, store, { guard: notInDemo, baseUrl });
  wa.mountAdmin(admin, store, { guard: notInDemo, kinds: WA_KINDS });
  mailer.mountAdmin(admin, store, { guard: notInDemo, appName: 'Nadi' });
  push.mountAdmin(admin, store, { appName: 'Nadi' });
  backup.mountAdmin(admin, store, { snapshot, guard: notInDemo, appName: 'Nadi' });
  admin.use((req, res, next) => {
    rememberBase(req);
    next();
  });

  admin.get('/data', (req, res) => {
    res.json({
      settings: store.settings,
      plans: store.sorted('plans'),
      classes: [...store.db.classes].sort((a, b) => a.day - b.day || a.start - b.start),
      baseUrl: baseUrl(req),
      kioskUrl: `${baseUrl(req)}kiosk/${store.db.kioskToken}`,
      now: now(),
      demo: !!demo,
      appearance: appearanceOptions(store.settings.lang),
      newLeads: store.db.leads.filter((l) => !l.handled).length,
    });
  });

  admin.put('/settings', (req, res) => {
    const before = { logo: store.settings.logo, cover: store.settings.cover };
    const settings = store.updateSettings(cleanSettings(req.body));
    store.removeUploadIfUnused(before.logo);
    store.removeUploadIfUnused(before.cover);
    res.json({ settings });
  });

  admin.put('/password', notInDemo, (req, res) => {
    const { current, next } = req.body || {};
    if (!auth.verifyPassword(current, store.db.auth)) return res.status(401).json({ error: 'wrong_password' });
    if (typeof next !== 'string' || next.length < 8) return res.status(400).json({ error: 'weak_password' });
    store.db.auth = auth.hashPassword(next);
    store.save();
    res.setHeader('Set-Cookie', auth.createSessionCookie(store.db, req.secure));
    res.json({ ok: true });
  });

  admin.post('/kiosk/reset', notInDemo, (req, res) => {
    store.db.kioskToken = newToken();
    store.save();
    res.json({ kioskUrl: `${baseUrl(req)}kiosk/${store.db.kioskToken}` });
  });

  // ---- plans & classes ----
  for (const [coll, clean, required] of [['plans', cleanPlan, 'name'], ['classes', cleanClass, 'title']]) {
    admin.post(`/${coll}`, (req, res) => {
      const data = clean(req.body || {});
      if (!data[required]) return res.status(400).json({ error: 'name_required' });
      res.json(store.add(coll, data));
    });
    admin.put(`/${coll}/:id`, (req, res) => {
      const existing = store.get(coll, req.params.id);
      if (!existing) return res.status(404).json({ error: 'not_found' });
      const data = clean({ ...existing, ...req.body });
      if (!data[required]) return res.status(400).json({ error: 'name_required' });
      res.json(store.update(coll, existing.id, data));
    });
    admin.delete(`/${coll}/:id`, (req, res) => {
      if (!store.remove(coll, req.params.id)) return res.status(404).json({ error: 'not_found' });
      res.json({ ok: true });
    });
  }

  admin.post('/reorder', (req, res) => {
    const { ids } = req.body || {};
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'invalid' });
    store.reorder('plans', ids.map(String));
    res.json({ ok: true });
  });

  // ---- members ----
  admin.get('/members', (req, res) => {
    const today = now().date;
    const subsMap = subsByMember();
    const lastMap = lastVisitByMember();
    const paidMap = paidBySub();
    const q = str(req.query.q, 60).toLowerCase();
    const filter = str(req.query.filter, 20);
    let list = store.members.map((m) => summary(m, today, subsMap, lastMap, paidMap));
    const counts = { all: list.length, active: 0, soon: 0, expired: 0, frozen: 0, due: 0 };
    for (const s of list) {
      if (s.status === 'active' || s.status === 'upcoming') counts.active++;
      if (s.status === 'active' && s.soon) counts.soon++;
      if (s.status === 'expired' || s.status === 'none') counts.expired++;
      if (s.status === 'frozen') counts.frozen++;
      if (s.due > 0) counts.due++;
    }
    if (q) list = list.filter((s) => `${s.name} ${s.phone} ${s.no}`.toLowerCase().includes(q));
    if (filter === 'active') list = list.filter((s) => s.status === 'active' || s.status === 'upcoming');
    if (filter === 'soon') list = list.filter((s) => s.status === 'active' && s.soon).sort((a, b) => a.end.localeCompare(b.end));
    else if (filter === 'expired') list = list.filter((s) => s.status === 'expired' || s.status === 'none').sort((a, b) => b.end.localeCompare(a.end));
    else if (filter === 'frozen') list = list.filter((s) => s.status === 'frozen');
    else if (filter === 'due') list = list.filter((s) => s.due > 0);
    else list.sort((a, b) => b.no - a.no);
    res.json({ members: list.slice(0, 1000), counts, total: list.length });
  });

  admin.get('/members/:id', (req, res) => {
    const m = store.member(req.params.id);
    if (!m) return res.status(404).json({ error: 'not_found' });
    res.json(detail(req, m));
  });

  admin.post('/members', (req, res) => {
    const b = req.body || {};
    const data = cleanMemberInput(b);
    if (!data.name) return res.status(400).json({ error: 'name_required' });
    if (b.planId && !store.get('plans', str(b.planId, 20))) return res.status(400).json({ error: 'invalid_plan' });
    const m = store.addMember(data);
    let sub = null;
    if (b.planId) sub = sell(m, b, now().date).sub;
    if (b.leadId) {
      const lead = store.db.leads.find((l) => l.id === b.leadId);
      if (lead) {
        lead.handled = true;
        store.save();
      }
    }
    const welcome = M.welcomeMessage(m, sub, store.settings, cardUrl(req, m));
    if (sub) announceSub(m, sub, baseUrl(req));
    res.json({ ...detail(req, m), autoSent: !!sub && !!m.phone && autoWa('subscribed'), whatsappUrl: M.whatsappUrl(intlPhone(m.phone, store.settings.whatsapp), welcome) });
  });

  admin.put('/members/:id', (req, res) => {
    const m = store.member(req.params.id);
    if (!m) return res.status(404).json({ error: 'not_found' });
    const data = cleanMemberInput({ ...m, ...req.body });
    if (!data.name) return res.status(400).json({ error: 'name_required' });
    const oldPhoto = m.photo;
    store.updateMember(m.id, data);
    if (oldPhoto && oldPhoto !== data.photo) store.removeUploadIfUnused(oldPhoto);
    res.json(detail(req, m));
  });

  admin.delete('/members/:id', (req, res) => {
    const m = store.removeMember(req.params.id);
    if (!m) return res.status(404).json({ error: 'not_found' });
    store.removeUploadIfUnused(m.photo);
    res.json({ ok: true });
  });

  admin.post('/members/:id/subs', (req, res) => {
    const m = store.member(req.params.id);
    if (!m) return res.status(404).json({ error: 'not_found' });
    const r = sell(m, req.body || {}, now().date);
    if (r.error) return res.status(400).json(r);
    const welcome = M.welcomeMessage(m, r.sub, store.settings, cardUrl(req, m));
    announceSub(m, r.sub, baseUrl(req));
    res.json({ ...detail(req, m), autoSent: !!m.phone && autoWa('subscribed'), whatsappUrl: M.whatsappUrl(intlPhone(m.phone, store.settings.whatsapp), welcome) });
  });

  admin.post('/subs/:id/freeze', (req, res) => {
    const sub = store.record('subs', req.params.id);
    if (!sub || sub.cancelled) return res.status(404).json({ error: 'not_found' });
    const today = now().date;
    const from = date((req.body || {}).from) || today;
    if (from > sub.end || from < today) return res.status(400).json({ error: 'invalid_date' });
    const r = M.freezeSub(sub, from, (req.body || {}).days);
    if (r.error) return res.status(400).json(r);
    store.saveList('subs');
    res.json(detail(req, store.member(sub.memberId)));
  });

  admin.post('/subs/:id/unfreeze', (req, res) => {
    const sub = store.record('subs', req.params.id);
    if (!sub) return res.status(404).json({ error: 'not_found' });
    const r = M.unfreezeSub(sub, now().date);
    if (r.error) return res.status(400).json(r);
    store.saveList('subs');
    res.json(detail(req, store.member(sub.memberId)));
  });

  admin.delete('/subs/:id', (req, res) => {
    const sub = store.record('subs', req.params.id);
    if (!sub) return res.status(404).json({ error: 'not_found' });
    sub.cancelled = true;
    store.saveList('subs');
    res.json(detail(req, store.member(sub.memberId)));
  });

  admin.post('/members/:id/payments', (req, res) => {
    const m = store.member(req.params.id);
    if (!m) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    const amount = num(b.amount);
    if (!amount) return res.status(400).json({ error: 'invalid_amount' });
    const sub = b.subId ? store.record('subs', str(b.subId, 20)) : null;
    if (b.subId && (!sub || sub.memberId !== m.id)) return res.status(400).json({ error: 'invalid_plan' });
    store.addRecord('payments', { memberId: m.id, subId: sub ? sub.id : '', amount, method: M.PAY_METHODS.includes(b.method) ? b.method : 'cash', date: date(b.date) || now().date, note: str(b.note, 200) });
    res.json(detail(req, m));
  });

  admin.delete('/payments/:id', (req, res) => {
    const p = store.record('payments', req.params.id);
    if (!p) return res.status(404).json({ error: 'not_found' });
    store.payments = store.payments.filter((x) => x !== p);
    store.saveList('payments');
    res.json(detail(req, store.member(p.memberId)));
  });

  admin.get('/members/:id/whatsapp', (req, res) => {
    const m = store.member(req.params.id);
    if (!m) return res.status(404).json({ error: 'not_found' });
    const today = now().date;
    const st = M.memberStatus(store.subsOf(m.id), today);
    const phone = intlPhone(m.phone, store.settings.whatsapp);
    let text = '';
    if (req.query.kind === 'renew' && st.sub) {
      text = M.renewalMessage(m, st.sub, store.settings, cardUrl(req, m), today);
      store.updateMember(m.id, { remindedFor: st.sub.id });
    } else if (req.query.kind === 'card') {
      text = M.welcomeMessage(m, st.sub, store.settings, cardUrl(req, m));
    }
    res.json({ url: text ? M.whatsappUrl(phone, text) : `https://wa.me/${phone}` });
  });

  // ---- check-in at the front desk ----
  admin.post('/checkin', (req, res) => {
    const b = req.body || {};
    const m = b.memberId ? store.member(str(b.memberId, 20)) : findByCode(store, b.code);
    if (!m) return res.status(404).json({ error: 'unknown_member' });
    res.json(doCheckIn(m, 'desk'));
  });

  admin.delete('/checkins/:id', (req, res) => {
    const c = store.record('checkins', req.params.id);
    if (!c) return res.status(404).json({ error: 'not_found' });
    if (c.ok && c.subId) {
      const sub = store.record('subs', c.subId);
      if (sub && sub.visits && sub.used > 0) {
        sub.used--;
        store.saveList('subs');
      }
    }
    store.checkins = store.checkins.filter((x) => x !== c);
    store.saveList('checkins');
    res.json({ ok: true });
  });

  admin.get('/checkins', (req, res) => {
    const day = date(req.query.date) || now().date;
    const list = store.checkins
      .filter((c) => c.date === day)
      .map((c) => {
        const m = store.member(c.memberId);
        return { ...c, name: m ? m.name : '?', no: m ? m.no : '', photo: m ? m.photo : '' };
      })
      .reverse();
    res.json({ date: day, checkins: list });
  });

  // ---- join requests ----
  admin.get('/leads', (req, res) => res.json({ leads: [...store.db.leads].reverse() }));
  admin.put('/leads/:id', (req, res) => {
    const lead = store.db.leads.find((l) => l.id === req.params.id);
    if (!lead) return res.status(404).json({ error: 'not_found' });
    lead.handled = bool((req.body || {}).handled);
    store.save();
    res.json(lead);
  });
  admin.delete('/leads/:id', (req, res) => {
    const before = store.db.leads.length;
    store.db.leads = store.db.leads.filter((l) => l.id !== req.params.id);
    if (before === store.db.leads.length) return res.status(404).json({ error: 'not_found' });
    store.save();
    res.json({ ok: true });
  });
  admin.get('/leads/:id/whatsapp', (req, res) => {
    const lead = store.db.leads.find((l) => l.id === req.params.id);
    if (!lead) return res.status(404).json({ error: 'not_found' });
    res.json({ url: `https://wa.me/${intlPhone(lead.phone, store.settings.whatsapp)}` });
  });

  admin.get('/stats', (req, res) => res.json(computeStats(store, now())));
  admin.get('/ping', (req, res) => {
    const open = store.db.leads.filter((l) => !l.handled);
    res.json({ newLeads: open.length, lastLead: open.length ? open[open.length - 1].id : '' });
  });

  admin.post('/upload', (req, res) => {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec((req.body && req.body.dataUrl) || '');
    if (!m) return res.status(400).json({ error: 'invalid_image' });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX_IMAGE_BYTES) return res.status(413).json({ error: 'too_large' });
    const name = `${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}.${IMAGE_TYPES[m[1]]}`;
    fs.writeFileSync(path.join(store.uploadsDir, name), buf);
    res.json({ url: `/uploads/${name}` });
  });

  admin.get('/qr.svg', async (req, res) => {
    const svg = await QRCode.toString(str(req.query.text, 500) || baseUrl(req), { type: 'svg', margin: 1, color: { dark: '#111111', light: '#ffffff' } });
    res.type('image/svg+xml').send(svg);
  });

  admin.get('/members.csv', (req, res) => {
    const today = now().date;
    const subsMap = subsByMember();
    const lastMap = lastVisitByMember();
    const paidMap = paidBySub();
    const rows = store.members.map((m) => summary(m, today, subsMap, lastMap, paidMap)).sort((a, b) => a.no - b.no);
    const csv = toCsv(
      ['no', 'name', 'phone', 'status', 'plan', 'start', 'end', 'visits_left', 'due', 'last_visit', 'joined'],
      rows.map((r) => [r.no, r.name, r.phone, r.status, r.planName, r.start, r.end, r.visitsLeft === null ? '' : r.visitsLeft, r.due, r.lastVisit, r.createdAt.slice(0, 10)])
    );
    res.setHeader('Content-Disposition', `attachment; filename="members-${today}.csv"`);
    res.type('text/csv; charset=utf-8').send(csv);
  });

  admin.get('/payments.csv', (req, res) => {
    const names = new Map(store.members.map((m) => [m.id, m]));
    const subs = new Map(store.subs.map((s) => [s.id, s]));
    const csv = toCsv(
      ['date', 'member_no', 'member', 'plan', 'amount', 'method', 'note'],
      [...store.payments].sort((a, b) => a.date.localeCompare(b.date)).map((p) => {
        const m = names.get(p.memberId);
        const s = subs.get(p.subId);
        return [p.date, m ? m.no : '', m ? m.name : '', s ? s.planName : '', p.amount, p.method, p.note];
      })
    );
    res.setHeader('Content-Disposition', `attachment; filename="payments-${now().date}.csv"`);
    res.type('text/csv; charset=utf-8').send(csv);
  });

  admin.get('/export', (req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="nadi-backup-${now().date}.json"`);
    res.json(snapshot());
  });

  admin.post('/import', notInDemo, (req, res) => {
    const b = req.body || {};
    if (b.app !== 'nadi' || !Array.isArray(b.plans) || !Array.isArray(b.members)) return res.status(400).json({ error: 'invalid_backup' });
    const rid = () => crypto.randomBytes(6).toString('base64url');
    store.db.settings = { ...defaultSettings(), ...cleanSettings(b.settings || {}) };
    store.db.plans = b.plans.map((p, i) => ({ id: str(p.id, 20) || rid(), sort: i + 1, ...cleanPlan(p) })).filter((p) => p.name);
    store.db.classes = (Array.isArray(b.classes) ? b.classes : []).map((c) => ({ id: str(c.id, 20) || rid(), ...cleanClass(c) })).filter((c) => c.title);
    store.db.leads = Array.isArray(b.leads) ? b.leads.filter((l) => l && l.id && l.name) : [];
    store.members = b.members.filter((m) => m && m.id && m.token && m.name).map((m) => ({ ...m, ...cleanMemberInput(m) }));
    const ids = new Set(store.members.map((m) => m.id));
    store.subs = (Array.isArray(b.subs) ? b.subs : []).filter((s) => s && s.id && ids.has(s.memberId) && D.isDate(s.start) && D.isDate(s.end));
    store.payments = (Array.isArray(b.payments) ? b.payments : []).filter((p) => p && p.id && ids.has(p.memberId) && D.isDate(p.date)).map((p) => ({ ...p, amount: num(p.amount) }));
    store.checkins = (Array.isArray(b.checkins) ? b.checkins : []).filter((c) => c && c.id && ids.has(c.memberId) && D.isDate(c.date));
    store.db.nextMemberNo = store.members.reduce((mx, m) => Math.max(mx, (m.no || 0) + 1), Number(b.nextMemberNo) || 1001);
    store.save();
    for (const k of ['members', 'subs', 'payments', 'checkins']) store.saveList(k);
    res.json({ ok: true });
  });

  api.use('/admin', admin);
  app.use('/api', api);

  app.get('/admin/poster', async (req, res) => {
    if (!auth.isAuthenticated(req, store.db)) return res.redirect('/admin');
    const url = req.query.kiosk === '1' ? `${baseUrl(req)}kiosk/${store.db.kioskToken}` : baseUrl(req);
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1 });
    res.type('html').send(renderPoster({ settings: store.settings, svg, lang: store.settings.lang, url }));
  });

  app.use((req, res) => res.status(404).type('text').send('Not found'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
    console.error(err);
    notify.alertError(store, 'Nadi', err);
    res.status(500).json({ error: 'server_error' });
  });

  if (!demo) {
    backup.schedule(store, { snapshot, mailer, alert: (text) => notify.alertOwner(store, text), appName: 'Nadi' });
    setInterval(sendRenewalReminders, 60 * 60 * 1000).unref();
  }
  app.locals.runReminders = sendRenewalReminders;
  app.locals.store = store;
  app.locals.setupCode = store.db.setupCode;
  return app;
}

function computeStats(store, now) {
  const today = now.date;
  const d = (n) => D.addDays(today, n);
  const sum = (list) => M.round2(list.reduce((s, p) => s + p.amount, 0));
  const change = (cur, prev, minPrev = 0) => (prev && prev >= minPrev ? Math.round(((cur - prev) / prev) * 100) : null);

  const subsMap = new Map();
  for (const s of store.subs) {
    if (!subsMap.has(s.memberId)) subsMap.set(s.memberId, []);
    subsMap.get(s.memberId).push(s);
  }
  const paid = new Map();
  for (const p of store.payments) if (p.subId) paid.set(p.subId, (paid.get(p.subId) || 0) + p.amount);

  const counts = { active: 0, frozen: 0, soon: 0, expired30: 0, total: store.members.length };
  const plans = new Map();
  const expiring = [];
  const lapsed = [];
  let owed = 0;
  for (const m of store.members) {
    const st = M.memberStatus(subsMap.get(m.id) || [], today);
    const row = { id: m.id, no: m.no, name: m.name, phone: m.phone, photo: m.photo, planName: st.sub ? st.sub.planName : '', emoji: st.sub ? st.sub.emoji : '', end: st.sub ? st.sub.end : '', daysLeft: st.daysLeft, visitsLeft: st.visitsLeft, reminded: !!(st.sub && m.remindedFor === st.sub.id) };
    if (st.status === 'active' || st.status === 'frozen') {
      counts[st.status]++;
      const key = st.sub.planName;
      plans.set(key, { name: key, emoji: st.sub.emoji, count: ((plans.get(key) || {}).count || 0) + 1 });
    }
    if (st.status === 'active' && st.soon) {
      counts.soon++;
      expiring.push(row);
    }
    if (st.status === 'expired' && st.since && st.since >= d(-30)) {
      counts.expired30++;
      lapsed.push(row);
    }
    if (st.sub && !st.sub.cancelled) owed += Math.max(0, st.sub.price - (paid.get(st.sub.id) || 0));
  }

  const inRange = (x, from, to) => x.date >= from && x.date <= to;
  const rev30 = store.payments.filter((p) => inRange(p, d(-29), today));
  const revPrev = store.payments.filter((p) => inRange(p, d(-59), d(-30)));
  const ok = store.checkins.filter((c) => c.ok);
  const visits30 = ok.filter((c) => inRange(c, d(-29), today));
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const day = d(-i);
    days.push({ date: day, count: ok.filter((c) => c.date === day).length });
  }
  const hours = Array(24).fill(0);
  for (const c of visits30) hours[Math.floor(c.minutes / 60)]++;
  const newMembers = store.members.filter((m) => Date.now() - Date.parse(m.createdAt) < 30 * 864e5).length;
  const todayList = store.checkins.filter((c) => c.date === today).slice(-12).reverse().map((c) => {
    const m = store.member(c.memberId);
    return { id: c.id, memberId: c.memberId, name: m ? m.name : '?', photo: m ? m.photo : '', minutes: c.minutes, ok: c.ok, reason: c.reason };
  });

  return {
    members: counts,
    newMembers,
    // Only compare when the previous month is big enough to mean something.
    revenue: { month: sum(rev30), change: change(sum(rev30), sum(revPrev), Math.max(1, sum(rev30) / 4)) },
    owed: M.round2(owed),
    checkins: { today: ok.filter((c) => c.date === today).length, month: visits30.length, avg: counts.active ? Math.round((visits30.length / counts.active) * 10) / 10 : 0 },
    days,
    hours,
    plans: [...plans.values()].sort((a, b) => b.count - a.count),
    expiring: expiring.sort((a, b) => a.end.localeCompare(b.end)).slice(0, 30),
    lapsed: lapsed.sort((a, b) => b.end.localeCompare(a.end)).slice(0, 30),
    leads: store.db.leads.filter((l) => !l.handled).slice(-10).reverse(),
    todayList,
    plansCount: store.db.plans.length,
  };
}

module.exports = { createApp, intlPhone, generateSetupCode, findByCode, computeStats };
