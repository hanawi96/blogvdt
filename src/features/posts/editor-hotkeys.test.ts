import { describe, expect, it } from 'vitest';
import { editorHotkeyCheatSheet, editorHotkeyTip } from './editor-hotkeys';

describe('editorHotkeyTip', () => {
  it('ghép nhãn và chord', () => {
    expect(editorHotkeyTip('Đậm', 'B', 'Ctrl')).toBe('Đậm (Ctrl+B)');
    expect(editorHotkeyTip('Hoàn tác', 'Z', '⌘')).toBe('Hoàn tác (⌘+Z)');
  });

  it('cheat sheet một dòng', () => {
    expect(editorHotkeyCheatSheet('Ctrl')).toContain('Ctrl+B đậm');
    expect(editorHotkeyCheatSheet('Ctrl')).toContain('/ lệnh nhanh');
  });
});
