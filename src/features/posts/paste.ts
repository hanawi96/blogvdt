import { isPostHref } from './links';

/** Plain text clipboard là đúng một URL/path được phép gắn link — không có khoảng trắng. */
export function isLoneHref(text: string): boolean {
  const value = text.trim();
  if (!value || value.length > 300 || /\s/.test(value)) return false;
  return isPostHref(value);
}

export function firstClipboardImage(files: FileList | null | undefined): File | null {
  if (!files?.length) return null;
  for (const file of files) {
    if (file.type.startsWith('image/')) return file;
  }
  return null;
}
