import { describe, expect, it } from 'vitest';
import {
  HEALTH_BATCH,
  HEALTH_LOAD_ERROR,
  HEALTH_MAX_STEPS,
  HEALTH_PAGE_SIZE,
  HEALTH_RUN_ERROR,
  assessPost,
  collectContentImages,
  healthCodeBreakdown,
  healthFigures,
  healthNote,
  healthScore,
  inboundIssues,
  pageWindow,
  readHealthFilters,
  shouldContinue,
  siteHealthIssues,
  sitemapDecision,
  type HealthPost,
} from './health';

const origin = 'https://example.com';

function post(overrides: Partial<HealthPost> = {}): HealthPost {
  return {
    id: 1,
    title: 'Cách chọn vòng dâu tằm cho bé',
    slug: 'cach-chon-vong-dau-tam',
    excerpt: '',
    seoTitle: 'Cách chọn vòng dâu tằm',
    metaDescription: 'Gợi ý chọn vòng dâu tằm thủ công theo kích thước cổ tay của bé.',
    cover: { kind: 'none' },
    images: [],
    imagesTruncated: false,
    readable: true,
    filesReady: true,
    linkIssues: [],
    linkTruncated: false,
    corpus: { titles: [], descriptions: [] },
    origin,
    blocked: new Set<string>(),
    ...overrides,
  };
}

describe('kiểm tra SEO một bài', () => {
  it('bài đủ tiêu đề, mô tả và slug hợp lệ không phát sinh lỗi', () => {
    expect(assessPost(post())).toEqual([]);
    expect(assessPost(post({ seoTitle: null, title: 'Vòng' }))).toEqual([]);
  });

  it('bắt tiêu đề trống, mô tả trống, trùng và slug hỏng', () => {
    const issues = assessPost(
      post({
        title: '   ',
        seoTitle: null,
        metaDescription: null,
        excerpt: '',
        slug: 'Bad_Slug',
        corpus: { titles: ['Cách chọn vòng dâu tằm'], descriptions: [] },
      }),
    );
    expect(issues.map((issue) => issue.code)).toEqual(['title', 'description', 'slug', 'sitemap']);
    expect(issues.find((issue) => issue.code === 'title')?.severity).toBe('error');
    expect(issues.find((issue) => issue.code === 'description')?.severity).toBe('warning');
    expect(issues.find((issue) => issue.code === 'sitemap')?.detail).toMatch(/sitemap/i);
  });

  it('trùng tiêu đề hoặc mô tả lấy đúng câu của SEO assistant', () => {
    const duplicated = assessPost(post({ corpus: { titles: ['Cách chọn vòng dâu tằm'], descriptions: [] } }));
    expect(duplicated.map((issue) => issue.detail).join(' ')).toMatch(/đã được dùng/);
    const same = assessPost(post({ seoTitle: 'Cùng một câu', metaDescription: 'Cùng một câu' }));
    expect(same.map((issue) => issue.detail).join(' ')).toMatch(/giống nhau/);
  });

  it('slug trùng redirect và canonical rỗng khi chưa có origin', () => {
    const blocked = assessPost(post({ blocked: new Set(['/kien-thuc/cach-chon-vong-dau-tam']) }));
    expect(blocked.map((issue) => issue.code)).toEqual(['slug', 'sitemap']);
    const local = assessPost(post({ origin: '', slug: 'Bad_Slug' }));
    expect(local.map((issue) => issue.code)).toEqual(['slug']);
    expect(siteHealthIssues({ origin: '', filesReady: false }).map((issue) => issue.code)).toEqual(['canonical', 'image']);
  });

  it('ảnh hỏng là lỗi, ALT trống là cảnh báo, không có ảnh thì bỏ qua', () => {
    const broken = assessPost(
      post({
        cover: { kind: 'missing' },
        images: [{ src: '/media/2026/10/missing.webp', alt: '', known: false, state: 'unchecked', failed: false }],
      }),
    );
    expect(broken.find((issue) => issue.code === 'image')?.severity).toBe('error');
    const decorative = assessPost(
      post({
        cover: { kind: 'file', alt: '', state: 'present', failed: false },
      }),
    );
    expect(decorative).toEqual([
      expect.objectContaining({ code: 'alt', severity: 'warning' }),
    ]);
    const offline = assessPost(
      post({
        filesReady: false,
        cover: { kind: 'file', alt: 'Vòng dâu', state: 'unchecked', failed: false },
      }),
    );
    expect(offline).toEqual([]);
  });

  it('liên kết gãy là lỗi, bài không có liên kết nội bộ thì không bị bắt', () => {
    const issues = assessPost(
      post({
        linkIssues: [
          { path: '/kien-thuc/khong-co', kind: 'missing' },
          { path: '/kien-thuc/nhap', kind: 'unpublished' },
          { path: '/kien-thuc/cu', kind: 'redirect', official: '/kien-thuc/moi' },
        ],
        linkTruncated: true,
      }),
    );
    expect(issues.filter((issue) => issue.severity === 'error').map((issue) => issue.detail).join(' ')).toMatch(/không có bài/);
    expect(issues.filter((issue) => issue.severity === 'error').map((issue) => issue.detail).join(' ')).toMatch(/chưa xuất bản/);
    expect(issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.detail).join(' ')).toMatch(/đường dẫn cũ/);
    expect(issues.map((issue) => issue.detail).join(' ')).toMatch(/20 liên kết/);
  });

  it('chỉ kiểm tra 30 ảnh đầu', () => {
    const images = Array.from({ length: 31 }, (_, index) => ({
      src: `/media/2026/10/anh-${index}.webp`,
      alt: index === 30 ? '' : 'Vòng dâu tằm',
    }));
    const content = collectContentImages(JSON.stringify({ type: 'doc', content: images.map((image) => ({ type: 'image', attrs: image })) }));
    expect(content.truncated).toBe(true);
    expect(content.images).toHaveLength(30);
    expect(content.images.some((image) => image.src.endsWith('anh-30.webp'))).toBe(false);
  });
});

describe('sitemap và bài chưa được trỏ tới', () => {
  it('chỉ bài xuất bản, slug hợp lệ, không bị redirect và có canonical mới vào sitemap', () => {
    const blocked = new Set(['/kien-thuc/cach-chon-vong-dau-tam']);
    expect(sitemapDecision({ status: 'draft', slug: 'cach-chon-vong-dau-tam', origin, blocked: new Set() }).included).toBe(false);
    expect(sitemapDecision({ status: 'published', slug: 'Bad_Slug', origin, blocked: new Set() }).included).toBe(false);
    expect(sitemapDecision({ status: 'published', slug: 'cach-chon-vong-dau-tam', origin, blocked }).included).toBe(false);
    expect(sitemapDecision({ status: 'published', slug: 'cach-chon-vong-dau-tam', origin: '', blocked: new Set() }).included).toBe(false);
    expect(sitemapDecision({ status: 'published', slug: 'cach-chon-vong-dau-tam', origin, blocked: new Set() }).included).toBe(true);
  });

  it('bài xuất bản không có bài khác trỏ tới là cảnh báo, bài đã có link thì bỏ qua', () => {
    const issues = inboundIssues(
      [
        { id: 1, title: 'Mồ côi', slug: 'mo-coi' },
        { id: 2, title: 'Đã được trỏ', slug: 'da-duoc-tro' },
        { id: 3, title: 'Slug hỏng', slug: 'Slug_Hong' },
      ],
      new Set(['/kien-thuc/da-duoc-tro']),
      false,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ postId: 1, severity: 'warning', code: 'inbound' });
    expect(issues[0]?.detail).toMatch(/Chưa thấy bài viết đã xuất bản/);
  });
});

describe('phân trang, lô và mất kết nối', () => {
  it('1000 lỗi chỉ lấy một trang 20 dòng và không giữ một request cho cả thư viện', () => {
    const window = pageWindow(1000, 3, HEALTH_PAGE_SIZE);
    expect(window).toEqual({ page: 3, pageCount: 50, offset: 40, limit: 20 });
    expect(pageWindow(1000, 999, HEALTH_PAGE_SIZE).page).toBe(50);
    expect(pageWindow(0, 4, HEALTH_PAGE_SIZE)).toEqual({ page: 1, pageCount: 1, offset: 0, limit: 20 });
    expect(HEALTH_BATCH * HEALTH_MAX_STEPS).toBeLessThan(100);
    expect(shouldContinue(0, 0, 0)).toBe(true);
    expect(shouldContinue(0, 5_000, 1)).toBe(false);
    expect(shouldContinue(0, 10, HEALTH_MAX_STEPS)).toBe(false);
  });

  it('bộ lọc sai và mất kết nối không biến thành 0 lỗi', () => {
    expect(readHealthFilters(new URLSearchParams('severity=nope&code=title&post=0&page=2'))).toEqual({
      severity: '',
      code: 'title',
      postId: null,
      page: 2,
    });
    expect(healthFigures({ failed: true, hasRun: true, errors: 0, warnings: 0, verified: 4, pending: 0 })).toEqual({
      errors: '—',
      warnings: '—',
      verified: '—',
      pending: '—',
    });
    expect(healthFigures({ failed: false, hasRun: false, errors: 0, warnings: 0, verified: 0, pending: 4 }).errors).toBe('—');
    expect(HEALTH_LOAD_ERROR).not.toMatch(/0 lỗi/);
    expect(HEALTH_RUN_ERROR).toMatch(/đã lưu/);
    expect(healthNote({ failed: false, phase: null, whenLabel: '', published: 4, verified: 0, unchecked: 4, stale: 0 })).toMatch(/chưa được xác minh/);
    expect(
      healthNote({ failed: false, phase: 'posts', whenLabel: '15/10/2026 14:00', published: 4, verified: 1, unchecked: 3, stale: 0 }),
    ).toMatch(/phần đã xác minh/);
    expect(
      healthNote({ failed: false, phase: 'done', whenLabel: '15/10/2026 14:00', published: 4, verified: 3, unchecked: 1, stale: 1 }),
    ).toMatch(/cần xác minh lại/);
  });
});

describe('gom lỗi theo loại và điểm sức khỏe', () => {
  it('breakdown chỉ giữ loại có lỗi, gộp đúng severity và đẩy loại nhiều lỗi nghiêm trọng lên trên', () => {
    const stats = healthCodeBreakdown([
      { code: 'title', severity: 'error', value: 2 },
      { code: 'title', severity: 'warning', value: 1 },
      { code: 'image', severity: 'error', value: 5 },
      { code: 'description', severity: 'warning', value: 3 },
      { code: 'khong-hop-le', severity: 'error', value: 9 },
    ]);
    expect(stats.map((item) => item.code)).toEqual(['image', 'title', 'description']);
    expect(stats[0]).toMatchObject({ code: 'image', errors: 5, warnings: 0, total: 5 });
    expect(stats[1]).toMatchObject({ code: 'title', errors: 2, warnings: 1, total: 3, label: 'SEO title' });
  });

  it('điểm sức khỏe dùng mẫu số chốt lúc run, giới hạn 0–100 và báo ready theo phase done', () => {
    expect(healthScore({ phase: 'done', publishedTotal: 10, published: 12, cleanPosts: 8 })).toEqual({
      score: 80,
      cleanPosts: 8,
      denominator: 10,
      ready: true,
    });
    // run cũ chưa có publishedTotal thì lùi về published hiện tại
    expect(healthScore({ phase: 'done', publishedTotal: 0, published: 4, cleanPosts: 4 }).score).toBe(100);
    // chưa có bài xuất bản: coi như khỏe, không chia cho 0
    expect(healthScore({ phase: 'done', publishedTotal: 0, published: 0, cleanPosts: 0 })).toEqual({
      score: 100,
      cleanPosts: 0,
      denominator: 0,
      ready: true,
    });
    // cleanPosts không vượt mẫu số, chưa done thì ready=false
    expect(healthScore({ phase: 'posts', publishedTotal: 5, published: 5, cleanPosts: 99 })).toEqual({
      score: 100,
      cleanPosts: 5,
      denominator: 5,
      ready: false,
    });
  });
});
