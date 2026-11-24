import { FREE_SHIP_BRACELET_MIN } from '../shipping/customer-fee';

/** Hint bán kèm — module thuần, dùng được cả client (không kéo DB). */
export type AddonShipHint = 'free-ship' | 'together';

export function addonShipHint(braceletGoods: number): AddonShipHint {
  if (Number.isSafeInteger(braceletGoods) && braceletGoods > 0 && braceletGoods < FREE_SHIP_BRACELET_MIN) {
    return 'free-ship';
  }
  return 'together';
}

export function addonShipHintText(hint: AddonShipHint): string {
  return hint === 'free-ship'
    ? 'Thêm bó để được miễn phí vận chuyển.'
    : 'Thường mua cùng vòng, để giường hoặc nôi theo phong tục.';
}
