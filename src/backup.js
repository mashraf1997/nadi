'use strict';

// Automatic daily backups: once a day the app's export (the same file as
// Settings → Backup, without any secrets) is written to DATA_DIR/backups,
// the last 14 days are kept, and — if email is set up and switched on — a
// gzipped copy is emailed to the owner so a copy lives off the server too.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const KEEP = 14;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const dirOf = (store) => path.join(store.dir, 'backups');
const today = () => new Date().toISOString().slice(0, 10);

function list(store) {
  const dir = dirOf(store);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse()
    .map((f) => ({ date: f.slice(0, 10), size: fs.statSync(path.join(dir, f)).size }));
}

/** Writes today's backup (or replaces it with force). Returns { date, size } . */
function runNow(store, snapshot, { force = false } = {}) {
  const dir = dirOf(store);
  fs.mkdirSync(dir, { recursive: true });
  const date = today();
  const file = path.join(dir, `${date}.json`);
  if (fs.existsSync(file) && !force) return { date, size: fs.statSync(file).size, skipped: true };
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(snapshot()));
  fs.renameSync(tmp, file);
  for (const old of list(store).slice(KEEP)) fs.rmSync(path.join(dir, `${old.date}.json`), { force: true });
  return { date, size: fs.statSync(file).size };
}

/**
 * Starts the daily schedule. deps: { snapshot, mailer, alert, appName, log }.
 * Returns a stop() function (tests).
 */
function schedule(store, { snapshot, mailer, alert, appName, log = console }) {
  const tick = async () => {
    try {
      const r = runNow(store, snapshot);
      if (r.skipped) return;
      const smtp = store.db.smtp || {};
      if (mailer && smtp.backups && smtp.ownerEmail) {
        const raw = fs.readFileSync(path.join(dirOf(store), `${r.date}.json`));
        const { html, text } = mailer.render({ brand: { name: store.settings.name, color: store.settings.color }, title: `${appName} backup · ${r.date}`, body: `Your daily backup is attached (${Math.round(raw.length / 1024)} KB). To restore: Settings → Backup → Restore, after unzipping the file.` });
        const sent = await mailer.send(store, { to: smtp.ownerEmail, subject: `${appName} backup ${r.date}`, html, text, attachments: [{ filename: `${appName.toLowerCase()}-backup-${r.date}.json.gz`, content: zlib.gzipSync(raw) }] });
        if (!sent.ok && !sent.skipped) log.error(`Backup email: ${sent.error}`);
      }
    } catch (err) {
      log.error(`Backup failed: ${err.message}`);
      if (alert) alert(`⚠️ ${appName}: the daily backup failed (${err.message}).`);
    }
  };
  const first = setTimeout(tick, 20 * 1000);
  const every = setInterval(tick, 60 * 60 * 1000);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}

/** Admin routes: GET /backups, POST /backups/now, GET /backups/:date. */
function mountAdmin(router, store, { snapshot, guard, appName }) {
  router.get('/backups', (req, res) => res.json({ backups: list(store), keep: KEEP }));
  router.post('/backups/now', guard, (req, res) => {
    try {
      const r = runNow(store, snapshot, { force: true });
      res.json({ ...r, backups: list(store) });
    } catch (err) {
      res.status(500).json({ error: 'backup_failed', message: err.message });
    }
  });
  router.get('/backups/:date', (req, res) => {
    const date = String(req.params.date);
    const file = path.join(dirOf(store), `${date}.json`);
    if (!DATE_RE.test(date) || !fs.existsSync(file)) return res.status(404).json({ error: 'not_found' });
    res.setHeader('Content-Disposition', `attachment; filename="${appName.toLowerCase()}-backup-${date}.json"`);
    res.type('application/json').sendFile(file);
  });
}

module.exports = { KEEP, list, runNow, schedule, mountAdmin };
