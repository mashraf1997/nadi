/* Agency panel: manage every client hosted on this server. Shared by Dukkan, Mawid and friends. */
(() => {
  'use strict';

  const STR = {
    en: {
      dir: 'ltr',
      hub: 'Agency',
      tagline: 'Host all your clients on one server',
      setupTitle: 'Set up your agency panel',
      setupSub: 'One panel to create, manage and bill every client on this server.',
      setupCode: 'Setup code',
      setupCodeHint: 'Printed in the server logs when the app starts.',
      password: 'Password',
      passwordHint: 'At least 8 characters.',
      currency: 'Currency for client fees',
      start: 'Open the panel',
      loginTitle: 'Agency panel',
      loginSub: 'Sign in to manage your clients.',
      login: 'Sign in',
      logout: 'Sign out',
      clients: 'Clients',
      newClient: 'New client',
      kClients: 'Clients',
      kActive: 'active',
      kIncome: 'Monthly income',
      kIncomeSub: 'from active clients',
      kDue: 'Due in 7 days',
      kOverdue: 'Overdue',
      all: 'All',
      overdue: 'Overdue',
      waiting: 'Waiting for setup',
      suspended: 'Suspended',
      active: 'Active',
      search: 'Search clients…',
      emptyTitle: 'Your first client is a minute away',
      emptyText: 'Create a client, send them their link and setup code, and they have their own {app} with its own admin.',
      step1: 'Create a client and pick their address',
      step2: 'Send them the link and setup code on WhatsApp',
      step3: 'Track who paid and suspend unpaid clients',
      noMatch: 'No clients match.',
      open: 'Open',
      admin: 'Admin',
      manage: 'Manage',
      paidUntil: 'Paid until',
      dueOn: 'Due {date}',
      overdueSince: 'Overdue since {date}',
      notBilled: 'No billing',
      last30: '{n} {metric} · 30 days',
      orders: 'orders',
      bookings: 'bookings',
      members: 'check-ins',
      tickets: 'tickets',
      clientName: 'Client name',
      clientNamePh: 'e.g. Bean & Leaf Café',
      address: 'Address',
      addressHint: 'Their page will be at {url}',
      domains: 'Custom domain (optional)',
      domainsHint: 'Ask the client to point the domain’s A record at this server. HTTPS is automatic.',
      phone: 'Client WhatsApp',
      price: 'Monthly fee',
      notes: 'Notes',
      notesPh: 'Plan, contact person, anything to remember',
      create: 'Create client',
      save: 'Save',
      cancel: 'Cancel',
      ready: 'Client ready',
      readySub: 'Send this to your client. They open the link, enter the code and create their password.',
      link: 'Link',
      code: 'Setup code',
      copy: 'Copy',
      copied: 'Copied',
      sendWa: 'Send on WhatsApp',
      waMsg: 'Hi! Your new page is ready 🎉\n\n1. Open: {url}/admin\n2. Enter the setup code: {code}\n3. Choose your password\n\nYour customers will use: {url}',
      waPw: 'Your new password for {url}/admin is: {pw}\nYou can change it from Settings after signing in.',
      renew: 'Paid +1 month',
      renewed: 'Paid until {date}',
      resetPw: 'New owner password',
      resetPwSure: 'Sign the client out everywhere and create a new password?',
      newPw: 'New password',
      newPwSub: 'Shown only once. Send it to the client.',
      suspend: 'Suspend',
      resume: 'Resume',
      suspendSure: 'Suspend this client? Their page and admin show “temporarily unavailable” until you resume.',
      del: 'Delete',
      delTitle: 'Delete client',
      delSub: 'Their page stops working. The data is moved to the trash folder on the server, not erased. Type {slug} to confirm.',
      delDone: 'Client deleted',
      settings: 'Settings',
      whiteLabel: 'White-label',
      whiteLabelHint: 'Shown at the bottom of every client page instead of the app name.',
      brandName: 'Your agency name',
      brandUrl: 'Your website',
      hideBranding: 'Hide the “powered by” line completely',
      invalid_url: 'The website must start with https://',
      currentPw: 'Current password',
      newPassword: 'New password',
      saved: 'Saved',
      dns: 'Domains & HTTPS',
      dnsText: 'Clients get <b>name.{base}</b>. Point a wildcard DNS record <code>*.{base}</code> (A record) at this server once, and every new client works instantly with HTTPS.',
      dnsLocal: 'BASE_DOMAIN is not set, so client addresses use <b>name.localhost</b>, which only works on this machine. Set BASE_DOMAIN to your domain to go live.',
      error: 'Something went wrong',
      label_required: 'Enter the client name',
      invalid_slug: 'Use 2–32 lowercase letters, numbers or dashes',
      slug_taken: 'That address is already used',
      invalid_domain: 'That domain doesn’t look right',
      domain_taken: 'That domain belongs to another client',
      invalid_price: 'Check the fee',
      invalid_setup_code: 'Wrong setup code',
      weak_password: 'Use at least 8 characters',
      wrong_password: 'Wrong password',
      rate_limited: 'Too many tries. Wait a few minutes.',
      not_setup: 'The client hasn’t finished setup yet. Send them the setup code instead.',
      confirm_mismatch: 'Type the address exactly to confirm',
      created: 'Created {date}',
    },
    ar: {
      dir: 'rtl',
      hub: 'لوحة الوكالة',
      tagline: 'كل عملاءك على سيرفر واحد',
      setupTitle: 'جهّز لوحة الوكالة',
      setupSub: 'لوحة واحدة تعمل منها وتدير وتحاسب كل العملاء اللي على السيرفر ده.',
      setupCode: 'كود الإعداد',
      setupCodeHint: 'بيظهر في لوج السيرفر لما التطبيق يشتغل.',
      password: 'كلمة السر',
      passwordHint: '8 حروف على الأقل.',
      currency: 'عملة اشتراكات العملاء',
      start: 'افتح اللوحة',
      loginTitle: 'لوحة الوكالة',
      loginSub: 'سجّل دخول عشان تدير عملاءك.',
      login: 'دخول',
      logout: 'خروج',
      clients: 'العملاء',
      newClient: 'عميل جديد',
      kClients: 'العملاء',
      kActive: 'شغالين',
      kIncome: 'الدخل الشهري',
      kIncomeSub: 'من العملاء الشغالين',
      kDue: 'مستحق خلال 7 أيام',
      kOverdue: 'متأخرين في الدفع',
      all: 'الكل',
      overdue: 'متأخرين',
      waiting: 'مستني الإعداد',
      suspended: 'موقوف',
      active: 'شغال',
      search: 'دوّر على عميل…',
      emptyTitle: 'أول عميل ليك على بعد دقيقة',
      emptyText: 'اعمل عميل، وابعتله اللينك وكود الإعداد، ويبقى عنده {app} خاص بيه ولوحة تحكم لوحده.',
      step1: 'اعمل عميل واختار عنوانه',
      step2: 'ابعتله اللينك والكود على واتساب',
      step3: 'تابع مين دفع، ووقّف اللي ما دفعش',
      noMatch: 'مفيش عملاء بالبحث ده.',
      open: 'افتح',
      admin: 'لوحته',
      manage: 'إدارة',
      paidUntil: 'مدفوع لحد',
      dueOn: 'مستحق {date}',
      overdueSince: 'متأخر من {date}',
      notBilled: 'من غير اشتراك',
      last30: '{n} {metric} · 30 يوم',
      orders: 'طلب',
      bookings: 'حجز',
      members: 'حضور',
      tickets: 'تذكرة',
      clientName: 'اسم العميل',
      clientNamePh: 'مثلًا: كافيه البن والورقة',
      address: 'العنوان',
      addressHint: 'صفحته هتبقى على {url}',
      domains: 'دومين خاص (اختياري)',
      domainsHint: 'العميل يوجّه سجل A بتاع الدومين للسيرفر ده، والـ HTTPS بيطلع أوتوماتيك.',
      phone: 'واتساب العميل',
      price: 'الاشتراك الشهري',
      notes: 'ملاحظات',
      notesPh: 'الباقة، اسم المسؤول، أي حاجة تفتكرها',
      create: 'اعمل العميل',
      save: 'حفظ',
      cancel: 'إلغاء',
      ready: 'العميل جاهز',
      readySub: 'ابعت ده للعميل: يفتح اللينك، ويكتب الكود، ويختار كلمة السر.',
      link: 'اللينك',
      code: 'كود الإعداد',
      copy: 'انسخ',
      copied: 'اتنسخ',
      sendWa: 'ابعت على واتساب',
      waMsg: 'أهلًا! صفحتك الجديدة جاهزة 🎉\n\n1. افتح: {url}/admin\n2. اكتب كود الإعداد: {code}\n3. اختار كلمة السر\n\nوده اللينك اللي عملاءك هيستخدموه: {url}',
      waPw: 'كلمة السر الجديدة للوحة {url}/admin هي: {pw}\nتقدر تغيّرها من الإعدادات بعد ما تدخل.',
      renew: 'دفع شهر',
      renewed: 'مدفوع لحد {date}',
      resetPw: 'كلمة سر جديدة للعميل',
      resetPwSure: 'هيتعمل خروج للعميل من كل الأجهزة وتتعمل كلمة سر جديدة. تكمّل؟',
      newPw: 'كلمة السر الجديدة',
      newPwSub: 'بتظهر مرة واحدة بس. ابعتها للعميل.',
      suspend: 'إيقاف',
      resume: 'تشغيل',
      suspendSure: 'توقف العميل ده؟ صفحته ولوحته هيظهر فيهم "مش متاحة دلوقتي" لحد ما ترجّعه.',
      del: 'حذف',
      delTitle: 'حذف العميل',
      delSub: 'صفحته هتقف. البيانات بتتنقل لفولدر trash على السيرفر ومش بتتمسح. اكتب {slug} للتأكيد.',
      delDone: 'العميل اتحذف',
      settings: 'الإعدادات',
      whiteLabel: 'باسم وكالتك (White-label)',
      whiteLabelHint: 'بيظهر تحت في كل صفحات العملاء بدل اسم التطبيق.',
      brandName: 'اسم وكالتك',
      brandUrl: 'موقعك',
      hideBranding: 'اخفي سطر «بواسطة» خالص',
      invalid_url: 'الموقع لازم يبدأ بـ https://',
      currentPw: 'كلمة السر الحالية',
      newPassword: 'كلمة السر الجديدة',
      saved: 'اتحفظ',
      dns: 'الدومينات والـ HTTPS',
      dnsText: 'كل عميل بياخد <b>name.{base}</b>. وجّه سجل DNS واحد <code>*.{base}</code> (سجل A) للسيرفر مرة واحدة، وكل عميل جديد هيشتغل على طول بـ HTTPS.',
      dnsLocal: 'BASE_DOMAIN مش متحدد، فعناوين العملاء على <b>name.localhost</b> ودي بتشتغل على الجهاز ده بس. حط الدومين بتاعك في BASE_DOMAIN عشان تنزل لايف.',
      error: 'حصلت مشكلة',
      label_required: 'اكتب اسم العميل',
      invalid_slug: 'من 2 لـ 32 حرف إنجليزي صغير أو رقم أو شَرطة',
      slug_taken: 'العنوان ده مستخدم',
      invalid_domain: 'الدومين ده شكله مش مظبوط',
      domain_taken: 'الدومين ده تبع عميل تاني',
      invalid_price: 'راجع الاشتراك',
      invalid_setup_code: 'كود الإعداد غلط',
      weak_password: '8 حروف على الأقل',
      wrong_password: 'كلمة السر غلط',
      rate_limited: 'محاولات كتير. استنى كام دقيقة.',
      not_setup: 'العميل لسه ما خلّصش الإعداد. ابعتله كود الإعداد.',
      confirm_mismatch: 'اكتب العنوان زي ما هو بالظبط',
      created: 'اتعمل {date}',
    },
  };

  const LANG_KEY = 'hub-lang';
  let lang = (() => {
    try {
      const v = localStorage.getItem(LANG_KEY);
      if (v && STR[v]) return v;
    } catch { /* ignore */ }
    return (navigator.language || '').startsWith('ar') ? 'ar' : 'en';
  })();
  const T = (k, vars) => {
    let s = (STR[lang] && STR[lang][k]) || STR.en[k] || k;
    if (vars) for (const [a, b] of Object.entries(vars)) s = s.split(`{${a}}`).join(b);
    return s;
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ic = (name, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="/img/icons.svg#i-${name}"/></svg>`;
  const root = $('#app');
  const state = { info: null, data: null, filter: 'all', q: '' };

  let toastTimer;
  function toast(msg, bad) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = `toast show${bad ? ' bad' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = 'toast'), 2400);
  }

  async function api(method, url, body) {
    const res = await fetch(`/hub/api${url}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Hub': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
    let data = {};
    try { data = await res.json(); } catch { /* empty */ }
    if (res.status === 401 && !['/login', '/settings'].includes(url)) {
      boot();
      throw Object.assign(new Error('unauthorized'), { code: 'unauthorized' });
    }
    if (!res.ok) throw Object.assign(new Error(data.error || 'error'), { code: data.error });
    return data;
  }
  const errMsg = (err) => (STR.en[err.code] ? T(err.code) : T('error'));

  const fmtDate = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const PREFIX = ['$', '€', '£', '¥', '₹', '₺', 'R$', 'US$'];
  const money = (n) => {
    const cur = (state.data && state.data.settings.currency) || '';
    const v = Math.round((Number(n) || 0) * 100) / 100;
    const str = v.toLocaleString(lang === 'ar' ? 'en' : lang);
    return PREFIX.includes(cur) ? `${cur}${str}` : `${str} ${cur}`.trim();
  };
  const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  const host = (url) => url.replace(/^https?:\/\//, '');

  function applyLang() {
    document.documentElement.lang = lang;
    document.documentElement.dir = T('dir');
  }
  const langBtn = () => `<button type="button" class="btn ghost sm" data-act="lang">${lang === 'ar' ? 'English' : 'العربية'}</button>`;

  // ---------------------------------------------------------------- auth
  const authShell = (inner) => `
    <div class="auth">
      <aside class="auth-side">
        <div class="auth-brand"><img src="/img/icon.svg" alt="" width="40" height="40"><b>${esc(state.info.appName)} · ${esc(T('hub'))}</b></div>
        <h2>${esc(T('tagline'))}</h2>
        <ul>${['step1', 'step2', 'step3'].map((k) => `<li>${ic('check')}<span>${esc(T(k))}</span></li>`).join('')}</ul>
      </aside>
      <div class="auth-main">${inner}</div>
    </div>`;

  function renderSetup() {
    root.innerHTML = authShell(`<form class="auth-card" id="setup" autocomplete="off">
      <div style="text-align:end">${langBtn()}</div>
      <img class="mark" src="/img/icon.svg" alt="">
      <h1>${esc(T('setupTitle'))}</h1>
      <p class="sub">${esc(T('setupSub'))}</p>
      <label class="field"><span>🔑 ${esc(T('setupCode'))}</span><input name="setupCode" required maxlength="12" placeholder="ABCD-EFGH" autocapitalize="characters" spellcheck="false" style="letter-spacing:.15em;font-weight:700"><small>${esc(T('setupCodeHint'))}</small></label>
      <label class="field"><span>${esc(T('password'))}</span><input name="password" type="password" required minlength="8" autocomplete="new-password"><small>${esc(T('passwordHint'))}</small></label>
      <label class="field"><span>${esc(T('currency'))}</span><input name="currency" maxlength="12" value="${lang === 'ar' ? 'EGP' : 'USD'}"></label>
      <button class="btn block" type="submit">${esc(T('start'))}</button>
      <p class="error" id="err"></p>
    </form>`);
    const f = $('#setup');
    f.setupCode.focus();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('POST', '/setup', { setupCode: f.setupCode.value, password: f.password.value, currency: f.currency.value });
        boot();
      } catch (err) {
        $('#err').textContent = errMsg(err);
      }
    });
  }

  function renderLogin() {
    root.innerHTML = authShell(`<form class="auth-card" id="login">
      <div style="text-align:end">${langBtn()}</div>
      <img class="mark" src="/img/icon.svg" alt="">
      <h1>${esc(T('loginTitle'))}</h1>
      <p class="sub">${esc(T('loginSub'))}</p>
      <label class="field"><span>${esc(T('password'))}</span><input name="password" type="password" required autocomplete="current-password"></label>
      <button class="btn block" type="submit">${esc(T('login'))}</button>
      <p class="error" id="err"></p>
    </form>`);
    const f = $('#login');
    f.password.focus();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('POST', '/login', { password: f.password.value });
        boot();
      } catch (err) {
        $('#err').textContent = errMsg(err);
      }
    });
  }

  // ---------------------------------------------------------------- main
  function billing(t, today) {
    if (!t.paidUntil) return { kind: 'none', text: T('notBilled') };
    if (t.paidUntil < today) return { kind: 'overdue', text: T('overdueSince', { date: fmtDate(t.paidUntil) }) };
    const days = (Date.parse(t.paidUntil) - Date.parse(today)) / 864e5;
    if (days <= 7) return { kind: 'due', text: T('dueOn', { date: fmtDate(t.paidUntil) }) };
    return { kind: 'ok', text: `${T('paidUntil')} ${fmtDate(t.paidUntil)}` };
  }

  function statusOf(t) {
    if (t.status === 'suspended') return 'suspended';
    if (!t.setupDone) return 'waiting';
    return 'active';
  }

  function renderMain() {
    const { tenants, today } = state.data;
    const active = tenants.filter((t) => t.status === 'active');
    const income = active.reduce((s, t) => s + (Number(t.price) || 0), 0);
    const overdue = tenants.filter((t) => t.status === 'active' && t.paidUntil && t.paidUntil < today);
    const due = tenants.filter((t) => t.status === 'active' && billing(t, today).kind === 'due');
    const counts = { all: tenants.length, overdue: overdue.length, waiting: tenants.filter((t) => statusOf(t) === 'waiting').length, suspended: tenants.filter((t) => t.status === 'suspended').length };

    root.innerHTML = `
      <header class="top">
        <img src="/img/icon.svg" alt="" width="36" height="36">
        <div class="shop">${esc(state.info.appName)} · ${esc(T('hub'))}<small class="muted">${esc(state.info.baseDomain)}</small></div>
        ${langBtn()}
        <button class="icon-btn" data-act="settings" title="${esc(T('settings'))}" aria-label="${esc(T('settings'))}" type="button">${ic('settings')}</button>
        <button class="icon-btn" data-act="logout" title="${esc(T('logout'))}" aria-label="${esc(T('logout'))}" type="button">${ic('logout')}</button>
      </header>
      <main class="hub-main">
        <div class="page-head">
          <h2 class="title">${esc(T('clients'))}</h2>
          <span style="flex:1"></span>
          <button class="btn" data-act="new" type="button">${ic('plus')}<span>${esc(T('newClient'))}</span></button>
        </div>
        <div class="kpis">
          <div class="kpi"><div class="kpi-ic c1">${ic('users')}</div><div class="kpi-body"><span class="label">${esc(T('kClients'))}</span><div class="value">${tenants.length}</div><span class="sub">${active.length} ${esc(T('kActive'))}</span></div></div>
          <div class="kpi"><div class="kpi-ic c2">${ic('cash')}</div><div class="kpi-body"><span class="label">${esc(T('kIncome'))}</span><div class="value">${esc(money(income))}</div><span class="sub">${esc(T('kIncomeSub'))}</span></div></div>
          <div class="kpi"><div class="kpi-ic c3">${ic('clock')}</div><div class="kpi-body"><span class="label">${esc(T('kDue'))}</span><div class="value">${due.length}</div><span class="sub">${esc(money(due.reduce((s, t) => s + t.price, 0)))}</span></div></div>
          <div class="kpi"><div class="kpi-ic c4">${ic('alert')}</div><div class="kpi-body"><span class="label">${esc(T('kOverdue'))}</span><div class="value">${overdue.length}</div><span class="sub">${esc(money(overdue.reduce((s, t) => s + t.price, 0)))}</span></div></div>
        </div>
        ${tenants.length ? `
        <div class="hub-tools">
          <div class="seg" role="tablist">${['all', 'overdue', 'waiting', 'suspended'].map((k) => `<button type="button" data-filter="${k}" class="${state.filter === k ? 'active' : ''}">${esc(T(k))} <small>${counts[k]}</small></button>`).join('')}</div>
          <input class="input hub-search" type="search" id="q" placeholder="${esc(T('search'))}" value="${esc(state.q)}">
        </div>
        <div class="clients" id="clients"></div>` : emptyState()}
        ${dnsCard()}
      </main>`;
    if (tenants.length) renderList();
    const q = $('#q');
    if (q) q.addEventListener('input', () => {
      state.q = q.value;
      renderList();
    });
  }

  const emptyState = () => `
    <div class="card hub-empty">
      <div class="big">🚀</div>
      <h3>${esc(T('emptyTitle'))}</h3>
      <p class="muted">${esc(T('emptyText', { app: state.info.appName }))}</p>
      <ol class="hub-steps">${['step1', 'step2', 'step3'].map((k, i) => `<li><b>${i + 1}</b><span>${esc(T(k))}</span></li>`).join('')}</ol>
      <button class="btn" data-act="new" type="button">${ic('plus')}<span>${esc(T('newClient'))}</span></button>
    </div>`;

  const dnsCard = () => {
    const base = state.info.baseDomain;
    const local = base === 'localhost';
    return `<div class="card hub-dns"><h3>${ic('globe')}${esc(T('dns'))}</h3><p class="muted small">${local ? T('dnsLocal') : T('dnsText', { base: esc(base) })}</p></div>`;
  };

  function renderList() {
    const { tenants, today } = state.data;
    const q = state.q.trim().toLowerCase();
    const list = tenants.filter((t) => {
      if (state.filter === 'overdue' && !(t.status === 'active' && t.paidUntil && t.paidUntil < today)) return false;
      if (state.filter === 'waiting' && statusOf(t) !== 'waiting') return false;
      if (state.filter === 'suspended' && t.status !== 'suspended') return false;
      if (q && ![t.label, t.slug, t.info.name, ...t.domains, t.notes].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
    const box = $('#clients');
    if (!list.length) {
      box.innerHTML = `<p class="muted" style="text-align:center;padding:30px">${esc(T('noMatch'))}</p>`;
      return;
    }
    box.innerHTML = list.map((t) => {
      const st = statusOf(t);
      const bill = billing(t, today);
      const name = t.info.name && t.setupDone ? t.info.name : t.label;
      const avatar = t.info.logo
        ? `<img src="${esc(t.url)}${esc(t.info.logo)}" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode('${esc(name.charAt(0).toUpperCase())}'))">`
        : esc(name.charAt(0).toUpperCase());
      return `<article class="client ${st}" data-id="${esc(t.id)}">
        <div class="c-avatar" style="--c:${esc(t.info.color || 'var(--brand)')}">${avatar}</div>
        <div class="c-main">
          <div class="c-name"><b>${esc(name)}</b><span class="tag ${st}">${esc(T(st))}</span></div>
          <a class="c-url" href="${esc(t.url)}" target="_blank" rel="noopener">${esc(host(t.url))}</a>
          <div class="c-meta">
            ${t.setupDone ? `<span>${ic('trend-up', 'i xs')}${esc(T('last30', { n: t.info.count30 || 0, metric: T(state.info.metric) }))}</span>` : `<span>🔑 <code>${esc(t.setupCode)}</code></span>`}
            <span class="bill ${bill.kind}">${esc(bill.text)}${t.price ? ` · ${esc(money(t.price))}` : ''}</span>
          </div>
        </div>
        <div class="c-actions">
          ${t.paidUntil || t.price ? `<button class="btn line sm" type="button" data-renew="${esc(t.id)}" title="${esc(T('renew'))}">${ic('cash')}<span class="hide-sm">${esc(T('renew'))}</span></button>` : ''}
          <a class="btn ghost sm" href="${esc(t.url)}/admin" target="_blank" rel="noopener">${ic('external')}<span class="hide-sm">${esc(T('admin'))}</span></a>
          <button class="btn sm" type="button" data-manage="${esc(t.id)}">${esc(T('manage'))}</button>
        </div>
      </article>`;
    }).join('');
  }

  // ---------------------------------------------------------------- modals
  function openModal(html) {
    closeModal();
    const el = document.createElement('div');
    el.className = 'modal';
    el.id = 'modal';
    el.innerHTML = `<div class="back" data-close></div><div class="box" role="dialog" aria-modal="true">${html}</div>`;
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

  const clientUrl = (slug) => {
    const port = location.port && state.info.baseDomain === 'localhost' ? `:${location.port}` : '';
    return `${location.protocol}//${slug || 'name'}.${state.info.baseDomain}${port}`;
  };

  function clientForm(t) {
    const v = t || { label: '', slug: '', domains: [], phone: '', price: '', paidUntil: '', notes: '' };
    return `
      <label class="field"><span>${esc(T('clientName'))}</span><input name="label" required maxlength="80" value="${esc(v.label)}" placeholder="${esc(T('clientNamePh'))}"></label>
      <label class="field"><span>${esc(T('address'))}</span>
        <div class="slug-row"><input name="slug" required maxlength="32" value="${esc(v.slug)}" dir="ltr" spellcheck="false" autocapitalize="none"><em dir="ltr">.${esc(state.info.baseDomain)}</em></div>
        <small id="slug-hint" dir="auto">${esc(T('addressHint', { url: host(clientUrl(v.slug)) }))}</small></label>
      <label class="field"><span>${esc(T('domains'))}</span><input name="domains" dir="ltr" maxlength="300" value="${esc(v.domains.join(', '))}" placeholder="bean-leaf.com" spellcheck="false" autocapitalize="none"><small>${esc(T('domainsHint'))}</small></label>
      <div class="grid2">
        <label class="field"><span>${esc(T('price'))}${state.data.settings.currency ? ` (${esc(state.data.settings.currency)})` : ''}</span><input name="price" type="number" min="0" step="any" inputmode="decimal" value="${esc(v.price || '')}"></label>
        <label class="field"><span>${esc(T('paidUntil'))}</span><input name="paidUntil" type="date" value="${esc(v.paidUntil)}"></label>
      </div>
      <label class="field"><span>${esc(T('phone'))}</span><input name="phone" type="tel" dir="ltr" maxlength="30" value="${esc(v.phone || '')}" placeholder="201001234567"></label>
      <label class="field"><span>${esc(T('notes'))}</span><textarea name="notes" rows="2" maxlength="500" placeholder="${esc(T('notesPh'))}">${esc(v.notes)}</textarea></label>`;
  }

  const formData = (f) => ({
    label: f.label.value,
    slug: f.slug.value,
    domains: f.domains.value,
    price: f.price.value || 0,
    paidUntil: f.paidUntil.value,
    phone: f.phone.value,
    notes: f.notes.value,
  });

  function wireSlug(f, auto) {
    let touched = !auto;
    const hint = () => ($('#slug-hint').textContent = T('addressHint', { url: host(clientUrl(f.slug.value)) }));
    f.label.addEventListener('input', () => {
      if (!touched) {
        f.slug.value = slugify(f.label.value);
        hint();
      }
    });
    f.slug.addEventListener('input', () => {
      touched = true;
      f.slug.value = f.slug.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
      hint();
    });
  }

  function openNew() {
    const box = openModal(`<h3>${esc(T('newClient'))}</h3><form id="cf">${clientForm(null)}
      <div class="modal-actions"><button class="btn" type="submit">${esc(T('create'))}</button><button class="btn ghost" type="button" data-close>${esc(T('cancel'))}</button></div>
      <p class="error" id="err"></p></form>`);
    const f = $('#cf', box);
    wireSlug(f, true);
    f.label.focus();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const t = await api('POST', '/tenants', formData(f));
        await load();
        showReady(t);
      } catch (err) {
        $('#err', box).textContent = errMsg(err);
      }
    });
  }

  const waLink = (phone, text) => `https://wa.me/${String(phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

  function copyRow(label, value) {
    return `<div class="copy-row"><span>${esc(label)}</span><code dir="ltr">${esc(value)}</code><button type="button" class="btn ghost sm" data-copy="${esc(value)}">${ic('copy')}<span>${esc(T('copy'))}</span></button></div>`;
  }

  function showReady(t) {
    const msg = T('waMsg', { url: t.url, code: t.setupCode });
    openModal(`<div class="ready-head"><div class="big">🎉</div><h3>${esc(T('ready'))}</h3><p class="muted">${esc(T('readySub'))}</p></div>
      ${copyRow(T('link'), `${t.url}/admin`)}
      ${copyRow(T('code'), t.setupCode)}
      <div class="modal-actions">
        <a class="btn wa" href="${esc(waLink(t.phone, msg))}" target="_blank" rel="noopener">${ic('whatsapp')}<span>${esc(T('sendWa'))}</span></a>
        <button class="btn ghost" type="button" data-close>OK</button>
      </div>`);
  }

  function openManage(id) {
    const t = state.data.tenants.find((x) => x.id === id);
    if (!t) return;
    const box = openModal(`<h3>${esc(t.info.name || t.label)}</h3>
      <p class="muted small">${esc(T('created', { date: fmtDate(t.createdAt.slice(0, 10)) }))} · <a href="${esc(t.url)}" target="_blank" rel="noopener" dir="ltr">${esc(host(t.url))}</a></p>
      ${!t.setupDone ? `${copyRow(T('code'), t.setupCode)}<a class="btn wa sm" style="margin-bottom:14px" href="${esc(waLink(t.phone, T('waMsg', { url: t.url, code: t.setupCode })))}" target="_blank" rel="noopener">${ic('whatsapp')}<span>${esc(T('sendWa'))}</span></a>` : ''}
      <form id="cf">${clientForm(t)}
        <div class="modal-actions"><button class="btn" type="submit">${esc(T('save'))}</button><button class="btn ghost" type="button" data-close>${esc(T('cancel'))}</button></div>
        <p class="error" id="err"></p>
      </form>
      <div class="danger-zone">
        ${t.setupDone ? `<button class="btn line sm" type="button" data-act="reset-pw">${ic('lock')}<span>${esc(T('resetPw'))}</span></button>` : ''}
        <button class="btn line sm" type="button" data-act="toggle">${ic(t.status === 'suspended' ? 'check' : 'pause')}<span>${esc(T(t.status === 'suspended' ? 'resume' : 'suspend'))}</span></button>
        <button class="btn danger sm" type="button" data-act="delete">${ic('trash')}<span>${esc(T('del'))}</span></button>
      </div>`);
    const f = $('#cf', box);
    wireSlug(f, false);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('PUT', `/tenants/${id}`, formData(f));
        closeModal();
        toast(T('saved'));
        load();
      } catch (err) {
        $('#err', box).textContent = errMsg(err);
      }
    });
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      try {
        if (b.dataset.act === 'toggle') {
          const next = t.status === 'suspended' ? 'active' : 'suspended';
          if (next === 'suspended' && !confirm(T('suspendSure'))) return;
          await api('PUT', `/tenants/${id}`, { status: next });
          closeModal();
          load();
        } else if (b.dataset.act === 'reset-pw') {
          if (!confirm(T('resetPwSure'))) return;
          const { password } = await api('POST', `/tenants/${id}/password`, {});
          openModal(`<h3>${esc(T('newPw'))}</h3><p class="muted">${esc(T('newPwSub'))}</p>${copyRow(T('password'), password)}
            <div class="modal-actions"><a class="btn wa" href="${esc(waLink(t.phone, T('waPw', { url: t.url, pw: password })))}" target="_blank" rel="noopener">${ic('whatsapp')}<span>${esc(T('sendWa'))}</span></a><button class="btn ghost" type="button" data-close>OK</button></div>`);
        } else if (b.dataset.act === 'delete') {
          openDelete(t);
        }
      } catch (err) {
        toast(errMsg(err), true);
      }
    });
  }

  function openDelete(t) {
    const box = openModal(`<h3>${esc(T('delTitle'))}</h3><p class="muted">${esc(T('delSub', { slug: t.slug }))}</p>
      <form id="df"><label class="field"><input name="confirm" dir="ltr" autocomplete="off" placeholder="${esc(t.slug)}"></label>
      <div class="modal-actions"><button class="btn danger" type="submit">${ic('trash')}<span>${esc(T('del'))}</span></button><button class="btn ghost" type="button" data-close>${esc(T('cancel'))}</button></div>
      <p class="error" id="err"></p></form>`);
    const f = $('#df', box);
    f.confirm.focus();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('DELETE', `/tenants/${t.id}`, { confirm: f.confirm.value.trim() });
        closeModal();
        toast(T('delDone'));
        load();
      } catch (err) {
        $('#err', box).textContent = errMsg(err);
      }
    });
  }

  function openSettings() {
    const box = openModal(`<h3>${esc(T('settings'))}</h3><form id="sf">
      <label class="field"><span>${esc(T('currency'))}</span><input name="currency" maxlength="12" value="${esc(state.data.settings.currency)}"></label>
      <fieldset class="wl"><legend>${esc(T('whiteLabel'))}</legend>
        <label class="field"><span>${esc(T('brandName'))}</span><input name="brandName" maxlength="60" value="${esc(state.data.settings.brandName || '')}"><small>${esc(T('whiteLabelHint'))}</small></label>
        <label class="field"><span>${esc(T('brandUrl'))}</span><input name="brandUrl" type="url" maxlength="200" placeholder="https://" value="${esc(state.data.settings.brandUrl || '')}"></label>
        <label class="check"><input name="hideBranding" type="checkbox"${state.data.settings.hideBranding ? ' checked' : ''}> ${esc(T('hideBranding'))}</label>
      </fieldset>
      <label class="field"><span>${esc(T('currentPw'))}</span><input name="current" type="password" autocomplete="current-password"></label>
      <label class="field"><span>${esc(T('newPassword'))}</span><input name="password" type="password" minlength="8" autocomplete="new-password"><small>${esc(T('passwordHint'))}</small></label>
      <div class="modal-actions"><button class="btn" type="submit">${esc(T('save'))}</button><button class="btn ghost" type="button" data-close>${esc(T('cancel'))}</button></div>
      <p class="error" id="err"></p></form>`);
    const f = $('#sf', box);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { currency: f.currency.value, brandName: f.brandName.value, brandUrl: f.brandUrl.value, hideBranding: f.hideBranding.checked };
      if (f.password.value) Object.assign(body, { current: f.current.value, password: f.password.value });
      try {
        await api('PUT', '/settings', body);
        closeModal();
        toast(T('saved'));
        load();
      } catch (err) {
        $('#err', box).textContent = errMsg(err);
      }
    });
  }

  // ---------------------------------------------------------------- events
  document.addEventListener('click', async (e) => {
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      try {
        await navigator.clipboard.writeText(copy.dataset.copy);
        toast(T('copied'));
      } catch {
        toast(copy.dataset.copy);
      }
      return;
    }
    const f = e.target.closest('[data-filter]');
    if (f) {
      state.filter = f.dataset.filter;
      $$('[data-filter]').forEach((b) => b.classList.toggle('active', b === f));
      return renderList();
    }
    const m = e.target.closest('[data-manage]');
    if (m) return openManage(m.dataset.manage);
    const r = e.target.closest('[data-renew]');
    if (r) {
      try {
        const t = await api('POST', `/tenants/${r.dataset.renew}/renew`, { months: 1 });
        toast(T('renewed', { date: fmtDate(t.paidUntil) }));
        load();
      } catch (err) {
        toast(errMsg(err), true);
      }
      return;
    }
    const a = e.target.closest('[data-act]');
    if (!a || a.closest('.modal')) return;
    if (a.dataset.act === 'lang') {
      lang = lang === 'ar' ? 'en' : 'ar';
      try { localStorage.setItem(LANG_KEY, lang); } catch { /* ignore */ }
      applyLang();
      if (state.data) renderMain();
      else boot();
    } else if (a.dataset.act === 'new') openNew();
    else if (a.dataset.act === 'settings') openSettings();
    else if (a.dataset.act === 'logout') {
      await api('POST', '/logout', {});
      state.data = null;
      boot();
    }
  });

  async function load() {
    state.data = await api('GET', '/tenants');
    renderMain();
  }

  async function boot() {
    applyLang();
    try {
      state.info = await api('GET', '/state');
    } catch {
      root.innerHTML = `<p class="error" style="padding:40px;text-align:center">${esc(T('error'))}</p>`;
      return;
    }
    document.title = `${state.info.appName} · ${T('hub')}`;
    if (!state.info.setupDone) return renderSetup();
    if (!state.info.authed) return renderLogin();
    load();
  }

  boot();
})();
