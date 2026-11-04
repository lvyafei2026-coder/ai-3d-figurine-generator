// ============================================================================
// Toolara 轻登录（Google One Tap / FedCM）
//   交互：右上角官方「Sign in with Google」按钮；进页立即调一次 One Tap
//         （Chrome 启用 FedCM 后不再弹大窗，只出被动提示，故 6s 内没结果时
//         用一次性引导气泡把用户引到按钮上，气泡每天最多一次、可关闭、12s 自动消失）。
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
  var MUTE_KEY = 'toolara_onetap_muted';      // One Tap 被关掉后 24h 内不再调
  var NUDGE_KEY = 'toolara_nudge_at';         // 引导气泡每天最多一次
  var DEBUG = /[?&]authdebug=1/.test(location.search);
  var area = document.getElementById('auth-area');
  if (!area || !CLIENT_ID || /^null$/.test(CLIENT_ID)) return;

  function log(msg) {
    if (DEBUG && window.console) console.log('[auth] ' + msg);
  }
  function zh() {
    return String(document.documentElement.lang || '').toLowerCase().indexOf('zh') === 0;
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
  function mute() {
    try { localStorage.setItem(MUTE_KEY, String(Date.now())); } catch (e) {}
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
    out.title = 'Sign out';
    out.setAttribute('aria-label', 'Sign out');
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

  function render() {
    var user = getUser();
    if (user && user.email) { chip(user); return; }
    hideNudge();
    area.innerHTML = '';
    var holder = document.createElement('div');
    holder.className = 'auth-btn';
    area.appendChild(holder);
    loadGsi(function () {
      try {
        google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: onCredential,
          auto_select: false,
          cancel_on_tap_outside: true,
          use_fedcm_for_prompt: true,
          itp_support: true
        });
        google.accounts.id.renderButton(holder, {
          theme: 'outline', size: 'medium', shape: 'pill',
          text: 'signin', logo_alignment: 'left'
        });
      } catch (e) { log('initialize failed: ' + e); }
      promptOnce();
    });
  }

  // GIS 按钮语言：官方支持 gsi/client?hl=<locale>，不设则跟浏览器走。
  // 页面切换语言时重载脚本并重渲染按钮，保证与页面语言一致。
  function currentHl() {
    var m = String(document.documentElement.lang || '').toLowerCase();
    return m.indexOf('zh') === 0 ? 'zh-CN' : 'en';
  }
  function loadGsi(cb) {
    var hl = currentHl();
    if (window.google && window.google.accounts && window.google.accounts.id) {
      if (window.__toolaraGsiHl === hl) return cb();
      var old = document.getElementById('toolara-gsi');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      try { delete window.google; } catch (e) { window.google = undefined; }
    }
    var s = document.createElement('script');
    s.id = 'toolara-gsi';
    s.src = 'https://accounts.google.com/gsi/client?hl=' + hl;
    s.async = true; s.defer = true;
    s.onload = function () { window.__toolaraGsiHl = hl; cb(); };
    s.onerror = function () { log('gsi script load failed'); };
    document.head.appendChild(s);
  }

  // 进页立即尝试一次 One Tap。回调里判断"到底有没有给用户看到东西"：
  // FedCM 模式下 isDisplayed 等接口已废弃（恒 false），所以再加一个 6s 兜底。
  var promptDone = false;
  function promptOnce() {
    if (getUser() || muted() || promptDone) return;
    promptDone = true;
    var shown = false;
    try {
      google.accounts.id.prompt(function (n) {
        var info = {
          displayed: !!(n && n.isDisplayed && n.isDisplayed()),
          notDisplayed: !!(n && n.isNotDisplayed && n.isNotDisplayed()),
          skipped: !!(n && n.isSkippedMoment && n.isSkippedMoment()),
          dismissed: !!(n && n.isDismissedMoment && n.isDismissedMoment()),
          reason: n && n.getNotDisplayedReason ? n.getNotDisplayedReason() : '',
          skipReason: n && n.getSkippedReason ? n.getSkippedReason() : ''
        };
        log('prompt callback ' + JSON.stringify(info));
        if (info.displayed) { shown = true; return; }
        if (info.skipped && info.skipReason === 'user_cancel') mute();
        if (info.dismissed) mute();
        showNudge();
      });
      // FedCM 下 prompt 可能既不弹窗也不回调 —— 6s 后仍无结果就给引导
      setTimeout(function () {
        if (!shown && !getUser()) showNudge();
      }, 6000);
    } catch (e) {
      log('prompt failed: ' + e);
      showNudge();
    }
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

  // 页面语言切换后重渲染（未登录态下按钮/气泡文案跟随页面语言）
  var langSel = document.getElementById('langSelect');
  if (langSel) langSel.addEventListener('change', function () {
    setTimeout(function () { hideNudge(); render(); }, 80);
  });
})();
