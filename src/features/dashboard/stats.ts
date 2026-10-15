import { count, desc, eq, isNull } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { orders, posts, products } from '../../lib/db/schema';
import { livePublished } from '../posts/visibility';

export async function getDashboard(db: AppDb) {
  const [postCount, publishedCount, productCount, orderCount, newOrderCount, recentOrders] = await Promise.all([
    db.select({ value: count() }).from(posts).where(isNull(posts.deletedAt)),
    db.select({ value: count() }).from(posts).where(livePublished()),
    db.select({ value: count() }).from(products),
    db.select({ value: count() }).from(orders),
    db.select({ value: count() }).from(orders).where(eq(orders.status, 'new')),
    db
      .select({
        id: orders.id,
        code: orders.code,
        customerName: orders.customerName,
        status: orders.status,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(5),
  ]);
  return {
    posts: postCount[0]?.value ?? 0,
    publishedPosts: publishedCount[0]?.value ?? 0,
    products: productCount[0]?.value ?? 0,
    orders: orderCount[0]?.value ?? 0,
    newOrders: newOrderCount[0]?.value ?? 0,
    recentOrders,
  };
}
