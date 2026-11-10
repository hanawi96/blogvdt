import { describe, expect, it } from 'vitest';
import type { AddressSelectRow } from '../address/parse';
import {
  formatSpxProductName,
  mapOrdersToSpxRows,
  spxCodForOrder,
  spxExportFilename,
  type SpxExportOrder,
} from './spx-export';

const addressRows: AddressSelectRow[] = [
  [
    '79',
    'Thành phố Hồ Chí Minh',
    [
      ['26734', 'Phường Cát Lái'],
      ['26737', 'Phường Thạnh Mỹ Lợi'],
    ],
  ],
  ['01', 'Thành phố Hà Nội', [['10001', 'Phường Chương Mỹ']]],
];

function sample(partial: Partial<SpxExportOrder> & Pick<SpxExportOrder, 'id' | 'code'>): SpxExportOrder {
  return {
    customerName: 'Nguyễn A',
    phone: '0901000000',
    address: '910/10 nguyễn thị định, Phường Cát Lái, Thành phố Hồ Chí Minh',
    status: 'confirmed',
    fulfillStatus: null,
    shipOn: null,
    totalPrice: 200000,
    payState: 'cod',
    depositAmount: 0,
    compensation: 0,
    productName: 'Trơn mix 2 bi bạc',
    quantity: 1,
    optionLabel: '3kg',
    lines: [],
    ...partial,
  };
}

describe('spxCodForOrder', () => {
  it('COD thường thu đủ total', () => {
    expect(spxCodForOrder({ totalPrice: 128000, payState: 'cod', depositAmount: 0, compensation: 0 })).toEqual({
      collect: 'Y',
      amount: 128000,
    });
  });

  it('cọc trước: Thu COD = Y, số tiền = còn lại', () => {
    expect(spxCodForOrder({ totalPrice: 550000, payState: 'deposit', depositAmount: 50000, compensation: 0 })).toEqual({
      collect: 'Y',
      amount: 500000,
    });
  });

  it('đã chuyển khoản / gửi bù không thu COD', () => {
    expect(spxCodForOrder({ totalPrice: 200000, payState: 'paid', depositAmount: 0, compensation: 0 })).toEqual({
      collect: 'N',
      amount: 0,
    });
    expect(spxCodForOrder({ totalPrice: 200000, payState: 'cod', depositAmount: 0, compensation: 1 })).toEqual({
      collect: 'N',
      amount: 0,
    });
  });
});

describe('mapOrdersToSpxRows', () => {
  it('map đơn hợp lệ và bỏ đơn địa chỉ lỗi / đã kết thúc', () => {
    const result = mapOrdersToSpxRows(
      [
        sample({ id: 1, code: 'DH1' }),
        sample({ id: 2, code: 'DH2', address: 'địa chỉ cũ không chuẩn' }),
        sample({ id: 3, code: 'DH3', status: 'cancelled' }),
        sample({
          id: 4,
          code: 'DH4',
          payState: 'deposit',
          depositAmount: 50000,
          totalPrice: 250000,
          address: 'Ngõ 3, Phường Chương Mỹ, Thành phố Hà Nội',
        }),
      ],
      addressRows,
    );
    expect(result.rows).toHaveLength(2);
    expect(result.skipped.map((item) => item.code)).toEqual(['DH2', 'DH3']);
    expect(result.rows[0]?.cells[0]).toBe('DH1');
    expect(result.rows[0]?.cells[3]).toBe('Thành phố Hồ Chí Minh');
    expect(result.rows[0]?.cells[4]).toBe('Phường Cát Lái');
    expect(result.rows[0]?.cells[5]).toBe('910/10 nguyễn thị định');
    expect(result.rows[0]?.cells[22]).toBe('Y');
    expect(result.rows[0]?.cells[23]).toBe(200000);
    expect(result.rows[1]?.cells[22]).toBe('Y');
    expect(result.rows[1]?.cells[23]).toBe(200000);
  });

  it('format tên sản phẩm nhiều dòng', () => {
    expect(
      formatSpxProductName({
        productName: 'fallback',
        quantity: 1,
        optionLabel: null,
        fulfillStatus: null,
        lines: [
          { productName: 'Trơn co giãn', quantity: 1, optionLabel: '4kg' },
          { productName: 'Vòng trơn cổ điển dây đỏ', quantity: 1, optionLabel: '4kg' },
        ],
      }),
    ).toBe(
      '[VÒNG DÂU TẰM] - [Trơn co giãn -- Size: 4kg - Số lượng: 1] ----- [Vòng trơn cổ điển dây đỏ -- Size: 4kg - Số lượng: 1]',
    );
  });

  it('đơn chờ gửi lại thêm tiền tố HÀNG GỬI LẠI', () => {
    expect(
      formatSpxProductName({
        productName: 'Trơn mix 2 bi bạc',
        quantity: 1,
        optionLabel: '3kg',
        fulfillStatus: 'reship',
        lines: [],
      }),
    ).toBe('[HÀNG GỬI LẠI][VÒNG DÂU TẰM] - [Trơn mix 2 bi bạc -- Size: 3kg - Số lượng: 1]');
  });

  it('bỏ qua đơn gửi sau còn chưa tới ngày', () => {
    const now = Date.parse('2026-11-10T12:00:00+07:00');
    const result = mapOrdersToSpxRows(
      [
        sample({ id: 1, code: 'DH1' }),
        sample({
          id: 2,
          code: 'DH2',
          shipOn: Date.parse('2026-12-23T00:00:00+07:00'),
        }),
        sample({
          id: 3,
          code: 'DH3',
          shipOn: Date.parse('2026-11-10T00:00:00+07:00'),
        }),
      ],
      addressRows,
      now,
    );
    expect(result.rows.map((row) => row.cells[0])).toEqual(['DH1', 'DH3']);
    expect(result.skipped).toEqual([
      { orderId: 2, code: 'DH2', reason: 'Chưa đến ngày gửi sau (23/12).' },
    ]);
  });

  it('spxExportFilename theo ngày VN', () => {
    expect(spxExportFilename(14, Date.parse('2026-11-09T03:00:00.000Z'))).toBe('SPX_DonHang_20261109_14don.xlsx');
  });
});
