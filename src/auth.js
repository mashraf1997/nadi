'use strict';

const crypto = require('node:crypto');

const COOKIE = 'dk_session';
const SESSION_DAYS = 30;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, auth) {
  if (!auth || typeof password !== 'string') return false;
  const hash = crypto.scryptSync(password, auth.salt, 64);
  const expected = Buffer.from(auth.hash, 'hex');
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}

// The signing key includes the password salt, so changing the password
// signs every existing session out.
function signingKey(db) {
  return `${db.secret}:${db.auth ? db.auth.salt : ''}`;
}

function sign(value, key) {
  return crypto.createHmac('sha256', key).update(value).digest('base64url');
}

function createSessionCookie(db, secure) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  const token = `${payload}.${sign(payload, signingKey(db))}`;
  return [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${SESSION_DAYS * 86400}`,
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isAuthenticated(req, db) {
  if (!db.auth) return false;
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = sign(payload, signingKey(db));
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return false;
  }
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
  }
}

// Small in-memory fixed-window rate limiter keyed by IP.
function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return function limited(key) {
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.reset < now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    return entry.count > max;
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSessionCookie,
  clearSessionCookie,
  isAuthenticated,
  rateLimiter,
};
