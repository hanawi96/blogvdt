/** Đối tượng đeo — hiển thị trên card khi khác `none`. */
export const AUDIENCES = ['none', 'both', 'boy', 'girl'] as const;
export type Audience = (typeof AUDIENCES)[number];

export const DEFAULT_AUDIENCE: Audience = 'none';

/** Nhãn trong form admin. */
export const AUDIENCE_LABELS: Record<Audience, string> = {
  none: 'Không hiển thị',
  both: 'Cả bé trai & bé gái',
  boy: 'Bé trai',
  girl: 'Bé gái',
};

/** Nhãn ngắn trên card công khai; `none` → chuỗi rỗng (không render). */
export const AUDIENCE_CARD_LABELS: Record<Audience, string> = {
  none: '',
  both: 'Cho cả bé trai & bé gái',
  boy: 'Cho bé trai',
  girl: 'Cho bé gái',
};

export function isAudience(value: string): value is Audience {
  return (AUDIENCES as readonly string[]).includes(value);
}

export function readAudience(value: string | null | undefined): Audience {
  return value && isAudience(value) ? value : DEFAULT_AUDIENCE;
}

export function audienceCardLabel(value: string | null | undefined): string {
  return AUDIENCE_CARD_LABELS[readAudience(value)];
}
