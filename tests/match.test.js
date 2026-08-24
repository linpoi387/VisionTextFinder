import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalise,
  compactIndex,
  levenshteinDistance,
  fuzzyErrorsFor,
  findInLine,
  matchItems,
  polyToBbox,
  slicePolyBox,
  matchBbox,
  overlap,
  uniqueMatches
} from '../match.js';

const LINE = '訂單編號 2026';
const LINE_POLY = [[0, 0], [180, 0], [180, 40], [0, 40]];

function fakeItem(text, score, poly = LINE_POLY) {
  return { poly, text, score };
}

// ---- normalise ----
test('normalise exact 只做 trim', () => {
  assert.equal(normalise('  王小明  ', 'exact'), '王小明');
  assert.equal(normalise('ABC DEF', 'exact'), 'ABC DEF');
});

test('normalise loose 移除空白並轉小寫、保留標點', () => {
  assert.equal(normalise('王 小明', 'loose'), '王小明');
  assert.equal(normalise('A B, C。', 'loose'), 'ab,c。');
  assert.equal(normalise('Ａ\u3000Ｂ', 'loose'), 'ａｂ'); // 全形空白
});

test('normalise fuzzy 同 loose', () => {
  assert.equal(normalise('王 小明', 'fuzzy'), '王小明');
});

// ---- compactIndex ----
test('compactIndex 回傳壓縮字串與原始偏移', () => {
  const r = compactIndex('王 小明');
  assert.equal(r.text, '王小明');
  assert.deepEqual(r.map, [0, 2, 3]);
});

test('compactIndex 全形空白也算空白', () => {
  const r = compactIndex('a\u3000b');
  assert.equal(r.text, 'ab');
  assert.deepEqual(r.map, [0, 2]);
});

// ---- levenshteinDistance ----
test('levenshteinDistance 已知值', () => {
  assert.equal(levenshteinDistance([...'kitten'], [...'sitting']), 3);
  assert.equal(levenshteinDistance([...'abc'], [...'abc']), 0);
  assert.equal(levenshteinDistance([...''], [...'abc']), 3);
  assert.equal(levenshteinDistance([...'abc'], [...'']), 3);
});

// ---- fuzzyErrorsFor ----
test('fuzzyErrorsFor 上限 2、下限 1', () => {
  assert.equal(fuzzyErrorsFor(1), 1);
  assert.equal(fuzzyErrorsFor(3), 1);
  assert.equal(fuzzyErrorsFor(4), 1);
  assert.equal(fuzzyErrorsFor(5), 1);
  assert.equal(fuzzyErrorsFor(6), 1);
  assert.equal(fuzzyErrorsFor(8), 2);
  assert.equal(fuzzyErrorsFor(20), 2);
});

// ---- findInLine ----
test('findInLine exact 命中子字串', () => {
  const hits = findInLine('今天天氣很好', '天氣', 'exact');
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0], { start: 2, end: 4, text: '天氣', distance: 0 });
});

test('findInLine exact 找不到回傳空陣列', () => {
  assert.deepEqual(findInLine('今天天氣很好', '下雨', 'exact'), []);
});

test('findInLine loose 忽略大小寫', () => {
  const hits = findInLine('AbC def', 'abc', 'loose');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].start, 0);
  assert.equal(hits[0].end, 3);
});

test('findInLine loose 忽略行內空白且偏移正確', () => {
  const hits = findInLine('王 小明 你好', '王小明', 'loose');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].start, 0);
  assert.equal(hits[0].end, 4);
  assert.equal(hits[0].text, '王 小明');
});

test('findInLine exact 回報多個命中', () => {
  const hits = findInLine('AABAB', 'AB', 'exact');
  assert.deepEqual(hits.map(h => [h.start, h.end]), [[1, 3], [3, 5]]);
});

test('findInLine fuzzy 允許一字誤配', () => {
  const hits = findInLine('訂單編號 2026', '訂單編號 2027', 'fuzzy');
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].distance, 1);
});

test('findInLine loose 不容許字元誤配', () => {
  assert.deepEqual(findInLine('訂單編號 2027', '訂單編號 2026', 'loose'), []);
});

test('findInLine fuzzy 允許行比目標短一字（OCR 漏字）', () => {
  const hits = findInLine('訂單編號202', '訂單編號2026', 'fuzzy');
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].distance, 1);
});

// ---- matchItems ----
test('matchItems 過濾低信心度', () => {
  const items = [
    fakeItem('訂單編號 2026', 0.9),
    fakeItem('王小明', 0.2)
  ];
  const matches = matchItems(items, '訂單編號', 'exact', 0.5);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].item.text, '訂單編號 2026');
  assert.equal(matches[0].start, 0);
  assert.equal(matches[0].end, 4);
  assert.equal(matches[0].total, 9);
});

test('matchItems 行長不足直接跳過', () => {
  const matches = matchItems([fakeItem('短', 0.9)], '長一點的字', 'exact', 0);
  assert.deepEqual(matches, []);
});

test('matchItems 模糊模式命中並帶 full 旗標', () => {
  const items = [fakeItem('訂單編號 2026', 0.9)];
  const matches = matchItems(items, '訂單編號 2026', 'fuzzy', 0);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].full, true);
});

test('matchItems 模糊模式容許行比目標短一字', () => {
  const items = [fakeItem('訂單編號202', 0.9)];
  const matches = matchItems(items, '訂單編號2026', 'fuzzy', 0);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].distance, 1);
});

// ---- polyToBbox / slicePolyBox / matchBbox ----
test('polyToBbox 取四點極值', () => {
  assert.deepEqual(polyToBbox([[0, 0], [10, 0], [10, 20], [0, 20]]), { x0: 0, y0: 0, x1: 10, y1: 20 });
});

test('slicePolyBox 水平子字串依比例內插', () => {
  const box = slicePolyBox([[0, 0], [20, 0], [20, 10], [0, 10]], 0, 2, 4);
  assert.deepEqual(box, { x0: 0, y0: 0, x1: 10, y1: 10 });
});

test('slicePolyBox 垂直文字沿長邊內插', () => {
  const box = slicePolyBox([[0, 0], [10, 0], [10, 40], [0, 40]], 0, 2, 4);
  assert.deepEqual(box, { x0: 0, y0: 0, x1: 10, y1: 20 });
});

test('matchBbox 整行命中用整 poly、子字串用內插', () => {
  const full = { item: fakeItem(LINE, 0.9), start: 0, end: 9, total: 9, full: true };
  const part = { item: fakeItem(LINE, 0.9), start: 2, end: 4, total: 9, full: false };
  assert.deepEqual(matchBbox(full), { x0: 0, y0: 0, x1: 180, y1: 40 });
  const b = matchBbox(part);
  assert.ok(b.x0 > 20 && b.x1 < 100 && b.y0 === 0 && b.y1 === 40);
});

// ---- slicePolyBox 加權寬度內插 ----
test('slicePolyBox 無 widths 時退回均寬內插', () => {
  const box = slicePolyBox([[0, 0], [20, 0], [20, 10], [0, 10]], 1, 3, 4, null);
  assert.deepEqual(box, { x0: 5, y0: 0, x1: 15, y1: 10 });
});

test('slicePolyBox 依實際字元寬度加權內插（窄數字夾在寬字元中）', () => {
  const box = slicePolyBox([[0, 0], [200, 0], [200, 40], [0, 40]], 1, 2, 3, [16, 8, 16]);
  assert.deepEqual(box, { x0: 80, y0: 0, x1: 120, y1: 40 });
});

test('slicePolyBox 加權：15,567元 的第二個 5 應落在實際位置', () => {
  const poly = [[1269, 221], [1605, 216], [1605, 305], [1269, 305]];
  const box = slicePolyBox(poly, 3, 4, 7, [7, 7, 4, 7, 7, 7, 14]);
  assert.ok(Math.abs(box.x0 - 1383) < 2, `x0=${box.x0}`);
  assert.ok(Math.abs(box.x1 - 1428) < 2, `x1=${box.x1}`);
  assert.ok(box.y0 > 218 && box.y0 < 220, `y0=${box.y0}`);
  assert.equal(box.y1, 305);
});

test('slicePolyBox 垂直文字加權內插', () => {
  const box = slicePolyBox([[0, 0], [10, 0], [10, 120], [0, 120]], 0, 1, 3, [8, 16, 8]);
  assert.deepEqual(box, { x0: 0, y0: 0, x1: 10, y1: 30 });
});

// ---- overlap / uniqueMatches ----
test('overlap 相同框為 1、不相交為 0', () => {
  const a = { x0: 0, y0: 0, x1: 10, y1: 10 };
  assert.equal(overlap(a, a), 1);
  assert.equal(overlap(a, { x0: 20, y0: 0, x1: 30, y1: 10 }), 0);
});

test('uniqueMatches 去除同文字且重疊 >0.45 的重複', () => {
  const m1 = { item: fakeItem(LINE, 0.9), start: 0, end: 9, total: 9, text: LINE, full: true };
  const m2 = { item: fakeItem(LINE, 0.8), start: 1, end: 9, total: 9, text: '單編號 2026', full: false };
  const m3 = { item: fakeItem('王小明', 0.9), start: 0, end: 3, total: 3, text: '王小明', full: true };
  const out = uniqueMatches([m1, m2, m3]);
  assert.equal(out.length, 2);
  assert.equal(out[0].item.text, '訂單編號 2026');
  assert.equal(out[1].item.text, '王小明');
});
