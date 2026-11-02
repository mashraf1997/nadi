'use strict';

// Web Push to the owner's phones and computers (Android, desktop, and iPhone
// when the admin is added to the home screen). Standard VAPID + aes128gcm
// payload encryption (RFC 8291 / RFC 8188) using only node:crypto.
// Keys and subscriptions live in store.db.push (never in backups).

const crypto = require('node:crypto');

const MAX_SUBS = 20;
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s || ''), 'base64url');

function cfgOf(store) {
  if (!store.db.push || typeof store.db.push !== 'object') store.db.push = {};
  const c = store.db.push;
  if (!c.publicKey || !c.privateKey) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = privateKey.export({ format: 'jwk' });
    c.publicKey = b64u(publicKey.export({ format: 'der', type: 'spki' }).subarray(-65));
    c.privateKey = jwk.d;
    c.x = jwk.x;
    c.y = jwk.y;
    store.save();
  }
  if (!Array.isArray(c.subs)) c.subs = [];
  return c;
}

function vapidKey(c) {
  return crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: c.privateKey, x: c.x, y: c.y }, format: 'jwk' });
}

/** VAPID JWT for one push service origin (valid 12 hours). */
function vapidHeader(c, endpoint, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), { key: vapidKey(c), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${payload}.${b64u(sig)}, k=${c.publicKey}`;
}

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/** Encrypts a payload for one subscription (aes128gcm, single record). */
function encrypt(sub, payload, { salt = crypto.randomBytes(16), serverKeys = null } = {}) {
  const uaPublic = fromB64u(sub.keys.p256dh);
  const authSecret = fromB64u(sub.keys.auth);
  const ecdh = serverKeys || crypto.createECDH('prime256v1');
  if (!serverKeys) ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const prkKey = hmac(authSecret, shared);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(65, 20);
  return Buffer.concat([header, asPublic, body]);
}

/** Sends to every subscribed device; drops subscriptions the push service says are gone. */
async function sendAll(store, message, fetchImpl = globalThis.fetch) {
  const c = cfgOf(store);
  if (!c.subs.length) return { sent: 0 };
  const payload = JSON.stringify(message);
  let sent = 0;
  const gone = new Set();
  await Promise.all(c.subs.map(async (sub) => {
    try {
      const res = await fetchImpl(sub.endpoint, {
        method: 'POST',
        headers: {
          TTL: '86400',
          Urgency: 'high',
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          Authorization: vapidHeader(c, sub.endpoint, c.subject || 'mailto:admin@example.com'),
        },
        body: encrypt(sub, payload),
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 404 || res.status === 410) gone.add(sub.endpoint);
      else if (res.ok) sent++;
    } catch {
      /* offline device or push service hiccup: try next time */
    }
  }));
  if (gone.size) {
    c.subs = c.subs.filter((s) => !gone.has(s.endpoint));
    store.save();
  }
  return { sent, removed: gone.size };
}

function sendInBackground(store, message) {
  sendAll(store, message).catch(() => {});
}

const validSub = (s) =>
  s && typeof s.endpoint === 'string' && /^https:\/\/[^\s]{10,2000}$/.test(s.endpoint) && s.keys && fromB64u(s.keys.p256dh).length === 65 && fromB64u(s.keys.auth).length >= 16;

/** Admin routes: GET /push, POST /push/subscribe, POST /push/unsubscribe, POST /push/test. */
function mountAdmin(router, store, { appName }) {
  router.get('/push', (req, res) => {
    const c = cfgOf(store);
    res.json({ publicKey: c.publicKey, devices: c.subs.length });
  });
  router.post('/push/subscribe', (req, res) => {
    const c = cfgOf(store);
    const s = req.body && req.body.subscription;
    if (!validSub(s)) return res.status(400).json({ error: 'invalid_subscription' });
    c.subs = c.subs.filter((x) => x.endpoint !== s.endpoint);
    c.subs.push({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, ua: String(req.get('user-agent') || '').slice(0, 120), at: new Date().toISOString() });
    if (c.subs.length > MAX_SUBS) c.subs = c.subs.slice(-MAX_SUBS);
    if (!c.subject) c.subject = `mailto:${(store.db.smtp && store.db.smtp.ownerEmail) || 'admin@example.com'}`;
    store.save();
    res.json({ devices: c.subs.length });
  });
  router.post('/push/unsubscribe', (req, res) => {
    const c = cfgOf(store);
    const endpoint = req.body && req.body.endpoint;
    c.subs = c.subs.filter((x) => x.endpoint !== endpoint);
    store.save();
    res.json({ devices: c.subs.length });
  });
  router.post('/push/test', async (req, res) => {
    const r = await sendAll(store, { title: `✅ ${appName}`, body: (req.body && String(req.body.text || '').slice(0, 200)) || 'Notifications are working.', url: '/admin' });
    res.json(r);
  });
}

module.exports = { cfgOf, vapidHeader, encrypt, sendAll, sendInBackground, mountAdmin, validSub };
