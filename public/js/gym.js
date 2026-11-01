(() => {
  'use strict';

  const D = window.NADI;
  const t = D.t;
  const gym = D.gym;
  const plans = new Map(D.plans.map((p) => [p.id, p]));
  const CUSTOMER_KEY = 'nadi-visitor';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ic = (name, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="${D.icons}#i-${name}"/></svg>`;
  const storage = {
    get(k, f) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? f : v; } catch { return f; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.innerHTML = `${ic('check')}<span>${esc(msg)}</span>`;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  // ------------------------------------------------------------ timetable
  const days = $('.tt-days');
  if (days) {
    days.addEventListener('click', (e) => {
      const b = e.target.closest('[data-day]');
      if (!b) return;
      $$('.tt-day', days).forEach((x) => {
        x.classList.toggle('on', x === b);
        x.setAttribute('aria-selected', x === b);
      });
      $$('.tt-list').forEach((l) => (l.hidden = l.dataset.list !== b.dataset.day));
    });
  }

  // ------------------------------------------------------------ join sheet
  function closeSheet() {
    const s = $('#sheet');
    if (!s) return;
    s.classList.add('closing');
    setTimeout(() => s.remove(), 200);
    document.body.style.overflow = '';
  }

  function openJoin(planId) {
    if (D.preview) return;
    const saved = storage.get(CUSTOMER_KEY, {});
    const el = document.createElement('div');
    el.className = 'sheet';
    el.id = 'sheet';
    const opts = [`<option value="">${esc(t.notSure)}</option>`, ...D.plans.map((p) => `<option value="${esc(p.id)}"${p.id === planId ? ' selected' : ''}>${esc(`${p.emoji ? `${p.emoji} ` : ''}${p.name}${p.price ? ` — ${p.price}` : ''}`)}</option>`)];
    el.innerHTML = `<div class="backdrop" data-close></div>
      <div class="panel" role="dialog" aria-modal="true" aria-labelledby="join-title">
        <span class="grab"></span>
        <button type="button" class="close" data-close aria-label="${esc(t.close)}">${ic('x')}</button>
        <div class="panel-body">
          <h2 id="join-title">${esc(t.joinTitle)}</h2>
          <p class="muted">${esc(t.joinSub)}</p>
          <form id="join" novalidate>
            <label class="field"><span>${esc(t.plan)}</span><select name="planId">${opts.join('')}</select></label>
            <label class="field"><span>${esc(t.yourName)} *</span><input name="name" autocomplete="name" maxlength="80" value="${esc(saved.name || '')}" required></label>
            <label class="field"><span>${esc(t.yourPhone)} *</span><input name="phone" type="tel" autocomplete="tel" maxlength="30" value="${esc(saved.phone || '')}" required></label>
            <label class="field"><span>${esc(t.message)}</span><textarea name="message" rows="2" maxlength="500" placeholder="${esc(t.messagePh)}"></textarea></label>
            <button class="btn block" type="submit">${ic('check')}<span>${esc(t.sendRequest)}</span></button>
            <p class="err" id="err" role="alert"></p>
          </form>
        </div>
      </div>`;
    document.body.appendChild(el);
    document.body.style.overflow = 'hidden';
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) closeSheet();
    });
    const f = $('#join', el);
    (saved.name ? f.message : f.name).focus({ preventScroll: true });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#err', el);
      if (!f.name.value.trim()) return (err.textContent = t.nameRequired);
      if (!f.phone.value.trim()) return (err.textContent = t.phoneRequired);
      const btn = f.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        const res = await fetch('/api/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Nadi': '1' },
          body: JSON.stringify({ planId: f.planId.value, name: f.name.value, phone: f.phone.value, message: f.message.value }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw Object.assign(new Error(data.error), { code: data.error });
        storage.set(CUSTOMER_KEY, { name: f.name.value.trim(), phone: f.phone.value.trim() });
        const p = plans.get(f.planId.value);
        $('.panel-body', el).innerHTML = `<div class="done">
          <svg class="check-anim" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44"/><path d="M30 52 l14 14 l27 -30"/></svg>
          <h2>${esc(t.requestSent)}</h2>
          <p class="muted">${esc(t.requestSentSub.replace('{gym}', gym.name))}</p>
          ${p ? `<p class="chosen"><span>${esc(p.emoji || '💪')}</span><b>${esc(p.name)}</b>${p.length !== p.name ? `<small>${esc(p.length)}</small>` : ''}</p>` : ''}
          ${gym.whatsapp ? `<a class="btn wa block" href="${esc(data.whatsappUrl)}" target="_blank" rel="noopener">${ic('whatsapp')}<span>${esc(t.alsoWhatsapp)}</span></a>` : ''}
          <button class="btn ghost block" type="button" data-close>${esc(t.done)}</button>
        </div>`;
      } catch (ex) {
        err.textContent = ex.code === 'rate_limited' ? t.rateLimited : ex.code === 'closed' ? t.joinClosed : t.error;
        btn.disabled = false;
      }
    });
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-join]');
    if (b) openJoin(b.dataset.join);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
  });

  // ------------------------------------------------------------- extras
  const shareBtn = $('#share');
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      const url = location.origin + location.pathname;
      try {
        if (navigator.share) await navigator.share({ title: gym.name, url });
        else { await navigator.clipboard.writeText(url); toast(t.linkCopied); }
      } catch { /* cancelled */ }
    });
  }
  const langSel = $('#lang');
  if (langSel) {
    langSel.addEventListener('change', () => {
      const url = new URL(location.href);
      url.searchParams.set('lang', langSel.value);
      location.href = url.toString();
    });
  }

  // Live preview from the admin's design screen (same origin only).
  if (D.preview) {
    addEventListener('message', (e) => {
      if (e.origin !== location.origin || !e.data || e.data.type !== 'nadi-preview') return;
      const d = e.data;
      if (d.theme) document.body.className = document.body.className.replace(/theme-\w+/, `theme-${d.theme}`);
      if (d.color) document.documentElement.style.setProperty('--brand', d.color);
      if (d.fontStack) document.documentElement.style.setProperty('--font', d.fontStack);
      if (d.fontHref) $('#font-css').href = d.fontHref;
      if ('logo' in d) $('#logo').innerHTML = d.logo ? `<img src="${esc(d.logo)}" alt="">` : `<span>${esc((gym.name || '?').charAt(0).toUpperCase())}</span>`;
      if ('cover' in d) {
        const cover = $('#cover');
        cover.classList.toggle('has-img', !!d.cover);
        const img = $('img', cover);
        if (d.cover) {
          if (img) img.src = d.cover;
          else cover.insertAdjacentHTML('afterbegin', `<img src="${esc(d.cover)}" alt="">`);
        } else if (img) img.remove();
      }
    });
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (a && !a.getAttribute('href').startsWith('#')) e.preventDefault();
    }, true);
  }
})();
