// Thang cân nặng cho sản phẩm, gắn theo danh mục qua cột product_categories.weight_scale.
// Thêm thang mới (vd người lớn) chỉ cần bổ sung vào WEIGHT_SCALES; UI và giỏ hàng tự dùng.
// 'none' nghĩa là danh mục không cần chọn cân nặng (thêm thẳng vào giỏ).

export const WEIGHT_SCALES = {
  none: [],
  baby: ['Chưa sinh', '3kg', '4kg', '5kg', '6kg', '7kg', '8kg', '9kg', '10kg', '11kg', '12kg', '13kg', '14kg', '15kg'],
} as const;

export type WeightScale = keyof typeof WEIGHT_SCALES;

// Nhãn hiển thị cho admin khi chọn thang của danh mục.
export const WEIGHT_SCALE_LABELS: { value: WeightScale; label: string }[] = [
  { value: 'baby', label: 'Bé (Chưa sinh, 3–15kg)' },
  { value: 'none', label: 'Không cần chọn cân nặng' },
];

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

export function requiresWeight(scale: WeightScale): boolean {
  return WEIGHT_SCALES[scale].length > 0;
}

// Cân nặng gửi lên có hợp lệ với thang của danh mục không.
// Thang 'none' thì không được có cân nặng; thang có mốc thì phải khớp một mốc.
export function isValidWeight(scale: WeightScale, weight: string): boolean {
  const value = weight.trim();
  if (!requiresWeight(scale)) return value.length === 0;
  return (WEIGHT_SCALES[scale] as readonly string[]).includes(value);
}
