// Thay facade (ảnh + nút play) bằng iframe YouTube thật khi khách bấm play.
// Nhờ vậy trình phát YouTube (~590 KiB JS/CSS) chỉ tải khi cần, không chặn tải trang.
const YT_ID = /^[A-Za-z0-9_-]{6,20}$/;

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest('[data-yt-facade]');
  if (!(button instanceof HTMLElement)) return;
  const id = button.dataset.ytFacade ?? '';
  if (!YT_ID.test(id)) return;

  const iframe = document.createElement('iframe');
  iframe.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1`;
  iframe.title = button.getAttribute('aria-label') || 'Video';
  iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  iframe.allowFullscreen = true;
  button.replaceWith(iframe);
});
