import { LOCALE, cfg, h, hour12, pad } from '../main.js';
import { W } from '../registry.js';
import { GRADIENT_THEMES, clockTheme } from './helpers.js';

// ---------------------------------------------------------------- clock designs
// The time drawn in different shapes, each in any of the clock themes (style.css: .w-clockface, [data-clock-theme]).
// Everything is redrawn once a second at most and only the parts that changed; there is no CSS animation, so the
// panel does not draw frames in between.
export const CLOCK_SHAPES = ['flip', 'nixie', 'binary', 'rings', 'dots', 'stacked', 'segment', 'bars', 'orbit', 'dayline'];

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

// The parts of the time a shape needs, in the panel's 12/24-hour setting.
export function timeParts(now = new Date()) {
  const H = now.getHours(), twelve = hour12();
  return {
    H, M: now.getMinutes(), S: now.getSeconds(),
    hh: twelve ? String(H % 12 || 12) : pad(H), mm: pad(now.getMinutes()), ss: pad(now.getSeconds()),
    ap: twelve ? (H < 12 ? 'AM' : 'PM') : '',
  };
}

// Seven-segment digits: which of the segments a..g are lit.
const SEGMENTS = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
const SEG_PATHS = {
  a: 'M3 1h12l-2 3H5z', b: 'M16 2l1 1v11l-2 2-1-2V5z', c: 'M17 19v11l-1 1-2-3V18l1-1z', d: 'M3 32h12l-2-3H5z',
  e: 'M1 19v11l1 1 2-3V18l-1-1z', f: 'M2 2L1 3v11l2 2 1-2V5z', g: 'M3 16.5l2-1.5h8l2 1.5-2 1.5H5z',
};
function segmentDigit() {
  const g = svg('svg', { viewBox: '0 0 18 33', class: 'cf-seg-digit' });
  const parts = Object.fromEntries(Object.entries(SEG_PATHS).map(([k, d]) => { const p = svg('path', { d, class: 'cf-seg' }); g.append(p); return [k, p]; }));
  return { el: g, set(n) { const on = SEGMENTS[n] || ''; for (const [k, p] of Object.entries(parts)) p.classList.toggle('on', on.includes(k)); } };
}

const SHAPES = {
  // two split cards, like a flip clock standing still
  flip(box, { seconds }) {
    const card = () => { const v = h('span', 'cf-flip-v cf-txt', '--'); return { el: h('div', 'cf-flip-card', v, h('i', 'cf-flip-line')), v }; };
    const a = card(), b = card(), s = h('span', 'cf-flip-s cf-txt');
    box.append(h('div', 'cf-flip', a.el, b.el, seconds ? s : ''));
    return (t) => { a.v.textContent = t.hh; b.v.textContent = t.mm; s.textContent = t.ss; };
  },
  // glowing numerals in glass tubes
  nixie(box, { seconds }) {
    const tubes = Array.from({ length: seconds ? 6 : 4 }, () => h('span', 'cf-nixie-tube', h('span', 'cf-nixie-d', '0')));
    const row = h('div', 'cf-nixie');
    tubes.forEach((tube, i) => { row.append(tube); if (i % 2 === 1 && i < tubes.length - 1) row.append(h('span', 'cf-nixie-sep', '·')); });
    box.append(row);
    return (t) => { const digits = (pad(t.H) + t.mm + t.ss).split(''); tubes.forEach((tube, i) => { tube.firstChild.textContent = digits[i]; }); };
  },
  // binary-coded decimal: one column per digit, lit dots add up to it
  binary(box, { seconds }) {
    const cols = (seconds ? [2, 4, 3, 4, 3, 4] : [2, 4, 3, 4]).map((bits) => {
      const dots = Array.from({ length: 4 }, (_, i) => h('i', 'cf-bit' + (i < 4 - bits ? ' cf-bit-none' : '')));
      return { el: h('div', 'cf-bin-col', dots), dots };
    });
    const grid = h('div', 'cf-bin');
    cols.forEach((c, i) => { grid.append(c.el); if (i % 2 === 1 && i < cols.length - 1) grid.append(h('span', 'cf-bin-gap')); });
    const label = h('div', 'cf-small cf-txt');
    box.append(grid, label);
    return (t) => {
      const digits = (pad(t.H) + t.mm + t.ss).split('').map(Number);
      cols.forEach((c, i) => c.dots.forEach((d, j) => d.classList.toggle('on', ((digits[i] >> (3 - j)) & 1) === 1)));
      label.textContent = `${t.hh}:${t.mm}${t.ap ? ' ' + t.ap : ''}`;
    };
  },
  // concentric arcs for hours, minutes and seconds around the time
  rings(box, { seconds }) {
    const s = svg('svg', { viewBox: '0 0 100 100', class: 'cf-rings' });
    const ring = (r, w, cls) => {
      s.append(svg('circle', { cx: 50, cy: 50, r, class: 'cf-track', 'stroke-width': w }));
      const arc = svg('circle', { cx: 50, cy: 50, r, class: 'cf-arc ' + cls, 'stroke-width': w, 'stroke-dasharray': `0 ${2 * Math.PI * r}`, transform: 'rotate(-90 50 50)' });
      s.append(arc);
      return (f) => arc.setAttribute('stroke-dasharray', `${(f * 2 * Math.PI * r).toFixed(2)} ${(2 * Math.PI * r).toFixed(2)}`);
    };
    const hr = ring(44, 5, 'cf-arc-h'), mr = ring(36, 5, 'cf-arc-m'), sr = seconds ? ring(28.5, 3, 'cf-arc-s') : null;
    const text = h('div', 'cf-center cf-txt');
    box.append(h('div', 'cf-dial', s, text));
    return (t) => {
      hr(((t.H % 12) + t.M / 60) / 12); mr((t.M + t.S / 60) / 60); sr?.(t.S / 60);
      text.textContent = `${t.hh}:${t.mm}`;
    };
  },
  // sixty dots light up with the seconds; the hours sit as bigger marks
  dots(box) {
    const s = svg('svg', { viewBox: '0 0 100 100', class: 'cf-dots' });
    const dots = Array.from({ length: 60 }, (_, i) => {
      const a = (i * Math.PI) / 30, big = i % 5 === 0;
      const c = svg('circle', { cx: (50 + 44 * Math.sin(a)).toFixed(2), cy: (50 - 44 * Math.cos(a)).toFixed(2), r: big ? 2.4 : 1.3, class: 'cf-dot' + (big ? ' cf-dot-h' : '') });
      s.append(c);
      return c;
    });
    const text = h('div', 'cf-center cf-txt'), sub = h('div', 'cf-center-sub');
    box.append(h('div', 'cf-dial', s, h('div', 'cf-center-wrap', text, sub)));
    return (t) => {
      dots.forEach((d, i) => { d.classList.toggle('on', i <= t.S); d.classList.toggle('hour', i === (t.H % 12) * 5); });
      text.textContent = `${t.hh}:${t.mm}`;
      sub.textContent = t.ap;
    };
  },
  // hours above minutes, big, for a tall tile
  stacked(box, { seconds }) {
    const hh = h('div', 'cf-stack-v cf-txt'), mm = h('div', 'cf-stack-v cf-txt'), ss = h('div', 'cf-small');
    box.append(h('div', 'cf-stack', hh, h('i', 'cf-stack-rule'), mm, seconds ? ss : ''));
    return (t) => { hh.textContent = t.hh; mm.textContent = t.mm; ss.textContent = t.ss + (t.ap ? ' ' + t.ap : ''); };
  },
  // a seven-segment display drawn segment by segment
  segment(box, { seconds }) {
    const digits = Array.from({ length: seconds ? 6 : 4 }, segmentDigit);
    const row = h('div', 'cf-segrow');
    row.style.setProperty('--n', digits.length);
    digits.forEach((d, i) => { row.append(d.el); if (i % 2 === 1 && i < digits.length - 1) row.append(h('span', 'cf-seg-colon', h('i'), h('i'))); });
    box.append(row);
    return (t) => { const n = (pad(t.H) + t.mm + t.ss).split('').map(Number); digits.forEach((d, i) => d.set(n[i])); };
  },
  // three bars filling with the hour, minute and second
  bars(box, { seconds }) {
    const bar = (label) => { const fill = h('i', 'cf-bar-fill'), v = h('span', 'cf-bar-v cf-txt'); return { el: h('div', 'cf-bar', h('span', 'cf-bar-l', label), h('div', 'cf-bar-track', fill), v), fill, v }; };
    const rows = [bar('H'), bar('M'), ...(seconds ? [bar('S')] : [])];
    box.append(h('div', 'cf-bars', rows.map((r) => r.el)));
    return (t) => {
      const parts = [[t.H / 23, t.hh], [t.M / 59, t.mm], [t.S / 59, t.ss]];
      rows.forEach((r, i) => { r.fill.style.width = (parts[i][0] * 100).toFixed(1) + '%'; r.v.textContent = parts[i][1]; });
    };
  },
  // three bodies orbiting the centre at the speed of the hands
  orbit(box, { seconds }) {
    const s = svg('svg', { viewBox: '0 0 100 100', class: 'cf-orbit' });
    const lane = (r, size, cls) => {
      s.append(svg('circle', { cx: 50, cy: 50, r, class: 'cf-track cf-lane', 'stroke-width': 1.4 }));
      const body = svg('circle', { cx: 50, cy: 50 - r, r: size, class: 'cf-body ' + cls });
      s.append(body);
      return (f) => body.setAttribute('transform', `rotate(${(f * 360).toFixed(2)} 50 50)`);
    };
    const hr = lane(19, 6, 'cf-body-h'), mr = lane(32, 4.6, 'cf-body-m'), sr = seconds ? lane(44, 3.2, 'cf-body-s') : null;
    s.append(svg('circle', { cx: 50, cy: 50, r: 7.5, class: 'cf-sun' }));
    const text = h('div', 'cf-orbit-t cf-txt');
    box.append(h('div', 'cf-dial', s), text);
    return (t) => { hr(((t.H % 12) + t.M / 60) / 12); mr((t.M + t.S / 60) / 60); sr?.(t.S / 60); text.textContent = `${t.hh}:${t.mm}${t.ap ? ' ' + t.ap : ''}`; };
  },
  // the day as a line from midnight to midnight, with the time and the date
  dayline(box) {
    const time = h('div', 'cf-day-t cf-txt'), date = h('div', 'cf-day-d'), fill = h('i', 'cf-day-fill'), knob = h('i', 'cf-day-knob');
    const ticks = h('div', 'cf-day-ticks', [0, 6, 12, 18, 24].map((n) => h('span', null, pad(n % 24))));
    box.append(time, date, h('div', 'cf-day-track', fill, knob), ticks);
    return (t, now) => {
      time.textContent = `${t.hh}:${t.mm}${t.ap ? ' ' + t.ap : ''}`;
      date.textContent = now.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
      const f = ((t.H * 60 + t.M) * 60 + t.S) / 86400 * 100;
      fill.style.width = f.toFixed(2) + '%';
      knob.style.left = f.toFixed(2) + '%'; // the track is left to right in every language, like its fill
    };
  },
};

W.clockface = {
  bare: true, needs: ['tick'],
  create(box, { o }) {
    const shape = CLOCK_SHAPES.includes(o.shape) ? o.shape : 'flip';
    const theme = clockTheme(o);
    box.dataset.clockTheme = theme;
    box.dataset.shape = shape;
    if (GRADIENT_THEMES.has(theme)) box.dataset.gradient = '';
    const seconds = o.seconds !== false && cfg.display?.showSeconds !== false;
    const inner = h('div', 'cf-inner');
    box.append(inner);
    const draw = SHAPES[shape](inner, { seconds });
    let last = -1;
    const update = () => {
      const now = new Date(), sec = Math.floor(now / 1000);
      if (sec === last) return;
      last = sec;
      draw(timeParts(now), now);
    };
    update();
    return { update };
  },
};
