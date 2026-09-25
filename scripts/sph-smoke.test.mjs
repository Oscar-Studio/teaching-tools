#!/usr/bin/env node
/**
 * SPH 冒烟测试 —— 拉格朗日流体模拟（legacy-tools/拉格朗日流体模拟/index.html）
 *
 * 无头方式加载 HTML 的内联 <script>（配最小 DOM 桩），验证：
 *   A. 密度自作用只计一次（复现：自作用被重复累加）
 *   B. 邻居搜索在高密度下精确（复现：每格 16 个粒子上限导致漏/重邻居）
 *   C. 极端角落高密度不崩溃（复现：网格越界读 → TypeError 冻结画面）
 *   D. 场景生成的粒子数符合预期（复现：溃坝裁剪导致 N 不生效）
 *   E. 静密度不随 h 坍缩（复现：restDensity 定值、ρ∝h⁻³）
 *   F. 全场景长时间步进的数值稳定性（回归护栏）
 *   G. 拖拽冲量每帧只消费一次（回归护栏，旧 API 自动跳过）
 *
 * 用法：node scripts/sph-smoke.test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const htmlPath = join(root, 'legacy-tools', '拉格朗日流体模拟', 'index.html');
const html = readFileSync(htmlPath, 'utf8');
const code = html.split('<script>').pop().split('</script>')[0];

const VW = 1024, VH = 768; // 测试视口（h=8 时 W/(2h)、H/(2h) 为整数，可触发角落越界路径）
const SLIDERS = { sN: '400', sH: '8', sK: '80', sMu: '0.3', sG: '300' };

// ---------- DOM 桩 ----------
const ctxStub = new Proxy({}, {
    get(t, p) { if (!(p in t)) t[p] = () => {}; return t[p]; },
    set(t, p, v) { t[p] = v; return true; },
});
function makeEl(id) {
    id = id || '';
    const el = {
        id, style: {}, dataset: {}, title: '', className: '', innerHTML: '', textContent: '',
        value: SLIDERS[id] !== undefined ? SLIDERS[id] : '0', children: [], firstChild: null,
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener() {}, dispatchEvent() {},
        appendChild(c) { el.children.push(c); if (!el.firstChild) el.firstChild = c; return c; },
        getBoundingClientRect: () => ({ width: VW, height: VH, left: 0, top: 0 }),
        setPointerCapture() {}, releasePointerCapture() {},
        getContext: () => ctxStub,
    };
    return el;
}
const elements = new Map();
const documentStub = {
    readyState: 'complete',
    documentElement: makeEl('root'),
    getElementById(id) {
        if (!elements.has(id)) elements.set(id, makeEl(id));
        return elements.get(id);
    },
    createElement: () => makeEl(''),
    querySelectorAll: () => [],
    addEventListener() {},
};
const windowStub = { addEventListener() {}, devicePixelRatio: 1 };
const rafStub = () => 1;

// ---------- 加载被测脚本 ----------
const shim = `;globalThis.__T = {
    sim, Particle, resetParticles, resizeCanvas, computeDensityPressure, computeForces,
    buildSpatialGrid, gridNeighbors,
    applyDragForce: typeof applyDragForce === 'function' ? applyDragForce : null,
    dragState: typeof dragState !== 'undefined' ? dragState : null,
    stepOnce: typeof stepPhysics === 'function' ? stepPhysics
            : (typeof step === 'function' ? step : null),
    get W() { return W; }, get H() { return H; },
};`;
new Function('window', 'document', 'getComputedStyle', 'requestAnimationFrame', 'performance',
    code + shim
)(windowStub, documentStub, () => ({ getPropertyValue: () => '#333' }), rafStub, performance);
const T = globalThis.__T;

// ---------- 断言工具 ----------
let passed = 0, failed = 0, skipped = 0;
function check(name, ok, detail) {
    if (ok) { passed++; console.log('  \u2713 ' + name); }
    else { failed++; console.log('  \u2717 ' + name + (detail ? '  \u2014 ' + detail : '')); }
}
function skip(name, why) { skipped++; console.log('  - ' + name + '\uff08\u8df3\u8fc7\uff1a' + why + '\uff09'); }
const approx = (a, b, tol) => Math.abs(a - b) <= tol;
const massOf = () => T.sim.params.massEff !== undefined ? T.sim.params.massEff : T.sim.params.mass;

function spawn(scene, h, n) {
    T.sim.params.h = h;
    T.sim.params.n = n;
    T.sim.scene = scene;
    T.resetParticles();
    return T.sim.particles.length;
}
function meanDensity() {
    T.computeDensityPressure();
    let s = 0;
    for (const p of T.sim.particles) s += p.density;
    return s / (T.sim.particles.length || 1);
}

// ---------- A. 密度自作用只计一次 ----------
console.log('\nA. \u5bc6\u5ea6\u81ea\u4f5c\u7528');
{
    T.sim.particles.length = 0;
    T.sim.params.h = 8;
    T.sim.particles.push(new T.Particle(VW / 2, VH / 2));
    T.computeDensityPressure();
    const h = T.sim.params.h;
    const expected = massOf() * 315 / (64 * Math.PI * Math.pow(h, 3)); // m\u00b7W(0)
    const got = T.sim.particles[0].density;
    check('\u5b64\u7acb\u7c92\u5b50 \u03c1 == m\u00b7W(0)\uff08\u81ea\u4f5c\u7528\u6070\u597d\u4e00\u6b21\uff09', approx(got, expected, expected * 0.02),
        '\u03c1=' + got.toExponential(3) + ', \u671f\u671b=' + expected.toExponential(3));
}

// ---------- B. \u9ad8\u5bc6\u5ea6\u90bb\u5c45\u641c\u7d22\u7cbe\u786e ----------
console.log('\nB. \u90bb\u5c45\u641c\u7d22\uff08\u6bcf\u683c >16 \u4e2a\u7c92\u5b50\uff09');
{
    T.sim.params.h = 8;
    T.sim.particles.length = 0;
    // 30 \u4e2a\u7c92\u5b50\u6324\u8fdb\u540c\u4e00\u4e2a cell\uff08cell=2h=16px\uff09\uff0c\u8d85\u8fc7\u65e7\u5b9e\u73b0\u7684\u6bcf\u683c 16 \u4e0a\u9650
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 30; i++) {
        T.sim.particles.push(new T.Particle(304 + rand() * 7, 304 + rand() * 7));
    }
    T.buildSpatialGrid();
    const q = T.sim.particles[0];
    const h2 = T.sim.params.h * T.sim.params.h;
    const want = new Set();
    for (let j = 1; j < T.sim.particles.length; j++) {
        const p = T.sim.particles[j];
        const d2 = (p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y);
        if (d2 < h2) want.add(j);
    }
    const got = new Set();
    let invalid = 0;
    for (const j of T.gridNeighbors(q.x, q.y)) {
        if (!Number.isInteger(j) || j < 0 || j >= T.sim.particles.length) { invalid++; continue; }
        if (j !== 0) got.add(j);
    }
    check('\u90bb\u5c45\u7d22\u5f15\u5168\u90e8\u5408\u6cd5\uff08\u65e0\u8d8a\u754c/\u672a\u5b9a\u4e49\uff09', invalid === 0, '\u975e\u6cd5\u7d22\u5f15 ' + invalid + ' \u4e2a');
    const missing = [...want].filter(j => !got.has(j));
    const extra = [...got].filter(j => !want.has(j));
    check('\u90bb\u5c45\u96c6\u5408\u4e0e\u66b4\u529b\u641c\u7d22\u4e00\u81f4', missing.length === 0 && extra.length === 0,
        '\u6f0f ' + missing.length + ' \u4e2a / \u591a ' + extra.length + ' \u4e2a');
}

// ---------- C. \u89d2\u843d\u9ad8\u5bc6\u5ea6\u4e0d\u5d29\u6e83 ----------
console.log('\nC. \u6781\u7aef\u89d2\u843d\uff08\u65e7\u5b9e\u73b0\u6700\u540e\u4e00\u683c\u8d8a\u754c\u8bfb\uff09');
{
    T.sim.params.h = 8;
    T.sim.particles.length = 0;
    for (let i = 0; i < 25; i++) T.sim.particles.push(new T.Particle(VW, VH));
    let threw = null;
    try { T.computeDensityPressure(); T.computeForces(); } catch (e) { threw = e; }
    check('\u53f3\u4e0b\u89d2 25 \u7c92\u5b50\u540c\u683c\u4e0d\u629b\u5f02\u5e38', !threw, threw && threw.message);
}

// ---------- D. \u573a\u666f\u7c92\u5b50\u6570 ----------
console.log('\nD. \u573a\u666f\u751f\u6210\u7c92\u5b50\u6570');
{
    const freeScenes = ['dambreak', 'drop', 'two', 'block'];
    const cupScenes = ['pouring', 'funnel'];
    for (const scene of freeScenes.concat(cupScenes)) {
        for (const [h, n] of [[8, 100], [8, 400], [8, 800], [16, 400], [32, 800], [32, 100]]) {
            const placed = spawn(scene, h, n);
            check(scene + ' h=' + h + ' N=' + n + ' \u2192 ' + placed + '\uff08\u2264N\uff09', placed > 0 && placed <= n);
            const needExact = freeScenes.indexOf(scene) >= 0 || h === 8;
            if (needExact) {
                check(scene + ' h=' + h + ' N=' + n + ' \u2192 \u7cbe\u786e N', placed === n, '\u5b9e\u9645 ' + placed);
            }
        }
    }
}

// ---------- E. \u9759\u5bc6\u5ea6\u4e0d\u968f h \u574d\u7f29 ----------
console.log('\nE. h \u6807\u5b9a\uff08\u03c1 \u573a\u5e94\u4e0e h \u65e0\u5173\uff09');
{
    for (const h of [8, 12, 16, 24, 32]) {
        spawn('drop', h, 200);
        const rho = meanDensity();
        check('h=' + h + ' \u5e73\u5747\u5bc6\u5ea6 \u2208 [0.2, 0.8]', rho > 0.2 && rho < 0.8, '\u03c1\u0304=' + rho.toFixed(3));
    }
}

// ---------- F. \u6570\u503c\u7a33\u5b9a\u6027 ----------
console.log('\nF. \u957f\u65f6\u95f4\u6b65\u8fdb\u7a33\u5b9a\u6027');
{
    if (!T.stepOnce) skip('\u7a33\u5b9a\u6027', '\u627e\u4e0d\u5230\u5355\u6b65\u51fd\u6570');
    else for (const scene of ['dambreak', 'funnel', 'pouring']) {
        for (const h of [8, 32]) {
            spawn(scene, h, 250);
            for (let s = 0; s < 60; s++) T.stepOnce();
            let ok = true, why = '';
            for (const p of T.sim.particles) {
                const vals = [p.x, p.y, p.vx, p.vy, p.density, p.pressure];
                if (vals.some(v => !Number.isFinite(v))) { ok = false; why = '\u51fa\u73b0 NaN/Infinity'; break; }
                if (p.x < -2 || p.x > T.W + 2 || p.y < -2 || p.y > T.H + 2) { ok = false; why = '\u7c92\u5b50\u8d8a\u754c'; break; }
                if (Math.hypot(p.vx, p.vy) > 1810) { ok = false; why = '\u901f\u5ea6\u8d85\u9650'; break; }
            }
            check(scene + ' h=' + h + ' \u00d7 60 \u6b65\uff1a\u6709\u9650 / \u4e0d\u8d8a\u754c / \u9650\u901f', ok, why);
        }
    }
}

// ---------- G. \u62d6\u62fd\u51b2\u91cf\u53ea\u6d88\u8d39\u4e00\u6b21 ----------
console.log('\nG. \u62d6\u62fd\u589e\u91cf');
{
    if (!T.dragState || T.dragState.accX === undefined || !T.applyDragForce) {
        skip('\u62d6\u62fd\u589e\u91cf\u53ea\u6d88\u8d39\u4e00\u6b21', '\u65e7\u7248\u62d6\u62fd API');
    } else {
        T.sim.particles.length = 0;
        T.sim.params.h = 8;
        const p = new T.Particle(500, 400);
        T.sim.particles.push(p);
        T.dragState.active = true;
        T.dragState.x = 500; T.dragState.y = 400;
        T.dragState.accX = 30; T.dragState.accY = 0;
        T.applyDragForce();
        T.applyDragForce(); // \u7b2c\u4e8c\u6b21\u4e0d\u5e94\u518d\u6709\u51b2\u91cf
        T.dragState.active = false;
        check('\u540c\u4e00\u589e\u91cf\u53ea\u65bd\u52a0\u4e00\u6b21\u51b2\u91cf', p.vx > 0 && p.vx < 30 * 0.7, 'vx=' + p.vx.toFixed(2));
    }
}

console.log('\n\u7ed3\u679c\uff1a' + passed + ' \u901a\u8fc7 / ' + failed + ' \u5931\u8d25 / ' + skipped + ' \u8df3\u8fc7');
process.exit(failed ? 1 : 0);
