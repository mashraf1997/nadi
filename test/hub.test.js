'use strict';

// Agency mode: one server, many isolated clients routed by Host header.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createApp } = require('../src/app');
const { createHub, addMonths, normalizeDomains } = require('../src/hub');

const APP_HEADER = 'X-Nadi';
const TENANT_SETUP = { name: 'Bean Cafe', type: 'gym', password: 'clientpass1', lang: 'en', sample: false };

let server;
let port;
let dir;
let hubCookie = '';

function req(host, method, url, body, { cookie = '', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port, method, path: url, headers: { Host: host, 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}), 'X-Hub': '1', [APP_HEADER]: '1', ...(cookie ? { Cookie: cookie } : {}), ...headers } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const hub = (method, url, body, opts = {}) => req('panel.example.test', method, `/hub/api${url}`, body, { cookie: hubCookie, ...opts });
const cookieOf = (res) => (res.headers['set-cookie'] || [''])[0].split(';')[0];

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-'));
  const app = createHub({
    dataDir: dir,
    createApp,
    appName: 'Test',
    describe: (store) => ({ name: store.settings.name, count30: 0 }),
    baseDomain: 'example.test',
    setupCode: 'HUBC-ODE1',
    publicDir: path.join(__dirname, '..', 'public'),
    quiet: true,
  });
  await new Promise((r) => (server = app.listen(0, '127.0.0.1', r)));
  port = server.address().port;
});

after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hub setup is protected by the setup code; API needs a session', async () => {
  assert.equal((await hub('GET', '/tenants')).status, 401);
  assert.equal((await hub('POST', '/setup', { setupCode: 'NOPE-NOPE', password: 'agencypass' })).status, 403);
  assert.equal((await hub('POST', '/setup', { setupCode: 'hubc-ode1', password: 'short' })).status, 400);
  const ok = await hub('POST', '/setup', { setupCode: 'hubc-ode1', password: 'agencypass', currency: 'EGP' });
  assert.equal(ok.status, 200);
  hubCookie = cookieOf(ok);
  assert.equal((await hub('POST', '/setup', { setupCode: 'HUBC-ODE1', password: 'agencypass' })).status, 409);
  assert.equal((await hub('POST', '/tenants', { label: 'x', slug: 'xx' }, { headers: { 'X-Hub': '' } })).status, 403, 'CSRF header required');
  const page = await req('panel.example.test', 'GET', '/hub');
  assert.equal(page.status, 200);
  assert.match(page.text, /hub\.js/);
});

test('creating clients validates address and domains', async () => {
  assert.equal((await hub('POST', '/tenants', { label: 'Hub', slug: 'hub' })).json.error, 'invalid_slug');
  assert.equal((await hub('POST', '/tenants', { label: 'Bad', slug: 'Bad Slug' })).json.error, 'invalid_slug');
  assert.equal((await hub('POST', '/tenants', { label: '', slug: 'empty' })).json.error, 'label_required');
  assert.equal((await hub('POST', '/tenants', { label: 'X', slug: 'xdom', domains: 'not a domain' })).json.error, 'invalid_domain');
  assert.equal((await hub('POST', '/tenants', { label: 'X', slug: 'xdom', domains: 'a.example.test' })).json.error, 'invalid_domain', 'base subdomains are reserved for slugs');
  const a = await hub('POST', '/tenants', { label: 'Bean Cafe', slug: 'bean', domains: 'https://www.BeanCafe.com/', price: 300, paidUntil: '2026-01-31' });
  assert.equal(a.status, 200);
  assert.deepEqual(a.json.domains, ['beancafe.com']);
  assert.equal(a.json.setupDone, false);
  assert.match(a.json.setupCode, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(a.json.url, 'http://beancafe.com');
  assert.equal((await hub('POST', '/tenants', { label: 'Dup', slug: 'bean' })).json.error, 'slug_taken');
  assert.equal((await hub('POST', '/tenants', { label: 'Dup', slug: 'dup', domains: 'beancafe.com' })).json.error, 'domain_taken');
  const b = await hub('POST', '/tenants', { label: 'Second', slug: 'second' });
  assert.equal(b.status, 200);
  assert.equal(b.json.url, 'http://second.example.test');
});

test('each client is an isolated app reached by subdomain or custom domain', async () => {
  const list = (await hub('GET', '/tenants')).json.tenants;
  const bean = list.find((t) => t.slug === 'bean');
  const st = await req('bean.example.test', 'GET', '/api/state');
  assert.equal(st.json.setupDone, false);
  assert.equal((await req('beancafe.com', 'POST', '/api/setup', { ...TENANT_SETUP, setupCode: 'WRON-GCOD' })).status, 403);
  const setup = await req('beancafe.com', 'POST', '/api/setup', { ...TENANT_SETUP, setupCode: bean.setupCode });
  assert.equal(setup.status, 200);
  const beanCookie = cookieOf(setup);
  assert.equal((await req('bean.example.test', 'GET', '/api/state', undefined, { cookie: beanCookie })).json.authed, true);
  // Another client's data and sessions are separate.
  const second = await req('second.example.test', 'GET', '/api/state', undefined, { cookie: beanCookie });
  assert.equal(second.json.setupDone, false);
  assert.equal(second.json.authed, false);
  // The agency's session is not a client session, and vice versa.
  assert.equal((await req('bean.example.test', 'GET', '/api/state', undefined, { cookie: hubCookie })).json.authed, false);
  assert.equal((await req('panel.example.test', 'GET', '/hub/api/tenants', undefined, { cookie: beanCookie })).status, 401);
  // www → bare domain; the hub now reports the client as set up.
  const www = await req('www.beancafe.com', 'GET', '/menu?x=1');
  assert.equal(www.status, 301);
  assert.equal(www.headers.location, 'http://beancafe.com/menu?x=1');
  const after = (await hub('GET', '/tenants')).json.tenants.find((t) => t.slug === 'bean');
  assert.equal(after.setupDone, true);
  assert.equal(after.setupCode, '');
  assert.equal(after.info.name, 'Bean Cafe');
  // Unknown hosts get the panel, not a client.
  assert.equal((await req('nobody.example.test', 'GET', '/')).headers.location, '/hub');
});

test('white-label: the agency renames or hides "powered by" on client pages', async () => {
  assert.equal((await hub('PUT', '/settings', { brandUrl: 'javascript:alert(1)' })).status, 400);
  const s = await hub('PUT', '/settings', { brandName: 'Pixel Agency', brandUrl: 'https://pixel.example', hideBranding: false });
  assert.equal(s.json.settings.brandName, 'Pixel Agency');
  const page = await req('bean.example.test', 'GET', '/');
  assert.match(page.text, /Pixel Agency/);
  assert.match(page.text, /https:\/\/pixel\.example/);
  assert.equal((await req('bean.example.test', 'GET', '/api/state')).json.brand.name, 'Pixel Agency');
  await hub('PUT', '/settings', { hideBranding: true });
  assert.ok(!(await req('bean.example.test', 'GET', '/')).text.includes('class="powered"'));
  await hub('PUT', '/settings', { brandName: '', brandUrl: '', hideBranding: false });
  assert.match((await req('bean.example.test', 'GET', '/')).text, /class="powered"/);
});

test('on-demand TLS only approves hosts we serve', async () => {
  const check = async (d) => (await req('caddy', 'GET', `/_hub/tls-check?domain=${d}`)).status;
  assert.equal(await check('beancafe.com'), 200);
  assert.equal(await check('www.beancafe.com'), 200);
  assert.equal(await check('bean.example.test'), 200);
  assert.equal(await check('example.test'), 200);
  assert.equal(await check('evil.com'), 404);
  assert.equal(await check('nobody.example.test'), 404);
});

test('suspend, renew, reset password, delete', async () => {
  const bean = (await hub('GET', '/tenants')).json.tenants.find((t) => t.slug === 'bean');
  await hub('PUT', `/tenants/${bean.id}`, { status: 'suspended' });
  const down = await req('beancafe.com', 'GET', '/');
  assert.equal(down.status, 503);
  assert.match(down.text, /temporarily unavailable/);
  const renewed = await hub('POST', `/tenants/${bean.id}/renew`, { months: 1, resume: true });
  assert.equal(renewed.json.status, 'active');
  assert.ok(renewed.json.paidUntil > new Date().toISOString().slice(0, 10), 'overdue renewals count from today');
  assert.equal((await req('beancafe.com', 'GET', '/')).status, 200);

  const { password } = (await hub('POST', `/tenants/${bean.id}/password`, {})).json;
  assert.match(password, /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
  assert.equal((await req('beancafe.com', 'POST', '/api/login', { password: TENANT_SETUP.password })).status, 401);
  assert.equal((await req('beancafe.com', 'POST', '/api/login', { password })).status, 200);
  const second = (await hub('GET', '/tenants')).json.tenants.find((t) => t.slug === 'second');
  assert.equal((await hub('POST', `/tenants/${second.id}/password`, {})).json.error, 'not_setup');

  assert.equal((await hub('DELETE', `/tenants/${bean.id}`, { confirm: 'nope' })).json.error, 'confirm_mismatch');
  assert.equal((await hub('DELETE', `/tenants/${bean.id}`, { confirm: 'bean' })).status, 200);
  assert.equal((await req('beancafe.com', 'GET', '/')).status, 302, 'domain no longer routes to the client');
  assert.ok(fs.readdirSync(path.join(dir, 'trash')).some((f) => f.startsWith('bean-')), 'data moved to trash');
  assert.equal((await hub('GET', '/tenants')).json.tenants.length, 1);
});

test('helpers', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-11-15', 2), '2027-01-15');
  assert.deepEqual(normalizeDomains(' Shop.com, www.shop.com https://other.io/x '), ['shop.com', 'other.io']);
});
