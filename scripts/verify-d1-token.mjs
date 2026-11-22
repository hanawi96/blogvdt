/**
 * Kiểm tra token trước khi `wrangler secret put D1_API_TOKEN`.
 *
 * Cách dùng (PowerShell):
 *   $env:D1_API_TOKEN = 'dán-token-vào-đây'
 *   node .\scripts\verify-d1-token.mjs
 *
 * Không in giá trị token. Exit 0 = export OK.
 */
import process from 'node:process';

const accountId = process.env.CF_ACCOUNT_ID?.trim() || '6732e495e6dc332a4d51e0aba6c0408a';
const databaseId = process.env.D1_DATABASE_ID?.trim() || 'b98c2657-e991-42e8-bba3-a797452437b2';
const token = process.env.D1_API_TOKEN?.trim() || '';

if (!token) {
  console.error('Thiếu env D1_API_TOKEN. Đặt token rồi chạy lại.');
  process.exit(1);
}

const verifyRes = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
  headers: { Authorization: `Bearer ${token}` },
});
const verifyBody = await verifyRes.json();
const verifyStatus = verifyBody?.result?.status || null;

const exportRes = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/export`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      output_format: 'polling',
      dump_options: { compatibility: 'd1', no_data: true, tables: ['backup_jobs'] },
    }),
  },
);
const exportBody = await exportRes.json();
const exportOk = exportRes.ok && Boolean(exportBody?.result?.at_bookmark);
const exportError = exportBody?.errors?.[0]?.message || null;

console.log(
  JSON.stringify(
    {
      tokenLength: token.length,
      verifyHttp: verifyRes.status,
      verifyStatus,
      exportHttp: exportRes.status,
      exportOk,
      exportError,
      hint: exportOk
        ? 'Token OK — chạy: npx wrangler secret put D1_API_TOKEN'
        : /authentication|10000|unauthorized/i.test(String(exportError)) || exportRes.status === 401 || exportRes.status === 403
          ? 'Token sai hoặc thiếu quyền Account → D1 → Edit (không dùng D1 Read / Global API Key).'
          : 'Export thất bại — xem exportError.',
    },
    null,
    2,
  ),
);

process.exit(exportOk ? 0 : 2);
