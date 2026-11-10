import * as XLSX from 'xlsx';
import type { AddressSelectRow } from '../address/parse';
import { matchComposedAddress } from '../address/parse';
import { remainingAfterDeposit } from './staff';
import { vnTodayParts } from '../../lib/datetime';
import { formatShipLabel, isShipLaterFuture } from './staff';

export const SPX_SHEET_NAME = 'Tạo đơn (địa chỉ mới)';

export const SPX_HEADERS = [
  '*Mã đơn hàng',
  '*Tên người nhận',
  '*Số điện thoại',
  '*Tỉnh/Thành Phố',
  '*Xã/Phường',
  '*Địa chỉ chi tiết',
  'Lưu ý về địa chỉ',
  'Mã bưu chính',
  '*Tên sản phẩm',
  'Số lượng (Thông tin bắt buộc khi chọn Giao hàng một phần & Thu COD)',
  'Giá tiền (Thông tin bắt buộc khi chọn Giao hàng một phần & Thu COD)',
  '*Tổng cân nặng bưu gửi (KG)',
  'Chiều dài (CM)',
  'Chiều rộng (CM)',
  'Chiều cao (CM)',
  'Mã khách hàng',
  '*Giá trị đơn hàng',
  '*Giao hàng một phần (Y/N)',
  '*Cho phép thử hàng (Y/N)',
  '*Cho xem hàng, không cho thử (Y/N)',
  'Thu phí từ chối nhận hàng (Y/N)',
  'Phí từ chối nhận hàng cần thu',
  '*Thu COD (Y/N)',
  'Số tiền COD',
  'bưu gửi giá trị cao (Y/N)',
  '*Hình thức thanh Toán',
  'Lưu ý giao hàng',
  'Nhắc nhở điền đúng số tiền COD',
  'Đơn chỉ hoàn thành nếu ở dưới hiện "Đủ điều kiện"',
] as const;

const DEFAULT_WEIGHT_KG = 0.5;
const DEFAULT_LENGTH_CM = 15;
const DEFAULT_WIDTH_CM = 10;
const DEFAULT_HEIGHT_CM = 5;

export type SpxExportLine = {
  productName: string;
  quantity: number;
  optionLabel: string | null;
};

export type SpxExportOrder = {
  id: number;
  code: string;
  customerName: string;
  phone: string;
  address: string;
  status: string;
  fulfillStatus: string | null;
  shipOn: number | null;
  totalPrice: number;
  payState: string | null;
  depositAmount: number;
  compensation: number;
  productName: string;
  quantity: number;
  optionLabel: string | null;
  lines: SpxExportLine[];
};

export type SpxCod = { collect: 'Y' | 'N'; amount: number };

/** COD: cọc → còn lại; đã CK / gửi bù → 0; còn lại thu đủ total. */
export function spxCodForOrder(order: {
  totalPrice: number;
  payState: string | null;
  depositAmount: number;
  compensation: number;
}): SpxCod {
  if (order.compensation === 1 || order.payState === 'paid') return { collect: 'N', amount: 0 };
  if (order.payState === 'deposit') {
    const amount = remainingAfterDeposit(order.totalPrice, order.depositAmount);
    return amount > 0 ? { collect: 'Y', amount } : { collect: 'N', amount: 0 };
  }
  return { collect: 'Y', amount: Math.max(0, order.totalPrice) };
}

export function resolveSpxAddress(
  rows: readonly AddressSelectRow[],
  composed: string,
): { provinceName: string; wardName: string; line: string } | null {
  const matched = matchComposedAddress(rows, composed);
  if (!matched) return null;
  for (const [provinceCode, provinceName, wards] of rows) {
    if (provinceCode !== matched.provinceCode) continue;
    for (const [wardCode, wardName] of wards) {
      if (wardCode !== matched.wardCode) continue;
      return { provinceName, wardName, line: matched.line };
    }
  }
  return null;
}

export function formatSpxProductName(
  order: Pick<SpxExportOrder, 'productName' | 'quantity' | 'optionLabel' | 'lines' | 'fulfillStatus'>,
): string {
  const lines =
    order.lines.length > 0
      ? order.lines
      : [{ productName: order.productName, quantity: order.quantity, optionLabel: order.optionLabel }];
  const parts = lines.map((line) => {
    const size = line.optionLabel ? ` -- Size: ${line.optionLabel}` : '';
    return `[${line.productName}${size} - Số lượng: ${line.quantity}]`;
  });
  const brand = '[VÒNG DÂU TẰM]';
  const prefix = order.fulfillStatus === 'reship' ? `[HÀNG GỬI LẠI]${brand}` : brand;
  return `${prefix} - ${parts.join(' ----- ')}`;
}

export type SpxMappedRow = {
  orderId: number;
  cells: (string | number)[];
};

export type SpxMapResult = {
  rows: SpxMappedRow[];
  skipped: { orderId: number; code: string; reason: string }[];
};

export function mapOrdersToSpxRows(
  orders: SpxExportOrder[],
  addressRows: readonly AddressSelectRow[],
  now = Date.now(),
): SpxMapResult {
  const rows: SpxMappedRow[] = [];
  const skipped: SpxMapResult['skipped'] = [];
  for (const order of orders) {
    if (order.status === 'completed' || order.status === 'cancelled') {
      skipped.push({ orderId: order.id, code: order.code, reason: 'Đơn đã kết thúc.' });
      continue;
    }
    if (isShipLaterFuture(order.shipOn, now)) {
      const day = order.shipOn != null ? formatShipLabel(order.shipOn) : '';
      skipped.push({
        orderId: order.id,
        code: order.code,
        reason: day ? `Chưa đến ngày gửi sau (${day}).` : 'Chưa đến ngày gửi sau.',
      });
      continue;
    }
    const address = resolveSpxAddress(addressRows, order.address);
    if (!address) {
      skipped.push({ orderId: order.id, code: order.code, reason: 'Địa chỉ không khớp tỉnh/xã.' });
      continue;
    }
    const cod = spxCodForOrder(order);
    rows.push({
      orderId: order.id,
      cells: [
        order.code,
        order.customerName,
        order.phone,
        address.provinceName,
        address.wardName,
        address.line,
        '',
        '',
        formatSpxProductName(order),
        '',
        '',
        DEFAULT_WEIGHT_KG,
        DEFAULT_LENGTH_CM,
        DEFAULT_WIDTH_CM,
        DEFAULT_HEIGHT_CM,
        '',
        order.totalPrice,
        'N',
        'Y',
        'Y',
        '',
        '',
        cod.collect,
        cod.collect === 'Y' ? cod.amount : '',
        '',
        'Người gửi trả',
        '',
        '',
        '',
      ],
    });
  }
  return { rows, skipped };
}

export function buildSpxWorkbookBytes(mappedRows: SpxMappedRow[]): Uint8Array {
  const aoa: (string | number)[][] = [Array.from(SPX_HEADERS), ...mappedRows.map((row) => row.cells)];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, SPX_SHEET_NAME);
  const raw = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as number[];
  return new Uint8Array(raw);
}

export function spxExportFilename(orderCount: number, now = Date.now()): string {
  const today = vnTodayParts(now);
  const ymd = `${today.year}${String(today.month).padStart(2, '0')}${String(today.day).padStart(2, '0')}`;
  return `SPX_DonHang_${ymd}_${orderCount}don.xlsx`;
}

export function spxExportObjectKey(filename: string, now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `exports/spx/${year}/${month}/${crypto.randomUUID()}-${filename}`;
}
