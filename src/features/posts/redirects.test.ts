import { describe, expect, it } from 'vitest';
import { categorySlug, knowledgeSlug, publicRedirectTarget, shouldStorePostRedirect } from './redirects';

describe('redirect bài viết', () => {
  it('chỉ lưu redirect khi slug đổi và URL cũ từng hoặc đang public', () => {
    expect(shouldStorePostRedirect({ status: 'published', publishedAt: 1, slug: 'a' }, 'b')).toBe(true);
    expect(shouldStorePostRedirect({ status: 'draft', publishedAt: 1, slug: 'a' }, 'b')).toBe(true);
    expect(shouldStorePostRedirect({ status: 'draft', publishedAt: null, slug: 'a' }, 'b')).toBe(false);
    expect(shouldStorePostRedirect({ status: 'published', publishedAt: 1, slug: 'a' }, 'a')).toBe(false);
  });

  it('không 301 sang bản nháp hoặc về chính đường hiện tại', () => {
    expect(publicRedirectTarget('/kien-thuc/bai-moi', '/kien-thuc/bai-cu', true)).toBe('/kien-thuc/bai-moi');
    expect(publicRedirectTarget('/kien-thuc/bai-moi', '/kien-thuc/bai-cu', false)).toBeNull();
    expect(publicRedirectTarget('/kien-thuc/bai-cu', '/kien-thuc/bai-cu', true)).toBeNull();
    expect(publicRedirectTarget('https://example.com', '/kien-thuc/bai-cu', true)).toBeNull();
    expect(knowledgeSlug('/kien-thuc/bai-moi')).toBe('bai-moi');
    expect(knowledgeSlug('/kien-thuc/../admin')).toBeNull();
    expect(knowledgeSlug('/kien-thuc/danh-muc/chon-vong')).toBeNull();
    expect(categorySlug('/kien-thuc/danh-muc/chon-vong')).toBe('chon-vong');
    expect(categorySlug('/kien-thuc/bai-moi')).toBeNull();
  });
});
