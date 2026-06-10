/* =====================================================
 * 教学工具 — 共享页面头
 * 注入顶部导航条（返回 + Opilot）+ 加载 opilot-prefill
 * 用法: <script src="../_shared/tool-header.js" defer></script>
 * ===================================================== */
(function () {
  'use strict';

  if (window.__teachingToolsHeaderLoaded) return;
  window.__teachingToolsHeaderLoaded = true;

  document.addEventListener('DOMContentLoaded', function () {
    injectBar();
    loadPrefill();
  });

  function injectBar() {
    if (document.getElementById('tt-shared-header')) return;
    if (!document.getElementById('tt-shared-style')) {
      var style = document.createElement('style');
      style.id = 'tt-shared-style';
      style.textContent =
        'body.tt-sh-has-bar{padding-top:48px!important}' +
        '#tt-shared-header{position:fixed;top:0;left:0;right:0;height:44px;' +
          'display:flex;align-items:center;gap:12px;padding:0 16px;' +
          'background:rgba(13,17,23,.85);backdrop-filter:blur(10px);' +
          'border-bottom:1px solid #30363d;z-index:9999;font:13px/1 inherit}' +
        '.tt-sh-back{color:#8b949e;text-decoration:none;display:inline-flex;' +
          'align-items:center;gap:4px;padding:6px 10px;border-radius:6px;' +
          'transition:all .2s}' +
        '.tt-sh-back:hover{color:#fff;background:rgba(255,255,255,.06)}' +
          '.tt-sh-opilot{margin-left:auto}' +
        // 兼容 44px 共享头：把 opilot-prefill-banner 往下挪（避开 H1 标题）
        '.opilot-prefill-banner{top:140px!important}' +
        '@media(max-width:640px){.opilot-prefill-banner{top:120px!important}}' +
        '@media(max-width:768px){.tt-sh-opilot .opilot-trigger-text,' +
          '.tt-sh-opilot kbd{display:none}}';
      document.head.appendChild(style);
    }
    var bar = document.createElement('div');
    bar.id = 'tt-shared-header';
    bar.innerHTML =
      '<a class="tt-sh-back" href="https://tools.oscarstudio.cn/">← 教学工具</a>' +
      '<button class="tt-sh-opilot opilot-panel-btn-header" id="opilotPanelTrigger" title="打开 Opilot 面板 (⌘K)">' +
        '<span class="opilot-trigger-icon">✨</span>' +
        '<span class="opilot-trigger-text">Opilot</span>' +
        '<kbd>⌘K</kbd>' +
      '</button>';
    document.body.appendChild(bar);
    document.body.classList.add('tt-sh-has-bar');
  }

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
})();
