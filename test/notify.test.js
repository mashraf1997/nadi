'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const notify = require('../src/notify');

const TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const H = { 'Content-Type': 'application/json', 'X-Nadi': '1' };
const sent = [];
const realFetch = globalThis.fetch;
let server;
let base;
let dir;
let cookie;

// Fake Telegram API; everything else goes to the real network stack.
globalThis.fetch = async (url, opts) => {
  if (!String(url).startsWith('https://api.telegram.org/')) return realFetch(url, opts);
  const method = String(url).split('/').pop();
  const body = JSON.parse(opts.body || '{}');
  if (!String(url).includes(TOKEN)) return new Response(JSON.stringify({ ok: false, description: 'Unauthorized' }), { status: 401 });
  if (method === 'getUpdates') return new Response(JSON.stringify({ ok: true, result: [{ message: { chat: { id: 4242, first_name: 'Owner' } } }] }));
  if (body.parse_mode && /_/.test(body.text)) return new Response(JSON.stringify({ ok: false, description: "Bad Request: can't parse entities" }));
  sent.push(body);
  return new Response(JSON.stringify({ ok: true }));
};

const call = async (method, url, body, auth = true) => {
  const res = await realFetch(base + url, { method, headers: { ...H, ...(auth ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const waitFor = async (fn) => {
  for (let i = 0; i < 50 && !fn(); i++) await new Promise((r) => setTimeout(r, 20));
};

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nadi-notify-'));
  const app = createApp({ dataDir: dir, setupCode: 'CODE-CODE', quiet: true });
  await new Promise((r) => (server = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await realFetch(`${base}/api/setup`, { method: 'POST', headers: H, body: JSON.stringify({ setupCode: 'CODE-CODE', name: 'Shop_One', type: 'gym', password: 'supersecret', lang: 'en', sample: true }) });
  cookie = r.headers.get('set-cookie').split(';')[0];
});

after(() => {
  server.close();
  globalThis.fetch = realFetch;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('telegram settings: validation, detection, token never returned', async () => {
  assert.equal((await call('PUT', '/api/admin/notify', { telegramToken: 'nope' })).json.error, 'invalid_token');
  const saved = await call('PUT', '/api/admin/notify', { telegramToken: TOKEN });
  assert.equal(saved.json.hasToken, true);
  assert.equal(saved.json.tokenHint, '…AAAA');
  assert.equal(saved.json.connected, false);
  const det = await call('POST', '/api/admin/notify/detect', {});
  assert.deepEqual(det.json.chats, [{ id: '4242', name: 'Owner' }]);
  const ok = await call('PUT', '/api/admin/notify', { telegramChat: '4242' });
  assert.equal(ok.json.connected, true);
  const view = await call('GET', '/api/admin/notify');
  assert.ok(!JSON.stringify(view.json).includes(TOKEN), 'token is never sent back');
  assert.equal((await call('GET', '/api/admin/notify', undefined, false)).status, 401);
});

test('test message and join requests reach Telegram (with Markdown fallback)', async () => {
  assert.equal((await call('POST', '/api/admin/notify/test', { text: 'hello' })).status, 200);
  assert.match(sent.at(-1).text, /hello/);
  const before = sent.length;
  const j = await call('POST', '/api/join', { name: 'Sara_Ali', phone: '0101' }, false);
  assert.equal(j.status, 200);
  await waitFor(() => sent.length > before);
  assert.match(sent.at(-1).text, /New join request/);
  assert.match(sent.at(-1).text, /admin#members/);
  assert.equal(sent.at(-1).parse_mode, undefined, 'underscore in the name → resent as plain text');
});

test('backups never contain the bot token', async () => {
  const res = await realFetch(`${base}/api/admin/export`, { headers: { Cookie: cookie } });
  assert.ok(!(await res.text()).includes(TOKEN));
});

test('disconnect clears everything; bad tokens are reported, not thrown', async () => {
  const r = await call('PUT', '/api/admin/notify', { clear: true });
  assert.equal(r.json.hasToken, false);
  assert.equal((await call('POST', '/api/admin/notify/test', {})).status, 400);
  const bad = await notify.sendTelegram({ telegramToken: '999999999:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', telegramChat: '1234' }, 'x');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Unauthorized/);
});
