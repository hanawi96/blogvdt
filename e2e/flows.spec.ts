import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const POST_SLUG = 'bai-kiem-tra-giai-doan-5';
const POST_TITLE = 'Bài kiểm tra giai đoạn 5';
const ORDER_PHONE = '0909555001';

test.beforeAll(resetFixtures);
test.afterAll(resetFixtures);

test('đăng nhập', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.getByLabel('Tên đăng nhập').fill('admin');
  await page.getByLabel('Mật khẩu').fill('sai-mat-khau');
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('alert')).toContainText('Sai tên đăng nhập hoặc mật khẩu.');

  await login(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Tổng quan' })).toBeVisible();
  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.goto('/admin/posts');
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test('xuất bản bài', async ({ page }) => {
  await login(page);
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('Tiêu đề').fill(POST_TITLE);
  await page.getByLabel('Slug').fill(POST_SLUG);
  await expect(page.getByLabel('Tiêu đề')).toHaveValue(POST_TITLE);
  await page.locator('.ProseMirror').click();
  await page.keyboard.insertText('Nội dung kiểm tra giai đoạn 5. Bài chỉ mô tả sản phẩm thủ công.');
  await page.getByLabel('Trạng thái').selectOption('draft');
  await page.getByRole('button', { name: 'Lưu bài viết' }).click();
  await expect(page).toHaveURL(/\/admin\/posts\/\d+\?saved=1$/);
  await expect(page.getByRole('status')).toContainText('Đã lưu bài viết.');
  const editUrl = page.url().replace(/\?saved=1$/, '');

  const draft = await page.request.get(`/kien-thuc/${POST_SLUG}`);
  expect(draft.status()).toBe(404);

  await page.getByLabel('Trạng thái').selectOption('published');
  await page.getByRole('button', { name: 'Lưu bài viết' }).click();
  await expect(page).toHaveURL(/\/admin\/posts\/\d+\?saved=1$/);

  await page.goto(`/kien-thuc/${POST_SLUG}`);
  await expect(page.locator('#noi-dung h1')).toHaveText(POST_TITLE);
  await expect(page.locator('#noi-dung')).toContainText('Nội dung kiểm tra giai đoạn 5.');

  await page.goto(editUrl);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Xóa bài viết' }).click();
  await expect(page).toHaveURL(/\/admin\/posts$/);
  const removed = await page.request.get(`/kien-thuc/${POST_SLUG}`);
  expect(removed.status()).toBe(404);
});

test('xem bài', async ({ page }) => {
  await page.goto('/kien-thuc/nhin-mot-vong-dau-tam-thu-cong');
  await expect(page.locator('#noi-dung h1')).toHaveCount(1);
  await expect(page.locator('#noi-dung h1')).toHaveText('Nhìn một vòng dâu tằm thủ công');
  await expect(page.locator('#noi-dung')).toContainText('Vòng dâu tằm thủ công là món quà');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'http://localhost:4321/kien-thuc/nhin-mot-vong-dau-tam-thu-cong',
  );
  const schema = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(schema.some((entry) => entry.includes('"@type":"Article"'))).toBe(true);
  expect(schema.some((entry) => entry.includes('aggregateRating'))).toBe(false);
});

test('đặt hàng và xử lý đơn', async ({ page }) => {
  await page.goto('/san-pham/vong-to-tam-tron');
  await page.getByLabel('Lựa chọn').selectOption('Size vừa');
  await page.getByLabel('Số lượng').fill('1');
  await page.getByLabel('Họ tên').fill('Khách E2E');
  await page.getByLabel('Số điện thoại').fill(ORDER_PHONE);
  await page.getByLabel('Địa chỉ nhận hàng').fill('1 đường Kiểm tra, Quận 1');
  await page.getByRole('button', { name: 'Gửi đơn' }).click();
  await expect(page).toHaveURL(/\/dat-hang\/thanh-cong\?ma=VD\d{8}-\d{4}$/);
  expect(page.url()).not.toContain(ORDER_PHONE);
  await expect(page.locator('#noi-dung h1')).toHaveText('Đã nhận đơn');
  const code = new URL(page.url()).searchParams.get('ma') ?? '';

  await login(page);
  await page.goto(`/admin/orders?q=${ORDER_PHONE}`);
  await page.getByRole('link', { name: code }).click();
  await expect(page.getByLabel('Trạng thái')).toHaveValue('new');
  await page.getByLabel('Trạng thái').selectOption('confirmed');
  await page.getByRole('button', { name: 'Lưu trạng thái' }).click();
  await expect(page.getByRole('status')).toContainText('Đã cập nhật trạng thái.');
  await expect(page.getByLabel('Trạng thái')).toHaveValue('confirmed');
});

async function login(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('Tên đăng nhập').fill('admin');
  await page.getByLabel('Mật khẩu').fill('DevLocal-VongDau-2026');
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
}

function resetFixtures() {
  const file = join(tmpdir(), 'phase5-e2e-cleanup.sql');
  writeFileSync(
    file,
    [
      `DELETE FROM redirects WHERE from_path = '/kien-thuc/${POST_SLUG}' OR to_path = '/kien-thuc/${POST_SLUG}';`,
      `DELETE FROM posts WHERE slug = '${POST_SLUG}';`,
      `DELETE FROM orders WHERE phone = '${ORDER_PHONE}';`,
    ].join('\n'),
  );
  execFileSync(
    process.execPath,
    [join(process.cwd(), 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'd1', 'execute', 'vong-dau-tam', '--local', '--file', file],
    { stdio: 'pipe' },
  );
}
