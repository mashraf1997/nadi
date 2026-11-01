'use strict';

// Sample plans and class timetable per type of gym, so a fresh install looks
// alive. Text is in English and Arabic; other languages use English.
// Plan: [key, emoji, months, days, visits, priceEN, priceAR, featured]
// Class: [key, days of week, "HH:MM", minutes, coach key]

const TYPES = {
  gym: {
    plans: [
      ['month', '💪', 1, 0, 0, 30, 900, false],
      ['quarter', '🔥', 3, 0, 0, 80, 2400, true],
      ['year', '🏆', 12, 0, 0, 270, 8000, false],
      ['pass10', '🎟️', 2, 0, 10, 25, 700, false],
      ['day', '☀️', 0, 1, 0, 5, 120, false],
    ],
    classes: [
      ['hiit', [0, 2, 4], '19:00', 45, 'coachA'],
      ['spin', [1, 3], '08:00', 45, 'coachB'],
      ['core', [6], '11:00', 30, 'coachA'],
    ],
    text: {
      en: {
        tagline: 'Train hard. Feel good. Open 6 am – 11 pm.',
        coachA: 'Coach Omar', coachB: 'Coach Mona',
        month: ['Monthly', 'Full gym access, lockers & showers'], quarter: ['3 months', 'Save 10% · free InBody check'], year: ['Annual', 'Best value · 2 free PT sessions'], pass10: ['10-visit pass', 'Come when you can, valid 2 months'], day: ['Day pass', 'Try us for a day'],
        hiit: 'HIIT', spin: 'Spinning', core: 'Core & stretch',
      },
      ar: {
        tagline: 'اتمرّن جامد، وحس إنك أحسن. مفتوحين من 6 الصبح لـ 11 بالليل.',
        coachA: 'كابتن عمر', coachB: 'كابتن منى',
        month: ['اشتراك شهر', 'الجيم كله، ولوكر وشاور'], quarter: ['3 شهور', 'وفّر 10% · قياس InBody ببلاش'], year: ['سنة', 'أوفر اشتراك · حصتين PT ببلاش'], pass10: ['كارنيه 10 مرات', 'تعالى وقت ما تقدر، صالح شهرين'], day: ['يوم واحد', 'جرّبنا يوم'],
        hiit: 'HIIT', spin: 'سبينينج', core: 'كور وإطالة',
      },
    },
  },
  studio: {
    plans: [
      ['pass8', '🧘', 1, 0, 8, 60, 1200, true],
      ['unlimited', '✨', 1, 0, 0, 95, 1900, false],
      ['pass20', '🌿', 3, 0, 20, 140, 2800, false],
      ['drop', '🌸', 0, 1, 1, 12, 250, false],
    ],
    classes: [
      ['flow', [0, 2, 4], '09:00', 60, 'coachA'],
      ['pilates', [1, 3], '18:30', 50, 'coachB'],
      ['yin', [5], '10:00', 75, 'coachA'],
      ['flow2', [6], '11:00', 60, 'coachB'],
    ],
    text: {
      en: {
        tagline: 'Yoga & Pilates for every body',
        coachA: 'Lina', coachB: 'Sara',
        pass8: ['8 classes / month', 'Any class on the timetable'], unlimited: ['Unlimited monthly', 'Come as often as you like'], pass20: ['20-class pack', 'Valid 3 months'], drop: ['Drop-in', 'One class'],
        flow: 'Vinyasa flow', pilates: 'Mat Pilates', yin: 'Yin & breath', flow2: 'Weekend flow',
      },
      ar: {
        tagline: 'يوجا وبيلاتس لكل الناس',
        coachA: 'لينا', coachB: 'سارة',
        pass8: ['8 حصص في الشهر', 'أي حصة في الجدول'], unlimited: ['شهر مفتوح', 'تعالي براحتك'], pass20: ['باكدج 20 حصة', 'صالحة 3 شهور'], drop: ['حصة واحدة', 'جرّبي حصة'],
        flow: 'فينياسا فلو', pilates: 'بيلاتس', yin: 'يين وتنفس', flow2: 'فلو الويك إند',
      },
    },
  },
  martial: {
    plans: [
      ['month', '🥊', 1, 0, 0, 45, 1000, true],
      ['pass12', '🥋', 1, 0, 12, 40, 850, false],
      ['quarter', '🔥', 3, 0, 0, 120, 2700, false],
    ],
    classes: [
      ['boxing', [0, 2, 4], '20:00', 60, 'coachA'],
      ['kick', [1, 3], '20:00', 60, 'coachB'],
      ['kids', [5, 6], '17:00', 45, 'coachB'],
    ],
    text: {
      en: {
        tagline: 'Boxing, kickboxing & self-defence',
        coachA: 'Coach Karim', coachB: 'Coach Ali',
        month: ['Monthly', 'All classes'], pass12: ['12 sessions', 'Valid one month'], quarter: ['3 months', 'All classes, save 10%'],
        boxing: 'Boxing', kick: 'Kickboxing', kids: 'Kids self-defence',
      },
      ar: {
        tagline: 'بوكس وكيك بوكسينج ودفاع عن النفس',
        coachA: 'كابتن كريم', coachB: 'كابتن علي',
        month: ['اشتراك شهر', 'كل التمارين'], pass12: ['12 تمرينة', 'صالحين شهر'], quarter: ['3 شهور', 'كل التمارين ووفّر 10%'],
        boxing: 'بوكس', kick: 'كيك بوكسينج', kids: 'دفاع عن النفس للأطفال',
      },
    },
  },
  academy: {
    plans: [
      ['month', '⚽', 1, 0, 8, 40, 800, true],
      ['term', '🏅', 3, 0, 24, 110, 2200, false],
      ['trial', '⭐', 0, 7, 1, 0, 0, false],
    ],
    classes: [
      ['u8', [0, 3], '16:00', 60, 'coachA'],
      ['u12', [1, 4], '17:00', 75, 'coachA'],
      ['u16', [2, 5], '18:30', 90, 'coachB'],
    ],
    text: {
      en: {
        tagline: 'Football academy for ages 5–16',
        coachA: 'Coach Youssef', coachB: 'Coach Adam',
        month: ['Monthly · 8 sessions', 'Twice a week, kit included'], term: ['Term · 24 sessions', 'Valid 3 months'], trial: ['Free trial', 'One session to try'],
        u8: 'Under 8', u12: 'Under 12', u16: 'Under 16',
      },
      ar: {
        tagline: 'أكاديمية كورة للأطفال من 5 لـ 16 سنة',
        coachA: 'كابتن يوسف', coachB: 'كابتن آدم',
        month: ['شهر · 8 تمرينات', 'مرتين في الأسبوع، واللبس معانا'], term: ['ترم · 24 تمرينة', 'صالح 3 شهور'], trial: ['تمرينة تجريبية', 'ببلاش'],
        u8: 'تحت 8 سنين', u12: 'تحت 12 سنة', u16: 'تحت 16 سنة',
      },
    },
  },
};

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

function loadSample(store, type, lang) {
  const def = TYPES[type] || TYPES.gym;
  const ar = lang === 'ar';
  const text = def.text[ar ? 'ar' : 'en'];
  if (!store.settings.tagline) store.updateSettings({ tagline: text.tagline });
  for (const [key, emoji, months, days, visits, priceEn, priceAr, featured] of def.plans) {
    const [name, description] = text[key];
    store.add('plans', { name, description, emoji, months, days, visits, price: ar ? priceAr : priceEn, public: true, featured }, { save: false });
  }
  for (const [key, weekdays, time, minutes, coach] of def.classes) {
    for (const day of weekdays) {
      store.add('classes', { day, start: toMin(time), end: toMin(time) + minutes, title: text[key], coach: text[coach] }, { save: false });
    }
  }
  store.save();
}

module.exports = { loadSample, GYM_TYPES: Object.keys(TYPES) };
