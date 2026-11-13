// Thang cân nặng cho sản phẩm, gắn theo danh mục qua cột product_categories.weight_scale.
// Thêm thang mới (vd người lớn) chỉ cần bổ sung vào WEIGHT_SCALES; UI và giỏ hàng tự dùng.
// 'none' nghĩa là danh mục không cần chọn cân nặng (thêm thẳng vào giỏ).

// Mốc chip bấm nhanh (tới 15kg). WEIGHT_SCALES giữ nguyên các nơi render chip sẵn có.
export const WEIGHT_SCALES = {
  none: [],
  baby: ['Chưa sinh', '3kg', '4kg', '5kg', '6kg', '7kg', '8kg', '9kg', '10kg', '11kg', '12kg', '13kg', '14kg', '15kg'],
} as const;

// Mốc cân nặng lớn nằm trong dropdown "Cân nặng khác" (16kg…70kg). Vòng to hơn nên cộng phụ thu nguyên liệu.
const BABY_EXTRAS = Array.from({ length: 70 - 16 + 1 }, (_, index) => `${index + 16}kg`);

// Phụ thu nguyên liệu cho vòng lớn: phần trăm tăng phụ thuộc CẢ cân nặng lẫn giá gốc.
// Bậc cân nặng: 16–35kg và 36kg trở lên. Bậc giá: <150k, 150k–<300k, >=300k.
const WEIGHT_MID_MIN = 16;
const WEIGHT_MID_MAX = 35;
const PRICE_LOW_MAX = 150_000; // dưới mốc này = nhóm giá thấp
const PRICE_MID_MAX = 300_000; // từ 150k đến dưới 300k = nhóm giữa; >=300k = nhóm cao
// percent[bậc cân nặng][nhóm giá]
const SURCHARGE_PERCENT = {
  mid: { low: 15, middle: 12, high: 10 }, // 16–35kg
  heavy: { low: 20, middle: 15, high: 10 }, // 36kg+
} as const;

export type WeightScale = keyof typeof WEIGHT_SCALES;

export const DEFAULT_WEIGHT_SCALE: WeightScale = 'baby';

// Nhãn cân nặng tối đa 40 ký tự để vừa độ dài option của giỏ/đơn hàng.
export const WEIGHT_MAX_LABEL = 40;

export function isWeightScale(value: unknown): value is WeightScale {
  return typeof value === 'string' && value in WEIGHT_SCALES;
}

export function readWeightScale(value: unknown): WeightScale {
  return isWeightScale(value) ? value : DEFAULT_WEIGHT_SCALE;
}

export function weightOptions(scale: WeightScale): readonly string[] {
  return WEIGHT_SCALES[scale];
}

/** Mốc hiển thị dạng chip (tới 15kg). Thang 'none' trả rỗng. */
export function weightChips(scale: WeightScale): readonly string[] {
  return WEIGHT_SCALES[scale];
}

/** Mốc cân nặng lớn cho dropdown "Cân nặng khác" (16kg…70kg). */
export function weightExtras(scale: WeightScale): readonly string[] {
  return scale === 'baby' ? BABY_EXTRAS : [];
}

/** Số kg đọc được từ nhãn, ví dụ "16kg" -> 16; nhãn chữ như "Chưa sinh" -> null. */
function weightKg(weight: string): number | null {
  const match = weight.trim().match(/^(\d{1,3})\s*kg$/i);
  if (!match) return null;
  const kg = Number(match[1]);
  return Number.isInteger(kg) && kg > 0 ? kg : null;
}

/**
 * Phần trăm phụ thu theo cân nặng + giá gốc. Trả 0 nếu không phụ thu (cân nặng chip hoặc giá ≤ 0).
 * 16–35kg: <150k=15%, 150k–<300k=12%, >=300k=10%. 36kg+: <150k=20%, 150k–<300k=15%, >=300k=10%.
 */
export function weightSurchargePercent(weight: string, basePrice: number): number {
  const kg = weightKg(weight);
  if (kg === null || kg < WEIGHT_MID_MIN || !Number.isFinite(basePrice) || basePrice <= 0) return 0;
  const tier = kg <= WEIGHT_MID_MAX ? SURCHARGE_PERCENT.mid : SURCHARGE_PERCENT.heavy;
  if (basePrice < PRICE_LOW_MAX) return tier.low;
  if (basePrice < PRICE_MID_MAX) return tier.middle;
  return tier.high;
}

/** Hệ số giá (1 + phần trăm/100) theo cân nặng và giá gốc. */
export function weightPriceFactor(weight: string, basePrice: number): number {
  return 1 + weightSurchargePercent(weight, basePrice) / 100;
}

/** Nhãn phụ thu ngắn cho UI ("+10%"…); null nếu không phụ thu. */
export function weightSurchargeLabel(weight: string, basePrice: number): string | null {
  const percent = weightSurchargePercent(weight, basePrice);
  return percent > 0 ? `+${percent}%` : null;
}

/** Nhãn option dropdown kèm ghi chú tăng giá, ví dụ "16kg (giá tăng 10%)". */
export function weightOptionLabel(weight: string, basePrice: number): string {
  const percent = weightSurchargePercent(weight, basePrice);
  return percent > 0 ? `${weight} - (giá tăng ${percent}%)` : weight;
}

/** Đơn giá sau phụ thu cân nặng, làm tròn tới nghìn gần nhất. Phụ thu tính trên giá gốc. */
export function applyWeightPrice(basePrice: number, weight: string): number {
  const percent = weightSurchargePercent(weight, basePrice);
  if (percent === 0) return basePrice;
  return Math.round((basePrice * (1 + percent / 100)) / 1000) * 1000;
}

export function requiresWeight(scale: WeightScale): boolean {
  return WEIGHT_SCALES[scale].length > 0;
}

// Cân nặng gửi lên có hợp lệ với thang của danh mục không.
// Thang 'none' thì không được có cân nặng; thang có mốc thì phải khớp một mốc.
export function isValidWeight(scale: WeightScale, weight: string): boolean {
  const value = weight.trim();
  if (!requiresWeight(scale)) return value.length === 0;
  if ((WEIGHT_SCALES[scale] as readonly string[]).includes(value)) return true;
  // Chấp nhận cả mốc lớn trong dropdown "Cân nặng khác" (16kg…70kg).
  return (weightExtras(scale) as readonly string[]).includes(value);
}
