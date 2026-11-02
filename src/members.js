'use strict';

// Memberships: plans, subscriptions, freezes, check-ins and messages.
//
// A plan lasts some months and/or days, and can optionally be limited to a
// number of visits (e.g. "12 sessions within 2 months"). Selling a plan to a
// member creates a subscription with a start and an inclusive end date.
// Freezing pushes the end date back by the frozen days.

const D = require('./dates');
const { strings } = require('./i18n');

const PAY_METHODS = ['cash', 'card', 'transfer', 'wallet', 'other', 'online'];
const DUPLICATE_MINUTES = 30; // a second scan within this window doesn't count twice
const SOON_DAYS = 7;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ---------- money ----------
const PREFIX_SYMBOLS = ['$', '€', '£', '¥', '₹', '₺', 'R$', 'US$', 'C$', 'A$'];
function formatMoney(amount, currency) {
  const n = round2(amount);
  const s = Number.isInteger(n) ? String(n) : n.toFixed(2);
  if (!currency) return s;
  return PREFIX_SYMBOLS.includes(currency) ? `${currency}${s}` : `${s} ${currency}`;
}

function dateLabel(date, lang, opts = { weekday: 'long', day: 'numeric', month: 'long' }) {
  try {
    return new Intl.DateTimeFormat(lang, { ...opts, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  } catch {
    return date;
  }
}

// ---------- plans & subscriptions ----------

/** Inclusive last day of a plan that starts on `start`. */
function planEnd(plan, start) {
  const months = Number(plan.months) || 0;
  const days = Number(plan.days) || 0;
  let end = months ? D.addMonths(start, months) : start;
  end = D.addDays(end, days || (months ? 0 : 30));
  return D.addDays(end, -1);
}

/** Human description of a plan's length: "1 month", "12 visits · 2 months". */
function planLength(plan, t) {
  const parts = [];
  const m = Number(plan.months) || 0;
  const d = Number(plan.days) || 0;
  if (m) parts.push(`${m} ${m === 1 ? t.month1 : t.months}`);
  if (d) parts.push(`${d} ${d === 1 ? t.day1 : t.days}`);
  if (!m && !d) parts.push(`30 ${t.days}`);
  const len = parts.join(' + ');
  return plan.visits ? `${plan.visits} ${t.visits} · ${len}` : len;
}

function buildSub(plan, memberId, { start, price } = {}) {
  return {
    memberId,
    planId: plan.id,
    planName: plan.name,
    emoji: plan.emoji || '',
    start,
    end: planEnd(plan, start),
    visits: Number(plan.visits) || 0,
    used: 0,
    price: price === undefined ? Number(plan.price) || 0 : round2(price),
    freezes: [],
    cancelled: false,
  };
}

const isFrozen = (sub, today) => (sub.freezes || []).some((f) => f.from <= today && today <= f.to);

/**
 * The subscription that matters for a member today: the one running now,
 * else the next upcoming one, else the most recently ended one.
 */
function currentSub(subs, today) {
  const mine = subs.filter((s) => !s.cancelled);
  const running = mine.filter((s) => s.start <= today && today <= s.end).sort((a, b) => a.end.localeCompare(b.end));
  const usable = running.find((s) => !s.visits || s.used < s.visits);
  if (usable) return usable;
  if (running.length) return running[running.length - 1];
  const upcoming = mine.filter((s) => s.start > today).sort((a, b) => a.start.localeCompare(b.start));
  if (upcoming.length) return upcoming[0];
  return mine.sort((a, b) => b.end.localeCompare(a.end))[0] || null;
}

/**
 * { status, sub, daysLeft, visitsLeft, soon }
 * status: active | frozen | upcoming | expired | none
 */
function memberStatus(subs, today) {
  const sub = currentSub(subs, today);
  if (!sub) return { status: 'none', sub: null, daysLeft: 0, visitsLeft: null, soon: false };
  const visitsLeft = sub.visits ? Math.max(0, sub.visits - sub.used) : null;
  const daysLeft = D.daysBetween(today, sub.end) + 1; // today counts
  if (sub.start > today) return { status: 'upcoming', sub, daysLeft, visitsLeft, soon: false };
  if (sub.end < today || visitsLeft === 0) return { status: 'expired', sub, daysLeft: Math.min(0, daysLeft), visitsLeft, soon: false, since: sub.end < today ? sub.end : '' };
  if (isFrozen(sub, today)) return { status: 'frozen', sub, daysLeft, visitsLeft, soon: false };
  const soon = daysLeft <= SOON_DAYS || (visitsLeft !== null && visitsLeft <= 2);
  return { status: 'active', sub, daysLeft, visitsLeft, soon };
}

/** Freeze a subscription for `days` days starting `from`; the end date moves back. */
function freezeSub(sub, from, days) {
  const n = Math.max(1, Math.min(180, Math.round(Number(days) || 0)));
  const to = D.addDays(from, n - 1);
  if ((sub.freezes || []).some((f) => !(to < f.from || from > f.to))) return { error: 'overlap' };
  sub.freezes = [...(sub.freezes || []), { from, to, days: n }];
  sub.end = D.addDays(sub.end, n);
  return { sub };
}

/** End the current freeze today; unused frozen days are taken back off the end date. */
function unfreezeSub(sub, today) {
  const f = (sub.freezes || []).find((x) => x.from <= today && today <= x.to);
  if (!f) return { error: 'not_frozen' };
  const unused = D.daysBetween(today, f.to) + 1; // today is no longer frozen
  const usedDays = f.days - unused;
  sub.end = D.addDays(sub.end, -unused);
  if (usedDays <= 0) sub.freezes = sub.freezes.filter((x) => x !== f);
  else Object.assign(f, { to: D.addDays(today, -1), days: usedDays });
  return { sub };
}

// ---------- check-in ----------

/**
 * Decide whether a member may come in. Pure: returns what to record.
 * { ok, duplicate, reason, state, countVisit }
 */
function evaluateCheckIn({ subs, checkins, now, graceDays = 0 }) {
  const state = memberStatus(subs, now.date);
  const recent = checkins.find((c) => c.ok && c.date === now.date && Math.abs(c.minutes - now.minutes) < DUPLICATE_MINUTES);
  if (recent) return { ok: true, duplicate: true, reason: '', state, countVisit: false };
  if (state.status === 'active') return { ok: true, duplicate: false, reason: '', state, countVisit: !!state.sub.visits };
  if (state.status === 'expired' && state.since && graceDays > 0 && D.daysBetween(state.since, now.date) <= graceDays) {
    return { ok: true, duplicate: false, reason: 'grace', state, countVisit: false };
  }
  const reason = { frozen: 'frozen', upcoming: 'not_started', none: 'no_plan' }[state.status] || (state.visitsLeft === 0 ? 'no_visits' : 'expired');
  return { ok: false, duplicate: false, reason, state, countVisit: false };
}

// ---------- messages ----------
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

function fill(template, vars) {
  return Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), template);
}

/** Sent to a member when they join or renew: their plan and card link. */
function welcomeMessage(member, sub, settings, cardUrl) {
  const t = strings(settings.lang);
  const lines = [fill(t.msgWelcome, { name: firstName(member.name), gym: settings.name })];
  if (sub) lines.push('', `${sub.emoji || '💪'} ${sub.planName}`, `🗓️ ${dateLabel(sub.start, settings.lang)} → ${dateLabel(sub.end, settings.lang)}`);
  if (sub && sub.visits) lines.push(`🎟️ ${sub.visits} ${t.visits}`);
  if (cardUrl) lines.push('', `${t.msgYourCard}:`, cardUrl);
  return lines.join('\n');
}

/** Renewal reminder, before or after expiry. */
function renewalMessage(member, sub, settings, cardUrl, today) {
  const t = strings(settings.lang);
  const ended = sub.end < today;
  const key = ended ? 'msgRenewExpired' : 'msgRenewSoon';
  const lines = [fill(t[key], { name: firstName(member.name), plan: sub.planName, gym: settings.name, date: dateLabel(sub.end, settings.lang) })];
  if (cardUrl) lines.push('', cardUrl);
  return lines.join('\n');
}

/** Join request from the public page, sent to the gym's WhatsApp / Telegram. */
function leadMessage(lead, settings) {
  const t = strings(settings.lang);
  const out = [`🙋 *${t.msgNewLead}*`, `🏋️ ${settings.name}`, '━━━━━━━━━━', `👤 ${lead.name}`, `📞 ${lead.phone}`];
  if (lead.planName) out.push(`${lead.emoji || '💪'} ${lead.planName}`);
  if (lead.message) out.push(`📝 ${lead.message}`);
  return out.join('\n');
}

function whatsappUrl(number, text) {
  const digits = String(number || '').replace(/\D/g, '');
  const q = `text=${encodeURIComponent(text)}`;
  return digits ? `https://wa.me/${digits}?${q}` : `https://wa.me/?${q}`;
}

module.exports = {
  PAY_METHODS,
  SOON_DAYS,
  round2,
  formatMoney,
  dateLabel,
  planEnd,
  planLength,
  buildSub,
  isFrozen,
  currentSub,
  memberStatus,
  freezeSub,
  unfreezeSub,
  evaluateCheckIn,
  welcomeMessage,
  renewalMessage,
  leadMessage,
  whatsappUrl,
};
