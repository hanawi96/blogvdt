const DEFAULT_POS_URL = 'https://vong-dau-tam.yendev96.workers.dev/admin/orders/pos';

function normalizePosUrl(value) {
  const trimmed = String(value || '').trim().replace(/\/$/, '');
  if (!trimmed) return DEFAULT_POS_URL;
  try {
    const url = new URL(trimmed);
    if (!/^https?:$/.test(url.protocol)) throw new Error('protocol');
    if (!url.pathname.includes('/admin/orders/pos')) {
      url.pathname = '/admin/orders/pos';
      url.search = '';
      url.hash = '';
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return DEFAULT_POS_URL;
  }
}

(async () => {
  const frame = document.getElementById('pos-frame');
  if (!(frame instanceof HTMLIFrameElement)) return;
  const stored = await chrome.storage.sync.get(['posUrl']);
  frame.src = normalizePosUrl(stored.posUrl);
})();
