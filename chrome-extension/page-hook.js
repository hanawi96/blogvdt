/** Chạy MAIN world: bắt SĐT từ JSON API Pancake/Zalo (tin chưa cuộn lên vẫn có trong payload). */
(function () {
  if (window.__vdtPageHook) return;
  window.__vdtPageHook = true;

  const PHONE_RE = /(?:\+?84|0)\d{8,10}/g;
  const MAX_PHONES = 12;
  const MAX_DEPTH = 7;

  function walk(value, out, depth) {
    if (out.length >= MAX_PHONES || depth > MAX_DEPTH) return;
    if (typeof value === 'string') {
      if (value.length > 4000) return;
      const matches = value.match(PHONE_RE);
      if (matches) {
        for (const match of matches) {
          out.push(match);
          if (out.length >= MAX_PHONES) return;
        }
      }
      return;
    }
    if (typeof value === 'number') {
      const text = String(value);
      if (/(?:\+?84|0)\d{8,10}/.test(text)) out.push(text);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item, out, depth + 1);
        if (out.length >= MAX_PHONES) return;
      }
      return;
    }
    for (const [key, nested] of Object.entries(value)) {
      const lower = key.toLowerCase();
      if (lower.includes('phone') || lower.includes('tel') || lower === 'mobile' || lower === 'msisdn') {
        if (typeof nested === 'string' || typeof nested === 'number') out.push(String(nested));
      }
      walk(nested, out, depth + 1);
      if (out.length >= MAX_PHONES) return;
    }
  }

  function emit(phones) {
    if (!phones.length) return;
    window.postMessage({ source: 'vdt-page', type: 'vdt-phones-found', phones }, '*');
  }

  function scanJson(data) {
    const found = [];
    walk(data, found, 0);
    emit(found);
  }

  function fromResponse(response) {
    try {
      if (!response || !response.ok) return;
      const ct = response.headers.get('content-type') || '';
      if (!ct.includes('json')) return;
      const clone = response.clone();
      void clone.json().then(scanJson).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    return originalFetch.apply(this, args).then((response) => {
      fromResponse(response);
      return response;
    });
  };

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__vdtUrl = url;
    return xhrOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        const ct = this.getResponseHeader('content-type') || '';
        if (!ct.includes('json')) return;
        const raw = this.responseText;
        if (!raw || raw.length > 2_000_000) return;
        scanJson(JSON.parse(raw));
      } catch {
        /* ignore */
      }
    });
    return xhrSend.apply(this, args);
  };
})();
