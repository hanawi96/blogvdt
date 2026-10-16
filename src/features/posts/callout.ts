import { mergeAttributes, Node } from '@tiptap/core';
import { escapeHTMLAttribute } from '@tiptap/static-renderer';

export const CALLOUT_NODE = 'callout';

export const CALLOUT_VARIANTS = ['tip', 'safety', 'folk'] as const;
export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number];

export const CALLOUT_LABELS: Record<CalloutVariant, string> = {
  tip: 'Mẹo cho mẹ',
  safety: 'Lưu ý an toàn',
  folk: 'Dân gian vs khoa học',
};

export function normalizeCalloutVariant(value: unknown): CalloutVariant {
  return CALLOUT_VARIANTS.includes(value as CalloutVariant) ? (value as CalloutVariant) : 'tip';
}

export function renderCalloutHtml(variantRaw: unknown, innerHtml: string): string {
  const variant = normalizeCalloutVariant(variantRaw);
  const label = CALLOUT_LABELS[variant];
  const body = innerHtml.trim() || '<p></p>';
  return `<aside class="callout callout-${variant}" data-variant="${variant}" aria-label="${escapeHTMLAttribute(label)}"><p class="callout-label">${escapeHTMLAttribute(label)}</p><div class="callout-body">${body}</div></aside>`;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      insertCallout: (variant?: CalloutVariant) => ReturnType;
      setCalloutVariant: (variant: CalloutVariant) => ReturnType;
    };
  }
}

export const Callout = Node.create({
  name: CALLOUT_NODE,
  group: 'block',
  content: 'paragraph+',
  defining: true,

  addAttributes() {
    return {
      variant: {
        default: 'tip' satisfies CalloutVariant,
        parseHTML: (element) => normalizeCalloutVariant(element.getAttribute('data-variant')),
        renderHTML: (attributes) => ({ 'data-variant': normalizeCalloutVariant(attributes.variant) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'aside[data-type="callout"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const variant = normalizeCalloutVariant(node.attrs.variant);
    return [
      'aside',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'callout',
        'data-variant': variant,
        'data-label': CALLOUT_LABELS[variant],
        class: `editor-callout editor-callout-${variant}`,
      }),
      0,
    ];
  },

  addCommands() {
    return {
      insertCallout:
        (variant = 'tip') =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { variant: normalizeCalloutVariant(variant) },
            content: [{ type: 'paragraph' }],
          }),
      setCalloutVariant:
        (variant) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { variant: normalizeCalloutVariant(variant) }),
    };
  },
});
