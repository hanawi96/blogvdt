const frame = document.getElementById('pos-frame');
if (frame instanceof HTMLIFrameElement) {
  frame.loading = 'eager';
  frame.src = chrome.runtime.getURL('panel.html');
}
