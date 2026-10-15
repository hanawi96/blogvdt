import { asc, count, desc, inArray, like, sql } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { orders } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import { orderSearchTerm } from './orders';

const PAGE_SIZE = 20;
export const CUSTOMER_SORTS = [
  { value: 'recent', label: 'Mua gần nhất' },
  { value: 'orders', label: 'Nhiều đơn nhất' },
  { value: 'spent', label: 'Chi tiêu nhiều nhất' },
] as const;

export type CustomerSort = (typeof CUSTOMER_SORTS)[number]['value'];

export function customerSort(value: string | null | undefined): CustomerSort {
  return CUSTOMER_SORTS.find((sort) => sort.value === value)?.value ?? 'recent';
}

export function customerAdminQuery(input: { query?: string; sort?: string; page?: number }): string {
  const params = new URLSearchParams();
  const query = (input.query ?? '').replace(/[%_]/g, '').trim().slice(0, 80);
  const sort = customerSort(input.sort);
  const page = input.page && Number.isInteger(input.page) && input.page > 1 ? input.page : 0;
  if (query) params.set('q', query);
  if (sort !== 'recent') params.set('sort', sort);
  if (page) params.set('page', String(page));
  const text = params.toString();
  return text ? `${routes.adminCustomers}?${text}` : routes.adminCustomers;
}

/** Khách không có tài khoản: mỗi số điện thoại (đã chuẩn hóa khi đặt) là một khách. */
export async function listCustomers(db: AppDb, filters: { query: string; sort: CustomerSort; page: number }) {
  const term = orderSearchTerm(filters.query);
  const partialPhone = /^[\d\s.+\-()]+$/.test(term.text) ? term.text.replace(/\D/g, '') : '';
  const phone = term.phone || partialPhone;
  // Lọc theo tên bằng subquery để số đơn và tổng chi tiêu vẫn tính trên mọi đơn của số điện thoại đó.
  const where = phone
    ? like(orders.phone, `%${phone}%`)
    : term.text
      ? inArray(orders.phone, db.select({ phone: orders.phone }).from(orders).where(like(orders.customerName, `%${term.text}%`)))
      : undefined;
  const page = Math.max(1, filters.page);
  const orderCount = count();
  // SQLite lấy cột không gộp từ đúng dòng có max() khi truy vấn chỉ có một min()/max(): tên, địa chỉ là của đơn mới nhất.
  const lastOrderAt = sql<number>`max(${orders.createdAt})`;
  const spent = sql<number>`coalesce(sum(case when ${orders.status} <> 'cancelled' then ${orders.totalPrice} else 0 end), 0)`;
  const order =
    filters.sort === 'orders'
      ? [desc(orderCount), desc(lastOrderAt), asc(orders.phone)]
      : filters.sort === 'spent'
        ? [desc(spent), desc(lastOrderAt), asc(orders.phone)]
        : [desc(lastOrderAt), asc(orders.phone)];
  const distinctPhones = sql<number>`count(distinct ${orders.phone})`;
  const [rows, totalRows, libraryRows] = await db.batch([
    db
      .select({
        phone: orders.phone,
        customerName: orders.customerName,
        address: orders.address,
        orderCount,
        spent,
        lastOrderAt,
      })
      .from(orders)
      .where(where)
      .groupBy(orders.phone)
      .orderBy(...order)
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ value: distinctPhones }).from(orders).where(where),
    db.select({ value: distinctPhones }).from(orders),
  ]);
  const total = totalRows[0]?.value ?? 0;
  return {
    rows,
    total,
    libraryTotal: libraryRows[0]?.value ?? 0,
    page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}
