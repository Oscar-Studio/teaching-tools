import test from 'node:test';
import assert from 'node:assert/strict';
import { parseData, summarize, quantile, histogram, boxSummary } from '../legacy-tools/数据统计/statistics-core.js';
const group = data => ({ data, stats: summarize(data) });

test('mixed separators, negative values and exponent notation; reject partial/nonfinite numbers', () => {
  assert.deepEqual(parseData(' -1，2.5；3\n4、5; 1e2 '), [-1, 2.5, 3, 4, 5, 100]);
  assert.deepEqual(parseData('  '), []);
  for (const input of ['12abc', 'Infinity', 'NaN', '1e309', '0x10']) assert.throws(() => parseData(input));
});
test('population statistics and multiple modes', () => {
  const s = summarize([4, 1, 2, 2, 4]);
  assert.ok(Math.abs(s.mean - 2.6) < 1e-12);
  assert.ok(Math.abs(s.ss - 7.2) < 1e-12);
  assert.ok(Math.abs(s.variance - 1.44) < 1e-12);
  assert.deepEqual(s.modes, [2, 4]);
  assert.deepEqual(s.sorted, [1, 2, 2, 4, 4]);
  assert.deepEqual(summarize([1, 2, 3]).modes, []);
});
test('single and constant datasets stay finite', () => {
  for (const data of [[-3], [7, 7, 7]]) {
    const s = summarize(data);
    assert.equal(s.variance, 0);
    assert.equal(quantile(s.sorted, .97), data[0]);
    const bins = histogram([group(data)]);
    assert.equal(bins.counts[0].reduce((a, b) => a + b), data.length);
  }
});
test('shared histogram boundaries, internal edge goes right; final edge included', () => {
  const bins = histogram([group([0, 5, 10, 15, 20]), group([1, 10, 20])], 10, 0);
  assert.deepEqual(bins.edges, [0, 10, 20]);
  assert.deepEqual(bins.counts, [[2, 3], [1, 2]]);
});
test('decimal boundaries and negative values retain every observation', () => {
  const bins = histogram([group([-.3, -.2, -.1, 0, .1, .2, .3])], .1, -.3);
  assert.equal(bins.counts[0].reduce((a, b) => a + b), 7);
  assert.deepEqual(histogram([group([0, .1, .2, .3])], .1, 0).counts, [[1, 1, 2]]);
});
test('invalid widths, origins and excessive bins are actionable errors', () => {
  const groups = [group([0, 10])];
  for (const width of [0, -1, Infinity, .000001]) assert.throws(() => histogram(groups, width));
  assert.throws(() => histogram(groups, 1, 1));
});
test('box quantiles match the table and whisker modes are explicit', () => {
  const s = summarize([1, 2, 3, 4, 100]);
  const b = boxSummary(s, 'iqr');
  assert.deepEqual([b.q1, b.median, b.q3, b.lower, b.upper], [2, 3, 4, 1, 4]);
  assert.deepEqual(b.outliers, [100]);
  const p = boxSummary(s, 'percentile');
  assert.equal(p.lower, quantile(s.sorted, .03));
  assert.equal(p.upper, quantile(s.sorted, .97));
  assert.equal(boxSummary(s, 'range').upper, 100);
});
