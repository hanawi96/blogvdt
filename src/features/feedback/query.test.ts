import { describe, expect, it } from 'vitest';
import { FEEDBACK_PAGE_SIZE, FEEDBACK_PIN_MAX, feedbackPath, readFeedbackPage } from './query';

describe('feedback query', () => {
  it('đọc page an toàn', () => {
    expect(readFeedbackPage(null)).toBe(1);
    expect(readFeedbackPage('3')).toBe(3);
    expect(readFeedbackPage('0')).toBe(1);
    expect(readFeedbackPage('abc')).toBe(1);
  });

  it('đường dẫn phân trang', () => {
    expect(feedbackPath(1)).toBe('/feedback-mua-hang');
    expect(feedbackPath(2)).toBe('/feedback-mua-hang?page=2');
  });

  it('giữ page size và giới hạn ghim ổn định', () => {
    expect(FEEDBACK_PAGE_SIZE).toBe(12);
    expect(FEEDBACK_PIN_MAX).toBe(9);
  });
});
