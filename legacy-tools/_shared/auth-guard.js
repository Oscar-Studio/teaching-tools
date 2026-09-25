/* =====================================================
 * 教学工具 — 共享登录守卫
 * 检测用户登录态，未登录时跳转到 auth.html，登录后回跳当前页。
 *
 * 用法 1：立即守卫（工具完全依赖登录）
 *   <script src="../_shared/auth-guard.js" data-guard="immediate"></script>
 *
 * 用法 2：手动守卫（仅部分功能需要登录，例如 AI 解题）
 *   <script src="../_shared/auth-guard.js"></script>
 *   <script>
 *     if (!window.__oscarAuth.isLoggedIn()) window.__oscarAuth.redirectToLogin();
 *   </script>
 *
 * 登录判定优先级（与 user-button.js / auth.html 一致）：
 *   1. document.cookie 中的 userToken（跨子域真理之源）
 *   2. localStorage.ai_token
 *   3. localStorage.userToken（旧版兼容）
 * ===================================================== */
(function () {
  'use strict';

  if (window.__oscarAuth) return;
  window.__oscarAuth = {};

  var SCRIPT = document.currentScript || (function () {
    var s = document.getElementsByTagName('script');
    return s[s.length - 1];
  })();

  function readCookie(name) {
    var v = '; ' + document.cookie;
    var parts = v.split('; ' + name + '=');
    if (parts.length === 2) return parts.pop().split(';').shift() || null;
    return null;
  }

  function readLs(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  // 判定是否已登录：Cookie 优先，localStorage 兜底
  function isLoggedIn() {
    if (readCookie('userToken')) return true;
    if (readLs('ai_token')) return true;
    if (readLs('userToken')) return true;
    return false;
  }

  // 跳转到登录页，回跳 URL 指向当前页。
  // 使用 replace 避免 history 里多一条死链。
  function redirectToLogin() {
    var ret = window.location.href;
    try {
      var u = new URL(ret);
      // 仅允许同源（oscarstudio.cn 子域）
      if (u.hostname !== 'oscarstudio.cn' && !u.hostname.endsWith('.oscarstudio.cn')) {
        ret = 'https://oscarstudio.cn/';
      }
    } catch (e) {
      ret = 'https://oscarstudio.cn/';
    }
    window.location.replace('https://api.oscarstudio.cn/auth.html?return=' + encodeURIComponent(ret));
  }

  window.__oscarAuth.isLoggedIn = isLoggedIn;
  window.__oscarAuth.redirectToLogin = redirectToLogin;

  // data-guard="immediate" 时立刻拦截（用于整页强依赖登录的工具）
  if (SCRIPT && SCRIPT.getAttribute('data-guard') === 'immediate') {
    if (!isLoggedIn()) redirectToLogin();
  }
})();
