// Pure numerical routines shared by the tool and its regression tests.
export function parseData(text) {
  const tokens = text.trim().split(/[\s,，;；、]+/u).filter(Boolean);
  if (!tokens.length) return [];
  return tokens.map(token => {
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(token) || !Number.isFinite(Number(token))) {
      throw new Error(`无效数字「${token}」，请使用空格、逗号或换行分隔。`);
    }
    return Number(token);
  });
}

export function quantile(sorted, p) {
  const pos = (sorted.length - 1) * p;
  const lower = Math.floor(pos);
  const fraction = pos - lower;
  return sorted[lower] * (1 - fraction) + sorted[Math.ceil(pos)] * fraction;
}

export function summarize(data) {
  const sorted = [...data].sort((a, b) => a - b);
  const n = data.length;
  const mean = data.reduce((acc, value) => acc + value / n, 0);
  const ss = data.reduce((acc, value) => acc + (value - mean) ** 2, 0);
  if (!Number.isFinite(ss) || !Number.isFinite(mean)) throw new Error('数据数值过大，无法可靠计算统计量，请缩小数值范围。');
  const frequencies = new Map();
  sorted.forEach(value => frequencies.set(value, (frequencies.get(value) || 0) + 1));
  const maxFrequency = [...frequencies.values()].reduce((max, value) => Math.max(max, value), 0);
  const modes = maxFrequency === 1 ? [] : [...frequencies.keys()].filter(value => frequencies.get(value) === maxFrequency);
  return { sorted, n, mean, ss, variance: ss / n, std: Math.sqrt(ss / n), modes, frequencies };
}

export function histogram(groups, requestedWidth, requestedStart) {
  const min = Math.min(...groups.map(g => g.stats.sorted[0]));
  const max = Math.max(...groups.map(g => g.stats.sorted.at(-1)));
  const total = groups.reduce((sum, g) => sum + g.data.length, 0);
  const width = requestedWidth ?? (max === min ? 1 : (max - min) / Math.min(30, Math.ceil(Math.log2(total) + 1)));
  const start = requestedStart ?? min;
  if (!Number.isFinite(width) || width <= 0) throw new Error('直方图组距必须是大于 0 的有限数值。');
  if (!Number.isFinite(start) || start > min) throw new Error('直方图起点必须是有限数值，且不大于所有数据的最小值。');
  const span = (max - start) / width;
  // Snap ratios close to an integer to avoid extra bins from floating-point error.
  const ratio = Math.abs(span - Math.round(span)) < 1e-10 ? Math.round(span) : span;
  const count = Math.max(1, Math.ceil(ratio));
  if (!Number.isFinite(count) || count > 1000) throw new Error('直方图超过 1000 个区间，请增大组距或调整起点。');
  const edges = Array.from({ length: count + 1 }, (_, i) => start + i * width);
  if (edges.some((edge, i) => !Number.isFinite(edge) || (i && edge <= edges[i - 1]))) throw new Error('组距相对数值过小，无法区分区间边界，请增大组距。');
  const counts = groups.map(g => {
    const bins = Array(count).fill(0);
    for (const value of g.data) {
      const offset = (value - start) / width;
      const snapped = Math.abs(offset - Math.round(offset)) < 1e-10 ? Math.round(offset) : offset;
      bins[Math.min(count - 1, Math.max(0, Math.floor(snapped)))]++;
    }
    return bins;
  });
  return { width, edges, counts };
}

export function boxSummary(stats, rule) {
  const q1 = quantile(stats.sorted, .25), median = quantile(stats.sorted, .5), q3 = quantile(stats.sorted, .75);
  let lower, upper;
  if (rule === 'percentile') {
    lower = quantile(stats.sorted, .03); upper = quantile(stats.sorted, .97);
  } else if (rule === 'range') {
    lower = stats.sorted[0]; upper = stats.sorted.at(-1);
  } else {
    const iqr = q3 - q1;
    lower = stats.sorted.find(value => value >= q1 - 1.5 * iqr);
    upper = stats.sorted.findLast(value => value <= q3 + 1.5 * iqr);
  }
  return { q1, median, q3, lower, upper, outliers: stats.sorted.filter(value => value < lower || value > upper) };
}
