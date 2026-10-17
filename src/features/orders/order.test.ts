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
  parseCartOrder,
  parseOrderSubmission,
  type CatalogProduct,
} from './order';

const catalog: CatalogProduct[] = [
  { id: 1, slug: 'vong-to-tam-tron', name: 'Vòng tơ tằm trơn', price: 150000, weightScale: 'none' },
  { id: 4, slug: 'khong-co-size', name: 'Vòng không size', price: 100000, weightScale: 'none' },
  { id: 7, slug: 'vong-cho-be', name: 'Vòng cho bé', price: 120000, weightScale: 'baby' },
];

const valid = {
  customerName: 'Lê Minh An',
  phone: '0901 000 099',
  address: '12 đường Mẫu, Quận 1',
  note: '',
  productSlug: 'vong-to-tam-tron',
  quantity: '2',
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

  it('đặt trực tiếp: bắt buộc cân nặng hợp lệ theo thang và lưu vào đơn', () => {
    const base = { ...valid, productSlug: 'vong-cho-be' };
    const missing = parseOrderSubmission(base, catalog);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.weight).toBeTruthy();
    expect(parseOrderSubmission({ ...base, weight: '99kg' }, catalog).ok).toBe(false);
    const good = parseOrderSubmission({ ...base, weight: '5kg' }, catalog);
    expect(good.ok && good.draft.optionLabel).toBe('5kg');
    const stray = parseOrderSubmission({ ...valid, weight: '5kg' }, catalog);
    expect(stray.ok).toBe(false);
  });

  it('hình thức thanh toán: mặc định khi nhận hàng, nhận chuyển khoản, từ chối giá trị lạ', () => {
    const none = parseOrderSubmission(valid, catalog);
    expect(none.ok && none.draft.paymentMethod).toBe('cod');
    const bank = parseOrderSubmission({ ...valid, paymentMethod: 'bank' }, catalog);
    expect(bank.ok && bank.draft.paymentMethod).toBe('bank');
    const bad = parseOrderSubmission({ ...valid, paymentMethod: 'the-tin-dung' }, catalog);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.paymentMethod).toBeTruthy();
    const text = orderHandoffText({
      code: 'VD20261014-0003',
      customerName: 'Lê Minh An',
      phone: '0901000099',
      address: '12 đường Mẫu',
      productName: 'Vòng tơ tằm trơn',
      optionLabel: null,
      quantity: 1,
      unitPrice: 150000,
      totalPrice: 150000,
      note: null,
      internalNote: null,
      paymentMethod: 'bank',
    });
    expect(text).toContain('Thanh toán: Chuyển khoản ngân hàng');
  });

  it('báo từng trường khi thiếu số điện thoại hoặc số lượng sai', () => {
    const parsed = parseOrderSubmission({ ...valid, phone: '', quantity: '0' }, catalog);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.phone).toBeTruthy();
      expect(parsed.errors.quantity).toBeTruthy();
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
    const many = orderHandoffText({
      code: 'VD20261014-0002',
      customerName: 'Lê Minh An',
      phone: '0901000099',
      address: '12 đường Mẫu',
      productName: 'Vòng tơ tằm trơn + 1 mẫu',
      optionLabel: null,
      quantity: 3,
      unitPrice: 0,
      totalPrice: 480000,
      note: null,
      internalNote: null,
      items: [
        { productName: 'Vòng tơ tằm trơn', optionLabel: 'Size vừa', quantity: 2, lineTotal: 300000 },
        { productName: 'Vòng không size', optionLabel: null, quantity: 1, lineTotal: 180000 },
      ],
    });
    expect(many).toContain('- Vòng tơ tằm trơn (Size vừa) × 2');
    expect(many).not.toContain('Đơn giá:');
  });

  it('nhận ra mã đơn trùng khi lỗi D1 bị Drizzle bọc lại', () => {
    const d1Error = new Error('D1_ERROR: UNIQUE constraint failed: orders.code: SQLITE_CONSTRAINT');
    const wrapped = new Error('Failed query: insert into "orders" ...', { cause: d1Error });
    expect(isUniqueViolation(wrapped)).toBe(true);
    expect(isUniqueViolation(new Error('Failed query', { cause: new Error('no such table: orders') }))).toBe(false);
    expect(isUniqueViolation('UNIQUE constraint failed')).toBe(false);
  });

  it('tính một đơn cho nhiều mẫu và giữ đơn một mẫu', () => {
    const parsed = parseCartOrder(
      {
        ...valid,
        lines: [
          { slug: 'vong-to-tam-tron', quantity: 2, weight: '' },
          { slug: 'khong-co-size', quantity: 1, weight: '' },
        ],
      },
      catalog,
    );
    expect(parsed.ok && parsed.cart?.totalPrice).toBe(400000);
    expect(parsed.ok && parsed.cart?.productName).toBe('Vòng tơ tằm trơn, Vòng không size');
    expect(parsed.ok && parsed.single).toBeNull();
    const single = parseCartOrder({ ...valid, lines: [{ slug: 'khong-co-size', quantity: 1, weight: '' }] }, catalog);
    expect(single.ok && single.single?.totalPrice).toBe(100000);
    expect(single.ok && single.cart).toBeNull();
  });

  it('giỏ hàng: lưu hình thức thanh toán cho đơn một mẫu và nhiều mẫu, từ chối giá trị lạ', () => {
    const two = [
      { slug: 'vong-to-tam-tron', quantity: 1, weight: '' },
      { slug: 'khong-co-size', quantity: 1, weight: '' },
    ];
    const bankMany = parseCartOrder({ ...valid, paymentMethod: 'bank', lines: two }, catalog);
    expect(bankMany.ok && bankMany.cart?.paymentMethod).toBe('bank');
    const bankOne = parseCartOrder({ ...valid, paymentMethod: 'bank', lines: [two[1]!] }, catalog);
    expect(bankOne.ok && bankOne.single?.paymentMethod).toBe('bank');
    const byDefault = parseCartOrder({ ...valid, lines: two }, catalog);
    expect(byDefault.ok && byDefault.cart?.paymentMethod).toBe('cod');
    const bad = parseCartOrder({ ...valid, paymentMethod: 'khac', lines: two }, catalog);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.paymentMethod).toBeTruthy();
  });

  it('bắt buộc cân nặng hợp lệ và ghép vào nhãn đơn khi danh mục cần', () => {
    const missing = parseCartOrder({ ...valid, lines: [{ slug: 'vong-cho-be', quantity: 1, weight: '' }] }, catalog);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.weight0).toBeTruthy();

    const bad = parseCartOrder({ ...valid, lines: [{ slug: 'vong-cho-be', quantity: 1, weight: '99kg' }] }, catalog);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.weight0).toBeTruthy();

    const good = parseCartOrder({ ...valid, lines: [{ slug: 'vong-cho-be', quantity: 1, weight: 'Chưa sinh' }] }, catalog);
    expect(good.ok && good.single?.optionLabel).toBe('Chưa sinh');
  });
});
