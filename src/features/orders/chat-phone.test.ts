import { describe, expect, it } from 'vitest';
import { isChatChannel, normalizeChatId } from './chat-phone';

describe('chat-phone helpers', () => {
  it('accepts pancake and zalo channels', () => {
    expect(isChatChannel('pancake')).toBe(true);
    expect(isChatChannel('zalo')).toBe(true);
    expect(isChatChannel('facebook')).toBe(false);
  });

  it('normalizes chat id length', () => {
    expect(normalizeChatId('  abc  ')).toBe('abc');
    expect(normalizeChatId('')).toBeNull();
    expect(normalizeChatId('   ')).toBeNull();
    expect(normalizeChatId('x'.repeat(200))?.length).toBe(191);
  });
});
