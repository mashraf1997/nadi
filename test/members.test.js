'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/members');
const D = require('../src/dates');

const plan = (o) => ({ id: 'p', name: 'Plan', emoji: '💪', price: 100, months: 1, days: 0, visits: 0, ...o });

test('plan end dates are inclusive and handle month ends', () => {
  assert.equal(M.planEnd(plan(), '2026-11-01'), '2026-11-30');
  assert.equal(M.planEnd(plan({ months: 3 }), '2026-11-15'), '2027-02-14');
  assert.equal(M.planEnd(plan(), '2026-01-31'), '2026-02-27', 'Jan 31 + 1 month → Feb 28, inclusive end the day before');
  assert.equal(M.planEnd(plan({ months: 0, days: 1 }), '2026-11-01'), '2026-11-01', 'day pass');
  assert.equal(M.planEnd(plan({ months: 0, days: 0 }), '2026-11-01'), '2026-11-30', 'no length → 30 days');
  assert.equal(M.planEnd(plan({ months: 1, days: 7 }), '2026-11-01'), '2026-12-07');
});

test('status: active, soon, upcoming, expired, none', () => {
  const sub = M.buildSub(plan(), 'm1', { start: '2026-11-01' });
  assert.equal(M.memberStatus([], '2026-11-10').status, 'none');
  let st = M.memberStatus([sub], '2026-11-10');
  assert.equal(st.status, 'active');
  assert.equal(st.daysLeft, 21);
  assert.equal(st.soon, false);
  st = M.memberStatus([sub], '2026-11-27');
  assert.equal(st.soon, true);
  assert.equal(st.daysLeft, 4);
  assert.equal(M.memberStatus([sub], '2026-11-30').daysLeft, 1, 'last day still counts');
  st = M.memberStatus([sub], '2026-12-01');
  assert.equal(st.status, 'expired');
  assert.equal(st.since, '2026-11-30');
  assert.equal(M.memberStatus([sub], '2026-10-31').status, 'upcoming');
  // An early renewal queued after the current plan keeps the member active.
  const next = M.buildSub(plan(), 'm1', { start: '2026-12-01' });
  assert.equal(M.memberStatus([sub, next], '2026-11-20').sub, sub);
  assert.equal(M.memberStatus([sub, next], '2026-12-05').sub, next);
  assert.equal(M.memberStatus([{ ...sub, cancelled: true }], '2026-11-10').status, 'none');
});

test('visit packs run out', () => {
  const sub = M.buildSub(plan({ visits: 3, months: 2 }), 'm1', { start: '2026-11-01' });
  let st = M.memberStatus([sub], '2026-11-02');
  assert.equal(st.visitsLeft, 3);
  sub.used = 2;
  st = M.memberStatus([sub], '2026-11-02');
  assert.equal(st.soon, true, 'two or fewer visits left counts as ending soon');
  sub.used = 3;
  st = M.memberStatus([sub], '2026-11-02');
  assert.equal(st.status, 'expired');
  assert.equal(st.visitsLeft, 0);
});

test('freezing moves the end date; unfreezing early gives the days back', () => {
  const sub = M.buildSub(plan(), 'm1', { start: '2026-11-01' });
  assert.ok(M.freezeSub(sub, '2026-11-10', 10).sub);
  assert.equal(sub.end, '2026-12-10');
  assert.equal(M.memberStatus([sub], '2026-11-12').status, 'frozen');
  assert.equal(M.freezeSub(sub, '2026-11-15', 3).error, 'overlap');
  // Back after 4 frozen days: the 6 unused days come off the end again.
  assert.ok(M.unfreezeSub(sub, '2026-11-14').sub);
  assert.equal(sub.end, '2026-12-04');
  assert.deepEqual(sub.freezes, [{ from: '2026-11-10', to: '2026-11-13', days: 4 }]);
  assert.equal(M.memberStatus([sub], '2026-11-14').status, 'active');
  // Unfreezing on the first frozen day removes the freeze entirely.
  const s2 = M.buildSub(plan(), 'm2', { start: '2026-11-01' });
  M.freezeSub(s2, '2026-11-05', 7);
  M.unfreezeSub(s2, '2026-11-05');
  assert.equal(s2.end, '2026-11-30');
  assert.deepEqual(s2.freezes, []);
  assert.equal(M.unfreezeSub(s2, '2026-11-06').error, 'not_frozen');
});

test('check-in rules: duplicates, grace period, reasons', () => {
  const sub = M.buildSub(plan({ visits: 10 }), 'm1', { start: '2026-11-01' });
  const now = { date: '2026-11-05', minutes: 18 * 60 };
  let r = M.evaluateCheckIn({ subs: [sub], checkins: [], now });
  assert.equal(r.ok, true);
  assert.equal(r.countVisit, true);
  r = M.evaluateCheckIn({ subs: [sub], checkins: [{ ok: true, date: now.date, minutes: now.minutes - 10 }], now });
  assert.equal(r.duplicate, true, 'a second scan within 30 minutes is not a new visit');
  assert.equal(r.countVisit, false);
  r = M.evaluateCheckIn({ subs: [sub], checkins: [{ ok: true, date: now.date, minutes: now.minutes - 120 }], now });
  assert.equal(r.duplicate, false, 'coming back later the same day counts again');

  const later = { date: '2026-12-02', minutes: 600 };
  assert.equal(M.evaluateCheckIn({ subs: [sub], checkins: [], now: later }).reason, 'expired');
  r = M.evaluateCheckIn({ subs: [sub], checkins: [], now: later, graceDays: 3 });
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'grace');
  assert.equal(M.evaluateCheckIn({ subs: [sub], checkins: [], now: { date: '2026-12-05', minutes: 600 }, graceDays: 3 }).ok, false);
  assert.equal(M.evaluateCheckIn({ subs: [], checkins: [], now }).reason, 'no_plan');
  M.freezeSub(sub, '2026-11-05', 5);
  assert.equal(M.evaluateCheckIn({ subs: [sub], checkins: [], now }).reason, 'frozen');
  sub.freezes = [];
  sub.used = 10;
  assert.equal(M.evaluateCheckIn({ subs: [sub], checkins: [], now }).reason, 'no_visits');
});

test('messages and helpers', () => {
  const settings = { name: 'Iron House', lang: 'en', currency: '$' };
  const member = { name: 'Omar Hassan', phone: '0101' };
  const sub = M.buildSub(plan({ name: '3 months', months: 3 }), 'm1', { start: '2026-11-01' });
  assert.match(M.welcomeMessage(member, sub, settings, 'https://g/m/x'), /Welcome to Iron House, Omar!/);
  assert.match(M.renewalMessage(member, sub, settings, 'https://g/m/x', '2026-11-20'), /ends on/);
  assert.match(M.renewalMessage(member, sub, settings, '', '2027-03-01'), /We miss you/);
  assert.match(M.leadMessage({ name: 'Reem', phone: '011', planName: 'Monthly' }, settings), /New join request/);
  assert.equal(M.formatMoney(1200, 'EGP'), '1200 EGP');
  assert.equal(M.formatMoney(25.5, '$'), '$25.50');
  assert.equal(M.planLength(plan({ visits: 12, months: 2 }), { month1: 'month', months: 'months', day1: 'day', days: 'days', visits: 'visits' }), '12 visits · 2 months');
  assert.equal(D.isOpen(Array(7).fill({ open: true, from: '06:00', to: '23:00' }), { date: '2026-11-02', minutes: 5 * 60 }), false);
});
