'use strict';

// Weekly opening hours. days[0] = Sunday … days[6] = Saturday.
// A range whose "to" is earlier than "from" runs past midnight (e.g. 18:00 → 02:00).
// from === to means open all day.

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function defaultSchedule() {
  return {
    enabled: false,
    timezone: '',
    days: Array.from({ length: 7 }, () => ({ open: true, from: '09:00', to: '23:00' })),
  };
}

function validTimezone(tz) {
  if (!tz || typeof tz !== 'string') return '';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return '';
  }
}

function cleanSchedule(input) {
  const base = defaultSchedule();
  if (!input || typeof input !== 'object') return base;
  const days = Array.isArray(input.days) ? input.days : [];
  return {
    enabled: input.enabled === true || input.enabled === 'true',
    timezone: validTimezone(input.timezone),
    days: base.days.map((def, i) => {
      const d = days[i] || {};
      return {
        open: d.open === undefined ? def.open : d.open === true || d.open === 'true',
        from: TIME_RE.test(d.from) ? d.from : def.from,
        to: TIME_RE.test(d.to) ? d.to : def.to,
      };
    }),
  };
}

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// Day of week and minutes since midnight in the shop's time zone.
function localNow(timezone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || undefined,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return { day: WEEKDAYS[get('weekday')], minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

function isOpen(schedule, date = new Date()) {
  if (!schedule || !schedule.enabled) return true;
  const { day, minutes } = localNow(schedule.timezone, date);
  const today = schedule.days[day];
  if (today.open) {
    const f = toMin(today.from);
    const t = toMin(today.to);
    if (f === t) return true;
    if (f < t && minutes >= f && minutes < t) return true;
    if (f > t && minutes >= f) return true;
  }
  // Yesterday's range may run past midnight into today.
  const y = schedule.days[(day + 6) % 7];
  if (y.open) {
    const f = toMin(y.from);
    const t = toMin(y.to);
    if (f > t && minutes < t) return true;
  }
  return false;
}

/** Next opening as { inDays, from } (inDays 0 = later today), or null if never open. */
function nextOpening(schedule, date = new Date()) {
  if (!schedule || !schedule.enabled) return null;
  const { day, minutes } = localNow(schedule.timezone, date);
  for (let i = 0; i <= 7; i++) {
    const d = schedule.days[(day + i) % 7];
    if (!d.open) continue;
    if (i === 0 && toMin(d.from) <= minutes) continue;
    return { inDays: i, from: d.from };
  }
  return null;
}

/** Human label for the next opening, e.g. "09:00" or "Mon 09:00", in the given language. */
function nextOpeningLabel(schedule, lang, date = new Date()) {
  const next = nextOpening(schedule, date);
  if (!next) return '';
  if (next.inDays === 0) return next.from;
  const target = new Date(date.getTime() + next.inDays * 864e5);
  let weekday = '';
  try {
    weekday = new Intl.DateTimeFormat(lang, { weekday: 'long', timeZone: schedule.timezone || undefined }).format(target);
  } catch {
    weekday = new Intl.DateTimeFormat('en', { weekday: 'long' }).format(target);
  }
  return `${weekday} ${next.from}`;
}

module.exports = { defaultSchedule, cleanSchedule, validTimezone, isOpen, nextOpening, nextOpeningLabel, localNow };
