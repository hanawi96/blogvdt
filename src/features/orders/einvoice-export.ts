import * as XLSX from 'xlsx';
import { vnTodayParts } from '../../lib/datetime';
import type { InvoiceExportOrder } from './einvoice';

export const EINVOICE_SHEET_NAME = 'Hóa đơn';

export const EINVOICE_HEADERS = [
  'MaHD',
  'FKEY',
  'NgayHoaDon',
  'MaKhachHang',
  'TenNguoiMua',
  'TenDonVi',
  'DiaChiKhachHang',
  'MaSoThue',
  'CCCD',
  'SoHoChieu',
  'MaNganSach',
  'LoaiDacTrung',
  'HoaDonChietKhau',
  'ThueSuat',
  'TienThue',
  'TGTKhac',
  'TyGia',
  'LoaiTien',
  'TienBangChu',
  'TinhChatHanghoa',
  'MaHangHoa',
  'TenHangHoa',
  'GhiChu',
  'DonViTinh',
  'SoLuong',
  'DonGia',
  'ThanhTien',
  'TienChietKhau',
  'ChietKhau',
  'EmailKhachHang',
  'MailCC',
  'PhuongThucTT',
  'SoTaiKhoan',
  'TenNganHang',
  'PExtra01',
  'PExtra02',
  'PExtra03',
  'PExtra04',
  'PExtra05',
  'PExtra06',
  'PExtra07',
  'PExtra08',
  'PExtra09',
  'PExtra10',
  'Extra01',
  'Extra02',
  'Extra03',
  'Extra04',
  'Extra05',
  'Extra06',
  'Extra07',
  'Extra08',
  'Extra09',
  'Extra10',
  'Extra11',
  'Extra12',
] as const;

export type EinvoiceCell = string | number;

export function einvoicePaymentMethod(paymentMethod: string): 'TM' | 'CK' {
  return paymentMethod === 'bank' ? 'CK' : 'TM';
}

export function formatEinvoiceProductName(productName: string, optionLabel: string | null | undefined): string {
  const option = optionLabel?.trim();
  if (!option) return productName;
  return `${productName} (${option})`;
}

export function formatEinvoiceDate(now = Date.now()): string {
  const today = vnTodayParts(now);
  const d = String(today.day).padStart(2, '0');
  const m = String(today.month).padStart(2, '0');
  return `${d}/${m}/${today.year}`;
}

export function einvoiceExportFilename(orderCount: number, now = Date.now()): string {
  const today = vnTodayParts(now);
  const ymd = `${today.year}${String(today.month).padStart(2, '0')}${String(today.day).padStart(2, '0')}`;
  return `HoaDonDienTu_${ymd}_${orderCount}don.xlsx`;
}

export function einvoiceExportObjectKey(filename: string, now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `exports/einvoice/${year}/${month}/${crypto.randomUUID()}-${filename}`;
}

function emptyRow(): EinvoiceCell[] {
  return EINVOICE_HEADERS.map(() => '');
}

function setCell(row: EinvoiceCell[], key: (typeof EINVOICE_HEADERS)[number], value: EinvoiceCell) {
  const index = EINVOICE_HEADERS.indexOf(key);
  if (index >= 0) row[index] = value;
}

export function mapOrdersToEinvoiceRows(
  orders: InvoiceExportOrder[],
  now = Date.now(),
): { rows: EinvoiceCell[][]; orderCount: number } {
  const ngay = formatEinvoiceDate(now);
  const rows: EinvoiceCell[][] = [];
  let maHd = 0;

  for (const order of orders) {
    maHd += 1;
    const pttt = einvoicePaymentMethod(order.paymentMethod);
    const lines =
      order.lines.length > 0
        ? order.lines
        : [
            {
              productId: order.productId,
              productName: order.productName,
              optionLabel: order.optionLabel,
              unitPrice: order.unitPrice,
              quantity: order.quantity,
              lineTotal: order.unitPrice * order.quantity,
            },
          ];

    for (const line of lines) {
      const row = emptyRow();
      setCell(row, 'MaHD', maHd);
      setCell(row, 'NgayHoaDon', ngay);
      setCell(row, 'TenNguoiMua', order.customerName);
      setCell(row, 'DiaChiKhachHang', order.address);
      setCell(row, 'MaHangHoa', line.productId != null ? String(line.productId) : '');
      setCell(row, 'TenHangHoa', formatEinvoiceProductName(line.productName, line.optionLabel));
      setCell(row, 'DonViTinh', 'Cái');
      setCell(row, 'SoLuong', line.quantity);
      setCell(row, 'DonGia', line.unitPrice);
      setCell(row, 'ThanhTien', line.lineTotal);
      setCell(row, 'PhuongThucTT', pttt);
      rows.push(row);
    }
  }

  return { rows, orderCount: maHd };
}

export function buildEinvoiceWorkbookBytes(dataRows: EinvoiceCell[][]): Uint8Array {
  const aoa: EinvoiceCell[][] = [Array.from(EINVOICE_HEADERS), ...dataRows];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, EINVOICE_SHEET_NAME);
  const raw = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as number[];
  return new Uint8Array(raw);
}
