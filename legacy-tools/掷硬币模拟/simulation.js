const $ = (selector) => document.querySelector(selector);
const canvas = $('#chart');
const ctx = canvas.getContext('2d');
const number = new Intl.NumberFormat('zh-CN');
const compact = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 });
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const speeds = [1, 2, 5, 10, 25, 60, 250, 1000, 5000];
const labels = ['两正', '两反', '一正一反'];
const dashes = [[], [7, 4], [2, 4]];
const coins = [$('#coin-a'), $('#coin-b')];
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

function toss(batch) {
  for (let i = 0; i < batch; i++) {
    // The four equiprobable values encode the two independent coin faces.
    lastPair = Math.floor(Math.random() * 4);
    tally[lastPair === 0 ? 0 : lastPair === 3 ? 1 : 2]++;
    record([++rounds, ...tally]);
  }
}

function updateReadout(animate = false) {
  if (rounds) {
    for (let i = 0; i < coins.length; i++) {
      const tail = Boolean(lastPair & (1 << i));
      coins[i].textContent = tail ? '反' : '正';
      coins[i].dataset.tail = tail;
      if (animate && !reducedMotion.matches) {
        coins[i].animate([
          { transform: 'translateY(0) rotateX(0)' },
          { transform: 'translateY(-9px) rotateX(180deg)' },
          { transform: 'translateY(0) rotateX(360deg)' },
        ], { duration: 170, delay: i * 22, easing: 'ease-out' });
      }
    }
    latest.textContent = '最近一轮 · ' + resultLabel();
  } else {
    for (const coin of coins) {
      coin.textContent = '·';
      delete coin.dataset.tail;
    }
    latest.textContent = '等待第一次投掷';
  }

  total.textContent = number.format(rounds);
  for (let s = 0; s < 3; s++) {
    counts[s].textContent = number.format(tally[s]);
    rates[s].textContent = rounds ? (100 * tally[s] / rounds).toFixed(1) + '%' : '—';
  }
  empty.hidden = rounds > 0;
}

function resultLabel() {
  return labels[lastPair === 0 ? 0 : lastPair === 3 ? 1 : 2];
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
  const tickSteps = [1, 2, 5];
  const tickIdeal = Math.max(1, span / tickIntervals);
  const tickOrder = 10 ** Math.floor(Math.log10(tickIdeal));
  const tickUnit = tickSteps.findLast((unit) => unit * tickOrder <= tickIdeal);
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

  if (running) {
    credit += elapsed * speed / 1000;
    const batch = Math.floor(credit);
    credit -= batch;
    if (batch) {
      toss(batch);
      // Fast runs update the readouts at most ten times per second.
      if (now - lastReadout >= 100) {
        updateReadout(speed <= 5);
        lastReadout = now;
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
    draw();
    needsRedraw = false;
  }

  if (running || visibleRound !== rounds || probabilityMix !== probabilityTarget ||
      focusMix !== focusTarget || countRange !== countTarget) {
    requestFrame();
  } else {
    previousFrame = 0;
  }
}

function setRunning(next) {
  running = next;
  credit = 0;
  previousFrame = 0;
  runButton.textContent = running ? '暂停模拟' : '开始模拟';
  stepButton.disabled = running;
  if (!running) updateReadout();
  requestFrame();
}

$('#speed').addEventListener('input', (event) => {
  speed = speeds[Number(event.target.value)];
  const label = number.format(speed) + ' 轮/秒';
  $('#speed-value').textContent = label;
  event.target.setAttribute('aria-valuetext', label);
});
runButton.addEventListener('click', () => setRunning(!running));
stepButton.addEventListener('click', () => {
  toss(1);
  updateReadout(true);
  $('#announcement').textContent = `第 ${rounds} 轮，${resultLabel()}`;
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
  for (const coin of coins) {
    for (const animation of coin.getAnimations()) animation.cancel();
  }
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
reducedMotion.addEventListener('change', requestFrame);
new ResizeObserver(resize).observe(canvas);
updatePalette();
