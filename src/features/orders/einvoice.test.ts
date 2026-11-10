import { describe, expect, it } from 'vitest';
import {
  EINVOICE_HEADERS,
  EINVOICE_SHEET_NAME,
  buildEinvoiceWorkbookBytes,
  einvoiceExportFilename,
  einvoiceExportObjectKey,
  einvoicePaymentMethod,
  formatEinvoiceDate,
  formatEinvoiceProductName,
  mapOrdersToEinvoiceRows,
} from './einvoice-export';
import {
  INVOICE_WAIT_DAYS,
  invoiceCalendarDaysSinceShipped,
  invoiceDaysRemaining,
  invoiceEligibleBeforeMs,
  isInvoiceDateEligible,
  parseInvoiceTab,
  type InvoiceExportOrder,
} from './einvoice';

function sample(partial: Partial<InvoiceExportOrder> & Pick<InvoiceExportOrder, 'id' | 'code'>): InvoiceExportOrder {
  return {
    customerName: 'Minh Ngọc',
    address: 'Xóm Chám, Xã Tân Yên, Tỉnh Bắc Ninh',
    paymentMethod: 'cod',
    productId: 34,
    productName: '7 hổ phách vàng cam',
    optionLabel: '15kg',
    unitPrice: 159000,
    quantity: 1,
    lines: [],
    ...partial,
  };
}

describe('invoice wait days', () => {
  // 06/11/2026 12:00 VN = 2026-11-06T05:00:00.000Z
  const shipped = Date.parse('2026-11-06T05:00:00.000Z');

  it('còn đủ 10 ngày khi mới gửi', () => {
    const now = Date.parse('2026-11-06T10:00:00.000Z');
    expect(invoiceCalendarDaysSinceShipped(shipped, now)).toBe(0);
    expect(invoiceDaysRemaining(shipped, now)).toBe(INVOICE_WAIT_DAYS);
    expect(isInvoiceDateEligible(shipped, now)).toBe(false);
  });

  it('còn 2 ngày khi đã gửi 8 ngày lịch', () => {
    const now = Date.parse('2026-11-14T05:00:00.000Z');
    expect(invoiceCalendarDaysSinceShipped(shipped, now)).toBe(8);
    expect(invoiceDaysRemaining(shipped, now)).toBe(2);
    expect(isInvoiceDateEligible(shipped, now)).toBe(false);
  });

  it('đủ điều kiện đúng ngày thứ 10', () => {
    const now = Date.parse('2026-11-16T05:00:00.000Z');
    expect(invoiceCalendarDaysSinceShipped(shipped, now)).toBe(10);
    expect(invoiceDaysRemaining(shipped, now)).toBe(0);
    expect(isInvoiceDateEligible(shipped, now)).toBe(true);
    expect(shipped < invoiceEligibleBeforeMs(now)).toBe(true);
  });

  it('parse tab mặc định ready', () => {
    expect(parseInvoiceTab(null)).toBe('ready');
    expect(parseInvoiceTab('waiting')).toBe('waiting');
    expect(parseInvoiceTab('x')).toBe('ready');
  });
});

describe('einvoice export map', () => {
  it('map PTTT TM/CK', () => {
    expect(einvoicePaymentMethod('cod')).toBe('TM');
    expect(einvoicePaymentMethod('bank')).toBe('CK');
  });

  it('tên SP kèm option', () => {
    expect(formatEinvoiceProductName('Vòng trơn', '12kg')).toBe('Vòng trơn (12kg)');
    expect(formatEinvoiceProductName('Vòng trơn', null)).toBe('Vòng trơn');
  });

  it('nhiều SP cùng MaHD; đơn khác tăng MaHD', () => {
    const now = Date.parse('2026-11-16T05:00:00.000Z');
    const mapped = mapOrdersToEinvoiceRows(
      [
        sample({
          id: 1,
          code: 'DH1',
          lines: [
            {
              productId: 34,
              productName: '7 hổ phách vàng cam',
              optionLabel: '15kg',
              unitPrice: 159000,
              quantity: 1,
              lineTotal: 159000,
            },
            {
              productId: 55,
              productName: 'Vòng trơn cổ điển dây đỏ',
              optionLabel: '12kg',
              unitPrice: 59000,
              quantity: 1,
              lineTotal: 59000,
            },
          ],
        }),
        sample({
          id: 2,
          code: 'DH2',
          paymentMethod: 'bank',
          productId: 134,
          productName: 'Bó dâu 9 CÀNH',
          optionLabel: null,
          unitPrice: 39000,
          quantity: 1,
          lines: [],
        }),
      ],
      now,
    );

    expect(mapped.orderCount).toBe(2);
    expect(mapped.rows).toHaveLength(3);

    const maHdIdx = EINVOICE_HEADERS.indexOf('MaHD');
    const nameIdx = EINVOICE_HEADERS.indexOf('TenHangHoa');
    const payIdx = EINVOICE_HEADERS.indexOf('PhuongThucTT');
    const dateIdx = EINVOICE_HEADERS.indexOf('NgayHoaDon');

    expect(mapped.rows[0]![maHdIdx]).toBe(1);
    expect(mapped.rows[1]![maHdIdx]).toBe(1);
    expect(mapped.rows[2]![maHdIdx]).toBe(2);
    expect(mapped.rows[0]![nameIdx]).toBe('7 hổ phách vàng cam (15kg)');
    expect(mapped.rows[1]![nameIdx]).toBe('Vòng trơn cổ điển dây đỏ (12kg)');
    expect(mapped.rows[0]![payIdx]).toBe('TM');
    expect(mapped.rows[2]![payIdx]).toBe('CK');
    expect(mapped.rows[0]![dateIdx]).toBe(formatEinvoiceDate(now));
  });

  it('filename và workbook có sheet Hóa đơn', () => {
    const now = Date.parse('2026-11-16T05:00:00.000Z');
    expect(einvoiceExportFilename(21, now)).toBe('HoaDonDienTu_20261116_21don.xlsx');
    expect(einvoiceExportObjectKey('HoaDonDienTu_20261116_21don.xlsx', new Date(now))).toMatch(
      /^exports\/einvoice\/2026\/11\/.+HoaDonDienTu_20261116_21don\.xlsx$/,
    );
    const { rows } = mapOrdersToEinvoiceRows([sample({ id: 1, code: 'DH1' })], now);
    const bytes = buildEinvoiceWorkbookBytes(rows);
    expect(bytes.byteLength).toBeGreaterThan(100);
    expect(EINVOICE_SHEET_NAME).toBe('Hóa đơn');
  });
});
