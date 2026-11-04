// ============================================================================
// Toolara 轻登录（Google One Tap / FedCM）
//   交互：右上角自绘「Sign in with Google」按钮（官方品牌规范 + 页面语言文案，
//         官方 iframe 按钮在 FedCM 下文字跟浏览器走、?hl= 压不过，故自绘）；
//         点击触发 FedCM 授权（与官方按钮同一流程）。进页自动尝试一次 One Tap
//         （Chrome FedCM 下不弹大窗，6s 无结果时出一次性引导气泡）。
//   数据：credential（id_token）POST 到 tool-proxy /_auth/google 验签入库，
//         本地只在 localStorage 存 {email,name,picture}；登出仅清本地。
//   配置：window.TOOLARA_GOOGLE_CLIENT_ID 由 tool-proxy 注入（HTML <head>），
//         未注入 / 未配置 → 本组件整体不渲染，页面无任何感知。
//   调试：URL 带 ?authdebug=1 时 console 输出 GIS 回调原因码。
// ============================================================================
(function () {
  'use strict';
  var CLIENT_ID = window.TOOLARA_GOOGLE_CLIENT_ID || '';
  var USER_KEY = 'toolara_user';
  var MUTE_KEY = 'toolara_onetap_muted';      // One Tap 被关掉后 24h 内不再自动弹
  var NUDGE_KEY = 'toolara_nudge_at';         // 引导气泡每天最多一次
  var DEBUG = /[?&]authdebug=1/.test(location.search);
  var area = document.getElementById('auth-area');
  if (!area || !CLIENT_ID || /^null$/.test(CLIENT_ID)) return;

  // Google 官方四色 G logo（品牌指南允许在自定义按钮中使用）
  var G_LOGO = '<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">'
    + '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>'
    + '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>'
    + '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>'
    + '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>'
    + '</svg>';

  function log(msg) {
    if (DEBUG && window.console) console.log('[auth] ' + msg);
  }
  function zh() {
    return String(document.documentElement.lang || '').toLowerCase().indexOf('zh') === 0;
  }
  function btnText() {
    return zh() ? '使用 Google 账号登录' : 'Sign in with Google';
  }
  function getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (e) { return null; }
  }
  function store(u) {
    try { u ? localStorage.setItem(USER_KEY, JSON.stringify(u)) : localStorage.removeItem(USER_KEY); } catch (e) {}
  }
  function muted() {
    try {
      var t = Number(localStorage.getItem(MUTE_KEY) || 0);
      return t && Date.now() - t < 86400000;
    } catch (e) { return false; }
  }

  function chip(user) {
    hideNudge();
    area.innerHTML = '';
    var el = document.createElement('div');
    el.className = 'auth-chip';
    var img = document.createElement('img');
    img.src = user.picture || '';
    img.alt = '';
    img.width = 26; img.height = 26;
    img.referrerPolicy = 'no-referrer';
    var name = document.createElement('span');
    name.textContent = user.email || '';
    var out = document.createElement('button');
    out.type = 'button';
    out.textContent = '\u00d7';
    out.title = zh() ? '退出登录' : 'Sign out';
    out.setAttribute('aria-label', out.title);
    out.addEventListener('click', function () {
      store(null);
      try { if (window.google && google.accounts) google.accounts.id.disableAutoSelect(); } catch (e) {}
      render();
    });
    el.appendChild(img); el.appendChild(name); el.appendChild(out);
    area.appendChild(el);
  }

  // 一次性引导气泡：Google 不再自动弹窗时，用它把用户引到按钮上
  var nudgeEl = null;
  function showNudge() {
    if (nudgeEl || getUser()) return;
    var t = 0;
    try { t = Number(localStorage.getItem(NUDGE_KEY) || 0); } catch (e) {}
    if (t && Date.now() - t < 86400000) return;
    try { localStorage.setItem(NUDGE_KEY, String(Date.now())); } catch (e) {}
    nudgeEl = document.createElement('div');
    nudgeEl.className = 'auth-nudge';
    nudgeEl.setAttribute('role', 'status');
    var txt = document.createElement('span');
    txt.textContent = zh() ? '用 Google 账号一键登录，无需注册' : 'One click with Google, no signup';
    var x = document.createElement('button');
    x.type = 'button';
    x.textContent = '\u00d7';
    x.setAttribute('aria-label', 'Dismiss');
    x.addEventListener('click', hideNudge);
    nudgeEl.appendChild(txt); nudgeEl.appendChild(x);
    area.appendChild(nudgeEl);
    setTimeout(hideNudge, 12000);
  }
  function hideNudge() {
    if (nudgeEl && nudgeEl.parentNode) nudgeEl.parentNode.removeChild(nudgeEl);
    nudgeEl = null;
  }

  // ---- GIS 加载 / 初始化 / One Tap ----
  var inited = false;
  function ensureInit() {
    if (inited) return;
    try {
      google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: onCredential,
        auto_select: false,
        cancel_on_tap_outside: true,
        use_fedcm_for_prompt: true,
        itp_support: true
      });
      inited = true;
    } catch (e) { log('initialize failed: ' + e); }
  }

  // GIS 脚本：?hl= 让非 FedCM 环境（Safari 等）的弹窗跟页面语言；FedCM 环境由浏览器接管
  function currentHl() {
    var m = String(document.documentElement.lang || '').toLowerCase();
    return m.indexOf('zh') === 0 ? 'zh-CN' : 'en';
  }
  function loadGsi(cb) {
    var hl = currentHl();
    if (window.google && window.google.accounts && window.google.accounts.id) {
      if (window.__toolaraGsiHl === hl) { ensureInit(); return cb(); }
      var old = document.getElementById('toolara-gsi');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      try { delete window.google; } catch (e) { window.google = undefined; }
      inited = false;
    }
    var s = document.createElement('script');
    s.id = 'toolara-gsi';
    s.src = 'https://accounts.google.com/gsi/client?hl=' + hl;
    s.async = true; s.defer = true;
    s.onload = function () { window.__toolaraGsiHl = hl; ensureInit(); cb(); };
    s.onerror = function () { log('gsi script load failed'); };
    document.head.appendChild(s);
  }

  // 进页自动尝试一次 One Tap（FedCM 下 Chrome 通常不弹大窗）。
  // 注意：prompt 不传回调——回调里的 isDisplayed/isSkippedMoment 等 UI 状态方法
  // 已被 Google 废弃（FedCM 下恒 false 且打 GSI_LOGGER 警告），一律不调用。
  var promptDone = false;
  function autoPrompt() {
    if (getUser() || muted() || promptDone) return;
    promptDone = true;
    doPrompt(false);
  }
  // manual=true 时（用户点按钮）绕过 24h 静音——主动点击不应被静音拦住
  function doPrompt(manual) {
    if (!inited) return;
    try {
      log('prompt() called' + (manual ? ' (manual)' : ''));
      google.accounts.id.prompt();
    } catch (e) {
      log('prompt failed: ' + e);
    }
  }

  function render() {
    var user = getUser();
    if (user && user.email) { chip(user); return; }
    hideNudge();
    area.innerHTML = '';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'auth-btn auth-btn-g';
    btn.innerHTML = G_LOGO + '<span></span>';
    btn.querySelector('span').textContent = btnText();
    btn.addEventListener('click', function () {
      loadGsi(function () { doPrompt(true); });
    });
    area.appendChild(btn);
    showNudge();          // 立即出引导气泡（每天最多一次、可关、12s 自灭），不等 GSI
    loadGsi(autoPrompt);
  }

  function onCredential(resp) {
    if (!resp || !resp.credential) return;
    log('credential received');
    fetch('/_auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: resp.credential })
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (d && d.ok && d.user && d.user.email) { store(d.user); chip(d.user); }
      else log('server rejected: ' + JSON.stringify(d));
    }).catch(function (e) { log('post failed: ' + e); });
  }

  render();

  // 页面语言切换后重渲染（按钮文案/气泡跟随页面语言）
  var langSel = document.getElementById('langSelect');
  if (langSel) langSel.addEventListener('change', function () {
    setTimeout(function () { hideNudge(); render(); }, 80);
  });
})();
