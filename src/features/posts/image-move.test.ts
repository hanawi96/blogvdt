import { getSchema } from '@tiptap/core';
import { EditorState, NodeSelection } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { postExtensions } from './extensions';
import { canMoveSelectedImage, moveSelectedImageTr } from './image-move';

const schema = getSchema(postExtensions());

function stateWithImageBetween() {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [schema.text('A')]),
    schema.node('image', { src: '/media/x.webp', alt: '', caption: 'chú thích' }),
    schema.node('paragraph', null, [schema.text('B')]),
  ]);
  let imagePos = -1;
  doc.descendants((node, pos) => {
    if (node.type.name === 'image') {
      imagePos = pos;
      return false;
    }
  });
  return EditorState.create({
    schema,
    doc,
    selection: NodeSelection.create(doc, imagePos),
  });
}

describe('moveSelectedImage', () => {
  it('đưa ảnh lên trên đoạn trước và xuống dưới đoạn sau, giữ caption', () => {
    let state = stateWithImageBetween();
    expect(canMoveSelectedImage(state, -1)).toBe(true);
    expect(canMoveSelectedImage(state, 1)).toBe(true);

    const up = moveSelectedImageTr(state, -1);
    expect(up).not.toBeNull();
    state = state.apply(up!);
    expect(state.doc.child(0).type.name).toBe('image');
    expect(state.doc.child(0).attrs.caption).toBe('chú thích');
    expect(state.selection instanceof NodeSelection).toBe(true);

    const down = moveSelectedImageTr(state, 1);
    expect(down).not.toBeNull();
    state = state.apply(down!);
    expect(state.doc.child(1).type.name).toBe('image');
    expect(state.doc.child(1).attrs.caption).toBe('chú thích');
  });

  it('không cho lên khi ảnh đã ở đầu doc', () => {
    const doc = schema.node('doc', null, [
      schema.node('image', { src: '/media/x.webp', alt: '' }),
      schema.node('paragraph', null, [schema.text('A')]),
    ]);
    let imagePos = -1;
    doc.descendants((node, pos) => {
      if (node.type.name === 'image') {
        imagePos = pos;
        return false;
      }
    });
    const state = EditorState.create({
      schema,
      doc,
      selection: NodeSelection.create(doc, imagePos),
    });
    expect(canMoveSelectedImage(state, -1)).toBe(false);
    expect(moveSelectedImageTr(state, -1)).toBeNull();
    expect(canMoveSelectedImage(state, 1)).toBe(true);
  });
});
