/* =====================================================
 * 教学工具 — 主题色板 helper（供 canvas/plotly JS 使用）
 *
 * CSS 变量响应主题，但 canvas/plotly 内部 fillStyle / Plotly.layout.paper_bgcolor
 * 等是 JS API，要直接读色值。这里把 design-tokens.css 的关键变量读出来，
 * 并监听 themechange 事件 → 让工具重绘。
 *
 * 用法（任何 canvas 工具）：
 *   1. <head> 里加 <script src="../_shared/theme-tokens.js"></script>
 *   2. JS 里读 window.ttTheme.colors.xxx
 *   3. 监听 'themechange' 事件 → 调自己的 redraw()
 * ===================================================== */
(function () {
  'use strict';

  var root = document.documentElement;

  function read(name) {
    return getComputedStyle(root).getPropertyValue(name).trim();
  }

  function buildPalette() {
    var theme = root.getAttribute('data-theme') || 'light';
    var isDark = theme === 'dark';
    return {
      theme: theme,
      isDark: isDark,
      // 画板表面（数学/图表容器，主题感知 —— 在浅色下是深色块，深色下是米色块）
      graphBg: read('--graph-card'),
      graphText: read('--on-graph'),
      graphTextSoft: read('--on-graph-soft'),
      // 画板里网格/坐标轴等次级元素（用 on-graph 的弱化色）
      graphGrid: isDark ? 'rgba(20, 20, 19, 0.12)' : 'rgba(250, 249, 245, 0.08)',
      graphAxis: isDark ? '#3a3633' : '#a09d96',
      graphAxisText: isDark ? '#6c6a6c' : '#a09d96',
      // 强调色
      primary: read('--primary'),
      accentTeal: read('--accent-teal'),
      success: read('--success'),
      // 错误/警示（保留语义色，深浅都通用）
      danger: '#c64545',
      warn: read('--accent-amber'),
    };
  }

  window.ttTheme = {
    colors: buildPalette(),
    refresh: function () {
      window.ttTheme.colors = buildPalette();
    }
  };

  // 监听主题切换 → 刷新 ttTheme.colors，然后通知工具
  root.addEventListener('themechange', function () {
    window.ttTheme.refresh();
    // 工具可在此事件上做 redraw；ttTheme.colors 已是新值
  });
})();
