import { describe, expect, it } from 'vitest';
import { META_DUPLICATE } from './messages';
import {
  isKnowledgePathBlocked,
  knowledgePathIfValid,
  lengthNote,
  metaDuplicateNote,
  resolvePostMeta,
  SEO_TITLE_RANGE,
} from './meta-rules';

describe('meta-rules dùng chung editor và health', () => {
  it('resolvePostMeta lấy SEO title/desc, fallback title/excerpt', () => {
    expect(
      resolvePostMeta({
        title: 'Tiêu đề',
        seoTitle: ' SEO ',
        excerpt: 'Tóm tắt',
        metaDescription: ' Mô tả ',
      }),
    ).toEqual({ headline: 'SEO', description: 'Mô tả' });
    expect(
      resolvePostMeta({ title: 'Tiêu đề', seoTitle: null, excerpt: 'Tóm tắt', metaDescription: '' }),
    ).toEqual({ headline: 'Tiêu đề', description: 'Tóm tắt' });
  });

  it('metaDuplicateNote dùng đúng catalog META_DUPLICATE', () => {
    expect(metaDuplicateNote('Cùng', 'Cùng')).toBe(META_DUPLICATE.titleEqualsDescription);
    expect(metaDuplicateNote('A', 'B', { titles: ['A'], descriptions: [] })).toBe(META_DUPLICATE.titleTaken);
    expect(metaDuplicateNote('A', 'B', { titles: [], descriptions: ['B'] })).toBe(META_DUPLICATE.descriptionTaken);
    expect(metaDuplicateNote('A', 'B')).toBe('');
  });

  it('knowledgePathIfValid và blocked khớp rule slug health', () => {
    expect(knowledgePathIfValid('cach-chon-vong')).toBe('/cach-chon-vong');
    expect(knowledgePathIfValid('Bad_Slug')).toBe('');
    expect(isKnowledgePathBlocked('/a', new Set(['/a']))).toBe(true);
    expect(isKnowledgePathBlocked('', new Set(['/a']))).toBe(false);
  });

  it('lengthNote giữ ngưỡng SEO title', () => {
    expect(lengthNote(10, SEO_TITLE_RANGE.min, SEO_TITLE_RANGE.max)).toContain('Hơi ngắn');
    expect(lengthNote(40, SEO_TITLE_RANGE.min, SEO_TITLE_RANGE.max)).toBe('');
  });
});
