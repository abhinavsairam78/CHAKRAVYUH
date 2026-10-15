export const hosted = typeof window !== 'undefined' && window.CHAKRAVYUH_HOSTED === true;
const KEY = 'chakravyuh-hosted-demo-v1';
let pending = Promise.resolve(), memory;
function readState() {
  if (memory !== undefined) return memory;
  try { memory = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { memory = null; }
  return memory;
}
export function hostedRequest(path, body, method = body === undefined ? 'GET' : 'POST') {
  const next = pending.then(async () => {
    const response = await fetch('/api/hosted', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, method, body, state: readState() }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The hosted demo is unavailable.');
    memory = result.state;
    try { localStorage.setItem(KEY, JSON.stringify(memory)); }
    catch { if (!window.__ckvStorageWarned) { window.__ckvStorageWarned = true; window.dispatchEvent(new CustomEvent('ckv-storage-warning')); } }
    if (result.status >= 400) throw new Error(result.data?.error || 'Request failed');
    if (method !== 'GET') window.dispatchEvent(new CustomEvent('ckv-state-changed'));
    return result;
  });
  pending = next.catch(() => {});
  return next;
}
export function installHostedExports() {
  if (!hosted) return;
  document.addEventListener('click', async (event) => {
    const anchor = event.target.closest('a[href]');
    if (!anchor) return;
    const url = new URL(anchor.href, location.href);
    if (url.origin !== location.origin || !/^\/(?:dossier\/|api\/export\/|api\/v1\/mules(?:\.csv)?$)/.test(url.pathname)) return;
    event.preventDefault();
    const popup = url.pathname.startsWith('/dossier/') ? window.open('about:blank', '_blank') : null;
    try {
      const response = await hostedRequest(url.pathname + url.search);
      const type = response.headers['content-type'] || 'application/json';
      const blob = new Blob([typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2)], { type });
      const target = URL.createObjectURL(blob);
      if (popup) popup.location = target;
      else {
        const download = document.createElement('a'); download.href = target;
        download.download = response.headers['content-disposition']?.match(/filename="([^"]+)"/)?.[1] || 'chakravyuh-export.json'; download.click();
      }
      setTimeout(() => URL.revokeObjectURL(target), 60000);
    } catch (error) { popup?.close(); window.dispatchEvent(new CustomEvent('ckv-export-error', { detail: error.message })); }
  });
}
