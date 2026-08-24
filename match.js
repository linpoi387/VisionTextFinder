export function toCodePoints(str) {
  return [...str];
}

export function normalise(value, mode) {
  if (mode === 'exact') return value.trim();
  return compactIndex(value).text;
}

export function compactIndex(text) {
  const cps = toCodePoints(text);
  const chars = [];
  const map = [];
  cps.forEach((cp, index) => {
    if (/\s/u.test(cp)) return;
    chars.push(cp.toLocaleLowerCase());
    map.push(index);
  });
  return { text: chars.join(''), map };
}

export function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = new Array(n + 1);
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

export function fuzzyErrorsFor(queryLen) {
  return Math.min(2, Math.max(1, Math.floor(queryLen / 4)));
}

function exactMatches(lineCp, needle) {
  const results = [];
  if (needle.length === 0) return results;
  const trimmed = lineCp.join('').trim();
  const lead = lineCp.length - toCodePoints(lineCp.join('').trimStart()).length;
  const hay = toCodePoints(trimmed);
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let k = 0; k < needle.length; k++) {
      if (hay[i + k] !== needle[k]) { ok = false; break; }
    }
    if (ok) {
      const start = lead + i;
      results.push({
        start,
        end: start + needle.length,
        text: lineCp.slice(start, start + needle.length).join(''),
        distance: 0
      });
    }
  }
  return results;
}

function fuzzyMatches(lineCp, cLine, queryCp, errors) {
  const hay = toCodePoints(cLine.text);
  const q = queryCp;
  const results = [];
  if (q.length === 0) return results;
  const lo = Math.max(1, q.length - errors);
  const hi = q.length + errors;
  if (hay.length < lo) return results;
  const candidates = [];
  for (let i = 0; i <= hay.length - lo; i++) {
    let bestDist = Infinity;
    let bestLen = lo;
    const upper = Math.min(hi, hay.length - i);
    for (let w = lo; w <= upper; w++) {
      const d = levenshteinDistance(hay.slice(i, i + w), q);
      if (d < bestDist) { bestDist = d; bestLen = w; }
    }
    if (bestDist <= errors) candidates.push({ i, w: bestLen, d: bestDist });
  }
  candidates.sort((a, b) => a.d - b.d || a.i - b.i);
  let lastEnd = -1;
  for (const c of candidates) {
    if (c.i < lastEnd) continue;
    const start = cLine.map[c.i];
    const end = cLine.map[c.i + c.w - 1] + 1;
    results.push({ start, end, text: lineCp.slice(start, end).join(''), distance: c.d });
    lastEnd = c.i + c.w;
  }
  return results;
}

export function findInLine(line, query, mode) {
  const lineCp = toCodePoints(line);
  if (mode === 'exact') {
    return exactMatches(lineCp, toCodePoints(query));
  }
  const cLine = compactIndex(line);
  const q = toCodePoints(compactIndex(query).text);
  const errors = mode === 'fuzzy' ? fuzzyErrorsFor(q.length) : 0;
  return fuzzyMatches(lineCp, cLine, q, errors);
}

export function matchItems(items, query, mode, scoreThresh) {
  const results = [];
  for (const item of items) {
    if (item.score < scoreThresh) continue;
    const total = toCodePoints(item.text).length;
    const queryLen = toCodePoints(mode === 'exact' ? query : compactIndex(query).text).length;
    const minLen = mode === 'fuzzy' ? Math.max(1, queryLen - fuzzyErrorsFor(queryLen)) : queryLen;
    if (total < minLen) continue;
    for (const hit of findInLine(item.text, query, mode)) {
      results.push({
        item,
        start: hit.start,
        end: hit.end,
        text: hit.text,
        distance: hit.distance,
        total,
        full: hit.start === 0 && hit.end === total
      });
    }
  }
  return results;
}

function lerp(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function polyToBbox(poly) {
  const xs = poly.map(p => p[0]);
  const ys = poly.map(p => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

export function slicePolyBox(poly, start, end, total, widths = null) {
  const [p0, p1, p2, p3] = poly;
  const width = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const height = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
  let t0;
  let t1;
  if (Array.isArray(widths) && widths.length === total) {
    let sum = 0;
    const cum = new Array(total + 1);
    cum[0] = 0;
    for (let i = 0; i < total; i++) { sum += widths[i]; cum[i + 1] = sum; }
    const totalWidth = sum > 0 ? sum : total;
    t0 = cum[Math.max(0, Math.min(start, total))] / totalWidth;
    t1 = cum[Math.max(0, Math.min(end, total))] / totalWidth;
  } else {
    t0 = start / total;
    t1 = end / total;
  }
  const pts = height > width * 1.45
    ? [lerp(p0, p3, t0), lerp(p0, p3, t1), lerp(p1, p2, t1), lerp(p1, p2, t0)]
    : [lerp(p0, p1, t0), lerp(p0, p1, t1), lerp(p3, p2, t1), lerp(p3, p2, t0)];
  return polyToBbox(pts);
}

let widthContext = null;
function getWidthContext() {
  if (widthContext !== null) return widthContext;
  try {
    const canvas = typeof document !== 'undefined' && document.createElement('canvas');
    const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx || typeof ctx.measureText !== 'function') { widthContext = false; return null; }
    ctx.font = '16px sans-serif';
    widthContext = ctx;
  } catch {
    widthContext = false;
    return null;
  }
  return widthContext;
}

export function measureGlyphWidths(text) {
  const ctx = getWidthContext();
  if (!ctx) return null;
  const widths = [];
  for (const cp of toCodePoints(text)) {
    const w = ctx.measureText(cp).width;
    widths.push(w > 0 ? w : 1);
  }
  return widths;
}

export function matchBbox(match) {
  if (match.full) return polyToBbox(match.item.poly);
  return slicePolyBox(match.item.poly, match.start, match.end, match.total, measureGlyphWidths(match.item.text));
}

export function overlap(a, b) {
  const width = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const height = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = width * height;
  const areaA = (a.x1 - a.x0) * (a.y1 - a.y0);
  const areaB = (b.x1 - b.x0) * (b.y1 - b.y0);
  const minArea = Math.min(areaA, areaB);
  return minArea <= 0 ? 0 : inter / minArea;
}

export function uniqueMatches(matches) {
  const withBox = matches.map(m => ({ m, bbox: matchBbox(m) }));
  return withBox
    .filter((entry, index) =>
      !withBox.slice(0, index).some(prev =>
        entry.m.item.text === prev.m.item.text && overlap(entry.bbox, prev.bbox) > 0.45))
    .map(entry => entry.m);
}
