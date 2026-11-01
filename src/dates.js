'use strict';

// Date helpers. A date is "YYYY-MM-DD" (local to the gym), a time is minutes
// after midnight. The gym's time zone is only used to work out "now".

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------- date helpers ----------
function isDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayOfWeek(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
}

/** { date, minutes } right now in the given IANA time zone. */
function nowIn(timezone, at = new Date()) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
  } catch {
    return nowIn('', at);
  }
  const get = (t) => parts.find((p) => p.type === t).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

const fmtTime = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

function addMonths(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** Is the gym open at `now` according to its weekly hours (past-midnight ranges allowed)? */
function isOpen(hours, now) {
  const toM = (s) => toMin(s);
  const today = hours[dayOfWeek(now.date)];
  const yesterday = hours[(dayOfWeek(now.date) + 6) % 7];
  if (today && today.open) {
    const f = toM(today.from);
    const t = toM(today.to);
    if (f === t) return true;
    if (t > f ? now.minutes >= f && now.minutes < t : now.minutes >= f) return true;
  }
  if (yesterday && yesterday.open) {
    const f = toM(yesterday.from);
    const t = toM(yesterday.to);
    if (t < f && now.minutes < t) return true;
  }
  return false;
}

module.exports = { isDate, addDays, addMonths, dayOfWeek, daysBetween, nowIn, toMin, fmtTime, isOpen };
