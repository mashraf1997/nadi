'use strict';

// Shared integration modules: payments, WhatsApp Cloud API, email, web push,
// backups and owner alerts. App-independent; the same file runs in every app.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const P = require('../src/payments');
const W = require('../src/whatsapp');
const mailer = require('../src/mailer');
const push = require('../src/push');
const backup = require('../src/backup');
const notify = require('../src/notify');

const fakeStore = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'integ-'));
  return { dir, db: {}, settings: { name: 'Test Shop', color: '#7c3aed', lang: 'en' }, saved: 0, save() { this.saved++; } };
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('payments: settings validation and public view never leaks secrets', () => {
  const s = fakeStore();
  const c = P.cfgOf(s);
  assert.equal(P.update(c, { provider: 'paypal' }).error, 'invalid_provider');
  assert.equal(P.update(c, { stripeSecret: 'pk_live_abc' }).error, 'invalid_key');
  assert.equal(P.update(c, { currency: '12x' }).error, 'invalid_currency');
  assert.deepEqual(P.update(c, { provider: 'stripe', currency: 'usd', stripeSecret: 'sk_test_1234567890abcdef', stripeWebhookSecret: 'whsec_1234567890abc' }), {});
  assert.equal(P.ready(c), true);
  const view = P.publicView(c, 'https://shop.example/');
  assert.equal(view.testMode, true);
  assert.equal(view.stripeWebhookUrl, 'https://shop.example/webhooks/stripe');
  assert.ok(!JSON.stringify(view).includes('sk_test_1234567890abcdef'));
  assert.ok(!JSON.stringify(view).includes('whsec_'));
  P.update(c, { stripeSecret: '' });
  assert.equal(c.stripeSecret, 'sk_test_1234567890abcdef', 'empty input keeps the stored secret');
  assert.equal(P.minor(12.5, 'USD'), 1250);
  assert.equal(P.minor(500, 'JPY'), 500);
});

test('payments: Stripe checkout request and signed webhooks', async () => {
  const s = fakeStore();
  P.update(P.cfgOf(s), { provider: 'stripe', currency: 'EGP', stripeSecret: 'sk_test_1234567890abcdef', stripeWebhookSecret: 'whsec_testsecret123' });
  let sent;
  const fetchImpl = async (url, opts) => {
    sent = { url, opts, form: new URLSearchParams(opts.body) };
    return json({ id: 'cs_test_abc', url: 'https://checkout.stripe.com/c/pay/cs_test_abc' });
  };
  const r = await P.createCheckout(s, 'https://shop.example/', { kind: 'order', id: 'o1', amount: 150.5, title: 'Order #1001', customer: { name: 'Sara', email: 'sara@example.com' }, returnTo: '/o/tok' }, fetchImpl);
  assert.equal(r.url, 'https://checkout.stripe.com/c/pay/cs_test_abc');
  assert.equal(sent.url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(sent.opts.headers.Authorization, 'Bearer sk_test_1234567890abcdef');
  assert.equal(sent.form.get('line_items[0][price_data][unit_amount]'), '15050');
  assert.equal(sent.form.get('line_items[0][price_data][currency]'), 'egp');
  assert.equal(sent.form.get('client_reference_id'), r.reference);
  assert.equal(sent.form.get('customer_email'), 'sara@example.com');
  assert.match(sent.form.get('success_url'), /\/pay\/return\?ref=.*&p=stripe&session_id=\{CHECKOUT_SESSION_ID\}$/);
  assert.equal(P.cfgOf(s).checkouts[r.reference].providerRef, 'cs_test_abc');

  const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: { client_reference_id: r.reference, payment_status: 'paid', amount_total: 15050, currency: 'egp' } } });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', 'whsec_testsecret123').update(`${t}.${body}`).digest('hex');
  assert.ok(P.verifyStripe(body, `t=${t},v1=${sig}`, 'whsec_testsecret123'));
  assert.equal(P.verifyStripe(body, `t=${t},v1=${'0'.repeat(64)}`, 'whsec_testsecret123'), null, 'wrong signature');
  assert.equal(P.verifyStripe(body.replace('15050', '1'), `t=${t},v1=${sig}`, 'whsec_testsecret123'), null, 'tampered body');
  assert.equal(P.verifyStripe(body, `t=${t - 3600},v1=${sig}`, 'whsec_testsecret123'), null, 'replayed (too old)');
});

test('payments: Paymob intention request and HMAC checks', async () => {
  const s = fakeStore();
  P.update(P.cfgOf(s), { provider: 'paymob', currency: 'EGP', paymobPublic: 'egy_pk_test_x', paymobSecret: 'egy_sk_test_y', paymobHmac: 'HMACSECRET', paymobIntegrations: '123456, 654321' });
  assert.equal(P.update(P.cfgOf(s), { paymobIntegrations: 'abc' }).error, 'invalid_integration');
  let sent;
  const r = await P.createCheckout(s, 'https://shop.example/', { kind: 'deposit', id: 'b1', amount: 50, title: 'Deposit', customer: { name: 'Omar Hassan', phone: '+201011112222' }, returnTo: '/b/x' }, async (url, opts) => {
    sent = { url, opts, body: JSON.parse(opts.body) };
    return json({ id: 99, client_secret: 'egy_csk_test_123' });
  });
  assert.equal(sent.url, 'https://accept.paymob.com/v1/intention/');
  assert.equal(sent.opts.headers.Authorization, 'Token egy_sk_test_y');
  assert.equal(sent.body.amount, 5000);
  assert.deepEqual(sent.body.payment_methods, [123456, 654321]);
  assert.equal(sent.body.special_reference, r.reference);
  assert.equal(sent.body.billing_data.first_name, 'Omar');
  assert.equal(sent.body.notification_url, 'https://shop.example/webhooks/paymob');
  assert.equal(r.url, 'https://accept.paymob.com/unifiedcheckout/?publicKey=egy_pk_test_x&clientSecret=egy_csk_test_123');

  const obj = { amount_cents: 5000, created_at: '2026-11-02T10:00:00', currency: 'EGP', error_occured: false, has_parent_transaction: false, id: 777, integration_id: 123456, is_3d_secure: true, is_auth: false, is_capture: false, is_refunded: false, is_standalone_payment: true, is_voided: false, order: { id: 555, merchant_order_id: r.reference }, owner: 42, pending: false, source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' }, success: true };
  const values = P.PAYMOB_FIELDS.map((f) => String(f.split('.').reduce((o, k) => o[k], obj)));
  const good = crypto.createHmac('sha512', 'HMACSECRET').update(values.join('')).digest('hex');
  assert.equal(P.verifyPaymobCallback({ type: 'TRANSACTION', obj }, good, 'HMACSECRET'), true);
  assert.equal(P.verifyPaymobCallback({ type: 'TRANSACTION', obj: { ...obj, amount_cents: 1 } }, good, 'HMACSECRET'), false);
  const q = Object.fromEntries(P.PAYMOB_FIELDS.map((f, i) => [f === 'order.id' ? 'order' : f, values[i]]));
  assert.equal(P.verifyPaymobQuery({ ...q, hmac: good }, 'HMACSECRET'), true);
  assert.equal(P.verifyPaymobQuery({ ...q, success: 'false', hmac: good }, 'HMACSECRET'), false);
});

test('payments: settling is idempotent and checks the amount', async () => {
  const s = fakeStore();
  const c = P.cfgOf(s);
  c.checkouts.ref1 = { kind: 'order', id: 'o1', amount: 100, currency: 'EGP', returnTo: '/', createdAt: new Date().toISOString() };
  const calls = [];
  const onPaid = async (kind, id, info) => calls.push([kind, id, info.amount]);
  assert.equal((await P.settle(s, 'ref1', { amount: 50, currency: 'EGP' }, onPaid)).error, 'amount_mismatch');
  assert.equal((await P.settle(s, 'ref1', { amount: 100, currency: 'USD' }, onPaid)).error, 'currency_mismatch');
  assert.equal((await P.settle(s, 'nope', { amount: 100 }, onPaid)).error, 'unknown_reference');
  assert.equal((await P.settle(s, 'ref1', { amount: 100, currency: 'EGP', txId: 't1' }, onPaid)).ok, true);
  assert.equal((await P.settle(s, 'ref1', { amount: 100, currency: 'EGP' }, onPaid)).already, true);
  assert.deepEqual(calls, [['order', 'o1', 100]], 'the app hears about a payment exactly once');
});

test('whatsapp: template messages only when switched on', async () => {
  const s = fakeStore();
  const kinds = [{ key: 'tickets', defaultName: 'app_tickets', params: ['name', 'event', 'link'], sample: 'Hi {{1}}…' }];
  const c = W.cfgOf(s);
  assert.equal(W.update(c, { phoneNumberId: 'abc' }, kinds).error, 'invalid_phone_id');
  assert.equal(W.update(c, { templates: { tickets: { name: 'Bad Name', enabled: true } } }, kinds).error, 'invalid_template');
  W.update(c, { token: 'EAAG-token-1234', phoneNumberId: '1234567890', language: 'ar' }, kinds);
  let calls = 0;
  let sent;
  const fetchImpl = async (url, opts) => {
    calls++;
    sent = { url, opts, body: JSON.parse(opts.body) };
    return json({ messages: [{ id: 'wamid.1' }] });
  };
  assert.equal((await W.sendKind(s, 'tickets', '201011112222', ['Sara', 'Gig', 'https://x'], fetchImpl)).skipped, true, 'off by default');
  W.update(c, { templates: { tickets: { name: 'app_tickets', enabled: true } } }, kinds);
  const r = await W.sendKind(s, 'tickets', '+20 101 111 2222', ['Sara', 'Gig\nNight', 'https://x'], fetchImpl);
  assert.equal(r.ok, true);
  assert.equal(calls, 1);
  assert.equal(sent.url, 'https://graph.facebook.com/v21.0/1234567890/messages');
  assert.equal(sent.opts.headers.Authorization, 'Bearer EAAG-token-1234');
  assert.equal(sent.body.to, '201011112222');
  assert.equal(sent.body.template.name, 'app_tickets');
  assert.equal(sent.body.template.language.code, 'ar');
  assert.deepEqual(sent.body.template.components[0].parameters.map((p) => p.text), ['Sara', 'Gig Night', 'https://x'], 'no newlines in template params');
  const view = W.publicView(c, kinds);
  assert.ok(!JSON.stringify(view).includes('EAAG-token-1234'));
  assert.equal(view.log[0].ok, true);
  const bad = await W.sendKind(s, 'tickets', '201011112222', ['a', 'b', 'c'], async () => json({ error: { message: 'Template not approved' } }, 400));
  assert.match(bad.error, /not approved/);
});

test('email: branded HTML is escaped; sending uses the SMTP transport', async () => {
  const { html, text } = mailer.render({ brand: { name: 'Shop <b>', color: '#123456' }, title: 'Hi <script>', body: 'Line 1\nLine 2', button: { label: 'Open', url: 'https://x.example/?a=1&b=2' } });
  assert.ok(!html.includes('<script>'));
  assert.match(html, /Shop &lt;b&gt;/);
  assert.match(html, /a=1&amp;b=2/);
  assert.match(text, /Open: https:\/\/x\.example/);
  const s = fakeStore();
  const c = mailer.cfgOf(s);
  assert.equal(mailer.update(c, { from: 'nope' }).error, 'invalid_email');
  mailer.update(c, { host: 'smtp.example.com', port: 587, user: 'u', pass: 'secret-pass', from: 'Shop <hi@shop.example>', ownerEmail: 'owner@shop.example' });
  assert.ok(!JSON.stringify(mailer.publicView(c)).includes('secret-pass'));
  const mails = [];
  mailer.setTransportFactory((opts) => ({ sendMail: async (m) => { mails.push({ opts, m }); return { messageId: 'm1' }; } }));
  assert.equal((await mailer.send(s, { to: 'buyer@example.com', subject: 'S', html, text })).ok, true);
  assert.equal(mails[0].opts.auth.pass, 'secret-pass');
  assert.equal(mails[0].m.from, 'Shop <hi@shop.example>');
  assert.equal((await mailer.send(s, { to: 'not-an-email', subject: 'S' })).skipped, true);
});

// Reverse of push.encrypt, as a browser would do it (RFC 8291).
function decrypt(body, uaEcdh, authSecret) {
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  const h = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
  const shared = uaEcdh.computeSecret(asPublic);
  const ikm = h(h(authSecret, shared), Buffer.concat([Buffer.from('WebPush: info\0'), uaEcdh.getPublicKey(), asPublic, Buffer.from([1])]));
  const prk = h(salt, ikm);
  const cek = h(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = h(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(-16));
  const out = Buffer.concat([d.update(ct.subarray(0, -16)), d.final()]);
  assert.equal(out[out.length - 1], 2, 'last-record delimiter');
  return out.subarray(0, -1).toString();
}

test('push: payload encryption round-trips and VAPID JWT is valid', async () => {
  const s = fakeStore();
  const c = push.cfgOf(s);
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
  assert.ok(push.validSub(sub));
  const body = push.encrypt(sub, JSON.stringify({ title: 'New order', body: 'السلام عليكم' }));
  assert.deepEqual(JSON.parse(decrypt(body, ua, auth)), { title: 'New order', body: 'السلام عليكم' });

  const header = push.vapidHeader(c, sub.endpoint, 'mailto:a@b.c');
  const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  assert.equal(k, c.publicKey);
  const [h64, p64, sig] = jwt.split('.');
  const claims = JSON.parse(Buffer.from(p64, 'base64url'));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: c.x, y: c.y }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h64}.${p64}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));

  c.subs = [sub, { ...sub, endpoint: 'https://updates.push.services.mozilla.com/gone' }];
  const r = await push.sendAll(s, { title: 't' }, async (url, opts) => {
    assert.equal(opts.headers['Content-Encoding'], 'aes128gcm');
    return new Response('', { status: url.includes('gone') ? 410 : 201 });
  });
  assert.deepEqual(r, { sent: 1, removed: 1 });
  assert.equal(c.subs.length, 1, 'expired subscriptions are dropped');
});

test('backups: daily file, retention, listing', () => {
  const s = fakeStore();
  let n = 0;
  const snapshot = () => ({ app: 'test', n: ++n });
  const r = backup.runNow(s, snapshot);
  assert.ok(r.size > 0);
  assert.equal(backup.runNow(s, snapshot).skipped, true, 'once a day');
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.dir, 'backups', `${r.date}.json`))).n, 1);
  for (let i = 1; i <= 20; i++) fs.writeFileSync(path.join(s.dir, 'backups', `2020-01-${String(i).padStart(2, '0')}.json`), '{}');
  backup.runNow(s, snapshot, { force: true });
  const list = backup.list(s);
  assert.equal(list.length, backup.KEEP);
  assert.equal(list[0].date, r.date, 'newest first; old ones pruned');
});

test('owner alerts fan out to Telegram, email and push', async () => {
  const s = fakeStore();
  s.db.notify = { telegramToken: '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', telegramChat: '4242' };
  s.db.smtp = { host: 'smtp.example.com', port: 587, from: 'hi@shop.example', ownerEmail: 'owner@shop.example' };
  const mails = [];
  mailer.setTransportFactory(() => ({ sendMail: async (m) => { mails.push(m); return { messageId: 'x' }; } }));
  const tg = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('api.telegram.org')) tg.push(JSON.parse(opts.body));
    return json({ ok: true });
  };
  try {
    notify.alertOwner(s, '🎟️ *New order #1001*\nGig\n2× GA', { url: 'https://shop.example/admin#orders', title: 'New order #1001' });
    for (let i = 0; i < 50 && (!tg.length || !mails.length); i++) await new Promise((r) => setTimeout(r, 10));
  } finally {
    globalThis.fetch = real;
  }
  assert.match(tg[0].text, /New order #1001[\s\S]*admin#orders/);
  assert.equal(mails[0].to, 'owner@shop.example');
  assert.equal(mails[0].subject, 'New order #1001');
  assert.ok(!mails[0].text.includes('*'), 'markdown stripped for email');
});

test('every browser script parses (no duplicate declarations)', () => {
  const dir = path.join(__dirname, '..', 'public', 'js');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    assert.doesNotThrow(() => new Function(fs.readFileSync(path.join(dir, f), 'utf8')), f);
  }
});
