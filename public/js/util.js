import { hosted, hostedRequest } from './hosted.js';
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const mmss = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

const IST = { timeZone: 'Asia/Kolkata' };
export const when = (ms) => new Date(ms).toLocaleString('en-IN', { ...IST, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const time = (ms) => new Date(ms).toLocaleTimeString('en-IN', { ...IST, hour: 'numeric', minute: '2-digit' });

export function ago(ms, now = Date.now()) {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function countdown(ms) {
  const neg = ms < 0;
  const s = Math.abs(Math.round(ms / 1000));
  const t = s >= 3600 ? `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m` : `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return neg ? `overdue ${t}` : `${t} left`;
}

export const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export async function api(path, body, method) {
  if (hosted) return (await hostedRequest(path, body, method)).data;
  const res = await fetch(path, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export function toast(text, kind = 'info') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  box.appendChild(el);
  setTimeout(() => el.classList.add('out'), 4200);
  setTimeout(() => el.remove(), 4800);
}

// Ring colours: stable per ring id, from the categorical palette (dark steps).
const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9', '#e66767', '#008300'];
export function ringColor(id) {
  if (!id) return '#4b5563';
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SERIES[h % SERIES.length];
}

export const SCAM_ORDER = ['Digital arrest', 'Courier / parcel', 'KYC / account block', 'Task / part-time job', 'Instant loan app', 'Electricity bill', 'Sextortion', 'Unclassified'];
export function scamColor(label) {
  const i = SCAM_ORDER.indexOf(label);
  return i < 0 || label === 'Unclassified' ? '#6b7280' : SERIES[i];
}

export const CHANNEL = {
  'citizen-merge': ['Citizen merge', 'citizen'],
  'telco-divert': ['Telco divert', 'telco'],
  rehearsal: ['Rehearsal', 'rehearsal'],
  seed: ['History', 'seed']
};

export function channelPill(ch) {
  const [label, cls] = CHANNEL[ch] || [ch, ''];
  return `<span class="chan ${cls}">${esc(label)}</span>`;
}

export function riskBar(risk) {
  const level = risk >= 75 ? 'crit' : risk >= 50 ? 'high' : 'med';
  return `<span class="risk ${level}" title="Risk score ${risk} of 99"><i style="width:${risk}%"></i><b>${risk}</b></span>`;
}

export const ID_LABEL = { upi: 'UPI', account: 'A/C', ifsc: 'IFSC', phone: 'Phone', url: 'Link', amount: 'Amount', email: 'Email' };

// Small figure strip in a page header: [[value, label], ...]
export function stats(el, items) {
  if (el) el.innerHTML = items.map(([v, l, cls]) => `<div class="${cls || ''}"><dd>${esc(v)}</dd><dt>${esc(l)}</dt></div>`).join('');
}
