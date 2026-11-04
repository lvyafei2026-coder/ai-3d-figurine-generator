// ============================================================================
// Toolara 轻登录（Google One Tap / FedCM）
//   交互：右上角官方「Sign in with Google」按钮 + 进页后一次 One Tap 提示，
//         用户点一下当前 Google 账号即完成，无注册 / 无邮件验证 / 无密码。
//   数据：credential（id_token）POST 到 tool-proxy /_auth/google 验签入库，
//         本地只在 localStorage 存 {email,name,picture}；登出仅清本地。
//   配置：window.TOOLARA_GOOGLE_CLIENT_ID 由 tool-proxy 注入（HTML <head>），
//         未注入 / 未配置 → 本组件整体不渲染，页面无任何感知。
// ============================================================================
(function () {
  'use strict';
  var CLIENT_ID = window.TOOLARA_GOOGLE_CLIENT_ID || '';
  var USER_KEY = 'toolara_user';
  var MUTE_KEY = 'toolara_onetap_muted';     // One Tap 被关掉后 24h 内不再弹
  var area = document.getElementById('auth-area');
  if (!area || !CLIENT_ID || /^null$/.test(CLIENT_ID)) return;

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

  function render() {
    var user = getUser();
    if (user && user.email) { chip(user); return; }
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
          use_fedcm_for_prompt: true
        });
        google.accounts.id.renderButton(holder, {
          theme: 'outline', size: 'medium', shape: 'pill',
          text: 'signin', logo_alignment: 'left'
        });
      } catch (e) { /* GIS 不可用：保持无登录态，不阻塞页面 */ }
    });
  }

  function loadGsi(cb) {
    if (window.google && window.google.accounts && window.google.accounts.id) return cb();
    var s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true;
    s.onload = cb;
    s.onerror = function () { /* 加载失败静默，不阻塞页面 */ };
    document.head.appendChild(s);
  }

  function onCredential(resp) {
    if (!resp || !resp.credential) return;
    fetch('/_auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: resp.credential })
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (d && d.ok && d.user && d.user.email) { store(d.user); chip(d.user); }
    }).catch(function () {});
  }

  // 进页后尝试一次 One Tap（用户已登录 Google 时右上角弹出授权提示；
  // 被跳过 / 关闭后 24h 静默，不反复打扰）
  function tryPrompt() {
    if (getUser() || muted()) return;
    try {
      google.accounts.id.prompt(function (n) {
        try {
          if (!n) return;
          if ((n.isSkippedMoment && n.isSkippedMoment()) ||
              (n.isDismissedMoment && n.isDismissedMoment() && !n.isDisplayed())) mute();
        } catch (e) {}
      });
    } catch (e) {}
  }

  render();
  if (window.google && window.google.accounts && window.google.accounts.id) {
    setTimeout(tryPrompt, 2500);
  } else {
    var timer = setInterval(function () {
      if (window.google && window.google.accounts && window.google.accounts.id) {
        clearInterval(timer);
        setTimeout(tryPrompt, 1500);
      }
    }, 400);
    setTimeout(function () { clearInterval(timer); }, 8000);
  }
})();
