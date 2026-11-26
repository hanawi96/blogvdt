import { FREE_SHIP_BRACELET_MIN } from '../shipping/customer-fee';

/** Hint bán kèm — module thuần, dùng được cả client (không kéo DB). */
export type AddonShipHint = 'free-ship' | 'together';

export function addonShipHint(braceletGoods: number): AddonShipHint {
  if (Number.isSafeInteger(braceletGoods) && braceletGoods > 0 && braceletGoods < FREE_SHIP_BRACELET_MIN) {
    return 'free-ship';
  }
  return 'together';
}

/** Hint tương tác chọn bán kèm — cùng một câu ở giỏ / modal mua ngay / PDP. */
export function addonShipHintText(_hint: AddonShipHint): string {
  return 'Bấm để chọn/bỏ chọn sản phẩm mua kèm';
}
