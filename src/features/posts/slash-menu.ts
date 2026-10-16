/** Slash `/` menu — lọc lệnh client-side, không I/O. */

import type { EditorState } from '@tiptap/pm/state';

export type SlashCommandId =
  | 'heading2'
  | 'heading3'
  | 'bullet'
  | 'ordered'
  | 'quote'
  | 'image'
  | 'table'
  | 'cards'
  | 'products'
  | 'callout';

export type SlashCommand = {
  id: SlashCommandId;
  title: string;
  hint: string;
  /** Từ khóa gõ sau `/` (đã fold sẵn khi build). */
  keys: string[];
};

export type SlashMatch = {
  /** Offset trong textblock (0 = đầu block). */
  offset: number;
  query: string;
};

const MAX_QUERY = 32;
const MAX_RESULTS = 8;

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
}

function cmd(id: SlashCommandId, title: string, hint: string, aliases: string[]): SlashCommand {
  const keys = [...new Set([fold(title), ...aliases.map(fold)].filter(Boolean))];
  return { id, title, hint, keys };
}

/** Danh sách cố định — tạo 1 lần khi load module. */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  cmd('heading2', 'Tiêu đề 2', 'H2', ['h2', 'tieu de 2', 'heading']),
  cmd('heading3', 'Tiêu đề 3', 'H3', ['h3', 'tieu de 3']),
  cmd('bullet', 'Danh sách', 'Gạch đầu dòng', ['list', 'bullet', 'ul']),
  cmd('ordered', 'Danh sách số', '1. 2. 3.', ['ol', 'so', 'numbered']),
  cmd('quote', 'Trích dẫn', 'Blockquote', ['quote', 'trich dan']),
  cmd('image', 'Ảnh', 'Mở thư viện', ['anh', 'hinh', 'image', 'img', 'media']),
  cmd('table', 'Bảng', 'Bảng 3×3', ['bang', 'table']),
  cmd('cards', 'Bài liên quan', 'Hộp đề xuất bài', ['lien quan', 'bai', 'post', 'cards']),
  cmd('products', 'Sản phẩm', 'Hộp đề xuất SP', ['san pham', 'sp', 'product', 'products']),
  cmd('callout', 'Ghi chú', 'Hộp lưu ý', ['ghi chu', 'luu y', 'callout', 'tip', 'note']),
];

/** Lấy `/query` ở cuối đoạn trước con trỏ (đầu block hoặc sau khoảng trắng). */
export function findSlashMatch(textBeforeCursor: string): SlashMatch | null {
  if (!textBeforeCursor || textBeforeCursor.length > 400) return null;
  const slash = textBeforeCursor.lastIndexOf('/');
  if (slash < 0) return null;
  if (slash > 0 && !/\s/.test(textBeforeCursor.charAt(slash - 1))) return null;
  const query = textBeforeCursor.slice(slash + 1);
  if (query.length > MAX_QUERY || /\n/.test(query)) return null;
  return { offset: slash, query };
}

export function filterSlashCommands(query: string, limit = MAX_RESULTS): SlashCommand[] {
  const q = fold(query);
  if (!q) return SLASH_COMMANDS.slice(0, limit);
  const scored: { cmd: SlashCommand; score: number }[] = [];
  for (const item of SLASH_COMMANDS) {
    let best = -1;
    for (const key of item.keys) {
      if (key === q) best = Math.max(best, 3);
      else if (key.startsWith(q)) best = Math.max(best, 2);
      else if (key.includes(q)) best = Math.max(best, 1);
    }
    if (best >= 0) scored.push({ cmd: item, score: best });
  }
  scored.sort((a, b) => b.score - a.score || a.cmd.title.localeCompare(b.cmd.title, 'vi'));
  return scored.slice(0, limit).map((row) => row.cmd);
}

export function clampSlashIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}

/** Vùng `/query` trước con trỏ trong textblock hiện tại; null nếu không mở menu. */
export function slashRangeFromState(state: EditorState): { from: number; to: number; query: string } | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const $from = selection.$from;
  if (!$from.parent.isTextblock) return null;
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '\0');
  const match = findSlashMatch(textBefore);
  if (!match) return null;
  return {
    from: $from.start() + match.offset,
    to: selection.from,
    query: match.query,
  };
}
