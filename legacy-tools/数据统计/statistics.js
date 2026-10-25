import { parseData, summarize, quantile, histogram, boxSummary } from './statistics-core.js';

const $ = id => document.getElementById(id);
const colors = ['#cc785c', '#469e8d', '#738fd2', '#c19738', '#ad78bb', '#d26684'];
const percentiles = [0, .03, .05, .1, .25, .5, .75, .9, .95, .97, 1];
const format = value => value !== 0 && Math.abs(value) < .000001 ? value.toExponential(4) : Number(value.toFixed(6)).toString();
const escapeLabel = text => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let groupCount = 0;
let currentGroups = null;

function invalidate() {
  currentGroups = null;
  $('resultsSection').hidden = true;
  $('errorMessage').textContent = '';
  $('status').textContent = '数据已修改，点击「开始统计」更新结果。';
}

function addGroup(name = '', data = '') {
  const id = ++groupCount;
  const wrapper = document.createElement('div');
  wrapper.className = 'group';
  wrapper.innerHTML = `<div class="group-heading"><label for="name-${id}">组名<input id="name-${id}" class="group-name" maxlength="60"></label><button type="button" class="remove">移除</button></div><label class="sr-only" for="data-${id}">数据组 ${id} 的数值</label><textarea id="data-${id}" placeholder="例如：10, 15, 20, 20, 25"></textarea>`;
  wrapper.querySelector('input').value = name || `数据组 ${id}`;
  wrapper.querySelector('textarea').value = data;
  wrapper.querySelector('.remove').addEventListener('click', () => {
    wrapper.remove();
    if (!$('inputsContainer').children.length) addGroup();
    invalidate();
  });
  wrapper.querySelector('.remove').setAttribute('aria-label', `移除数据组 ${id}`);
  wrapper.addEventListener('input', invalidate);
  $('inputsContainer').append(wrapper);
}

function appendRow(tableId, cells) {
  const row = document.createElement('tr');
  cells.forEach((value, i) => {
    const cell = document.createElement(i === 0 ? 'th' : 'td');
    if (i === 0) cell.scope = 'row';
    cell.textContent = value;
    row.append(cell);
  });
  $(tableId).querySelector('tbody').append(row);
}

function renderTables(groups) {
  $('statsTable').querySelector('tbody').replaceChildren();
  $('quantileTable').querySelector('tbody').replaceChildren();
  $('sortedDataContainer').replaceChildren();
  groups.forEach(g => {
    const s = g.stats;
    appendRow('statsTable', [g.name, s.n, format(s.mean), format(quantile(s.sorted, .5)), s.modes.length ? s.modes.map(format).join('、') : '无众数', format(s.sorted.at(-1) - s.sorted[0]), format(s.ss), format(s.variance), format(s.std)]);
    appendRow('quantileTable', [g.name, ...percentiles.map(p => format(quantile(s.sorted, p)))]);
    const row = document.createElement('p');
    row.className = 'sorted-row';
    row.textContent = `${g.name}：${s.sorted.map(format).join(', ')}`;
    $('sortedDataContainer').append(row);
  });
}

function optionalNumber(id, label) {
  const input = $(id);
  if (input.validity.badInput) throw new Error(`${label}请输入有效数字。`);
  if (!input.value.trim()) return undefined;
  const value = Number(input.value);
  if (!Number.isFinite(value)) throw new Error(`${label}请输入有限数值。`);
  return value;
}

function clearCharts() {
  $('chartsContainer').querySelectorAll('.chart').forEach(el => window.Plotly?.purge(el));
  $('chartsContainer').replaceChildren();
}

async function renderCharts(groups) {
  const selected = [...$('chartChoices').querySelectorAll('input:checked')].map(el => el.value);
  $('histogramSettings').disabled = !selected.includes('histogram');
  $('seriesSettings').disabled = !selected.some(type => ['bar', 'line'].includes(type));
  $('boxSettings').disabled = !selected.includes('box');
  const needsFrequency = selected.includes('histogram') || ($('seriesMode').value === 'frequency' && selected.some(type => ['bar', 'line'].includes(type)));
  $('frequencyTick').disabled = !needsFrequency;
  const tick = needsFrequency ? optionalNumber('frequencyTick', '频数纵轴分度值') : undefined;
  if (tick !== undefined && tick <= 0) throw new Error('频数纵轴分度值必须大于 0。');
  const bins = selected.includes('histogram') ? histogram(groups, optionalNumber('binWidth', '组距'), optionalNumber('binStart', '分组起点')) : null;
  clearCharts();
  if (!selected.length) return;
  if (!window.Plotly) throw new Error('图表组件加载失败，请刷新页面重试。统计表格仍可查看。');
  const frequencyMode = $('seriesMode').value === 'frequency';
  const values = [...new Set(groups.flatMap(g => g.data))].sort((a, b) => a - b);
  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue('--ink').trim();
  const grid = css.getPropertyValue('--hairline').trim();
  const multi = groups.length > 1 ? '复式' : '';
  const jobs = [];
  for (const type of selected) {
    const card = document.createElement('section');
    card.className = 'card chart-card';
    const title = document.createElement('h2');
    const note = document.createElement('p');
    note.className = 'hint';
    const chart = document.createElement('div');
    chart.className = 'chart';
    chart.id = `chart-${type}`;
    let xTitle, yTitle, traces, frequencyAxis = false;
    const traceBase = (g, i) => ({ name: escapeLabel(g.name), marker: { color: colors[i % colors.length] }, line: { color: colors[i % colors.length] } });
    if (type === 'histogram') {
      title.textContent = `${multi}频数直方图`;
      xTitle = '数据区间'; yTitle = '频数'; frequencyAxis = true;
      const labels = bins.edges.slice(0, -1).map((edge, i) => `[${format(edge)}, ${format(bins.edges[i + 1])}${i === bins.edges.length - 2 ? ']' : ')'}`);
      traces = groups.map((g, i) => ({ ...traceBase(g, i), type: 'bar', x: labels, y: bins.counts[i], hovertemplate: '%{x}<br>频数：%{y}<extra>%{fullData.name}</extra>' }));
      note.textContent = `组距 ${format(bins.width)}，起点 ${format(bins.edges[0])}。各组共用区间；左闭右开，最后一个区间包含右端点。`;
    } else if (type === 'bar' || type === 'line') {
      title.textContent = `${multi}${type === 'bar' ? '条形' : '折线'}统计图`;
      xTitle = frequencyMode ? '数值' : '数据序号'; yTitle = frequencyMode ? '频数' : '数据值'; frequencyAxis = frequencyMode;
      traces = groups.map((g, i) => ({ ...traceBase(g, i), type: type === 'bar' ? 'bar' : 'scatter', mode: 'lines+markers', x: frequencyMode ? values.map(String) : g.data.map((_, j) => j + 1), y: frequencyMode ? values.map(value => g.stats.frequencies.get(value) || 0) : g.data }));
      note.textContent = frequencyMode ? '相同数值合并计数；某组未出现的数值频数为 0。' : '按输入顺序展示；各组长度可以不同，不会补 0 或重新排序。';
    } else if (type === 'box') {
      title.textContent = `${multi}箱线图`; xTitle = '数据组'; yTitle = '数值';
      const rule = $('whiskerRule').value;
      traces = groups.flatMap((g, i) => {
        const box = boxSummary(g.stats, rule);
        return [{ ...traceBase(g, i), type: 'box', x: [escapeLabel(g.name)], q1: [box.q1], median: [box.median], q3: [box.q3], lowerfence: [box.lower], upperfence: [box.upper], boxpoints: false, showlegend: false },
          { ...traceBase(g, i), type: 'scatter', mode: 'markers', x: box.outliers.map(() => escapeLabel(g.name)), y: box.outliers, showlegend: false, hovertemplate: '须线外数值：%{y}<extra>%{fullData.name}</extra>' }];
      });
      note.textContent = `箱体为 25%–75% 分位数，中线为中位数。须线：${$('whiskerRule').selectedOptions[0].textContent}；须线外的数值以散点显示。`;
    } else {
      title.textContent = `${multi}累计频率图`; xTitle = '数值'; yTitle = '累计频率';
      traces = groups.map((g, i) => {
        let total = 0;
        return { ...traceBase(g, i), type: 'scatter', mode: 'lines+markers', line: { color: colors[i % colors.length], shape: 'hv' }, x: values, y: values.map(value => (total += g.stats.frequencies.get(value) || 0) / g.stats.n), hovertemplate: '%{x}<br>累计频率：%{y:.2%}<extra>%{fullData.name}</extra>' };
      });
      note.textContent = '展示不大于当前数值的数据所占比例。';
    }
    card.append(title, note, chart);
    $('chartsContainer').append(card);
    const axis = { gridcolor: grid, zerolinecolor: grid, automargin: true };
    const layout = {
      paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', font: { color: ink },
      margin: { t: 12, b: 65, l: 60, r: 20 },
      xaxis: { ...axis, title: xTitle, ...(type === 'histogram' || (frequencyMode && ['bar', 'line'].includes(type)) || type === 'box' ? { type: 'category' } : {}) },
      yaxis: { ...axis, title: yTitle, ...(frequencyAxis ? { rangemode: 'tozero', ...(tick ? { dtick: tick } : { dtick: Math.max(1, Math.ceil(traces.reduce((max, trace) => trace.y.reduce((m, value) => Math.max(m, value), max), 0) / 6)) }) } : {}), ...(type === 'cumulative' ? { tickformat: '.0%', range: [0, 1.05] } : {}) },
      barmode: 'group', bargap: type === 'histogram' ? 0 : .2, bargroupgap: type === 'histogram' ? .02 : .05,
      legend: { orientation: 'h', y: 1.15 }, showlegend: groups.length > 1,
    };
    jobs.push(window.Plotly.newPlot(chart, traces, layout, { responsive: true, displaylogo: false, toImageButtonOptions: { filename: title.textContent, format: 'png', scale: 2 } }));
  }
  await Promise.all(jobs);
}

async function calculate() {
  $('errorMessage').textContent = '';
  const groups = [];
  try {
    const names = new Set();
    for (const [index, wrapper] of [...$('inputsContainer').children].entries()) {
      const name = wrapper.querySelector('input').value.trim() || `数据组 ${index + 1}`;
      let data;
      try { data = parseData(wrapper.querySelector('textarea').value); }
      catch (error) { throw new Error(`${name}：${error.message}`); }
      if (!data.length) continue;
      if (names.has(name)) throw new Error(`组名「${name}」重复，请为各组设置不同的名称。`);
      names.add(name);
      groups.push({ name, data, stats: summarize(data) });
    }
    if (!groups.length) throw new Error('请至少输入一组有效数字。');
    currentGroups = groups;
    renderTables(groups);
    $('resultsSection').hidden = false;
    $('status').textContent = `已统计 ${groups.length} 组、${groups.reduce((n, g) => n + g.data.length, 0)} 个数据。${groups.length > 1 ? '已自动切换为复式图表。' : ''}`;
  } catch (error) {
    invalidate();
    $('status').textContent = '请修正数据后重新统计。';
    $('errorMessage').textContent = error.message;
    return;
  }
  await updateCharts();
}

async function updateCharts() {
  if (!currentGroups) return;
  $('errorMessage').textContent = '';
  try { await renderCharts(currentGroups); }
  catch (error) { clearCharts(); $('errorMessage').textContent = error.message; }
}

$('addGroup').addEventListener('click', () => { addGroup(); invalidate(); });
$('loadExample').addEventListener('click', () => {
  $('inputsContainer').replaceChildren(); groupCount = 0;
  addGroup('甲班', '60, 65, 70, 70, 75, 80, 85, 90, 95');
  addGroup('乙班', '55, 65, 65, 75, 80, 80, 85, 90, 100');
  invalidate();
  calculate();
});
$('calculate').addEventListener('click', calculate);
$('chartChoices').addEventListener('change', updateCharts);
for (const id of ['binWidth', 'binStart', 'frequencyTick', 'seriesMode', 'whiskerRule']) $(id).addEventListener('change', updateCharts);
document.documentElement.addEventListener('themechange', updateCharts);
addGroup();
