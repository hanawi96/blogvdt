import { describe, expect, it } from 'vitest';
import {
  collectPostCardIds,
  normalizePostCardIds,
  orderedPostCards,
  renderPostCardsHtml,
  type PostCardEmbed,
} from './post-cards';

const sample = (id: number, title: string): PostCardEmbed => ({
  id,
  title,
  slug: `bai-${id}`,
  excerpt: '',
  categoryName: 'Góc chia sẻ',
  coverUrl: null,
  coverAlt: '',
  coverWidth: null,
  coverHeight: null,
});

describe('hộp bài liên quan', () => {
  it('chuẩn hóa id: unique, dương, tối đa 3', () => {
    expect(normalizePostCardIds([1, '2', 2, 0, -1, 3, 4, 'x'])).toEqual([1, 2, 3]);
  });

  it('gom id từ contentJson', () => {
    expect(
      collectPostCardIds({
        type: 'doc',
        content: [
          { type: 'paragraph' },
          { type: 'postCards', attrs: { ids: [7, 8, 7] } },
          { type: 'postCards', attrs: { ids: [9] } },
        ],
      }),
    ).toEqual([7, 8, 9]);
  });

  it('giữ thứ tự chọn và bỏ bài không còn public', () => {
    const byId = new Map([
      [2, sample(2, 'Hai')],
      [1, sample(1, 'Một')],
    ]);
    expect(orderedPostCards([1, 9, 2], byId).map((item) => item.id)).toEqual([1, 2]);
  });

  it('render HTML an toàn và có label mẹ bỉm', () => {
    const html = renderPostCardsHtml([sample(1, 'Cách chọn vòng <x>')]);
    expect(html).toContain('class="post-cards"');
    expect(html).toContain('Đọc tiếp cho mẹ');
    expect(html).toContain('href="/kien-thuc/bai-1"');
    expect(html).toContain('Cách chọn vòng &lt;x&gt;');
    expect(html).not.toContain('<x>');
  });
});
