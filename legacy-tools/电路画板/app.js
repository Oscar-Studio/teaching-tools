/* =====================================================
 * 电路画板 — 编辑器主程序
 *
 * 与其它教学工具一致：单页、零运行时依赖、SVG 渲染。
 * 状态只有一份 { components, wires }，两种视图都是它的投影。
 * ===================================================== */
(function () {
  'use strict';

  var Parts = window.CircuitParts;
  var Net = window.CircuitNet;
  var Layout = window.CircuitLayout;

  var STORE_KEY = 'circuit-board-v1';

  /* =====================================================
   * 状态
   * ===================================================== */
  var state = {
    view: 'pictorial',        // 'pictorial' 实物图 | 'schematic' 电路图
    components: [],
    wires: [],
    autoLayout: true,         // 电路图视图下是否自动走线
    seq: 1
  };

  var ui = {
    sel: null,               // 选中的元件 id
    selWire: null,           // 选中的导线 id（与 sel 互斥）
    selWireAt: null,         // 选中导线时记下的点选位置（世界坐标），决定删除按钮贴在哪段线上
    pendingPin: null,        // 连线中：起点 {c, p}
    drag: null,              // 拖拽中
    pan: null,               // 平移中
    scale: 1,
    tx: 0,
    ty: 0
  };

  var history = [], future = [];

  /* commit() 一律在「改完之后」才被调用，当场 snapshot() 拿到的是改动后的状态，
     直接压栈的话每次撤销弹回来的都是当前状态 —— 按一下 ⌘Z 什么都不会发生。
     prev 记着上一次 commit 结束时的快照，对下一次改动而言正好就是「改动前」。
     （这条是原实现就有的毛病，一直没暴露是因为没有别的删除入口。） */
  var prev = null;

  /* =====================================================
   * 工具函数
   * ===================================================== */
  var NS = 'http://www.w3.org/2000/svg';
  var $ = function (s) { return document.querySelector(s); };

  function el(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    return e;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function uid(prefix) { return prefix + (state.seq++); }
  function byId(id) {
    return state.components.filter(function (c) { return c.id === id; })[0] || null;
  }

  /* =====================================================
   * 撤销 / 重做
   * ===================================================== */
  function snapshot() {
    return JSON.stringify({
      components: state.components, wires: state.wires,
      view: state.view, autoLayout: state.autoLayout, seq: state.seq
    });
  }
  function restore(json) {
    var d = JSON.parse(json);
    state.components = d.components;
    state.wires = d.wires;
    state.view = d.view;
    state.autoLayout = d.autoLayout;
    state.seq = d.seq;
  }
  function commit(label) {
    history.push(prev);
    if (history.length > 80) history.shift();
    future.length = 0;
    prev = snapshot();
    save();
    render();
    void label;
  }
  function undo() {
    if (!history.length) return;
    future.push(snapshot());
    restore(history.pop());
    prev = snapshot();
    save(); render();
  }
  function redo() {
    if (!future.length) return;
    history.push(prev);
    restore(future.pop());
    prev = snapshot();
    save(); render();
  }

  /* =====================================================
   * 持久化
   * ===================================================== */
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        components: state.components, wires: state.wires,
        view: state.view, autoLayout: state.autoLayout, seq: state.seq
      }));
    } catch (e) { /* 隐私模式下忽略 */ }
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return false;
      restore(raw);
      return state.components.length > 0;
    } catch (e) { return false; }
  }

  function encodeState() {
    var json = JSON.stringify({
      c: state.components, w: state.wires, s: state.seq
    });
    return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeState(s) {
    try {
      var b64 = s.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      var json = decodeURIComponent(escape(atob(b64)));
      var d = JSON.parse(json);
      return { components: d.c, wires: d.w, seq: d.s || 1 };
    } catch (e) { return null; }
  }

  /* =====================================================
   * 拓扑分析（缓存到渲染周期内）
   * ===================================================== */
  var analysis = null;
  function getAnalysis() {
    if (!analysis) analysis = Net.analyze(state);
    return analysis;
  }
  function invalidate() { analysis = null; }

  /* =====================================================
   * 渲染
   * ===================================================== */
  function render() {
    var svg = $('#stage');
    var an = getAnalysis();

    svg.setAttribute('width', $('#canvas').clientWidth);
    svg.setAttribute('height', $('#canvas').clientHeight);
    svg.setAttribute('viewBox', '0 0 ' + $('#canvas').clientWidth + ' ' + $('#canvas').clientHeight);

    while (svg.firstChild) svg.removeChild(svg.firstChild);   // 必须清空，否则每次重绘叠加一份

    var vp = el('g', {
      transform: 'translate(' + ui.tx + ',' + ui.ty + ') scale(' + ui.scale + ')'
    });

    var layout = null;
    if (state.autoLayout && an.ok) {
      layout = state.view === 'schematic'
        ? Layout.layoutSchematic(state, an)
        : Layout.layoutPictorial(state, an);
      if (layout) {
        // 自动布局会改写坐标，落到 state 上
        state.components.forEach(function (c) {
          var p = layout.positions[c.id];
          if (p) { c.x = p.x; c.y = p.y; if (p.rot != null) c.rot = p.rot; }
        });
      }
    }

    var gRoutes = el('g', { class: 'layer-routes' });
    var gHits = el('g', { class: 'layer-hits' });
    var gComps = el('g', { class: 'layer-comps' });

    // 走线必须在自动布局写回坐标之后算，否则量的是上一帧的引脚位置
    routed = buildRoutes();
    routed.forEach(function (r) {
      gRoutes.appendChild(el('path', {
        d: r.d, class: 'wire' + (ui.selWire === r.id ? ' sel' : ''),
        // 只设 --wc 变量，让 .wire.sel 的选中高亮还能生效
        style: '--wc:' + r.color
      }));
      // 命中区：透明粗描边，比线宽宽 12px，手指/鼠标都好点中
      gHits.appendChild(el('path', { d: r.d, class: 'wire-hit', 'data-wire': r.id }));
    });
    state.components.forEach(function (c) { gComps.appendChild(renderComp(c, an)); });

    vp.appendChild(gRoutes);
    vp.appendChild(gHits);
    vp.appendChild(gComps);
    svg.appendChild(vp);

    renderStatus(an);
    renderIssuePanel(an);
    updateFloatTools();
  }

  /* =====================================================
   * 走线几何
   *
   * 每根 state.wires 各算各的正交折线，绕开其它元件。
   * 分成「画出来的线」和「state.wires」两份唯一的映射，是导线能被
   * 点选、能被删除的前提 —— 之前电路图视图的走线是布局顺手给的
   * 结构线，一段线对应哪一根连线根本查不到。
   * ===================================================== */
  var routed = [];

  function buildRoutes() {
    var an = getAnalysis();
    // 所有元件都是障碍，两端也不例外：靠 stub 把引脚引到机身外面，
    // 线才不会横穿自己元件的机身（那看上去就像接到了另一个接线柱上）。
    var obs = Layout.obstaclesOf(state);
    // 实物图拐角画得更圆，像一根手拉的软导线；电路图走教科书的硬折角
    var fillet = state.view === 'pictorial' ? 24 : 10;
    var out = [];

    state.wires.forEach(function (w) {
      var ca = byId(w.a.c), cb = byId(w.b.c);
      if (!ca || !cb) return;
      var pa = Parts.pinPos(ca, w.a.p), pb = Parts.pinPos(cb, w.b.p);
      var mid = Layout.routeWire(Layout.stub(ca, w.a.p), Layout.stub(cb, w.b.p), obs);
      var pts = [pa].concat(mid, [pb]);
      out.push({
        id: w.id,
        pts: pts,
        d: Layout.orthoPath(pts, fillet),
        color: wireStrokeOf(w, an)
      });
    });
    return out;
  }

  /** 实物图按节点电位着色（正极红、负极黑、其它灰），电路图统一走主题色 */
  function wireStrokeOf(w, an) {
    if (state.view !== 'pictorial' || !an.source) return 'var(--wire)';
    var net = an.netInfo.netOf[Net.pinKey(w.a.c, w.a.p)];
    return Layout.wireColor(net, an.S, an.T);
  }

  function pinLabel(ref) {
    var c = byId(ref.c);
    return (c ? Parts.get(c.part).short : ref.c) + ' ' + ref.p;
  }

  function wireById(id) {
    return state.wires.filter(function (w) { return w.id === id; })[0] || null;
  }

  function renderComp(c, an) {
    var def = Parts.get(c.part);
    var g = el('g', {
      class: 'comp' + (ui.sel === c.id ? ' sel' : '') + ' ghost-' + state.view,
      'data-id': c.id,
      transform: 'translate(' + c.x + ',' + c.y + ')' + (c.rot ? ' rotate(' + c.rot + ')' : '')
    });

    // 命中区
    var b = Parts.bbox(c);
    g.appendChild(el('rect', {
      x: -b.w / 2, y: -b.h / 2, width: b.w, height: b.h,
      class: 'hit', rx: 6
    }));

    var art = state.view === 'schematic' ? def.schematic(c.props) : def.pictorial(c.props);
    var body = el('g', { class: 'art' });
    body.innerHTML = art;
    // 电路图符号统一走主题色。fill 必须显式给 none：
    // SVG 的初始 fill 是黑色，不给的话灯泡/电阻/电表全成了黑坨坨。
    if (state.view === 'schematic') {
      body.querySelectorAll('*').forEach(function (n) {
        if (n.tagName === 'text') n.setAttribute('class', 'sym-text');
        else {
          n.setAttribute('stroke', 'var(--wire)');
          n.setAttribute('fill', 'none');
          // 线宽也得显式给：SVG 初始值是 1，比导线细一大截，
          // 页面上和导出的 SVG 还会不是一个粗细
          n.setAttribute('stroke-width', Parts.SW);
        }
      });
    } else {
      // 实物图的接线柱按所在节点的电位上色，和导线同一套规则。
      // art 里写的是 fill:var(--post-a) / var(--post-b)，实际色值注入在这一层。
      body.setAttribute('style', postVarCss(Layout.postColors(an, c)));
    }
    g.appendChild(body);

    // 引脚。data-pin 必须挂在这个 <g> 上：事件处理读的是 closest('.pin').getAttribute，
    // 挂在内层 circle 上会读成 null，于是每一根线都静默落到 pins[0]（a 脚）。
    def.pins.forEach(function (p) {
      var g2 = el('g', { class: 'pin', 'data-pin': p.id });
      g2.appendChild(el('circle', { cx: p.x, cy: p.y, r: 7, class: 'pin-hit' }));
      if (ui.pendingPin && ui.pendingPin.c === c.id && ui.pendingPin.p === p.id) {
        g2.appendChild(el('circle', { cx: p.x, cy: p.y, r: 11, class: 'pin-active' }));
      }
      g.appendChild(g2);
    });

    var label = el('text', {
      x: 0, y: b.h / 2 + 16, 'text-anchor': 'middle', class: 'comp-label'
    });
    label.textContent = def.short;
    g.appendChild(label);
    return g;
  }

  function renderStatus(an) {
    var nets = an.netInfo.nets.length;
    var loads = state.components.filter(function (c) {
      return Parts.get(c.part).category === 'load';
    }).length;
    $('#status-left').textContent =
      '元件 ' + state.components.length + ' · 导线 ' + state.wires.length +
      ' · 节点 ' + nets + ' · 用电器 ' + loads +
      (an.ok ? ' · ' + topologyName(an) : '');
  }

  function topologyName(an) {
    var n = an.steps.filter(function (s) { return s.kind === 'parallel'; }).length;
    if (!n) return '单回路串联';
    if (n === 1) {
      var p = an.steps.filter(function (s) { return s.kind === 'parallel'; })[0];
      return p.items.length >= 2 ? '并联电路' : '串并联';
    }
    return '串并联混合';
  }

  function renderIssuePanel(an) {
    var box = $('#issues');
    if (!an.issues.length) {
      box.innerHTML = '<div class="ok">✓ 连接正常，拓扑成立</div>';
      return;
    }
    box.innerHTML = an.issues.map(function (i) {
      return '<div class="issue ' + i.level + '">' +
        (i.level === 'error' ? '✕ ' : '! ') + esc(i.msg) + '</div>';
    }).join('');
  }

  /* =====================================================
   * 交互
   * ===================================================== */

  function bindCanvas() {
    var svg = $('#stage');
    var box = $('#canvas');

    box.addEventListener('pointerdown', function (e) {
      var pinG = e.target.closest('.pin');
      var compG = e.target.closest('.comp');
      var wireG = e.target.closest('.wire-hit');

      if (pinG && compG) {
        onPinClick(compG.getAttribute('data-id'), pinG.getAttribute('data-pin'));
        return;
      }
      if (compG) {
        var id = compG.getAttribute('data-id');
        select(id);
        var c = byId(id);
        // 抓取偏移必须换算到 SVG 世界坐标：clientX 是屏幕坐标，c.x 是世界坐标，
        // 两者直接相减会在缩放/平移不为 0 时把元件甩飞。
        var r0 = box.getBoundingClientRect();
        var wx = (e.clientX - r0.left - ui.tx) / ui.scale;
        var wy = (e.clientY - r0.top - ui.ty) / ui.scale;
        ui.drag = { id: id, grabDX: wx - c.x, grabDY: wy - c.y, moved: false };
        box.setPointerCapture(e.pointerId);
        return;
      }
      if (wireG) {
        // 和元件一致：按下先选中，没拖动就只是选中；拖动了照样是平移画布
        var r0 = box.getBoundingClientRect();
        var at = {
          x: (e.clientX - r0.left - ui.tx) / ui.scale,
          y: (e.clientY - r0.top - ui.ty) / ui.scale
        };
        selectWire(wireG.getAttribute('data-wire'), at);
        ui.pan = { x: e.clientX, y: e.clientY, tx: ui.tx, ty: ui.ty };
        box.setPointerCapture(e.pointerId);
        return;
      }
      // 空白 → 取消选择 / 画布平移
      select(null);
      ui.pendingPin = null;
      ui.pan = { x: e.clientX, y: e.clientY, tx: ui.tx, ty: ui.ty };
      box.setPointerCapture(e.pointerId);
    });

    box.addEventListener('pointermove', function (e) {
      if (ui.drag) {
        var c = byId(ui.drag.id);
        if (!c) return;
        var r = box.getBoundingClientRect();
        c.x = snap((e.clientX - r.left - ui.tx) / ui.scale - ui.drag.grabDX);
        c.y = snap((e.clientY - r.top - ui.ty) / ui.scale - ui.drag.grabDY);
        ui.drag.moved = true;
        state.autoLayout = false;    // 手动拖过就不再自动排线
        invalidate();
        render();
        return;
      }
      if (ui.pan) {
        ui.tx = ui.pan.tx + (e.clientX - ui.pan.x);
        ui.ty = ui.pan.ty + (e.clientY - ui.pan.y);
        render();
      }
    });

    box.addEventListener('pointerup', function (e) {
      if (ui.drag) {
        if (ui.drag.moved) { commit('move'); } else { select(ui.drag.id); }
        ui.drag = null;
      }
      if (ui.pan) ui.pan = null;
      try { box.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
    });

    box.addEventListener('dblclick', function (e) {
      var compG = e.target.closest('.comp');
      if (!compG) return;
      var c = byId(compG.getAttribute('data-id'));
      if (!c) return;
      c.rot = ((c.rot || 0) + 90) % 360;
      state.autoLayout = false;
      invalidate(); commit('rotate');
    });

    box.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = box.getBoundingClientRect();
      var mx = e.clientX - r.left, my = e.clientY - r.top;
      var k = ui.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1);
      k = Math.max(0.3, Math.min(3, k));
      ui.tx = mx - (mx - ui.tx) * (k / ui.scale);
      ui.ty = my - (my - ui.ty) * (k / ui.scale);
      ui.scale = k;
      render();
    }, { passive: false });
  }

  function snap(v) { return Math.round(v / 8) * 8; }

  function onPinClick(compId, pinId) {
    if (!ui.pendingPin) {
      ui.pendingPin = { c: compId, p: pinId };
      render();
      setHint('已选起点，再点另一个接线柱完成连线；按 Esc 取消。');
      return;
    }
    if (ui.pendingPin.c === compId && ui.pendingPin.p === pinId) {
      ui.pendingPin = null; render(); return;
    }
    var a = ui.pendingPin;
    // 同名引脚重复连线不重复添加
    var dup = state.wires.some(function (w) {
      return (w.a.c === a.c && w.a.p === a.p && w.b.c === compId && w.b.p === pinId) ||
             (w.a.c === compId && w.a.p === pinId && w.b.c === a.c && w.b.p === a.p);
    });
    if (!dup) {
      state.wires.push({ id: uid('w'), a: { c: a.c, p: a.p }, b: { c: compId, p: pinId } });
      invalidate();
      commit('wire');
    }
    ui.pendingPin = null;
    setHint('');
  }

  function select(id) {
    if (ui.sel === id && !ui.selWire) return;
    ui.sel = id;
    ui.selWire = null;
    ui.selWireAt = null;
    render();
    renderInspector();
  }

  function selectWire(id, at) {
    ui.sel = null;
    ui.selWire = id;
    ui.selWireAt = at || null;
    render();
    renderInspector();
  }

  /* =====================================================
   * 操作
   * ===================================================== */
  function addPart(partId, x, y) {
    var def = Parts.get(partId);
    var c = {
      id: uid('c'), part: partId,
      x: x == null ? 120 + Math.random() * 200 : x,
      y: y == null ? 120 + Math.random() * 120 : y,
      rot: 0, props: {}
    };
    state.components.push(c);
    invalidate();
    commit('add');
    select(c.id);
    setHint('已放入「' + def.name + '」。拖动引脚之间的空档可连线，双击可旋转。');
  }

  function deleteSelected() {
    if (ui.selWire) {
      state.wires = state.wires.filter(function (w) { return w.id !== ui.selWire; });
      ui.selWire = null;
      ui.selWireAt = null;
      invalidate();
      commit('delete-wire');
      return;
    }
    if (!ui.sel) return;
    var id = ui.sel;
    state.components = state.components.filter(function (c) { return c.id !== id; });
    state.wires = state.wires.filter(function (w) { return w.a.c !== id && w.b.c !== id; });
    ui.sel = null;
    invalidate();
    commit('delete');
  }

  /* =====================================================
   * 选中项上方的悬浮工具条
   *
   * 选中元件或导线后，在它正上方浮一组按钮：元件有「旋转 + 删除」，
   * 导线只有「删除」（导线没有朝向可言，转了也没意义）。
   * 用 HTML 覆盖层而不是 SVG 元素：按钮要保持屏幕尺寸恒定，
   * 跟着画布缩放一起缩放的话，缩小后按钮就点不中了。
   * ===================================================== */
  function updateFloatTools() {
    var box = $('#float-tools');
    var a = selectionAnchor();
    if (!a) { box.hidden = true; return; }
    box.hidden = false;
    $('#float-rot').hidden = !ui.sel;
    // 世界坐标 → 画布坐标
    var sx = a.x * ui.scale + ui.tx;
    var sy = a.y * ui.scale + ui.ty - 10;
    // #canvas 是 overflow:hidden，按钮有一半出界就会被裁掉而点不到，必须夹在画布内
    var w = box.offsetWidth, h = box.offsetHeight;
    var boxW = $('#canvas').clientWidth;
    box.style.left = Math.round(Math.max(w / 2 + 4, Math.min(boxW - w / 2 - 4, sx))) + 'px';
    box.style.top = Math.round(Math.max(h + 4, sy)) + 'px';
  }

  /**
   * 按住「旋转」按钮绕元件中心转。
   * 角度取「元件中心 → 光标」的方向（元件长轴沿 x 轴，0° 就是指向右）。
   * 默认 15° 一档，拖起来不跳；按住 Shift 放开到 1° 做微调。
   * 拖动过程中只改 rot、松手才 commit —— 否则一次拖动会灌进几十个撤销步。
   */
  function startRotateDrag(e) {
    e.stopPropagation();
    e.preventDefault();
    var c = byId(ui.sel);
    if (!c) return;
    var box = $('#canvas').getBoundingClientRect();
    var cx = box.left + c.x * ui.scale + ui.tx;   // 元件中心的屏幕坐标
    var cy = box.top + c.y * ui.scale + ui.ty;
    var moved = false;

    function onMove(ev) {
      var deg = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI;
      var step = ev.shiftKey ? 1 : 15;
      c.rot = ((Math.round(deg / step) * step) % 360 + 360) % 360;
      moved = true;
      state.autoLayout = false;   // 手动摆了角度，自动布局就别再改回来
      render();
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (moved) { renderInspector(); commit('rotate'); }
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  /** 选中项正上方的世界坐标锚点 */
  function selectionAnchor() {
    if (ui.sel) {
      var c = byId(ui.sel);
      if (!c) return null;
      return { x: c.x, y: c.y - Parts.bbox(c).h / 2 };
    }
    if (ui.selWire) {
      var r = routed.filter(function (x) { return x.id === ui.selWire; })[0];
      if (!r) return null;
      return wireAnchor(r, ui.selWireAt);
    }
    return null;
  }

  /**
   * 导线上找一个「横段」当锚点，按钮才贴得住线。
   * 优先用点选时记下的位置；没有（键盘选中 / 撤销后）就取最长的那条横段。
   * 早先取的是外接盒的左上角，绕远路的导线会把按钮甩到离线很远的地方。
   */
  function wireAnchor(r, hint) {
    var i;
    if (hint) {
      var hx = { x: hint.x, y: hint.y };
      // 吸附到离点击点最近的横段上
      var best = null, bestD = Infinity;
      for (i = 0; i < r.pts.length - 1; i++) {
        var a = r.pts[i], b = r.pts[i + 1];
        if (Math.abs(a.y - b.y) > 0.5) continue;
        var mx = (a.x + b.x) / 2;
        var d = Math.abs(mx - hx.x) + Math.abs(a.y - hx.y) * 2;
        if (d < bestD) { bestD = d; best = { x: mx, y: a.y }; }
      }
      if (best) return best;
    }
    var pick = null, pickLen = -1;
    for (i = 0; i < r.pts.length - 1; i++) {
      var p = r.pts[i], q = r.pts[i + 1];
      if (Math.abs(p.y - q.y) > 0.5) continue;
      var len = Math.abs(q.x - p.x);
      if (len > pickLen) { pickLen = len; pick = { x: (p.x + q.x) / 2, y: p.y }; }
    }
    if (pick) return pick;
    var mid = r.pts[Math.floor(r.pts.length / 2)];
    return { x: mid.x, y: mid.y };
  }

  /** 一键转换：实物图 ⇄ 电路图 */
  function convert() {
    var an = getAnalysis();
    if (!an.ok) {
      setHint('电路还连不完整，先把回路接通。');
      return;
    }
    state.view = state.view === 'pictorial' ? 'schematic' : 'pictorial';
    state.autoLayout = true;
    invalidate();
    commit('convert');
    setTimeout(fitView, 0);
    setHint(state.view === 'schematic'
      ? '已转换成电路图：主回路为矩形，并联支路上下对齐。'
      : '已转换成实物图：元件散放，导线按极性着色（正极红、负极黑）。');
    renderViewBtns();
  }

  function tidy() {
    var an = getAnalysis();
    if (!an.ok) { setHint('回路不完整，暂不能自动排布。'); return; }
    state.autoLayout = true;
    invalidate();
    commit('tidy');
    setTimeout(fitView, 0);
    setHint('已按规范重新排布。');
  }

  function loadDemo() {
    state.components = []; state.wires = []; state.seq = 1;
    var B = 'c1', S = 'c2', A = 'c3', L = 'c4', V = 'c5';
    state.components = [
      { id: B, part: 'battery',   x: 0, y: 0, rot: 0, props: {} },
      { id: S, part: 'switch',    x: 0, y: 0, rot: 0, props: { closed: true } },
      { id: A, part: 'ammeter',   x: 0, y: 0, rot: 0, props: {} },
      { id: L, part: 'bulb',      x: 0, y: 0, rot: 0, props: {} },
      { id: V, part: 'voltmeter', x: 0, y: 0, rot: 0, props: {} }
    ];
    state.seq = 6;
    function w(a, ap, b, bp) {
      state.wires.push({ id: uid('w'), a: { c: a, p: ap }, b: { c: b, p: bp } });
    }
    w(B, 'a', S, 'a');   // 电池+ → 开关
    w(S, 'b', A, 'a');   // 开关 → 电流表
    w(A, 'b', L, 'a');   // 电流表 → 灯泡
    w(L, 'a', V, 'a');   // 电压表并在灯泡两端
    w(L, 'b', V, 'b');
    w(V, 'b', B, 'b');
    invalidate();
    state.view = 'pictorial';
    state.autoLayout = true;
    commit('demo');
    renderViewBtns();
    setTimeout(fitView, 0);
    setHint('示例电路：灯泡与电流表串联、电压表并联在灯泡两端。点「一键转换」看电路图。');
  }

  function clearAll() {
    state.components = []; state.wires = [];
    invalidate();
    commit('clear');
    setHint('已清空。');
  }

  /* =====================================================
   * 导出
   * ===================================================== */
  /** 导出的 SVG 是独立文件，页面上的 CSS 变量它一个都没有，
   *  var() 留着就是无效值（接线柱会变回默认黑）。这里换成具体色值。 */
  var EXPORT_VARS = {
    'var(--wire-pos)': '#e04a4a',
    'var(--wire-neg)': '#2b2f36',
    'var(--wire-mid)': '#6b7280'
  };
  function resolveVars(s, postMap) {
    // 先把接线柱占位的 var(--post-a/b) 换成按电位算出的颜色，再把主题变量换成具体色值。
    // 顺序不能反：postMap 里存的就是 var(--wire-*) 这一类，要留到下一步才展开。
    s = s.replace(/var\(--post-([ab])\)/g, function (m, pin) {
      return (postMap && postMap[pin]) || 'var(--wire-mid)';
    });
    return s.replace(/var\(--wire-(?:pos|neg|mid)\)/g, function (m) { return EXPORT_VARS[m]; });
  }

  /** {a:'var(--wire-pos)',...} → '--post-a:var(--wire-pos);--post-b:var(--wire-neg)' */
  function postVarCss(colors) {
    return Object.keys(colors)
      .map(function (k) { return '--post-' + k + ':' + colors[k]; }).join(';');
  }

  function svgMarkup() {
    var routes = buildRoutes();
    var an = getAnalysis();

    // 画布范围按「元件 + 走线」的实际几何算，不再依赖布局给的 width/height
    var LABEL_H = 36, PAD = 40;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function grow(x, y) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    state.components.forEach(function (c) {
      var b = Parts.bbox(c);
      grow(b.x, b.y);
      grow(b.x + b.w, b.y + b.h + LABEL_H);
    });
    routes.forEach(function (r) { r.pts.forEach(function (p) { grow(p.x, p.y); }); });
    if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 600; maxY = 400; }

    var w = Math.max(600, maxX - minX + PAD * 2);
    var h = Math.max(400, maxY - minY + PAD * 2);

    var inner = [];
    inner.push('<g fill="none" stroke="#1c1f24" stroke-width="2.2" stroke-linecap="round"' +
      ' stroke-linejoin="round">' +
      routes.map(function (r) { return '<path d="' + r.d + '"/>'; }).join('') + '</g>');
    state.components.forEach(function (c) {
      var def = Parts.get(c.part);
      // 实物图接线柱的 var(--post-a/b) 交给 resolveVars 就地换成色值，
      // 和页面上的 <g style> 注入走的是同一份 Layout.postColors 结果
      var posts = state.view === 'pictorial' ? Layout.postColors(an, c) : null;
      var art = resolveVars(state.view === 'schematic' ? def.schematic(c.props) : def.pictorial(c.props), posts);
      // 电路图符号在页面里靠 CSS 变量取色，导出时必须显式给描边，否则全变黑块
      var wrapped = state.view === 'schematic'
        ? '<g fill="none" stroke="#1c1f24" stroke-width="2.4" stroke-linecap="round"' +
          ' stroke-linejoin="round">' + art + '</g>'
        : art;
      inner.push('<g transform="translate(' + c.x + ',' + c.y + ')' +
        (c.rot ? ' rotate(' + c.rot + ')' : '') + '">' + wrapped + '</g>');
    });
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h +
      '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<g transform="translate(' + (PAD - minX) + ',' + (PAD - minY) + ')">' +
      inner.join('') + '</g></svg>';
  }

  function exportSVG() {
    var blob = new Blob([svgMarkup()], { type: 'image/svg+xml;charset=utf-8' });
    download(blob, '电路图.svg');
  }

  function exportPNG() {
    var svg = svgMarkup();
    var url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    var img = new Image();
    img.onload = function () {
      var c = document.createElement('canvas');
      var m = 4;
      c.width = img.width * m; c.height = img.height * m;
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(function (b) { download(b, '电路图.png'); }, 'image/png');
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  function exportJSON() {
    var data = JSON.stringify({
      version: 1,
      view: state.view,
      components: state.components,
      wires: state.wires
    }, null, 2);
    download(new Blob([data], { type: 'application/json' }), '电路图.json');
  }

  function importJSON(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var d = JSON.parse(r.result);
        if (!Array.isArray(d.components) || !Array.isArray(d.wires)) throw new Error('bad');
        state.components = d.components;
        state.wires = d.wires;
        state.seq = 1000;
        invalidate();
        commit('import');
        setHint('已导入。');
      } catch (e) {
        setHint('这个 JSON 读不了，请选择本工具导出的文件。');
      }
    };
    r.readAsText(file);
  }

  function download(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function copyShareLink() {
    var link = location.origin + location.pathname + '?d=' + encodeState();
    navigator.clipboard.writeText(link).then(function () {
      setHint('分享链接已复制到剪贴板。');
    }, function () {
      prompt('复制这个链接：', link);
    });
  }

  function setHint(msg) {
    var h = $('#hint');
    h.textContent = msg || '';
    h.style.display = msg ? 'block' : 'none';
  }

  /* =====================================================
   * 侧栏
   * ===================================================== */
  function renderPalette() {
    var groups = [
      ['source', '电源'],
      ['load', '用电器'],
      ['control', '控制与保护'],
      ['resistor', '电阻'],
      ['meter', '电表']
    ];
    $('#palette').innerHTML = groups.map(function (g) {
      var ids = Parts.byCategory(g[0]);
      if (!ids.length) return '';
      return '<div class="pgroup"><div class="ptitle">' + g[1] + '</div>' +
        ids.map(function (id) {
          var d = Parts.get(id);
          return '<button class="pbtn" data-part="' + id + '" title="' + d.name + '">' +
            '<span class="pico">' + d.icon + '</span><span>' + d.short + '</span></button>';
        }).join('') + '</div>';
    }).join('');
  }

  function renderInspector() {
    var box = $('#inspector');

    if (ui.selWire) {
      var w = wireById(ui.selWire);
      box.innerHTML = w
        ? '<div class="ins-title">导线</div><div class="muted">' +
            esc(pinLabel(w.a)) + ' ↔ ' + esc(pinLabel(w.b)) + '</div>' +
            '<button class="danger" id="p-del">删除该导线</button>'
        : '<div class="muted">选中一个元件可改属性</div>';
      if (w) $('#p-del').onclick = deleteSelected;
      return;
    }

    var c = ui.sel && byId(ui.sel);
    if (!c) { box.innerHTML = '<div class="muted">选中一个元件可改属性</div>'; return; }
    var def = Parts.get(c.part);
    var html = '<div class="ins-title">' + def.name + '</div>';
    if (def.category === 'control' && c.part === 'switch') {
      html += '<label class="row"><input type="checkbox" id="p-closed"' +
        (c.props.closed ? ' checked' : '') + '> 开关闭合</label>';
    }
    if (c.part === 'rheostat') {
      html += '<label class="row">滑片位置 <input type="range" id="p-pct" min="0" max="100" value="' +
        Math.round((c.props.pct == null ? 0.5 : c.props.pct) * 100) + '"></label>';
    }
    // 拖旋转按钮能摆出任意角度，这里就得把当前角度补进选项 ——
    // 不然选了 225° 的元件，下拉框一个都不选中，会显示成第一项的 0°
    var rot = c.rot || 0;
    var angles = [0, 90, 180, 270];
    if (angles.indexOf(rot) < 0) angles.push(rot);
    angles.sort(function (x, y) { return x - y; });
    html += '<label class="row">旋转 <select id="p-rot">' +
      angles.map(function (r) {
        return '<option value="' + r + '"' + (rot === r ? ' selected' : '') + '>' +
          r + '°</option>';
      }).join('') + '</select></label>';
    html += '<button class="danger" id="p-del">删除该元件</button>';
    box.innerHTML = html;

    var closed = $('#p-closed');
    if (closed) closed.onchange = function () {
      c.props.closed = closed.checked; invalidate(); commit('prop');
    };
    var pct = $('#p-pct');
    if (pct) pct.oninput = function () {
      c.props.pct = pct.value / 100; invalidate(); render();
    };
    $('#p-rot').onchange = function (e) {
      c.rot = +e.target.value; state.autoLayout = false; invalidate(); commit('rot');
    };
    $('#p-del').onclick = deleteSelected;
  }

  function renderViewBtns() {
    $$('.viewbtn').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-view') === state.view);
    });
  }
  function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }

  /* =====================================================
   * 启动
   * ===================================================== */
  function init() {
    $('#stage').addEventListener('click', function (e) { e.stopPropagation(); });

    renderPalette();
    bindCanvas();
    renderViewBtns();

    $('#palette').addEventListener('click', function (e) {
      var b = e.target.closest('.pbtn');
      if (b) addPart(b.getAttribute('data-part'));
    });

    $$('.viewbtn').forEach(function (b) {
      b.addEventListener('click', function () {
        state.view = b.getAttribute('data-view');
        state.autoLayout = true;
        invalidate(); commit('view');
        renderViewBtns();
        setTimeout(fitView, 0);
      });
    });

    $('#btn-convert').onclick = convert;
    $('#btn-tidy').onclick = tidy;
    $('#btn-undo').onclick = undo;
    $('#btn-redo').onclick = redo;
    $('#btn-demo').onclick = loadDemo;
    $('#btn-clear').onclick = clearAll;
    $('#btn-png').onclick = exportPNG;
    $('#btn-svg').onclick = exportSVG;
    $('#btn-json').onclick = exportJSON;
    $('#btn-share').onclick = copyShareLink;
    $('#btn-import').onclick = function () { $('#file-input').click(); };
    $('#file-input').onchange = function (e) {
      if (e.target.files[0]) importJSON(e.target.files[0]);
      e.target.value = '';
    };
    $('#btn-fit').onclick = fitView;
    $('#btn-reset-view').onclick = function () { ui.scale = 1; ui.tx = 0; ui.ty = 0; render(); };

    // 悬浮工具条：必须拦掉冒泡，否则这一下会同时被画布当成「空白处按下」而起平移
    $('#float-del').addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    $('#float-del').addEventListener('click', deleteSelected);
    $('#float-rot').addEventListener('pointerdown', startRotateDrag);

    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      var meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
      else if (e.key === 'Escape') { ui.pendingPin = null; ui.sel = null; ui.selWire = null; ui.selWireAt = null; render(); renderInspector(); }
    });

    window.addEventListener('resize', render);

    // 主题切换 → 重绘（符号走 CSS 变量，通常无需重排）
    document.documentElement.addEventListener('themechange', function () { render(); });

    // 启动数据
    // prev 要在第一次 commit（loadDemo）之前就位，否则压进去的是 null
    prev = snapshot();
    var fromUrl = location.search.match(/[?&]d=([^&]+)/);
    if (fromUrl) {
      var d = decodeState(decodeURIComponent(fromUrl[1]));
      if (d) {
        state.components = d.components;
        state.wires = d.wires;
        state.seq = d.seq;
        state.view = 'schematic';
        state.autoLayout = true;
        invalidate();
        setHint('已从分享链接载入。');
      }
    } else if (!load()) {
      loadDemo();
    }
    renderViewBtns();
    render();
    renderInspector();
    setTimeout(fitView, 0);
  }

  function fitView() {
    var an = getAnalysis();
    if (!an.ok || !state.components.length) return;
    var box = $('#canvas');
    var LABEL_H = 36;            // 元件名画在元件下方，缩放适配时要把这段算进去，否则名字被切掉
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    state.components.forEach(function (c) {
      var b = Parts.bbox(c);
      minX = Math.min(minX, c.x - b.w / 2); maxX = Math.max(maxX, c.x + b.w / 2);
      minY = Math.min(minY, c.y - b.h / 2); maxY = Math.max(maxY, c.y + b.h / 2 + LABEL_H);
    });
    var w = maxX - minX, h = maxY - minY;
    if (w <= 0 || h <= 0) return;
    var pad = 60;
    ui.scale = Math.max(0.3, Math.min(2, Math.min((box.clientWidth - pad) / w, (box.clientHeight - pad) / h)));
    ui.tx = (box.clientWidth - w * ui.scale) / 2 - minX * ui.scale;
    ui.ty = (box.clientHeight - h * ui.scale) / 2 - minY * ui.scale;
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
