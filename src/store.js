'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_CHECKINS = 200000;
const VISIT_DAYS = 120;
// Large, frequently-written lists live in their own files.
const LISTS = ['members', 'subs', 'payments', 'checkins'];

const newId = () => crypto.randomBytes(6).toString('base64url');
const newToken = () => crypto.randomBytes(12).toString('base64url');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`Could not read ${file}: ${err.message}`);
  }
}

// Write to a temp file then rename, so a crash mid-write never corrupts data.
function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const defaultHours = () => Array.from({ length: 7 }, () => ({ open: true, from: '06:00', to: '23:00' }));

function defaultSettings() {
  return {
    name: 'My Gym',
    tagline: '',
    about: '',
    logo: '',
    cover: '',
    whatsapp: '',
    phone: '',
    address: '',
    mapUrl: '',
    instagram: '',
    facebook: '',
    tiktok: '',
    currency: 'EGP',
    lang: 'ar',
    color: '#ea580c',
    theme: 'fresh',
    font: 'cairo',
    timezone: '',
    hours: defaultHours(),
    acceptingJoins: true,
    showPrices: true,
    graceDays: 0,
    policy: '',
  };
}

function defaultDb() {
  return {
    version: 1,
    setupDone: false,
    secret: crypto.randomBytes(32).toString('hex'),
    kioskToken: newToken(),
    auth: null,
    settings: defaultSettings(),
    plans: [],
    classes: [],
    leads: [],
    nextMemberNo: 1001,
  };
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.uploadsDir = path.join(dir, 'uploads');
    fs.mkdirSync(this.uploadsDir, { recursive: true });
    this.dbFile = path.join(dir, 'db.json');
    this.statsFile = path.join(dir, 'stats.json');

    const db = readJson(this.dbFile);
    this.db = db || defaultDb();
    this.db.settings = { ...defaultSettings(), ...this.db.settings };
    for (const k of ['plans', 'classes', 'leads']) if (!Array.isArray(this.db[k])) this.db[k] = [];
    if (!this.db.kioskToken) this.db.kioskToken = newToken();
    for (const k of LISTS) this[k] = readJson(this.file(k)) || [];
    this.stats = readJson(this.statsFile) || { visits: {} };
    if (!db) this.save();
  }

  file(list) {
    return path.join(this.dir, `${list}.json`);
  }

  save() {
    writeJsonAtomic(this.dbFile, this.db);
  }

  saveList(list) {
    if (list === 'checkins' && this.checkins.length > MAX_CHECKINS) this.checkins = this.checkins.slice(-MAX_CHECKINS);
    writeJsonAtomic(this.file(list), this[list]);
  }

  get settings() {
    return this.db.settings;
  }

  updateSettings(patch) {
    this.db.settings = { ...this.db.settings, ...patch };
    this.save();
    return this.db.settings;
  }

  /** Wipes everything except the signing secret (demo mode). */
  reset() {
    const { secret } = this.db;
    this.db = defaultDb();
    this.db.secret = secret;
    for (const k of LISTS) this[k] = [];
    this.stats = { visits: {} };
    for (const f of fs.readdirSync(this.uploadsDir)) fs.rmSync(path.join(this.uploadsDir, f), { force: true });
    this.save();
    for (const k of LISTS) this.saveList(k);
    this.flushStats(true);
  }

  // ---- sorted db collections: plans, classes ----
  sorted(collection) {
    return [...this.db[collection]].sort((a, b) => a.sort - b.sort);
  }

  get(collection, id) {
    return this.db[collection].find((x) => x.id === id) || null;
  }

  add(collection, data, { save = true } = {}) {
    const sort = this.db[collection].reduce((m, x) => Math.max(m, x.sort || 0), 0) + 1;
    const item = { id: newId(), sort, ...data };
    this.db[collection].push(item);
    if (save) this.save();
    return item;
  }

  update(collection, id, data) {
    const item = this.get(collection, id);
    if (!item) return null;
    Object.assign(item, data);
    this.save();
    return item;
  }

  remove(collection, id) {
    const item = this.get(collection, id);
    if (!item) return null;
    this.db[collection] = this.db[collection].filter((x) => x.id !== id);
    this.save();
    return item;
  }

  reorder(collection, ids) {
    ids.forEach((id, i) => {
      const item = this.get(collection, id);
      if (item) item.sort = i + 1;
    });
    this.save();
  }

  // ---- members ----
  member(id) {
    return this.members.find((m) => m.id === id) || null;
  }

  memberByToken(token) {
    return (token && this.members.find((m) => m.token === token)) || null;
  }

  memberByNo(no) {
    return this.members.find((m) => String(m.no) === String(no)) || null;
  }

  addMember(data, { save = true } = {}) {
    const m = { id: newId(), no: this.db.nextMemberNo++, token: newToken(), createdAt: new Date().toISOString(), ...data };
    this.members.push(m);
    if (save) {
      this.save();
      this.saveList('members');
    }
    return m;
  }

  updateMember(id, data) {
    const m = this.member(id);
    if (!m) return null;
    Object.assign(m, data, { updatedAt: new Date().toISOString() });
    this.saveList('members');
    return m;
  }

  removeMember(id) {
    const m = this.member(id);
    if (!m) return null;
    this.members = this.members.filter((x) => x.id !== id);
    this.subs = this.subs.filter((s) => s.memberId !== id);
    this.payments = this.payments.filter((p) => p.memberId !== id);
    this.checkins = this.checkins.filter((c) => c.memberId !== id);
    for (const k of LISTS) this.saveList(k);
    return m;
  }

  subsOf(memberId) {
    return this.subs.filter((s) => s.memberId === memberId);
  }

  // ---- generic list records (subs, payments, checkins) ----
  addRecord(list, data, { save = true } = {}) {
    const item = { id: newId(), createdAt: new Date().toISOString(), ...data };
    this[list].push(item);
    if (save) this.saveList(list);
    return item;
  }

  record(list, id) {
    return this[list].find((x) => x.id === id) || null;
  }

  // ---- visits to the public page (written at most every few seconds) ----
  recordVisit(date = localDate()) {
    this.stats.visits[date] = (this.stats.visits[date] || 0) + 1;
    this.statsDirty = true;
    if (!this.statsTimer) {
      this.statsTimer = setTimeout(() => this.flushStats(), 5000);
      this.statsTimer.unref();
    }
  }

  flushStats(force) {
    clearTimeout(this.statsTimer);
    this.statsTimer = null;
    if (!this.statsDirty && !force) return;
    const keep = Object.keys(this.stats.visits).sort().slice(-VISIT_DAYS);
    this.stats.visits = Object.fromEntries(keep.map((k) => [k, this.stats.visits[k]]));
    writeJsonAtomic(this.statsFile, this.stats);
    this.statsDirty = false;
  }

  // ---- uploads ----
  isImageInUse(url) {
    const s = this.db.settings;
    if (s.logo === url || s.cover === url) return true;
    return this.members.some((m) => m.photo === url) || this.db.plans.some((p) => p.image === url);
  }

  removeUploadIfUnused(url) {
    if (!url || !url.startsWith('/uploads/') || this.isImageInUse(url)) return;
    fs.rm(path.join(this.uploadsDir, path.basename(url)), { force: true }, () => {});
  }
}

module.exports = { Store, defaultSettings, defaultHours, newId, newToken, localDate, LISTS };
