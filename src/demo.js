'use strict';

// Demo mode: a public, self-resetting showcase (DEMO_MODE=true).

const auth = require('./auth');
const D = require('./dates');
const M = require('./members');
const { loadSample } = require('./sample');

const DEMO_PASSWORD = 'demo1234';

function demoConfig(env = process.env) {
  if (!/^(1|true|yes)$/i.test(env.DEMO_MODE || '')) return null;
  return {
    password: env.DEMO_PASSWORD || DEMO_PASSWORD,
    resetMinutes: Math.max(5, Number(env.DEMO_RESET_MINUTES) || 60),
    lang: env.DEMO_LANG || 'en',
    type: env.DEMO_TYPE || 'gym',
  };
}

function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

const FIRST = ['Adam', 'Omar', 'Ali', 'Karim', 'Youssef', 'Hassan', 'Ziad', 'Malek', 'Tarek', 'Sami', 'Maya', 'Lina', 'Hana', 'Nour', 'Yara', 'Salma', 'Dina', 'Mona', 'Rana', 'Farah'];
const LAST = ['Hassan', 'Adel', 'Fouad', 'Nabil', 'Saleh', 'Kamal', 'Rashed', 'Mansour', 'Haddad', 'Farouk'];
const FIRST_AR = ['آدم', 'عمر', 'علي', 'كريم', 'يوسف', 'حسن', 'زياد', 'مالك', 'طارق', 'سامي', 'مايا', 'لينا', 'هنا', 'نور', 'يارا', 'سلمى', 'دينا', 'منى', 'رنا', 'فرح'];
const LAST_AR = ['حسن', 'عادل', 'فؤاد', 'نبيل', 'صالح', 'كمال', 'راشد', 'منصور', 'حداد', 'فاروق'];

// Busy before work and in the evening.
const HOURS = [6, 7, 7, 8, 9, 12, 16, 17, 18, 18, 19, 19, 19, 20, 20, 21, 22];

/** Members in every state, with payments and a month of check-ins. */
function seedMembers(store, today, count = 64) {
  const r = rng(7);
  const ar = store.settings.lang === 'ar';
  const first = ar ? FIRST_AR : FIRST;
  const last = ar ? LAST_AR : LAST;
  const plans = store.sorted('plans');
  const timePlans = plans.filter((p) => !p.visits && (p.months || p.days > 1));
  const visitPlans = plans.filter((p) => p.visits > 1);
  const methods = ['cash', 'cash', 'cash', 'card', 'wallet', 'transfer'];

  for (let i = 0; i < count; i++) {
    const fi = Math.floor(r() * first.length);
    const m = store.addMember(
      {
        name: `${first[fi]} ${last[Math.floor(r() * last.length)]}`,
        phone: `010${String(10000000 + Math.floor(r() * 89999999))}`,
        gender: fi < 10 ? 'm' : 'f',
        birthday: '',
        notes: '',
        photo: '',
      },
      { save: false }
    );
    const joinedDaysAgo = Math.floor(r() * 300);
    m.createdAt = new Date(Date.now() - joinedDaysAgo * 864e5).toISOString();

    // Mix: mostly active, some ending soon, some lapsed, a few frozen / visit packs.
    const roll = r();
    const plan = roll < 0.18 && visitPlans.length ? visitPlans[Math.floor(r() * visitPlans.length)] : timePlans[Math.floor(r() * timePlans.length)] || plans[0];
    let start;
    if (roll < 0.12) start = D.addDays(today, -Math.floor(40 + r() * 60)); // lapsed
    else if (roll < 0.24) start = D.addDays(D.addMonths(today, -Math.max(1, plan.months || 1)), Math.floor(1 + r() * 6)); // ending this week
    else start = D.addDays(today, -Math.floor(r() * 25));
    const sub = store.addRecord('subs', M.buildSub(plan, m.id, { start }), { save: false });
    const partly = r() < 0.12;
    const paid = partly ? M.round2(sub.price / 2) : sub.price;
    if (paid > 0) store.addRecord('payments', { memberId: m.id, subId: sub.id, amount: paid, method: methods[Math.floor(r() * methods.length)], date: start <= today ? start : today, note: '' }, { save: false });
    if (roll > 0.94 && sub.end > today) M.freezeSub(sub, D.addDays(today, -2), 10);

    // Check-ins: regulars come 3–5 times a week.
    const perWeek = 1 + r() * 4;
    const from = sub.start > D.addDays(today, -30) ? sub.start : D.addDays(today, -30);
    for (let day = from; day <= today && day <= sub.end; day = D.addDays(day, 1)) {
      if (M.isFrozen(sub, day) || r() > perWeek / 7) continue;
      if (sub.visits && sub.used >= sub.visits) break;
      const h = HOURS[Math.floor(r() * HOURS.length)];
      const minutes = h * 60 + Math.floor(r() * 60);
      if (day === today && minutes > 21 * 60) continue;
      store.addRecord('checkins', { memberId: m.id, date: day, minutes, source: r() < 0.6 ? 'kiosk' : 'desk', ok: true, reason: '', subId: sub.id }, { save: false });
      if (sub.visits) sub.used++;
    }
  }
  store.checkins.sort((a, b) => a.date.localeCompare(b.date) || a.minutes - b.minutes);
  // A couple of people asked to join from the website.
  const leads = ar ? [['هشام سعيد', '01001234567'], ['ريم أحمد', '01112223344']] : [['Hisham Saeed', '+1 415 555 0142'], ['Reem Ahmed', '+1 415 555 0177']];
  leads.forEach(([name, phone], i) => {
    const p = plans[i % plans.length];
    store.db.leads.push({ id: `lead${i}`, name, phone, planId: p.id, planName: p.name, emoji: p.emoji, message: '', createdAt: new Date(Date.now() - (i + 1) * 3 * 3600e3).toISOString(), handled: false });
  });
}

function resetDemo(store, cfg, now = () => D.nowIn(store.settings.timezone)) {
  store.reset();
  const ar = cfg.lang === 'ar';
  store.updateSettings({
    name: ar ? 'آيرون هاوس' : 'Iron House Gym',
    lang: cfg.lang,
    currency: ar ? 'ج.م' : '$',
    whatsapp: '',
    color: '#ea580c',
    theme: 'bold',
    font: 'cairo',
    phone: '+1 415 555 0100',
    address: ar ? 'شارع 9، المعادي' : '12 Market St',
    instagram: '@nadi',
    hours: Array.from({ length: 7 }, (_, i) => ({ open: true, from: i === 5 ? '14:00' : '06:00', to: '23:00' })),
    policy: ar ? 'من فضلك امسح الكارت بتاعك على الباب كل مرة.' : 'Please scan your card at the door every visit.',
  });
  store.db.auth = auth.hashPassword(cfg.password);
  store.db.setupDone = true;
  loadSample(store, cfg.type, cfg.lang);
  seedMembers(store, now().date);
  store.save();
  for (const k of ['members', 'subs', 'payments', 'checkins']) store.saveList(k);
  store.flushStats(true);
}

module.exports = { demoConfig, resetDemo, seedMembers, DEMO_PASSWORD };
