<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { formatDateTime } from '../../lib/datetime';
  import { routes } from '../../lib/routes';
  import type { MediaItem, MediaUse } from '../../features/media/types';
  import { uploadMedia } from './upload-media';

  let {
    csrf,
    items,
    uses = {},
    multiple = false,
    name = '',
    selected = [],
    max = 8,
    editAlt = false,
    manage = false,
    hideTrigger = false,
    open = $bindable(false),
    onPick,
    total = 0,
    page = 1,
    pageSize = 24,
    libraryQuery = '',
    libraryUsage = 'all' as 'all' | 'used' | 'unused',
    librarySort = 'newest' as 'newest' | 'name' | 'size',
  }: {
    csrf: string;
    items: MediaItem[];
    uses?: Record<string, MediaUse[]>;
    multiple?: boolean;
    name?: string;
    selected?: string[];
    max?: number;
    editAlt?: boolean;
    manage?: boolean;
    hideTrigger?: boolean;
    open?: boolean;
    onPick?: (item: MediaItem) => void;
    total?: number;
    page?: number;
    pageSize?: number;
    libraryQuery?: string;
    libraryUsage?: 'all' | 'used' | 'unused';
    librarySort?: 'newest' | 'name' | 'size';
  } = $props();

  let library = $state<MediaItem[]>(untrack(() => items.map((item) => ({ ...item }))));
  let useMap = $state<Record<string, MediaUse[]>>(untrack(() => ({ ...uses })));
  let libraryTotal = $state(untrack(() => total));
  let libraryPage = $state(untrack(() => page));
  let listQuery = $state(untrack(() => libraryQuery));
  let listUsage = $state(untrack(() => libraryUsage));
  let listSort = $state(untrack(() => librarySort));
  let loading = $state(false);
  let deleting = $state(false);
  let confirmDeleteId = $state<number | null>(null);
  let loadError = $state('');
  let progress = $state('');
  let altDraft = $state('');
  let altStatus = $state('');
  let filterTimer = 0;
  let chosen = $state<string[]>(untrack(() => selected.filter(Boolean)));
  let draft = $state<string[]>([]);
  let showing = $state(false);
  let query = $state('');
  let previewId = $state<number | null>(null);
  let message = $state('');
  let busy = $state(false);
  let hot = $state(false);
  let copied = $state('');
  let alt = $state(untrack(() => items.find((item) => String(item.id) === selected[0])?.alt ?? ''));
  let altTimer = 0;
  let dialogEl = $state<HTMLDialogElement | null>(null);
  let searchEl = $state<HTMLInputElement | null>(null);
  let idInput = $state<HTMLInputElement | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);

  const dialogOpen = $derived(manage ? false : hideTrigger ? open : showing);
  const preview = $derived(library.find((item) => item.id === previewId) ?? null);
  const visible = $derived.by(() => {
    if (manage) return library;
    const needle = query.trim().toLowerCase();
    if (!needle) return library;
    return library.filter((item) => `${item.filename} ${item.alt}`.toLowerCase().includes(needle));
  });
  const pageCount = $derived(Math.max(1, Math.ceil(libraryTotal / Math.max(1, pageSize))));
  // Trang quản lý khi thư viện trống hẳn: ẩn ô tìm + bộ lọc, chỉ giữ nút tải ảnh.
  const manageEmpty = $derived(manage && libraryTotal === 0 && listQuery.trim() === '' && listUsage === 'all' && listSort === 'newest');
  const chosenItems = $derived(chosen.map((id) => library.find((item) => String(item.id) === id)).filter((item): item is MediaItem => !!item));

  onMount(() => {
    const onAdd = (event: Event) => {
      const item = (event as CustomEvent<MediaItem>).detail;
      if (!item || library.some((entry) => entry.id === item.id)) return;
      library = [item, ...library];
    };
    const onAlt = (event: Event) => {
      const detail = (event as CustomEvent<{ id: number; alt: string }>).detail;
      if (!detail) return;
      library = library.map((item) => (item.id === detail.id ? { ...item, alt: detail.alt } : item));
    };
    window.addEventListener('media-uploaded', onAdd);
    window.addEventListener('media-alt', onAlt);
    return () => {
      window.removeEventListener('media-uploaded', onAdd);
      window.removeEventListener('media-alt', onAlt);
    };
  });

  $effect(() => {
    if (!dialogEl || manage) return;
    if (dialogOpen && !dialogEl.open) {
      dialogEl.showModal();
      void tick().then(() => searchEl?.focus());
    }
    if (!dialogOpen && dialogEl.open) dialogEl.close();
  });

  function usesOf(item: MediaItem): MediaUse[] {
    return useMap[String(item.id)] ?? [];
  }

  function rememberPreview(itemsOnPage: MediaItem[]) {
    const current = itemsOnPage.find((item) => item.id === previewId);
    const next = current ?? itemsOnPage[0] ?? null;
    previewId = next?.id ?? null;
    altDraft = next?.alt ?? '';
    altStatus = '';
  }

  if (manage) rememberPreview(library);

  function scheduleLibrary() {
    window.clearTimeout(filterTimer);
    filterTimer = window.setTimeout(() => void loadPage(1), 300);
  }

  async function loadPage(nextPage: number) {
    loading = true;
    loadError = '';
    const url = new URL(routes.adminMedia, window.location.origin);
    if (listQuery.trim()) url.searchParams.set('q', listQuery.trim());
    if (listUsage !== 'all') url.searchParams.set('usage', listUsage);
    if (listSort !== 'newest') url.searchParams.set('sort', listSort);
    if (nextPage > 1) url.searchParams.set('page', String(nextPage));
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error('Không tải được thư viện.');
      const payload = (await response.json()) as { items: MediaItem[]; uses: Record<string, MediaUse[]>; total: number; page: number };
      library = payload.items;
      useMap = payload.uses ?? {};
      libraryTotal = payload.total;
      libraryPage = payload.page;
      rememberPreview(payload.items);
      window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    } catch (error) {
      loadError = error instanceof Error ? error.message : 'Không tải được thư viện.';
    } finally {
      loading = false;
    }
  }

  function marked(id: number): boolean {
    return (dialogOpen ? draft : chosen).includes(String(id));
  }

  function openDialog() {
    draft = [...chosen];
    previewId = chosen[0] ? Number(chosen[0]) : null;
    query = '';
    message = '';
    if (hideTrigger) open = true;
    else showing = true;
  }

  function close() {
    if (hideTrigger) open = false;
    else showing = false;
  }

  function publish() {
    queueMicrotask(() => {
      idInput?.dispatchEvent(new Event('input', { bubbles: true }));
      idInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  function chooseTile(item: MediaItem) {
    previewId = item.id;
    confirmDeleteId = null;
    if (manage) {
      altDraft = item.alt;
      altStatus = '';
    }
    if (manage) return;
    const id = String(item.id);
    if (!multiple) {
      draft = [id];
      return;
    }
    if (draft.includes(id)) {
      draft = draft.filter((value) => value !== id);
      return;
    }
    if (draft.length >= max) {
      message = `Tối đa ${max} ảnh.`;
      return;
    }
    message = '';
    draft = [...draft, id];
  }

  function confirm() {
    if (onPick) {
      if (preview) onPick(preview);
      close();
      return;
    }
    if (multiple) chosen = draft;
    else if (preview) {
      chosen = [String(preview.id)];
      alt = preview.alt;
    }
    publish();
    close();
  }

  function clearChoice() {
    chosen = [];
    alt = '';
    message = '';
    publish();
  }

  function removeChip(id: number) {
    chosen = chosen.filter((value) => value !== String(id));
    publish();
  }

  async function send(file: File) {
    const item = await uploadMedia(csrf, file);
    previewId = item.id;
    altDraft = item.alt;
    const id = String(item.id);
    if (manage) {
      libraryTotal += 1;
      return;
    }
    if (!dialogOpen) {
        if (multiple) {
          if (!chosen.includes(id) && chosen.length < max) chosen = [id, ...chosen];
        } else {
          chosen = [id];
          alt = item.alt;
        }
        publish();
        return;
      }
      if (!multiple) draft = [id];
      if (multiple && !draft.includes(id) && draft.length < max) draft = [id, ...draft];
  }

  async function sendFiles(files: File[]) {
    if (files.length === 0 || busy) return;
    message = '';
    busy = true;
    const errors: string[] = [];
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        if (!file) continue;
        progress = files.length > 1 ? `Đang tải ${index + 1}/${files.length}` : 'Đang tải...';
        try {
          await send(file);
        } catch (error) {
          errors.push(`${file.name}: ${error instanceof Error ? error.message : 'Không lưu được ảnh.'}`);
        }
      }
    } finally {
      progress = '';
      busy = false;
      message = errors.join(' ');
    }
  }

  function onPickFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    void sendFiles(files);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    hot = false;
    void sendFiles([...(event.dataTransfer?.files ?? [])]);
  }

  async function copyPath(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      copied = url;
      window.setTimeout(() => {
        if (copied === url) copied = '';
      }, 1500);
    } catch {
      message = 'Không copy được đường dẫn.';
    }
  }

  function scheduleAlt() {
    window.clearTimeout(altTimer);
    altTimer = window.setTimeout(() => void saveAlt(), 500);
  }

  async function saveAlt(id = chosen[0] ?? '') {
    window.clearTimeout(altTimer);
    if (!id) return;
    const body = new FormData();
    body.set('csrf', csrf);
    body.set('intent', 'alt');
    body.set('id', id);
    body.set('alt', alt);
    const response = await fetch(routes.adminMedia, {
      method: 'POST',
      headers: { accept: 'application/json' },
      body,
    });
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      message = payload.error ?? 'Không lưu được mô tả ảnh.';
      return;
    }
    library = library.map((item) => (String(item.id) === id ? { ...item, alt } : item));
    window.dispatchEvent(new CustomEvent('media-alt', { detail: { id: Number(id), alt } }));
  }

  async function saveTileAlt(item: MediaItem, value: string) {
    const next = value.slice(0, 200);
    altStatus = 'Đang lưu...';
    const body = new FormData();
    body.set('csrf', csrf);
    body.set('intent', 'alt');
    body.set('id', String(item.id));
    body.set('alt', next);
    const response = await fetch(routes.adminMedia, {
      method: 'POST',
      headers: { accept: 'application/json' },
      body,
    });
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      altStatus = payload.error ?? 'Không lưu được mô tả ảnh.';
      return;
    }
    library = library.map((entry) => (entry.id === item.id ? { ...entry, alt: next } : entry));
    altStatus = 'Đã lưu mô tả.';
    window.dispatchEvent(new CustomEvent('media-alt', { detail: { id: item.id, alt: next } }));
  }

  async function removeItem(item: MediaItem) {
    if (usesOf(item).length > 0 || deleting) return;
    deleting = true;
    message = '';
    try {
      const body = new FormData();
      body.set('csrf', csrf);
      const response = await fetch(routes.adminMediaDelete(item.id), {
        method: 'POST',
        headers: { accept: 'application/json' },
        body,
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        message = payload?.error ?? 'Không xóa được ảnh.';
        return;
      }
      library = library.filter((entry) => entry.id !== item.id);
      libraryTotal = Math.max(0, libraryTotal - 1);
      if (previewId === item.id) previewId = null;
      confirmDeleteId = null;
    } catch {
      message = 'Không kết nối được. Thử lại.';
    } finally {
      deleting = false;
    }
  }

  function meta(item: MediaItem): string {
    const pixels = item.width && item.height ? `${item.width} × ${item.height}` : 'Chưa có kích thước';
    return `${pixels} · ${formatBytes(item.sizeBytes)} · ${formatDateTime(item.createdAt)}`;
  }

  function formatMime(mime: string): string {
    if (mime === 'image/jpeg') return 'JPEG';
    if (mime === 'image/png') return 'PNG';
    if (mime === 'image/webp') return 'WebP';
    return mime || 'Không rõ';
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

{#if manage}
  <div
    class="media-page"
    class:is-dropping={hot}
    ondragover={(event) => {
      event.preventDefault();
      hot = true;
    }}
    ondragleave={() => (hot = false)}
    ondrop={onDrop}
  >
    {#if manageEmpty}
      <section class="cms-empty">
        <span class="cms-empty-icon" aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <rect x="4" y="5" width="16" height="14" rx="2" />
            <circle cx="9" cy="10" r="1.6" />
            <path d="m7 17 4-4.5 3 3L17 12l3 4" />
          </svg>
        </span>
        <h2 class="cms-empty-title">Thư viện ảnh đang trống</h2>
        <p class="cms-empty-text">Tải ảnh lên để dùng chung cho sản phẩm, bài viết, trang đích và cài đặt.</p>
        <ul class="cms-empty-points">
          <li>Hỗ trợ JPEG, PNG, WebP; tối đa 2 MB mỗi ảnh.</li>
          <li>Thêm mô tả (ALT) cho ảnh để tốt cho SEO và trợ năng.</li>
          <li>Một ảnh tải một lần, dùng lại ở nhiều nơi.</li>
        </ul>
      </section>
    {/if}
    <div class="media-library-bar" class:is-empty={manageEmpty}>
      {#if !manageEmpty}
        <input class="field" type="search" placeholder="Tìm theo tên hoặc mô tả" value={listQuery} oninput={(event) => { listQuery = (event.currentTarget as HTMLInputElement).value; scheduleLibrary(); }} />
        <select class="field" value={listUsage} onchange={(event) => { listUsage = (event.currentTarget as HTMLSelectElement).value as typeof listUsage; void loadPage(1); }}>
          <option value="all">Tất cả</option>
          <option value="used">Đang dùng</option>
          <option value="unused">Chưa dùng</option>
        </select>
        <select class="field" value={listSort} onchange={(event) => { listSort = (event.currentTarget as HTMLSelectElement).value as typeof listSort; void loadPage(1); }}>
          <option value="newest">Mới nhất</option>
          <option value="name">Tên</option>
          <option value="size">Dung lượng</option>
        </select>
      {/if}
      <button class="btn btn-primary" type="button" disabled={busy} onclick={() => fileInput?.click()}>Tải ảnh lên</button>
    </div>
    <input class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple bind:this={fileInput} onchange={onPickFile} />
    {#if progress}<p class="media-meta" role="status">{progress}</p>{/if}
    {#if message}<p class="error-text" role="alert">{message}</p>{/if}
    {#if loadError}<p class="error-text" role="alert">{loadError}</p>{/if}
    {#if !manageEmpty}
      <div class="media-layout" aria-busy={loading}>
        {@render grid(true)}
        {@render previewPane()}
      </div>
    {/if}
    {#if pageCount > 1}
      <div class="media-pages">
        <button class="btn" type="button" disabled={libraryPage <= 1 || loading} onclick={() => void loadPage(libraryPage - 1)}>Trước</button>
        <span>Trang {libraryPage}/{pageCount}</span>
        <button class="btn" type="button" disabled={libraryPage >= pageCount || loading} onclick={() => void loadPage(libraryPage + 1)}>Sau</button>
      </div>
    {/if}
  </div>
{:else}
  <div class="media-field">
    {#if multiple}
      {#each chosen as id (id)}
        <input type="hidden" {name} value={id} />
      {/each}
    {:else}
      <input type="hidden" {name} value={chosen[0] ?? ''} bind:this={idInput} />
    {/if}
    {#if !hideTrigger}
      {#if multiple}
        <div class="media-chips">
          {#each chosenItems as item (item.id)}
            <button type="button" onclick={() => removeChip(item.id)}>
              <img src={item.url} alt="" />
              <span>{item.filename}</span>
            </button>
          {/each}
          <button class="btn" type="button" onclick={openDialog}>Thêm ảnh</button>
        </div>
        <p class="media-meta">{chosen.length}/{max} ảnh</p>
      {:else if chosenItems[0]}
        <div class="media-picked">
          <img src={chosenItems[0].url} alt={alt || chosenItems[0].filename} />
          <div class="media-picked-actions">
            <button type="button" onclick={openDialog}>Đổi ảnh</button>
            <button type="button" onclick={clearChoice}>Bỏ ảnh</button>
          </div>
        </div>
        {#if editAlt}
          <label class="mt-3 block">
            <span class="mb-1 block font-semibold">Mô tả ảnh</span>
            <input class="field" maxlength="200" data-cover-alt bind:value={alt} oninput={scheduleAlt} onblur={() => void saveAlt()} />
          </label>
        {/if}
      {:else}
        {@render dropzone(openDialog)}
      {/if}
    {/if}
    <dialog
      class="media-dialog"
      aria-label="Chọn ảnh"
      bind:this={dialogEl}
      oncancel={(event) => {
        event.preventDefault();
        close();
      }}
      onclick={(event) => {
        if (event.target === dialogEl) close();
      }}
    >
      <div class="media-dialog-head">
        <h2>Chọn ảnh</h2>
        <button class="btn" type="button" onclick={close}>Đóng</button>
      </div>
      {@render toolbar()}
      {#if message}<p class="error-text" role="alert">{message}</p>{/if}
      <div class="media-layout">
        {@render previewPane()}
        {@render grid(false)}
      </div>
      <div class="media-dialog-foot">
        <button class="btn btn-primary" type="button" disabled={!preview} onclick={confirm}>
          {onPick ? 'Chèn vào bài' : multiple ? `Xong (${draft.length})` : 'Dùng ảnh này'}
        </button>
      </div>
    </dialog>
  </div>
{/if}

{#snippet toolbar()}
  <div class="media-toolbar">
    <input class="field" type="search" placeholder="Tìm theo tên hoặc mô tả" bind:this={searchEl} bind:value={query} onkeydown={(event) => event.key === 'Enter' && event.preventDefault()} />
    {@render dropzone()}
  </div>
{/snippet}

{#snippet dropzone(after?: () => void)}
  <div
    class="media-drop"
    class:media-drop-hot={hot}
    role="button"
    tabindex="0"
    aria-disabled={busy}
    ondragover={(event) => {
      event.preventDefault();
      hot = true;
    }}
    ondragleave={() => (hot = false)}
    ondrop={onDrop}
    onclick={() => (after ? after() : fileInput?.click())}
    onkeydown={(event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (after) after();
      else fileInput?.click();
    }}
  >
    <p>{progress || (busy ? 'Đang tải...' : after ? 'Kéo ảnh vào đây, hoặc mở thư viện' : 'Kéo ảnh vào đây, hoặc chọn tệp')}</p>
    <p class="media-meta">JPEG, PNG hoặc WebP, tối đa 2 MB</p>
  </div>
  <input class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple bind:this={fileInput} onchange={onPickFile} />
{/snippet}

{#snippet previewPane()}
  <aside class="media-preview">
    {#if preview}
      <img src={preview.url} alt={preview.alt || preview.filename} />
      <p class="font-semibold">{preview.filename}</p>
      <p class="media-meta">{meta(preview)}</p>
      <button class="btn" type="button" onclick={() => preview && void copyPath(preview.url)}>{copied === preview.url ? 'Đã copy' : 'Copy đường dẫn'}</button>
      {#if manage}
        <dl class="media-facts">
          <div><dt>Định dạng</dt><dd>{formatMime(preview.mimeType)}</dd></div>
          <div><dt>Kích thước</dt><dd>{preview.width && preview.height ? `${preview.width} × ${preview.height}` : 'Chưa có'}</dd></div>
          <div><dt>Dung lượng</dt><dd>{formatBytes(preview.sizeBytes)}</dd></div>
          <div><dt>Tải lên</dt><dd>{formatDateTime(preview.createdAt)}</dd></div>
          <div><dt>URL</dt><dd>{preview.url}</dd></div>
        </dl>
        <label class="mt-3 block">
          <span class="mb-1 block font-semibold">ALT mặc định</span>
          <input class="field" maxlength="200" value={altDraft} oninput={(event) => { altDraft = (event.currentTarget as HTMLInputElement).value; altStatus = ''; }} onchange={() => { if (preview) void saveTileAlt(preview, altDraft); }} />
        </label>
        {#if altStatus}<p class="media-meta" role="status">{altStatus}</p>{/if}
        <p class="mt-3 font-semibold">Nơi sử dụng</p>
        {#if usesOf(preview).length > 0}
          <ul class="media-uses">
            {#each usesOf(preview) as place (place.href + place.label)}
              <li><a href={place.href}>{place.label}</a></li>
            {/each}
          </ul>
          <p class="media-meta">Ảnh đang được dùng, không xóa được.</p>
        {:else}
          <p class="media-meta">Chưa được dùng.</p>
        {/if}
        {#if confirmDeleteId === preview.id}
          <div class="media-delete-confirm">
            <p class="media-meta">Xóa ảnh này? Không khôi phục được.</p>
            <div class="media-delete-actions">
              <button class="btn" type="button" disabled={deleting} onclick={() => (confirmDeleteId = null)}>Hủy</button>
              <button class="btn btn-accent" type="button" disabled={deleting} onclick={() => preview && void removeItem(preview)}>{deleting ? 'Đang xóa...' : 'Xác nhận xóa'}</button>
            </div>
          </div>
        {:else}
          <button class="btn btn-accent mt-3" type="button" disabled={usesOf(preview).length > 0} onclick={() => (confirmDeleteId = preview?.id ?? null)}>Xóa ảnh</button>
        {/if}
      {/if}
    {:else}
      <p class="media-meta">Chọn một ảnh để xem trước.</p>
    {/if}
  </aside>
{/snippet}

{#snippet grid(showUses: boolean)}
  {#if loading && visible.length === 0}
    <p class="media-meta">Đang tải thư viện...</p>
  {:else if visible.length === 0}
    <p class="media-meta">{manage && (listQuery || listUsage !== 'all') ? 'Không thấy ảnh phù hợp.' : library.length === 0 ? 'Chưa có ảnh.' : 'Không thấy ảnh phù hợp.'}</p>
  {:else}
    <ul class="media-grid">
      {#each visible as item (item.id)}
        <li>
          <button class="media-tile" type="button" aria-pressed={marked(item.id) || previewId === item.id} onclick={() => chooseTile(item)}>
            <img src={item.url} alt="" width={item.width ?? undefined} height={item.height ?? undefined} loading="lazy" />
            <span>{item.filename}</span>
            {#if showUses}
              <span class="media-use-flag" data-used={usesOf(item).length > 0 ? 'yes' : 'no'}>{usesOf(item).length > 0 ? 'Đang dùng' : 'Chưa dùng'}</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}
