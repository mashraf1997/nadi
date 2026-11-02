'use strict';

const { strings } = require('./i18n');
const { cleanTheme, fontHref, fontStack, hueFor } = require('./theme');
const D = require('./dates');
const M = require('./members');

const VERSION = require('../package.json').version;
const ICONS = `/img/icons.svg?v=${VERSION}`;

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineJson(data) {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#ea580c');
const safeUrl = (u) => (/^(https?:\/\/|\/uploads\/)/i.test(String(u || '').trim()) ? String(u).trim() : '');
const initials = (name) => (String(name || '?').trim()[0] || '?').toUpperCase();
const icon = (name, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="${ICONS}#i-${name}"/></svg>`;
const fill = (s, vars) => Object.entries(vars).reduce((out, [k, v]) => out.split(`{${k}}`).join(v), s);

function timeLabel(minutes, lang) {
  const d = new Date(Date.UTC(2024, 0, 1, Math.floor(minutes / 60) % 24, minutes % 60));
  try {
    return new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(d);
  } catch {
    return D.fmtTime(minutes);
  }
}
const weekdayName = (i, lang, style = 'long') => new Intl.DateTimeFormat(lang, { weekday: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + i)));

function socialUrl(kind, value) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  const h = encodeURIComponent(v.replace(/^@/, ''));
  return { instagram: `https://instagram.com/${h}`, facebook: `https://facebook.com/${h}`, tiktok: `https://www.tiktok.com/@${h}` }[kind];
}

/** "Open now · 6:00 AM – 11:00 PM" style status from weekly hours. */
function openStatus(s, t, lang, now) {
  const day = (s.hours || [])[D.dayOfWeek(now.date)];
  const open = D.isOpen(s.hours || [], now);
  if (!day || !day.open) return { open, text: open ? t.openNow : t.closedToday };
  return { open, text: `${open ? t.openNow : t.closedNow} · ${timeLabel(D.toMin(day.from), lang)} – ${timeLabel(D.toMin(day.to), lang)}` };
}

function head({ s, lang, t, title, description, baseUrl, extra = '', robots = '' }) {
  const color = safeColor(s.color);
  const logo = safeUrl(s.logo);
  const og = safeUrl(s.cover) || logo;
  return `<!doctype html>
<html lang="${esc(lang)}" dir="${t.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="${color}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
${og && baseUrl ? `<meta property="og:image" content="${esc(baseUrl + og.replace(/^\//, ''))}">` : ''}
${robots ? `<meta name="robots" content="${robots}">` : ''}
${extra}
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="${logo ? esc(logo) : '/img/icon.svg'}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" id="font-css" href="${esc(fontHref(s.font, lang))}">
<link rel="stylesheet" href="/css/gym.css?v=${VERSION}">
<style id="vars">:root{--brand:${color};--font:${fontStack(s.font)}}</style>
</head>`;
}

function gymHeader({ s, t, lang, now, languages }) {
  const cover = safeUrl(s.cover);
  const logo = safeUrl(s.logo);
  const status = openStatus(s, t, lang, now);
  const digits = String(s.whatsapp || '').replace(/\D/g, '');
  const mapUrl = safeUrl(s.mapUrl);
  const quick = [
    digits && `<a class="qa wa" href="https://wa.me/${esc(digits)}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('whatsapp')}</a>`,
    s.phone && `<a class="qa" href="tel:${esc(s.phone)}" aria-label="${esc(t.call)}">${icon('phone')}</a>`,
    mapUrl && `<a class="qa" href="${esc(mapUrl)}" target="_blank" rel="noopener" aria-label="${esc(t.directions)}">${icon('pin')}</a>`,
    s.instagram && `<a class="qa" href="${esc(socialUrl('instagram', s.instagram))}" target="_blank" rel="noopener" aria-label="Instagram">${icon('instagram')}</a>`,
    s.tiktok && `<a class="qa" href="${esc(socialUrl('tiktok', s.tiktok))}" target="_blank" rel="noopener" aria-label="TikTok">${icon('tiktok')}</a>`,
    `<button class="qa" type="button" id="share" aria-label="${esc(t.share)}">${icon('share')}</button>`,
  ].filter(Boolean);
  const langMenu = languages.length > 1
    ? `<label class="lang">${icon('globe')}<select id="lang" aria-label="${esc(t.language)}">${languages
        .map((l) => `<option value="${esc(l.code)}"${l.code === lang ? ' selected' : ''}>${esc(l.name)}</option>`)
        .join('')}</select></label>`
    : '';
  return `<header class="hero">
  <div class="cover${cover ? ' has-img' : ''}" id="cover">${cover ? `<img src="${esc(cover)}" alt="" fetchpriority="high">` : ''}
    <div class="topbar">${langMenu}</div>
  </div>
  <div class="shop-card">
    <div class="logo" id="logo">${logo ? `<img src="${esc(logo)}" alt="">` : `<span>${esc(initials(s.name))}</span>`}</div>
    <h1>${esc(s.name)}</h1>
    ${s.tagline ? `<p class="tagline">${esc(s.tagline)}</p>` : ''}
    <p class="status ${status.open ? 'open' : 'closed'}"><span class="dot"></span>${icon('clock', 'i xs')}${esc(status.text)}</p>
    <div class="quick">${quick.join('')}</div>
  </div>
</header>`;
}

function footer({ s, t, lang }) {
  const days = (s.hours || []).map((d, i) => `<li><span>${esc(weekdayName(i, lang))}</span><b>${d.open ? `${esc(timeLabel(D.toMin(d.from), lang))} – ${esc(timeLabel(D.toMin(d.to), lang))}` : `<i>${esc(t.closedDay)}</i>`}</b></li>`);
  return `<footer class="footer">
  <section class="info-card">
    <h3>${icon('clock')}${esc(t.hours)}</h3>
    <ul class="hours">${days.join('')}</ul>
    ${s.address ? `<p class="addr">${icon('pin')}${safeUrl(s.mapUrl) ? `<a href="${esc(safeUrl(s.mapUrl))}" target="_blank" rel="noopener">${esc(s.address)}</a>` : esc(s.address)}</p>` : ''}
  </section>
  ${s.about || s.policy ? `<section class="info-card">${s.about ? `<p>${esc(s.about)}</p>` : ''}${s.policy ? `<h3>${icon('file')}${esc(t.policy)}</h3><p class="muted">${esc(s.policy)}</p>` : ''}</section>` : ''}
  ${powered(s, t)}
</footer>`;
}

function planCard(p, s, t) {
  return `<article class="plan${p.featured ? ' featured' : ''}" style="--h:${hueFor(p.name)}">
    ${p.featured ? `<span class="plan-badge">${icon('star', 'i xs')}${esc(t.mostPopular)}</span>` : ''}
    <div class="plan-top"><span class="tile">${esc(p.emoji || initials(p.name))}</span>
      <div><h3>${esc(p.name)}</h3>${M.planLength(p, t) !== p.name ? `<span class="plan-len">${esc(M.planLength(p, t))}</span>` : ''}</div></div>
    ${p.description ? `<p class="plan-desc">${esc(p.description)}</p>` : ''}
    <div class="plan-foot">
      ${s.showPrices ? `<b class="plan-price">${Number(p.price) ? esc(M.formatMoney(p.price, s.currency)) : esc(t.free)}</b>` : '<span></span>'}
      ${s.acceptingJoins ? `<button type="button" class="btn sm" data-join="${esc(p.id)}">${esc(t.join)}</button>` : ''}
    </div>
  </article>`;
}

function timetable(classes, t, lang, today) {
  if (!classes.length) return '';
  const todayIdx = D.dayOfWeek(today);
  const order = Array.from({ length: 7 }, (_, i) => (todayIdx + i) % 7);
  const byDay = new Map(order.map((d) => [d, classes.filter((c) => c.day === d)]));
  const tabs = order
    .map((d, i) => `<button type="button" role="tab" class="tt-day${i === 0 ? ' on' : ''}${byDay.get(d).length ? '' : ' none'}" data-day="${d}" aria-selected="${i === 0}"><small>${esc(i === 0 ? t.today : weekdayName(d, lang, 'short'))}</small><b>${byDay.get(d).length || '–'}</b></button>`)
    .join('');
  const lists = order
    .map((d, i) => {
      const list = byDay.get(d);
      return `<ul class="tt-list" data-list="${d}"${i === 0 ? '' : ' hidden'}>${
        list.length
          ? list.map((c) => `<li style="--h:${hueFor(c.title)}"><span class="tt-time"><b>${esc(timeLabel(c.start, lang))}</b><small>${esc(timeLabel(c.end, lang))}</small></span><span class="tt-body"><b>${esc(c.title)}</b>${c.coach ? `<small>${icon('user', 'i xs')}${esc(c.coach)}</small>` : ''}</span><span class="tt-dur">${c.end - c.start} ${esc(t.min)}</span></li>`).join('')
          : `<li class="tt-empty">${esc(t.noClassesDay)}</li>`
      }</ul>`;
    })
    .join('');
  return `<section class="section" id="timetable"><h2>${icon('calendar')}${esc(t.timetable)}</h2><div class="tt-days" role="tablist">${tabs}</div>${lists}</section>`;
}

function renderGymPage({ settings: s, plans, classes, lang, baseUrl, now, demo = false, preview = false, languages = [] }) {
  const t = strings(lang);
  const theme = cleanTheme(s.theme);
  const clientData = {
    lang,
    t,
    icons: ICONS,
    preview,
    gym: { name: s.name, whatsapp: s.whatsapp, accepting: !!s.acceptingJoins },
    plans: plans.map((p) => ({ id: p.id, name: p.name, emoji: p.emoji || '', length: M.planLength(p, t), price: s.showPrices ? M.formatMoney(p.price, s.currency) : '' })),
  };
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ExerciseGym',
    name: s.name,
    description: s.tagline || s.about || '',
    url: baseUrl,
    ...(s.address ? { address: s.address } : {}),
    ...(s.phone ? { telephone: s.phone } : {}),
  };
  return `${head({
    s,
    lang,
    t,
    title: `${s.name}${s.tagline ? ` — ${s.tagline}` : ''}`,
    description: s.tagline || s.about || s.name,
    baseUrl,
    robots: preview ? 'noindex' : '',
    extra: `${preview ? '' : languages.map((l) => `<link rel="alternate" hreflang="${esc(l.code)}" href="${esc(baseUrl)}?lang=${esc(l.code)}">`).join('\n')}
<script type="application/ld+json">${inlineJson(jsonLd)}</script>`,
  })}
<body class="theme-${theme}">
${gymHeader({ s, t, lang, now, languages })}
${demo ? `<div class="notice demo" role="note">${icon('sparkles')}<span>${esc(t.demoBanner)}</span></div>` : ''}
<main class="flow">
  <section class="section" id="plans">
    <h2>${icon('tag')}${esc(t.plans)}</h2>
    ${plans.length ? `<div class="plans">${plans.map((p) => planCard(p, s, t)).join('')}</div>` : `<p class="empty">${esc(t.noPlans)}</p>`}
    ${s.acceptingJoins ? `<button type="button" class="btn ghost block" data-join="">${icon('sparkles')}${esc(t.notSure)}</button>` : ''}
  </section>
  ${timetable(classes, t, lang, now.date)}
</main>
${footer({ s, t, lang })}
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script>window.NADI=${inlineJson(clientData)};</script>
<script src="/js/gym.js?v=${VERSION}" defer></script>
</body>
</html>`;
}

/** A member's digital membership card: show the QR at the door. */
/** "Powered by" line; agencies can rename it or hide it (white-label). */
function powered(s, t) {
  const b = s._brand;
  if (b && b.hideBranding) return '';
  if (b && b.name) {
    const u = safeUrl(b.url);
    return `<p class="powered">${esc(t.poweredBy)} ${u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(b.name)}</a>` : esc(b.name)}</p>`;
  }
  return `<p class="powered">${esc(t.poweredBy)} <a href="https://github.com/mashraf1997/nadi" target="_blank" rel="noopener">Nadi</a></p>`;
}

function renderCardPage({ settings: s, lang, member: m, state, qr, url, today, visits = [], visitCount = 0, baseUrl = '', renewOnline = null, payPending = false, justPaid = false }) {
  const t = strings(lang);
  const theme = cleanTheme(s.theme);
  if (!m) {
    return `${head({ s, lang, t, title: s.name, description: s.name, baseUrl, robots: 'noindex' })}
<body class="theme-${theme} card-page"><main class="flow"><div class="ticket"><p class="empty">${icon('x-circle')}<br>${esc(t.cardNotFound)}</p><a class="btn" href="/">${esc(s.name)}</a></div></main></body></html>`;
  }
  const sub = state.sub;
  const cls = { active: state.soon ? 'warn' : 'ok', frozen: 'info', upcoming: 'info', expired: 'bad', none: 'bad' }[state.status];
  let line = '';
  if (state.status === 'active') line = state.visitsLeft !== null ? fill(t.visitsLeft, { n: state.visitsLeft }) : fill(t.daysLeft, { n: state.daysLeft });
  else if (state.status === 'frozen') line = fill(t.frozenUntil, { date: M.dateLabel(sub.freezes.find((f) => f.from <= today && today <= f.to).to, lang, { day: 'numeric', month: 'long' }) });
  else if (state.status === 'upcoming') line = fill(t.startsOn, { date: M.dateLabel(sub.start, lang) });
  else if (sub) line = fill(t.endedOn, { date: M.dateLabel(sub.end, lang, { day: 'numeric', month: 'long', year: 'numeric' }) });
  // Progress through the plan (time or visits).
  let pct = 0;
  if (sub && state.status !== 'none') {
    if (sub.visits) pct = Math.min(100, Math.round((sub.used / sub.visits) * 100));
    else {
      const total = D.daysBetween(sub.start, sub.end) + 1;
      pct = Math.min(100, Math.max(0, Math.round(((D.daysBetween(sub.start, today) + 1) / total) * 100)));
    }
  }
  const digits = String(s.whatsapp || '').replace(/\D/g, '');
  const renewText = fill(t.renewText, { name: m.name, no: m.no, gym: s.name });
  const logo = safeUrl(s.logo);
  return `${head({ s, lang, t, title: `${t.memberCard} — ${s.name}`, description: s.name, baseUrl, robots: 'noindex' })}
<body class="theme-${theme} card-page">
<main class="flow">
  <a class="card-gym" href="/">${logo ? `<img src="${esc(logo)}" alt="">` : `<span>${esc(initials(s.name))}</span>`}<b>${esc(s.name)}</b></a>
  <div class="mcard ${cls}">
    <div class="mcard-top">
      <div class="avatar" style="--h:${hueFor(m.name)}">${safeUrl(m.photo) ? `<img src="${esc(m.photo)}" alt="">` : esc(initials(m.name))}</div>
      <div class="mcard-who"><small>${esc(t.memberCard)} · #${esc(m.no)}</small><h1>${esc(m.name)}</h1></div>
    </div>
    <div class="qr-wrap" aria-label="${esc(t.showAtDoor)}">${qr}</div>
    <p class="qr-hint">${icon('qr', 'i xs')}${esc(t.showAtDoor)}</p>
    <div class="mcard-status">
      <span class="pill ${cls}">${esc(t[`status_${state.status}`])}</span>
      ${sub ? `<b>${esc(sub.emoji || '💪')} ${esc(sub.planName)}</b>` : ''}
      ${line ? `<span class="mcard-line">${esc(line)}</span>` : ''}
      ${sub && state.status !== 'none' ? `<div class="meter"><i style="width:${pct}%"></i></div><div class="meter-labels"><span>${esc(M.dateLabel(sub.start, lang, { day: 'numeric', month: 'short' }))}</span><span>${esc(sub.visits ? `${sub.used}/${sub.visits} ${t.visits}` : M.dateLabel(sub.end, lang, { day: 'numeric', month: 'short' }))}</span></div>` : ''}
    </div>
  </div>
  ${justPaid ? `<div class="paid-banner">${icon('check')}<b>${esc(t.renewedOnline)}</b></div>` : ''}
  ${payPending ? `<div class="paid-banner pending">${icon('clock')}<b>${esc(t.payConfirming)}</b></div>` : ''}
  ${renewOnline && !justPaid ? `<button class="btn block" type="button" id="renew-online" data-token="${esc(m.token)}">${icon('cash')}${esc(fill(t.renewOnline, { plan: renewOnline.name, price: renewOnline.price }))}</button>` : ''}
  ${digits ? `<a class="btn ${(state.status === 'active' && !state.soon) || renewOnline ? 'ghost' : 'wa'} block" href="https://wa.me/${esc(digits)}?text=${esc(encodeURIComponent(renewText))}" target="_blank" rel="noopener">${icon('whatsapp')}${esc(state.status === 'active' && !state.soon ? t.contactGym : t.renewWhatsapp)}</a>` : ''}
  <section class="info-card">
    <h3>${icon('trend-up')}${esc(t.recentVisits)}<span class="count">${esc(fill(t.totalVisits, { n: visitCount }))}</span></h3>
    ${visits.length ? `<ul class="visits">${visits.map((v) => `<li><span>${esc(M.dateLabel(v.date, lang, { weekday: 'short', day: 'numeric', month: 'short' }))}</span><b>${esc(timeLabel(v.minutes, lang))}</b></li>`).join('')}</ul>` : `<p class="muted">${esc(t.noVisits)}</p>`}
  </section>
  <p class="muted small center">${icon('sparkles', 'i xs')} ${esc(t.addHome)}</p>
  <p class="url-line">${esc(url)}</p>
</main>
${renewOnline ? `<script>
(() => {
  const b = document.getElementById('renew-online');
  if (b) b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const res = await fetch('/api/members/' + encodeURIComponent(b.dataset.token) + '/renew', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Nadi': '1' }, body: '{}' });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error);
      location.href = r.url;
    } catch {
      alert(${inlineJson(t.payFailed)});
      b.disabled = false;
    }
  });
})();
</script>` : ''}
</body>
</html>`;
}

/** Self check-in screen for a tablet at the door. */
function renderKioskPage({ settings: s, lang, token, languages = [] }) {
  const t = strings(lang);
  const logo = safeUrl(s.logo);
  if (!token) {
    return `${head({ s, lang, t, title: s.name, description: s.name, baseUrl: '', robots: 'noindex' })}<body class="kiosk-page"><main class="kiosk"><p class="empty">${icon('x-circle')}<br>${esc(t.kioskInvalid)}</p></main></body></html>`;
  }
  const data = { lang, t, token, icons: ICONS };
  return `${head({ s, lang, t, title: `${t.kioskTitle} — ${s.name}`, description: s.name, baseUrl: '', robots: 'noindex' })}
<body class="kiosk-page">
<main class="kiosk">
  <header class="kiosk-head">${logo ? `<img src="${esc(logo)}" alt="">` : `<span class="k-logo">${esc(initials(s.name))}</span>`}<b>${esc(s.name)}</b>
    ${languages.length > 1 ? `<select id="lang" aria-label="${esc(t.language)}">${languages.map((l) => `<option value="${esc(l.code)}"${l.code === lang ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select>` : ''}</header>
  <section class="kiosk-scan">
    <div class="viewfinder" id="vf"><video id="video" playsinline muted></video><span class="corners"></span><button type="button" class="btn" id="start">${icon('qr')}${esc(t.kioskStart)}</button></div>
    <h1>${esc(t.kioskTitle)}</h1>
    <p>${esc(t.kioskSub)}</p>
  </section>
  <div class="kiosk-result" id="result" hidden></div>
  <p class="kiosk-clock" id="clock"></p>
</main>
<script>window.NADI_KIOSK=${inlineJson(data)};</script>
<script src="/js/scanner.js?v=${VERSION}"></script>
<script src="/js/kiosk.js?v=${VERSION}" defer></script>
</body>
</html>`;
}

function renderPoster({ settings: s, svg, lang, url }) {
  const t = strings(lang);
  const color = safeColor(s.color);
  const logo = safeUrl(s.logo);
  return `<!doctype html>
<html lang="${esc(lang)}" dir="${t.dir}">
<head><meta charset="utf-8"><title>QR — ${esc(s.name)}</title>
<link rel="stylesheet" href="${esc(fontHref(s.font, lang))}">
<style>
  *{box-sizing:border-box} body{font-family:${fontStack(s.font)};margin:0;background:#f4f4f1;display:grid;place-items:center;min-height:100vh}
  .poster{width:148mm;background:#fff;border-radius:28px;overflow:hidden;text-align:center;box-shadow:0 4px 30px rgba(0,0,0,.08)}
  .top{background:${color};color:#fff;padding:34px 24px 90px}
  .logo{width:84px;height:84px;border-radius:24px;background:#fff;color:${color};display:grid;place-items:center;margin:0 auto 12px;font-weight:800;font-size:38px;overflow:hidden}
  .logo img{width:100%;height:100%;object-fit:cover}
  h1{margin:0;font-size:34px} .top p{margin:6px 0 0;font-size:18px;opacity:.9}
  .qr{background:#fff;width:70%;margin:-70px auto 0;padding:16px;border-radius:24px;box-shadow:0 10px 30px rgba(0,0,0,.14)}
  .qr svg{width:100%;height:auto;display:block}
  .cta{font-size:26px;font-weight:800;color:${color};margin:22px 0 4px} .url{color:#666;margin:0 0 30px;font-size:15px;direction:ltr}
  .bar{position:fixed;top:12px;inset-inline-end:12px} .bar button{font:inherit;font-weight:700;padding:10px 20px;border-radius:12px;border:0;background:${color};color:#fff;cursor:pointer}
  @media print{.bar{display:none}body{background:#fff}.poster{box-shadow:none}}
</style></head>
<body><div class="bar"><button onclick="window.print()">Print</button></div>
<div class="poster"><div class="top"><div class="logo">${logo ? `<img src="${esc(logo)}" alt="">` : esc(initials(s.name))}</div><h1>${esc(s.name)}</h1>${s.tagline ? `<p>${esc(s.tagline)}</p>` : ''}</div>
<div class="qr">${svg}</div><p class="cta">💪 ${esc(t.posterCta)}</p><p class="url">${esc(url)}</p></div>
</body></html>`;
}

function renderManifest(s) {
  const logo = safeUrl(s.logo);
  return {
    name: s.name,
    short_name: String(s.name).slice(0, 12),
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: safeColor(s.color),
    icons: [logo ? { src: logo, sizes: '512x512' } : { src: '/img/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}

module.exports = { renderGymPage, renderCardPage, renderKioskPage, renderPoster, renderManifest, esc, safeUrl, timeLabel };
