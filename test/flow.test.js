'use strict';

// End-to-end: automatic WhatsApp when a membership starts, renewal reminder
// 3 days before the end, renewal paid online from the member card.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');

const H = { 'Content-Type': 'application/json', 'X-Nadi': '1' };
const realFetch = globalThis.fetch;
const outbound = [];
let clockNow = { date: '2026-11-02', minutes: 18 * 60 };
let server, base, dir, cookie, store, app, monthly, mona;
let brand = { name: '', url: '', hideBranding: false };

const lastRef = () => Object.keys(store.db.payments.checkouts).pop();
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.stripe.com/')) {
    outbound.push({ to: 'stripe', body: String(opts.body || '') });
    if (u.includes('/v1/checkout/sessions/')) return new Response(JSON.stringify({ id: 'cs_1', payment_status: 'paid', amount_total: Math.round(monthly.price * 100), currency: 'egp', client_reference_id: lastRef(), payment_intent: 'pi_1' }), { status: 200 });
    return new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }), { status: 200 });
  }
  if (u.startsWith('https://graph.facebook.com/')) {
    outbound.push({ to: 'whatsapp', body: JSON.parse(opts.body) });
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 });
  }
  return realFetch(url, opts);
};
const settle = () => new Promise((r) => setTimeout(r, 60));
async function call(method, url, body, { auth = false, headers = {} } = {}) {
  const res = await realFetch(base + url, { method, redirect: 'manual', headers: { ...H, ...(auth ? { Cookie: cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text, headers: res.headers };
}
const admin = (method, url, body) => call(method, `/api/admin${url}`, body, { auth: true });
const templates = (name) => outbound.filter((x) => x.to === 'whatsapp' && x.body.template.name === name);

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nadi-flow-'));
  app = createApp({ dataDir: dir, setupCode: 'TEST-CODE', quiet: true, clock: () => clockNow, branding: () => brand });
  store = app.locals.store;
  await new Promise((r) => (server = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await call('POST', '/api/setup', { setupCode: 'test-code', name: 'Iron House', type: 'gym', whatsapp: '201001234567', currency: 'EGP', lang: 'en', password: 'supersecret', sample: true });
  cookie = r.headers.get('set-cookie').split(';')[0];
  monthly = (await admin('GET', '/data')).json.plans.find((x) => x.name === 'Monthly');
});
after(() => {
  server.close();
  globalThis.fetch = realFetch;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('new member: membership message goes out automatically', async () => {
  await admin('PUT', '/whatsapp', { token: 'EAAtoken123', phoneNumberId: '1234567890', language: 'en', templates: { subscribed: { enabled: true }, renewal: { enabled: true } } });
  const r = await admin('POST', '/members', { name: 'Mona Adel', phone: '01001112222', planId: monthly.id, start: '2026-10-05' });
  assert.equal(r.status, 200);
  assert.equal(r.json.autoSent, true);
  mona = r.json;
  await settle();
  const m = templates('nadi_subscribed');
  assert.equal(m.length, 1);
  assert.equal(m[0].body.to, '201001112222');
  assert.equal(m[0].body.template.components[0].parameters[1].text, 'Monthly');
});

test('renewal reminder: once, 3 days before the end, not after renewing', async () => {
  clockNow = { date: '2026-11-02', minutes: 9 * 60 };
  assert.equal(app.locals.runReminders(), 0, 'not before 10:00');
  clockNow = { date: '2026-11-02', minutes: 11 * 60 };
  assert.equal(app.locals.runReminders(), 1);
  assert.equal(app.locals.runReminders(), 0);
  await settle();
  assert.equal(templates('nadi_renewal').length, 1);
});

test('renew online from the member card', async () => {
  const token = mona.cardUrl.split('/m/')[1];
  assert.ok(!(await call('GET', `/m/${token}`)).text.includes('renew-online'), 'no button until payments are set up');
  assert.equal((await call('POST', `/api/members/${token}/renew`, {})).status, 400);
  await admin('PUT', '/payments', { provider: 'stripe', currency: 'egp', stripeSecret: 'sk_test_abcdefghijkl' });
  const card = await call('GET', `/m/${token}`);
  assert.match(card.text, /id="renew-online"/);
  assert.match(card.text, /Renew Monthly online/);
  const co = await call('POST', `/api/members/${token}/renew`, {});
  assert.equal(co.json.url, 'https://checkout.stripe.com/c/pay/cs_1');
  outbound.length = 0;
  const ret = await call('GET', `/pay/return?ref=${lastRef()}&p=stripe&session_id=cs_1`);
  assert.equal(ret.headers.get('location'), `/m/${token}?paid=1`);
  await settle();
  const subs = store.subsOf(mona.member.id).sort((a, b) => a.start.localeCompare(b.start));
  assert.equal(subs.length, 2);
  assert.equal(subs[1].start, '2026-11-05', 'starts the day after the current plan');
  const pay = store.payments.find((p) => p.subId === subs[1].id);
  assert.equal(pay.method, 'online');
  assert.equal(pay.amount, monthly.price);
  assert.equal(templates('nadi_subscribed').length, 1);
  const after = await call('GET', `/m/${token}?paid=1`);
  assert.match(after.text, /your membership is renewed/);
  assert.ok(!after.text.includes('id="renew-online"'));
  assert.ok(!(await call('GET', `/m/${token}`)).text.includes('id="renew-online"'), 'renewed: no more offer');
  // Already renewed: no more reminders, no second checkout.
  for (const s of subs) s.renewReminded = false;
  assert.equal(app.locals.runReminders(), 0);
  assert.equal((await call('POST', `/api/members/${token}/renew`, {})).status, 400);
});

test('backups, secrets and white-label', async () => {
  const r = await admin('POST', '/backups/now');
  const file = await admin('GET', `/backups/${r.json.date}`);
  assert.equal(file.json.app, 'nadi');
  for (const secret of ['sk_test_abcdefghijkl', 'EAAtoken123']) {
    assert.ok(!file.text.includes(secret));
    assert.ok(!(await admin('GET', '/data')).text.includes(secret));
  }
  brand = { name: 'Pixel Agency', url: 'https://pixel.example', hideBranding: false };
  assert.match((await call('GET', '/')).text, /Pixel Agency/);
  brand = { name: '', url: '', hideBranding: true };
  assert.ok(!(await call('GET', '/')).text.includes('class="powered"'));
});
