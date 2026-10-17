// Hình thức thanh toán khách chọn khi đặt hàng. Website không thu tiền; đây chỉ là thông tin cho xưởng.
export const PAYMENT_METHODS = [
  { value: 'cod', label: 'Thanh toán khi nhận hàng', hint: '' },
  { value: 'bank', label: 'Chuyển khoản ngân hàng', hint: 'Xưởng sẽ gửi thông tin tài khoản khi gọi xác nhận đơn.' },
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]['value'];

export const DEFAULT_PAYMENT_METHOD: PaymentMethod = 'cod';

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return PAYMENT_METHODS.some((method) => method.value === value);
}

export function paymentLabel(value: string): string {
  return PAYMENT_METHODS.find((method) => method.value === value)?.label ?? value;
}
