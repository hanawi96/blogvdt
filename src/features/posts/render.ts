import type { JSONContent } from '@tiptap/core';
import { escapeHTMLAttribute, renderToHTMLString, serializeChildrenToHTMLString } from '@tiptap/static-renderer';
import { renderCalloutHtml } from './callout';
import { isExternalHref, isPostHref } from './links';
import { isMediaSrc } from './content';
import { postExtensions } from './extensions';
import { collectHeadings } from './headings';
import { normalizePostCardIds, orderedPostCards, renderPostCardsHtml, type PostCardEmbed } from './post-cards';
import { normalizeProductCardIds, orderedProductCards, renderProductCardsHtml, type ProductCardEmbed } from './product-cards';

export function renderPostHtml(
  content: JSONContent,
  imageSizes: ReadonlyMap<string, { width: number; height: number }> = new Map(),
  options: {
    skip?: ReadonlySet<string>;
    eager?: number;
    cardsById?: ReadonlyMap<number, PostCardEmbed>;
    productCardsById?: ReadonlyMap<number, ProductCardEmbed>;
  } = {},
): string {
  const ids = collectHeadings(content).map((item) => item.id);
  let headingIndex = 0;
  let imageIndex = 0;
  const eager = options.eager ?? 0;
  return renderToHTMLString({
    content,
    extensions: postExtensions(),
    options: {
      nodeMapping: {
        heading: ({ node, children }) => {
          const level = node.attrs.level === 3 ? 3 : 2;
          const id = ids[headingIndex] ?? `muc-${headingIndex}`;
          headingIndex += 1;
          return `<h${level} id="${escapeHTMLAttribute(id)}">${serializeChildrenToHTMLString(children)}</h${level}>`;
        },
        image: ({ node }) => {
          const src = typeof node.attrs.src === 'string' ? node.attrs.src : '';
          if (!isMediaSrc(src) || options.skip?.has(src)) return '';
          const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : '';
          const caption = typeof node.attrs.caption === 'string' ? node.attrs.caption : '';
          const lead = imageIndex < eager;
          imageIndex += 1;
          const loading = lead ? ' fetchpriority="high"' : ' loading="lazy" decoding="async"';
          const img = `<img src="${escapeHTMLAttribute(src)}" alt="${escapeHTMLAttribute(alt)}"${dimensionAttrs(imageSizes.get(src))}${loading} />`;
          if (!caption) return img;
          return `<figure>${img}<figcaption>${escapeHTMLAttribute(caption)}</figcaption></figure>`;
        },
        postCards: ({ node }) => {
          if (!options.cardsById) return '';
          return renderPostCardsHtml(orderedPostCards(normalizePostCardIds(node.attrs.ids), options.cardsById));
        },
        productCards: ({ node }) => {
          if (!options.productCardsById) return '';
          return renderProductCardsHtml(orderedProductCards(normalizeProductCardIds(node.attrs.ids), options.productCardsById));
        },
        callout: ({ node, children }) => renderCalloutHtml(node.attrs.variant, serializeChildrenToHTMLString(children)),
      },
      markMapping: {
        link: ({ mark, children }) => {
          const href = typeof mark.attrs.href === 'string' ? mark.attrs.href : '';
          const inner = serializeChildrenToHTMLString(children);
          if (!isPostHref(href)) return inner;
          const external = isExternalHref(href) ? ' target="_blank" rel="nofollow noopener noreferrer"' : '';
          return `<a href="${escapeHTMLAttribute(href)}"${external}>${inner}</a>`;
        },
      },
    },
  });
}

function dimensionAttrs(size: { width: number; height: number } | undefined): string {
  if (!size || !Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width < 1 || size.height < 1) return '';
  return ` width="${size.width}" height="${size.height}"`;
}
