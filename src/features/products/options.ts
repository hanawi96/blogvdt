const MAX_OPTIONS = 12;
const MAX_LABEL = 40;

export function readOptions(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
  } catch {
    return [];
  }
}

export function parseOptionsText(value: string): { ok: true; options: string[] } | { ok: false; error: string } {
  const options = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (options.length > MAX_OPTIONS) return { ok: false, error: `Tối đa ${MAX_OPTIONS} lựa chọn.` };
  if (options.some((option) => option.length > MAX_LABEL)) return { ok: false, error: `Mỗi lựa chọn tối đa ${MAX_LABEL} ký tự.` };
  if (new Set(options).size !== options.length) return { ok: false, error: 'Các lựa chọn không được trùng.' };
  return { ok: true, options };
}

export function optionsText(options: string[]): string {
  return options.join('\n');
}
