/** Nhãn phím Mod theo OS (TipTap dùng Mod = Cmd trên Apple, Ctrl elsewhere). */
export function editorModLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl';
  const apple = /Mac|iPhone|iPad|iPod/i.test(`${navigator.platform} ${navigator.userAgent}`);
  return apple ? '⌘' : 'Ctrl';
}

export function editorHotkeyTip(label: string, chord: string, mod = editorModLabel()): string {
  return `${label} (${mod}+${chord})`;
}

/** Một dòng gợi ý dưới toolbar — chỉ phím hay dùng khi viết dài. */
export function editorHotkeyCheatSheet(mod = editorModLabel()): string {
  return `${mod}+B đậm · ${mod}+I nghiêng · ${mod}+Z hoàn tác · / lệnh nhanh`;
}
