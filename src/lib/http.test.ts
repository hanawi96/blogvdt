import { describe, expect, it } from 'vitest';
import { hashIp, isSafeRedirect } from './http';

describe('đường dẫn redirect', () => {
  it('chỉ nhận đường dẫn nội bộ', () => {
    expect(isSafeRedirect('/kien-thuc/bai-moi')).toBe(true);
    expect(isSafeRedirect('/san-pham/vong-moi')).toBe(true);
    expect(isSafeRedirect('https://example.com')).toBe(false);
    expect(isSafeRedirect('//example.com')).toBe(false);
    expect(isSafeRedirect('/kien-thuc/../admin')).toBe(false);
  });
});

describe('băm IP', () => {
  it('không giữ IP gốc', async () => {
    const hashed = await hashIp('203.0.113.7');
    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
    expect(hashed).not.toContain('203.0.113.7');
  });
});
