/* =====================================================
 * 电路画板 — 元件库
 *
 * 每个元件同时提供两种画法：
 *   schematic()  电路图（GB/T 4728 符号）
 *   pictorial()  实物图（接线柱面板上的实物）
 * 两种画法共用同一套 pins，因此转换时连接关系天然保持。
 *
 * 坐标系约定：元件几何中心在 (0,0)，引线端点固定在
 * pins 上。旋转由外层 <g transform> 处理，不在画法内部做。
 *
 * 模数 M = 16（依据 GB/T 4728.1 §4.4.4「符号显示在模数 M 的网格上」，
 * 该条未给具体数值，此处为工程取值，见 plans/2026-10-13-circuit-symbol-spec.md）
 * ===================================================== */
(function (global) {
  'use strict';

  var M = 16;
  var PIN_DX = 2 * M;          // 引线端点到中心的距离
  var SW = 2.4;                // 线宽 0.15M
  var METAL = '#8a8f98';       // 实物图里的金属件
  var BODY = '#d9dde3';        // 实物图里的元件外壳
  var BODY_DARK = '#b6bcc6';
  var WIRE_RED = '#e04a4a';
  var WIRE_BLACK = '#2b2f36';

  /** 两端元件的通用引脚（水平放置） */
  function twoPins() {
    return [{ id: 'a', x: -PIN_DX, y: 0 }, { id: 'b', x: PIN_DX, y: 0 }];
  }

  /** 水平引线：左端 a、右端 b，一直画到符号本体边缘。
   *  `to` 是本体半宽：圆是 M=16，矩形是 24，二极管是 8。
   *  这里原先写死 PIN_DX-8=24 —— 电阻的矩形正好接上，灯泡/电表的圆(r=16)
   *  却中间空 8px，导线看着停在半路，没插进圆里。 */
  function leads(to) {
    return '<line x1="' + -PIN_DX + '" y1="0" x2="' + (-to) + '" y2="0"/>' +
           '<line x1="' + to + '" y1="0" x2="' + PIN_DX + '" y2="0"/>';
  }

  /** 圆 + 圈内字符（电流表 / 电压表 / 电动机 通用） */
  function dial(ch) {
    return leads(M) +
      '<circle cx="0" cy="0" r="' + M + '"/>' +
      '<text x="0" y="1" text-anchor="middle" dominant-baseline="central" ' +
      'font-size="16" font-family="Georgia, "Times New Roman", serif" ' +
      'fill="#1c1f24" class="sym-text">' + ch + '</text>';
  }

  /** 实物图里的仪表表盘 */
  function pictorialDial(ch) {
    var s = '';
    s += '<circle cx="0" cy="0" r="26" fill="' + BODY + '" stroke="' + BODY_DARK + '" stroke-width="1.5"/>';
    s += '<circle cx="0" cy="0" r="21" fill="#fdfdfd" stroke="' + BODY_DARK + '" stroke-width="1"/>';
    // 刻度
    for (var i = 0; i <= 8; i++) {
      var a = (-220 + i * 35) * Math.PI / 180;
      var r1 = 17, r2 = i % 2 === 0 ? 13 : 15;
      s += '<line x1="' + (Math.cos(a) * r1).toFixed(1) + '" y1="' + (Math.sin(a) * r1).toFixed(1) +
           '" x2="' + (Math.cos(a) * r2).toFixed(1) + '" y2="' + (Math.sin(a) * r2).toFixed(1) +
           '" stroke="' + METAL + '" stroke-width="1"/>';
    }
    s += '<text x="0" y="6" text-anchor="middle" font-size="15" font-weight="600" ' +
         'font-family="Georgia, serif" fill="#2b2f36">' + ch + '</text>';
    s += '<rect x="-5" y="-30" width="10" height="5" fill="' + METAL + '" rx="1"/>';
    return s;
  }

  /** 实物图里的接线柱（每个引脚一个）。
   *  颜色不在这里写死，由 Layout.postColors 按这个柱所在**节点的电位**决定，
   *  规则和导线一致 —— 这样「红线的另一头插在红柱上」这句话才成立。
   *  原先写死 a=红 / b=黑：串在中间的元件两个柱一红一黑，看着像接了正负极，
   *  其实两根线都在中间电位，反而误导。
   *  fill 走 var(--post-a) / var(--post-b)，由所在那层 <g> 注入（页面和导出共用）。 */
  function post(x, pinId) {
    return '<circle cx="' + x + '" cy="0" r="5.5" style="fill:var(--post-' + pinId +
           ');stroke:#828a95;stroke-width:1.2"/>';
  }
  function posts() {
    return twoPins().map(function (p) { return post(p.x, p.id); }).join('');
  }

  /* =====================================================
   * 元件定义
   * ===================================================== */
  var PARTS = {

    /* ---------- 电源 ---------- */
    battery: {
      name: '电池组', short: '电池', icon: '🔋', category: 'source', twoTerminal: true,
      // 正负两极本来就是定义死的，不跟电路走（电路断了也照样一红一黑）
      fixedPosts: true,
      pins: twoPins(),
      schematic: function () {
        // 电池组：长短线交替两组。引线直接接到最外侧极板，不留悬空缝隙
        return '<line x1="' + -PIN_DX + '" y1="0" x2="-16" y2="0"/>' +
               '<line x1="-16" y1="-18" x2="-16" y2="18"/>' +
               '<line x1="-6"  y1="-9"  x2="-6"  y2="9"/>' +
               '<line x1="4"   y1="-18" x2="4"   y2="18"/>' +
               '<line x1="14"  y1="-9"  x2="14"  y2="9"/>' +
               '<line x1="14"  y1="0"   x2="' + PIN_DX + '" y2="0"/>';
      },
      pictorial: function () {
        var s = '';
        s += '<rect x="-30" y="-17" width="60" height="34" rx="6" fill="' + BODY + '" stroke="' + BODY_DARK + '" stroke-width="1.5"/>';
        s += '<rect x="-30" y="-17" width="60" height="12" rx="6" fill="' + BODY_DARK + '" opacity=".5"/>';
        return s + posts();   // 接线柱画最后，免得被机身压掉半边
      },
      size: { w: 84, h: 56 }
    },

    /* ---------- 用电器 ---------- */
    bulb: {
      name: '小灯泡', short: '灯泡', icon: '💡', category: 'load', twoTerminal: true,
      pins: twoPins(),
      schematic: function () {
        return leads(M) + '<circle cx="0" cy="0" r="' + M + '"/>' +
          '<line x1="-11" y1="-11" x2="11" y2="11"/>' +
          '<line x1="-11" y1="11" x2="11" y2="-11"/>';
      },
      pictorial: function () {
        var s = '';
        // 灯丝
        s += '<path d="M -7 6 L -3 -4 L 1 6 L 5 -4 L 9 6" fill="none" stroke="#f0a63c" stroke-width="1.6"/>';
        s += '<line x1="-11" y1="6" x2="-7" y2="6" stroke="#f0a63c" stroke-width="1.6"/>';
        s += '<line x1="9" y1="6" x2="13" y2="6" stroke="#f0a63c" stroke-width="1.6"/>';
        // 玻璃泡
        s += '<circle cx="0" cy="0" r="17" fill="#fff8e6" stroke="#c9cdd4" stroke-width="1.5"/>';
        // 灯头
        s += '<path d="M -8 12 L -7 20 L 7 20 L 8 12 Z" fill="#9aa2ad" stroke="#7b838f" stroke-width="1"/>';
        s += '<line x1="-7" y1="17" x2="7" y2="17" stroke="#7b838f" stroke-width="1"/>';
        s += '<line x1="-7" y1="20" x2="-7" y2="26" stroke="' + METAL + '" stroke-width="2"/>';
        s += '<line x1="7" y1="20" x2="7" y2="26" stroke="' + METAL + '" stroke-width="2"/>';
        return s + posts();
      },
      size: { w: 76, h: 68 }
    },

    motor: {
      name: '电动机', short: '电机', icon: '⚙️', category: 'load', twoTerminal: true,
      pins: twoPins(),
      schematic: function () { return dial('M'); },
      pictorial: function () {
        var s = '';
        s += '<circle cx="0" cy="0" r="22" fill="' + BODY + '" stroke="' + BODY_DARK + '" stroke-width="1.5"/>';
        s += '<text x="0" y="5" text-anchor="middle" font-size="14" font-weight="600" fill="#3b4049">M</text>';
        s += '<line x1="-22" y1="0" x2="-26" y2="0" stroke="' + METAL + '" stroke-width="3"/>';
        s += '<line x1="22" y1="0" x2="26" y2="0" stroke="' + METAL + '" stroke-width="3"/>';
        return s + posts();
      },
      size: { w: 84, h: 56 }
    },

    led: {
      name: '发光二极管', short: 'LED', icon: '💡', category: 'load', twoTerminal: true,
      pins: twoPins(),
      schematic: function () {
        return leads(8) +
          '<path d="M -8 -14 L -8 14 L 8 0 Z"/>' +
          '<line x1="8" y1="-14" x2="8" y2="14"/>' +
          '<line x1="14" y1="-12" x2="22" y2="-20"/>' +
          '<line x1="22" y1="-12" x2="30" y2="-20"/>';
      },
      pictorial: function () {
        var s = '';
        s += '<path d="M -8 -14 L -8 14 L 8 0 Z" fill="#3a3f47" stroke="#2b2f36" stroke-width="1"/>';
        s += '<line x1="8" y1="-14" x2="8" y2="14" stroke="#8a8f98" stroke-width="2.5"/>';
        s += '<line x1="16" y1="-10" x2="24" y2="-18" stroke="#f0c33c" stroke-width="2"/>';
        s += '<line x1="24" y1="-10" x2="32" y2="-18" stroke="#f0c33c" stroke-width="2"/>';
        return s + posts();
      },
      size: { w: 84, h: 56 }
    },

    /* ---------- 控制元件 ---------- */
    switch: {
      name: '开关', short: '开关', icon: '🔘', category: 'control', twoTerminal: true,
      pins: twoPins(),
      // GB/T 4728.7 S00227「动合触点—一般符号」：
      // 左端引线收在一个空心圆上（刀闸转轴），刀身从圆心斜起，右端只剩固定触点引线。
      // 原先右侧那根竖直的「固定触点」竖线是为了让闭合态还认得出是开关，
      // 但国标闭合态本身就是一条直线，加竖线反而不像标准符号了。转轴的空心圆
      // 把可辨识度补了回来 —— 闭合时线是直的，圆还在，一眼知道是开关而不是导线。
      schematic: function (st) {
        var closed = st && st.closed;
        var CX = -14, R = 3, TIP = 18, UP = 22;
        // 刀身起点落在圆周上，而不是圆心 —— 穿过圆心的话小圆看着就不是个圈了
        var a = Math.atan2(-UP, TIP - CX);
        var sx = (closed ? CX + R : CX + Math.cos(a) * R).toFixed(1);
        var sy = (closed ? 0 : Math.sin(a) * R).toFixed(1);
        return '<line x1="' + -PIN_DX + '" y1="0" x2="' + (CX - R) + '" y2="0"/>' +
               '<circle cx="' + CX + '" cy="0" r="' + R + '"/>' +
               '<line x1="' + sx + '" y1="' + sy + '" x2="' + TIP + '" y2="' + (closed ? 0 : -UP) + '"/>' +
               '<line x1="' + TIP + '" y1="0" x2="' + PIN_DX + '" y2="0"/>';
      },
      pictorial: function (st) {
        var closed = st && st.closed;
        var s = '';
        s += '<rect x="-30" y="-14" width="60" height="28" rx="4" fill="' + BODY + '" stroke="' + BODY_DARK + '" stroke-width="1.5"/>';
        s += '<circle cx="-22" cy="0" r="4.5" fill="' + METAL + '"/>';
        s += '<circle cx="22" cy="0" r="4.5" fill="' + METAL + '"/>';
        s += '<line x1="-22" y1="0" x2="' + (closed ? 22 : 16) + '" y2="' + (closed ? 0 : -20) +
             '" stroke="' + BODY_DARK + '" stroke-width="4" stroke-linecap="round"/>';
        s += '<circle cx="' + (closed ? 22 : 16) + '" cy="' + (closed ? 0 : -20) + '" r="3" fill="#7b838f"/>';
        return s + posts();
      },
      size: { w: 84, h: 56 }
    },

    /* ---------- 电阻类 ---------- */
    resistor: {
      name: '定值电阻', short: '电阻', icon: '🟫', category: 'resistor', twoTerminal: true,
      pins: twoPins(),
      // 国标为矩形（非美标折线锯齿形）
      schematic: function () {
        return leads(24) + '<rect x="-24" y="-8" width="48" height="16"/>';
      },
      pictorial: function () {
        var s = '';
        s += '<rect x="-24" y="-8" width="48" height="16" rx="7" fill="#d8c49a" stroke="#a8906a" stroke-width="1.2"/>';
        ['#8a5a2b', '#c0392b', '#d98518', '#e8c547', '#4a8a3c'].forEach(function (c, i) {
          s += '<rect x="' + (-18 + i * 8) + '" y="-8" width="3.5" height="16" fill="' + c + '"/>';
        });
        return s + posts();
      },
      size: { w: 84, h: 56 }
    },

    rheostat: {
      name: '滑动变阻器', short: '变阻器', icon: '🎚️', category: 'resistor', twoTerminal: true,
      pins: twoPins(),
      schematic: function (st) {
        var pct = st && typeof st.pct === 'number' ? st.pct : 0.5;
        return leads(24) +
          '<rect x="-24" y="-8" width="48" height="16"/>' +
          // 斜箭头贯穿电阻体，指向下方滑动接线柱
          '<line x1="' + (-18 + pct * 36).toFixed(1) + '" y1="-24" x2="' + (-18 + pct * 36).toFixed(1) + '" y2="8"/>' +
          '<path d="M ' + (-18 + pct * 36).toFixed(1) + ' 8 l -5 -6 M ' + (-18 + pct * 36).toFixed(1) + ' 8 l 5 -6"/>' +
          // 滑动接线柱（下）
          '<line x1="18" y1="8" x2="18" y2="26"/>';
      },
      pictorial: function (st) {
        var pct = st && typeof st.pct === 'number' ? st.pct : 0.5;
        var s = '';
        s += '<rect x="-32" y="-10" width="64" height="20" rx="3" fill="#c9bfae" stroke="#9a9080" stroke-width="1.2"/>';
        // 电阻丝
        s += '<line x1="-28" y1="0" x2="28" y2="0" stroke="#8a7a5c" stroke-width="2"/>';
        // 滑片
        var sx = (-28 + pct * 56).toFixed(1);
        s += '<line x1="' + sx + '" y1="-20" x2="' + sx + '" y2="0" stroke="' + METAL + '" stroke-width="3" stroke-linecap="round"/>';
        s += '<rect x="' + (sx - 7) + '" y="-26" width="14" height="8" rx="2" fill="' + BODY_DARK + '"/>';
        return s + posts();
      },
      size: { w: 96, h: 72 }
    },

    /* ---------- 电表（教学规则挂在 series/parallel 标记上） ---------- */
    ammeter: {
      name: '电流表', short: '电流表', icon: 'Ⓐ', category: 'meter', twoTerminal: true,
      series: true,   // 必须串联
      // 电表的 +/− 端是约定俗成的固定红/黑，不按所在节点重新上色
      fixedPosts: true,
      pins: twoPins(),
      schematic: function () { return dial('A'); },
      pictorial: function () {
        return pictorialDial('A') + posts();
      },
      size: { w: 88, h: 92 }
    },

    voltmeter: {
      name: '电压表', short: '电压表', icon: 'Ⓥ', category: 'meter', twoTerminal: true,
      parallel: true, // 必须并联
      fixedPosts: true,   // 同上：+ 端红、− 端黑
      pins: twoPins(),
      schematic: function () { return dial('V'); },
      pictorial: function () {
        return pictorialDial('V') + posts();
      },
      size: { w: 88, h: 92 }
    },

    /* ---------- 保护元件 ---------- */
    fuse: {
      name: '保险丝', short: '保险丝', icon: '🔗', category: 'control', twoTerminal: true,
      pins: twoPins(),
      schematic: function () {
        return leads(24) + '<rect x="-24" y="-8" width="48" height="16"/>' +
               '<line x1="-24" y1="8" x2="24" y2="-8"/>';
      },
      pictorial: function () {
        var s = '';
        s += '<rect x="-22" y="-9" width="44" height="18" rx="4" fill="#efe6d2" stroke="#b8a97f" stroke-width="1.2"/>';
        s += '<line x1="-20" y1="7" x2="20" y2="-7" stroke="#a8906a" stroke-width="1.6"/>';
        return s + posts();
      },
      size: { w: 84, h: 56 }
    }
  };

  /* =====================================================
   * 导出
   * ===================================================== */
  global.CircuitParts = {
    M: M,
    PIN_DX: PIN_DX,
    SW: SW,
    WIRE_COLORS: { default: null, red: WIRE_RED, black: WIRE_BLACK },
    defs: PARTS,
    ids: Object.keys(PARTS),
    get: function (id) { return PARTS[id]; },
    byCategory: function (c) {
      return Object.keys(PARTS).filter(function (k) { return PARTS[k].category === c; });
    },
    /** 取元件在全局坐标下的某个引脚位置（含旋转） */
    pinPos: function (inst, pinId) {
      var def = PARTS[inst.part];
      var pin = def.pins.filter(function (p) { return p.id === pinId; })[0] || def.pins[0];
      var rad = (inst.rot || 0) * Math.PI / 180;
      var cos = Math.cos(rad), sin = Math.sin(rad);
      return {
        x: inst.x + pin.x * cos - pin.y * sin,
        y: inst.y + pin.x * sin + pin.y * cos
      };
    },
    /** 元件在全局坐标系下的外接盒（用于点选） */
    bbox: function (inst) {
      var def = PARTS[inst.part];
      var sz = def.size || { w: 80, h: 56 };
      var swap = (inst.rot === 90 || inst.rot === 270);
      return {
        x: inst.x - (swap ? sz.h : sz.w) / 2,
        y: inst.y - (swap ? sz.w : sz.h) / 2,
        w: swap ? sz.h : sz.w,
        h: swap ? sz.w : sz.h
      };
    }
  };
})(window);
