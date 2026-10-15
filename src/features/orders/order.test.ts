import { describe, expect, it } from 'vitest';
import { canTransitionOrder, isOrderStatus, orderCounts, ORDER_STATUSES } from './status';
import {
  formatOrderCode,
  isRecentDuplicate,
  isUniqueViolation,
  normalizePhone,
  orderCreatedRange,
  orderDayKey,
  orderHandoffText,
  parseOrderSubmission,
  type CatalogProduct,
} from './order';

const catalog: CatalogProduct[] = [
  { id: 1, slug: 'vong-to-tam-tron', name: 'Vòng tơ tằm trơn', price: 150000, options: ['Size nhỏ', 'Size vừa'] },
  { id: 4, slug: 'khong-co-size', name: 'Vòng không size', price: 100000, options: [] },
];

const valid = {
  customerName: 'Lê Minh An',
  phone: '0901 000 099',
  address: '12 đường Mẫu, Quận 1',
  note: '',
  productSlug: 'vong-to-tam-tron',
  quantity: '2',
  option: 'Size vừa',
  company: '',
};

describe('đơn hàng', () => {
  it('chỉ nhận sáu trạng thái đã định', () => {
    expect(ORDER_STATUSES).toEqual(['new', 'confirmed', 'preparing', 'shipped', 'completed', 'cancelled']);
    expect(isOrderStatus('pending')).toBe(false);
  });

  it('chuẩn hóa số điện thoại và lập mã theo ngày Việt Nam', () => {
    expect(normalizePhone('+84 901 000 099')).toBe('0901000099');
    expect(normalizePhone('123')).toBeNull();
    expect(orderDayKey(Date.UTC(2026, 9, 13, 17, 0, 0))).toBe('20261014');
    expect(formatOrderCode('20261014', 42)).toBe('VD20261014-0042');
  });

  it('tính tổng tiền khi đơn hợp lệ', () => {
    const parsed = parseOrderSubmission(valid, catalog);
    expect(parsed.ok && parsed.draft.totalPrice).toBe(300000);
    expect(parsed.ok && parsed.draft.phone).toBe('0901000099');
  });

  it('báo từng trường khi thiếu số điện thoại hoặc số lượng sai', () => {
    const parsed = parseOrderSubmission({ ...valid, phone: '', quantity: '0', option: 'Size lạ' }, catalog);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.phone).toBeTruthy();
      expect(parsed.errors.quantity).toBeTruthy();
      expect(parsed.errors.option).toBeTruthy();
    }
  });

  it('chặn ô ẩn và đơn trùng trong 10 phút', () => {
    const blocked = parseOrderSubmission({ ...valid, company: 'bot' }, catalog);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.blocked).toBe(true);
    const now = 1_000_000;
    expect(isRecentDuplicate(now - 9 * 60 * 1000, now)).toBe(true);
    expect(isRecentDuplicate(now - 10 * 60 * 1000, now)).toBe(false);
  });

  it('chỉ cho chuyển trạng thái theo thứ tự xử lý hoặc hủy', () => {
    expect(canTransitionOrder('new', 'confirmed')).toBe(true);
    expect(canTransitionOrder('new', 'completed')).toBe(false);
    expect(canTransitionOrder('shipped', 'completed')).toBe(true);
    expect(canTransitionOrder('completed', 'cancelled')).toBe(false);
    expect(canTransitionOrder('cancelled', 'new')).toBe(false);
    expect(orderCounts([{ status: 'new', value: 2 }, { status: 'preparing', value: 1 }, { status: 'completed', value: 3 }])).toEqual({
      all: 6,
      incoming: 2,
      processing: 1,
      completed: 3,
    });
  });

  it('lọc ngày theo lịch Việt Nam và sao chép giá lúc đặt', () => {
    expect(orderCreatedRange('2026-10-14', '2026-10-14')).toEqual({
      start: Date.parse('2026-10-14T00:00:00+07:00'),
      end: Date.parse('2026-10-15T00:00:00+07:00'),
      invalid: false,
    });
    expect(orderCreatedRange('2026-10-15', '2026-10-14').invalid).toBe(true);
    const text = orderHandoffText({
      code: 'VD20261014-0001',
      customerName: 'Lê Minh An',
      phone: '0901000099',
      address: '12 đường Mẫu',
      productName: 'Vòng tơ tằm trơn',
      optionLabel: 'Size vừa',
      quantity: 2,
      unitPrice: 150000,
      totalPrice: 300000,
      note: null,
      internalNote: 'Giao buổi chiều',
    });
    expect(text).toContain('Đơn giá: 150.000');
    expect(text).toContain('Ghi chú nội bộ: Giao buổi chiều');
    expect(text).not.toContain('Đã thanh toán');
  });

  it('nhận ra mã đơn trùng khi lỗi D1 bị Drizzle bọc lại', () => {
    const d1Error = new Error('D1_ERROR: UNIQUE constraint failed: orders.code: SQLITE_CONSTRAINT');
    const wrapped = new Error('Failed query: insert into "orders" ...', { cause: d1Error });
    expect(isUniqueViolation(wrapped)).toBe(true);
    expect(isUniqueViolation(new Error('Failed query', { cause: new Error('no such table: orders') }))).toBe(false);
    expect(isUniqueViolation('UNIQUE constraint failed')).toBe(false);
  });
});
