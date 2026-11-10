/** Thông báo trang admin: hiện ngắn rồi ẩn, đồng thời gỡ query flash khỏi URL. */
export const ADMIN_FLASH_MS = 2000;

const FLASH_PARAMS = [
  'notice',
  'n',
  'u',
  'saved',
  'deleted',
  'featured',
  'bulk',
  'trashed',
  'purged',
  'restored',
  'error',
  'copy',
  'retire',
  'skip',
] as const;

export function dismissAdminFlashes(root: ParentNode = document): void {
  for (const node of root.querySelectorAll('[data-admin-flash]')) {
    if (!(node instanceof HTMLElement)) continue;
    node.hidden = true;
    node.replaceChildren();
  }
  const url = new URL(location.href);
  let dirty = false;
  for (const key of FLASH_PARAMS) {
    if (!url.searchParams.has(key)) continue;
    url.searchParams.delete(key);
    dirty = true;
  }
  if (dirty) history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

/** Hẹn ẩn các `[data-admin-flash]` đang hiện. Gọi lại sau soft-nav nếu HTML mới có flash. */
export function armAdminFlashes(root: ParentNode = document, ms = ADMIN_FLASH_MS): number {
  const hasFlash = [...root.querySelectorAll('[data-admin-flash]')].some(
    (node) => node instanceof HTMLElement && !node.hidden && (node.textContent?.trim() ?? '') !== '',
  );
  if (!hasFlash) return 0;
  return window.setTimeout(() => dismissAdminFlashes(root), ms);
}
