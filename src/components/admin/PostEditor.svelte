<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { Editor, type JSONContent } from '@tiptap/core';
  import { CALLOUT_LABELS, CALLOUT_VARIANTS, normalizeCalloutVariant, type CalloutVariant } from '../../features/posts/callout';
  import { isMediaSrc } from '../../features/posts/content';
  import { editorHotkeyCheatSheet, editorHotkeyTip, editorModLabel } from '../../features/posts/editor-hotkeys';
  import { postExtensions } from '../../features/posts/extensions';
  import { canMoveSelectedImage, moveSelectedImage } from '../../features/posts/image-move';
  import { isPostHref, postPathFromHref, type InternalLinkHit, type PostLinkIssue } from '../../features/posts/links';
  import { normalizePostCardIds, normalizePostCardLabels, POST_CARDS_MAX, type PostCardRef } from '../../features/posts/post-cards';
  import {
    normalizeProductCardCovers,
    normalizeProductCardIds,
    normalizeProductCardLabels,
    PRODUCT_CARDS_MAX,
    type ProductCardRef,
  } from '../../features/posts/product-cards';
  import {
    clampSlashIndex,
    filterSlashCommands,
    slashRangeFromState,
    type SlashCommand,
    type SlashCommandId,
  } from '../../features/posts/slash-menu';
  import { routes } from '../../lib/routes';
  import MediaPicker from './MediaPicker.svelte';
  import type { MediaItem } from '../../features/media/types';

  const modKey = editorModLabel();
  const hotkeyHint = editorHotkeyCheatSheet(modKey);
  const tip = (label: string, chord: string) => editorHotkeyTip(label, chord, modKey);

  let {
    csrf,
    media = [],
    contentJson = '{"type":"doc","content":[]}',
    contentError = '',
  }: { csrf: string; media?: MediaItem[]; contentJson?: string; contentError?: string } = $props();

  let host: HTMLDivElement | undefined = $state();
  let toolbarEl: HTMLDivElement | undefined = $state();
  let toolbarPinEl: HTMLSpanElement | undefined = $state();
  let stickyEl: HTMLDivElement | undefined = $state();
  let editor = $state<Editor | null>(null);
  let json = $state(untrack(() => contentJson));
  let revision = $state(0);
  let linkUrl = $state('');
  let linkQuery = $state('');
  let linkHits = $state<InternalLinkHit[]>([]);
  let suggestions = $state<Array<{ title: string; path: string; kind?: InternalLinkHit['kind'] }>>([]);
  let linkIssue = $state<PostLinkIssue | null>(null);
  let linkNote = $state('');
  let linkError = $state('');
  let linkText = $state('');
  let linkNeedsText = $state(false);
  let linkHasMark = $state(false);
  let linkOpen = $state(false);
  let linkDialog: HTMLDialogElement | undefined = $state();
  let linkUrlEl: HTMLInputElement | undefined = $state();
  let linkTimer = 0;
  let issueTimer = 0;
  let linkBubble = $state({ show: false, href: '', top: 0, left: 0 });
  let menu = $state<'heading' | 'callout' | null>(null);
  let libraryOpen = $state(false);
  let imageAlt = $state('');
  let imageCaption = $state('');
  let cardsOpen = $state(false);
  let cardsEditing = $state(false);
  let cardsQuery = $state('');
  let cardsHits = $state<PostCardRef[]>([]);
  let cardsSelected = $state<PostCardRef[]>([]);
  let cardsNote = $state('');
  let cardsError = $state('');
  let cardsDialog: HTMLDialogElement | undefined = $state();
  let cardsTimer = 0;
  let productsOpen = $state(false);
  let productsEditing = $state(false);
  let productsQuery = $state('');
  let productsHits = $state<ProductCardRef[]>([]);
  let productsSelected = $state<ProductCardRef[]>([]);
  let productsNote = $state('');
  let productsError = $state('');
  let productsTop = $state(false);
  let productsDialog: HTMLDialogElement | undefined = $state();
  let productsTimer = 0;
  let slashOpen = $state(false);
  let slashItems = $state<SlashCommand[]>([]);
  let slashIndex = $state(0);
  let slashPos = $state({ top: 0, left: 0 });
  /** Ref đồng bộ cho handleKeyDown — tránh recreate Editor. */
  const slashGate = {
    open: false,
    index: 0,
    from: 0,
    to: 0,
    query: '',
    items: [] as SlashCommand[],
  };

  function syncImage(current: Editor) {
    if (!current.isActive('image')) return;
    const attrs = current.getAttributes('image') as { alt?: unknown; caption?: unknown };
    const alt = typeof attrs.alt === 'string' ? attrs.alt : '';
    const caption = typeof attrs.caption === 'string' ? attrs.caption : '';
    if (alt !== imageAlt) imageAlt = alt;
    if (caption !== imageCaption) imageCaption = caption;
  }

  function notifyForm() {
    void tick().then(() => {
      host?.dispatchEvent(new CustomEvent('post-input', { bubbles: true }));
    });
  }

  onMount(() => {
    // TipTap normalize JSON lúc mount — chưa coi là edit của user.
    let acceptEdits = false;
    const content = parseContent(untrack(() => contentJson));
    const instance = new Editor({
      element: host,
      content,
      extensions: postExtensions(),
      onUpdate: ({ editor: current }) => {
        json = JSON.stringify(current.getJSON());
        revision += 1;
        syncImage(current);
        syncLinkBubble(current);
        syncSlashMenu(current);
        if (acceptEdits) notifyForm();
      },
      onSelectionUpdate: ({ editor: current }) => {
        revision += 1;
        syncImage(current);
        syncLinkBubble(current);
        syncSlashMenu(current);
      },
      editorProps: {
        attributes: { 'aria-label': 'Nội dung bài viết' },
        transformPastedHTML(html) {
          const pasted = new DOMParser().parseFromString(html, 'text/html');
          for (const image of pasted.querySelectorAll('img')) {
            if (!isMediaSrc(image.getAttribute('src') ?? '')) image.remove();
          }
          return pasted.body.innerHTML;
        },
        handlePaste(_view, event) {
          const files = event.clipboardData?.files;
          const html = event.clipboardData?.getData('text/html') ?? '';
          const text = event.clipboardData?.getData('text/plain') ?? '';
          if (!files?.length || html || text) return false;
          event.preventDefault();
          return true;
        },
        handleKeyDown(_view, event) {
          if (!slashGate.open) return false;
          if (event.key === 'Escape') {
            closeSlashMenu(true);
            return true;
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            slashGate.index = clampSlashIndex(slashGate.index + 1, slashGate.items.length);
            slashIndex = slashGate.index;
            return true;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            slashGate.index = clampSlashIndex(slashGate.index - 1, slashGate.items.length);
            slashIndex = slashGate.index;
            return true;
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            const pick = slashGate.items[slashGate.index];
            if (!pick) return false;
            event.preventDefault();
            void runSlashCommand(pick.id);
            return true;
          }
          return false;
        },
      },
    });
    editor = instance;
    json = JSON.stringify(instance.getJSON());
    void tick().then(() => {
      json = JSON.stringify(instance.getJSON());
      return tick();
    }).then(() => {
      acceptEdits = true;
      host?.dispatchEvent(new CustomEvent('post-editor-ready', { bubbles: true }));
    });
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (slashGate.open && !(target instanceof Element && target.closest('.editor-slash'))) {
        closeSlashMenu(false);
      }
      if (menu === null) return;
      if (toolbarEl?.contains(target)) return;
      menu = null;
    };
    const onCardsEdit = () => openCards(true);
    const onProductsEdit = () => openProducts(true);
    host?.addEventListener('post-cards-edit', onCardsEdit);
    host?.addEventListener('product-cards-edit', onProductsEdit);
    document.addEventListener('pointerdown', onPointerDown);

    const syncStuck = () => {
      if (!stickyEl || !toolbarPinEl) return;
      const root = stickyEl.closest('.post-write');
      const topRaw = root instanceof HTMLElement ? getComputedStyle(root).getPropertyValue('--editor-toolbar-top') : '';
      const topPx = Number.parseFloat(topRaw) || 60;
      const stuck = toolbarPinEl.getBoundingClientRect().top < topPx;
      stickyEl.classList.toggle('is-stuck', stuck);
    };
    const onViewport = () => {
      syncStuck();
      syncLinkBubble(instance);
      if (slashGate.open) syncSlashMenu(instance);
    };
    syncStuck();
    window.addEventListener('scroll', onViewport, { passive: true, capture: true });
    window.addEventListener('resize', onViewport);

    return () => {
      host?.removeEventListener('post-cards-edit', onCardsEdit);
      host?.removeEventListener('product-cards-edit', onProductsEdit);
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', onViewport, true);
      window.removeEventListener('resize', onViewport);
      instance.destroy();
    };
  });

  function run(command: (current: Editor) => void) {
    menu = null;
    if (slashGate.open) closeSlashMenu(true);
    if (editor) command(editor);
  }

  function closeSlashMenu(clearQuery: boolean) {
    if (clearQuery && editor && slashGate.open && slashGate.to >= slashGate.from) {
      const { from, to } = slashGate;
      slashGate.open = false;
      editor.chain().focus().deleteRange({ from, to }).run();
    } else {
      slashGate.open = false;
    }
    slashGate.items = [];
    slashGate.index = 0;
    slashGate.query = '';
    if (slashOpen) slashOpen = false;
    if (slashItems.length) slashItems = [];
  }

  function syncSlashMenu(current: Editor) {
    if (linkOpen || cardsOpen || productsOpen || libraryOpen) {
      if (slashGate.open) closeSlashMenu(false);
      return;
    }
    const range = slashRangeFromState(current.state);
    if (!range) {
      if (slashGate.open) closeSlashMenu(false);
      return;
    }
    const items = filterSlashCommands(range.query);
    if (items.length === 0) {
      if (slashGate.open) closeSlashMenu(false);
      return;
    }
    const index = clampSlashIndex(
      slashGate.open && slashGate.query === range.query ? slashGate.index : 0,
      items.length,
    );
    slashGate.query = range.query;
    slashGate.open = true;
    slashGate.from = range.from;
    slashGate.to = range.to;
    slashGate.items = items;
    slashGate.index = index;
    slashItems = items;
    slashIndex = index;
    slashOpen = true;
    try {
      const coords = current.view.coordsAtPos(range.from);
      const width = 16.5 * 16;
      const left = Math.min(Math.max(8, coords.left), window.innerWidth - width - 8);
      const top = Math.min(coords.bottom + 6, window.innerHeight - 12);
      slashPos = { top, left };
    } catch {
      /* view chưa sẵn */
    }
  }

  async function runSlashCommand(id: SlashCommandId) {
    if (!editor || !slashGate.open) return;
    const { from, to } = slashGate;
    closeSlashMenu(false);
    menu = null;
    hideLinkBubble();
    editor.chain().focus().deleteRange({ from, to }).run();
    await tick();
    if (!editor) return;
    switch (id) {
      case 'heading2':
        editor.chain().focus().setHeading({ level: 2 }).run();
        break;
      case 'heading3':
        editor.chain().focus().setHeading({ level: 3 }).run();
        break;
      case 'bullet':
        editor.chain().focus().toggleBulletList().run();
        break;
      case 'ordered':
        editor.chain().focus().toggleOrderedList().run();
        break;
      case 'quote':
        editor.chain().focus().toggleBlockquote().run();
        break;
      case 'table':
        if (editor.can().insertTable({ rows: 3, cols: 3, withHeaderRow: true })) {
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
        }
        break;
      case 'callout':
        editor.chain().focus().insertCallout('tip').run();
        break;
      case 'image':
        libraryOpen = true;
        break;
      case 'cards':
        openCards(false);
        break;
      case 'products':
        openProducts(false);
        break;
    }
  }

  function active(name: string, attributes?: Record<string, unknown>): boolean {
    revision;
    return editor?.isActive(name, attributes) ?? false;
  }

  function can(name: 'undo' | 'redo'): boolean {
    revision;
    if (!editor) return false;
    return name === 'undo' ? editor.can().undo() : editor.can().redo();
  }

  function headingLabel(): string {
    if (active('heading', { level: 2 })) return 'H2';
    if (active('heading', { level: 3 })) return 'H3';
    return 'H';
  }

  function toggleHeadingMenu() {
    menu = menu === 'heading' ? null : 'heading';
  }

  function toggleCalloutMenu() {
    menu = menu === 'callout' ? null : 'callout';
  }

  function setBlock(level: 2 | 3 | null) {
    run((current) => {
      const chain = current.chain().focus();
      if (level === null) chain.setParagraph().run();
      else chain.setHeading({ level }).run();
    });
  }

  function insertCallout(variant: CalloutVariant) {
    run((current) => {
      if (current.isActive('callout')) current.chain().focus().setCalloutVariant(variant).run();
      else current.chain().focus().insertCallout(variant).run();
    });
  }

  function calloutLabel(): string {
    if (!active('callout')) return 'Ghi chú';
    return CALLOUT_LABELS[normalizeCalloutVariant(editor?.getAttributes('callout').variant)];
  }

  function hideLinkBubble() {
    if (linkBubble.show) linkBubble = { show: false, href: '', top: 0, left: 0 };
  }

  function syncLinkBubble(current: Editor | null = editor) {
    if (!current || linkOpen || cardsOpen || productsOpen || libraryOpen || slashOpen || !current.isActive('link')) {
      hideLinkBubble();
      return;
    }
    const href = current.getAttributes('link').href;
    if (typeof href !== 'string' || !href.trim()) {
      hideLinkBubble();
      return;
    }
    const { from, to } = current.state.selection;
    let start: { top: number; bottom: number; left: number; right: number };
    let end: { top: number; bottom: number; left: number; right: number };
    try {
      start = current.view.coordsAtPos(from);
      end = current.view.coordsAtPos(to);
    } catch {
      hideLinkBubble();
      return;
    }
    const mid = (start.left + end.left) / 2;
    const left = Math.min(Math.max(mid, 72), window.innerWidth - 72);
    const top = Math.max(8, start.top - 6);
    linkBubble = { show: true, href: href.trim(), top, left };
  }

  function linkBubbleLabel(href: string): string {
    if (href.length <= 42) return href;
    return `${href.slice(0, 20)}…${href.slice(-18)}`;
  }

  function openLinkUrl() {
    const href = linkBubble.href;
    if (!isPostHref(href)) return;
    const target = href.startsWith('/') ? `${location.origin}${href}` : href;
    window.open(target, '_blank', 'noopener,noreferrer');
  }

  function unlinkHere() {
    editor?.chain().focus().extendMarkRange('link').unsetLink().run();
    hideLinkBubble();
  }

  function openLink() {
    if (!editor || !linkDialog) return;
    menu = null;
    hideLinkBubble();
    const href = editor.getAttributes('link').href;
    linkUrl = typeof href === 'string' ? href : '';
    linkQuery = '';
    linkHits = [];
    linkNote = '';
    linkError = '';
    linkIssue = null;
    linkText = '';
    linkHasMark = editor.isActive('link');
    // Không bôi đen chữ thì setLink không có gì để gắn; khi đó chèn chữ mới mang liên kết.
    linkNeedsText = editor.state.selection.empty && !linkHasMark;
    linkOpen = true;
    linkDialog.showModal();
    void tick().then(() => linkUrlEl?.select());
    void loadSuggestions();
    queueFieldCheck();
  }

  function closeLink() {
    linkDialog?.close();
  }

  function onLinkClosed() {
    linkOpen = false;
    window.clearTimeout(linkTimer);
    window.clearTimeout(issueTimer);
    editor?.commands.focus();
    syncLinkBubble();
  }

  function onLinkBackdrop(event: MouseEvent) {
    if (!linkDialog || event.target !== linkDialog) return;
    const box = linkDialog.getBoundingClientRect();
    const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
    if (outside) closeLink();
  }

  function removeLink() {
    editor?.chain().focus().extendMarkRange('link').unsetLink().run();
    hideLinkBubble();
    closeLink();
  }

  function queueLinkSearch(value: string) {
    linkQuery = value;
    window.clearTimeout(linkTimer);
    linkTimer = window.setTimeout(() => void searchLinks(), 300);
  }

  async function searchLinks() {
    const term = linkQuery.trim();
    if (term.length < 2) {
      linkHits = [];
      linkNote = '';
      return;
    }
    const url = new URL(routes.adminPosts, location.origin);
    url.searchParams.set('q', term);
    url.searchParams.set('links', '1');
    const exclude = formValue('postId');
    if (exclude) url.searchParams.set('exclude', exclude);
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } });
      if (!response.ok) {
        linkNote = 'Không tìm được liên kết nội bộ.';
        return;
      }
      const body = (await response.json()) as { links?: unknown };
      const rows = Array.isArray(body.links) ? body.links : [];
      linkHits = rows.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const record = entry as { title?: unknown; path?: unknown; kind?: unknown };
        if (typeof record.title !== 'string' || typeof record.path !== 'string') return [];
        if (!isPostHref(record.path) || /^https?:\/\//i.test(record.path)) return [];
        const kind =
          record.kind === 'product' || record.kind === 'catalog' || record.kind === 'post' ? record.kind : linkKindFromPath(record.path);
        if (!kind) return [];
        return [{ title: record.title, path: record.path, kind }];
      });
      linkNote = linkHits.length === 0 ? 'Không có bài, sản phẩm hoặc trang mẫu khớp.' : '';
    } catch {
      linkNote = 'Không tìm được liên kết nội bộ.';
    }
  }

  function linkKindFromPath(path: string): InternalLinkHit['kind'] | null {
    if (path === routes.catalog) return 'catalog';
    if (path.startsWith('/san-pham/')) return 'product';
    if (path.startsWith('/kien-thuc/')) return 'post';
    return null;
  }

  function linkKindLabel(kind: InternalLinkHit['kind']): string {
    if (kind === 'product') return 'Sản phẩm';
    if (kind === 'catalog') return 'Catalog';
    return 'Bài viết';
  }

  function applyLink(next = linkUrl, title = '') {
    if (!editor) return;
    const href = next.trim();
    if (!isPostHref(href)) {
      linkError = 'Dùng http/https hoặc đường dẫn nội bộ (/kien-thuc/…, /san-pham/…, /mau-vong-dau-tam).';
      return;
    }
    linkUrl = href;
    if (linkNeedsText) {
      const text = linkText.trim() || title || href;
      editor.chain().focus().insertContent({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }).run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    }
    closeLink();
  }

  function choosePost(hit: { title: string; path: string }) {
    applyLink(hit.path, hit.title);
  }

  function formValue(name: string): string {
    const form = host?.closest('form');
    if (!(form instanceof HTMLFormElement)) return '';
    if (name === 'postId') return form.dataset.postId ?? '';
    const field = form.querySelector(`[name="${name}"]`);
    return field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement ? field.value : '';
  }

  async function loadSuggestions() {
    const url = new URL(routes.adminPosts, location.origin);
    url.searchParams.set('suggest', '1');
    url.searchParams.set('title', formValue('title').slice(0, 120));
    const category = formValue('categoryId');
    if (category) url.searchParams.set('category', category);
    const exclude = formValue('postId');
    if (exclude) url.searchParams.set('exclude', exclude);
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } });
      if (!response.ok || !linkOpen) return;
      const body = (await response.json()) as { suggestions?: unknown };
      const rows = Array.isArray(body.suggestions) ? body.suggestions : [];
      suggestions = rows.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const record = entry as { title?: unknown; path?: unknown };
        if (typeof record.title !== 'string' || typeof record.path !== 'string') return [];
        if (!isPostHref(record.path) || /^https?:\/\//i.test(record.path)) return [];
        const kind = linkKindFromPath(record.path);
        if (!kind) return [];
        return [{ title: record.title, path: record.path, kind }];
      });
    } catch {
      suggestions = [];
    }
  }

  function queueFieldCheck() {
    window.clearTimeout(issueTimer);
    issueTimer = window.setTimeout(() => void checkField(), 400);
  }

  async function checkField() {
    const path = postPathFromHref(linkUrl);
    if (!path || !linkOpen) {
      linkIssue = null;
      return;
    }
    const url = new URL(routes.adminPosts, location.origin);
    url.searchParams.set('check', '1');
    url.searchParams.set('path', path);
    const slug = formValue('slug').trim();
    if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) url.searchParams.set('current', `/kien-thuc/${slug}`);
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } });
      if (!response.ok || postPathFromHref(linkUrl) !== path) return;
      const body = (await response.json()) as { issues?: unknown };
      const issue = Array.isArray(body.issues) ? body.issues[0] : null;
      if (!issue || typeof issue !== 'object') {
        linkIssue = null;
        return;
      }
      const record = issue as { path?: unknown; kind?: unknown; official?: unknown };
      if (record.path !== path || (record.kind !== 'missing' && record.kind !== 'unpublished' && record.kind !== 'redirect' && record.kind !== 'self')) {
        linkIssue = null;
        return;
      }
      linkIssue = { path, kind: record.kind, official: typeof record.official === 'string' ? record.official : undefined };
    } catch {
      linkIssue = null;
    }
  }

  // Modal nằm trong form bài viết: Enter phải bị chặn để không submit cả bài.
  function onLinkKey(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    applyLink();
  }

  function onSearchKey(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const first = linkHits[0];
    if (first) choosePost(first);
  }

  function toggleLibrary() {
    menu = null;
    libraryOpen = !libraryOpen;
    syncLinkBubble();
  }

  function openCards(editing = false) {
    if (!editor || !cardsDialog) return;
    menu = null;
    hideLinkBubble();
    cardsEditing = editing || editor.isActive('postCards');
    cardsQuery = '';
    cardsHits = [];
    cardsNote = '';
    cardsError = '';
    if (cardsEditing && editor.isActive('postCards')) {
      const attrs = editor.getAttributes('postCards') as { ids?: unknown; labels?: unknown };
      const ids = normalizePostCardIds(attrs.ids);
      const labels = normalizePostCardLabels(attrs.labels, ids.length);
      cardsSelected = ids.map((id, index) => ({ id, title: labels[index] || `Bài #${id}` }));
    } else {
      cardsSelected = [];
      cardsEditing = false;
    }
    cardsOpen = true;
    cardsDialog.showModal();
  }

  function closeCards() {
    cardsDialog?.close();
  }

  function onCardsClosed() {
    cardsOpen = false;
    window.clearTimeout(cardsTimer);
    editor?.commands.focus();
  }

  function onCardsBackdrop(event: MouseEvent) {
    if (!cardsDialog || event.target !== cardsDialog) return;
    const box = cardsDialog.getBoundingClientRect();
    const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
    if (outside) closeCards();
  }

  function queueCardsSearch(value: string) {
    cardsQuery = value;
    window.clearTimeout(cardsTimer);
    cardsTimer = window.setTimeout(() => void searchCards(), 280);
  }

  async function searchCards() {
    const term = cardsQuery.trim();
    if (term.length < 2) {
      cardsHits = [];
      cardsNote = '';
      return;
    }
    const url = new URL(routes.adminPosts, location.origin);
    url.searchParams.set('q', term);
    const exclude = formValue('postId');
    if (exclude) url.searchParams.set('exclude', exclude);
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } });
      if (!response.ok) {
        cardsNote = 'Không tìm được bài viết.';
        return;
      }
      const body = (await response.json()) as { posts?: unknown };
      const posts = Array.isArray(body.posts) ? body.posts : [];
      cardsHits = posts.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const record = entry as { id?: unknown; title?: unknown; path?: unknown };
        if (typeof record.id !== 'number' || !Number.isInteger(record.id) || record.id < 1) return [];
        if (typeof record.title !== 'string' || typeof record.path !== 'string') return [];
        if (!record.path.startsWith('/kien-thuc/')) return [];
        return [{ id: record.id, title: record.title, path: record.path }];
      });
      cardsNote = cardsHits.length === 0 ? 'Không có bài đã xuất bản khớp.' : '';
    } catch {
      cardsNote = 'Không tìm được bài viết.';
    }
  }

  function toggleCard(hit: PostCardRef) {
    cardsError = '';
    const exists = cardsSelected.some((item) => item.id === hit.id);
    if (exists) {
      cardsSelected = cardsSelected.filter((item) => item.id !== hit.id);
      return;
    }
    if (cardsSelected.length >= POST_CARDS_MAX) {
      cardsError = `Chỉ chọn tối đa ${POST_CARDS_MAX} bài.`;
      return;
    }
    cardsSelected = [...cardsSelected, { id: hit.id, title: hit.title, path: hit.path }];
  }

  function removeSelectedCard(id: number) {
    cardsSelected = cardsSelected.filter((item) => item.id !== id);
    cardsError = '';
  }

  function applyCards() {
    if (!editor) return;
    if (cardsSelected.length === 0) {
      cardsError = 'Chọn ít nhất một bài đã xuất bản.';
      return;
    }
    if (cardsEditing && editor.isActive('postCards')) {
      editor.chain().focus().updatePostCards(cardsSelected).run();
    } else {
      editor.chain().focus().insertPostCards(cardsSelected).run();
    }
    closeCards();
  }

  function onCardsKey(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const first = cardsHits[0];
    if (first) toggleCard(first);
  }

  function openProducts(editing = false) {
    if (!editor || !productsDialog) return;
    menu = null;
    hideLinkBubble();
    productsEditing = editing || editor.isActive('productCards');
    productsQuery = '';
    productsHits = [];
    productsNote = '';
    productsError = '';
    productsTop = false;
    if (productsEditing && editor.isActive('productCards')) {
      const attrs = editor.getAttributes('productCards') as { ids?: unknown; labels?: unknown; covers?: unknown };
      const ids = normalizeProductCardIds(attrs.ids);
      const labels = normalizeProductCardLabels(attrs.labels, ids.length);
      const covers = normalizeProductCardCovers(attrs.covers, ids.length);
      productsSelected = ids.map((id, index) => ({
        id,
        name: labels[index] || `Sản phẩm #${id}`,
        coverUrl: covers[index] || null,
      }));
    } else {
      productsSelected = [];
      productsEditing = false;
    }
    productsOpen = true;
    productsDialog.showModal();
    void searchProducts(true);
  }

  function closeProducts() {
    productsDialog?.close();
  }

  function onProductsClosed() {
    productsOpen = false;
    window.clearTimeout(productsTimer);
    editor?.commands.focus();
  }

  function onProductsBackdrop(event: MouseEvent) {
    if (!productsDialog || event.target !== productsDialog) return;
    const box = productsDialog.getBoundingClientRect();
    const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
    if (outside) closeProducts();
  }

  function queueProductsSearch(value: string) {
    productsQuery = value;
    window.clearTimeout(productsTimer);
    productsTimer = window.setTimeout(() => void searchProducts(false), 280);
  }

  async function searchProducts(preferTop = false) {
    const term = productsQuery.trim();
    const useTop = preferTop || term.length < 2;
    const url = new URL(routes.adminProducts, location.origin);
    if (!useTop) url.searchParams.set('q', term);
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } });
      if (!response.ok) {
        productsHits = [];
        productsTop = false;
        productsNote = useTop ? 'Không tải được sản phẩm bán chạy.' : 'Không tìm được sản phẩm.';
        return;
      }
      const body = (await response.json()) as { products?: unknown; top?: unknown };
      const rows = Array.isArray(body.products) ? body.products : [];
      productsHits = rows.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const record = entry as { id?: unknown; name?: unknown; price?: unknown; path?: unknown; coverUrl?: unknown };
        if (typeof record.id !== 'number' || !Number.isInteger(record.id) || record.id < 1) return [];
        if (typeof record.name !== 'string' || typeof record.path !== 'string') return [];
        if (!record.path.startsWith('/san-pham/')) return [];
        const coverUrl =
          typeof record.coverUrl === 'string' && isMediaSrc(record.coverUrl) ? record.coverUrl : null;
        return [
          {
            id: record.id,
            name: record.name,
            path: record.path,
            price: typeof record.price === 'number' ? record.price : undefined,
            coverUrl,
          },
        ];
      });
      productsTop = useTop || body.top === true;
      productsNote =
        productsHits.length === 0
          ? useTop
            ? 'Chưa có sản phẩm đang bán.'
            : 'Không có sản phẩm đang bán khớp.'
          : '';
    } catch {
      productsHits = [];
      productsTop = false;
      productsNote = useTop ? 'Không tải được sản phẩm bán chạy.' : 'Không tìm được sản phẩm.';
    }
  }

  function toggleProduct(hit: ProductCardRef) {
    productsError = '';
    const exists = productsSelected.some((item) => item.id === hit.id);
    if (exists) {
      productsSelected = productsSelected.filter((item) => item.id !== hit.id);
      return;
    }
    if (productsSelected.length >= PRODUCT_CARDS_MAX) {
      productsError = `Chỉ chọn tối đa ${PRODUCT_CARDS_MAX} sản phẩm.`;
      return;
    }
    productsSelected = [
      ...productsSelected,
      { id: hit.id, name: hit.name, path: hit.path, price: hit.price, coverUrl: hit.coverUrl ?? null },
    ];
  }

  function removeSelectedProduct(id: number) {
    productsSelected = productsSelected.filter((item) => item.id !== id);
    productsError = '';
  }

  function applyProducts() {
    if (!editor) return;
    if (productsSelected.length === 0) {
      productsError = 'Chọn ít nhất một sản phẩm đang bán.';
      return;
    }
    if (productsEditing && editor.isActive('productCards')) {
      editor.chain().focus().updateProductCards(productsSelected).run();
    } else {
      editor.chain().focus().insertProductCards(productsSelected).run();
    }
    closeProducts();
  }

  function onProductsKey(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const first = productsHits[0];
    if (first) toggleProduct(first);
  }

  function formatProductPrice(price: number | undefined): string {
    if (price == null || !Number.isFinite(price)) return '';
    return `${Math.round(price).toLocaleString('vi-VN')}₫`;
  }

  function imageSelected() {
    revision;
    return editor?.isActive('image') ?? false;
  }

  function imageCanMove(dir: -1 | 1): boolean {
    revision;
    return editor ? canMoveSelectedImage(editor.state, dir) : false;
  }

  function moveImage(dir: -1 | 1) {
    if (!editor) return;
    moveSelectedImage(editor, dir);
    revision += 1;
  }

  function tableSelected() {
    revision;
    return editor?.isActive('table') ?? false;
  }

  function canInsertTable(): boolean {
    revision;
    if (!editor || editor.isActive('table')) return false;
    return editor.can().insertTable({ rows: 3, cols: 3, withHeaderRow: true });
  }

  type TableAction =
    | 'addColumnBefore'
    | 'addColumnAfter'
    | 'deleteColumn'
    | 'addRowBefore'
    | 'addRowAfter'
    | 'deleteRow'
    | 'mergeCells'
    | 'splitCell'
    | 'deleteTable';

  function tableCan(action: TableAction): boolean {
    revision;
    if (!editor) return false;
    switch (action) {
      case 'addColumnBefore':
        return editor.can().addColumnBefore();
      case 'addColumnAfter':
        return editor.can().addColumnAfter();
      case 'deleteColumn':
        return editor.can().deleteColumn();
      case 'addRowBefore':
        return editor.can().addRowBefore();
      case 'addRowAfter':
        return editor.can().addRowAfter();
      case 'deleteRow':
        return editor.can().deleteRow();
      case 'mergeCells':
        return editor.can().mergeCells();
      case 'splitCell':
        return editor.can().splitCell();
      case 'deleteTable':
        return editor.can().deleteTable();
    }
  }

  function runTable(action: TableAction) {
    run((current) => {
      const chain = current.chain().focus();
      switch (action) {
        case 'addColumnBefore':
          chain.addColumnBefore().run();
          break;
        case 'addColumnAfter':
          chain.addColumnAfter().run();
          break;
        case 'deleteColumn':
          chain.deleteColumn().run();
          break;
        case 'addRowBefore':
          chain.addRowBefore().run();
          break;
        case 'addRowAfter':
          chain.addRowAfter().run();
          break;
        case 'deleteRow':
          chain.deleteRow().run();
          break;
        case 'mergeCells':
          chain.mergeCells().run();
          break;
        case 'splitCell':
          chain.splitCell().run();
          break;
        case 'deleteTable':
          chain.deleteTable().run();
          break;
      }
    });
  }

  function setImageAttr(name: 'alt' | 'caption', value: string) {
    const next = value.slice(0, 200);
    editor?.commands.updateAttributes('image', { [name]: name === 'caption' && next.trim() === '' ? null : next });
  }

  // Chỉ bỏ ảnh khỏi bài. File trong thư viện vẫn giữ.
  function removeImage() {
    editor?.chain().focus().deleteSelection().run();
  }

  function insertImage(item: MediaItem) {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .insertContent([
        { type: 'image', attrs: { src: item.url, alt: item.alt } },
        { type: 'paragraph' },
      ])
      .run();
    libraryOpen = false;
  }

  function parseContent(value: string): JSONContent {
    try {
      const parsed = JSON.parse(value) as JSONContent;
      return parsed.type === 'doc' ? parsed : { type: 'doc', content: [] };
    } catch {
      return { type: 'doc', content: [] };
    }
  }
</script>

{#snippet toolIcon(name: string)}
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {#if name === 'undo'}
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />
    {:else if name === 'redo'}
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13" />
    {:else if name === 'chevron'}
      <path d="m6 9 6 6 6-6" />
    {:else if name === 'list'}
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    {:else if name === 'ordered'}
      <path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
    {:else if name === 'quote'}
      <path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" />
      <path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" />
    {:else if name === 'bold'}
      <path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8" />
    {:else if name === 'italic'}
      <path d="M19 4h-9M14 20H5M15 4 9 20" />
    {:else if name === 'link'}
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    {:else if name === 'image'}
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    {:else if name === 'table'}
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 9h18M3 15h18M12 3v18" />
    {:else if name === 'colBefore'}
      <path d="M12 4v16M8 8l-4 4 4 4M4 12h8" />
      <path d="M15 4h5v16h-5" />
    {:else if name === 'colAfter'}
      <path d="M12 4v16M16 8l4 4-4 4M12 12h8" />
      <path d="M4 4h5v16H4" />
    {:else if name === 'colDelete'}
      <path d="M10 4v16M14 4v16M8 8h8M8 16h8" />
      <path d="M4 4l16 16" />
    {:else if name === 'rowBefore'}
      <path d="M4 12h16M8 8l4-4 4 4M12 4v8" />
      <path d="M4 15h16v5H4z" />
    {:else if name === 'rowAfter'}
      <path d="M4 12h16M8 16l4 4 4-4M12 12v8" />
      <path d="M4 4h16v5H4z" />
    {:else if name === 'rowDelete'}
      <path d="M4 10h16M4 14h16M8 8v8M16 8v8" />
      <path d="M4 4l16 16" />
    {:else if name === 'merge'}
      <rect width="18" height="14" x="3" y="5" rx="1" />
      <path d="M12 5v14M8 12h8" />
    {:else if name === 'split'}
      <rect width="18" height="14" x="3" y="5" rx="1" />
      <path d="M12 5v14" />
    {:else if name === 'tableDelete'}
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 9h18M9 3v6M15 3v6M9 15l6 6M15 15l-6 6" />
    {:else if name === 'cards'}
      <rect width="18" height="14" x="3" y="5" rx="2" />
      <path d="M7 9h6M7 13h10" />
    {:else if name === 'product'}
      <path d="M6 7h12l-1 12H7L6 7Z" />
      <path d="M9 7V5a3 3 0 0 1 6 0v2" />
    {:else if name === 'callout'}
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16h.01" />
    {/if}
  </svg>
{/snippet}

<div class="editor mt-4">
  <p class="mb-2 font-semibold">Nội dung</p>
  <div class="editor-shell">
    <span class="editor-toolbar-pin" aria-hidden="true" bind:this={toolbarPinEl}></span>
    <div class="editor-sticky" bind:this={stickyEl}>
      <div class="editor-toolbar" role="toolbar" aria-label="Định dạng" bind:this={toolbarEl}>
        <button class="tool" type="button" title={tip('Hoàn tác', 'Z')} disabled={!can('undo')} onclick={() => run((current) => current.chain().focus().undo().run())}>{@render toolIcon('undo')}</button>
        <button class="tool" type="button" title={tip('Làm lại', 'Shift+Z')} disabled={!can('redo')} onclick={() => run((current) => current.chain().focus().redo().run())}>{@render toolIcon('redo')}</button>
        <span class="editor-sep"></span>
        <div class="relative">
          <button class="tool tool-wide" type="button" title="Kiểu chữ" aria-expanded={menu === 'heading'} aria-haspopup="menu" onclick={toggleHeadingMenu}>
            {headingLabel()}
            {@render toolIcon('chevron')}
          </button>
          {#if menu === 'heading'}
            <div class="editor-menu" role="menu">
              <button type="button" role="menuitemradio" aria-checked={headingLabel() === 'H'} onclick={() => setBlock(null)}>Văn bản</button>
              <button type="button" role="menuitemradio" aria-checked={headingLabel() === 'H2'} onclick={() => setBlock(2)}><span class="text-lg font-semibold">Tiêu đề 2</span></button>
              <button type="button" role="menuitemradio" aria-checked={headingLabel() === 'H3'} onclick={() => setBlock(3)}><span class="font-semibold">Tiêu đề 3</span></button>
            </div>
          {/if}
        </div>
        <span class="editor-sep"></span>
        <button class="tool" type="button" title={tip('Danh sách', 'Shift+8')} aria-pressed={active('bulletList')} onclick={() => run((current) => current.chain().focus().toggleBulletList().run())}>{@render toolIcon('list')}</button>
        <button class="tool" type="button" title={tip('Danh sách đánh số', 'Shift+7')} aria-pressed={active('orderedList')} onclick={() => run((current) => current.chain().focus().toggleOrderedList().run())}>{@render toolIcon('ordered')}</button>
        <button class="tool" type="button" title={tip('Trích dẫn', 'Shift+B')} aria-pressed={active('blockquote')} onclick={() => run((current) => current.chain().focus().toggleBlockquote().run())}>{@render toolIcon('quote')}</button>
        <span class="editor-sep"></span>
        <button class="tool" type="button" title={tip('Đậm', 'B')} aria-pressed={active('bold')} onclick={() => run((current) => current.chain().focus().toggleBold().run())}>{@render toolIcon('bold')}</button>
        <button class="tool" type="button" title={tip('Nghiêng', 'I')} aria-pressed={active('italic')} onclick={() => run((current) => current.chain().focus().toggleItalic().run())}>{@render toolIcon('italic')}</button>
        <button class="tool" type="button" title="Liên kết" aria-pressed={active('link')} aria-haspopup="dialog" aria-expanded={linkOpen} onclick={openLink}>{@render toolIcon('link')}</button>
        <span class="editor-sep"></span>
        <button class="tool" type="button" title="Ảnh" aria-pressed={libraryOpen} onclick={toggleLibrary}>{@render toolIcon('image')}</button>
        <button
          class="tool"
          type="button"
          title="Chèn bảng"
          aria-pressed={tableSelected()}
          disabled={!canInsertTable()}
          onclick={() => run((current) => current.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
        >{@render toolIcon('table')}</button>
        <button class="tool" type="button" title="Bài liên quan" aria-pressed={cardsOpen || active('postCards')} aria-haspopup="dialog" aria-expanded={cardsOpen} onclick={() => openCards(false)}>{@render toolIcon('cards')}</button>
        <button class="tool" type="button" title="Sản phẩm" aria-pressed={productsOpen || active('productCards')} aria-haspopup="dialog" aria-expanded={productsOpen} onclick={() => openProducts(false)}>{@render toolIcon('product')}</button>
        <div class="relative">
          <button class="tool tool-wide" type="button" title="Ghi chú / lưu ý" aria-expanded={menu === 'callout'} aria-haspopup="menu" aria-pressed={active('callout')} onclick={toggleCalloutMenu}>
            {@render toolIcon('callout')}
            <span class="sr-only">{calloutLabel()}</span>
          </button>
          {#if menu === 'callout'}
            <div class="editor-menu" role="menu">
              {#each CALLOUT_VARIANTS as variant (variant)}
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={active('callout') && normalizeCalloutVariant(editor?.getAttributes('callout').variant) === variant}
                  onclick={() => insertCallout(variant)}
                >{CALLOUT_LABELS[variant]}</button>
              {/each}
            </div>
          {/if}
        </div>
      </div>
      <p class="editor-hotkeys" aria-hidden="true">{hotkeyHint}</p>
      {#if tableSelected()}
        <div class="editor-table" role="toolbar" aria-label="Chỉnh bảng">
          <button class="tool" type="button" title="Thêm cột trước" disabled={!tableCan('addColumnBefore')} onclick={() => runTable('addColumnBefore')}>{@render toolIcon('colBefore')}</button>
          <button class="tool" type="button" title="Thêm cột sau" disabled={!tableCan('addColumnAfter')} onclick={() => runTable('addColumnAfter')}>{@render toolIcon('colAfter')}</button>
          <button class="tool" type="button" title="Xóa cột" disabled={!tableCan('deleteColumn')} onclick={() => runTable('deleteColumn')}>{@render toolIcon('colDelete')}</button>
          <span class="editor-sep"></span>
          <button class="tool" type="button" title="Thêm hàng trên" disabled={!tableCan('addRowBefore')} onclick={() => runTable('addRowBefore')}>{@render toolIcon('rowBefore')}</button>
          <button class="tool" type="button" title="Thêm hàng dưới" disabled={!tableCan('addRowAfter')} onclick={() => runTable('addRowAfter')}>{@render toolIcon('rowAfter')}</button>
          <button class="tool" type="button" title="Xóa hàng" disabled={!tableCan('deleteRow')} onclick={() => runTable('deleteRow')}>{@render toolIcon('rowDelete')}</button>
          <span class="editor-sep"></span>
          <button class="tool" type="button" title="Gộp ô (kéo chọn nhiều ô)" disabled={!tableCan('mergeCells')} onclick={() => runTable('mergeCells')}>{@render toolIcon('merge')}</button>
          <button class="tool" type="button" title="Tách ô" disabled={!tableCan('splitCell')} onclick={() => runTable('splitCell')}>{@render toolIcon('split')}</button>
          <span class="editor-sep"></span>
          <button class="tool tool-danger" type="button" title="Xóa bảng" disabled={!tableCan('deleteTable')} onclick={() => runTable('deleteTable')}>{@render toolIcon('tableDelete')}</button>
        </div>
      {/if}
      {#if imageSelected()}
        <div class="editor-image">
          <div class="editor-image-move" role="group" aria-label="Vị trí ảnh">
            <button class="btn btn-compact" type="button" title="Đưa ảnh lên trên" disabled={!imageCanMove(-1)} onclick={() => moveImage(-1)}>Lên</button>
            <button class="btn btn-compact" type="button" title="Đưa ảnh xuống dưới" disabled={!imageCanMove(1)} onclick={() => moveImage(1)}>Xuống</button>
          </div>
          <label>
            Mô tả ảnh
            <input class="field" maxlength="200" value={imageAlt} oninput={(event) => { imageAlt = event.currentTarget.value; setImageAttr('alt', imageAlt); }} />
          </label>
          <label>
            Chú thích
            <input class="field" maxlength="200" value={imageCaption} oninput={(event) => { imageCaption = event.currentTarget.value; setImageAttr('caption', imageCaption); }} />
          </label>
          <button class="btn btn-compact" type="button" onclick={removeImage}>Xóa khỏi bài</button>
        </div>
      {/if}
    </div>
    <div bind:this={host}></div>
  </div>
  <input type="hidden" name="contentJson" value={json} />
  {#if contentError}<p class="error-text mt-2">{contentError}</p>{/if}
  {#if linkBubble.show}
    <div
      class="editor-link-bubble"
      style={`top:${linkBubble.top}px;left:${linkBubble.left}px`}
      role="toolbar"
      aria-label="Liên kết"
    >
      <span class="editor-link-bubble-url" title={linkBubble.href}>{linkBubbleLabel(linkBubble.href)}</span>
      <button class="editor-link-bubble-btn" type="button" onclick={openLink}>Sửa</button>
      <button class="editor-link-bubble-btn" type="button" disabled={!isPostHref(linkBubble.href)} onclick={openLinkUrl}>Mở</button>
      <button class="editor-link-bubble-btn editor-link-bubble-remove" type="button" onclick={unlinkHere}>Bỏ</button>
    </div>
  {/if}
  {#if slashOpen}
    <div
      class="editor-slash"
      style={`top:${slashPos.top}px;left:${slashPos.left}px`}
      role="listbox"
      aria-label="Lệnh nhanh"
    >
      {#each slashItems as item, i (item.id)}
        <button
          type="button"
          role="option"
          aria-selected={i === slashIndex}
          class:is-active={i === slashIndex}
          onmousedown={(event) => event.preventDefault()}
          onclick={() => void runSlashCommand(item.id)}
        >
          <span class="editor-slash-title">{item.title}</span>
          <span class="editor-slash-hint">{item.hint}</span>
        </button>
      {/each}
    </div>
  {/if}
  <MediaPicker {csrf} items={media} hideTrigger bind:open={libraryOpen} onPick={insertImage} />
  <dialog class="category-dialog link-dialog" aria-labelledby="link-dialog-title" bind:this={linkDialog} onclose={onLinkClosed} onclick={onLinkBackdrop}>
    <h2 id="link-dialog-title" class="text-lg font-semibold">{linkHasMark ? 'Sửa liên kết' : 'Chèn liên kết'}</h2>
    <label class="mt-4 block">
      <span class="mb-1 block font-semibold">Địa chỉ liên kết</span>
      <input class="field" type="text" placeholder="https://… hoặc /kien-thuc/…, /san-pham/…, /mau-vong-dau-tam" bind:this={linkUrlEl} bind:value={linkUrl} oninput={() => { linkError = ''; queueFieldCheck(); }} onkeydown={onLinkKey} />
    </label>
    {#if linkIssue}
      <p class="seo-hint">
        {#if linkIssue.kind === 'redirect' && linkIssue.official}
          Đường dẫn cũ. URL chính là {linkIssue.official}.
          <button class="link-dialog-inline" type="button" onclick={() => applyLink(linkIssue?.official ?? '')}>Gắn URL chính thức</button>
        {:else if linkIssue.kind === 'unpublished'}
          Bài này chưa xuất bản hoặc đã gỡ.
        {:else if linkIssue.kind === 'self'}
          Đường dẫn này là chính bài đang viết.
        {:else}
          Không có bài tương ứng.
        {/if}
      </p>
    {/if}
    {#if linkError}<p class="error-text mt-1" role="alert">{linkError}</p>{/if}
    {#if linkNeedsText}
      <label class="mt-4 block">
        <span class="mb-1 block font-semibold">Chữ hiển thị</span>
        <input class="field" type="text" maxlength="200" placeholder="Để trống sẽ dùng tiêu đề hoặc địa chỉ" bind:value={linkText} onkeydown={onLinkKey} />
      </label>
    {/if}
    <label class="mt-4 block">
      <span class="mb-1 block font-semibold">Hoặc tìm bài / sản phẩm / catalog</span>
      <input class="field" type="search" placeholder="Nhập ít nhất 2 ký tự" value={linkQuery} oninput={(event) => queueLinkSearch(event.currentTarget.value)} onkeydown={onSearchKey} />
    </label>
    {#if linkHits.length > 0}
      <ul class="editor-link-list" aria-label="Kết quả tìm liên kết nội bộ">
        {#each linkHits as hit (hit.path)}
          <li>
            <button type="button" onclick={() => choosePost(hit)}>
              {hit.title}
              <span>{linkKindLabel(hit.kind)} · {hit.path}</span>
            </button>
          </li>
        {/each}
      </ul>
    {:else if linkNote}
      <p class="seo-hint">{linkNote}</p>
    {/if}
    {#if suggestions.length > 0 && linkHits.length === 0}
      <p class="link-dialog-section">Gợi ý nhanh. Bấm để gắn, không tự chèn.</p>
      <ul class="editor-link-list" aria-label="Gợi ý liên kết nội bộ">
        {#each suggestions as hit (hit.path)}
          <li>
            <button type="button" onclick={() => choosePost(hit)}>
              {hit.title}
              <span>{hit.kind ? `${linkKindLabel(hit.kind)} · ` : ''}{hit.path}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <div class="category-actions">
      {#if linkHasMark}
        <button class="btn link-dialog-remove" type="button" onclick={removeLink}>Gỡ liên kết</button>
      {/if}
      <button class="btn" type="button" onclick={closeLink}>Hủy</button>
      <button class="btn btn-primary" type="button" onclick={() => applyLink()}>{linkHasMark ? 'Cập nhật' : 'Gắn liên kết'}</button>
    </div>
  </dialog>
  <dialog class="category-dialog link-dialog" aria-labelledby="cards-dialog-title" bind:this={cardsDialog} onclose={onCardsClosed} onclick={onCardsBackdrop}>
    <h2 id="cards-dialog-title" class="text-lg font-semibold">{cardsEditing ? 'Sửa hộp bài liên quan' : 'Chèn hộp bài liên quan'}</h2>
    <p class="seo-hint mt-2">Chọn tối đa {POST_CARDS_MAX} bài đã xuất bản để hiện trong bài đang soạn.</p>
    <label class="mt-4 block">
      <span class="mb-1 block font-semibold">Tìm bài đã xuất bản</span>
      <input class="field" type="search" placeholder="Nhập ít nhất 2 ký tự của tiêu đề" value={cardsQuery} oninput={(event) => queueCardsSearch(event.currentTarget.value)} onkeydown={onCardsKey} />
    </label>
    {#if cardsHits.length > 0}
      <ul class="editor-link-list" aria-label="Kết quả tìm bài">
        {#each cardsHits as hit (hit.id)}
          <li>
            <button type="button" aria-pressed={cardsSelected.some((item) => item.id === hit.id)} onclick={() => toggleCard(hit)}>
              {hit.title}
              <span>{hit.path}</span>
            </button>
          </li>
        {/each}
      </ul>
    {:else if cardsNote}
      <p class="seo-hint">{cardsNote}</p>
    {/if}
    {#if cardsSelected.length > 0}
      <p class="link-dialog-section">Đã chọn ({cardsSelected.length}/{POST_CARDS_MAX})</p>
      <ul class="editor-cards-selected" aria-label="Bài đã chọn">
        {#each cardsSelected as item (item.id)}
          <li>
            <span>{item.title}</span>
            <button class="btn btn-compact" type="button" onclick={() => removeSelectedCard(item.id)}>Bỏ</button>
          </li>
        {/each}
      </ul>
    {/if}
    {#if cardsError}<p class="error-text mt-2" role="alert">{cardsError}</p>{/if}
    <div class="category-actions">
      <button class="btn" type="button" onclick={closeCards}>Hủy</button>
      <button class="btn btn-primary" type="button" onclick={applyCards}>{cardsEditing ? 'Cập nhật hộp' : 'Chèn hộp'}</button>
    </div>
  </dialog>
  <dialog class="category-dialog link-dialog" aria-labelledby="products-dialog-title" bind:this={productsDialog} onclose={onProductsClosed} onclick={onProductsBackdrop}>
    <h2 id="products-dialog-title" class="text-lg font-semibold">{productsEditing ? 'Sửa hộp sản phẩm' : 'Chèn hộp sản phẩm'}</h2>
    <p class="seo-hint mt-2">Chọn tối đa {PRODUCT_CARDS_MAX} sản phẩm đang bán để gợi ý trong bài.</p>
    <label class="mt-4 block">
      <span class="mb-1 block font-semibold">Tìm sản phẩm</span>
      <input class="field" type="search" placeholder="Nhập ít nhất 2 ký tự của tên" value={productsQuery} oninput={(event) => queueProductsSearch(event.currentTarget.value)} onkeydown={onProductsKey} />
    </label>
    {#if productsHits.length > 0}
      <p class="link-dialog-section">{productsTop ? 'Bán chạy (chọn nhanh)' : 'Kết quả tìm'}</p>
      <ul class="editor-link-list editor-product-list" aria-label={productsTop ? 'Sản phẩm bán chạy' : 'Kết quả tìm sản phẩm'}>
        {#each productsHits as hit (hit.id)}
          <li>
            <button type="button" aria-pressed={productsSelected.some((item) => item.id === hit.id)} onclick={() => toggleProduct(hit)}>
              {#if hit.coverUrl}
                <img class="product-thumb" src={hit.coverUrl} alt="" width="44" height="44" loading="lazy" />
              {:else}
                <span class="product-thumb is-empty" aria-hidden="true"></span>
              {/if}
              <span class="editor-product-meta">
                {hit.name}
                <span>{formatProductPrice(hit.price) || hit.path}</span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {:else if productsNote}
      <p class="seo-hint">{productsNote}</p>
    {/if}
    {#if productsSelected.length > 0}
      <p class="link-dialog-section">Đã chọn ({productsSelected.length}/{PRODUCT_CARDS_MAX})</p>
      <ul class="editor-cards-selected" aria-label="Sản phẩm đã chọn">
        {#each productsSelected as item (item.id)}
          <li>
            {#if item.coverUrl}
              <img class="product-thumb" src={item.coverUrl} alt="" width="44" height="44" loading="lazy" />
            {:else}
              <span class="product-thumb is-empty" aria-hidden="true"></span>
            {/if}
            <span class="editor-product-meta">{item.name}</span>
            <button class="btn btn-compact" type="button" onclick={() => removeSelectedProduct(item.id)}>Bỏ</button>
          </li>
        {/each}
      </ul>
    {/if}
    {#if productsError}<p class="error-text mt-2" role="alert">{productsError}</p>{/if}
    <div class="category-actions">
      <button class="btn" type="button" onclick={closeProducts}>Hủy</button>
      <button class="btn btn-primary" type="button" onclick={applyProducts}>{productsEditing ? 'Cập nhật hộp' : 'Chèn hộp'}</button>
    </div>
  </dialog>
</div>
