/* =====================================================
 * 电路画板 — 自动布局
 *
 * 两个方向共用同一份拓扑：
 *   layoutSchematic  实物图 → 规范电路图（教材排法：主回路矩形 + 并联支路对齐）
 *   layoutPictorial  电路图 → 实物图（元件散放 + 红黑导线）
 *
 * 布局只产出「元件坐标 + 折线走线」，不产生也不修改 wires ——
 * wires 是用户意图，布局只是它的一种画法。
 * ===================================================== */
(function (global) {
  'use strict';

  var Parts = global.CircuitParts;
  var Net = global.CircuitNet;
  var PIN = Parts.PIN_DX;      // 32
  var M = Parts.M;

  var ROW_GAP = 84;            // 并联支行间距
  var STEP_GAP = 96;           // 相邻串联单元间距
  var JUNC = 26;               // 并联汇流点距引脚的距离
  var BATT_GAP = 64;           // 电源与电路主体的垂直间距
  var PAD = 48;                // 画布留白

  /* =====================================================
   * 电路图布局
   * ===================================================== */

  /**
   * @returns {{positions:Object, width:number, height:number}|null}
   */
  function layoutSchematic(state, an) {
    if (!an.ok || !an.steps.length) return null;
    unitCache = {};                 // 每次重排都重算，避免脏缓存

    var steps = an.steps;

    // ---- 1. 量出每个 step 的宽度 ----
    var maxRows = 1;
    steps.forEach(function (s) { maxRows = Math.max(maxRows, s.items.length); });

    var widths = steps.map(function (s) {
      // step 内部宽度 = 最宽的一个串联单元 + 汇流点
      var inner = 0;
      s.items.forEach(function (it) { inner = Math.max(inner, unitWidth(it, state)); });
      return inner + (s.items.length > 1 ? JUNC * 2 : 0);
    });

    // ---- 2. 水平推进 ----
    var x = 0;
    var geo = steps.map(function (s, i) {
      var w = widths[i];
      var xLeft = x;
      var xRight = x + w;
      x = xRight + STEP_GAP;
      return { xLeft: xLeft, xRight: xRight, cx: (xLeft + xRight) / 2, width: w };
    });
    var totalW = geo[geo.length - 1].xRight;

    // ---- 3. 电源放在底部居中，竖放（GB 4728.1 §4.5.2 允许旋转）----
    var yBottomRow = (maxRows - 1) * ROW_GAP;
    var battCx = totalW / 2;
    var battCy = yBottomRow + BATT_GAP + PIN;

    var positions = {};

    // ---- 4. 摆放每个 step ----
    // 注意这里不再产出走线：走线改由 routeWire() 按每根 state.wires 单独算，
    // 这样导线才和用户连的那一根一一对应（可选中、可删除），也能各自绕开元件。
    steps.forEach(function (s, i) {
      var g = geo[i];
      s.items.forEach(function (it, row) {
        var y = row * ROW_GAP;
        var sub = seriesOffsets(it, state);
        sub.cx.forEach(function (dx, k) {
          var compId = it.comps[k];
          // 电源自己单独摆，不跟着串联单元走
          if (isSourceComp(compId, state)) return;
          positions[compId] = { x: g.cx + dx, y: y, rot: 0 };
        });
      });
    });

    // ---- 5. 电源 ----
    if (an.source) {
      positions[an.source.id] = { x: battCx, y: battCy, rot: 90 };
    }

    // ---- 6. 归一化到正坐标 ----
    var shift = { x: PAD + PAD, y: PAD + PAD };
    Object.keys(positions).forEach(function (id) {
      positions[id].x += shift.x;
      positions[id].y += shift.y;
    });

    var maxX = battCx + shift.x + PIN;
    var maxY = battCy + shift.y + PIN;

    return {
      positions: positions,
      width: maxX + PAD,
      height: maxY + PAD
    };
  }

  function isSourceComp(id, state) {
    var c = state.components.filter(function (x) { return x.id === id; })[0];
    return c && Parts.get(c.part).category === 'source';
  }

  /** 一个串联单元里各元件的横向偏移 + 整体引脚位置 */
  var unitCache = {};
  function seriesOffsets(unit, state) {
    if (unitCache[unitKey(unit)]) return unitCache[unitKey(unit)];

    var n = unit.comps.length;
    var comps = unit.comps.map(function (id) {
      return state.components.filter(function (x) { return x.id === id; })[0];
    }).filter(Boolean);

    if (comps.length === 0) {
      return { cx: [0], pinL: 0, pinR: 0 };
    }

    // 单个元件：整体就是一个
    if (comps.length === 1) {
      var r = { cx: [0], pinL: -PIN, pinR: PIN, len: comps.length };
      unitCache[unitKey(unit)] = r;
      return r;
    }

    // 多个串联元件：依次排开
    var cx = [], cur = 0;
    for (var i = 0; i < comps.length; i++) {
      if (i > 0) cur += STEP_GAP;
      cx.push(cur);
      cur += PIN;
    }
    // 偏移量要以「整个单元的中心」为原点：调用方是把它加到 step 盒子的中心 g.cx 上，
    // 而 g.cx 是 (xLeft+xRight)/2。若沿用以首件为原点的偏移，多元件单元会整体右移半个单元，
    // 末件戳出 xRight，unitWidth 量出来的盒子宽度也跟着少算半个单元 —— 单元之间就不够分了。
    var half = (cx[cx.length - 1] - cx[0]) / 2;
    cx = cx.map(function (v) { return v - half; });
    var pinL = cx[0] - PIN;
    var pinR = cx[cx.length - 1] + PIN;
    var res = { cx: cx, pinL: pinL, pinR: pinR, len: comps.length };
    unitCache[unitKey(unit)] = res;
    return res;
  }

  function unitKey(unit) {
    return unit.comps.slice().sort().join('|');
  }

  function unitWidth(unit, state) {
    var o = seriesOffsets(unit, state);
    return (o.pinR - o.pinL);
  }

  /* =====================================================
   * 实物图布局
   *
   * 实物图不用整齐的矩形主回路，而是把元件散放在面板上，
   * 导线按「节点电位」上色：接电池正极的红、负极的黑。
   * 这既是真实实验的接线习惯，也顺带教了极性。
   * ===================================================== */

  function layoutPictorial(state, an) {
    var src = an.source;

    // 按拓扑顺序摆，电源放在链条起点 —— 实物图里"挨着的元件才是接在一起的"
    var order = [];
    if (an.ok) {
      an.steps.forEach(function (s) {
        s.items.forEach(function (it) { order = order.concat(it.comps); });
      });
    }
    state.components.forEach(function (c) {
      if (order.indexOf(c.id) < 0) order.push(c.id);
    });
    var srcId = src ? src.id : null;
    if (srcId) order = [srcId].concat(order.filter(function (id) { return id !== srcId; }));

    var n = order.length;
    if (!n) return null;

    var CW = 210, CH = 190;                      // 网格间距，大于最大元件尺寸，避免重叠
    var COLS = Math.max(2, Math.min(3, Math.ceil(Math.sqrt(n))));

    var positions = {};
    order.forEach(function (id, i) {
      var row = Math.floor(i / COLS);
      var k = i % COLS;
      var col = (row % 2 === 0) ? k : (COLS - 1 - k);   // 蛇形：奇数行从右往左回折
      var off = ((i * 37) % 5) - 2;                   // 稳定的小偏移，避免太死板
      positions[id] = {
        x: PAD + 130 + col * CW + off * 6,
        y: PAD + 120 + row * CH + off * 9,
        rot: 0
      };
    });

    // 走线不在这里产出：和电路图一样，交给 routeWire() 按每根 state.wires 单独绕，
    // 保证「画出来的这根线」就是「用户连的那一根」。
    var maxX = PAD, maxY = PAD;
    state.components.forEach(function (c) {
      var sz = Parts.get(c.part).size;
      var p = positions[c.id];
      if (!p) return;
      maxX = Math.max(maxX, p.x + sz.w / 2);
      maxY = Math.max(maxY, p.y + sz.h / 2);
    });

    return {
      positions: positions,
      width: maxX + PAD,
      height: maxY + PAD
    };
  }

  /** 返回的是 CSS 变量名而不是色值：负极那根线写死近黑的话，
   *  深色主题下整根线都看不见，必须让配色跟着主题走。 */
  function wireColor(net, posNet, negNet) {
    if (!net) return 'var(--wire)';
    if (net.id === posNet) return 'var(--wire-pos)';     // 红
    if (net.id === negNet) return 'var(--wire-neg)';     // 黑
    return 'var(--wire-mid)';                             // 其它节点中性灰
  }

  /* =====================================================
   * 正交走线：绕开元件，别被元件压住
   *
   * 电路图要的是教科书那种直角折线，实物图也需要「绕过去」而不是直穿过去，
   * 所以两种视图共用这一套走线，差别只在拐角圆角的大小。
   *
   * 算法是候选集打分，不是完整搜索（一维通道足够用了）：
   *   L 形 2 种 + 中点 Z 形 2 种 + 贴着每个障碍物外沿的绕行通道，
   *   再按「压到几个元件 → 总长 → 弯折数」排序取最优。
   *
   * 只避让元件，不避让别的导线 —— 电路图里导线交叉本来就正常，
   * 两条线共享一段反而正好读作「一个接线柱在分叉」。
   * ===================================================== */

  var CLEAR = 14;          // 导线与元件外接盒之间保留的净空

  /** 元件外接盒外扩 CLEAR，作为走线障碍 */
  function obstaclesOf(state) {
    return state.components.map(function (c) {
      var b = Parts.bbox(c);
      return {
        id: c.id,
        x: b.x - CLEAR, y: b.y - CLEAR,
        w: b.w + CLEAR * 2, h: b.h + CLEAR * 2
      };
    });
  }

  /**
   * 引脚朝外引出一小段，落到外接盒外扩 CLEAR 之后。
   *
   * 走线从两个 stub 之间起算、终点落在 stub 上，两端元件因此可以继续留在障碍集里。
   * 不这么做的话，一根线可以横穿自己元件的机身：电流表 b 脚出来的线往左画过表盘再拐弯，
   * 看上去就像接在了 a 脚上（「两根线接在同一个接线柱」）。
   */
  function stub(inst, pinId) {
    var p = Parts.pinPos(inst, pinId);
    var dx = p.x - inst.x, dy = p.y - inst.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= len; dy /= len;
    var b = Parts.bbox(inst);
    var t = Infinity;                      // 沿 (dx,dy) 走出外接盒要走出多远
    if (dx > 1e-6) t = Math.min(t, (b.x + b.w - p.x) / dx);
    if (dx < -1e-6) t = Math.min(t, (b.x - p.x) / dx);
    if (dy > 1e-6) t = Math.min(t, (b.y + b.h - p.y) / dy);
    if (dy < -1e-6) t = Math.min(t, (b.y - p.y) / dy);
    t = (isFinite(t) && t > 0 ? t : 0) + CLEAR + 4;
    return { x: p.x + dx * t, y: p.y + dy * t };
  }

  /** 轴对齐线段是否穿过矩形内部（压边不算，给贴边走线留余地） */
  function segHits(a, b, r) {
    if (Math.abs(a.y - b.y) < 0.5) {
      if (a.y <= r.y + 0.5 || a.y >= r.y + r.h - 0.5) return false;
      var x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
      return x1 > r.x + 0.5 && x0 < r.x + r.w - 0.5;
    }
    var x0 = Math.min(a.y, b.y), y0 = Math.max(a.y, b.y);
    if (a.x <= r.x + 0.5 || a.x >= r.x + r.w - 0.5) return false;
    return y0 > r.y + 0.5 && x0 < r.y + r.h - 0.5;
  }

  function polyHits(pts, obstacles) {
    var n = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      for (var k = 0; k < obstacles.length; k++) {
        if (segHits(pts[i], pts[i + 1], obstacles[k])) { n++; break; }
      }
    }
    return n;
  }

  function polyLen(pts) {
    var s = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      s += Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
    }
    return s;
  }

  /** 去掉重复点与共线中间点 */
  function tidy(pts) {
    var out = [];
    pts.forEach(function (p) {
      var last = out[out.length - 1];
      if (!last || Math.abs(last.x - p.x) > 0.5 || Math.abs(last.y - p.y) > 0.5) out.push(p);
    });
    for (var i = 1; i < out.length - 1;) {
      var a = out[i - 1], b = out[i], c = out[i + 1];
      var collinear = (Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) ||
                      (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5);
      if (collinear) out.splice(i, 1); else i++;
    }
    return out;
  }

  /**
   * @param p0,p1 {{x,y}} 两端引脚位置
   * @param obstacles 障碍盒数组（调用方需先把两端元件自己剔掉，否则引脚落在自己盒内）
   * @returns {Array<{x,y}>} 首点 p0、末点 p1 的正交折线
   */
  function routeWire(p0, p1, obstacles) {
    var cands = [];

    // 同轴直连
    if (Math.abs(p0.y - p1.y) < 0.5 || Math.abs(p0.x - p1.x) < 0.5) cands.push([p0, p1]);

    // L 形：先竖后横 / 先横后竖
    cands.push([p0, { x: p1.x, y: p0.y }, p1]);
    cands.push([p0, { x: p0.x, y: p1.y }, p1]);

    // 中点 Z 形
    var mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
    cands.push([p0, { x: mx, y: p0.y }, { x: mx, y: p1.y }, p1]);
    cands.push([p0, { x: p0.x, y: my }, { x: p1.x, y: my }, p1]);

    // 绕行通道：贴着每个障碍物外沿走
    obstacles.forEach(function (r) {
      [r.x - 2, r.x + r.w + 2].forEach(function (cx) {
        cands.push([p0, { x: cx, y: p0.y }, { x: cx, y: p1.y }, p1]);
      });
      [r.y - 2, r.y + r.h + 2].forEach(function (cy) {
        cands.push([p0, { x: p0.x, y: cy }, { x: p1.x, y: cy }, p1]);
      });
    });

    var best = null, bestScore = Infinity;
    cands.forEach(function (raw) {
      var pts = tidy(raw);
      if (pts.length < 2) return;
      var score = polyHits(pts, obstacles) * 100000 + polyLen(pts) + (pts.length - 2) * 12;
      if (score < bestScore) { bestScore = score; best = pts; }
    });
    return best || [p0, p1];
  }

  function fmt(v) { return Math.round(v * 10) / 10; }

  /**
   * 折线 → SVG path，直角拐点用二次贝塞尔倒圆角。
   * 倒角是必须的：直角拐点在 2.2px 线宽下会糊成一团，印刷电路图也都走圆角。
   */
  function orthoPath(pts, r) {
    if (pts.length < 2) return '';
    var d = 'M' + fmt(pts[0].x) + ' ' + fmt(pts[0].y);
    for (var i = 1; i < pts.length - 1; i++) {
      var p = pts[i], a = pts[i - 1], b = pts[i + 1];
      var inLen = Math.abs(p.x - a.x) + Math.abs(p.y - a.y);
      var outLen = Math.abs(b.x - p.x) + Math.abs(b.y - p.y);
      var rr = Math.min(r, inLen / 2, outLen / 2);
      if (rr < 1) { d += ' L' + fmt(p.x) + ' ' + fmt(p.y); continue; }
      var s = { x: p.x + (a.x - p.x) / inLen * rr, y: p.y + (a.y - p.y) / inLen * rr };
      var e = { x: p.x + (b.x - p.x) / outLen * rr, y: p.y + (b.y - p.y) / outLen * rr };
      d += ' L' + fmt(s.x) + ' ' + fmt(s.y) +
           ' Q' + fmt(p.x) + ' ' + fmt(p.y) + ' ' + fmt(e.x) + ' ' + fmt(e.y);
    }
    var last = pts[pts.length - 1];
    return d + ' L' + fmt(last.x) + ' ' + fmt(last.y);
  }

  /* =====================================================
   * 导出
   * ===================================================== */
  /**
   * 实物图接线柱的颜色：跟着这个柱所在**节点的电位**走，规则和导线完全一致
   * （正极红、负极黑、其它中性灰），于是「这根线的颜色 == 它插着的那个柱的颜色」，
   * 看图时不用去对柱子的位置。
   *
   * 标了 fixedPosts 的元件不走这条规则：电表的 +/− 端、电池的两极是约定俗成的
   * 固定色，跟电路怎么接无关（电池没接成通路时也得看得出哪边是正极）。
   *
   * @returns {Object} {a:'var(--wire-pos)', b:'var(--wire-neg)'}，
   *                    由 app.js 注入 art 那层 <g>，页面和导出共用同一份结果
   */
  function postColors(an, comp) {
    var def = Parts.get(comp.part);
    var out = {};
    def.pins.forEach(function (p, i) {
      if (def.fixedPosts) {
        out[p.id] = i === 0 ? 'var(--wire-pos)' : 'var(--wire-neg)';
        return;
      }
      // 没有分析结果时按中性灰处理，别硬套一个可能错的极性
      var net = an && an.netInfo && an.netInfo.netOf[Net.pinKey(comp.id, p.id)];
      out[p.id] = net ? wireColor(net, an.S, an.T) : 'var(--wire-mid)';
    });
    return out;
  }

  global.CircuitLayout = {
    layoutSchematic: layoutSchematic,
    layoutPictorial: layoutPictorial,
    routeWire: routeWire,
    orthoPath: orthoPath,
    obstaclesOf: obstaclesOf,
    stub: stub,
    segHits: segHits,
    wireColor: wireColor,
    postColors: postColors,
    resetCache: function () { unitCache = {}; },
    ROW_GAP: ROW_GAP
  };
})(window);
