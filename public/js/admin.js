(() => {
  'use strict';

  // ======================= i18n =======================
  const LANG_KEY = 'nadi-admin-lang';
  let lang = (() => {
    try { return localStorage.getItem(LANG_KEY); } catch { return null; }
  })();
  let S = {};
  let LANGUAGES = [{ code: 'en', name: 'English' }];
  const T = (k) => S[k] || k;

  async function setLang(next) {
    const data = await (await fetch(`/api/i18n/${encodeURIComponent(next || 'en')}`)).json();
    S = data.strings;
    LANGUAGES = data.languages;
    lang = LANGUAGES.some((l) => l.code === next) ? next : 'en';
    try { localStorage.setItem(LANG_KEY, lang); } catch { /* ignore */ }
    document.documentElement.lang = lang;
    document.documentElement.dir = T('dir');
  }

  // ======================= helpers =======================
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const app = $('#app');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ICONS = '/img/icons.svg';
  const ic = (name, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="${ICONS}#i-${name}"/></svg>`;
  const hue = (text) => {
    let h = 0;
    for (const ch of String(text || '')) h = (h * 31 + ch.codePointAt(0)) % 360;
    return h;
  };
  const trend = (pct) =>
    pct === null || pct === undefined ? '' : `<span class="trend ${pct >= 0 ? 'up' : 'down'}" title="${esc(T('vsPrevious'))}">${ic(pct >= 0 ? 'trend-up' : 'trend-down')}${Math.abs(pct)}%</span>`;

  let toastTimer;
  function toast(msg, bad) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = `toast show${bad ? ' bad' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = 'toast'), 2200);
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Nadi': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
    let data = {};
    try { data = await res.json(); } catch { /* empty */ }
    if (res.status === 401 && !url.endsWith('/login') && !url.endsWith('/password')) {
      boot();
      throw new Error('unauthorized');
    }
    if (!res.ok) throw Object.assign(new Error(data.error || 'error'), { code: data.error });
    return data;
  }

  const PREFIX = ['$', '€', '£', '¥', '₹', '₺', 'R$', 'US$', 'C$', 'A$'];
  const money = (n) => {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    const s = v.toLocaleString('en', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
    const cur = state.data ? state.data.settings.currency : '';
    return PREFIX.includes(cur) ? `${cur}${s}` : `${s} ${cur}`.trim();
  };
  const pad = (n) => String(n).padStart(2, '0');
  const hhmm = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
  const toMin = (s) => {
    const [h, m] = String(s).split(':').map(Number);
    return h * 60 + m;
  };
  const timeLabel = (min) => new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1, Math.floor(min / 60), min % 60)));
  const fmtDate = (date, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => new Intl.DateTimeFormat(lang, { ...opts, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  const addDays = (date, n) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const dow = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
  const dayName = (i, style = 'long') => new Intl.DateTimeFormat(lang, { weekday: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + i)));
  const dur = (m) => {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return !h ? `${r}m` : r ? `${h}h ${r}m` : `${h}h`;
  };
  const sw = (name, checked, label, attrs = '') =>
    `<label class="check"><span class="switch"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''} ${attrs}><i></i></span><span>${label}</span></label>`;
  const browserTimezone = () => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
  };
  const timezones = () => {
    try { return Intl.supportedValuesOf('timeZone'); } catch { return []; }
  };

  async function fileToDataUrl(file, max) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = url;
      });
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      let data = c.toDataURL('image/webp', 0.85);
      if (!data.startsWith('data:image/webp')) data = c.toDataURL('image/jpeg', 0.85);
      return data;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  async function uploadFile(file, max = 1200) {
    const dataUrl = await fileToDataUrl(file, max);
    return (await api('POST', '/api/admin/upload', { dataUrl })).url;
  }

  function timeAgo(iso) {
    const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
    const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
    if (s < 60) return rtf.format(-s, 'second');
    if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
    if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
    return rtf.format(-Math.round(s / 86400), 'day');
  }

  // ======================= state =======================
  const state = { data: null, tab: 'home', filter: 'all', q: '', leads: null, stopScan: null };
  let demo = null;

  async function loadData() {
    state.data = await api('GET', '/api/admin/data');
    document.documentElement.style.setProperty('--brand', state.data.settings.color);
  }
  const today = () => state.data.now.date;
  const planById = (id) => state.data.plans.find((p) => p.id === id);
  const fill = (s, vars) => Object.entries(vars).reduce((o, [k, v]) => o.split(`{${k}}`).join(v), s);
  const statusPill = (st, soon) => `<span class="chip st-${st}${st === 'active' && soon ? ' soon' : ''}">${esc(T(st === 'active' && soon ? 'st_soon' : `st_${st}`))}</span>`;
  const avatar = (m, cls = 'av') => `<span class="${cls}" style="--h:${hue(m.name)}">${m.photo ? `<img src="${esc(m.photo)}" alt="" loading="lazy">` : esc((m.name || '?').trim().charAt(0).toUpperCase())}</span>`;
  const planLen = (p) => {
    const parts = [];
    if (p.months) parts.push(`${p.months} ${T(p.months === 1 ? 'unitMonth' : 'unitMonths')}`);
    if (p.days) parts.push(`${p.days} ${T(p.days === 1 ? 'unitDay' : 'unitDays')}`);
    const len = parts.join(' + ') || `30 ${T('unitDays')}`;
    return p.visits ? `${p.visits} ${T('unitVisits')} · ${len}` : len;
  };
  const leftLine = (m) => {
    if (m.status === 'active' || m.status === 'frozen') return m.visitsLeft !== null && m.visitsLeft !== undefined ? fill(T('visitsLeftN'), { n: m.visitsLeft }) : fill(T('daysLeftN'), { n: m.daysLeft });
    if (m.status === 'upcoming') return fill(T('startsOnD'), { date: fmtDate(m.start) });
    if (m.status === 'expired' && m.end) return fill(T('endedOnD'), { date: fmtDate(m.end) });
    return T('noPlanYet');
  };
  const methodOptions = (sel = 'cash') => ['cash', 'card', 'transfer', 'wallet', 'other'].map((k) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(T(`pay_${k}`))}</option>`).join('');
  async function openWa(url) {
    const win = window.open(url, '_blank');
    if (win) win.opener = null;
    else location.href = url;
  }

  // ======================= boot / auth =======================
  async function boot() {
    let s;
    try {
      s = await api('GET', '/api/state');
    } catch {
      app.innerHTML = '<div class="auth"><div class="auth-main"><p class="error">Error</p></div></div>';
      return;
    }
    demo = s.demo;
    await setLang(lang || s.lang);
    if (!s.setupDone) return renderSetup(s);
    if (!s.authed) return renderLogin();
    await loadData();
    renderShell();
    startPolling();
  }

  const langSwitch = () =>
    `<select class="lang-select" data-act-change="lang" aria-label="Language">${LANGUAGES.map((l) => `<option value="${esc(l.code)}" ${l.code === lang ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>`;
  const langOptions = (selected) => LANGUAGES.map((l) => `<option value="${esc(l.code)}" ${l.code === selected ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
  const CURRENCY_GUESS = { ar: 'EGP', en: 'USD', es: 'MXN', pt: 'BRL', fr: 'EUR', tr: 'TRY', id: 'IDR', hi: 'INR' };

  const authShell = (form) => `
    <div class="auth">
      <aside class="auth-side">
        <div class="auth-brand"><img src="/img/icon.svg" alt="" width="40" height="40"><b>Nadi</b></div>
        <h2>${esc(T('authTagline'))}</h2>
        <ul>${['authPoint1', 'authPoint2', 'authPoint3'].map((k) => `<li>${ic('check')}<span>${esc(T(k))}</span></li>`).join('')}</ul>
        <div class="auth-mock" aria-hidden="true">
          <div class="m-bubble">✅ <b>Omar Hassan</b> · #1042<br><small>💪 3 months · 47 ${esc(T('unitDays'))}</small></div>
          <div class="m-bubble me">🔔 ${esc(T('st_soon'))} · 6</div>
        </div>
      </aside>
      <div class="auth-main">${form}</div>
    </div>`;

  function renderSetup(s) {
    app.innerHTML = authShell(`<form class="auth-card" id="setup" autocomplete="off">
        <div style="text-align:end">${langSwitch()}</div>
        <img class="mark" src="/img/icon.svg" alt="">
        <h1>${esc(T('setupTitle'))}</h1>
        <p class="sub">${esc(T('setupSub'))}</p>
        ${s.needsSetupCode ? `<label class="field"><span>${ic('lock')}${esc(T('setupCode'))}</span><input name="setupCode" required maxlength="12" placeholder="ABCD-EFGH" autocapitalize="characters" spellcheck="false" style="letter-spacing:.15em;font-weight:700"><small>${esc(T('setupCodeHint'))}</small></label>` : ''}
        <label class="field"><span>${esc(T('gymName'))}</span><input name="name" required maxlength="80"></label>
        <label class="field"><span>${esc(T('gymType'))}</span><select name="type">${s.gymTypes.map((k) => `<option value="${k}">${esc(T(`gtype_${k}`))}</option>`).join('')}</select></label>
        <label class="field"><span>${esc(T('whatsapp'))}</span><input name="whatsapp" type="tel" inputmode="tel" maxlength="20" placeholder="201001234567"><small>${esc(T('whatsappHint'))}</small></label>
        <div class="grid2">
          <label class="field"><span>${esc(T('currency'))}</span><input name="currency" value="${CURRENCY_GUESS[lang] || 'USD'}" maxlength="12"></label>
          <label class="field"><span>${esc(T('defaultLang'))}</span><select name="lang">${langOptions(lang)}</select></label>
        </div>
        <label class="field"><span>${esc(T('password'))}</span><input name="password" type="password" required minlength="8" autocomplete="new-password"><small>${esc(T('passwordHint'))}</small></label>
        ${sw('sample', true, `${esc(T('sampleData'))} <small class="muted">— ${esc(T('sampleHint'))}</small>`)}
        <button class="btn block" type="submit">${esc(T('start'))}</button>
        <p class="error" id="err"></p>
      </form>`);
    const f = $('#setup');
    (f.setupCode || f.name).focus();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (f.password.value.length < 8) return ($('#err').textContent = T('weakPassword'));
      f.querySelector('button[type=submit]').disabled = true;
      try {
        await api('POST', '/api/setup', {
          setupCode: f.setupCode ? f.setupCode.value : '', name: f.name.value, type: f.type.value, whatsapp: f.whatsapp.value,
          currency: f.currency.value, lang: f.lang.value, password: f.password.value, sample: f.sample.checked, timezone: browserTimezone(),
        });
        await setLang(f.lang.value);
        boot();
      } catch (err) {
        $('#err').textContent = T({ weak_password: 'weakPassword', invalid_setup_code: 'invalidSetupCode', rate_limited: 'rateLimited' }[err.code] || 'error');
        f.querySelector('button[type=submit]').disabled = false;
      }
    });
  }

  function renderLogin() {
    app.innerHTML = authShell(`<form class="auth-card" id="login">
        <div style="text-align:end">${langSwitch()}</div>
        <img class="mark" src="/img/icon.svg" alt="">
        <h1>${esc(T('loginTitle'))}</h1>
        <p class="sub">${esc(T('loginSub'))}</p>
        ${demo ? `<p class="demo-note">${ic('sparkles')} ${esc(T('demoLogin'))} <b>${esc(demo.password)}</b></p>` : ''}
        <label class="field"><span>${esc(T('password'))}</span><input name="password" type="password" required autocomplete="current-password" value="${demo ? esc(demo.password) : ''}"></label>
        <button class="btn block" type="submit">${esc(T('login'))}</button>
        <p class="error" id="err"></p>
      </form>`);
    $('#login [name=password]').focus();
    $('#login').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('POST', '/api/login', { password: e.target.password.value });
        boot();
      } catch (err) {
        $('#err').textContent = err.code === 'rate_limited' ? T('rateLimited') : T('wrongPassword');
      }
    });
  }

  // ======================= shell =======================
  const TABS = [
    ['home', 'dashboard'], ['checkin', 'qr'], ['members', 'users'], ['plans', 'tag'],
    ['appearance', 'palette'], ['share', 'megaphone'], ['settings', 'settings'],
  ];

  function renderShell() {
    const s = state.data.settings;
    const hash = location.hash.slice(1);
    if (TABS.some(([k]) => k === hash)) state.tab = hash;
    app.innerHTML = `
      ${demo ? `<div class="demo-bar">${ic('sparkles')} ${esc(T('demoLogin'))} <b>${esc(demo.password)}</b></div>` : ''}
      <header class="top">
        <img src="${esc(s.logo || '/img/icon.svg')}" alt="" width="36" height="36">
        <div class="shop">${esc(s.name)}<small class="muted"><span class="status-dot ${s.acceptingJoins ? '' : 'off'}"></span>${esc(fmtDate(today(), { weekday: 'long', day: 'numeric', month: 'long' }))}</small></div>
        ${langSwitch()}
        <a class="btn sm" href="/" target="_blank" rel="noopener">${ic('external')}<span class="hide-sm">${esc(T('viewPage'))}</span></a>
        <button class="icon-btn" data-act="logout" title="${esc(T('logout'))}" aria-label="${esc(T('logout'))}" type="button">${ic('logout')}</button>
      </header>
      <div class="layout">
        <nav class="nav">${TABS.map(([k, icon]) => `<button type="button" data-tab="${k}" class="${state.tab === k ? 'active' : ''}">${ic(icon, 'i ico')}<span>${esc(T(k))}</span>${k === 'members' ? '<span class="dot" id="lead-dot" hidden></span>' : ''}</button>`).join('')}</nav>
        <main class="view" id="view"></main>
      </div>`;
    setLeadDot(state.data.newLeads);
    renderTab();
  }

  async function renderTab() {
    $$('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
    if (state.stopScan && state.tab !== 'checkin') {
      state.stopScan();
      state.stopScan = null;
    }
    const view = $('#view');
    if (!view) return;
    view.onclick = null;
    try {
      await VIEWS[state.tab](view);
    } catch (err) {
      if (err.message !== 'unauthorized') {
        console.error(err);
        toast(T('error'), true);
      }
    }
  }

  function setLeadDot(n) {
    const dot = $('#lead-dot');
    if (dot) {
      dot.hidden = !n;
      dot.textContent = n;
    }
    document.title = `${n ? `(${n}) ` : ''}Nadi — ${state.data ? state.data.settings.name : ''}`;
  }

  // ======================= modal =======================
  function openModal(html, cls = '') {
    closeModal();
    const el = document.createElement('div');
    el.className = 'modal';
    el.id = 'modal';
    el.innerHTML = `<div class="back" data-close></div><div class="box ${cls}" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(el);
    document.body.style.overflow = 'hidden';
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) closeModal();
    });
    return $('.box', el);
  }
  function closeModal() {
    const m = $('#modal');
    if (m) m.remove();
    document.body.style.overflow = '';
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  const VIEWS = {};
  const refresh = () => (state.tab === 'members' || state.tab === 'home' || state.tab === 'checkin' ? renderTab() : null);

  // ======================= HOME =======================
  VIEWS.home = async (view) => {
    const st = await api('GET', '/api/admin/stats');
    setLeadDot(st.leads.length);
    const s = state.data.settings;
    const link = state.data.baseUrl;
    const steps = [
      [!!s.whatsapp, T('stepWhatsapp'), 'settings'],
      [st.plansCount > 0, T('stepPlans'), 'plans'],
      [st.members.total > 0, T('stepMember'), 'members'],
      [!!s.logo, T('stepLogo'), 'appearance'],
      [st.checkins.month > 0, T('stepKiosk'), 'checkin'],
    ];
    const allDone = demo || steps.every((x) => x[0]);
    const maxDay = Math.max(1, ...st.days.map((d) => d.count));
    const maxHour = Math.max(1, ...st.hours);
    const peak = st.hours.indexOf(Math.max(...st.hours));
    const maxPlan = Math.max(1, ...st.plans.map((p) => p.count));
    const hourLabel = (h) => new Date(Date.UTC(2024, 0, 1, h)).toLocaleTimeString(lang, { hour: 'numeric', timeZone: 'UTC' });
    const personRow = (m, kind) => `<div class="remind-row">${avatar(m)}<div class="bd"><b data-member="${m.id}" class="link">${esc(m.name)}</b><span>${esc(m.emoji || '💪')} ${esc(m.planName)} · ${esc(kind === 'lapsed' ? fill(T('endedOnD'), { date: fmtDate(m.end) }) : leftLine({ ...m, status: 'active' }))}</span></div>${m.phone ? `<button class="btn sm ${m.reminded ? 'done' : 'wa'}" data-renew="${m.id}" type="button">${ic(m.reminded ? 'check' : 'whatsapp')}${esc(m.reminded ? T('reminded') : T('remind'))}</button>` : ''}</div>`;

    view.innerHTML = `
      <div class="page-head">
        <h2 class="title">${esc(T('home'))}</h2>
        <span style="flex:1"></span>
        <button class="btn line" data-tab="checkin" type="button">${ic('qr')}<span class="hide-sm">${esc(T('checkin'))}</span></button>
        <button class="btn" data-act="new-member" type="button">${ic('plus')}${esc(T('newMember'))}</button>
      </div>
      <div class="kpis">
        <div class="kpi"><div class="kpi-ic c1">${ic('users')}</div><div class="kpi-body"><span class="label">${esc(T('activeMembers'))}</span><div class="value">${st.members.active}</div><span class="sub">${st.members.frozen ? `${st.members.frozen} ${esc(T('st_frozen'))} · ` : ''}+${st.newMembers} ${esc(T('new30'))}</span></div></div>
        <div class="kpi"><div class="kpi-ic c4">${ic('qr')}</div><div class="kpi-body"><span class="label">${esc(T('checkinsToday'))}</span><div class="value">${st.checkins.today}</div><span class="sub">${st.checkins.month} · 30d</span></div></div>
        <div class="kpi"><div class="kpi-ic c2">${ic('cash')}</div><div class="kpi-body"><span class="label">${esc(T('revenue30'))}</span><div class="value">${esc(money(st.revenue.month))}${trend(st.revenue.change)}</div><span class="sub">${st.owed ? `${esc(T('unpaid'))} ${esc(money(st.owed))}` : '&nbsp;'}</span></div></div>
        <div class="kpi"><div class="kpi-ic c3">${ic('bell')}</div><div class="kpi-body"><span class="label">${esc(T('expiringSoon'))}</span><div class="value">${st.members.soon}</div><span class="sub">${st.members.expired30} ${esc(T('lapsed30'))}</span></div></div>
      </div>
      ${st.leads.length ? `<div class="card leads-card"><h3>${ic('sparkles')}${esc(T('joinRequests'))}<span class="count">${st.leads.length}</span></h3>${st.leads.map((l) => `<div class="remind-row"><span class="av" style="--h:${hue(l.name)}">${esc(l.name.charAt(0).toUpperCase())}</span><div class="bd"><b>${esc(l.name)}</b><span dir="auto">${esc(l.phone)}${l.planName ? ` · ${esc(l.emoji || '💪')} ${esc(l.planName)}` : ''} · ${esc(timeAgo(l.createdAt))}</span>${l.message ? `<span class="quote">“${esc(l.message)}”</span>` : ''}</div><div class="acts"><button class="icon-btn wa" data-lead-wa="${l.id}" type="button" aria-label="WhatsApp">${ic('whatsapp')}</button><button class="btn sm" data-lead-add="${l.id}" type="button">${ic('plus')}<span class="hide-sm">${esc(T('addMember'))}</span></button><button class="icon-btn" data-lead-done="${l.id}" type="button" title="${esc(T('dismiss'))}" aria-label="${esc(T('dismiss'))}">${ic('x')}</button></div></div>`).join('')}</div>` : ''}
      <div class="dash-cols">
        <div>
          <div class="card">
            <h3>${ic('trend-up')}${esc(T('checkins14'))}</h3>
            <div class="wk-bars tall">${st.days.map((d) => `<div title="${esc(fmtDate(d.date))}: ${d.count}" class="${d.date === today() ? 'peak' : ''}"><em>${d.count || ''}</em><i style="height:${(d.count / maxDay) * 100}%"></i>${esc(fmtDate(d.date, { day: 'numeric' }))}</div>`).join('')}</div>
          </div>
          <div class="grid2 gap">
            <div class="card">
              <h3>${ic('clock')}${esc(T('busiestHours'))}</h3>
              ${st.checkins.month ? `<div class="wk-bars hours">${st.hours.map((v, h) => `<div class="${h === peak && v ? 'peak' : ''}" title="${esc(hourLabel(h))}: ${v}"><i style="height:${(v / maxHour) * 100}%"></i></div>`).join('')}</div><div class="hour-axis">${[0, 6, 12, 18].map((h) => `<span>${esc(hourLabel(h))}</span>`).join('')}</div><p class="muted small">${esc(fill(T('peakAt'), { time: hourLabel(peak) }))}</p>` : `<p class="muted">${esc(T('noData'))}</p>`}
            </div>
            <div class="card">
              <h3>${ic('tag')}${esc(T('planMix'))}</h3>
              ${st.plans.length ? `<ul class="top-list">${st.plans.slice(0, 5).map((x, i) => `<li><span class="rank">${i + 1}</span><span class="nm">${esc(x.emoji)} ${esc(x.name)}<i style="width:${(x.count / maxPlan) * 100}%"></i></span><b>${x.count}</b></li>`).join('')}</ul>` : `<p class="muted">${esc(T('noData'))}</p>`}
            </div>
          </div>
          <div class="card">
            <h3>${ic('qr')}${esc(T('todayCheckins'))}</h3>
            ${st.todayList.length ? `<div class="checkin-list">${st.todayList.map((c) => checkinRow(c)).join('')}</div>` : `<div class="empty-state"><div class="big">🏋️</div><p>${esc(T('noCheckinsToday'))}</p></div>`}
          </div>
        </div>
        <div>
          <div class="card">
            <h3>${ic('bell')}${esc(T('renewalsDue'))}</h3>
            <p class="muted small" style="margin-top:-8px">${esc(T('renewalsHint'))}</p>
            ${st.expiring.length ? st.expiring.map((m) => personRow(m, 'soon')).join('') : `<p class="muted">${esc(T('noRenewals'))}</p>`}
          </div>
          ${st.lapsed.length ? `<div class="card"><h3>${ic('heart')}${esc(T('winBack'))}</h3><p class="muted small" style="margin-top:-8px">${esc(T('winBackHint'))}</p>${st.lapsed.slice(0, 8).map((m) => personRow(m, 'lapsed')).join('')}</div>` : ''}
          ${allDone ? '' : `<div class="card"><h3>${ic('rocket')}${esc(T('getStarted'))}</h3><div class="progress"><i style="width:${(steps.filter((x) => x[0]).length / steps.length) * 100}%"></i></div><ul class="checklist">${steps.map(([done, label, tab]) => `<li class="${done ? 'done' : ''}"><span class="tick">${done ? ic('check') : ''}</span>${done ? esc(label) : `<a href="#${tab}" data-tab="${tab}">${esc(label)}</a>`}</li>`).join('')}</ul></div>`}
          <div class="card">
            <h3>${ic('link')}${esc(T('yourLink'))}</h3>
            <div class="share-row"><input class="input" readonly value="${esc(link)}"><button class="btn sm" data-act="copy" data-text="${esc(link)}" type="button">${ic('copy')}</button></div>
          </div>
        </div>
      </div>`;
    view.onclick = async (e) => {
      const el = e.target.closest('[data-renew],[data-member],[data-lead-wa],[data-lead-add],[data-lead-done],[data-undo]');
      if (!el) return;
      try {
        if (el.dataset.renew) {
          const { url } = await api('GET', `/api/admin/members/${el.dataset.renew}/whatsapp?kind=renew`);
          openWa(url);
          el.className = 'btn sm done';
          el.innerHTML = `${ic('check')}${esc(T('reminded'))}`;
        } else if (el.dataset.member) memberModal(el.dataset.member);
        else if (el.dataset.leadWa) openWa((await api('GET', `/api/admin/leads/${el.dataset.leadWa}/whatsapp`)).url);
        else if (el.dataset.leadAdd) {
          const l = st.leads.find((x) => x.id === el.dataset.leadAdd);
          newMemberModal({ name: l.name, phone: l.phone, planId: l.planId, leadId: l.id, notes: l.message });
        } else if (el.dataset.leadDone) {
          await api('PUT', `/api/admin/leads/${el.dataset.leadDone}`, { handled: true });
          renderTab();
        } else if (el.dataset.undo) undoCheckin(el.dataset.undo);
      } catch (err) {
        if (err.message !== 'unauthorized') toast(T('error'), true);
      }
    };
  };

  const checkinRow = (c) => `<div class="ci-row ${c.ok ? '' : 'denied'}">${avatar(c)}<div class="bd"><b data-member="${c.memberId}" class="link">${esc(c.name)}</b><span>${esc(timeLabel(c.minutes))}${c.ok ? (c.reason === 'grace' ? ` · ${esc(T('graceEntry'))}` : '') : ` · ${esc(T(`why_${c.reason}`))}`}</span></div>${c.ok ? ic('check', 'i ok') : ic('x-circle', 'i bad')}<button class="icon-btn" type="button" data-undo="${c.id}" title="${esc(T('undo'))}" aria-label="${esc(T('undo'))}">${ic('trash')}</button></div>`;

  async function undoCheckin(id) {
    if (!confirm(T('undoConfirm'))) return;
    await api('DELETE', `/api/admin/checkins/${id}`);
    toast(T('saved'));
    renderTab();
  }

  // ======================= CHECK-IN =======================
  VIEWS.checkin = async (view) => {
    const kiosk = state.data.kioskUrl;
    view.innerHTML = `
      <div class="page-head"><h2 class="title">${esc(T('checkin'))}</h2></div>
      <div class="dash-cols ci-cols">
        <div>
          <div class="card scan-card">
            <div class="scan-box" id="scanbox"><video id="video" playsinline muted></video><span class="corners"></span>
              <button type="button" class="btn" id="cam">${ic('qr')}${esc(T('startCamera'))}</button></div>
            <div class="ci-search">
              ${ic('search')}<input class="input" id="ciq" type="search" placeholder="${esc(T('searchMember'))}" autocomplete="off">
            </div>
            <div id="ci-hits" class="ci-hits"></div>
          </div>
          <div id="ci-result"></div>
        </div>
        <div>
          <div class="card"><h3>${ic('qr')}${esc(T('todayCheckins'))}<span class="count" id="ci-count"></span></h3><div class="checkin-list" id="ci-today"></div></div>
          <div class="card kiosk-card"><h3>${ic('tablet')}${esc(T('kioskTitle'))}</h3><p class="muted small">${esc(T('kioskHint'))}</p>
            <div class="share-row"><input class="input" readonly value="${esc(kiosk)}" dir="ltr"><button class="btn sm" data-act="copy" data-text="${esc(kiosk)}" type="button">${ic('copy')}</button></div>
            <a class="btn line sm" href="${esc(kiosk)}" target="_blank" rel="noopener" style="margin-top:10px">${ic('external')}${esc(T('openKiosk'))}</a></div>
        </div>
      </div>`;
    const loadToday = async () => {
      const r = await api('GET', '/api/admin/checkins');
      $('#ci-count', view).textContent = r.checkins.filter((c) => c.ok).length;
      $('#ci-today', view).innerHTML = r.checkins.length ? r.checkins.map(checkinRow).join('') : `<p class="muted">${esc(T('noCheckinsToday'))}</p>`;
    };
    const showResult = (r) => {
      const ok = r.ok;
      const cls = ok ? (r.reason === 'grace' || r.soon ? 'warn' : 'ok') : 'bad';
      const line = ok ? (r.duplicate ? T('alreadyCheckedIn') : r.reason === 'grace' ? T('graceEntry') : leftLine(r)) : T(`why_${r.reason}`);
      $('#ci-result', view).innerHTML = `<div class="card result-card ${cls}">
        ${avatar(r.member, 'av xl')}
        <div class="bd"><small>#${esc(r.member.no)}</small><h3>${esc(r.member.name)}</h3>
          <p>${ic(ok ? 'check' : 'x-circle')}<b>${esc(ok ? T(r.duplicate ? 'checkedInAgain' : 'checkedIn') : T('notAllowed'))}</b></p>
          <span class="muted">${esc(r.planName ? `${r.planName} · ` : '')}${esc(line)}</span></div>
        <div class="acts">
          <button class="btn sm line" type="button" data-member="${r.member.id}">${esc(T('openProfile'))}</button>
          ${!ok || r.soon || r.reason === 'grace' ? `<button class="btn sm" type="button" data-sell="${r.member.id}">${ic('cash')}${esc(T('renew'))}</button>` : ''}
          ${r.checkinId ? `<button class="icon-btn" type="button" data-undo="${r.checkinId}" title="${esc(T('undo'))}">${ic('trash')}</button>` : ''}
        </div></div>`;
      if (window.NadiScanner) window.NadiScanner.beep(ok);
      loadToday();
    };
    const checkIn = async (body) => {
      try {
        showResult(await api('POST', '/api/admin/checkin', body));
      } catch (err) {
        if (err.code === 'unknown_member') {
          if (window.NadiScanner) window.NadiScanner.beep(false);
          $('#ci-result', view).innerHTML = `<div class="card result-card bad"><div class="bd"><h3>${esc(T('unknownCard'))}</h3></div></div>`;
        } else toast(T('error'), true);
      }
    };
    // Camera
    $('#cam', view).addEventListener('click', async () => {
      try {
        if (!window.NadiScanner) await new Promise((res, rej) => {
          const sc = document.createElement('script');
          sc.src = '/js/scanner.js';
          sc.onload = res;
          sc.onerror = rej;
          document.head.appendChild(sc);
        });
        state.stopScan = await window.NadiScanner.start($('#video', view), (code) => checkIn({ code }));
        $('#scanbox', view).classList.add('live');
      } catch {
        toast(T('cameraError'), true);
      }
    });
    // Search by name / phone / number
    let timer;
    const q = $('#ciq', view);
    q.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const v = q.value.trim();
        const box = $('#ci-hits', view);
        if (!v) return (box.innerHTML = '');
        const r = await api('GET', `/api/admin/members?q=${encodeURIComponent(v)}`);
        box.innerHTML = r.members.slice(0, 6).map((m) => `<button type="button" class="ci-hit" data-ci="${m.id}">${avatar(m)}<span class="bd"><b>${esc(m.name)}</b><small>#${m.no} · ${esc(m.phone)}</small></span>${statusPill(m.status, m.soon)}</button>`).join('') || `<p class="muted small">${esc(T('noMatches'))}</p>`;
      }, 200);
    });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = $('[data-ci]', view);
        if (first) first.click();
        else if (/^\d+$/.test(q.value.trim())) checkIn({ code: q.value.trim() });
      }
    });
    view.onclick = (e) => {
      const hit = e.target.closest('[data-ci]');
      const mem = e.target.closest('[data-member]');
      const sell = e.target.closest('[data-sell]');
      const undo = e.target.closest('[data-undo]');
      if (hit) {
        checkIn({ memberId: hit.dataset.ci });
        q.value = '';
        $('#ci-hits', view).innerHTML = '';
        q.focus();
      } else if (mem) memberModal(mem.dataset.member);
      else if (sell) sellModal(sell.dataset.sell);
      else if (undo) undoCheckin(undo.dataset.undo);
    };
    loadToday();
    q.focus();
  };

  // ======================= MEMBERS =======================
  const FILTERS = ['all', 'active', 'soon', 'expired', 'frozen', 'due'];
  VIEWS.members = async (view) => {
    view.innerHTML = `
      <div class="page-head">
        <h2 class="title">${esc(T('members'))}</h2>
        <span style="flex:1"></span>
        <a class="btn line sm" href="/api/admin/members.csv" download>${ic('download')}<span class="hide-sm">CSV</span></a>
        <button class="btn" data-act="new-member" type="button">${ic('plus')}${esc(T('newMember'))}</button>
      </div>
      <div id="leads-box"></div>
      <div class="filters" id="mf"></div>
      <input class="input" type="search" id="mq" placeholder="${esc(T('searchMember'))}" value="${esc(state.q)}" style="margin-bottom:12px">
      <div class="card" style="padding:6px 16px"><div id="mlist"><div class="skeleton-list"></div></div></div>`;
    const load = async () => {
      const r = await api('GET', `/api/admin/members?filter=${state.filter}&q=${encodeURIComponent(state.q)}`);
      $('#mf', view).innerHTML = FILTERS.map((f) => `<button type="button" data-filter="${f}" class="${state.filter === f ? 'active' : ''}">${esc(T(`f_${f}`))} <small>${r.counts[f] === undefined ? r.counts.all : r.counts[f]}</small></button>`).join('');
      $('#mlist', view).innerHTML = r.members.length
        ? r.members.map((m) => `<div class="m-row" data-member="${m.id}">
            ${avatar(m)}
            <div class="bd"><b>${esc(m.name)} <small class="muted">#${m.no}</small></b><span>${m.planName ? `${esc(m.emoji || '💪')} ${esc(m.planName)} · ` : ''}${esc(leftLine(m))}</span></div>
            <div class="m-side">${statusPill(m.status, m.soon)}${m.due ? `<span class="chip due">${esc(T('due'))} ${esc(money(m.due))}</span>` : ''}<small class="muted">${m.lastVisit ? esc(fill(T('lastVisitD'), { date: fmtDate(m.lastVisit, { day: 'numeric', month: 'short' }) })) : ''}</small></div>
          </div>`).join('')
        : `<div class="empty-state"><div class="big">🏋️</div><p>${esc(state.q || state.filter !== 'all' ? T('noMatches') : T('noMembers'))}</p>${state.q || state.filter !== 'all' ? '' : `<button class="btn" data-act="new-member" type="button">${ic('plus')}${esc(T('newMember'))}</button>`}</div>`;
    };
    const leads = await api('GET', '/api/admin/leads');
    const open = leads.leads.filter((l) => !l.handled);
    setLeadDot(open.length);
    if (open.length) {
      $('#leads-box', view).innerHTML = `<div class="card leads-card"><h3>${ic('sparkles')}${esc(T('joinRequests'))}<span class="count">${open.length}</span></h3>${open.map((l) => `<div class="remind-row"><span class="av" style="--h:${hue(l.name)}">${esc(l.name.charAt(0).toUpperCase())}</span><div class="bd"><b>${esc(l.name)}</b><span dir="auto">${esc(l.phone)}${l.planName ? ` · ${esc(l.emoji || '💪')} ${esc(l.planName)}` : ''} · ${esc(timeAgo(l.createdAt))}</span>${l.message ? `<span class="quote">“${esc(l.message)}”</span>` : ''}</div><div class="acts"><button class="icon-btn wa" data-lead-wa="${l.id}" type="button" aria-label="WhatsApp">${ic('whatsapp')}</button><button class="btn sm" data-lead-add="${l.id}" type="button">${ic('plus')}<span class="hide-sm">${esc(T('addMember'))}</span></button><button class="icon-btn" data-lead-done="${l.id}" type="button" title="${esc(T('dismiss'))}" aria-label="${esc(T('dismiss'))}">${ic('x')}</button></div></div>`).join('')}</div>`;
    }
    let timer;
    $('#mq', view).addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.q = e.target.value.trim();
        load();
      }, 200);
    });
    view.onclick = async (e) => {
      const f = e.target.closest('[data-filter]');
      const m = e.target.closest('[data-member]');
      const la = e.target.closest('[data-lead-add]');
      const lw = e.target.closest('[data-lead-wa]');
      const ld = e.target.closest('[data-lead-done]');
      if (f) {
        state.filter = f.dataset.filter;
        load();
      } else if (la) {
        const l = open.find((x) => x.id === la.dataset.leadAdd);
        newMemberModal({ name: l.name, phone: l.phone, planId: l.planId, leadId: l.id, notes: l.message });
      } else if (lw) openWa((await api('GET', `/api/admin/leads/${lw.dataset.leadWa}/whatsapp`)).url);
      else if (ld) {
        await api('PUT', `/api/admin/leads/${ld.dataset.leadDone}`, { handled: true });
        renderTab();
      } else if (m) memberModal(m.dataset.member);
    };
    await load();
  };

  // ---- sell a plan (new member or renewal) ----
  const planFields = (planId, { showStart = true } = {}) => {
    const plans = state.data.plans;
    const p = planById(planId) || null;
    return `
      <label class="field"><span>${esc(T('plan'))}</span><select name="planId"><option value="">${esc(T('noPlanNow'))}</option>${plans.map((x) => `<option value="${x.id}" ${p && p.id === x.id ? 'selected' : ''}>${esc(`${x.emoji ? `${x.emoji} ` : ''}${x.name} — ${planLen(x)} · ${money(x.price)}`)}</option>`).join('')}</select></label>
      <div class="plan-only" ${p ? '' : 'hidden'}>
        <div class="grid2">
          ${showStart ? `<label class="field"><span>${esc(T('startDate'))}</span><input name="start" type="date" value=""><small id="start-hint"></small></label>` : ''}
          <label class="field"><span>${esc(T('price'))}</span><input name="price" type="number" min="0" step="any" inputmode="decimal" value="${p ? p.price : ''}"></label>
          <label class="field"><span>${esc(T('paidNow'))}</span><input name="paid" type="number" min="0" step="any" inputmode="decimal" value="${p ? p.price : ''}"></label>
          <label class="field"><span>${esc(T('payMethod'))}</span><select name="method">${methodOptions()}</select></label>
        </div>
      </div>`;
  };
  const wirePlanFields = (f, defaultStartHint) => {
    const sync = () => {
      const p = planById(f.planId.value);
      $('.plan-only', f).hidden = !p;
      if (p) {
        f.price.value = p.price;
        f.paid.value = p.price;
      }
    };
    f.planId.addEventListener('change', sync);
    f.price.addEventListener('input', () => (f.paid.value = f.price.value));
    if (f.start && defaultStartHint) $('#start-hint', f).textContent = defaultStartHint;
  };
  const planBody = (f) => (f.planId.value ? { planId: f.planId.value, start: f.start ? f.start.value : '', price: f.price.value, paid: f.paid.value, method: f.method.value } : {});

  function doneModal(member, whatsappUrl, title) {
    openModal(`<div class="ready-head"><div class="big">🎉</div><h3>${esc(title)}</h3><p class="muted">${esc(T('sendCardHint'))}</p></div>
      <div class="share-row"><input class="input" readonly value="${esc(member.cardUrl)}" dir="ltr"><button class="btn sm" data-act="copy" data-text="${esc(member.cardUrl)}" type="button">${ic('copy')}</button></div>
      <div class="modal-actions">
        ${member.member.phone ? `<a class="btn wa" href="${esc(whatsappUrl)}" target="_blank" rel="noopener">${ic('whatsapp')}${esc(T('sendCard'))}</a>` : ''}
        <button class="btn ghost" type="button" data-member-open="${member.member.id}">${esc(T('openProfile'))}</button>
      </div>`);
    $('[data-member-open]').addEventListener('click', () => memberModal(member.member.id));
  }

  const memberFields = (m = {}) => `
    <div class="photo-row">
      <label class="photo-pick" id="photo-pick" style="--h:${hue(m.name || '?')}">${m.photo ? `<img src="${esc(m.photo)}" alt="">` : ic('image')}<input type="file" accept="image/*" capture="user" hidden id="photo-file"></label>
      <div style="flex:1;min-width:0">
        <label class="field"><span>${esc(T('fullName'))} *</span><input name="name" required maxlength="80" value="${esc(m.name || '')}"></label>
        <label class="field"><span>${esc(T('phone'))}</span><input name="phone" type="tel" inputmode="tel" maxlength="30" value="${esc(m.phone || '')}" dir="ltr"></label>
      </div>
    </div>
    <div class="grid2">
      <label class="field"><span>${esc(T('gender'))}</span><select name="gender"><option value="">—</option><option value="m" ${m.gender === 'm' ? 'selected' : ''}>${esc(T('male'))}</option><option value="f" ${m.gender === 'f' ? 'selected' : ''}>${esc(T('female'))}</option></select></label>
      <label class="field"><span>${esc(T('birthday'))}</span><input name="birthday" type="date" value="${esc(m.birthday || '')}"></label>
    </div>
    <label class="field"><span>${esc(T('notes'))}</span><textarea name="notes" rows="2" maxlength="1000" placeholder="${esc(T('notesPh'))}">${esc(m.notes || '')}</textarea></label>`;
  const wirePhoto = (box, holder) => {
    $('#photo-file', box).addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        holder.photo = await uploadFile(file, 600);
        $('#photo-pick', box).innerHTML = `<img src="${esc(holder.photo)}" alt=""><input type="file" accept="image/*" capture="user" hidden id="photo-file">`;
        wirePhoto(box, holder);
      } catch {
        toast(T('tooLarge'), true);
      }
    });
  };
  const memberBody = (f, holder) => ({ name: f.name.value, phone: f.phone.value, gender: f.gender.value, birthday: f.birthday.value, notes: f.notes.value, photo: holder.photo || '' });

  function newMemberModal(prefill = {}) {
    if (!state.data.plans.length && !prefill.skipPlanHint) toast(T('addPlansFirst'));
    const holder = { photo: '' };
    const box = openModal(`<h3>${ic('plus')}${esc(T('newMember'))}</h3><form id="nm">
      ${memberFields(prefill)}
      <div class="sep"></div>
      ${planFields(prefill.planId || (state.data.plans[0] || {}).id)}
      <div class="modal-actions"><button class="btn" type="submit">${ic('check')}${esc(T('addMember'))}</button><button class="btn ghost" type="button" data-close>${esc(T('cancel'))}</button></div>
      <p class="error" id="err"></p></form>`);
    const f = $('#nm', box);
    wirePhoto(box, holder);
    wirePlanFields(f, '');
    if (f.start) f.start.value = today();
    f.name.focus();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!f.name.value.trim()) return ($('#err', box).textContent = T('nameRequired'));
      f.querySelector('[type=submit]').disabled = true;
      try {
        const r = await api('POST', '/api/admin/members', { ...memberBody(f, holder), ...planBody(f), leadId: prefill.leadId || '' });
        doneModal(r, r.whatsappUrl, T('memberAdded'));
        refresh();
      } catch (err) {
        $('#err', box).textContent = T(err.code === 'name_required' ? 'nameRequired' : 'error');
        f.querySelector('[type=submit]').disabled = false;
      }
    });
  }

  async function sellModal(memberId) {
    const d = await api('GET', `/api/admin/members/${memberId}`);
    const running = ['active', 'frozen', 'upcoming'].includes(d.status) && d.end;
    const hint = running ? fill(T('renewStartsHint'), { date: fmtDate(addDays(d.end, 1)) }) : '';
    const box = openModal(`<h3>${ic('cash')}${esc(T('renewTitle'))} · ${esc(d.name)}</h3><form id="sell">
      ${planFields(d.subs.length ? d.subs[0].planId : (state.data.plans[0] || {}).id)}
      <div class="modal-actions"><button class="btn" type="submit">${ic('check')}${esc(T('confirmRenew'))}</button><button class="btn ghost" type="button" data-close>${esc(T('cancel'))}</button></div>
      <p class="error" id="err"></p></form>`);
    const f = $('#sell', box);
    $('option[value=""]', f).remove();
    $('.plan-only', f).hidden = !f.planId.value;
    wirePlanFields(f, hint);
    if (!running) f.start.value = today();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await api('POST', `/api/admin/members/${memberId}/subs`, planBody(f));
        doneModal(r, r.whatsappUrl, T('renewed'));
        refresh();
      } catch {
        $('#err', box).textContent = T('error');
      }
    });
  }

  async function memberModal(id) {
    let d;
    try {
      d = await api('GET', `/api/admin/members/${id}`);
    } catch {
      return toast(T('error'), true);
    }
    const cur = d.subs.find((x) => x.id === d.currentSubId);
    const pct = cur ? (cur.visits ? Math.min(100, (cur.used / cur.visits) * 100) : Math.min(100, Math.max(0, ((Date.parse(today()) - Date.parse(cur.start)) / 864e5 + 1) / ((Date.parse(cur.end) - Date.parse(cur.start)) / 864e5 + 1) * 100))) : 0;
    const subDue = (x) => Math.max(0, Math.round((x.price - x.paid) * 100) / 100);
    const box = openModal(`
      <div class="detail-head">${avatar(d.member, 'av xl')}<div class="bd"><small class="muted">#${d.member.no} · ${esc(fill(T('memberSince'), { date: fmtDate(d.member.createdAt.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' }) }))}</small><h3>${esc(d.member.name)}</h3><div class="row-chips">${statusPill(d.status, d.soon)}${d.member.phone ? `<a href="tel:${esc(d.member.phone)}" class="muted" dir="ltr">${esc(d.member.phone)}</a>` : ''}</div></div>
        <button class="icon-btn" type="button" data-close aria-label="${esc(T('close'))}">${ic('x')}</button></div>
      <div class="quick-acts">
        <button class="btn sm" type="button" data-m="checkin">${ic('qr')}${esc(T('checkInNow'))}</button>
        <button class="btn sm line" type="button" data-m="sell">${ic('cash')}${esc(T('renew'))}</button>
        ${d.member.phone ? `<button class="btn sm wa" type="button" data-m="wa-${d.soon || d.status === 'expired' ? 'renew' : 'card'}">${ic('whatsapp')}${esc(T(d.soon || d.status === 'expired' ? 'remind' : 'sendCard'))}</button>` : ''}
        <button class="btn sm ghost" type="button" data-m="edit">${ic('edit')}${esc(T('edit'))}</button>
      </div>
      ${cur ? `<div class="plan-box ${d.status}">
        <div class="pb-top"><span class="pb-emoji">${esc(cur.emoji || '💪')}</span><div class="bd"><b>${esc(cur.planName)}</b><span>${esc(fmtDate(cur.start, { day: 'numeric', month: 'short', year: 'numeric' }))} → ${esc(fmtDate(cur.end, { day: 'numeric', month: 'short', year: 'numeric' }))}</span></div><b class="pb-left">${esc(leftLine(d))}</b></div>
        <div class="meter"><i style="width:${pct}%"></i></div>
        <div class="pb-foot">
          <span>${cur.visits ? `${cur.used}/${cur.visits} ${esc(T('unitVisits'))}` : ''}${(cur.freezes || []).length ? ` ${ic('pause', 'i xs')} ${cur.freezes.reduce((a, f) => a + f.days, 0)} ${esc(T('unitDays'))}` : ''}</span>
          <span>${subDue(cur) ? `<span class="chip due">${esc(T('due'))} ${esc(money(subDue(cur)))}</span> <button class="btn sm line" type="button" data-pay="${cur.id}" data-amount="${subDue(cur)}">${esc(T('addPayment'))}</button>` : `<span class="chip st-active">${ic('check', 'i xs')}${esc(T('paid'))}</span>`}</span>
          ${d.status === 'frozen' ? `<button class="btn sm line" type="button" data-unfreeze="${cur.id}">${ic('check')}${esc(T('unfreeze'))}</button>` : d.status === 'active' ? `<button class="btn sm ghost" type="button" data-freeze="${cur.id}">${ic('pause')}${esc(T('freeze'))}</button>` : ''}
        </div></div>` : `<div class="plan-box none"><p class="muted">${esc(T('noPlanYet'))}</p></div>`}
      ${d.member.notes ? `<p class="note-box">${ic('file', 'i xs')} ${esc(d.member.notes)}</p>` : ''}
      <div class="tabs-mini" role="tablist"><button type="button" class="active" data-pane="visits">${esc(T('visits'))} <small>${d.checkins.filter((c) => c.ok).length}</small></button><button type="button" data-pane="pays">${esc(T('payments'))} <small>${d.payments.length}</small></button><button type="button" data-pane="hist">${esc(T('planHistory'))} <small>${d.subs.length}</small></button></div>
      <div class="pane" data-pane-box="visits">${d.checkins.length ? `<div class="visit-grid">${d.checkins.slice(0, 40).map((c) => `<span class="${c.ok ? '' : 'bad'}" title="${esc(c.ok ? '' : T(`why_${c.reason}`))}"><b>${esc(fmtDate(c.date, { day: 'numeric', month: 'short' }))}</b>${esc(timeLabel(c.minutes))}</span>`).join('')}</div>` : `<p class="muted">${esc(T('noVisitsYet'))}</p>`}</div>
      <div class="pane" data-pane-box="pays" hidden>${d.payments.length ? d.payments.map((p) => `<div class="list-row static"><div class="bd"><b>${esc(money(p.amount))}</b><span>${esc(fmtDate(p.date, { day: 'numeric', month: 'short', year: 'numeric' }))} · ${esc(T(`pay_${p.method}`))}${p.note ? ` · ${esc(p.note)}` : ''}</span></div><button class="icon-btn" type="button" data-delpay="${p.id}" aria-label="${esc(T('delete'))}">${ic('trash')}</button></div>`).join('') : `<p class="muted">${esc(T('noPayments'))}</p>`}</div>
      <div class="pane" data-pane-box="hist" hidden>${d.subs.map((x) => `<div class="list-row static ${x.cancelled ? 'cancelled' : ''}"><span class="pb-emoji sm">${esc(x.emoji || '💪')}</span><div class="bd"><b>${esc(x.planName)}</b><span>${esc(fmtDate(x.start, { day: 'numeric', month: 'short', year: 'numeric' }))} → ${esc(fmtDate(x.end, { day: 'numeric', month: 'short', year: 'numeric' }))} · ${esc(money(x.price))}${subDue(x) && !x.cancelled ? ` · ${esc(T('due'))} ${esc(money(subDue(x)))}` : ''}</span></div>${x.cancelled ? `<span class="chip">${esc(T('cancelled'))}</span>` : `<button class="icon-btn" type="button" data-cancelsub="${x.id}" title="${esc(T('cancelPlan'))}" aria-label="${esc(T('cancelPlan'))}">${ic('x')}</button>`}</div>`).join('') || `<p class="muted">${esc(T('noPlanYet'))}</p>`}</div>
      <div class="modal-foot"><a class="btn sm ghost" href="${esc(d.cardUrl)}" target="_blank" rel="noopener">${ic('qr')}${esc(T('viewCard'))}</a><button class="btn sm danger" type="button" data-m="delete">${ic('trash')}${esc(T('deleteMember'))}</button></div>`, 'wide');

    box.addEventListener('click', async (e) => {
      const el = e.target.closest('[data-m],[data-pane],[data-pay],[data-freeze],[data-unfreeze],[data-delpay],[data-cancelsub]');
      if (!el) return;
      try {
        if (el.dataset.pane) {
          $$('[data-pane]', box).forEach((b) => b.classList.toggle('active', b === el));
          $$('[data-pane-box]', box).forEach((p) => (p.hidden = p.dataset.paneBox !== el.dataset.pane));
          return;
        }
        const act = el.dataset.m;
        if (act === 'checkin') {
          const r = await api('POST', '/api/admin/checkin', { memberId: id });
          toast(r.ok ? T(r.duplicate ? 'checkedInAgain' : 'checkedIn') : T(`why_${r.reason}`), !r.ok);
          memberModal(id);
          refresh();
        } else if (act === 'sell') sellModal(id);
        else if (act && act.startsWith('wa-')) {
          const { url } = await api('GET', `/api/admin/members/${id}/whatsapp?kind=${act.slice(3)}`);
          openWa(url);
        } else if (act === 'edit') editMemberModal(d);
        else if (act === 'delete') {
          if (!confirm(fill(T('deleteMemberConfirm'), { name: d.member.name }))) return;
          await api('DELETE', `/api/admin/members/${id}`);
          closeModal();
          toast(T('deleted'));
          refresh();
        } else if (el.dataset.pay) paymentModal(id, el.dataset.pay, el.dataset.amount);
        else if (el.dataset.freeze) freezeModal(id, el.dataset.freeze);
        else if (el.dataset.unfreeze) {
          await api('POST', `/api/admin/subs/${el.dataset.unfreeze}/unfreeze`, {});
          toast(T('saved'));
          memberModal(id);
          refresh();
        } else if (el.dataset.delpay) {
          if (!confirm(T('deletePaymentConfirm'))) return;
          await api('DELETE', `/api/admin/payments/${el.dataset.delpay}`);
          memberModal(id);
          refresh();
        } else if (el.dataset.cancelsub) {
          if (!confirm(T('cancelPlanConfirm'))) return;
          await api('DELETE', `/api/admin/subs/${el.dataset.cancelsub}`);
          memberModal(id);
          refresh();
        }
      } catch (err) {
        if (err.message !== 'unauthorized') toast(T('error'), true);
      }
    });
  }

  function editMemberModal(d) {
    const holder = { photo: d.member.photo };
    const box = openModal(`<h3>${ic('edit')}${esc(T('edit'))}</h3><form id="em">${memberFields(d.member)}
      <div class="modal-actions"><button class="btn" type="submit">${ic('check')}${esc(T('save'))}</button><button class="btn ghost" type="button" data-back>${esc(T('cancel'))}</button></div>
      <p class="error" id="err"></p></form>`);
    const f = $('#em', box);
    wirePhoto(box, holder);
    $('[data-back]', box).addEventListener('click', () => memberModal(d.member.id));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('PUT', `/api/admin/members/${d.member.id}`, memberBody(f, holder));
        toast(T('saved'));
        memberModal(d.member.id);
        refresh();
      } catch {
        $('#err', box).textContent = T('error');
      }
    });
  }

  function paymentModal(memberId, subId, amount) {
    const box = openModal(`<h3>${ic('cash')}${esc(T('addPayment'))}</h3><form id="pf"><div class="grid2">
      <label class="field"><span>${esc(T('amount'))}</span><input name="amount" type="number" min="0" step="any" inputmode="decimal" value="${esc(amount || '')}" required></label>
      <label class="field"><span>${esc(T('payMethod'))}</span><select name="method">${methodOptions()}</select></label></div>
      <label class="field"><span>${esc(T('note'))}</span><input name="note" maxlength="200"></label>
      <div class="modal-actions"><button class="btn" type="submit">${ic('check')}${esc(T('save'))}</button><button class="btn ghost" type="button" data-back>${esc(T('cancel'))}</button></div></form>`);
    const f = $('#pf', box);
    $('[data-back]', box).addEventListener('click', () => memberModal(memberId));
    f.amount.focus();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('POST', `/api/admin/members/${memberId}/payments`, { subId, amount: f.amount.value, method: f.method.value, note: f.note.value });
        toast(T('saved'));
        memberModal(memberId);
        refresh();
      } catch {
        toast(T('error'), true);
      }
    });
  }

  function freezeModal(memberId, subId) {
    const box = openModal(`<h3>${ic('pause')}${esc(T('freeze'))}</h3><p class="muted">${esc(T('freezeHint'))}</p><form id="ff">
      <div class="quick-days">${[7, 14, 30, 60].map((n) => `<button type="button" class="btn sm ghost" data-days="${n}">${n} ${esc(T('unitDays'))}</button>`).join('')}</div>
      <div class="grid2"><label class="field"><span>${esc(T('freezeDays'))}</span><input name="days" type="number" min="1" max="180" value="14" required></label>
      <label class="field"><span>${esc(T('startDate'))}</span><input name="from" type="date" value="${today()}" min="${today()}"></label></div>
      <div class="modal-actions"><button class="btn" type="submit">${ic('pause')}${esc(T('freeze'))}</button><button class="btn ghost" type="button" data-back>${esc(T('cancel'))}</button></div></form>`);
    const f = $('#ff', box);
    $('[data-back]', box).addEventListener('click', () => memberModal(memberId));
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-days]');
      if (b) f.days.value = b.dataset.days;
    });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('POST', `/api/admin/subs/${subId}/freeze`, { days: f.days.value, from: f.from.value });
        toast(T('saved'));
        memberModal(memberId);
        refresh();
      } catch (err) {
        toast(T(err.code === 'overlap' ? 'freezeOverlap' : 'error'), true);
      }
    });
  }

  // ======================= PLANS & TIMETABLE =======================
  VIEWS.plans = async (view) => {
    const plans = state.data.plans;
    const classes = state.data.classes;
    const order = Array.from({ length: 7 }, (_, i) => (dow(today()) + i) % 7);
    view.innerHTML = `
      <div class="page-head"><h2 class="title">${esc(T('plans'))}</h2><span style="flex:1"></span><button class="btn" type="button" data-new-plan>${ic('plus')}${esc(T('addPlan'))}</button></div>
      <div class="card" style="padding:6px 16px">${plans.length ? plans.map((p, i) => `<div class="list-row" data-plan="${p.id}">
          <span class="pb-emoji" style="--h:${hue(p.name)}">${esc(p.emoji || p.name.charAt(0))}</span>
          <div class="bd"><b>${esc(p.name)}${p.featured ? ` <span class="chip st-soon">${ic('star', 'i xs')}${esc(T('featured'))}</span>` : ''}${p.public === false ? ` <span class="chip">${esc(T('hidden'))}</span>` : ''}</b><span>${esc(planLen(p))}${p.description ? ` · ${esc(p.description)}` : ''}</span></div>
          <b class="price">${esc(money(p.price))}</b>
          <div class="acts"><button class="icon-btn" type="button" data-move="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="↑">${ic('arrow-up')}</button><button class="icon-btn" type="button" data-move="${i}" data-dir="1" ${i === plans.length - 1 ? 'disabled' : ''} aria-label="↓">${ic('arrow-down')}</button></div>
        </div>`).join('') : `<div class="empty-state"><div class="big">🏷️</div><p>${esc(T('noPlans'))}</p></div>`}</div>
      <div class="page-head" style="margin-top:8px"><h2 class="title sm">${ic('calendar')}${esc(T('timetable'))}</h2><span style="flex:1"></span><button class="btn line" type="button" data-new-class>${ic('plus')}${esc(T('addClass'))}</button></div>
      <p class="muted small" style="margin-top:-10px">${esc(T('timetableHint'))}</p>
      <div class="tt-grid">${order.map((d) => {
        const list = classes.filter((c) => c.day === d);
        return `<div class="tt-col${d === dow(today()) ? ' today' : ''}"><h4>${esc(dayName(d))}</h4>${list.map((c) => `<button type="button" class="tt-item" data-class="${c.id}" style="--h:${hue(c.title)}"><b>${esc(timeLabel(c.start))}</b><span>${esc(c.title)}</span>${c.coach ? `<small>${esc(c.coach)}</small>` : ''}</button>`).join('') || `<p class="muted small">—</p>`}<button type="button" class="tt-add" data-new-class="${d}" aria-label="${esc(T('addClass'))}">${ic('plus')}</button></div>`;
      }).join('')}</div>`;
    view.onclick = async (e) => {
      const mv = e.target.closest('[data-move]');
      if (mv) {
        e.stopPropagation();
        const i = Number(mv.dataset.move);
        const j = i + Number(mv.dataset.dir);
        const ids = plans.map((p) => p.id);
        [ids[i], ids[j]] = [ids[j], ids[i]];
        await api('POST', '/api/admin/reorder', { ids });
        await loadData();
        return renderTab();
      }
      const p = e.target.closest('[data-plan]');
      const np = e.target.closest('[data-new-plan]');
      const c = e.target.closest('[data-class]');
      const nc = e.target.closest('[data-new-class]');
      if (p) planModal(planById(p.dataset.plan));
      else if (np) planModal(null);
      else if (c) classModal(classes.find((x) => x.id === c.dataset.class));
      else if (nc) classModal(null, nc.dataset.newClass === '' ? dow(today()) : Number(nc.dataset.newClass));
    };
  };

  const EMOJIS = ['💪', '🔥', '🏆', '🎟️', '☀️', '🧘', '🥊', '🥋', '⚽', '🏊', '🚴', '⭐', '✨', '🌿'];
  function planModal(p) {
    const v = p || { name: '', emoji: '💪', description: '', price: '', months: 1, days: 0, visits: 0, public: true, featured: false };
    const box = openModal(`<h3>${ic('tag')}${esc(p ? T('editPlan') : T('addPlan'))}</h3><form id="pm">
      <label class="field"><span>${esc(T('planName'))}</span><input name="name" required maxlength="80" value="${esc(v.name)}" placeholder="${esc(T('planNamePh'))}"></label>
      <div class="emoji-pick">${EMOJIS.map((e) => `<button type="button" data-emoji="${e}" class="${e === v.emoji ? 'active' : ''}">${e}</button>`).join('')}<input name="emoji" maxlength="8" value="${esc(v.emoji)}" aria-label="Emoji"></div>
      <div class="grid2">
        <label class="field"><span>${esc(T('price'))}</span><input name="price" type="number" min="0" step="any" inputmode="decimal" value="${esc(v.price)}"></label>
        <label class="field"><span>${esc(T('visitsLimit'))}</span><input name="visits" type="number" min="0" max="1000" value="${esc(v.visits || 0)}"><small>${esc(T('visitsLimitHint'))}</small></label>
        <label class="field"><span>${esc(T('lengthMonths'))}</span><div class="unit"><input name="months" type="number" min="0" max="36" value="${esc(v.months)}"><span>${esc(T('unitMonths'))}</span></div></label>
        <label class="field"><span>${esc(T('lengthDays'))}</span><div class="unit"><input name="days" type="number" min="0" max="366" value="${esc(v.days)}"><span>${esc(T('unitDays'))}</span></div></label>
      </div>
      <label class="field"><span>${esc(T('description'))}</span><input name="description" maxlength="400" value="${esc(v.description)}" placeholder="${esc(T('planDescPh'))}"></label>
      ${sw('public', v.public !== false, esc(T('showOnPage')))}
      ${sw('featured', !!v.featured, esc(T('featuredHint')))}
      <div class="modal-actions"><button class="btn" type="submit">${ic('check')}${esc(T('save'))}</button>${p ? `<button class="btn danger" type="button" data-del>${ic('trash')}</button>` : ''}<button class="btn ghost" type="button" data-close>${esc(T('cancel'))}</button></div>
      <p class="error" id="err"></p></form>`);
    const f = $('#pm', box);
    box.addEventListener('click', (e) => {
      const em = e.target.closest('[data-emoji]');
      if (em) {
        f.emoji.value = em.dataset.emoji;
        $$('[data-emoji]', box).forEach((b) => b.classList.toggle('active', b === em));
      }
    });
    const del = $('[data-del]', box);
    if (del) del.addEventListener('click', async () => {
      if (!confirm(T('deletePlanConfirm'))) return;
      await api('DELETE', `/api/admin/plans/${p.id}`);
      closeModal();
      await loadData();
      renderTab();
    });
    f.name.focus();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { name: f.name.value, emoji: f.emoji.value, price: f.price.value, visits: f.visits.value, months: f.months.value, days: f.days.value, description: f.description.value, public: f.public.checked, featured: f.featured.checked };
      try {
        await api(p ? 'PUT' : 'POST', p ? `/api/admin/plans/${p.id}` : '/api/admin/plans', body);
        closeModal();
        toast(T('saved'));
        await loadData();
        renderTab();
      } catch {
        $('#err', box).textContent = T('nameRequired');
      }
    });
  }

  function classModal(c, day = 0) {
    const v = c || { title: '', coach: '', day, start: 18 * 60, end: 19 * 60 };
    const box = openModal(`<h3>${ic('calendar')}${esc(c ? T('editClass') : T('addClass'))}</h3><form id="cm">
      <label class="field"><span>${esc(T('className'))}</span><input name="title" required maxlength="60" value="${esc(v.title)}" placeholder="${esc(T('classNamePh'))}"></label>
      <label class="field"><span>${esc(T('coach'))}</span><input name="coach" maxlength="60" value="${esc(v.coach)}"></label>
      <div class="grid3">
        <label class="field"><span>${esc(T('day'))}</span><select name="day">${Array.from({ length: 7 }, (_, i) => `<option value="${i}" ${i === Number(v.day) ? 'selected' : ''}>${esc(dayName(i))}</option>`).join('')}</select></label>
        <label class="field"><span>${esc(T('from'))}</span><input name="start" type="time" value="${hhmm(v.start)}" required></label>
        <label class="field"><span>${esc(T('to'))}</span><input name="end" type="time" value="${hhmm(v.end)}" required></label>
      </div>
      <div class="modal-actions"><button class="btn" type="submit">${ic('check')}${esc(T('save'))}</button>${c ? `<button class="btn danger" type="button" data-del>${ic('trash')}</button>` : ''}<button class="btn ghost" type="button" data-close>${esc(T('cancel'))}</button></div>
      <p class="error" id="err"></p></form>`);
    const f = $('#cm', box);
    const del = $('[data-del]', box);
    if (del) del.addEventListener('click', async () => {
      await api('DELETE', `/api/admin/classes/${c.id}`);
      closeModal();
      await loadData();
      renderTab();
    });
    f.title.focus();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { title: f.title.value, coach: f.coach.value, day: f.day.value, start: f.start.value, end: f.end.value };
      try {
        await api(c ? 'PUT' : 'POST', c ? `/api/admin/classes/${c.id}` : '/api/admin/classes', body);
        closeModal();
        await loadData();
        renderTab();
      } catch {
        $('#err', box).textContent = T('nameRequired');
      }
    });
  }

  const weekEditor = (week, prefix) => `<div class="sched-grid">${week.map((d, i) => `<div class="sched-row" data-${prefix}="${i}">
      <span class="sched-day">${esc(dayName(i))}</span>
      <label class="switch"><input type="checkbox" data-open ${d.open ? 'checked' : ''}><i></i></label>
      <input type="time" class="input" data-from value="${esc(d.from)}" ${d.open ? '' : 'disabled'}>
      <span class="muted">→</span>
      <input type="time" class="input" data-to value="${esc(d.to)}" ${d.open ? '' : 'disabled'}>
    </div>`).join('')}</div>`;
  const readWeek = (root, prefix) => $$(`[data-${prefix}]`, root).map((r) => ({ open: $('[data-open]', r).checked, from: $('[data-from]', r).value, to: $('[data-to]', r).value }));
  const wireWeek = (root) => root.addEventListener('change', (e) => {
    if (e.target.matches('[data-open]')) $$('input[type=time]', e.target.closest('.sched-row')).forEach((i) => (i.disabled = !e.target.checked));
  });


  // ======================= DESIGN =======================
  const COLORS = ['#7c3aed', '#db2777', '#e11d48', '#ea580c', '#ca8a04', '#16a34a', '#0f766e', '#0284c7', '#2563eb', '#111827'];
  const themeMini = (th) => `<div class="tp tp-${th}" aria-hidden="true"><i class="h"></i><div class="rows"><i><b></b></i><i><b></b></i><i><b></b></i><i><b></b></i></div></div>`;
  function loadFontCss(fonts) {
    for (const f of fonts) {
      if ($(`link[data-font-css="${f.key}"]`)) continue;
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = f.href;
      l.dataset.fontCss = f.key;
      document.head.appendChild(l);
    }
  }

  VIEWS.appearance = async (view) => {
    const s = state.data.settings;
    const opts = state.data.appearance;
    const draft = { theme: s.theme || 'fresh', color: s.color, font: s.font || 'cairo', logo: s.logo, cover: s.cover };
    const KEYS = Object.keys(draft);
    loadFontCss(opts.fonts);
    const imgPick = (key, wide) => `<div class="img-pick"><div class="preview${wide ? ' wide' : ''}" id="${key}-prev"></div><div style="display:grid;gap:6px"><label class="btn sm line" style="cursor:pointer">${ic('upload')}${esc(T('uploadImage'))}<input type="file" accept="image/*" id="${key}-file" hidden></label><button type="button" class="btn sm ghost" id="${key}-rm">${ic('trash')}${esc(T('removeImage'))}</button></div></div>`;
    view.innerHTML = `
      <div class="page-head"><h2 class="title">${esc(T('appearance'))}</h2><span class="unsaved" id="unsaved" hidden><i></i>${esc(T('unsaved'))}</span></div>
      <div class="design">
        <div class="design-controls">
          <div class="card"><h3>${ic('sparkles')}${esc(T('themeLabel'))}</h3>
            <div class="themes">${opts.themes.map((th) => `<button type="button" class="theme-card" data-theme="${th}">${themeMini(th)}<b>${esc(T(`theme_${th}`))}</b><span>${esc(T(`themeDesc_${th}`))}</span></button>`).join('')}</div></div>
          <div class="card"><h3>${ic('palette')}${esc(T('brandColor'))}</h3>
            <div class="swatches" id="swatches">${COLORS.map((c) => `<button type="button" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}<label class="custom-color"><input type="color" id="color" value="${esc(draft.color)}"></label></div></div>
          <div class="card"><h3><span class="aa">Aa</span>${esc(T('font'))}</h3>
            <div class="fonts">${opts.fonts.map((f) => `<button type="button" class="font-card" data-font="${f.key}" style="font-family:${esc(f.stack)}"><span class="sample">Aa أب</span><small>${esc(f.label)}</small></button>`).join('')}</div></div>
          <div class="card"><h3>${ic('image')}${esc(T('logo'))} · ${esc(T('cover'))}</h3>
            <div class="grid2"><div class="field"><span>${esc(T('logo'))}</span>${imgPick('logo')}</div><div class="field"><span>${esc(T('cover'))}</span>${imgPick('cover', true)}</div></div></div>
          <div class="save-bar"><button class="btn block" type="button" id="dsave">${ic('check')}${esc(T('save'))}</button></div>
        </div>
        <div class="design-preview">
          <div class="phone"><div class="notch"></div><iframe id="pv" src="/?preview=1&lang=${encodeURIComponent(s.lang)}" title="${esc(T('livePreview'))}"></iframe></div>
          <p class="muted small preview-hint">${ic('eye')}<span>${esc(T('previewHint'))}</span></p>
        </div>
      </div>`;
    const pv = $('#pv');
    const send = () => {
      const font = opts.fonts.find((f) => f.key === draft.font) || opts.fonts[0];
      if (pv.contentWindow) pv.contentWindow.postMessage({ type: 'nadi-preview', theme: draft.theme, color: draft.color, fontStack: font.stack, fontHref: font.href, logo: draft.logo, cover: draft.cover }, location.origin);
    };
    const sync = () => {
      $$('.theme-card', view).forEach((b) => b.classList.toggle('active', b.dataset.theme === draft.theme));
      $$('.font-card', view).forEach((b) => b.classList.toggle('active', b.dataset.font === draft.font));
      $$('#swatches [data-color]', view).forEach((b) => b.classList.toggle('active', b.dataset.color.toLowerCase() === draft.color.toLowerCase()));
      $('#color').value = draft.color;
      view.style.setProperty('--c', draft.color);
      $('#logo-prev').innerHTML = draft.logo ? `<img src="${esc(draft.logo)}" alt="">` : ic('store');
      $('#cover-prev').innerHTML = draft.cover ? `<img src="${esc(draft.cover)}" alt="">` : ic('image');
      $('#logo-rm').hidden = !draft.logo;
      $('#cover-rm').hidden = !draft.cover;
      $('#unsaved').hidden = !KEYS.some((k) => (draft[k] || '') !== (s[k] || ''));
      send();
    };
    pv.addEventListener('load', send);
    view.onclick = (e) => {
      const th = e.target.closest('[data-theme]');
      const fo = e.target.closest('[data-font]');
      const co = e.target.closest('[data-color]');
      if (th) draft.theme = th.dataset.theme;
      else if (fo) draft.font = fo.dataset.font;
      else if (co) draft.color = co.dataset.color;
      else return;
      sync();
    };
    $('#color').addEventListener('input', (e) => { draft.color = e.target.value; sync(); });
    for (const [key, max] of [['logo', 512], ['cover', 1600]]) {
      $(`#${key}-file`).addEventListener('change', async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try { draft[key] = await uploadFile(f, max); sync(); } catch { toast(T('tooLarge'), true); }
      });
      $(`#${key}-rm`).addEventListener('click', () => { draft[key] = ''; sync(); });
    }
    $('#dsave').addEventListener('click', async () => {
      try {
        const { settings } = await api('PUT', '/api/admin/settings', draft);
        state.data.settings = settings;
        document.documentElement.style.setProperty('--brand', settings.color);
        toast(T('saved'));
        renderShell();
      } catch {
        toast(T('error'), true);
      }
    });
    sync();
  };

  // ======================= SHARE =======================
  VIEWS.share = async (view) => {
    const s = state.data.settings;
    const link = state.data.baseUrl;
    const qr = `/api/admin/qr.svg?text=${encodeURIComponent(link)}`;
    const text = `${T('shareText').replace('{name}', s.name)}\n${link}`;
    view.innerHTML = `
      <h2 class="title">${esc(T('shareTitle'))}</h2>
      <div class="card"><div class="qr-box"><img src="${qr}" alt="QR"><div>
        <p class="muted">${esc(T('shareSub'))}</p>
        <div class="share-row" style="margin-bottom:10px"><input class="input" readonly value="${esc(link)}"><button class="btn sm" data-act="copy" data-text="${esc(link)}">${ic('copy')}${esc(T('copy'))}</button></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn line sm" href="${qr}" download="qr-${esc(s.name)}.svg">${ic('download')}${esc(T('downloadQr'))}</a>
          <a class="btn line sm" href="/admin/poster" target="_blank">${ic('print')}${esc(T('printPoster'))}</a>
          <a class="btn wa sm" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">${ic('whatsapp')}${esc(T('shareWhatsApp'))}</a>
        </div></div></div></div>
      <div class="card kiosk-card"><h3>${ic('tablet')}${esc(T('kioskTitle'))}</h3>
        <p class="muted small">${esc(T('kioskHint'))}</p>
        <ol class="steps-list"><li>${esc(T('kioskStep1'))}</li><li>${esc(T('kioskStep2'))}</li><li>${esc(T('kioskStep3'))}</li></ol>
        <div class="share-row"><input class="input" readonly value="${esc(state.data.kioskUrl)}" dir="ltr"><button class="btn sm" data-act="copy" data-text="${esc(state.data.kioskUrl)}">${ic('copy')}</button></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <a class="btn line sm" href="${esc(state.data.kioskUrl)}" target="_blank" rel="noopener">${ic('external')}${esc(T('openKiosk'))}</a>
          <button class="btn ghost sm" type="button" id="kreset">${ic('lock')}${esc(T('kioskReset'))}</button>
        </div></div>
      <div class="card"><h3>${ic('bulb')}${esc(T('tipsTitle'))}</h3><ul class="checklist">${['tip1', 'tip2', 'tip3', 'tip4'].map((k) => `<li><span class="tick">${ic('sparkles')}</span>${esc(T(k))}</li>`).join('')}</ul></div>`;
    $('#kreset', view).addEventListener('click', async () => {
      if (!confirm(T('kioskResetConfirm'))) return;
      try {
        await api('POST', '/api/admin/kiosk/reset', {});
        await loadData();
        toast(T('saved'));
        renderTab();
      } catch (err) {
        toast(err.code === 'demo' ? T('demoBlocked') : T('error'), true);
      }
    });
  };

  // ======================= SETTINGS =======================
  // ---- Telegram notifications card (Settings) ----
  async function renderNotify(box) {
    const n = await api('GET', '/api/admin/notify');
    box.innerHTML = `
      <h3>${ic('bell')}${esc(T('notifications'))}${n.connected ? `<span class="ok-chip">${ic('check')}${esc(T('notifyConnected'))}</span>` : ''}</h3>
      <p class="muted small" style="margin-top:-6px">${esc(T('notifyHint'))}</p>
      <ol class="steps-list"><li>${esc(T('notifyStep1'))}</li><li>${esc(T('notifyStep2'))}</li><li>${esc(T('notifyStep3'))}</li></ol>
      <form id="nf">
        <label class="field"><span>${esc(T('botToken'))}</span><input name="token" autocomplete="off" spellcheck="false" placeholder="123456789:AA…" dir="ltr">${n.hasToken ? `<small>${esc(T('tokenSaved').replace('{hint}', n.tokenHint))}</small>` : ''}</label>
        <div class="share-row" style="align-items:flex-end">
          <label class="field" style="flex:1;margin:0"><span>${esc(T('chatId'))}</span><input name="chat" value="${esc(n.telegramChat)}" dir="ltr"></label>
          <button class="btn line" type="button" id="ndetect">${ic('search')}${esc(T('detectChat'))}</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
          <button class="btn" type="submit">${ic('check')}${esc(T('save'))}</button>
          <button class="btn line" type="button" id="ntest" ${n.connected ? '' : 'disabled'}>${ic('bell')}${esc(T('sendTest'))}</button>
          ${n.hasToken ? `<button class="btn danger" type="button" id="nclear">${esc(T('disconnect'))}</button>` : ''}
        </div>
      </form>`;
    const f = $('#nf', box);
    const fail = (err, fallback) => toast(err.code === 'demo' ? T('demoBlocked') : err.code === 'invalid_token' ? T('invalidToken') : T(fallback), true);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('PUT', '/api/admin/notify', { telegramToken: f.token.value, telegramChat: f.chat.value });
        toast(T('saved'));
        renderNotify(box);
      } catch (err) { fail(err, 'error'); }
    });
    $('#ndetect', box).addEventListener('click', async () => {
      try {
        const r = await api('POST', '/api/admin/notify/detect', { telegramToken: f.token.value });
        if (!r.chats.length) return toast(T('chatNotFound'), true);
        f.chat.value = r.chats[0].id;
        toast(`${T('chatFound')} ${r.chats[0].name}`);
      } catch (err) { fail(err, 'chatNotFound'); }
    });
    $('#ntest', box).addEventListener('click', async () => {
      try {
        await api('POST', '/api/admin/notify/test', { text: T('testMessage') });
        toast(T('testSent'));
      } catch (err) { fail(err, 'testFailed'); }
    });
    const clear = $('#nclear', box);
    if (clear) clear.addEventListener('click', async () => {
      try { await api('PUT', '/api/admin/notify', { clear: true }); renderNotify(box); } catch (err) { fail(err, 'error'); }
    });
  }

  VIEWS.settings = async (view) => {
    const s = state.data.settings;
    view.innerHTML = `
      <h2 class="title">${esc(T('settings'))}</h2>
      <form id="sf">
        <div class="card"><h3>${ic('store')}${esc(T('gym'))}</h3>
          <div class="grid2">
            <label class="field"><span>${esc(T('gymName'))}</span><input name="name" maxlength="80" value="${esc(s.name)}"></label>
            <label class="field"><span>${esc(T('defaultLang'))}</span><select name="lang">${langOptions(s.lang)}</select></label>
          </div>
          <label class="field"><span>${esc(T('tagline'))}</span><input name="tagline" maxlength="140" value="${esc(s.tagline)}"></label>
          <label class="field"><span>${esc(T('about'))}</span><textarea name="about" rows="2" maxlength="1000">${esc(s.about)}</textarea></label>
          <div class="grid2">
            <label class="field"><span>${esc(T('whatsapp'))}</span><input name="whatsapp" type="tel" maxlength="20" value="${esc(s.whatsapp)}"><small>${esc(T('whatsappHint'))}</small></label>
            <label class="field"><span>${esc(T('currency'))}</span><input name="currency" maxlength="12" value="${esc(s.currency)}"></label>
          </div>
        </div>
        <div class="card"><h3>${ic('users')}${esc(T('membershipRules'))}</h3>
          ${sw('acceptingJoins', s.acceptingJoins, `${esc(T('acceptingJoins'))} <small class="muted">— ${esc(T('acceptingJoinsHint'))}</small>`)}
          ${sw('showPrices', s.showPrices, esc(T('showPrices')))}
          <div class="grid2">
            <label class="field"><span>${esc(T('graceDays'))}</span><div class="unit"><input name="graceDays" type="number" min="0" max="30" value="${esc(s.graceDays || 0)}"><span>${esc(T('unitDays'))}</span></div><small>${esc(T('graceDaysHint'))}</small></label>
          </div>
          <label class="field"><span>${esc(T('policy'))}</span><textarea name="policy" rows="2" maxlength="600" placeholder="${esc(T('policyPh'))}">${esc(s.policy)}</textarea></label>
        </div>
        <div class="card"><h3>${ic('clock')}${esc(T('hoursTitle'))}</h3>
          <div id="hours">${weekEditor(s.hours, 'bh')}</div>
          <label class="field" style="margin-top:12px"><span>${esc(T('timezone'))}</span><input name="timezone" list="tzlist" value="${esc(s.timezone || browserTimezone())}"></label>
          <datalist id="tzlist">${timezones().map((z) => `<option value="${esc(z)}">`).join('')}</datalist>
        </div>
        <div class="card"><h3>${ic('phone')}${esc(T('contact'))}</h3>
          <div class="grid2">
            <label class="field"><span>${esc(T('phone'))}</span><input name="phone" type="tel" maxlength="30" value="${esc(s.phone)}"></label>
            <label class="field"><span>${esc(T('address'))}</span><input name="address" maxlength="200" value="${esc(s.address)}"></label>
            <label class="field"><span>${esc(T('mapUrl'))}</span><input name="mapUrl" type="url" maxlength="500" value="${esc(s.mapUrl)}" placeholder="https://maps.app.goo.gl/…"></label>
            <label class="field"><span>Instagram</span><input name="instagram" maxlength="200" value="${esc(s.instagram)}" placeholder="@yourgym"></label>
            <label class="field"><span>TikTok</span><input name="tiktok" maxlength="200" value="${esc(s.tiktok)}" placeholder="@yourgym"></label>
            <label class="field"><span>Facebook</span><input name="facebook" maxlength="200" value="${esc(s.facebook)}"></label>
          </div>
        </div>
        <div class="save-bar" style="margin-bottom:16px"><button class="btn block" type="submit">${ic('check')}${esc(T('save'))}</button></div>
      </form>
      <div class="card" id="notify-card"></div>
      <div class="card"><h3>${ic('lock')}${esc(T('security'))}</h3>
        <form id="pw" class="grid2">
          <label class="field"><span>${esc(T('currentPassword'))}</span><input name="current" type="password" autocomplete="current-password" required></label>
          <label class="field"><span>${esc(T('newPassword'))}</span><input name="next" type="password" autocomplete="new-password" minlength="8" required></label>
          <div><button class="btn line" type="submit">${esc(T('changePassword'))}</button></div>
        </form></div>
      <div class="card"><h3>${ic('download')}${esc(T('backup'))}</h3><p class="muted small">${esc(T('backupHint'))}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn line" href="/api/admin/export" download>${ic('download')}${esc(T('exportData'))}</a>
        <label class="btn line" style="cursor:pointer">${ic('upload')}${esc(T('importData'))}<input type="file" accept="application/json,.json" id="imp" hidden></label>
        <a class="btn ghost" href="/api/admin/members.csv" download>${ic('file')}${esc(T('membersCsv'))}</a>
        <a class="btn ghost" href="/api/admin/payments.csv" download>${ic('file')}${esc(T('paymentsCsv'))}</a></div></div>`;
    renderNotify($('#notify-card', view));
    const f = $('#sf', view);
    wireWeek($('#hours', view));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { hours: readWeek(view, 'bh') };
      for (const el of f.elements) {
        if (!el.name) continue;
        body[el.name] = el.type === 'checkbox' ? el.checked : el.value;
      }
      try {
        const { settings } = await api('PUT', '/api/admin/settings', body);
        state.data.settings = settings;
        toast(T('saved'));
        await loadData();
        renderShell();
      } catch {
        toast(T('error'), true);
      }
    });
    $('#pw', view).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('PUT', '/api/admin/password', { current: e.target.current.value, next: e.target.next.value });
        e.target.reset();
        toast(T('passwordChanged'));
      } catch (err) {
        toast(err.code === 'demo' ? T('demoBlocked') : err.code === 'weak_password' ? T('weakPassword') : T('wrongPassword'), true);
      }
    });
    $('#imp', view).addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file || !confirm(T('importConfirm'))) return;
      try {
        await api('POST', '/api/admin/import', JSON.parse(await file.text()));
        await loadData();
        toast(T('imported'));
        renderShell();
      } catch (err) {
        toast(err.code === 'demo' ? T('demoBlocked') : T('invalidBackup'), true);
      }
    });
  };

  // ======================= global events =======================
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-tab],[data-act]');
    if (!el) return;
    try {
      if (el.dataset.tab) {
        e.preventDefault();
        closeModal();
        state.tab = el.dataset.tab;
        history.replaceState(null, '', `#${state.tab}`);
        renderTab();
        window.scrollTo(0, 0);
        return;
      }
      const act = el.dataset.act;
      if (act === 'logout') {
        await api('POST', '/api/logout');
        state.data = null;
        return boot();
      }
      if (act === 'copy') {
        await navigator.clipboard.writeText(el.dataset.text);
        return toast(T('copied'));
      }
      if (act === 'new-member') return newMemberModal();
    } catch (err) {
      if (err.message !== 'unauthorized') toast(T('error'), true);
    }
  });
  document.addEventListener('change', async (e) => {
    if (e.target.dataset && e.target.dataset.actChange === 'lang') {
      await setLang(e.target.value);
      if (state.data) renderShell();
      else boot();
    }
  });
  window.addEventListener('hashchange', () => {
    const h = location.hash.slice(1);
    if (state.data && TABS.some(([k]) => k === h) && h !== state.tab) {
      state.tab = h;
      renderTab();
    }
  });

  // ======================= join-request alerts =======================
  let pollTimer;
  let lastLead = null;
  function chime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.18].forEach((d) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.2, ctx.currentTime + d);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + d + 0.15);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + d);
        o.stop(ctx.currentTime + d + 0.16);
      });
    } catch { /* audio not allowed yet */ }
  }
  function startPolling() {
    clearInterval(pollTimer);
    const tick = async () => {
      if (!state.data) return;
      try {
        const p = await api('GET', '/api/admin/ping');
        setLeadDot(p.newLeads);
        if (lastLead !== null && p.lastLead && p.lastLead !== lastLead) {
          chime();
          toast(T('newLeadAlert'));
          if (['home', 'members'].includes(state.tab) && !$('#modal')) renderTab();
        }
        lastLead = p.lastLead;
      } catch { /* offline */ }
    };
    tick();
    pollTimer = setInterval(tick, 30000);
  }

  boot();
})();
