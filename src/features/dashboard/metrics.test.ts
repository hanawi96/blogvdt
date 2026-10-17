import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  averageValue,
  buildActionItems,
  cancelRate,
  describeDelta,
  mergeTopProducts,
  percentChange,
  periodRange,
  readPeriod,
  timeAgo,
  type ActionInput,
} from './metrics';

const quiet: ActionInput = {
  admin: true,
  newOrders: 0,
  agedNewOrders: 0,
  processingOrders: 0,
  productsNoCover: 0,
  productsNoCategory: 0,
  drafts: 0,
  oldDrafts: 0,
  publishedPosts: 0,
  seo: { state: 'none', errors: 0 },
};

describe('kỳ thống kê', () => {
  it('chỉ nhận 7, 30, 90 ngày và mặc định 30', () => {
    expect(readPeriod('7')).toBe(7);
    expect(readPeriod('90')).toBe(90);
    expect(readPeriod('15')).toBe(30);
    expect(readPeriod(null)).toBe(30);
    expect(readPeriod('abc')).toBe(30);
  });

  it('kỳ trước liền kề và cùng độ dài kỳ hiện tại', () => {
    const now = 1_000 * DAY_MS;
    expect(periodRange(30, now)).toEqual({ start: now - 30 * DAY_MS, previousStart: now - 60 * DAY_MS });
  });
});

describe('chỉ số', () => {
  it('tính % thay đổi, kể cả khi kỳ trước bằng 0', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(0, 0)).toBe(0);
    expect(percentChange(5, 0)).toBeNull();
  });

  it('trung bình và tỉ lệ hủy không chia cho 0', () => {
    expect(averageValue(300000, 2)).toBe(150000);
    expect(averageValue(0, 0)).toBe(0);
    expect(cancelRate(1, 3)).toBe(25);
    expect(cancelRate(0, 0)).toBe(0);
  });

  it('mô tả thay đổi và đảo màu cho chỉ số tăng là xấu', () => {
    expect(describeDelta(20)).toEqual({ text: '+20% so với kỳ trước', tone: 'good' });
    expect(describeDelta(-10)).toEqual({ text: '−10% so với kỳ trước', tone: 'bad' });
    expect(describeDelta(20, true).tone).toBe('bad');
    expect(describeDelta(0).tone).toBe('flat');
    expect(describeDelta(null).tone).toBe('flat');
  });

  it('hiện thời gian tương đối và để trống khi quá 30 ngày', () => {
    const now = 100 * DAY_MS;
    expect(timeAgo(now - 30_000, now)).toBe('Vừa xong');
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5 phút trước');
    expect(timeAgo(now - 3 * 60 * 60_000, now)).toBe('3 giờ trước');
    expect(timeAgo(now - 2 * DAY_MS, now)).toBe('2 ngày trước');
    expect(timeAgo(now - 45 * DAY_MS, now)).toBe('');
  });
});

describe('việc cần xử lý', () => {
  it('không có việc thì danh sách rỗng', () => {
    expect(buildActionItems(quiet)).toEqual([]);
  });

  it('đơn mới quá hạn thì cảnh báo và dẫn tới đúng bộ lọc', () => {
    const [item] = buildActionItems({ ...quiet, newOrders: 3, agedNewOrders: 1 });
    expect(item?.tone).toBe('warn');
    expect(item?.count).toBe(3);
    expect(item?.detail).toContain('1 đơn');
    expect(item?.href).toBe('/admin/orders?status=new');
    expect(buildActionItems({ ...quiet, newOrders: 2 })[0]?.tone).toBe('info');
  });

  it('tài khoản biên tập chỉ thấy việc về bài viết', () => {
    const items = buildActionItems({ ...quiet, admin: false, newOrders: 5, productsNoCover: 2, drafts: 4, oldDrafts: 1 });
    expect(items.map((item) => item.key)).toEqual(['drafts']);
    expect(items[0]?.href).toBe('/admin/posts?status=draft');
  });

  it('SEO: báo lỗi khi đã kiểm tra, nhắc chạy kiểm tra khi chưa có kết quả', () => {
    expect(buildActionItems({ ...quiet, seo: { state: 'checked', errors: 2 } })[0]?.key).toBe('seo-errors');
    expect(buildActionItems({ ...quiet, seo: { state: 'checked', errors: 0 } })).toEqual([]);
    expect(buildActionItems({ ...quiet, publishedPosts: 3 })[0]?.key).toBe('seo-unchecked');
    expect(buildActionItems(quiet)).toEqual([]);
  });

  it('cảnh báo sản phẩm thiếu ảnh và thiếu danh mục', () => {
    const keys = buildActionItems({ ...quiet, productsNoCover: 1, productsNoCategory: 2 }).map((item) => item.key);
    expect(keys).toEqual(['products-no-cover', 'products-no-category']);
  });
});

describe('top sản phẩm', () => {
  it('gộp đơn một mẫu và nhiều mẫu, bỏ sản phẩm đã xóa, hòa thì id nhỏ trước', () => {
    const top = mergeTopProducts(
      [
        [
          { productId: 1, sold: 2 },
          { productId: 2, sold: 5 },
          { productId: null, sold: 9 },
        ],
        [
          { productId: 1, sold: 4 },
          { productId: 3, sold: 6 },
          { productId: 4, sold: 0 },
        ],
      ],
      3,
    );
    expect(top).toEqual([
      { productId: 1, sold: 6 },
      { productId: 3, sold: 6 },
      { productId: 2, sold: 5 },
    ]);
  });
});
