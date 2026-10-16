import type { Editor } from '@tiptap/core';
import { NodeSelection, type EditorState, type Transaction } from '@tiptap/pm/state';

/** Ảnh đang chọn (NodeSelection) có thể đổi chỗ với block liền kề theo `dir`. */
export function canMoveSelectedImage(state: EditorState, dir: -1 | 1): boolean {
  const sel = state.selection;
  if (!(sel instanceof NodeSelection) || sel.node.type.name !== 'image') return false;
  const $from = state.doc.resolve(sel.from);
  const index = $from.index();
  const target = index + dir;
  return target >= 0 && target < $from.parent.childCount;
}

/** Đổi chỗ ảnh đang chọn với block trước (`-1`) hoặc sau (`1`). Giữ nguyên attrs/caption. */
export function moveSelectedImageTr(state: EditorState, dir: -1 | 1): Transaction | null {
  if (!canMoveSelectedImage(state, dir)) return null;
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

export function moveSelectedImage(editor: Editor, dir: -1 | 1): boolean {
  const tr = moveSelectedImageTr(editor.state, dir);
  if (!tr) return false;
  editor.view.dispatch(tr);
  return true;
}
