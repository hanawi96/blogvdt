import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const POST_TITLE = 'Bài kiểm tra giai đoạn 6';
const POST_SLUG = 'bai-kiem-tra-giai-doan-6';
const NEXT_SLUG = 'bai-kiem-tra-giai-doan-6-moi';
const OLD_TITLE = 'Nhìn một vòng dâu tằm thủ công';
const OLD_SLUG = 'nhin-mot-vong-dau-tam-thu-cong';
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

test('viết, xuất bản, đổi slug, gỡ và xóa bài', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await login(page);
  await page.goto('/admin/posts');
  await page.getByRole('link', { name: OLD_TITLE }).click();
  await expect(page.locator('#post-title')).toHaveValue(OLD_TITLE);
  await expect(page.locator('.ProseMirror')).toContainText('Vòng dâu tằm thủ công');

  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('#post-title').fill(POST_TITLE);
  await page.getByLabel('Slug').fill(POST_SLUG);
  await expect(page.locator('[data-save-status]')).toHaveText('Đã lưu', { timeout: 12_000 });
  await expect(page).toHaveURL(/\/admin\/posts\/\d+$/);

  await page.locator('.ProseMirror').click();
  await page.keyboard.insertText('Nội dung kiểm tra giai đoạn 6. Bài chỉ mô tả sản phẩm thủ công.');
  const previewPopup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Xem trước' }).click();
  const preview = await previewPopup;
  await expect(preview.locator('h1')).toHaveText(POST_TITLE);
  await expect(preview.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(preview.locator('link[rel="canonical"]')).toHaveCount(0);
  await preview.close();

  await submitPost(page, 'Lưu nháp');
  await expect(page.locator('[data-save-status]')).toHaveText('Đã lưu');
  expect((await page.request.get(`/kien-thuc/${POST_SLUG}`)).status()).toBe(404);

  await page.locator('#post-title').fill(`${POST_TITLE} đã sửa`);
  await submitPost(page, 'Lưu nháp');
  await expect(page.locator('#post-title')).toHaveValue(`${POST_TITLE} đã sửa`);
  await expect(page.locator('.ProseMirror')).toContainText('Nội dung kiểm tra giai đoạn 6.');

  await submitPost(page, 'Xuất bản');
  await expect(page.locator('#post-status')).toHaveValue('published');
  const published = await page.request.get(`/kien-thuc/${POST_SLUG}`);
  expect(published.status()).toBe(200);
  expect(published.headers()['cache-control']).toContain('max-age=60');
  const html = await published.text();
  expect(html).toContain(`${POST_TITLE} đã sửa`);
  expect(html).toContain('rel="canonical" href="http://localhost:4321/kien-thuc/bai-kiem-tra-giai-doan-6"');
  expect(html).toContain('name="robots" content="index,follow"');
  expect(html).toContain('"@type":"BlogPosting"');
  expect(html).toContain('"@type":"BreadcrumbList"');
  expect(html).not.toContain('aggregateRating');
  expect(html).not.toContain('@tiptap');
  const sitemap = await (await page.request.get('/sitemap.xml')).text();
  expect(sitemap).toContain(`/kien-thuc/${POST_SLUG}`);

  await page.getByLabel('Slug').fill(NEXT_SLUG);
  await submitPost(page, 'Cập nhật');
  const moved = await page.request.get(`/kien-thuc/${POST_SLUG}`, { maxRedirects: 0 });
  expect(moved.status()).toBe(301);
  expect(moved.headers().location).toContain(`/kien-thuc/${NEXT_SLUG}`);
  expect((await page.request.get(`/kien-thuc/${NEXT_SLUG}`)).status()).toBe(200);

  await submitPost(page, 'Lưu nháp');
  await expect(page.locator('#post-status')).toHaveValue('draft');
  expect((await page.request.get(`/kien-thuc/${NEXT_SLUG}`)).status()).toBe(404);
  const stale = await page.request.get(`/kien-thuc/${POST_SLUG}`, { maxRedirects: 0 });
  expect(stale.status()).toBe(404);

  await page.getByText('Thao tác khác').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Xóa bài viết' }).click();
  await expect(page).toHaveURL(/\/admin\/posts$/);
  expect((await page.request.get(`/kien-thuc/${NEXT_SLUG}`)).status()).toBe(404);
  expect(errors).toEqual([]);
});

test('bài cũ và màn hình điện thoại', async ({ page }) => {
  const started = Date.now();
  const response = await page.request.get(`/kien-thuc/${OLD_SLUG}`);
  expect(response.status()).toBe(200);
  expect(Date.now() - started).toBeLessThan(8_000);
  await page.goto(`/kien-thuc/${OLD_SLUG}`);
  await expect(page.locator('#noi-dung h1')).toHaveCount(1);
  await expect(page.locator('#noi-dung h1')).toHaveText(OLD_TITLE);
  await expect(page.locator('#noi-dung')).toContainText('Vòng dâu tằm thủ công là món quà');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `http://localhost:4321/kien-thuc/${OLD_SLUG}`);
  const schema = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(schema.some((entry) => entry.includes('"@type":"BlogPosting"'))).toBe(true);
  expect(schema.some((entry) => entry.includes('aggregateRating'))).toBe(false);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/kien-thuc/${OLD_SLUG}`);
  const heading = page.locator('#noi-dung h1');
  await expect(heading).toBeVisible();
  const box = await heading.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);

  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/posts/new');
  await expect(page.getByRole('button', { name: 'Xuất bản' })).toBeVisible();
  await expect(page.locator('#post-title')).toBeVisible();
});

test('đặt hàng và xử lý đơn', async ({ page }) => {
  await page.goto('/san-pham/vong-to-tam-tron');
  await page.getByLabel('Số lượng').fill('1');
  await page.getByLabel('Họ tên').fill('Khách E2E');
  await page.getByLabel('Số điện thoại').fill(ORDER_PHONE);
  await page.getByLabel('Địa chỉ nhận hàng').fill('1 đường Kiểm tra, Quận 1');
  await page.getByRole('button', { name: 'Gửi đơn' }).click();
  await expect(page).toHaveURL(/\/dat-hang\/thanh-cong\?ma=VD\d{8}-\d{4}$/);
  expect(page.url()).not.toContain(ORDER_PHONE);
  await expect(page.locator('#noi-dung h1')).toHaveText('Cảm ơn mẹ đã đặt hàng');
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

async function submitPost(page: Page, name: string) {
  const redirect = page.waitForResponse((response) => response.request().method() === 'POST' && response.status() === 303);
  await page.getByRole('button', { name, exact: true }).click();
  await redirect;
  await page.waitForLoadState('load');
}

async function login(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('Tên đăng nhập').fill('admin');
  await page.getByLabel('Mật khẩu').fill('DevLocal-VongDau-2026');
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
}

function resetFixtures() {
  const file = join(tmpdir(), 'phase6-e2e-cleanup.sql');
  writeFileSync(
    file,
    [
      `DELETE FROM redirects WHERE from_path IN ('/kien-thuc/${POST_SLUG}', '/kien-thuc/${NEXT_SLUG}') OR to_path IN ('/kien-thuc/${POST_SLUG}', '/kien-thuc/${NEXT_SLUG}');`,
      `DELETE FROM posts WHERE slug IN ('${POST_SLUG}', '${NEXT_SLUG}');`,
      `DELETE FROM orders WHERE phone = '${ORDER_PHONE}';`,
    ].join('\n'),
  );
  execFileSync(
    process.execPath,
    [join(process.cwd(), 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'd1', 'execute', 'vong-dau-tam', '--local', '--file', file],
    { stdio: 'pipe' },
  );
}
