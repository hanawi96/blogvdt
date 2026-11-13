// Thông tin tài khoản nhận chuyển khoản (VietQR). Đổi tại đây nếu thay tài khoản.
export const BANK_ACCOUNT = {
  bin: '970407', // Techcombank
  bankName: 'Techcombank',
  accountNumber: '19034579387036',
  accountName: 'HỘ KINH DOANH NGUYỄN VĂN YÊN 1996',
} as const;

/**
 * URL ảnh QR VietQR (dịch vụ công khai img.vietqr.io). Truyền amount (VND, số nguyên > 0)
 * để app ngân hàng điền sẵn số tiền; bỏ trống khi chưa biết tiền thì khách tự nhập.
 */
export function vietQrImageUrl(options: { amount?: number; addInfo?: string } = {}): string {
  const base = `https://img.vietqr.io/image/${BANK_ACCOUNT.bin}-${BANK_ACCOUNT.accountNumber}-compact2.png`;
  const params = new URLSearchParams();
  params.set('accountName', BANK_ACCOUNT.accountName);
  if (typeof options.amount === 'number' && Number.isFinite(options.amount) && options.amount > 0) {
    params.set('amount', String(Math.round(options.amount)));
  }
  const info = (options.addInfo ?? '').trim();
  if (info) params.set('addInfo', info.slice(0, 50));
  return `${base}?${params.toString()}`;
}
