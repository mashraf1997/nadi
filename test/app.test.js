'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp, intlPhone } = require('../src/app');
const { demoConfig } = require('../src/demo');

const H = { 'Content-Type': 'application/json', 'X-Nadi': '1' };
// A fixed clock: Monday 2 Nov 2026, 18:00 at the gym.
let clockNow = { date: '2026-11-02', minutes: 18 * 60 };
let server;
let base;
let dir;
let cookie = '';

async function call(method, url, body, { auth = false, headers = {} } = {}) {
  const res = await fetch(base + url, { method, redirect: 'manual', headers: { ...H, ...(auth ? { Cookie: cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text, headers: res.headers };
}
const admin = (method, url, body) => call(method, `/api/admin${url}`, body, { auth: true });

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nadi-'));
  const app = createApp({ dataDir: dir, setupCode: 'TEST-CODE', quiet: true, clock: () => clockNow });
  await new Promise((r) => (server = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('fresh install: setup code required, then sample plans and classes', async () => {
  assert.equal((await call('GET', '/')).status, 302);
  assert.equal((await call('POST', '/api/setup', { setupCode: 'NOPE-NOPE', name: 'Iron House', password: 'supersecret' })).status, 403);
  assert.equal((await call('POST', '/api/setup', { setupCode: 'test-code', name: 'Iron House', password: 'supersecret' }, { headers: { 'X-Nadi': '' } })).status, 403, 'CSRF header required');
  const r = await call('POST', '/api/setup', { setupCode: 'test-code', name: 'Iron House', type: 'gym', whatsapp: '201001234567', currency: 'EGP', lang: 'en', password: 'supersecret', sample: true });
  assert.equal(r.status, 200);
  cookie = r.headers.get('set-cookie').split(';')[0];
  const data = (await admin('GET', '/data')).json;
  assert.ok(data.plans.length >= 4);
  assert.ok(data.classes.length >= 5);
  assert.match(data.kioskUrl, /\/kiosk\/[\w-]{16}$/);
  const page = await call('GET', '/');
  assert.equal(page.status, 200);
  assert.match(page.text, /Membership plans/);
  assert.match(page.text, /Class timetable/);
  assert.match(page.text, /ExerciseGym/);
});

test('plans and classes CRUD', async () => {
  const p = await admin('POST', '/plans', { name: '12 sessions', emoji: '🎟️', price: 600, months: 2, visits: 12 });
  assert.equal(p.json.visits, 12);
  assert.equal((await admin('POST', '/plans', { name: '' })).status, 400);
  const upd = await admin('PUT', `/plans/${p.json.id}`, { price: 650, public: false });
  assert.equal(upd.json.price, 650);
  assert.ok(!(await call('GET', '/')).text.includes('12 sessions'), 'hidden plans are not on the public page');
  const c = await admin('POST', '/classes', { title: 'Boxing', coach: 'Ali', day: 1, start: '20:00', end: '21:00' });
  assert.equal(c.json.start, 1200);
  assert.equal((await admin('DELETE', `/classes/${c.json.id}`)).status, 200);
});

let omar;
let monthly;
test('add a member with a plan and payment; card page shows status and QR', async () => {
  const data = (await admin('GET', '/data')).json;
  monthly = data.plans.find((x) => x.name === 'Monthly');
  const r = await admin('POST', '/members', { name: 'Omar Hassan', phone: '01011112222', planId: monthly.id, start: '2026-11-02', paid: 10, method: 'cash' });
  assert.equal(r.status, 200);
  omar = r.json;
  assert.equal(omar.status, 'active');
  assert.equal(omar.end, '2026-12-01');
  assert.equal(omar.due, 20, '30 plan, 10 paid');
  assert.match(decodeURIComponent(r.json.whatsappUrl), /wa\.me\/201011112222\?text=Welcome to Iron House, Omar/);
  const card = await call('GET', `/m/${omar.member.token}`);
  assert.equal(card.status, 200);
  assert.match(card.text, /<svg/);
  assert.match(card.text, /30 days left/);
  assert.match(card.headers.get('x-robots-tag'), /noindex/);
  assert.equal((await call('GET', '/m/not-a-real-token-123')).status, 404);
  const pay = await admin('POST', `/members/${omar.member.id}/payments`, { subId: omar.currentSubId, amount: 20, method: 'wallet' });
  assert.equal(pay.json.due, 0);
});

test('front desk check-in: by member, number and card URL; duplicates and undo', async () => {
  let r = await admin('POST', '/checkin', { memberId: omar.member.id });
  assert.equal(r.json.ok, true);
  assert.equal(r.json.duplicate, false);
  r = await admin('POST', '/checkin', { code: String(omar.member.no) });
  assert.equal(r.json.duplicate, true, 'scanned again within 30 minutes');
  clockNow = { date: '2026-11-03', minutes: 7 * 60 };
  r = await admin('POST', '/checkin', { code: `https://gym.example/m/${omar.member.token}` });
  assert.equal(r.json.ok, true);
  assert.equal((await admin('POST', '/checkin', { code: 'garbage' })).status, 404);
  const today = (await admin('GET', '/checkins')).json.checkins;
  assert.equal(today.length, 1);
  assert.equal((await admin('DELETE', `/checkins/${today[0].id}`)).status, 200);
  assert.equal((await admin('GET', '/checkins')).json.checkins.length, 0);
});

test('visit packs count down; freezing blocks entry and extends the plan', async () => {
  const data = (await admin('GET', '/data')).json;
  const pack = data.plans.find((x) => x.name === '10-visit pass');
  const m = (await admin('POST', '/members', { name: 'Sara Ali', phone: '+201022223333', planId: pack.id, start: '2026-11-03' })).json;
  assert.equal(m.visitsLeft, 10);
  const r = await admin('POST', '/checkin', { memberId: m.member.id });
  assert.equal(r.json.visitsLeft, 9);
  const undo = await admin('DELETE', `/checkins/${r.json.checkinId}`);
  assert.equal(undo.status, 200);
  assert.equal((await admin('GET', `/members/${m.member.id}`)).json.visitsLeft, 10, 'undo gives the visit back');

  const f = await admin('POST', `/subs/${omar.currentSubId}/freeze`, { days: 7 });
  assert.equal(f.json.status, 'frozen');
  assert.equal(f.json.end, '2026-12-08');
  const denied = await admin('POST', '/checkin', { memberId: omar.member.id });
  assert.equal(denied.json.ok, false);
  assert.equal(denied.json.reason, 'frozen');
  const back = await admin('POST', `/subs/${omar.currentSubId}/unfreeze`, {});
  assert.equal(back.json.status, 'active');
  assert.equal(back.json.end, '2026-12-01', 'unused frozen days are taken back');
});

test('renewing early starts after the current plan; expired members are refused at the kiosk', async () => {
  const quarter = (await admin('GET', '/data')).json.plans.find((x) => x.name === '3 months');
  const r = await admin('POST', `/members/${omar.member.id}/subs`, { planId: quarter.id });
  const next = r.json.subs.find((s) => s.planId === quarter.id);
  assert.equal(next.start, '2026-12-02');
  assert.equal(r.json.end, '2026-12-01', 'current plan is still the running one');

  const kiosk = (await admin('GET', '/data')).json.kioskUrl.split('/kiosk/')[1];
  const lapsed = (await admin('POST', '/members', { name: 'Karim Adel', phone: '0100', planId: monthly.id, start: '2026-09-01' })).json;
  assert.equal(lapsed.status, 'expired');
  let k = await call('POST', `/api/kiosk/${kiosk}/checkin`, { code: `${base}/m/${lapsed.member.token}` });
  assert.equal(k.json.ok, false);
  assert.equal(k.json.reason, 'expired');
  assert.equal(k.json.name, 'Karim', 'kiosk shows first names only');
  assert.equal(k.json.phone, undefined);
  k = await call('POST', `/api/kiosk/${kiosk}/checkin`, { code: String(lapsed.member.no) });
  assert.equal(k.status, 404, 'member numbers are guessable, so the kiosk only takes card QR codes');
  k = await call('POST', `/api/kiosk/${kiosk}/checkin`, { code: omar.member.token });
  assert.equal(k.json.ok, true);
  assert.equal((await call('POST', '/api/kiosk/wrong-token-0000000/checkin', { code: omar.member.token })).status, 404);
  assert.equal((await call('GET', '/kiosk/wrong')).status, 404);
  assert.equal((await call('GET', `/kiosk/${kiosk}`)).status, 200);
  // Grace period lets lapsed members in for a few days, with a warning.
  await admin('PUT', '/settings', { graceDays: 3 });
  clockNow = { date: '2026-12-03', minutes: 600 };
  const sara = (await admin('GET', '/members?q=Sara')).json.members[0];
  void sara;
  const late = (await admin('POST', '/members', { name: 'Late Larry', phone: '0', planId: monthly.id, start: '2026-11-01' })).json;
  const g = await admin('POST', '/checkin', { memberId: late.member.id });
  assert.equal(g.json.ok, true);
  assert.equal(g.json.reason, 'grace');
  await admin('PUT', '/settings', { graceDays: 0 });
  clockNow = { date: '2026-11-03', minutes: 19 * 60 };
});

test('member list filters, renewal reminders and stats', async () => {
  const list = (await admin('GET', '/members')).json;
  assert.equal(list.counts.all, 4);
  assert.ok(list.counts.expired >= 1);
  assert.equal((await admin('GET', '/members?filter=expired')).json.members[0].name, 'Karim Adel');
  assert.equal((await admin('GET', '/members?q=0102222')).json.members[0].name, 'Sara Ali');
  const wa = await admin('GET', `/members/${list.members.find((m) => m.name === 'Karim Adel').id}/whatsapp?kind=renew`);
  assert.match(decodeURIComponent(wa.json.url), /We miss you at Iron House/);
  const st = (await admin('GET', '/stats')).json;
  assert.equal(st.members.total, 4);
  assert.ok(st.revenue.month > 0);
  assert.equal(st.days.length, 14);
  assert.equal(st.hours.length, 24);
});

test('join requests from the public page', async () => {
  assert.equal((await call('POST', '/api/join', { name: '', phone: '1' })).json.error, 'name_required');
  const plan = (await admin('GET', '/data')).json.plans[0];
  const r = await call('POST', '/api/join', { name: 'Reem', phone: '01112223344', planId: plan.id, message: 'Evenings please' });
  assert.equal(r.status, 200);
  assert.match(decodeURIComponent(r.json.whatsappUrl), /New join request/);
  const ping = (await admin('GET', '/ping')).json;
  assert.equal(ping.newLeads, 1);
  const lead = (await admin('GET', '/leads')).json.leads[0];
  // Turning the lead into a member marks it handled.
  await admin('POST', '/members', { name: lead.name, phone: lead.phone, leadId: lead.id });
  assert.equal((await admin('GET', '/ping')).json.newLeads, 0);
  await admin('PUT', '/settings', { acceptingJoins: false });
  assert.equal((await call('POST', '/api/join', { name: 'X', phone: '1' })).json.error, 'closed');
  await admin('PUT', '/settings', { acceptingJoins: true });
});

test('CSV exports open in Excel and resist formula injection', async () => {
  await admin('POST', '/members', { name: '=HYPERLINK("http://evil")', phone: '+20100' });
  const res = await fetch(`${base}/api/admin/members.csv`, { headers: { Cookie: cookie } });
  const buf = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM');
  const text = buf.toString('utf8');
  assert.match(text, /"'=HYPERLINK/);
  assert.match(text, /,\+20100,/, 'phone numbers are left alone');
  const pay = await fetch(`${base}/api/admin/payments.csv`, { headers: { Cookie: cookie } });
  assert.match(await pay.text(), /wallet/);
});

test('backup round trip and member deletion', async () => {
  const backup = (await admin('GET', '/export')).json;
  assert.equal(backup.app, 'nadi');
  assert.ok(backup.members.length >= 5 && backup.checkins.length >= 1);
  const victim = backup.members.find((m) => m.name === 'Karim Adel');
  assert.equal((await admin('DELETE', `/members/${victim.id}`)).status, 200);
  assert.equal((await admin('GET', '/members?q=Karim')).json.members.length, 0);
  assert.equal((await admin('POST', '/import', backup)).status, 200);
  const again = (await admin('GET', '/members?q=Karim')).json.members;
  assert.equal(again.length, 1);
  assert.equal((await admin('POST', '/import', { app: 'mawid' })).status, 400);
  assert.equal((await admin('GET', '/data')).status, 200);
});

test('helpers and demo config', () => {
  assert.equal(intlPhone('01011112222', '201001234567'), '201011112222');
  assert.equal(intlPhone('+44 7700 900123', '201001234567'), '447700900123');
  assert.equal(demoConfig({}), null);
  assert.equal(demoConfig({ DEMO_MODE: 'true' }).type, 'gym');
});

test('demo mode seeds a realistic gym', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nadi-demo-'));
  const app = createApp({ dataDir: d, demo: demoConfig({ DEMO_MODE: 'true', DEMO_LANG: 'ar' }), quiet: true, clock: () => ({ date: '2026-11-02', minutes: 600 }) });
  const store = app.locals.store;
  assert.ok(store.members.length > 50);
  assert.ok(store.checkins.length > 200);
  const { computeStats } = require('../src/app');
  const st = computeStats(store, { date: '2026-11-02', minutes: 600 });
  assert.ok(st.members.active > 20);
  assert.ok(st.members.soon > 0, 'some plans end this week');
  assert.ok(st.lapsed.length > 0, 'some members lapsed');
  assert.equal(store.settings.lang, 'ar');
  fs.rmSync(d, { recursive: true, force: true });
});
