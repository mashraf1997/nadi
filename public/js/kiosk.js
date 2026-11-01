(() => {
  'use strict';

  const K = window.NADI_KIOSK;
  const t = K.t;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ic = (name, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="${K.icons}#i-${name}"/></svg>`;
  const fill = (s, v) => Object.entries(v).reduce((o, [k, x]) => o.split(`{${k}}`).join(x), s);
  const fmtDate = (d) => new Intl.DateTimeFormat(K.lang, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));

  const result = $('#result');
  let hideTimer;
  let busy = false;

  function show(html, cls) {
    result.className = `kiosk-result ${cls}`;
    result.innerHTML = html;
    result.hidden = false;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => (result.hidden = true), cls === 'ok' ? 3500 : 6000);
  }

  async function onCode(code) {
    if (busy) return;
    busy = true;
    try {
      const res = await fetch(`/api/kiosk/${encodeURIComponent(K.token)}/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Nadi': '1' },
        body: JSON.stringify({ code }),
      });
      const r = await res.json().catch(() => ({}));
      if (res.status === 404) {
        window.NadiScanner.beep(false);
        show(`<div class="big">${ic('x-circle')}</div><h2>${esc(t.unknownCard)}</h2><p>${esc(t.askDesk)}</p>`, 'bad');
        return;
      }
      if (!res.ok) throw new Error(r.error || 'error');
      const avatar = r.photo ? `<img class="k-avatar" src="${esc(r.photo)}" alt="">` : `<span class="k-avatar">${esc((r.name || '?').charAt(0).toUpperCase())}</span>`;
      if (r.ok) {
        window.NadiScanner.beep(true);
        let line = '';
        if (r.reason === 'grace') line = t.reason_grace;
        else if (r.visitsLeft !== null && r.visitsLeft !== undefined) line = fill(t.visitsLeft, { n: r.visitsLeft });
        else if (r.daysLeft) line = fill(t.daysLeft, { n: r.daysLeft });
        show(`${avatar}<h2>${esc(fill(r.duplicate ? t.alreadyIn : t.welcomeName, { name: r.name }))}</h2>${line ? `<p class="${r.soon || r.reason === 'grace' ? 'warn' : ''}">${esc(line)}</p>` : ''}${r.soon ? `<p class="small">${esc(t.renewSoon)}</p>` : ''}`, r.reason === 'grace' ? 'warn' : 'ok');
      } else {
        window.NadiScanner.beep(false);
        const why = t[`reason_${r.reason}`] || t.reason_expired;
        show(`${avatar}<h2>${esc(fill(t.sorryName, { name: r.name }))}</h2><p>${esc(r.reason === 'expired' && r.end ? fill(t.endedOn, { date: fmtDate(r.end) }) : why)}</p><p class="small">${esc(t.askDesk)}</p>`, 'bad');
      }
    } catch {
      show(`<h2>${esc(t.error)}</h2>`, 'bad');
    } finally {
      setTimeout(() => (busy = false), 1200);
    }
  }

  const startBtn = $('#start');
  async function start() {
    startBtn.hidden = true;
    try {
      await window.NadiScanner.start($('#video'), onCode);
      $('#vf').classList.add('live');
    } catch (err) {
      startBtn.hidden = false;
      show(`<div class="big">${ic('x-circle')}</div><h2>${esc(t.cameraError)}</h2>`, 'bad');
    }
  }
  startBtn.addEventListener('click', start);
  // Tablets that already granted the camera start straight away.
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'camera' }).then((p) => p.state === 'granted' && start()).catch(() => {});
  }

  const clock = $('#clock');
  const tick = () => (clock.textContent = new Date().toLocaleTimeString(K.lang, { hour: 'numeric', minute: '2-digit' }));
  tick();
  setInterval(tick, 10000);

  const langSel = $('#lang');
  if (langSel) langSel.addEventListener('change', () => {
    const url = new URL(location.href);
    url.searchParams.set('lang', langSel.value);
    location.href = url.toString();
  });

  // Keep the screen awake on tablets that support it.
  if ('wakeLock' in navigator) {
    const lock = () => navigator.wakeLock.request('screen').catch(() => {});
    lock();
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && lock());
  }
})();
