import { describe, expect, it } from 'vitest';
import { normalizeCommentBody, normalizeCommentName, replyMentionPrefix, validateGuestComment } from './parse';

describe('product comment parse', () => {
  it('normalizes name and body', () => {
    expect(normalizeCommentName('  Hương   Lan  ')).toBe('Hương Lan');
    expect(normalizeCommentBody('  xin chào\r\nthế  ')).toBe('xin chào\nthế');
  });

  it('builds reply mention prefix', () => {
    expect(replyMentionPrefix('Hương')).toBe('@Hương ');
  });

  it('validates guest fields', () => {
    expect(validateGuestComment({ authorName: 'A', body: 'ok' }).ok).toBe(false);
    expect(validateGuestComment({ authorName: 'An', body: 'x' }).ok).toBe(false);
    const ok = validateGuestComment({ authorName: 'An', body: 'Đẹp quá' });
    expect(ok).toEqual({ ok: true, authorName: 'An', body: 'Đẹp quá' });
  });
});
