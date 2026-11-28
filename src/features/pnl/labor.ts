import { eq } from 'drizzle-orm';

import { formatVnd } from '../../lib/money';
import type { AppDb } from '../../lib/db/client';
import { pnlLaborBudgets } from '../../lib/db/schema';
import { parseMaterialPrice } from '../materials/costing';
import { activityWrite, commitWrites, type ActivityActor } from '../activity/log';
import { PNL_DEFAULT_LABOR_BUDGET } from './rules';

export { PNL_DEFAULT_LABOR_BUDGET };

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function parseLaborMonthKey(value: string): string | null {
  const match = MONTH_RE.exec(value.trim());
  return match ? match[0] : null;
}

export async function getLaborBudget(db: AppDb, monthKey: string): Promise<number | null> {
  if (!parseLaborMonthKey(monthKey)) return null;
  const rows = await db
    .select({ amount: pnlLaborBudgets.amount })
    .from(pnlLaborBudgets)
    .where(eq(pnlLaborBudgets.monthKey, monthKey))
    .limit(1);
  return rows[0]?.amount ?? null;
}

export async function saveLaborBudget(
  db: AppDb,
  input: { monthKey: string; amount: string },
  now = Date.now(),
  actor?: ActivityActor,
): Promise<{ ok: true; amount: number } | { ok: false; error: string }> {
  const monthKey = parseLaborMonthKey(input.monthKey);
  if (!monthKey) return { ok: false, error: 'Chọn tháng hợp lệ.' };
  const amount = parseMaterialPrice(input.amount);
  if (amount === null) return { ok: false, error: 'Số tiền là số nguyên VND, từ 0 đến 99.999.999.' };

  await commitWrites(db, [
    db
      .insert(pnlLaborBudgets)
      .values({ monthKey, amount, updatedAt: now })
      .onConflictDoUpdate({ target: pnlLaborBudgets.monthKey, set: { amount, updatedAt: now } }),
    ...(actor
      ? [
          activityWrite(
            db,
            {
              actorId: actor.id,
              actorName: actor.name,
              action: 'pnl.labor_budget.save',
              objectType: 'pnl_labor_budget',
              objectId: null,
              summary: `Ngân sách tiền công ${monthKey}: ${formatVnd(amount)} (đối chiếu, không trừ lãi).`,
              createdAt: now,
            },
            true,
          ),
        ]
      : []),
  ]);
  return { ok: true, amount };
}
