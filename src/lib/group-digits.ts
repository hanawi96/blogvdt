// "25000" -> "25.000". Dấu chấm chỉ để nhìn, không phải phần thập phân.
export function groupDigits(value: string, maxDigits: number): string {
  const digits = value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, maxDigits);
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

const PLAIN_NAMES = new Set(['meta_pixel_id']);

export function isGroupedField(input: HTMLInputElement): boolean {
  if (input.type === 'number' || input.type === 'tel' || !input.name || PLAIN_NAMES.has(input.name)) return false;
  if (input.inputMode === 'numeric') return true;
  if (input.inputMode !== 'decimal') return false;
  const kind = input.form?.elements.namedItem('kind');
  return kind instanceof HTMLSelectElement && kind.value === 'fixed';
}

function prepare(input: HTMLInputElement): number {
  if (!input.dataset.maxDigits) {
    const max = input.maxLength > 0 ? input.maxLength : 12;
    input.dataset.maxDigits = String(max);
    input.maxLength = max + Math.floor((max - 1) / 3);
  }
  return Number(input.dataset.maxDigits);
}

export function paintGrouped(input: HTMLInputElement): void {
  if (!isGroupedField(input)) return;
  const next = groupDigits(input.value, prepare(input));
  if (next === input.value) return;
  const pos = input.selectionStart ?? input.value.length;
  const digitsBefore = input.value.slice(0, pos).replace(/\D/g, '').length;
  input.value = next;
  let seen = 0;
  let caret = next.length;
  for (let index = 0; index < next.length; index += 1) {
    const char = next[index] ?? '';
    if (char >= '0' && char <= '9') seen += 1;
    if (seen === digitsBefore) {
      caret = index + 1;
      break;
    }
  }
  if (digitsBefore === 0) caret = 0;
  try {
    input.setSelectionRange(caret, caret);
  } catch {
    // Một số ô không cho đặt con trỏ khi chưa được focus.
  }
}

function ungroup(input: HTMLInputElement): void {
  if (isGroupedField(input)) input.value = input.value.replace(/\./g, '');
}

export function bindGroupedInputs(root: Document): void {
  const paintAll = (scope: Document | HTMLElement) => {
    scope.querySelectorAll('input').forEach((node) => {
      if (node instanceof HTMLInputElement) paintGrouped(node);
    });
  };
  paintAll(root);
  root.addEventListener('input', (event) => {
    if (event.target instanceof HTMLInputElement) paintGrouped(event.target);
  }, true);
  root.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || target.name !== 'kind' || !target.form) return;
    const value = target.form.elements.namedItem('value');
    if (!(value instanceof HTMLInputElement)) return;
    if (target.value === 'percent') value.value = value.value.replace(/\./g, '');
    else paintGrouped(value);
  }, true);
  root.addEventListener('toggle', (event) => {
    if (event.target instanceof HTMLDialogElement && event.target.open) paintAll(event.target);
  }, true);
  root.addEventListener('submit', (event) => {
    if (!(event.target instanceof HTMLFormElement)) return;
    event.target.querySelectorAll('input').forEach((node) => {
      if (node instanceof HTMLInputElement) ungroup(node);
    });
  }, true);
}
