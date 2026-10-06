// The stats page's charts: SVG drawn by hand, no library. Each chart fills its container's width, draws again when
// that changes, and shows the numbers under the pointer in one shared tooltip.
//   lineChart(el, { labels, series: [{ name, values, color, area, dashed }], format, labelFormat, height })
//   barChart(el, { labels, series: [{ name, values, color }], stacked, format, labelFormat, height })
//   hbars(el, rows: [{ label, value, note, color }], { format })
//   donut(el, slices: [{ label, value, color }], { total, caption })
//   heatmap(el, values (168, Monday 00:00 local first), { format })
const NS = 'http://www.w3.org/2000/svg';

export const fmt = {
  int: (v) => Math.round(v).toLocaleString('en-US'),
  short(v) {
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(a >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (a >= 1e4) return (v / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'k';
    return Math.round(v).toLocaleString('en-US');
  },
  one: (v) => (Math.round(v * 10) / 10).toLocaleString('en-US'),
  pct: (v) => `${Math.round(v)}%`,
};

const svg = (tag, attrs = {}, parent = null) => {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
};
const div = (cls, parent, text) => {
  const n = document.createElement('div');
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
};

// ---------------------------------------------------------------- the tooltip
let tip = null;
function showTip(x, y, title, rows) {
  if (!tip) tip = div('ch-tip', document.body);
  tip.replaceChildren();
  if (title) div('ch-tip-t', tip, title);
  for (const r of rows) {
    const line = div('ch-tip-r', tip);
    if (r.color) div('ch-tip-k', line).style.background = r.color;
    div('ch-tip-n', line, r.name);
    div('ch-tip-v', line, r.value);
  }
  tip.hidden = false;
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const left = x + 16 + w > innerWidth ? x - w - 16 : x + 16;
  const top = Math.max(8, Math.min(innerHeight - h - 8, y - h / 2));
  tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}
function hideTip() {
  if (tip) tip.hidden = true;
}

// draws `draw(width)` now and whenever the container's width changes
function responsive(el, draw) {
  el.replaceChildren();
  let last = -1;
  const run = () => {
    const w = Math.floor(el.clientWidth);
    if (w === last || w <= 0) return;
    last = w;
    el.replaceChildren();
    draw(w);
  };
  el._ro?.disconnect();
  el._ro = new ResizeObserver(run);
  el._ro.observe(el);
  run();
}

// a round number of steps from 0 to at least max
function ticks(max, n = 4) {
  if (!(max > 0)) return { top: 1, step: 1, list: [0, 1] };
  const raw = max / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const top = Math.ceil(max / step) * step;
  const list = [];
  for (let v = 0; v <= top + step / 2; v += step) list.push(v);
  return { top, step, list };
}

function empty(el, text = 'Nothing yet') {
  el._ro?.disconnect();
  el._legend?.remove();
  el._legend = null;
  el.replaceChildren();
  div('ch-empty', el, text);
}

// the frame both XY charts share: axes, grid, x labels, and the hover that finds the column under the pointer
function frame(el, { labels, height, format, labelFormat, max, legend, series, tipFor, onCol }) {
  responsive(el, (W) => {
    const H = height;
    const padL = 44;
    const padR = 10;
    const padT = 10;
    const padB = 24;
    const iw = Math.max(10, W - padL - padR);
    const ih = H - padT - padB;
    const n = labels.length;
    const t = ticks(max);
    const root = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'ch-svg' }, el);
    const g = svg('g', { transform: `translate(${padL},${padT})` }, root);
    for (const v of t.list) {
      const y = ih - (v / t.top) * ih;
      svg('line', { x1: 0, x2: iw, y1: y, y2: y, class: 'ch-grid' }, g);
      svg('text', { x: -8, y: y + 4, class: 'ch-ax', 'text-anchor': 'end' }, g).textContent = format === fmt.pct ? fmt.pct(v) : fmt.short(v);
    }
    // as many x labels as fit
    const every = n <= 8 ? 1 : Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / 64))));
    const colW = iw / Math.max(1, n);
    for (let i = 0; i < n; i += every) {
      const x = colW * i + colW / 2;
      svg('text', { x, y: ih + 17, class: 'ch-ax', 'text-anchor': 'middle' }, g).textContent = labelFormat ? labelFormat(labels[i], i) : labels[i];
    }
    const y = (v) => ih - (Math.max(0, v) / t.top) * ih;
    onCol(g, { iw, ih, colW, y, n });
    const guide = svg('line', { y1: 0, y2: ih, class: 'ch-guide', visibility: 'hidden' }, g);
    const hit = svg('rect', { x: 0, y: 0, width: iw, height: ih, fill: 'transparent' }, g);
    hit.addEventListener('pointermove', (e) => {
      const r = hit.getBoundingClientRect();
      const i = Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n)));
      const x = colW * i + colW / 2;
      guide.setAttribute('x1', x);
      guide.setAttribute('x2', x);
      guide.setAttribute('visibility', 'visible');
      showTip(e.clientX, e.clientY, labelFormat ? labelFormat(labels[i], i, true) : labels[i], tipFor(i));
    });
    hit.addEventListener('pointerleave', () => {
      guide.setAttribute('visibility', 'hidden');
      hideTip();
    });
  });
  el._legend?.remove();
  el._legend = null;
  if (legend && series.length > 1) {
    const lg = (el._legend = div('ch-legend', null));
    for (const s of series) {
      const it = div('ch-legend-i', lg);
      div('ch-legend-k', it).style.background = s.color;
      div('', it, s.name);
    }
    el.after(lg);
  }
}

export function lineChart(el, { labels, series, format = fmt.int, labelFormat, height = 200, legend = true }) {
  if (!labels.length) return empty(el);
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  frame(el, {
    labels,
    height,
    format,
    labelFormat,
    max,
    legend,
    series,
    tipFor: (i) => series.map((s) => ({ name: s.name, value: format(s.values[i] || 0), color: s.color })),
    onCol(g, { colW, y, ih }) {
      const id = `g${Math.random().toString(36).slice(2, 8)}`;
      const defs = svg('defs', {}, g);
      series.forEach((s, k) => {
        const pts = s.values.map((v, i) => [colW * i + colW / 2, y(v)]);
        const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
        if (s.area) {
          const grad = svg('linearGradient', { id: `${id}${k}`, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
          svg('stop', { offset: '0%', 'stop-color': s.color, 'stop-opacity': 0.42 }, grad);
          svg('stop', { offset: '100%', 'stop-color': s.color, 'stop-opacity': 0.02 }, grad);
          const first = pts[0];
          const last = pts[pts.length - 1];
          svg('path', { d: `${d}L${last[0].toFixed(1)},${ih}L${first[0].toFixed(1)},${ih}Z`, fill: `url(#${id}${k})` }, g);
        }
        svg('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': s.dashed ? '5 4' : 'none', class: 'ch-line' }, g);
        if (pts.length === 1) svg('circle', { cx: pts[0][0], cy: pts[0][1], r: 3.5, fill: s.color }, g);
      });
    },
  });
}

export function barChart(el, { labels, series, stacked = false, format = fmt.int, labelFormat, height = 200, legend = true }) {
  if (!labels.length) return empty(el);
  const max = stacked ? Math.max(1, ...labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0))) : Math.max(1, ...series.flatMap((s) => s.values));
  frame(el, {
    labels,
    height,
    format,
    labelFormat,
    max,
    legend,
    series,
    tipFor: (i) => series.map((s) => ({ name: s.name, value: format(s.values[i] || 0), color: s.color })),
    onCol(g, { colW, y, ih }) {
      const gap = Math.min(6, colW * 0.25);
      const bw = Math.max(1, colW - gap);
      labels.forEach((_, i) => {
        let base = ih;
        series.forEach((s, k) => {
          const v = s.values[i] || 0;
          if (!v) return;
          const h = ih - y(v);
          if (stacked) {
            svg('rect', { x: colW * i + gap / 2, y: base - h, width: bw, height: Math.max(0, h), fill: s.color, rx: Math.min(2, bw / 4) }, g);
            base -= h;
          } else {
            const w = bw / series.length;
            svg('rect', { x: colW * i + gap / 2 + w * k, y: y(v), width: Math.max(1, w - 1), height: Math.max(0, h), fill: s.color, rx: Math.min(2, w / 4) }, g);
          }
        });
      });
    },
  });
}

export function hbars(el, rows, { format = fmt.int, color = 'var(--blood-hi)' } = {}) {
  el.replaceChildren();
  if (!rows.length) return empty(el);
  const max = Math.max(1, ...rows.map((r) => r.value));
  for (const r of rows) {
    const row = div('hb-row', el);
    const top = div('hb-top', row);
    div('hb-label', top, r.label);
    div('hb-val', top, format(r.value));
    const track = div('hb-track', row);
    const bar = div('hb-bar', track);
    bar.style.width = `${Math.max(1.5, (100 * r.value) / max)}%`;
    bar.style.background = r.color || color;
    if (r.note) div('hb-note', row, r.note);
  }
}

export function donut(el, slices, { caption = '', format = fmt.int } = {}) {
  el.replaceChildren();
  slices = slices.filter((s) => s.value > 0);
  const total = slices.reduce((a, s) => a + s.value, 0);
  if (!total) return empty(el);
  const wrap = div('dn', el);
  const S = 168;
  const R = 74;
  const r = 50;
  const root = svg('svg', { width: S, height: S, viewBox: `0 0 ${S} ${S}`, class: 'dn-svg' }, wrap);
  let a0 = -Math.PI / 2;
  const pt = (rad, a) => `${(S / 2 + rad * Math.cos(a)).toFixed(2)},${(S / 2 + rad * Math.sin(a)).toFixed(2)}`;
  for (const s of slices) {
    const frac = s.value / total;
    const a1 = a0 + frac * Math.PI * 2 - (slices.length > 1 ? 0.012 : 0);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const d = frac >= 0.9999 ? `M${pt(R, 0)}A${R},${R} 0 1 1 ${pt(R, Math.PI)}A${R},${R} 0 1 1 ${pt(R, 0)}M${pt(r, 0)}A${r},${r} 0 1 0 ${pt(r, Math.PI)}A${r},${r} 0 1 0 ${pt(r, 0)}Z` : `M${pt(R, a0)}A${R},${R} 0 ${large} 1 ${pt(R, a1)}L${pt(r, a1)}A${r},${r} 0 ${large} 0 ${pt(r, a0)}Z`;
    const p = svg('path', { d, fill: s.color, 'fill-rule': 'evenodd', class: 'dn-slice' }, root);
    p.addEventListener('pointermove', (e) => showTip(e.clientX, e.clientY, s.label, [{ name: 'share', value: `${Math.round(frac * 100)}%` }, { name: 'count', value: format(s.value) }]));
    p.addEventListener('pointerleave', hideTip);
    a0 += frac * Math.PI * 2;
  }
  svg('text', { x: S / 2, y: S / 2 + 4, class: 'dn-total', 'text-anchor': 'middle' }, root).textContent = fmt.short(total);
  svg('text', { x: S / 2, y: S / 2 + 22, class: 'dn-cap', 'text-anchor': 'middle' }, root).textContent = caption;
  const lg = div('dn-legend', wrap);
  for (const s of slices) {
    const it = div('dn-li', lg);
    div('dn-k', it).style.background = s.color;
    div('dn-l', it, s.label);
    div('dn-v', it, `${Math.round((100 * s.value) / total)}%`);
  }
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export function heatmap(el, values, { format = fmt.int } = {}) {
  el.replaceChildren();
  const max = Math.max(...values);
  if (!(max > 0)) return empty(el);
  const grid = div('hm', el);
  div('hm-corner', grid);
  for (let h = 0; h < 24; h++) div('hm-h', grid, h % 3 === 0 ? (h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`) : '');
  for (let d = 0; d < 7; d++) {
    div('hm-d', grid, DAYS[d]);
    for (let h = 0; h < 24; h++) {
      const v = values[d * 24 + h];
      const c = div('hm-c', grid);
      const k = v / max;
      c.style.background = v ? `rgba(212, 42, 42, ${(0.12 + 0.88 * Math.sqrt(k)).toFixed(3)})` : 'rgba(230, 223, 207, 0.04)';
      c.addEventListener('pointermove', (e) => {
        const hh = (x) => `${x % 12 === 0 ? 12 : x % 12}${x < 12 ? 'am' : 'pm'}`;
        showTip(e.clientX, e.clientY, `${DAYS[d]} ${hh(h)}-${hh((h + 1) % 24)}`, [{ name: 'sessions', value: format(v) }]);
      });
      c.addEventListener('pointerleave', hideTip);
    }
  }
}
