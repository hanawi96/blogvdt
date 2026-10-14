import { isHttpUrl } from '../../lib/http';

const INTERNAL_PATH = /^\/(?:kien-thuc|san-pham)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isInternalPostPath(value: string): boolean {
  return INTERNAL_PATH.test(value);
}

export function isInternalHref(value: string, host = ''): boolean {
  if (isInternalPostPath(value)) return true;
  if (!host || !isHttpUrl(value)) return false;
  try {
    const url = new URL(value);
    return url.hostname === host && isInternalPostPath(url.pathname);
  } catch {
    return false;
  }
}

export function isPostHref(value: string): boolean {
  return isHttpUrl(value) || isInternalPostPath(value);
}
