export const CART_COOKIE = 'vdt_cart';
export const CART_MAX_AGE = 60 * 60 * 24 * 14;
export const CART_MAX_LINES = 8;
export const CART_MAX_QUANTITY = 20;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type CartLine = {
  slug: string;
  quantity: number;
  weight: string;
};

export const CART_MAX_WEIGHT = 40;

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

export function cartSummary(names: string[]): string {
  const clean = names.map((name) => name.trim()).filter((name) => name.length > 0);
  if (clean.length <= 2) return clean.join(', ').slice(0, 160);
  return `${clean[0]} + ${clean.length - 1} mẫu`.slice(0, 160);
}

export function parseCart(value: string | null | undefined): CartLine[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    const lines: CartLine[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const record = item as { slug?: unknown; quantity?: unknown; weight?: unknown };
      const line = cleanLine(record.slug, record.quantity, record.weight);
      if (!line) continue;
      pushLine(lines, line);
    }
    return lines;
  } catch {
    return [];
  }
}

export function serializeCart(lines: CartLine[]): string {
  return JSON.stringify(lines.map((line) => ({ slug: line.slug, quantity: line.quantity, weight: line.weight })));
}

export function addCartLine(
  lines: CartLine[],
  next: { slug: string; quantity: number; weight: string },
): { ok: true; lines: CartLine[] } | { ok: false; error: string } {
  const line = cleanLine(next.slug, next.quantity, next.weight);
  if (!line) return { ok: false, error: 'Sản phẩm hoặc số lượng chưa đúng.' };
  const copy = lines.map((item) => ({ ...item }));
  const added = pushLine(copy, line);
  if (!added) return { ok: false, error: `Một giỏ tối đa ${CART_MAX_LINES} mẫu.` };
  return { ok: true, lines: copy };
}

export function postedCartLines(
  slugs: string[],
  quantities: string[],
  weights: string[],
): { ok: true; lines: CartLine[] } | { ok: false; error: string } {
  if (slugs.length !== quantities.length || slugs.length !== weights.length) {
    return { ok: false, error: 'Giỏ không hợp lệ.' };
  }
  if (slugs.length > CART_MAX_LINES) return { ok: false, error: `Một đơn tối đa ${CART_MAX_LINES} mẫu.` };
  const lines: CartLine[] = [];
  for (let index = 0; index < slugs.length; index += 1) {
    const line = cleanLine(slugs[index], Number(quantities[index]), weights[index]);
    if (!line) return { ok: false, error: 'Sản phẩm hoặc số lượng chưa đúng.' };
    const added = pushLine(lines, line);
    if (!added) return { ok: false, error: `Một đơn tối đa ${CART_MAX_LINES} mẫu.` };
  }
  return { ok: true, lines };
}

export function cartCookieOptions(secure: boolean, maxAge = CART_MAX_AGE) {
  return { path: '/', sameSite: 'lax' as const, maxAge, secure, httpOnly: false };
}

function cleanLine(slug: unknown, quantity: unknown, weight: unknown): CartLine | null {
  if (typeof slug !== 'string' || !SLUG.test(slug)) return null;
  if (typeof weight !== 'string') return null;
  const weightLabel = weight.trim().slice(0, CART_MAX_WEIGHT);
  if (weight.trim().length > CART_MAX_WEIGHT) return null;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > CART_MAX_QUANTITY) return null;
  return { slug, quantity, weight: weightLabel };
}

function pushLine(lines: CartLine[], line: CartLine): boolean {
  const index = lines.findIndex((item) => item.slug === line.slug && item.weight === line.weight);
  if (index === -1) {
    if (lines.length >= CART_MAX_LINES) return false;
    lines.push(line);
    return true;
  }
  lines[index] = { ...lines[index], quantity: Math.min(CART_MAX_QUANTITY, lines[index].quantity + line.quantity) };
  return true;
}
