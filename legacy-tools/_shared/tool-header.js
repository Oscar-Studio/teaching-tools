/* =====================================================
 * 教学工具 — 共享页面头 + 主题切换
 * 注入：顶部导航条（返回 + 主题切换按钮）+ Opilot 预填
 *
 * 用法：<script src="../_shared/tool-header.js" defer></script>
 *
 * 主题：复用入口页的 localStorage 键 'oscar-theme'，
 *       与 _shared/design-tokens.css 协同工作：
 *       - 未显式设置 → CSS media query 跟随系统（无白闪）
 *       - 显式 light/dark → 设置 <html data-theme="...">
 *       - 切换时派发 CustomEvent('themechange') 让 canvas/plotly 工具重绘
 * ===================================================== */
(function () {
  'use strict';

  if (window.__teachingToolsHeaderLoaded) return;
  window.__teachingToolsHeaderLoaded = true;

  var STORAGE_KEY = 'oscar-theme';
  var ICON = { light: '☀', dark: '☾', system: '◐' };
  var TITLE = {
    light: '主题：浅色（点击切换为深色）',
    dark: '主题：深色（点击切换为跟随系统）',
    system: '主题：跟随系统（点击切换为浅色）'
  };

  /* ---------- 主题存储 + 应用 ---------- */
  function readMode() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      if (v === 'light' || v === 'dark' || v === 'system') return v;
    } catch (e) { /* ignore */ }
    return 'system';
  }
  function writeMode(mode) {
    try { localStorage.setItem(STORAGE_KEY, mode); } catch (e) { /* ignore */ }
  }
  function systemPrefersDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function resolved(mode) {
    return mode === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : mode;
  }
  function applyTheme(resolvedMode) {
    if (document.documentElement.getAttribute('data-theme') !== resolvedMode) {
      document.documentElement.setAttribute('data-theme', resolvedMode);
    }
  }
  function setMode(next) {
    writeMode(next);
    var r = resolved(next);
    applyTheme(r);
    updateToggleUI(next, r);
    document.documentElement.dispatchEvent(new CustomEvent('themechange', {
      detail: { mode: next, resolved: r }
    }));
  }

  /* ---------- 顶部条（含主题按钮） ---------- */
  function injectBar() {
    if (document.getElementById('tt-shared-header')) return;
    if (!document.getElementById('tt-shared-style')) {
      var style = document.createElement('style');
      style.id = 'tt-shared-style';
      style.textContent =
        // 工具页 body 上方让出 44px 给共享头
        'body.tt-sh-has-bar{padding-top:48px!important}' +
        // 共享头：用 design-tokens 变量，主题感知
        '#tt-shared-header{position:fixed;top:0;left:0;right:0;height:44px;' +
          'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 16px;' +
          'background:color-mix(in srgb,var(--canvas) 88%,transparent);' +
          'backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);' +
          'border-bottom:1px solid var(--hairline);' +
          'z-index:9999;font:13px/1 inherit}' +
        '.tt-sh-left,.tt-sh-right{display:flex;align-items:center;gap:8px}' +
        '.tt-sh-back{color:var(--muted);text-decoration:none;display:inline-flex;' +
          'align-items:center;gap:4px;padding:6px 10px;border-radius:6px;' +
          'transition:all .2s}' +
        '.tt-sh-back:hover{color:var(--ink);background:color-mix(in srgb,var(--ink) 6%,transparent)}' +
        // 主题按钮
        '.tt-sh-theme{width:32px;height:32px;border-radius:8px;border:1px solid var(--hairline);' +
          'background:color-mix(in srgb,var(--ink) 4%,transparent);color:var(--ink);' +
          'font-size:16px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;' +
          'transition:all .2s}' +
        '.tt-sh-theme:hover{background:color-mix(in srgb,var(--ink) 10%,transparent);border-color:var(--primary)}' +
        // 兼容：把 opilot-prefill-banner 往下挪（避开 44px 共享头）
        '.opilot-prefill-banner{top:140px!important}' +
        '@media(max-width:640px){.opilot-prefill-banner{top:120px!important}}';
      document.head.appendChild(style);
    }
    var bar = document.createElement('div');
    bar.id = 'tt-shared-header';
    bar.innerHTML =
      '<div class="tt-sh-left">' +
        '<a class="tt-sh-back" href="https://edu.oscarstudio.cn/">← 教学工具</a>' +
      '</div>' +
      '<div class="tt-sh-right">' +
        '<button class="tt-sh-theme" id="tt-sh-theme-btn" type="button" aria-label="切换主题">☀</button>' +
      '</div>';
    document.body.appendChild(bar);
    document.body.classList.add('tt-sh-has-bar');
  }

  /* ---------- 主题按钮交互 ---------- */
  function updateToggleUI(mode, resolvedMode) {
    var btn = document.getElementById('tt-sh-theme-btn');
    if (!btn) return;
    btn.textContent = ICON[mode];
    btn.title = TITLE[mode] + '（当前：' + (resolvedMode === 'dark' ? '深色' : '浅色') + '）';
  }
  function setupToggle() {
    var btn = document.getElementById('tt-sh-theme-btn');
    if (!btn) return;
    // 浅 → 深 → 跟随系统 → 浅 ...
    var cycle = ['light', 'dark', 'system'];
    btn.addEventListener('click', function () {
      var cur = readMode();
      var idx = cycle.indexOf(cur);
      var next = cycle[(idx + 1) % cycle.length];
      setMode(next);
    });
    updateToggleUI(readMode(), resolved(readMode()));
  }

  /* ---------- 跟随系统（仅在 mode=system 时响应） ---------- */
  function setupSystemListener() {
    if (!window.matchMedia) return;
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var handler = function () {
      if (readMode() === 'system') {
        var r = resolved('system');
        applyTheme(r);
        updateToggleUI('system', r);
        document.documentElement.dispatchEvent(new CustomEvent('themechange', {
          detail: { mode: 'system', resolved: r }
        }));
      }
    };
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else mq.addListener(handler);
  }

  /* ---------- Opilot 预填（保留旧行为） ---------- */
  function loadPrefill() {
    if (!document.querySelector('link[href*="opilot.css"]')) {
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = 'https://ai.oscarstudio.cn/opilot.css';
      document.head.appendChild(l);
    }
    if (document.querySelector('script[data-tt-prefill]')) return;
    var s = document.createElement('script');
    s.src = 'https://ai.oscarstudio.cn/opilot-prefill.js';
    s.dataset.ttPrefill = '1';
    s.defer = true;
    document.head.appendChild(s);
  }

  /* ---------- 入口 ---------- */
  // 立即同步设置主题（防白闪）
  applyTheme(resolved(readMode()));

  document.addEventListener('DOMContentLoaded', function () {
    injectBar();
    setupToggle();
    setupSystemListener();
    loadPrefill();
  });
})();
