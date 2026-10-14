/* 电路画板 —— 纯逻辑自测（netlist + layout），在 Node 里跑 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, 'legacy-tools', '电路画板');

/* app.js 一行都没跑到（它绑 DOM），但语法错必须在这里挡住 ——
   少个括号这种问题，浏览器里表现为整页白屏，本地测不出来 */
const SRC = ['parts.js', 'netlist.js', 'layout.js', 'app.js'];
for (const f of SRC) {
  try {
    // vm.Script 只编译不执行：app.js 靠 document 启动，不能真的 run
    new vm.Script(fs.readFileSync(path.join(DIR, f), 'utf8'), { filename: f });
  } catch (e) {
    console.log('  ✗ ' + f + ' 解析失败  → ' + e.message);
    process.exit(1);
  }
}

const sandbox = { window: {}, console };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);

for (const f of ['parts.js', 'netlist.js', 'layout.js']) {
  vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), sandbox, { filename: f });
}
const { CircuitParts: Parts, CircuitNet: Net, CircuitLayout: Layout } = sandbox.window;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

/* ---------- 工具 ---------- */
function mk(spec) {
  const st = { components: [], wires: [], seq: 100 };
  for (const [id, part] of Object.entries(spec)) {
    if (id === 'wires' || id === 'props') continue;
    st.components.push({ id, part, x: 0, y: 0, rot: 0, props: (spec.props || {})[id] || {} });
  }
  let n = 1;
  for (const w of spec.wires || []) {
    st.wires.push({ id: 'w' + n++, a: { c: w[0], p: w[1] }, b: { c: w[2], p: w[3] } });
  }
  return st;
}
const top = (st) => Net.analyze(st);

/* =====================================================
 * 走线 = 布局 + routeWire
 *
 * app.js 里的 buildRoutes() 绑在 DOM 上跑不了，这里复刻它的几何部分：
 * 布局把坐标写回元件，再逐根 state.wires 各算各的正交折线。
 * ===================================================== */
function laidOut(state, an, view) {
  const L = view === 'schematic' ? Layout.layoutSchematic(state, an)
                                 : Layout.layoutPictorial(state, an);
  const st = {
    components: state.components.map(c => {
      const p = (L && L.positions[c.id]) || {};
      return {
        id: c.id, part: c.part,
        x: p.x == null ? c.x : p.x, y: p.y == null ? c.y : p.y,
        rot: p.rot == null ? c.rot : p.rot, props: c.props
      };
    }),
    wires: state.wires
  };
  const byId = {};
  st.components.forEach(c => { byId[c.id] = c; });
  const obs = Layout.obstaclesOf(st);
  const routes = state.wires.map(w => {
    const ca = byId[w.a.c], cb = byId[w.b.c];
    const pa = Parts.pinPos(ca, w.a.p), pb = Parts.pinPos(cb, w.b.p);
    // 两端元件也是障碍；靠 stub 把起点/终点引到机身外面
    const mid = Layout.routeWire(Layout.stub(ca, w.a.p), Layout.stub(cb, w.b.p), obs);
    return { id: w.id, a: w.a, b: w.b, pa, pb, pts: [pa].concat(mid, [pb]) };
  });
  return { state: st, routes, positions: (L && L.positions) || {} };
}

/** 点 p 是否落在轴对齐线段 ab 上 */
function onSeg(p, a, b) {
  if (Math.abs(a.y - b.y) < 0.5) return Math.abs(p.y - a.y) < 0.5 &&
    p.x >= Math.min(a.x, b.x) - 0.5 && p.x <= Math.max(a.x, b.x) + 0.5;
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(p.x - a.x) < 0.5 &&
    p.y >= Math.min(a.y, b.y) - 0.5 && p.y <= Math.max(a.y, b.y) + 0.5;
}
const keyOf = p => Math.round(p.x) + ',' + Math.round(p.y);

/**
 * 从画出来的折线反推连接关系：折线相邻顶点相连，落在折线上的引脚与折线相连。
 * 返回一个 pin 坐标 → 组号 的查询函数，用来核对「几何上画出来的」是否等于「netlist 算出来的」。
 */
function geometryNets(st, routes) {
  const parent = {};
  const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const touch = k => { if (!(k in parent)) parent[k] = k; return k; };

  routes.forEach(r => {
    for (let i = 0; i < r.pts.length; i++) {
      const k = touch(keyOf(r.pts[i]));
      if (i > 0) union(keyOf(r.pts[i - 1]), k);
    }
    st.components.forEach(c => {
      Parts.get(c.part).pins.forEach(pin => {
        const q = Parts.pinPos(c, pin.id);
        for (let i = 0; i < r.pts.length - 1; i++) {
          if (onSeg(q, r.pts[i], r.pts[i + 1])) union(keyOf(q), touch(keyOf(q)));
        }
      });
    });
  });

  const group = {};
  allPins(st).forEach(({ p }) => {
    const r = find(touch(keyOf(p)));
    if (!(r in group)) group[r] = Object.keys(group).length;
  });
  return p => group[find(touch(keyOf(p)))];
}

function allPins(st) {
  const out = [];
  st.components.forEach(c => {
    Parts.get(c.part).pins.forEach(pin => {
      out.push({ k: Net.pinKey(c.id, pin.id), p: Parts.pinPos(c, pin.id) });
    });
  });
  return out;
}

/** 走线的三条不变量：端点对得上 / 不压元件 / 几何连通关系不串网 */
function checkRouting(tag, state, an, view) {
  const { state: st, routes } = laidOut(state, an, view);

  // ① 每根线的首末点必须正好是它自己那两个引脚
  const badEnds = [];
  routes.forEach(r => {
    const first = r.pts[0], last = r.pts[r.pts.length - 1];
    if (Math.abs(first.x - r.pa.x) > 0.5 || Math.abs(first.y - r.pa.y) > 0.5) badEnds.push(r.id + ' 起点');
    if (Math.abs(last.x - r.pb.x) > 0.5 || Math.abs(last.y - r.pb.y) > 0.5) badEnds.push(r.id + ' 终点');
  });
  check(tag + '·走线端点就是引脚', badEnds.length === 0, badEnds.join(' | '));

  // ② 导线不能从任何元件身上压过去
  const obs = Layout.obstaclesOf(st);
  const crushed = [];
  routes.forEach(r => {
    for (let i = 0; i < r.pts.length - 1; i++) {
      obs.forEach(o => {
        if (o.id === r.a.c || o.id === r.b.c) return;      // 两端元件自己的引脚就在盒内
        if (Layout.segHits(r.pts[i], r.pts[i + 1], o)) crushed.push(r.id + ' 压 ' + o.id);
      });
    }
  });
  check(tag + '·导线不压元件', crushed.length === 0, crushed.join(' | '));

  // ②' 导线也不许横穿**自己两端**那个元件的机身。
  //     引脚→stub 这一小段允许（那是引出线），再往里就不行：
  //     否则一根线会从右脚出发、横穿机身再拐弯，看上去就像接在左脚上。
  const selfCrush = [];
  const idx = {};
  st.components.forEach(c => { idx[c.id] = c; });
  routes.forEach(r => {
    const sa = Layout.stub(idx[r.a.c], r.a.p), sb = Layout.stub(idx[r.b.c], r.b.p);
    const onLead = p => (Math.abs(p.x - sa.x) < .01 && Math.abs(p.y - sa.y) < .01) ||
                        (Math.abs(p.x - sb.x) < .01 && Math.abs(p.y - sb.y) < .01);
    for (let i = 0; i < r.pts.length - 1; i++) {
      const p = r.pts[i], q = r.pts[i + 1];
      if (onLead(p) || onLead(q)) continue;          // 引出线本身不算
      [r.a.c, r.b.c].forEach(id => {
        const b = Parts.bbox(idx[id]);               // 含 1.5px 容差
        const grown = { x: b.x - 1.5, y: b.y - 1.5, w: b.w + 3, h: b.h + 3 };
        if (Layout.segHits(p, q, grown)) selfCrush.push(r.id + ' 横穿自身 ' + id);
      });
    }
  });
  check(tag + '·导线不横穿自身机身', selfCrush.length === 0, selfCrush.join(' | '));

  // ③ 几何上连成一片的引脚，必须也落在同一个 net 里
  //    （盯的是「A 那根线正好从 B 的引脚上路过」这种意外串网）
  const geo = geometryNets(st, routes);
  const g2n = {}, mism = [];
  allPins(st).forEach(({ k, p }) => {
    const net = an.netInfo.netOf[k];
    if (!net) return;
    const g = geo(p);
    if (g2n[g] != null && g2n[g] !== net.id) mism.push(k + ' 与 ' + g2n[g] + ' 混进同一组');
    g2n[g] = net.id;
  });
  check(tag + '·几何分组不串网', mism.length === 0, mism.join(' | '));
}

/* =====================================================
 * 用例 1：灯泡 + 电流表串联，电压表并联在灯泡两端
 * ===================================================== */
console.log('\n[用例1] 灯泡串联电流表 + 电压表并联灯泡');
const c1 = mk({
  c1: 'battery', c2: 'switch', c3: 'ammeter', c4: 'bulb', c5: 'voltmeter',
  props: { c2: { closed: true } },
  wires: [
    ['c1', 'a', 'c2', 'a'], ['c2', 'b', 'c3', 'a'], ['c3', 'b', 'c4', 'a'],
    ['c4', 'a', 'c5', 'a'], ['c4', 'b', 'c5', 'b'], ['c5', 'b', 'c1', 'b']
  ]
});
const an1 = top(c1);
check('分析成功', an1.ok, JSON.stringify(an1.issues));
check('4 个节点', an1.netInfo.nets.length === 4, '实际 ' + an1.netInfo.nets.length);
check('识别出 2 个排布步骤', an1.steps.length === 2, '实际 ' + an1.steps.length);
check('步骤0为串联（开关+电流表合并）', an1.steps[0] && an1.steps[0].kind === 'series' && an1.steps[0].items[0].comps.length === 2,
  an1.steps[0] && JSON.stringify(an1.steps[0].items[0].comps));
check('步骤1为并联（灯泡+电压表）', an1.steps[1] && an1.steps[1].kind === 'parallel' && an1.steps[1].items.length === 2);
check('电压表排在并联组最后一行', an1.steps[1] && an1.steps[1].items[1].comps.includes('c5'));
check('无错误告警', an1.issues.filter(i => i.level === 'error').length === 0,
  an1.issues.map(i => i.msg).join(' | '));

const L1 = Layout.layoutSchematic(c1, an1);
check('电路图布局产出', !!L1);
if (L1) {
  console.log('    画布尺寸 ' + Math.round(L1.width) + '×' + Math.round(L1.height));
  const bulbY = L1.positions.c4.y, voltY = L1.positions.c5.y;
  check('灯泡与电压表上下分行（并联对齐）', Math.abs(bulbY - voltY) > 20,
    `bulb.y=${Math.round(bulbY)} volt.y=${Math.round(voltY)}`);
  const batt = L1.positions.c1;
  check('电池竖放（rot=90）', batt.rot === 90);
  check('全部元件都拿到坐标', Object.keys(L1.positions).length === 5,
    '实际 ' + Object.keys(L1.positions).length);
}
checkRouting('[电路图]', c1, an1, 'schematic');

/* =====================================================
 * 用例 2：两个灯泡并联 + 开关
 * ===================================================== */
console.log('\n[用例2] 两灯并联（教材经典画法）');
const c2 = mk({
  c1: 'battery', c2: 'switch', c3: 'bulb', c4: 'bulb',
  wires: [
    ['c1', 'a', 'c2', 'a'], ['c2', 'b', 'c3', 'a'], ['c2', 'b', 'c4', 'a'],
    ['c3', 'a', 'c4', 'a'], ['c3', 'b', 'c4', 'b'], ['c3', 'b', 'c1', 'b']
  ]
});
const an2 = top(c2);
check('分析成功', an2.ok, JSON.stringify(an2.issues));
check('识别出并联组', an2.steps.some(s => s.kind === 'parallel' && s.items.length === 2),
  JSON.stringify(an2.steps.map(s => s.kind + ':' + s.items.length)));
const L2 = Layout.layoutSchematic(c2, an2);
check('两个灯泡分行', L2 && Math.abs(L2.positions.c3.y - L2.positions.c4.y) > 20,
  L2 && `y=${Math.round(L2.positions.c3.y)}/${Math.round(L2.positions.c4.y)}`);
check('两灯 x 对齐（同列）', L2 && Math.abs(L2.positions.c3.x - L2.positions.c4.x) < 2,
  L2 && `x=${Math.round(L2.positions.c3.x)}/${Math.round(L2.positions.c4.x)}`);
checkRouting('[电路图]', c2, an2, 'schematic');

/* =====================================================
 * 用例 3：纯串联
 * ===================================================== */
console.log('\n[用例3] 电池+开关+灯泡 纯串联');
const c3 = mk({
  c1: 'battery', c2: 'switch', c3: 'bulb',
  wires: [['c1', 'a', 'c2', 'a'], ['c2', 'b', 'c3', 'a'], ['c3', 'b', 'c1', 'b']]
});
const an3 = top(c3);
check('分析成功', an3.ok);
// 开关和灯泡之间的节点度为 2 → 串联合并成一段，所以只剩 1 个排布步骤
check('串联合并成 1 段', an3.steps.length === 1, '实际 ' + an3.steps.length);
check('该段为串联且含 2 个元件', an3.steps[0] && an3.steps[0].kind === 'series' && an3.steps[0].items[0].comps.length === 2,
  JSON.stringify(an3.steps[0] && an3.steps[0].items[0].comps));
check('判定为单回路串联', JSON.stringify(an3.steps.map(s => s.kind)) === '["series"]');
check('三个元件同一行', (() => {
  const L = Layout.layoutSchematic(c3, an3);
  return L && Math.abs(L.positions.c2.y - L.positions.c3.y) < 1;
})());
checkRouting('[电路图]', c3, an3, 'schematic');

/* =====================================================
 * 用例 4：教学校验
 * ===================================================== */
console.log('\n[用例4] 错误接法能被检出');
const bad1 = mk({   // 电压表串联
  c1: 'battery', c2: 'voltmeter', c3: 'bulb',
  wires: [['c1', 'a', 'c2', 'a'], ['c2', 'b', 'c3', 'a'], ['c3', 'b', 'c1', 'b']]
});
check('电压表串联 → 报错', top(bad1).issues.some(i => i.msg.includes('电压表必须并联')));

const bad2 = mk({   // 电流表并联
  c1: 'battery', c2: 'ammeter', c3: 'ammeter', c4: 'bulb',
  wires: [
    ['c1', 'a', 'c2', 'a'], ['c1', 'a', 'c3', 'a'], ['c2', 'b', 'c3', 'b'],
    ['c3', 'b', 'c4', 'a'], ['c4', 'b', 'c1', 'b']
  ]
});
check('电流表并联 → 报错', top(bad2).issues.some(i => i.msg.includes('电流表必须串联')));

const bad3 = mk({   // 悬空
  c1: 'battery', c2: 'bulb', c3: 'resistor',
  wires: [['c1', 'a', 'c2', 'a'], ['c2', 'b', 'c1', 'b']]
});
check('悬空接线柱 → 警告', top(bad3).issues.some(i => i.msg.includes('悬空')));

const bad4 = mk({   // 元件自身短路
  c1: 'battery', c2: 'bulb', c3: 'resistor',
  wires: [['c1', 'a', 'c2', 'a'], ['c2', 'a', 'c2', 'b'], ['c2', 'b', 'c1', 'b']]
});
check('元件两脚同节点 → 短路报错', top(bad4).issues.some(i => i.msg.includes('短路')));

const bad5 = mk({   // 电压表直接并在电池两端
  c1: 'battery', c2: 'voltmeter',
  wires: [['c1', 'a', 'c2', 'a'], ['c2', 'b', 'c1', 'b']]
});
check('电压表并在电源两端 → 报错', top(bad5).issues.some(i => i.msg.includes('短路')));

/* =====================================================
 * 用例 5：实物图布局
 * ===================================================== */
console.log('\n[用例5] 实物图布局');
const Lp = Layout.layoutPictorial(c1, top(c1));
check('实物图布局产出', !!Lp);
check('实物图元件不重叠坐标唯一', Lp && new Set(Object.values(Lp.positions).map(p => p.x + ',' + p.y)).size === 5);
const anP = top(c1);
// 返回的是 CSS 变量名（负极线要跟着主题换色），不是写死色值
check('导线按极性着色（红/黑都有）',
  ['var(--wire-pos)', 'var(--wire-neg)'].every(col =>
    c1.wires.some(w => Layout.wireColor(anP.netInfo.netOf[Net.pinKey(w.a.c, w.a.p)], anP.S, anP.T) === col)),
  '实际颜色 ' + JSON.stringify(c1.wires.map(w => Layout.wireColor(anP.netInfo.netOf[Net.pinKey(w.a.c, w.a.p)], anP.S, anP.T))));
checkRouting('[实物图]', c1, anP, 'pictorial');

/* ---- 接线柱配色：跟着所在节点的电位走，和导线同一套规则 ---- */
const comp = (id) => c1.components.find(c => c.id === id);
const pc = (id) => Layout.postColors(anP, comp(id));
check('电池两极固定红/黑（断路时也看得出正负）',
  pc('c1').a === 'var(--wire-pos)' && pc('c1').b === 'var(--wire-neg)', JSON.stringify(pc('c1')));
check('电表 +/− 端固定红/黑，不跟节点走',
  pc('c3').a === 'var(--wire-pos)' && pc('c3').b === 'var(--wire-neg)' &&
  pc('c5').a === 'var(--wire-pos)' && pc('c5').b === 'var(--wire-neg)', JSON.stringify(pc('c3')));
check('串联元件的柱色跟节点走（a 柱接正极→红，b 柱接中间→灰）',
  pc('c2').a === 'var(--wire-pos)' && pc('c2').b === 'var(--wire-mid)', JSON.stringify(pc('c2')));
check('灯泡：a 柱在中间电位→灰，b 柱经电压表回到负极→黑',
  pc('c4').a === 'var(--wire-mid)' && pc('c4').b === 'var(--wire-neg)', JSON.stringify(pc('c4')));
// 核心不变量：非固定色元件上，导线两端插着的那个柱，颜色必须就是这根线的颜色。
// 这条守不住的话，「红线的另一头插在红柱上」就无从谈起。
const mismatch = [];
for (const w of c1.wires) {
  const col = Layout.wireColor(anP.netInfo.netOf[Net.pinKey(w.a.c, w.a.p)], anP.S, anP.T);
  for (const end of [w.a, w.b]) {
    if (Parts.get(comp(end.c).part).fixedPosts) continue;
    const got = Layout.postColors(anP, comp(end.c))[end.p];
    if (got !== col) mismatch.push(`${end.c}.${end.p} 柱=${got} 线=${col}`);
  }
}
check('导线两端接线柱的颜色 == 该导线颜色', mismatch.length === 0, mismatch.join(' | '));

/* =====================================================
 * 用例 6：符号几何健全性
 * ===================================================== */
console.log('\n[用例6] 元件库健全性');
check('元件数量 ≥ 10', Parts.ids.length >= 10, '实际 ' + Parts.ids.length);
let badDraw = [];
for (const id of Parts.ids) {
  const d = Parts.get(id);
  if (typeof d.schematic !== 'function' || typeof d.pictorial !== 'function') badDraw.push(id + ':缺画法');
  if (!d.pins || d.pins.length < 2) badDraw.push(id + ':引脚不足');
  if (!d.size || !d.size.w) badDraw.push(id + ':缺 size');
  for (const p of d.pins) {
    const r = Math.hypot(p.x, p.y);
    if (r < 16) badDraw.push(id + ':引脚过近中心');
  }
  for (const view of ['schematic', 'pictorial']) {
    let s;
    try { s = d[view](d.id === 'switch' ? { closed: true } : {}); }
    catch (e) { badDraw.push(id + '.' + view + ':抛异常 ' + e.message); continue; }
    if (!s || s.indexOf('NaN') >= 0 || s.indexOf('undefined') >= 0) badDraw.push(id + '.' + view + ':产出异常值');
  }
}
check('所有元件画法可执行且无 NaN', badDraw.length === 0, badDraw.join(' | '));
check('旋转后引脚位置正确', (() => {
  const a = Parts.pinPos({ part: 'bulb', x: 0, y: 0, rot: 0 }, 'a');
  const b = Parts.pinPos({ part: 'bulb', x: 0, y: 0, rot: 90 }, 'a');
  return Math.abs(a.x + 32) < 0.01 && Math.abs(b.y + 32) < 0.01;
})());

/* =====================================================
 * 用例 7：走线器本身
 * ===================================================== */
console.log('\n[用例7] 走线绕障与圆角');
const box = { id: 'x', x: 80, y: -30, w: 80, h: 60 };

// 正前方正好被一个元件堵死 → 必须绕开，而不是直穿过去
const detour = Layout.routeWire({ x: 0, y: 0 }, { x: 200, y: 0 }, [box]);
check('挡路的元件被绕开', !Layout.segHits(detour[0], detour[1], box) &&
  detour.slice(1).every((p, i) => !Layout.segHits(detour[i], p, box)),
  JSON.stringify(detour));
check('绕行后仍首尾接上两端', Math.abs(detour[0].x - 0) < .5 && Math.abs(detour[detour.length - 1].x - 200) < .5);
check('折线是正交的', detour.every((p, i) => i === 0 ||
  Math.abs(p.x - detour[i - 1].x) < .5 || Math.abs(p.y - detour[i - 1].y) < .5),
  JSON.stringify(detour));

// 没有障碍时走直线（不没事绕路）
const clear = Layout.routeWire({ x: 0, y: 0 }, { x: 200, y: 0 }, []);
check('无障碍时就是一条直线', clear.length === 2, JSON.stringify(clear));

// 圆角 path：不能出现 NaN，且直角处要落成 Q 曲线而不是直角
const dPath = Layout.orthoPath(detour, 10);
check('orthoPath 无 NaN', dPath.indexOf('NaN') < 0 && dPath.indexOf('undefined') < 0, dPath);
check('orthoPath 拐角用 Q 倒圆角', detour.length > 2 ? dPath.indexOf('Q') >= 0 : true, dPath);
check('orthoPath 首尾与折线一致',
  dPath.slice(0, 4) === 'M0 0' && dPath.slice(-6) === 'L200 0', dPath);

// 绕障不能制造断口：绕行后两端仍然真的连在一起
check('绕行折线首尾相接成一条通路', (() => {
  let ok = true;
  for (let i = 0; i < detour.length - 1; i++) {
    const a = detour[i], b = detour[i + 1];
    if (Math.abs(a.x - b.x) > .5 && Math.abs(a.y - b.y) > .5) ok = false;
  }
  return ok;
})());

/* =====================================================
 * 用例 8：手动摆位下的走线
 *
 * 拖过元件之后 autoLayout 就关了，坐标由用户决定、走线全靠 routeWire 兜底。
 * 这里摆一个故意别扭的布局（元件挤在一起、导线被迫横穿整块区域），
 * 确认导线仍然从元件身上绕开。
 * ===================================================== */
console.log('\n[用例8] 手动摆位时导线仍绕开元件');
{
  // 手动摆：把灯泡放到 ammeter 和 voltmeter 正中间，逼导线从它身上绕
  const manual = {
    seq: 6,
    components: [
      { id: 'c1', part: 'battery', x: 120, y: 120, rot: 0, props: {} },
      { id: 'c2', part: 'switch', x: 320, y: 120, rot: 0, props: {} },
      { id: 'c3', part: 'ammeter', x: 560, y: 120, rot: 0, props: {} },
      { id: 'c4', part: 'bulb', x: 440, y: 120, rot: 0, props: {} },   // 正好卡在中间
      { id: 'c5', part: 'voltmeter', x: 700, y: 300, rot: 0, props: {} }
    ],
    wires: []
  };
  ['c1:a-c2:a', 'c2:b-c3:a', 'c3:b-c4:a', 'c4:a-c5:a', 'c4:b-c5:b', 'c5:b-c1:b']
    .forEach(s => {
      const [a, b] = s.split('-');
      const [ac, ap] = a.split(':'), [bc, bp] = b.split(':');
      manual.wires.push({ id: 'w' + manual.wires.length, a: { c: ac, p: ap }, b: { c: bc, p: bp } });
    });

  const an = top(manual);
  const obs = Layout.obstaclesOf(manual);
  const byId = {};
  manual.components.forEach(c => { byId[c.id] = c; });
  const crushed = [];
  manual.wires.forEach(w => {
    const ca = byId[w.a.c], cb = byId[w.b.c];
    const pts = Layout.routeWire(
      Parts.pinPos(ca, w.a.p), Parts.pinPos(cb, w.b.p),
      obs.filter(o => o.id !== ca.id && o.id !== cb.id));
    for (let i = 0; i < pts.length - 1; i++) {
      obs.forEach(o => {
        if (o.id === ca.id || o.id === cb.id) return;
        if (Layout.segHits(pts[i], pts[i + 1], o)) crushed.push(w.id + ' 压 ' + o.id);
      });
    }
  });
  check('手动摆位：导线不压元件', crushed.length === 0, crushed.join(' | '));
}

console.log(`\n──────── 通过 ${pass} · 失败 ${fail} ────────`);
process.exit(fail ? 1 : 0);
