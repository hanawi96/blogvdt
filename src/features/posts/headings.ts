import { slugify } from './slug';

export type HeadingItem = { id: string; text: string; level: 2 | 3 };

type JsonNode = {
  type?: string;
  text?: string;
  attrs?: { level?: unknown };
  content?: JsonNode[];
};

export function collectHeadings(content: JsonNode): HeadingItem[] {
  const items: HeadingItem[] = [];
  const used = new Set<string>();
  walk(content, items, used);
  return items;
}

function walk(node: JsonNode, items: HeadingItem[], used: Set<string>): void {
  if (node.type === 'heading') {
    const text = textOf(node);
    if (text) {
      const level = node.attrs?.level === 3 ? 3 : 2;
      items.push({ id: uniqueId(slugify(text) || 'muc', used), text, level });
    }
  }
  for (const child of node.content ?? []) walk(child, items, used);
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

function textOf(node: JsonNode): string {
  const own = node.text ?? '';
  const children = (node.content ?? []).map(textOf).join('');
  return `${own}${children}`.replace(/\s+/g, ' ').trim();
}
