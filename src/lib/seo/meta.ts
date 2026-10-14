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
  const base = origin.endsWith('/') ? origin.slice(0, -1) : origin;
  const path = input.path && input.path.startsWith('/') ? input.path : '/';
  return {
    title: input.title,
    description: input.description,
    canonical: `${base}${path}`,
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
  image?: string | null;
  publishedTime?: string;
  modifiedTime?: string;
  siteName: string;
  logo?: string | null;
}): Record<string, unknown> {
  const publisher: Record<string, unknown> = { '@type': 'Organization', name: input.siteName };
  if (input.logo) publisher.logo = { '@type': 'ImageObject', url: input.logo };
  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: input.headline,
    description: input.description,
    inLanguage: 'vi',
    mainEntityOfPage: { '@type': 'WebPage', '@id': input.canonical },
    author: { '@type': 'Organization', name: input.siteName },
    publisher,
  };
  if (input.publishedTime) schema.datePublished = input.publishedTime;
  if (input.modifiedTime) schema.dateModified = input.modifiedTime;
  if (input.image) schema.image = input.image;
  return schema;
}

export function breadcrumbSchema(origin: string, items: Array<{ name: string; path: string }>): Record<string, unknown> {
  const base = origin.endsWith('/') ? origin.slice(0, -1) : origin;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: `${base}${item.path}`,
    })),
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
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export function toAbsoluteUrl(origin: string, value: string | null | undefined): string | null {
  const base = origin.endsWith('/') ? origin.slice(0, -1) : origin;
  return absoluteUrl(base, value);
}

function absoluteUrl(origin: string, value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith('https://') || value.startsWith('http://')) return value;
  if (value.startsWith('/')) return `${origin}${value}`;
  return null;
}
