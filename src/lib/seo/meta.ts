export type PageMeta = {
  title: string;
  description: string;
  canonical: string;
  image: string | null;
  robots: string;
  type: 'website' | 'article';
  siteName: string;
  publishedTime?: string;
  modifiedTime?: string;
};

export type MetaCorpus = { titles: string[]; descriptions: string[] };

export const KNOWLEDGE_LIST_DESCRIPTION = 'Bài viết về cách nhìn vòng tơ tằm thủ công và quy trình làm tại xưởng.';

export function plainMetaText(value: string | null | undefined): string {
  return (value ?? '').replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function documentTitle(headline: string, siteName: string, page = 1): string {
  const name = plainMetaText(siteName);
  let head = plainMetaText(headline);
  if (name && head.endsWith(`| ${name}`)) head = head.slice(0, -(name.length + 3)).trim();
  if (page > 1 && head) head = `${head} — trang ${page}`;
  if (!head) return name;
  if (!name || head === name) return head;
  return `${head} | ${name}`;
}

export function homePageMeta(site: {
  siteName: string;
  siteDescription: string;
  defaultSeoTitle: string;
  defaultSeoDescription: string;
}): { title: string; description: string } {
  return {
    title: plainMetaText(site.defaultSeoTitle) || plainMetaText(site.siteName),
    description: plainMetaText(site.defaultSeoDescription) || plainMetaText(site.siteDescription) || 'Vòng tơ tằm làm thủ công.',
  };
}

export function knowledgeListMeta(siteName: string, page = 1): { title: string; description: string } {
  return { title: documentTitle('Kiến thức', siteName, page), description: KNOWLEDGE_LIST_DESCRIPTION };
}

export function postPageMeta(input: {
  title: string;
  seoTitle?: string | null;
  metaDescription?: string | null;
  excerpt?: string | null;
  siteName: string;
}): { title: string; description: string } {
  const headline = plainMetaText(input.seoTitle) || plainMetaText(input.title);
  const description = plainMetaText(input.metaDescription) || plainMetaText(input.excerpt) || (headline ? `Bài viết ${plainMetaText(input.title)}.` : 'Không tìm thấy bài viết.');
  return { title: documentTitle(headline, input.siteName), description };
}

export function categoryPageMeta(
  category: { name: string; description: string | null; seoTitle: string | null; metaDescription: string | null },
  siteName: string,
  page = 1,
): { title: string; description: string } {
  const name = plainMetaText(category.name);
  const headline = plainMetaText(category.seoTitle) || name;
  const description = plainMetaText(category.metaDescription) || plainMetaText(category.description) || (name ? `Bài viết trong danh mục ${name}.` : 'Bài viết theo danh mục.');
  return { title: documentTitle(headline, siteName, page), description };
}

export function policyPageMeta(policy: { title: string; description: string }, siteName: string): { title: string; description: string } {
  return { title: documentTitle(policy.title, siteName), description: plainMetaText(policy.description) };
}

export function notFoundMeta(): { title: string; description: string } {
  return { title: 'Không tìm thấy trang', description: 'Đường dẫn này không có nội dung công khai.' };
}

export function unavailableMeta(): { title: string; description: string } {
  return { title: 'Chưa sẵn sàng', description: 'Chưa đọc được nội dung website từ database local.' };
}

export function collectMetaCorpus(
  rows: Array<{ seoTitle?: string | null; title?: string | null; name?: string | null; metaDescription?: string | null; description?: string | null; excerpt?: string | null }>,
): MetaCorpus {
  const titles: string[] = [];
  const descriptions: string[] = [];
  for (const row of rows) {
    const title = plainMetaText(row.seoTitle) || plainMetaText(row.title) || plainMetaText(row.name);
    const description = plainMetaText(row.metaDescription) || plainMetaText(row.description) || plainMetaText(row.excerpt);
    if (title) titles.push(title);
    if (description) descriptions.push(description);
  }
  return { titles, descriptions };
}

export function siteListCorpus(): MetaCorpus {
  return { titles: ['Kiến thức'], descriptions: [KNOWLEDGE_LIST_DESCRIPTION] };
}

export function mergeMetaCorpus(...parts: MetaCorpus[]): MetaCorpus {
  return { titles: parts.flatMap((part) => part.titles), descriptions: parts.flatMap((part) => part.descriptions) };
}

export function siteOrigin(requestOrigin: string, configured?: string | null): string {
  return normalizeOrigin(configured) || normalizeOrigin(requestOrigin) || '';
}

export function canonicalUrl(origin: string, path: string): string {
  const base = siteOrigin(origin);
  const official = officialPath(path);
  if (!base || !official) return '';
  return `${base}${official}`;
}

export function buildMeta(
  origin: string,
  input: {
    title: string;
    description: string;
    path?: string;
    image?: string | null;
    robots?: string;
    type?: 'website' | 'article';
    siteName?: string;
    publishedTime?: string;
    modifiedTime?: string;
  },
): PageMeta {
  const base = siteOrigin(origin);
  const path = input.path && input.path.startsWith('/') ? input.path : '/';
  return {
    title: input.title,
    description: input.description,
    canonical: canonicalUrl(base, path),
    image: absoluteUrl(base, input.image),
    robots: input.robots ?? 'index,follow',
    type: input.type ?? 'website',
    siteName: input.siteName || input.title,
    publishedTime: input.publishedTime,
    modifiedTime: input.modifiedTime,
  };
}

export function blogPostingSchema(input: {
  headline: string;
  description: string;
  canonical: string;
  image?: { url: string; width?: number | null; height?: number | null } | null;
  publishedTime?: string;
  modifiedTime?: string;
  siteName: string;
  authorUrl?: string | null;
  logo?: string | null;
}): Record<string, unknown> | null {
  const headline = input.headline.trim();
  const canonical = httpUrl(input.canonical);
  const name = input.siteName.trim();
  if (!headline || !canonical || !name) return null;
  const author: Record<string, unknown> = { '@type': 'Organization', name };
  const authorUrl = httpUrl(input.authorUrl);
  if (authorUrl) author.url = authorUrl;
  const publisher: Record<string, unknown> = { '@type': 'Organization', name };
  if (authorUrl) publisher.url = authorUrl;
  const logo = httpUrl(input.logo);
  if (logo) publisher.logo = { '@type': 'ImageObject', url: logo };
  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline,
    inLanguage: 'vi',
    url: canonical,
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
    author,
    publisher,
  };
  const description = input.description.trim();
  if (description) schema.description = description;
  const published = isoDate(input.publishedTime);
  const modified = isoDate(input.modifiedTime);
  if (published) schema.datePublished = published;
  if (modified && (!published || modified >= published)) schema.dateModified = modified;
  const image = schemaImage(input.image);
  if (image) schema.image = image;
  return schema;
}

export function breadcrumbSchema(origin: string, items: Array<{ name: string; path: string }>): Record<string, unknown> | null {
  const itemListElement = [];
  for (const item of items) {
    const name = item.name.trim();
    const url = canonicalUrl(origin, item.path);
    if (!name || !url) return null;
    itemListElement.push({
      '@type': 'ListItem',
      position: itemListElement.length + 1,
      name,
      item: url,
    });
  }
  if (itemListElement.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement,
  };
}

export function productSchema(input: {
  name: string;
  description: string;
  canonical: string;
  image: string | null;
  price: number;
  siteName: string;
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: input.name,
    description: input.description,
    image: input.image ?? undefined,
    brand: { '@type': 'Brand', name: input.siteName },
    offers: {
      '@type': 'Offer',
      url: input.canonical,
      priceCurrency: 'VND',
      price: input.price,
      availability: 'https://schema.org/InStock',
    },
  };
}

export function jsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data)
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function schemaImage(image: { url: string; width?: number | null; height?: number | null } | null | undefined): Record<string, unknown> | null {
  const url = httpUrl(image?.url);
  if (!url) return null;
  const result: Record<string, unknown> = { '@type': 'ImageObject', url };
  const width = image?.width;
  const height = image?.height;
  if (Number.isInteger(width) && Number.isInteger(height) && (width ?? 0) > 0 && (height ?? 0) > 0) {
    result.width = width;
    result.height = height;
  }
  return result;
}

function isoDate(value: string | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString();
}

function httpUrl(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password || (url.protocol !== 'http:' && url.protocol !== 'https:')) return null;
    return raw;
  } catch {
    return null;
  }
}

export function toAbsoluteUrl(origin: string, value: string | null | undefined): string | null {
  return absoluteUrl(siteOrigin(origin), value);
}

export type ShareTags = {
  title: string;
  description: string;
  url: string | null;
  type: 'website' | 'article';
  image: { url: string; alt: string; width: number | null; height: number | null; mimeType: string } | null;
  card: 'summary' | 'summary_large_image';
};

export function shareOriginFrom(canonical: string | null | undefined, requestOrigin: string): string {
  if (canonical) {
    try {
      const url = new URL(canonical);
      if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password) return url.origin;
    } catch {
      // Origin lấy từ request khi canonical không phải URL tuyệt đối.
    }
  }
  return siteOrigin(requestOrigin);
}

export function shareImageUrl(origin: string, value: string | null | undefined): string | null {
  const base = siteOrigin(origin);
  const absolute = absoluteUrl(base, value);
  if (!absolute || !base) return null;
  try {
    const url = new URL(absolute);
    if (url.origin !== base || url.username || url.password) return null;
    if (!url.pathname.startsWith('/media/') || url.pathname.includes('..')) return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

export function shareMetadata(input: {
  title: string;
  description: string;
  canonical?: string | null;
  type?: 'website' | 'article';
  image?: { url: string; alt?: string | null; width?: number | null; height?: number | null; mimeType?: string | null } | null;
}): ShareTags {
  const title = plainMetaText(input.title);
  const description = plainMetaText(input.description);
  const url = httpUrl(input.canonical);
  const image = shareImageFields(input.image);
  return {
    title,
    description,
    url,
    type: input.type === 'article' ? 'article' : 'website',
    image,
    card: image ? 'summary_large_image' : 'summary',
  };
}

const SHARE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function shareImageFields(image: { url: string; alt?: string | null; width?: number | null; height?: number | null; mimeType?: string | null } | null | undefined): ShareTags['image'] {
  const url = httpUrl(image?.url);
  if (!url) return null;
  let pathname = '';
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith('/media/')) return null;
  if (image?.mimeType && !SHARE_MIME_TYPES.includes(image.mimeType)) return null;
  const width = image?.width;
  const height = image?.height;
  const sized = Number.isInteger(width) && Number.isInteger(height) && (width ?? 0) > 0 && (height ?? 0) > 0;
  return {
    url,
    alt: plainMetaText(image?.alt),
    width: sized ? (width as number) : null,
    height: sized ? (height as number) : null,
    mimeType: image?.mimeType && SHARE_MIME_TYPES.includes(image.mimeType) ? image.mimeType : '',
  };
}

function normalizeOrigin(value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw || /[\u0000-\u001F\u007F\s]/.test(raw)) return '';
  let url: URL;
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    return '';
  }
  if (url.username || url.password || (url.protocol !== 'http:' && url.protocol !== 'https:')) return '';
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === '.') return '';
  const local = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  const protocol = local ? url.protocol : 'https:';
  const port = url.port && url.port !== (protocol === 'https:' ? '443' : '80') ? `:${url.port}` : '';
  const host = hostname.includes(':') ? `[${hostname}]` : hostname;
  return `${protocol}//${host}${port}`;
}

function officialPath(path: string): string {
  const raw = path.trim();
  if (!raw || raw.startsWith('//') || /[\u0000-\u001F\u007F\\]/.test(raw)) return '';
  const pathOnly = raw.split(/[?#]/)[0] ?? '';
  for (const part of pathOnly.split('/')) {
    if (!part) continue;
    try {
      const decoded = decodeURIComponent(part);
      if (decoded === '.' || decoded === '..') return '';
    } catch {
      return '';
    }
  }
  let url: URL;
  try {
    url = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? new URL(raw) : new URL(raw, 'https://canonical.local');
  } catch {
    return '';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  const segments: string[] = [];
  for (const segment of url.pathname.split('/')) {
    if (!segment) continue;
    let decoded = '';
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return '';
    }
    if (!decoded || decoded === '.' || decoded === '..' || /[/?#\\]/.test(decoded)) return '';
    segments.push(encodeURIComponent(decoded));
  }
  const pathname = segments.length === 0 ? '/' : `/${segments.join('/')}`;
  const page = url.searchParams.get('page');
  if (page && /^[1-9]\d{0,5}$/.test(page) && Number(page) > 1) return `${pathname}?page=${Number(page)}`;
  return pathname;
}

function absoluteUrl(origin: string, value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith('https://') || value.startsWith('http://')) return value;
  if (value.startsWith('/')) return `${origin}${value}`;
  return null;
}
