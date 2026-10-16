import type { Editor } from '@tiptap/core';
import { NodeSelection, type EditorState, type Transaction } from '@tiptap/pm/state';

/** Khối atom đang chọn (NodeSelection) có thể đổi chỗ với block liền kề theo `dir`. */
export function canMoveSelectedBlock(state: EditorState, dir: -1 | 1, typeNames: readonly string[]): boolean {
  const sel = state.selection;
  if (!(sel instanceof NodeSelection) || !typeNames.includes(sel.node.type.name)) return false;
  const $from = state.doc.resolve(sel.from);
  const index = $from.index();
  const target = index + dir;
  return target >= 0 && target < $from.parent.childCount;
}

/** Đổi chỗ khối atom đang chọn với block trước (`-1`) hoặc sau (`1`). Giữ nguyên attrs. */
export function moveSelectedBlockTr(state: EditorState, dir: -1 | 1, typeNames: readonly string[]): Transaction | null {
  if (!canMoveSelectedBlock(state, dir, typeNames)) return null;
  const sel = state.selection as NodeSelection;
  const pos = sel.from;
  const node = sel.node;
  const $from = state.doc.resolve(pos);
  const index = $from.index();
  const parent = $from.parent;
  const tr = state.tr;

  if (dir === -1) {
    const prev = parent.child(index - 1);
    const insertPos = pos - prev.nodeSize;
    tr.delete(pos, pos + node.nodeSize);
    tr.insert(insertPos, node);
    tr.setSelection(NodeSelection.create(tr.doc, insertPos));
  } else {
    const next = parent.child(index + 1);
    tr.delete(pos, pos + node.nodeSize);
    const insertPos = pos + next.nodeSize;
    tr.insert(insertPos, node);
    tr.setSelection(NodeSelection.create(tr.doc, insertPos));
  }
  return tr.scrollIntoView();
}

export function moveSelectedBlock(editor: Editor, dir: -1 | 1, typeNames: readonly string[]): boolean {
  const tr = moveSelectedBlockTr(editor.state, dir, typeNames);
  if (!tr) return false;
  editor.view.dispatch(tr);
  return true;
}

type GetPos = (() => number | undefined) | boolean;

/** Khối atom tại `getPos` còn block trước/sau để đổi chỗ hay không (để bật/tắt nút). */
export function blockMoveState(editor: Editor, getPos: GetPos): { up: boolean; down: boolean } {
  if (typeof getPos !== 'function') return { up: false, down: false };
  const pos = getPos();
  if (typeof pos !== 'number') return { up: false, down: false };
  const $pos = editor.state.doc.resolve(pos);
  const index = $pos.index();
  return { up: index > 0, down: index < $pos.parent.childCount - 1 };
}

/** Chọn khối tại `getPos` rồi đổi chỗ với block liền kề theo `dir`. */
export function moveBlock(editor: Editor, getPos: GetPos, dir: -1 | 1, typeNames: readonly string[]): void {
  if (typeof getPos !== 'function') return;
  const pos = getPos();
  if (typeof pos !== 'number') return;
  editor.chain().focus().setNodeSelection(pos).run();
  moveSelectedBlock(editor, dir, typeNames);
}

const IMAGE_TYPES = ['image'] as const;

/** Ảnh đang chọn có thể đổi chỗ với block liền kề theo `dir`. */
export function canMoveSelectedImage(state: EditorState, dir: -1 | 1): boolean {
  return canMoveSelectedBlock(state, dir, IMAGE_TYPES);
}

/** Đổi chỗ ảnh đang chọn với block trước (`-1`) hoặc sau (`1`). Giữ nguyên attrs/caption. */
export function moveSelectedImageTr(state: EditorState, dir: -1 | 1): Transaction | null {
  return moveSelectedBlockTr(state, dir, IMAGE_TYPES);
}

export function moveSelectedImage(editor: Editor, dir: -1 | 1): boolean {
  return moveSelectedBlock(editor, dir, IMAGE_TYPES);
}
