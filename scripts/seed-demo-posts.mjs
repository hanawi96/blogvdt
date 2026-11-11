/**
 * Seed demo: danh mục bài viết + thẻ + ~100 bài (đủ trường) trên D1 local.
 * Nội dung ngắn, tiêu đề đa dạng — để test trang quản lý bài viết / danh mục.
 * Chỉ chạy local — từ chối --remote.
 *
 *   npm run db:seed:demo-posts
 *
 * Trường bài viết được điền:
 * - title, slug, excerpt, content_json (Tiptap ngắn)
 * - seo_title, meta_description
 * - status (published / draft), published_at
 * - category_id + post_categories (1–2 danh mục)
 * - post_tags (0–3 thẻ)
 * - cover_media_id (xoay vòng media có sẵn, một phần để NULL)
 * - author_id, created_at, updated_at
 * - vài bài ở thùng rác (deleted_at) để test tab trash
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POST_COUNT = 100;
const NOW = Date.now();
const DAY = 86_400_000;

const extraArgs = process.argv.slice(2);
if (extraArgs.some((arg) => arg === '--remote' || arg.startsWith('--remote'))) {
  console.error('Seed demo bài viết chỉ chạy D1 local. Không dùng --remote.');
  process.exit(1);
}

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptsDir, '..');
const wranglerJs = path.join(projectDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const CATEGORIES = [
  {
    name: 'Cách chọn vòng',
    slug: 'cach-chon-vong',
    description: 'Gợi ý chọn size, màu chỉ và kiểu vòng trước khi đặt.',
    seoTitle: 'Cách chọn vòng dâu tằm',
    metaDescription: 'Hướng dẫn chọn vòng tơ tằm theo size và màu chỉ.',
  },
  {
    name: 'Quy trình thủ công',
    slug: 'quy-trinh-thu-cong',
    description: 'Các bước làm vòng từ tơ tằm tại xưởng nhỏ.',
    seoTitle: 'Quy trình làm vòng thủ công',
    metaDescription: 'Từ búi tơ đến vòng hoàn chỉnh, làm từng bước.',
  },
  {
    name: 'Chăm sóc vòng',
    slug: 'cham-soc-vong',
    description: 'Cách bảo quản và đeo vòng tơ tằm hàng ngày.',
    seoTitle: 'Chăm sóc vòng dâu tằm',
    metaDescription: 'Mẹo giữ vòng bền, sạch và đẹp lâu hơn.',
  },
  {
    name: 'Góc mẹ và bé',
    slug: 'goc-me-va-be',
    description: 'Chia sẻ nhẹ về đặt vòng cho bé và thói quen đeo.',
    seoTitle: 'Vòng dâu tằm cho mẹ và bé',
    metaDescription: 'Gợi ý đặt vòng, size và màu cho bé.',
  },
  {
    name: 'Mix charm',
    slug: 'mix-charm',
    description: 'Ý tưởng mix charm bạc, đá và hạt cùng vòng tơ.',
    seoTitle: 'Mix charm với vòng dâu tằm',
    metaDescription: 'Gợi ý phối charm đơn giản, dễ nhìn.',
  },
  {
    name: 'Câu hỏi thường gặp',
    slug: 'cau-hoi-thuong-gap',
    description: 'Giải đáp ngắn về đặt hàng, size và giao nhận.',
    seoTitle: 'FAQ vòng dâu tằm',
    metaDescription: 'Câu hỏi thường gặp khi đặt vòng tơ tằm.',
  },
  {
    name: 'Câu chuyện xưởng',
    slug: 'cau-chuyen-xuong',
    description: 'Ghi chép nhỏ về công việc làm vòng thủ công.',
    seoTitle: 'Câu chuyện xưởng vòng dâu tằm',
    metaDescription: 'Nhật ký làm vòng từ tơ tằm tại xưởng.',
  },
  {
    name: 'Mùa và màu sắc',
    slug: 'mua-va-mau-sac',
    description: 'Gợi ý màu chỉ theo mùa và dịp đặc biệt.',
    seoTitle: 'Màu chỉ vòng theo mùa',
    metaDescription: 'Chọn màu chỉ vòng tơ tằm theo mùa và dịp.',
  },
  {
    name: 'Hướng dẫn đặt hàng',
    slug: 'huong-dan-dat-hang',
    description: 'Các bước đặt vòng, ghi chú size và thời gian nhận.',
    seoTitle: 'Hướng dẫn đặt vòng dâu tằm',
    metaDescription: 'Cách đặt hàng vòng tơ tằm nhanh và rõ ràng.',
  },
  {
    name: 'Góc chia sẻ',
    slug: 'goc-chia-se',
    description: 'Bài linh tinh, ghi chú và bản nháp công khai/nháp.',
    seoTitle: 'Góc chia sẻ vòng dâu tằm',
    metaDescription: 'Bài chia sẻ ngắn về vòng tơ tằm thủ công.',
  },
];

const TAGS = [
  { name: 'Size vòng', slug: 'size-vong', description: 'Bài nói về chọn size.', robots: 'index' },
  { name: 'Màu chỉ', slug: 'mau-chi', description: 'Bài về màu chỉ và phối màu.', robots: 'index' },
  { name: 'Charm bạc', slug: 'charm-bac', description: 'Mix charm bạc với vòng.', robots: 'noindex' },
  { name: 'Cho bé', slug: 'cho-be', description: 'Nội dung liên quan đặt vòng cho bé.', robots: 'index' },
  { name: 'Bảo quản', slug: 'bao-quan', description: 'Cách giữ vòng bền đẹp.', robots: 'index' },
  { name: 'Đặt hàng', slug: 'dat-hang', description: 'Hướng dẫn đặt và giao nhận.', robots: 'noindex' },
  { name: 'Thủ công', slug: 'thu-cong', description: 'Quy trình làm tay.', robots: 'index' },
  { name: 'Tết', slug: 'tet', description: 'Gợi ý mùa Tết.', robots: 'noindex' },
  { name: 'Sinh nhật', slug: 'sinh-nhat', description: 'Gợi ý làm quà sinh nhật.', robots: 'noindex' },
  { name: 'FAQ', slug: 'faq', description: 'Câu hỏi thường gặp.', robots: 'index' },
  { name: 'Demo test', slug: 'demo-test', description: 'Thẻ phục vụ dữ liệu demo.', robots: 'noindex' },
  { name: 'Mới cập nhật', slug: 'moi-cap-nhat', description: 'Bài mới hoặc vừa sửa.', robots: 'noindex' },
];

const TITLE_SEEDS = [
  'Cách chọn size vòng dâu tằm cho bé',
  'Màu chỉ nào dễ phối với outfit hàng ngày',
  'Ba bước kiểm tra vòng trước khi nhận hàng',
  'Mix charm bạc tối giản với vòng tơ',
  'Vòng trơn và vòng mix khác nhau thế nào',
  'Nên hỏi gì khi đặt vòng làm quà',
  'Bảo quản vòng khi bé chơi nước',
  'Gợi ý màu chỉ cho mùa hè',
  'Gợi ý màu chỉ cho mùa đông',
  'Cách đo cổ tay để chọn size vừa',
  'Thời gian làm một vòng thủ công',
  'Vì sao mỗi vòng có sắc tơ hơi khác',
  'Đặt vòng theo ngày nhận hàng như thế nào',
  'Charm chuông và charm đá khác nhau ra sao',
  'Vòng người lớn chọn size thế nào',
  'Checklist đóng gói trước khi gửi hàng',
  'Cách chụp ảnh vòng rõ nét trên điện thoại',
  'Phân biệt tơ tằm và chỉ tổng hợp',
  'Khi nào nên thay vòng mới',
  'Gợi ý set vòng mẹ và bé cùng tone',
  'Lưu ý khi đeo vòng lần đầu',
  'Vòng làm quà sinh nhật cần ghi chú gì',
  'Vòng làm quà thôi nôi: chọn size sao cho vừa',
  'Cách ghi chú màu chỉ khi đặt nhiều vòng',
  'Vòng mix hoa sen mặc với đồ gì',
  'Vòng mix hổ phách nhìn thế nào trên tay',
  'Vòng dây ngũ sắc hợp dịp nào',
  'Những câu hỏi hay gặp lúc tư vấn size',
  'Xưởng xử lý đơn gấp như thế nào',
  'Vì sao slug bài viết cần ổn định',
];

function runSql(sql, label) {
  const file = path.join(os.tmpdir(), `blogvdt-demo-posts-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`);
  fs.writeFileSync(file, sql, 'utf8');
  const result = spawnSync(process.execPath, [wranglerJs, 'd1', 'execute', 'vong-dau-tam', '--local', '--file', file], {
    cwd: projectDir,
    encoding: 'utf8',
  });
  fs.unlinkSync(file);
  if (result.status !== 0) {
    console.error(result.stdout || '');
    console.error(result.stderr || '');
    throw new Error(label || 'Wrangler D1 execute thất bại.');
  }
  return result.stdout || '';
}

function queryJson(command) {
  const result = spawnSync(
    process.execPath,
    [wranglerJs, 'd1', 'execute', 'vong-dau-tam', '--local', '--json', '--command', command],
    { cwd: projectDir, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || '');
    throw new Error(`Query thất bại: ${command}`);
  }
  const parsed = JSON.parse(result.stdout);
  return parsed[0]?.results ?? [];
}

function sqlStr(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function slugify(input) {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

function tipTapDoc(paragraphs, heading = '') {
  /** @type {object[]} */
  const content = [];
  if (heading) {
    content.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: heading }] });
  }
  for (const text of paragraphs) {
    content.push({ type: 'paragraph', content: [{ type: 'text', text }] });
  }
  return JSON.stringify({ type: 'doc', content });
}

function titleFor(index) {
  const base = TITLE_SEEDS[index % TITLE_SEEDS.length];
  const round = Math.floor(index / TITLE_SEEDS.length) + 1;
  if (round === 1) return base;
  return `${base} (bản ${round})`;
}

function bodyFor(index, title) {
  const lines = [
    `${title}. Đây là nội dung demo ngắn để kiểm tra trang quản lý bài viết.`,
    'Vòng dâu tằm trong bài chỉ mang tính minh họa sản phẩm thủ công, không khẳng định công dụng chữa bệnh.',
    index % 3 === 0 ? 'Bạn có thể sửa lại tiêu đề, slug, danh mục và trạng thái trực tiếp trên admin.' : 'Dữ liệu này chỉ dùng trên D1 local.',
  ];
  const heading = index % 4 === 0 ? 'Ghi chú nhanh' : '';
  return tipTapDoc(lines, heading);
}

function excerptFor(title) {
  return `Tóm tắt demo: ${title}`.slice(0, 280);
}

function statusFor(index) {
  // ~70 published, ~22 draft, ~8 trash
  if (index % 12 === 0) return 'trash';
  if (index % 5 === 0) return 'draft';
  return 'published';
}

function main() {
  const admins = queryJson('SELECT id FROM admin_users ORDER BY id LIMIT 1');
  const adminId = admins[0]?.id;
  if (!adminId) throw new Error('Chưa có admin_users. Chạy npm run db:seed:local trước.');

  const mediaRows = queryJson('SELECT id FROM media ORDER BY id');
  const mediaIds = mediaRows.map((row) => row.id);

  console.log(`Admin #${adminId}; media có sẵn: ${mediaIds.length}`);

  runSql(
    [
      'DELETE FROM post_tags;',
      'DELETE FROM post_categories;',
      'DELETE FROM posts;',
      'DELETE FROM tags;',
      'DELETE FROM categories;',
    ].join('\n'),
    'Xóa bài viết / danh mục / thẻ cũ',
  );

  const catSql = CATEGORIES.map((cat, i) => {
    const id = i + 1;
    const t = NOW - (CATEGORIES.length - i) * DAY;
    return `(${id}, ${sqlStr(cat.name)}, ${sqlStr(cat.slug)}, ${sqlStr(cat.description)}, ${sqlStr(cat.seoTitle)}, ${sqlStr(cat.metaDescription)}, ${t}, ${t})`;
  }).join(',\n');

  runSql(
    `INSERT INTO categories (id, name, slug, description, seo_title, meta_description, created_at, updated_at) VALUES\n${catSql};`,
    'Insert categories',
  );

  const tagSql = TAGS.map((tag, i) => {
    const id = i + 1;
    const t = NOW - (TAGS.length - i) * DAY;
    return `(${id}, ${sqlStr(tag.name)}, ${sqlStr(tag.slug)}, ${sqlStr(tag.description)}, NULL, NULL, ${sqlStr(tag.robots)}, ${t}, ${t})`;
  }).join(',\n');

  runSql(
    `INSERT INTO tags (id, name, slug, description, seo_title, meta_description, robots, created_at, updated_at) VALUES\n${tagSql};`,
    'Insert tags',
  );

  /** @type {string[]} */
  const postRows = [];
  /** @type {string[]} */
  const postCatRows = [];
  /** @type {string[]} */
  const postTagRows = [];
  const usedSlugs = new Set();

  for (let i = 0; i < POST_COUNT; i += 1) {
    const id = i + 1;
    const title = titleFor(i);
    let slug = `${slugify(title)}-${String(id).padStart(3, '0')}`;
    if (usedSlugs.has(slug)) slug = `bai-demo-${String(id).padStart(3, '0')}`;
    usedSlugs.add(slug);

    const kind = statusFor(i);
    const status = kind === 'trash' ? (i % 2 === 0 ? 'published' : 'draft') : kind;
    const primaryCat = (i % CATEGORIES.length) + 1;
    const secondCat = ((i + 3) % CATEGORIES.length) + 1;
    const createdAt = NOW - (POST_COUNT - i) * (DAY / 3);
    const updatedAt = createdAt + (i % 7) * 3_600_000;
    const publishedAt = status === 'published' || kind === 'trash' ? createdAt + 3_600_000 : null;
    const deletedAt = kind === 'trash' ? updatedAt + 86_400_000 : null;
    const deletedBy = deletedAt ? adminId : null;
    const cover =
      mediaIds.length === 0 || i % 7 === 0 ? null : mediaIds[i % mediaIds.length];
    const contentJson = bodyFor(i, title);
    const excerpt = excerptFor(title);
    const seoTitle = `${title} | Demo`;
    const metaDescription = `Mô tả SEO demo cho bài: ${title}`.slice(0, 280);

    postRows.push(
      `(${id}, ${primaryCat}, ${sqlStr(title)}, ${sqlStr(slug)}, ${sqlStr(excerpt)}, ${cover === null ? 'NULL' : cover}, ${sqlStr(contentJson)}, ${sqlStr(seoTitle)}, ${sqlStr(metaDescription)}, ${sqlStr(status)}, ${publishedAt === null ? 'NULL' : publishedAt}, ${deletedAt === null ? 'NULL' : deletedAt}, ${deletedBy === null ? 'NULL' : deletedBy}, ${adminId}, ${createdAt}, ${updatedAt})`,
    );

    postCatRows.push(`(${id}, ${primaryCat})`);
    if (secondCat !== primaryCat && i % 2 === 0) postCatRows.push(`(${id}, ${secondCat})`);

    const tagCount = i % 4;
    const tagIds = new Set();
    for (let t = 0; t < tagCount; t += 1) tagIds.add(((i + t * 3) % TAGS.length) + 1);
    // Gắn thẻ demo-test cho mọi bài để lọc dễ.
    tagIds.add(TAGS.findIndex((tag) => tag.slug === 'demo-test') + 1);
    if (i < 15) tagIds.add(TAGS.findIndex((tag) => tag.slug === 'moi-cap-nhat') + 1);
    for (const tagId of tagIds) {
      if (tagId > 0) postTagRows.push(`(${id}, ${tagId})`);
    }
  }

  const chunkSize = 25;
  for (let start = 0; start < postRows.length; start += chunkSize) {
    const chunk = postRows.slice(start, start + chunkSize).join(',\n');
    runSql(
      `INSERT INTO posts (id, category_id, title, slug, excerpt, cover_media_id, content_json, seo_title, meta_description, status, published_at, deleted_at, deleted_by, author_id, created_at, updated_at) VALUES\n${chunk};`,
      `Insert posts ${start + 1}-${Math.min(start + chunkSize, postRows.length)}`,
    );
  }

  for (let start = 0; start < postCatRows.length; start += 80) {
    const chunk = postCatRows.slice(start, start + 80).join(',\n');
    runSql(`INSERT INTO post_categories (post_id, category_id) VALUES\n${chunk};`, 'Insert post_categories');
  }

  for (let start = 0; start < postTagRows.length; start += 80) {
    const chunk = postTagRows.slice(start, start + 80).join(',\n');
    runSql(`INSERT INTO post_tags (post_id, tag_id) VALUES\n${chunk};`, 'Insert post_tags');
  }

  const summary = queryJson(`
    SELECT
      (SELECT COUNT(*) FROM categories) AS categories,
      (SELECT COUNT(*) FROM tags) AS tags,
      (SELECT COUNT(*) FROM posts) AS posts,
      (SELECT COUNT(*) FROM posts WHERE deleted_at IS NULL AND status = 'published') AS published,
      (SELECT COUNT(*) FROM posts WHERE deleted_at IS NULL AND status = 'draft') AS draft,
      (SELECT COUNT(*) FROM posts WHERE deleted_at IS NOT NULL) AS trash,
      (SELECT COUNT(*) FROM post_categories) AS post_categories,
      (SELECT COUNT(*) FROM post_tags) AS post_tags
  `);

  console.log(JSON.stringify(summary[0] ?? {}, null, 2));
  console.log('Xong seed demo bài viết (local).');
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
