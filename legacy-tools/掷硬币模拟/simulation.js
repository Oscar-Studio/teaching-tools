const $ = (selector) => document.querySelector(selector);
const canvas = $('#chart');
const ctx = canvas.getContext('2d');
const number = new Intl.NumberFormat('zh-CN');
const compact = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 });
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const speeds = [1, 2, 5, 10, 25, 60, 250, 1000, 5000];
const labels = ['两正', '两反', '一正一反'];
const dashes = [[], [7, 4], [2, 4]];
const tray = $('.coin-tray');
const motion = $('#motion');
const motionNote = $('#motion-note');
const shadows = [...tray.querySelectorAll('.shadow')];
const coinLabels = [...tray.querySelectorAll('.coin-label')];
const coins = [...tray.querySelectorAll('.coin')];
for (const coin of coins) {
  coin.innerHTML = '<span class="coin-face coin-front"></span><span class="coin-face coin-back"></span>';
}
const counts = document.querySelectorAll('.stat-count');
const rates = document.querySelectorAll('.stat-rate');
const modeButtons = document.querySelectorAll('[data-mode]');
const viewButtons = document.querySelectorAll('[data-view]');
const runButton = $('#run');
const stepButton = $('#step');
const empty = $('#empty');
const latest = $('#latest');
const total = $('#total');
const note = $('#chart-note');

const recentCapacity = 512;
const bucketCapacity = 256;
const recent = new Array(recentCapacity);
const buckets = [];
const tally = [0, 0, 0];
let rounds = 0;
let bucketSize = 1;
let lastPair = 0;
let firstSample;
let speed = speeds[Number($('#speed').value)];
let running = false;
let mode = 'probability';
let view = 'focus';
let focusLength = 120;
let width = 0;
let height = 0;
let palette;
let visibleRound = 0;
let probabilityMix = 1;
let focusMix = 1;
let countRange = 5;
let previousFrame = 0;
let frameId = 0;
let credit = 0;
let lastReadout = -Infinity;
let needsRedraw = true;
let lastDraw = -Infinity;
let pending;
let nextThrow = 0;
let shownPair = 2;
let animations = [];
const physicsLimit = 5;
const canAnimate = typeof coins[0].animate === 'function';

// A sample stores the round followed by the three exact cumulative totals.
// Old buckets retain their endpoints and each series' probability extrema.
function record(sample) {
  const round = sample[0];
  recent[round % recentCapacity] = sample;
  if (round === 1) firstSample = sample;

  if ((round - 1) % bucketSize === 0) {
    if (buckets.length < bucketCapacity) {
      buckets.push({ end: sample, min: [sample, sample, sample], max: [sample, sample, sample] });
      return;
    }
    for (let i = 0; i < bucketCapacity; i += 2) {
      const first = buckets[i];
      const second = buckets[i + 1];
      for (let s = 0; s < 3; s++) {
        updateExtrema(first, s, second.min[s], second.max[s]);
      }
      first.end = second.end;
      buckets[i / 2] = first;
    }
    buckets.length = bucketCapacity / 2;
    bucketSize *= 2;
    buckets.push({ end: sample, min: [sample, sample, sample], max: [sample, sample, sample] });
    return;
  }

  const bucket = buckets[buckets.length - 1];
  bucket.end = sample;
  for (let s = 0; s < 3; s++) updateExtrema(bucket, s, sample, sample);
}

function updateExtrema(bucket, series, low, high) {
  const column = series + 1;
  const min = bucket.min[series];
  const max = bucket.max[series];
  if (low[column] * min[0] < min[column] * low[0]) bucket.min[series] = low;
  if (high[column] * max[0] > max[column] * high[0]) bucket.max[series] = high;
}

const outcome = (pair) => pair === 0 ? 0 : pair === 3 ? 1 : 2;
const randomPair = () => Math.floor(Math.random() * 4);
const tailAt = (pair, index) => Boolean(pair & (1 << index));

function recordPair(pair) {
  lastPair = pair;
  tally[outcome(pair)]++;
  record([++rounds, ...tally]);
}

function showPair(pair, round, paths) {
  shownPair = round ? pair : 2;
  coins.forEach((coin, index) => {
    const tail = tailAt(shownPair, index);
    coin.classList.toggle('is-tail', tail);
    coin.style.setProperty('--yaw', (paths?.[index].yaw ?? 0) + 'deg');
    coinLabels[index].textContent = '硬币 ' + (index + 1) + (round ? (tail ? ' · 反面' : ' · 正面') : '');
  });
  latest.textContent = round ? '第 ' + number.format(round) + ' 轮 · ' + labels[outcome(pair)] : '等待第一次投掷';
}

function clearThrow() {
  for (const animation of animations) animation.cancel();
  animations = [];
  pending = undefined;
  nextThrow = 0;
}

function startThrow(now, duration, { physics = false, single = false, preview = false } = {}) {
  const pair = preview ? lastPair : physics ? 0 : randomPair();
  const paths = coins.map((_, i) => physics ? coinMotion.physicalToss()
    : coinMotion.animatedToss(tailAt(shownPair, i), tailAt(pair, i), preview));
  pending = {
    pair: physics ? Number(paths[0].tail) + 2 * Number(paths[1].tail) : pair,
    paths, single, preview, round: rounds, end: now + duration,
  };
  if (!preview) {
    latest.textContent = '第 ' + number.format(rounds + 1) + ' 轮 · 投掷中';
    coins.forEach((_, i) => { coinLabels[i].textContent = '硬币 ' + (i + 1); });
  }
  if (!duration) return;
  const options = { duration, fill: 'both' };
  paths.forEach(({ path, yaw }, i) => {
    const lift = (y) => Math.max(0, y - coinMotion.halfThickness);
    animations.push(coins[i].animate(path.map(({ angle, y }) => ({
      transform: 'translateY(calc(var(--radius) * ' + (-1.03 * lift(y)) + ')) rotateX(30deg) rotateZ('
        + yaw + 'deg) rotateX(' + angle + 'rad)',
    })), options));
    animations.push(shadows[i].animate(path.map(({ y }) => ({
      transform: 'scale(' + (1 + .16 * lift(y)) + ')',
      opacity: 1 / (1 + .48 * lift(y)),
    })), options));
  });
}

function finishThrow() {
  const { pair, paths, round, preview, single } = pending;
  if (!preview) {
    recordPair(pair);
    updateReadout();
  }
  showPair(pair, preview ? round : rounds, paths);
  for (const animation of animations) animation.cancel();
  animations = [];
  pending = undefined;
  if (single) {
    stepButton.disabled = false;
    $('#announcement').textContent = '第 ' + rounds + ' 轮，' + labels[outcome(pair)];
  }
}

function activePhysics() {
  return speed <= physicsLimit && motion.value === 'physics';
}

// Keep a readable preview at high speeds while recording every round.
const previewInterval = () => Math.max(125, 190 - Math.log2(speed / 10) * 16);

function updateMotion() {
  const forced = speed > physicsLimit;
  motion.disabled = forced;
  if (forced) {
    motion.value = 'animation';
  } else {
    motion.value = preferredMotion;
  }
  const fullModel = activePhysics();
  tray.classList.toggle('physical', fullModel);
  if (fullModel && !coins[0].querySelector('.coin-edge')) {
    for (const coin of coins) {
      for (let i = 0; i < 24; i++) {
        const edge = document.createElement('span');
        edge.className = 'coin-edge';
        edge.style.setProperty('--edge-angle', (15 * i) + 'deg');
        coin.append(edge);
      }
    }
  }
  motionNote.textContent = !canAnimate || reducedMotion.matches
    ? '已减少动态效果，直接显示落定结果。'
    : forced ? '高速档使用轻量动画，画面抽样，统计逐轮记录。'
    : fullModel ? '根据抛起、触桌回弹和落定的朝向计数。'
    : '10 轮/秒起自动使用轻量动画。';
}

function updateReadout() {
  total.textContent = number.format(rounds);
  for (let s = 0; s < 3; s++) {
    counts[s].textContent = number.format(tally[s]);
    rates[s].textContent = rounds ? (100 * tally[s] / rounds).toFixed(1) + '%' : '—';
  }
  empty.hidden = rounds > 0;
}

function updateNote() {
  const range = view === 'focus' ? `聚焦显示最近 ${focusLength} 轮` : '全览显示从第 1 轮到当前的趋势';
  const statistic = mode === 'count' ? '次数为每种结果的累计次数。' : '概率为累计次数除以累计轮数。';
  note.textContent = range + '，' + statistic;
}

function updatePalette() {
  const style = getComputedStyle(document.documentElement);
  const dark = document.documentElement.dataset.theme === 'dark';
  palette = {
    text: style.getPropertyValue('--on-graph-soft').trim(),
    grid: dark ? '#18171522' : '#faf9f51f',
    lines: dark ? ['#247666', '#985a1a', '#7153c3'] : ['#78cdb7', '#f0b471', '#bfafff'],
  };
  needsRedraw = true;
  requestFrame();
}

function resize() {
  const bounds = canvas.getBoundingClientRect();
  width = bounds.width;
  height = bounds.height;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  focusLength = width < 460 ? 60 : 120;
  needsRedraw = true;
  updateNote();
  requestFrame();
}

function blend(current, target, elapsed, duration, tolerance) {
  if (reducedMotion.matches || Math.abs(current - target) <= tolerance) return target;
  return target + (current - target) * Math.exp(-elapsed / duration);
}

function draw() {
  if (width < 100 || height < 100) return;
  const left = width < 460 ? 49 : 60;
  const right = width - 21;
  const top = 31;
  const bottom = height - 49;
  const end = Math.max(10, visibleRound);
  const overviewSpan = end;
  const focusSpan = Math.min(end, focusLength);
  // Interpolate the zoom ratio so even a long history zooms at a steady rate.
  const span = overviewSpan * (focusSpan / overviewSpan) ** focusMix;
  const start = end - span;
  const x = (round) => left + (round - start) / span * (right - left);
  const y = (fraction) => bottom - fraction * (bottom - top);
  const valueY = (sample, series) => {
    const count = sample[series + 1];
    return y((1 - probabilityMix) * count / countRange + probabilityMix * count / sample[0]);
  };

  ctx.clearRect(0, 0, width, height);
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = palette.text;
  ctx.strokeStyle = palette.grid;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.globalAlpha = probabilityMix;
  ctx.fillText('实验概率', left, 15);
  ctx.globalAlpha = 1 - probabilityMix;
  ctx.fillText('累计次数', left, 15);
  ctx.globalAlpha = 1;

  ctx.textAlign = 'right';
  // Each scale has its own labeled grid. It fades as the lines morph.
  function yTick(fraction, label, opacity) {
    if (opacity <= 0) return;
    ctx.globalAlpha = opacity;
    const py = y(fraction);
    ctx.beginPath();
    ctx.moveTo(left, py);
    ctx.lineTo(right, py);
    ctx.stroke();
    ctx.fillText(label, left - 8, py);
  }
  for (let i = 0; i <= 4; i++) yTick(i / 4, i * 25 + '%', probabilityMix);
  if (probabilityMix < 1) {
    const ideal = countRange / 5;
    const order = 10 ** Math.floor(Math.log10(ideal));
    const step = order * (ideal / order >= 5 ? 5 : ideal / order >= 2 ? 2 : 1);
    for (let n = 0; n <= countRange; n += step) {
      yTick(n / countRange, compact.format(n), 1 - probabilityMix);
    }
  }
  ctx.globalAlpha = 1;

  ctx.textAlign = 'center';
  const formatRound = span < 10000 || span < end / 5 ? number.format : compact.format;
  const labelWidth = ctx.measureText(formatRound(Math.floor(end))).width;
  const tickIntervals = Math.min(7, Math.max(1, Math.floor((right - left) / (labelWidth + 18))));
  const tickIdeal = Math.max(1, span / tickIntervals);
  const tickOrder = 10 ** Math.floor(Math.log10(tickIdeal));
  const tickUnit = tickIdeal >= 5 * tickOrder ? 5 : tickIdeal >= 2 * tickOrder ? 2 : 1;
  const tickStep = tickOrder * tickUnit;
  const coarserStep = tickOrder * (tickUnit === 5 ? 10 : tickUnit === 2 ? 5 : 2);
  const tickMix = Math.log(tickIdeal / tickStep) / Math.log(coarserStep / tickStep);
  const xLabels = [];

  function xTicks(step, opacity, skip) {
    for (let round = Math.ceil(start / step) * step; round <= end; round += step) {
      if (skip && round % skip === 0) continue;
      const px = x(round);
      const edge = round === 0 ? 1 : Math.min((px - left) / 22, (right - px) / 22);
      ctx.globalAlpha = opacity * Math.max(0, Math.min(1, edge));
      ctx.beginPath();
      ctx.moveTo(px, top);
      ctx.lineTo(px, bottom);
      ctx.stroke();
      if (ctx.globalAlpha > .05) xLabels.push({ px, round, opacity: ctx.globalAlpha });
    }
  }
  if (coarserStep % tickStep === 0) {
    xTicks(tickStep, 1 - tickMix, coarserStep);
    xTicks(coarserStep, 1);
  } else {
    xTicks(tickStep, 1 - tickMix);
    xTicks(coarserStep, tickMix);
  }
  // During zoom both tick levels can be visible. Give the stronger labels room first.
  const labelPositions = [];
  for (const label of xLabels.sort((a, b) => b.opacity - a.opacity)) {
    if (labelPositions.some((px) => Math.abs(px - label.px) < labelWidth + 6)) continue;
    labelPositions.push(label.px);
    ctx.globalAlpha = label.opacity;
    ctx.fillText(formatRound(label.round), label.px, bottom + 15);
  }
  ctx.globalAlpha = 1;
  ctx.fillText('实验轮数', (left + right) / 2, height - 13);

  if (!rounds) return;
  const oldest = Math.max(1, rounds - recentCapacity + 1);
  const first = Math.max(oldest, Math.floor(start));
  const last = Math.min(rounds, Math.ceil(visibleRound));
  const clipRight = x(visibleRound);
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top - 4, clipRight - left, bottom - top + 8);
  ctx.clip();
  ctx.lineWidth = 2.2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (let s = 0; s < 3; s++) {
    ctx.beginPath();
    if (start < 1 && probabilityMix < 1) {
      ctx.moveTo(x(probabilityMix), y(probabilityMix * firstSample[s + 1]));
    }
    const append = (sample) => ctx.lineTo(x(sample[0]), valueY(sample, s));
    if (start < oldest) {
      for (const bucket of buckets) {
        const low = bucket.min[s];
        const high = bucket.max[s];
        const earlier = low[0] < high[0] ? low : high;
        const later = earlier === low ? high : low;
        if (earlier[0] >= oldest) break;
        append(earlier);
        if (later[0] !== earlier[0] && later[0] < oldest) append(later);
        if (bucket.end[0] !== later[0] && bucket.end[0] < oldest) append(bucket.end);
      }
    }
    for (let round = first; round <= last; round++) append(recent[round % recentCapacity]);
    ctx.strokeStyle = palette.lines[s];
    ctx.setLineDash(dashes[s]);
    ctx.stroke();
  }
  ctx.restore();

  const before = Math.floor(visibleRound);
  const a = recent[before % recentCapacity];
  const b = recent[last % recentCapacity];
  if (before >= oldest && a && b) {
    for (let s = 0; s < 3; s++) {
      const py = valueY(a, s) + (valueY(b, s) - valueY(a, s)) * (visibleRound - before);
      ctx.beginPath();
      ctx.arc(clipRight, py, 3, 0, Math.PI * 2);
      ctx.fillStyle = palette.lines[s];
      ctx.fill();
    }
  }
}

function requestFrame() {
  if (!frameId) frameId = requestAnimationFrame(frame);
}

function frame(now) {
  frameId = 0;
  const elapsed = previousFrame ? Math.min(50, now - previousFrame) : 16;
  previousFrame = now;

  if (pending && now >= pending.end) finishThrow();
  if (running) {
    const animated = canAnimate && !reducedMotion.matches;
    if (speed <= physicsLimit) {
      const period = 1000 / speed;
      if (!pending && now >= nextThrow) {
        nextThrow = now + period - Math.min(elapsed, Math.max(0, now - nextThrow));
        startThrow(now, animated ? period * .9 : 0, { physics: activePhysics() });
        if (!animated) finishThrow();
      }
    } else {
      credit += elapsed * speed / 1000;
      const batch = Math.floor(credit);
      credit -= batch;
      for (let i = 0; i < batch; i++) recordPair(randomPair());
      if (batch && now - lastReadout >= 100) {
        updateReadout();
        if (!animated) showPair(lastPair, rounds);
        lastReadout = now;
      }
      if (batch && animated && !pending && now >= nextThrow) {
        const interval = previewInterval();
        startThrow(now, interval * .78, { preview: true });
        nextThrow = now + interval;
      }
    }
  }

  const probabilityTarget = Number(mode === 'probability');
  const focusTarget = Number(view === 'focus');
  const nextRound = rounds ? blend(Math.max(1, visibleRound), rounds, elapsed, 24, .02) : 0;
  const nextProbability = blend(probabilityMix, probabilityTarget, elapsed, 65, .002);
  const nextFocus = blend(focusMix, focusTarget, elapsed, 78, .001);
  const sample = recent[Math.ceil(nextRound) % recentCapacity];
  const visibleMax = sample ? Math.max(sample[1], sample[2], sample[3]) : 0;
  const countTarget = Math.max(5, visibleMax * 1.12);
  const nextRange = nextProbability === 1 ? countTarget : Math.max(
    visibleMax * 1.035,
    blend(countRange, countTarget, elapsed, 90, countTarget * .001),
  );
  if (needsRedraw || nextRound !== visibleRound || nextProbability !== probabilityMix ||
      nextFocus !== focusMix || nextRange !== countRange) {
    visibleRound = nextRound;
    probabilityMix = nextProbability;
    focusMix = nextFocus;
    countRange = nextRange;
    needsRedraw = true;
    if (!running || speed <= physicsLimit || now - lastDraw >= 30) {
      draw();
      lastDraw = now;
      needsRedraw = false;
    }
  }

  if (running || pending || visibleRound !== rounds || probabilityMix !== probabilityTarget ||
      focusMix !== focusTarget || countRange !== countTarget) {
    requestFrame();
  } else {
    previousFrame = 0;
  }
}

function syncThrowState() {
  clearThrow();
  showPair(lastPair, rounds);
  updateReadout();
  credit = 0;
  previousFrame = 0;
  stepButton.disabled = running;
  requestFrame();
}

function setRunning(next) {
  running = next;
  syncThrowState();
  runButton.textContent = running ? '暂停模拟' : '开始模拟';
}

let preferredMotion = motion.value;
$('#speed').addEventListener('input', (event) => {
  speed = speeds[Number(event.target.value)];
  const label = number.format(speed) + ' 轮/秒';
  $('#speed-value').textContent = label;
  event.target.setAttribute('aria-valuetext', label);
  updateMotion();
  syncThrowState();
});
motion.addEventListener('change', () => {
  preferredMotion = motion.value;
  updateMotion();
  syncThrowState();
});
runButton.addEventListener('click', () => setRunning(!running));
stepButton.addEventListener('click', () => {
  stepButton.disabled = true;
  const duration = speed <= physicsLimit ? Math.max(440, 900 / speed) : previewInterval() * .78;
  const animated = canAnimate && !reducedMotion.matches;
  startThrow(performance.now(), animated ? duration : 0, { physics: activePhysics(), single: true });
  if (!animated) finishThrow();
  requestFrame();
});
$('#reset').addEventListener('click', () => {
  recent.fill(undefined);
  buckets.length = 0;
  tally.fill(0);
  rounds = 0;
  firstSample = undefined;
  visibleRound = 0;
  needsRedraw = true;
  bucketSize = 1;
  countRange = 5;
  lastReadout = -Infinity;
  setRunning(false);
  $('#announcement').textContent = '实验已重置';
});

for (const button of modeButtons) {
  button.addEventListener('click', () => {
    mode = button.dataset.mode;
    for (const item of modeButtons) item.setAttribute('aria-pressed', String(item === button));
    updateNote();
    requestFrame();
  });
}
for (const button of viewButtons) {
  button.addEventListener('click', () => {
    view = button.dataset.view;
    for (const item of viewButtons) item.setAttribute('aria-pressed', String(item === button));
    updateNote();
    requestFrame();
  });
}

document.addEventListener('visibilitychange', () => { previousFrame = 0; });
document.documentElement.addEventListener('themechange', updatePalette);
function onMotionPreference() {
  updateMotion();
  if (pending && reducedMotion.matches) finishThrow();
  requestFrame();
}
if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', onMotionPreference);
else reducedMotion.addListener(onMotionPreference);
updateMotion();
new ResizeObserver(resize).observe(canvas);
updatePalette();
