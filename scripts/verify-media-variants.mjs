/** Kiểm tra nhanh: mọi media local có đủ object R2 original/card/thumb. */
import { getPlatformProxy } from 'wrangler';

const proxy = await getPlatformProxy({ persist: true });
try {
  const rows = (await proxy.env.DB.prepare('SELECT id, r2_key, card_r2_key, thumb_r2_key FROM media ORDER BY id').all())
    .results;
  let failed = 0;
  for (const row of rows) {
    const original = await proxy.env.MEDIA.head(row.r2_key);
    const card = row.card_r2_key ? await proxy.env.MEDIA.head(row.card_r2_key) : null;
    const thumb = row.thumb_r2_key ? await proxy.env.MEDIA.head(row.thumb_r2_key) : null;
    const ok = Boolean(original && card && thumb);
    if (!ok) failed += 1;
    console.log(
      JSON.stringify({
        id: row.id,
        ok,
        original: Boolean(original),
        card: Boolean(card),
        thumb: Boolean(thumb),
        cardBytes: card?.size ?? null,
        thumbBytes: thumb?.size ?? null,
      }),
    );
  }
  if (failed > 0) {
    console.error(`FAIL: ${failed}/${rows.length} media thiếu object`);
    process.exit(1);
  }
  console.log(`PASS: ${rows.length} media đủ original+card+thumb trên R2`);
} finally {
  await proxy.dispose();
}
