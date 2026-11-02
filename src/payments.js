'use strict';

// Optional online payments: Stripe Checkout (worldwide) and Paymob (Egypt,
// Saudi Arabia, UAE, Oman). No SDKs — plain HTTPS calls.
//
// Flow: the app asks for a checkout for something it sells ("order:abc"),
// we remember it under a random reference, the customer pays on the
// provider's page, and the payment is confirmed in one of two ways:
//   1. the customer comes back to /pay/return (we verify with the provider), or
//   2. the provider calls our webhook (signature verified).
// Either way the app's onPaid(kind, id, info) runs exactly once.
// Secrets live in store.db.payments and are never sent to the browser or
// included in backups.

const crypto = require('node:crypto');

const PROVIDERS = ['stripe', 'paymob'];
const PAYMOB_REGIONS = { eg: 'https://accept.paymob.com', sa: 'https://ksa.paymob.com', ae: 'https://uae.paymob.com', om: 'https://oman.paymob.com' };
// Currencies without minor units (Stripe's list).
const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const HOLD_DAYS = 7;

const minor = (amount, currency) => Math.round(Number(amount) * (ZERO_DECIMAL.has(currency) ? 1 : 100));
const major = (units, currency) => (ZERO_DECIMAL.has(currency) ? units : units / 100);
const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function cfgOf(store) {
  if (!store.db.payments || typeof store.db.payments !== 'object') store.db.payments = {};
  const c = store.db.payments;
  if (!c.checkouts || typeof c.checkouts !== 'object') c.checkouts = {};
  return c;
}

/** Is a provider fully set up? */
function ready(c) {
  if (!c || !c.provider || !/^[A-Z]{3}$/.test(c.currency || '')) return false;
  if (c.provider === 'stripe') return /^sk_(test|live)_\w{10,}$/.test(c.stripeSecret || '');
  if (c.provider === 'paymob') return !!(c.paymobSecret && c.paymobPublic && c.paymobHmac && (c.paymobIntegrations || []).length);
  return false;
}

function publicView(c, baseUrl) {
  return {
    provider: c.provider || '',
    currency: c.currency || '',
    ready: ready(c),
    testMode: c.provider === 'stripe' ? /^sk_test_/.test(c.stripeSecret || '') : !!(c.paymobSecret && /test/i.test(c.paymobSecret)),
    stripeHasKey: !!c.stripeSecret,
    stripeHint: c.stripeSecret ? `…${c.stripeSecret.slice(-4)}` : '',
    stripeHasWebhook: !!c.stripeWebhookSecret,
    stripeWebhookUrl: `${baseUrl}webhooks/stripe`,
    paymobRegion: c.paymobRegion || 'eg',
    paymobPublic: c.paymobPublic || '',
    paymobHasSecret: !!c.paymobSecret,
    paymobHasHmac: !!c.paymobHmac,
    paymobIntegrations: (c.paymobIntegrations || []).join(', '),
    paymobCallbackUrl: `${baseUrl}webhooks/paymob`,
  };
}

/** Applies admin settings. Returns { error } or {}. Empty strings keep stored secrets. */
function update(c, b) {
  if (b.clear) {
    for (const k of Object.keys(c)) if (k !== 'checkouts') delete c[k];
    return {};
  }
  if (b.provider !== undefined) {
    if (b.provider && !PROVIDERS.includes(b.provider)) return { error: 'invalid_provider' };
    c.provider = b.provider || '';
  }
  if (b.currency !== undefined) {
    const cur = str(b.currency, 3).toUpperCase();
    if (cur && !/^[A-Z]{3}$/.test(cur)) return { error: 'invalid_currency' };
    c.currency = cur;
  }
  if (str(b.stripeSecret)) {
    if (!/^sk_(test|live)_\w{10,}$/.test(str(b.stripeSecret))) return { error: 'invalid_key' };
    c.stripeSecret = str(b.stripeSecret);
  }
  if (str(b.stripeWebhookSecret)) {
    if (!/^whsec_\w{10,}$/.test(str(b.stripeWebhookSecret))) return { error: 'invalid_key' };
    c.stripeWebhookSecret = str(b.stripeWebhookSecret);
  }
  if (b.paymobRegion !== undefined) c.paymobRegion = PAYMOB_REGIONS[b.paymobRegion] ? b.paymobRegion : 'eg';
  if (b.paymobPublic !== undefined && str(b.paymobPublic)) c.paymobPublic = str(b.paymobPublic, 200);
  if (str(b.paymobSecret)) c.paymobSecret = str(b.paymobSecret, 300);
  if (str(b.paymobHmac)) c.paymobHmac = str(b.paymobHmac, 200);
  if (b.paymobIntegrations !== undefined) {
    const ids = String(b.paymobIntegrations || '').split(/[\s,]+/).filter(Boolean);
    if (ids.some((x) => !/^\d{3,12}$/.test(x))) return { error: 'invalid_integration' };
    c.paymobIntegrations = ids.map(Number);
  }
  return {};
}

// ---------- creating a checkout ----------

async function stripeCall(c, method, path, form, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(`https://api.stripe.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${c.stripeSecret}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20' },
    body: form ? new URLSearchParams(form).toString() : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((data.error && data.error.message) || `Stripe HTTP ${res.status}`), { code: 'provider_error' });
  return data;
}

const splitName = (name) => {
  const parts = String(name || 'Customer').trim().split(/\s+/);
  return { first: parts[0] || 'Customer', last: parts.slice(1).join(' ') || parts[0] || 'Customer' };
};

/**
 * Starts a payment. item: { kind, id, amount, title, customer: {name, phone, email}, returnTo }
 * Returns { url, reference }.
 */
async function createCheckout(store, baseUrl, item, fetchImpl = globalThis.fetch) {
  const c = cfgOf(store);
  if (!ready(c)) throw Object.assign(new Error('payments_off'), { code: 'payments_off' });
  const amount = minor(item.amount, c.currency);
  if (!(amount > 0)) throw Object.assign(new Error('invalid_amount'), { code: 'invalid_amount' });
  const reference = crypto.randomBytes(12).toString('base64url');
  const back = (provider) => `${baseUrl}pay/return?ref=${reference}&p=${provider}`;
  let url;
  let providerRef = '';
  if (c.provider === 'stripe') {
    const form = {
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': c.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(amount),
      'line_items[0][price_data][product_data][name]': String(item.title || 'Payment').slice(0, 200),
      success_url: `${back('stripe')}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl.replace(/\/$/, '')}${item.returnTo}`,
      client_reference_id: reference,
      'metadata[reference]': reference,
    };
    if (item.customer && /@/.test(item.customer.email || '')) form.customer_email = item.customer.email;
    const session = await stripeCall(c, 'POST', '/v1/checkout/sessions', form, fetchImpl);
    url = session.url;
    providerRef = session.id;
  } else {
    const base = PAYMOB_REGIONS[c.paymobRegion || 'eg'];
    const { first, last } = splitName(item.customer && item.customer.name);
    const res = await fetchImpl(`${base}/v1/intention/`, {
      method: 'POST',
      headers: { Authorization: `Token ${c.paymobSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount,
        currency: c.currency,
        payment_methods: c.paymobIntegrations,
        items: [{ name: String(item.title || 'Payment').slice(0, 50), amount, description: String(item.title || 'Payment').slice(0, 200), quantity: 1 }],
        billing_data: {
          first_name: first, last_name: last,
          email: (item.customer && /@/.test(item.customer.email || '') && item.customer.email) || 'customer@example.com',
          phone_number: (item.customer && item.customer.phone) || '+200000000000',
          apartment: 'NA', street: 'NA', building: 'NA', city: 'NA', country: 'NA', floor: 'NA', state: 'NA',
        },
        special_reference: reference,
        notification_url: `${baseUrl}webhooks/paymob`,
        redirection_url: back('paymob'),
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.client_secret) throw Object.assign(new Error(data.detail || `Paymob HTTP ${res.status}`), { code: 'provider_error' });
    url = `${base}/unifiedcheckout/?publicKey=${encodeURIComponent(c.paymobPublic)}&clientSecret=${encodeURIComponent(data.client_secret)}`;
    providerRef = String(data.id || '');
  }
  // Forget checkouts nobody finished after a week.
  const cutoff = Date.now() - HOLD_DAYS * 864e5;
  for (const [ref, ch] of Object.entries(c.checkouts)) if (Date.parse(ch.createdAt) < cutoff) delete c.checkouts[ref];
  c.checkouts[reference] = { kind: item.kind, id: item.id, amount: Number(item.amount), currency: c.currency, provider: c.provider, providerRef, returnTo: item.returnTo, createdAt: new Date().toISOString() };
  store.save();
  return { url, reference };
}

// ---------- verifying payments ----------

/** Stripe-Signature header check (t=…,v1=…). Returns the parsed event or null. */
function verifyStripe(rawBody, header, secret, nowSec = Math.floor(Date.now() / 1000), tolerance = 300) {
  if (!secret || !header || !rawBody) return null;
  const parts = Object.fromEntries(String(header).split(',').map((kv) => kv.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
  const t = Number(parts.t);
  if (!t || Math.abs(nowSec - t) > tolerance) return null;
  const sigs = String(header).split(',').filter((p) => p.trim().startsWith('v1=')).map((p) => p.trim().slice(3));
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const ok = sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) return null;
  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}

// Paymob signs these transaction fields, concatenated in this order.
const PAYMOB_FIELDS = ['amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction', 'id', 'integration_id', 'is_3d_secure', 'is_auth', 'is_capture', 'is_refunded', 'is_standalone_payment', 'is_voided', 'order.id', 'owner', 'pending', 'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success'];
const dig = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
const flat = (v) => (v === undefined || v === null ? '' : String(v));

function paymobHmac(values, secret) {
  return crypto.createHmac('sha512', secret).update(values.join('')).digest('hex');
}
const safeEq = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Webhook body ({ type, obj }) with ?hmac= on the URL. */
function verifyPaymobCallback(body, hmac, secret) {
  if (!secret || !body || !body.obj) return false;
  return safeEq(paymobHmac(PAYMOB_FIELDS.map((f) => flat(dig(body.obj, f))), secret), String(hmac || '').toLowerCase());
}

/** Redirect back from Paymob: the same fields arrive flattened in the query string. */
function verifyPaymobQuery(q, secret) {
  if (!secret || !q) return false;
  const values = PAYMOB_FIELDS.map((f) => flat(q[f === 'order.id' ? 'order' : f]));
  return safeEq(paymobHmac(values, secret), String(q.hmac || '').toLowerCase());
}

/**
 * Marks a remembered checkout as paid (once) and calls the app.
 * info: { amount (major units), currency, provider, txId }
 */
async function settle(store, reference, info, onPaid) {
  const c = cfgOf(store);
  const ch = c.checkouts[reference];
  if (!ch) return { ok: false, error: 'unknown_reference' };
  if (ch.paidAt) return { ok: true, already: true, checkout: ch };
  if (info.currency && info.currency.toUpperCase() !== ch.currency) return { ok: false, error: 'currency_mismatch' };
  if (Number(info.amount) + 0.001 < ch.amount) return { ok: false, error: 'amount_mismatch' };
  ch.paidAt = new Date().toISOString();
  ch.txId = String(info.txId || '');
  store.save();
  await onPaid(ch.kind, ch.id, { amount: ch.amount, currency: ch.currency, provider: info.provider, txId: ch.txId, reference });
  return { ok: true, checkout: ch };
}

/**
 * Public routes (mount on the app itself, before any JSON body parser):
 *   POST /webhooks/stripe   POST /webhooks/paymob   GET /pay/return
 * onPaid(kind, id, info) is the app's handler; express is passed in to avoid a hard dependency.
 */
function mountPublic(app, store, express, { onPaid, log = console }) {
  app.post('/webhooks/stripe', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    const c = cfgOf(store);
    const event = verifyStripe(req.body && req.body.toString('utf8'), req.get('stripe-signature'), c.stripeWebhookSecret);
    if (!event) return res.status(400).json({ error: 'bad_signature' });
    const s = event.data && event.data.object;
    if ((event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') && s && s.payment_status === 'paid') {
      const ref = s.client_reference_id || (s.metadata && s.metadata.reference);
      const cur = String(s.currency || '').toUpperCase();
      const r = await settle(store, ref, { amount: major(s.amount_total, cur), currency: cur, provider: 'stripe', txId: s.payment_intent || s.id }, onPaid).catch((e) => ({ ok: false, error: e.message }));
      if (!r.ok) log.error(`Stripe webhook: ${r.error}`);
    }
    res.json({ received: true });
  });

  app.post('/webhooks/paymob', express.json({ limit: '1mb' }), async (req, res) => {
    const c = cfgOf(store);
    if (!verifyPaymobCallback(req.body, req.query.hmac, c.paymobHmac)) return res.status(400).json({ error: 'bad_signature' });
    const o = req.body.obj;
    if (req.body.type === 'TRANSACTION' && o.success === true && !o.pending && !o.is_voided && !o.is_refunded) {
      const ref = (o.order && (o.order.merchant_order_id || o.special_reference)) || o.special_reference;
      const r = await settle(store, ref, { amount: major(o.amount_cents, o.currency), currency: o.currency, provider: 'paymob', txId: o.id }, onPaid).catch((e) => ({ ok: false, error: e.message }));
      if (!r.ok) log.error(`Paymob webhook: ${r.error}`);
    }
    res.json({ received: true });
  });

  // The customer comes back from the payment page. Confirm with the provider
  // right away, so payments work even before webhooks are set up.
  app.get('/pay/return', async (req, res) => {
    const c = cfgOf(store);
    const ref = str(req.query.ref, 40);
    const ch = c.checkouts[ref];
    if (!ch) return res.redirect('/');
    try {
      if (!ch.paidAt && req.query.p === 'stripe' && c.stripeSecret && /^cs_\w+$/.test(String(req.query.session_id || '')) && req.query.session_id === ch.providerRef) {
        const s = await stripeCall(c, 'GET', `/v1/checkout/sessions/${req.query.session_id}`);
        if (s.payment_status === 'paid' && (s.client_reference_id === ref)) {
          const cur = String(s.currency || '').toUpperCase();
          await settle(store, ref, { amount: major(s.amount_total, cur), currency: cur, provider: 'stripe', txId: s.payment_intent || s.id }, onPaid);
        }
      } else if (!ch.paidAt && req.query.p === 'paymob' && verifyPaymobQuery(req.query, c.paymobHmac) && req.query.success === 'true' && req.query.pending !== 'true') {
        await settle(store, ref, { amount: major(Number(req.query.amount_cents), req.query.currency), currency: req.query.currency, provider: 'paymob', txId: req.query.id }, onPaid);
      }
    } catch (err) {
      log.error(`Payment return: ${err.message}`);
    }
    const done = c.checkouts[ref] && c.checkouts[ref].paidAt;
    const sep = ch.returnTo.includes('?') ? '&' : '?';
    res.redirect(`${ch.returnTo}${sep}${done ? 'paid=1' : 'pay=pending'}`);
  });
}

/** Admin routes: GET/PUT /payments, POST /payments/test. */
function mountAdmin(router, store, { guard, baseUrl }) {
  router.get('/payments', (req, res) => res.json(publicView(cfgOf(store), baseUrl(req))));
  router.put('/payments', guard, (req, res) => {
    const c = cfgOf(store);
    const r = update(c, req.body || {});
    if (r.error) return res.status(400).json(r);
    store.save();
    res.json(publicView(c, baseUrl(req)));
  });
  // Creates a tiny real checkout (nothing is charged unless someone pays it).
  router.post('/payments/test', guard, async (req, res) => {
    try {
      const { url } = await createCheckout(store, baseUrl(req), { kind: 'test', id: 'test', amount: ZERO_DECIMAL.has(cfgOf(store).currency) ? 100 : 1, title: 'Test payment', customer: {}, returnTo: '/admin#settings' });
      res.json({ url });
    } catch (err) {
      res.status(400).json({ error: err.code || 'provider_error', message: err.message });
    }
  });
}

module.exports = { PROVIDERS, PAYMOB_REGIONS, PAYMOB_FIELDS, minor, major, cfgOf, ready, publicView, update, createCheckout, verifyStripe, verifyPaymobCallback, verifyPaymobQuery, paymobHmac, settle, mountPublic, mountAdmin };
