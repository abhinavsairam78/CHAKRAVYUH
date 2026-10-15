// Small hand-rolled SVG charts (no libraries): stacked daily bars and horizontal bars, with hover.
import { esc, scamColor, SCAM_ORDER } from './util.js';

let tip;
function tooltip() {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    document.body.appendChild(tip);
  }
  return tip;
}

export function bindTips(el) {
  el.querySelectorAll('[data-tip]').forEach((m) => {
    m.addEventListener('pointermove', (e) => {
      const t = tooltip();
      t.hidden = false;
      t.innerHTML = m.dataset.tip;
      t.style.left = `${Math.min(e.clientX + 14, window.innerWidth - 240)}px`;
      t.style.top = `${e.clientY + 14}px`;
    });
    m.addEventListener('pointerleave', () => (tooltip().hidden = true));
  });
}

// Calls per day, stacked by scam type. Segments are separated by a 2px surface gap.
export function stackedDays(el, perDay) {
  const types = SCAM_ORDER.filter((t) => perDay.some((d) => d.byType[t]));
  const max = Math.max(1, ...perDay.map((d) => Object.values(d.byType).reduce((s, v) => s + v, 0)));
  const W = 640, H = 200, pad = { l: 28, r: 8, t: 10, b: 24 };
  const bw = (W - pad.l - pad.r) / perDay.length;
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const ticks = [0, Math.ceil(max / 2), max];
  let bars = '';
  perDay.forEach((d, i) => {
    let acc = 0;
    const x = pad.l + i * bw + bw * 0.18;
    const w = bw * 0.64;
    const total = Object.values(d.byType).reduce((s, v) => s + v, 0);
    types.forEach((t) => {
      const v = d.byType[t] || 0;
      if (!v) return;
      const y0 = y(acc), y1 = y(acc + v);
      acc += v;
      bars += `<rect x="${x}" y="${y1}" width="${w}" height="${Math.max(0, y0 - y1 - 2)}" rx="2" fill="${scamColor(t)}" data-tip="<b>${esc(d.day)}</b><br>${esc(t)}: ${v}<br><span>${total} call${total === 1 ? '' : 's'} that day</span>"/>`;
    });
    if (i % 2 === 1 || perDay.length < 8) bars += `<text x="${x + w / 2}" y="${H - 8}" class="ax" text-anchor="middle">${d.day.slice(8)}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Calls per day by scam type">
    ${ticks.map((v) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${pad.l - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${v}</text>`).join('')}
    ${bars}</svg>
    <div class="legend">${types.map((t) => `<span style="--dot:${scamColor(t)}">${esc(t)}</span>`).join('')}</div>`;
  bindTips(el);
}

// Horizontal bars for a {label: count} map, largest first. Single series: one colour, no legend.
export function hbars(el, counts, { color = '#3987e5', limit = 6, unit = '' } = {}) {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit);
  if (!rows.length) return (el.innerHTML = '<p class="empty">No data yet.</p>');
  const max = Math.max(...rows.map((r) => r[1]));
  el.innerHTML = `<div class="hbars">${rows.map(([k, v]) => `<div class="hbar" data-tip="<b>${esc(k)}</b><br>${v}${unit}"><span class="lbl">${esc(k)}</span><span class="track"><i style="width:${(v / max) * 100}%;background:${typeof color === 'function' ? color(k) : color}"></i></span><b>${v}</b></div>`).join('')}</div>`;
  bindTips(el);
}
