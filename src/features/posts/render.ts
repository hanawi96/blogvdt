import type { JSONContent } from '@tiptap/core';
import { escapeHTMLAttribute, renderToHTMLString, serializeChildrenToHTMLString } from '@tiptap/static-renderer';
import { isHttpUrl } from '../../lib/http';
import { isMediaSrc } from './content';
import { postExtensions } from './extensions';
import { collectHeadings } from './headings';

export function renderPostHtml(content: JSONContent): string {
  const ids = collectHeadings(content).map((item) => item.id);
  let headingIndex = 0;
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
          if (!isMediaSrc(src)) return '';
          const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : '';
          return `<img src="${escapeHTMLAttribute(src)}" alt="${escapeHTMLAttribute(alt)}" loading="lazy" />`;
        },
      },
      markMapping: {
        link: ({ mark, children }) => {
          const href = typeof mark.attrs.href === 'string' ? mark.attrs.href : '';
          const inner = serializeChildrenToHTMLString(children);
          if (!isHttpUrl(href)) return inner;
          return `<a href="${escapeHTMLAttribute(href)}">${inner}</a>`;
        },
      },
    },
  });
}
