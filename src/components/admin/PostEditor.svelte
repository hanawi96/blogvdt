<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { Editor, type JSONContent } from '@tiptap/core';
  import { isPostHref } from '../../features/posts/links';
  import { routes } from '../../lib/routes';
  import { isMediaSrc } from '../../features/posts/content';
  import { postExtensions } from '../../features/posts/extensions';
  import MediaUpload from './MediaUpload.svelte';

  let {
    csrf,
    contentJson = '{"type":"doc","content":[]}',
    contentError = '',
  }: { csrf: string; contentJson?: string; contentError?: string } = $props();

  let host: HTMLDivElement | undefined = $state();
  let toolbarEl: HTMLDivElement | undefined = $state();
  let editor = $state<Editor | null>(null);
  let json = $state(untrack(() => contentJson));
  let revision = $state(0);
  let linkUrl = $state('');
  let linkQuery = $state('');
  let linkHits = $state<Array<{ title: string; path: string }>>([]);
  let linkNote = $state('');
  let linkError = $state('');
  let linkTimer = 0;
  let menu = $state<'heading' | 'link' | null>(null);
  let libraryOpen = $state(false);
  let library = $state<Array<{ id: number; url: string; alt: string; width?: number | null; height?: number | null }>>([]);
  let imageAlt = $state('');
  let imageCaption = $state('');

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
    const content = parseContent(untrack(() => contentJson));
    const instance = new Editor({
      element: host,
      content,
      extensions: postExtensions(),
      onUpdate: ({ editor: current }) => {
        json = JSON.stringify(current.getJSON());
        revision += 1;
        syncImage(current);
        notifyForm();
      },
      onSelectionUpdate: ({ editor: current }) => {
        revision += 1;
        syncImage(current);
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
      },
    });
    editor = instance;
    json = JSON.stringify(instance.getJSON());
    const onPointerDown = (event: PointerEvent) => {
      if (menu === null) return;
      const target = event.target;
      if (!(target instanceof Node) || toolbarEl?.contains(target)) return;
      menu = null;
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      instance.destroy();
    };
  });

  function run(command: (current: Editor) => void) {
    menu = null;
    if (editor) command(editor);
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

  function setBlock(level: 2 | 3 | null) {
    run((current) => {
      const chain = current.chain().focus();
      if (level === null) chain.setParagraph().run();
      else chain.setHeading({ level }).run();
    });
  }

  function toggleLink() {
    if (menu === 'link') {
      menu = null;
      return;
    }
    const href = editor?.getAttributes('link').href;
    linkUrl = typeof href === 'string' ? href : '';
    linkQuery = '';
    linkHits = [];
    linkNote = '';
    linkError = '';
    menu = 'link';
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
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } });
      if (!response.ok) {
        linkNote = 'Không tìm được bài viết.';
        return;
      }
      const body = (await response.json()) as { posts?: unknown };
      const posts = Array.isArray(body.posts) ? body.posts : [];
      linkHits = posts.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const record = entry as { title?: unknown; path?: unknown };
        if (typeof record.title !== 'string' || typeof record.path !== 'string') return [];
        if (!record.path.startsWith('/kien-thuc/')) return [];
        return [{ title: record.title, path: record.path }];
      });
      linkNote = linkHits.length === 0 ? 'Không có bài đã xuất bản khớp.' : '';
    } catch {
      linkNote = 'Không tìm được bài viết.';
    }
  }

  function applyLink(next = linkUrl) {
    if (!editor) return;
    const href = next.trim();
    if (!isPostHref(href)) {
      linkError = 'Dùng liên kết http, https hoặc đường dẫn bài trên website.';
      return;
    }
    linkUrl = href;
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    menu = null;
  }

  function choosePost(path: string) {
    applyLink(path);
  }

  function onLinkKey(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    applyLink();
  }

  async function toggleLibrary() {
    menu = null;
    if (libraryOpen) {
      libraryOpen = false;
      return;
    }
    libraryOpen = true;
    const response = await fetch(`${routes.adminMedia}?format=json`, { headers: { accept: 'application/json' } });
    if (!response.ok) return;
    library = (await response.json()) as Array<{ id: number; url: string; alt: string; width?: number | null; height?: number | null }>;
  }

  function imageSelected() {
    revision;
    return editor?.isActive('image') ?? false;
  }

  function setImageAttr(name: 'alt' | 'caption', value: string) {
    const next = value.slice(0, 200);
    editor?.commands.updateAttributes('image', { [name]: name === 'caption' && next.trim() === '' ? null : next });
  }

  // Chỉ bỏ ảnh khỏi bài. File trong thư viện vẫn giữ.
  function removeImage() {
    editor?.chain().focus().deleteSelection().run();
  }

  function insertImage(item: { url: string; alt: string }) {
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
    {/if}
  </svg>
{/snippet}

<div class="editor mt-4">
  <p class="mb-2 font-semibold">Nội dung</p>
  <div class="editor-shell">
    <div class="editor-toolbar" role="toolbar" aria-label="Định dạng" bind:this={toolbarEl}>
      <button class="tool" type="button" title="Hoàn tác" disabled={!can('undo')} onclick={() => run((current) => current.chain().focus().undo().run())}>{@render toolIcon('undo')}</button>
      <button class="tool" type="button" title="Làm lại" disabled={!can('redo')} onclick={() => run((current) => current.chain().focus().redo().run())}>{@render toolIcon('redo')}</button>
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
      <button class="tool" type="button" title="Danh sách" aria-pressed={active('bulletList')} onclick={() => run((current) => current.chain().focus().toggleBulletList().run())}>{@render toolIcon('list')}</button>
      <button class="tool" type="button" title="Danh sách đánh số" aria-pressed={active('orderedList')} onclick={() => run((current) => current.chain().focus().toggleOrderedList().run())}>{@render toolIcon('ordered')}</button>
      <button class="tool" type="button" title="Trích dẫn" aria-pressed={active('blockquote')} onclick={() => run((current) => current.chain().focus().toggleBlockquote().run())}>{@render toolIcon('quote')}</button>
      <span class="editor-sep"></span>
      <button class="tool" type="button" title="Đậm" aria-pressed={active('bold')} onclick={() => run((current) => current.chain().focus().toggleBold().run())}>{@render toolIcon('bold')}</button>
      <button class="tool" type="button" title="Nghiêng" aria-pressed={active('italic')} onclick={() => run((current) => current.chain().focus().toggleItalic().run())}>{@render toolIcon('italic')}</button>
      <div class="relative">
        <button class="tool" type="button" title="Liên kết" aria-pressed={active('link')} aria-expanded={menu === 'link'} onclick={toggleLink}>{@render toolIcon('link')}</button>
        {#if menu === 'link'}
          <div class="editor-menu editor-link" role="dialog" aria-label="Liên kết">
            <label>
              <span class="sr-only">Địa chỉ liên kết</span>
              <input class="field" type="text" placeholder="https:// hoặc /kien-thuc/..." bind:value={linkUrl} onkeydown={onLinkKey} />
            </label>
            <label>
              <span class="editor-link-label">Tìm bài đã xuất bản</span>
              <input class="field" type="search" placeholder="Nhập tiêu đề" value={linkQuery} oninput={(event) => queueLinkSearch(event.currentTarget.value)} />
            </label>
            {#if linkHits.length > 0}
              <ul class="editor-link-list">
                {#each linkHits as hit (hit.path)}
                  <li>
                    <button type="button" onclick={() => choosePost(hit.path)}>
                      {hit.title}
                      <span>{hit.path}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {:else if linkNote}
              <p class="editor-link-label">{linkNote}</p>
            {/if}
            {#if linkError}<p class="error-text">{linkError}</p>{/if}
            <div class="flex gap-2">
              <button class="btn btn-primary" type="button" onclick={applyLink}>Gắn</button>
              <button class="btn" type="button" onclick={() => run((current) => current.chain().focus().unsetLink().run())}>Bỏ</button>
            </div>
          </div>
        {/if}
      </div>
      <span class="editor-sep"></span>
      <button class="tool" type="button" title="Ảnh" aria-pressed={libraryOpen} onclick={toggleLibrary}>{@render toolIcon('image')}</button>
      <button class="tool" type="button" title="Bảng" onclick={() => run((current) => current.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}>{@render toolIcon('table')}</button>
    </div>
    {#if imageSelected()}
      <div class="editor-image">
        <label>
          Mô tả ảnh
          <input class="field" maxlength="200" value={imageAlt} oninput={(event) => { imageAlt = event.currentTarget.value; setImageAttr('alt', imageAlt); }} />
        </label>
        <label>
          Chú thích
          <input class="field" maxlength="200" value={imageCaption} oninput={(event) => { imageCaption = event.currentTarget.value; setImageAttr('caption', imageCaption); }} />
        </label>
        <button class="btn" type="button" onclick={removeImage}>Xóa khỏi bài</button>
      </div>
    {/if}
    <div bind:this={host}></div>
  </div>
  <input type="hidden" name="contentJson" value={json} />
  {#if contentError}<p class="error-text mt-2">{contentError}</p>{/if}
  {#if libraryOpen}
    <div class="mt-3 rounded-md border border-line bg-surface p-3">
      <div class="mb-3 flex items-center justify-between">
        <p class="font-semibold">Chọn ảnh</p>
        <button class="btn" type="button" onclick={() => (libraryOpen = false)}>Đóng</button>
      </div>
      <MediaUpload {csrf} onUploaded={(item) => (library = [item, ...library])} />
      <ul class="mt-3 grid gap-3 sm:grid-cols-3">
        {#each library as item (item.id)}
          <li>
            <button class="block w-full text-left" type="button" onclick={() => insertImage(item)}>
              <img class="h-28 w-full rounded-md object-cover" src={item.url} alt={item.alt || 'Ảnh thư viện'} width={item.width ?? undefined} height={item.height ?? undefined} loading="lazy" />
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>
