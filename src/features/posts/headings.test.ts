import { describe, expect, it } from 'vitest';
import { collectHeadings } from './headings';

describe('mục lục bài viết', () => {
  it('lấy H2 và H3, tạo id không trùng', () => {
    const headings = collectHeadings({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Cách nhìn tơ' }] },
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Màu chỉ' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Cách nhìn tơ' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Không phải heading' }] },
      ],
    });
    expect(headings).toEqual([
      { id: 'cach-nhin-to', text: 'Cách nhìn tơ', level: 2 },
      { id: 'mau-chi', text: 'Màu chỉ', level: 3 },
      { id: 'cach-nhin-to-2', text: 'Cách nhìn tơ', level: 2 },
    ]);
  });
});
