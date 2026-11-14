<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { formatDateTime } from '../../lib/datetime';
  import { routes } from '../../lib/routes';
  import type { MediaItem, MediaUse } from '../../features/media/types';
  import { uploadMedia } from './upload-media';
  import { resizeImage } from './resize-image';

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

  function normalizeItem(item: MediaItem): MediaItem {
    return {
      ...item,
      cardUrl: item.cardUrl ?? null,
      thumbUrl: item.thumbUrl ?? null,
    };
  }

  const initialItems = untrack(() => items.map(normalizeItem));
  const initialPreview = untrack(() => (manage ? initialItems[0] ?? null : null));

  // Picker: không hydrate cả thư viện — lưới chỉ sau loadPage (24/trang). Manage: SSR đã phân trang.
  let library = $state<MediaItem[]>(untrack(() => (manage ? initialItems : [])));
  let useMap = $state<Record<string, MediaUse[]>>(untrack(() => ({ ...uses })));
  let libraryTotal = $state(untrack(() => (manage ? total : 0)));
  let libraryPage = $state(untrack(() => (manage ? page : 1)));
  let listQuery = $state(untrack(() => libraryQuery));
  let listUsage = $state(untrack(() => libraryUsage));
  let listSort = $state(untrack(() => librarySort));
  let loading = $state(false);
  let deleting = $state(false);
  let replacing = $state(false);
  let backfilling = $state(false);
  let confirmDeleteId = $state<number | null>(null);
  let loadError = $state('');
  let progress = $state('');
  let backfillStatus = $state('');
  let altDraft = $state(initialPreview?.alt ?? '');
  let altStatus = $state('');
  /** Mở rộng danh sách nơi dùng (mặc định chỉ hiện vài dòng). */
  let usesExpanded = $state(false);
  let filterTimer = 0;
  const USES_PREVIEW_COUNT = 5;
  /** Chế độ hiển thị lưới / danh sách (chỉ ảnh hưởng client). */
  let viewMode = $state<'grid' | 'list'>('grid');
  /** Id của ảnh đang mở menu "..." trên lưới. */
  let menuFor = $state<number | null>(null);
  /** Phóng to ảnh preview trong lightbox. */
  let zoomed = $state(false);
  let chosen = $state<string[]>(untrack(() => selected.filter(Boolean)));
  let draft = $state<string[]>([]);
  let showing = $state(false);
  let query = $state('');
  let previewId = $state<number | null>(initialPreview?.id ?? null);
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
  let replaceInput = $state<HTMLInputElement | null>(null);

  const dialogOpen = $derived(manage ? false : hideTrigger ? open : showing);
  /** Ảnh SSR ban đầu — giữ để preview ảnh đã chọn khi trang hiện tại không chứa chúng. */
  const seedById = new Map(initialItems.map((item) => [item.id, item]));
  const preview = $derived(
    library.find((item) => item.id === previewId) ?? (previewId != null ? (seedById.get(previewId) ?? null) : null),
  );
  /** Lưới luôn lấy từ trang server (24 ảnh), không lọc cả thư viện trên client. */
  const visible = $derived(library);
  const pageCount = $derived(Math.max(1, Math.ceil(libraryTotal / Math.max(1, pageSize))));
  const rangeFrom = $derived(libraryTotal === 0 ? 0 : (libraryPage - 1) * pageSize + 1);
  const rangeTo = $derived(Math.min(libraryTotal, libraryPage * pageSize));
  /** Cửa sổ số trang hẹp — tránh render hàng trăm nút khi thư viện lớn. */
  const pageWindow = $derived.by(() => {
    if (pageCount <= 9) return Array.from({ length: pageCount }, (_, index) => index + 1);
    const start = Math.max(1, Math.min(libraryPage - 3, pageCount - 6));
    const end = Math.min(pageCount, start + 6);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  });
  // Trống thật sự: không có item trên client (tránh ẩn lưới khi chỉ total hydrate sai).
  const manageEmpty = $derived(
    manage && library.length === 0 && libraryTotal === 0 && listQuery.trim() === '' && listUsage === 'all' && listSort === 'newest',
  );
  const chosenItems = $derived(
    chosen
      .map((id) => library.find((item) => String(item.id) === id) ?? seedById.get(Number(id)) ?? null)
      .filter((item): item is MediaItem => !!item),
  );

  onMount(() => {
    const onAdd = (event: Event) => {
      const item = (event as CustomEvent<MediaItem>).detail;
      if (!item) return;
      const next = normalizeItem(item);
      seedById.set(next.id, next);
      if (!manage) {
        // Picker: tải lại trang 1 để không vượt 24; đóng modal thì chỉ cần seed cho chip/preview.
        if (dialogOpen) void loadPage(1);
        return;
      }
      if (library.some((entry) => entry.id === next.id)) return;
      library = [next, ...library];
      libraryTotal += 1;
    };
    const onAlt = (event: Event) => {
      const detail = (event as CustomEvent<{ id: number; alt: string }>).detail;
      if (!detail) return;
      library = library.map((item) => (item.id === detail.id ? { ...item, alt: detail.alt } : item));
    };
    const onDocClick = (event: MouseEvent) => {
      if (menuFor === null) return;
      const target = event.target as HTMLElement | null;
      if (target && target.closest('.media-cell-menu')) return;
      menuFor = null;
    };
    window.addEventListener('media-uploaded', onAdd);
    window.addEventListener('media-alt', onAlt);
    window.addEventListener('click', onDocClick);
    return () => {
      window.removeEventListener('media-uploaded', onAdd);
      window.removeEventListener('media-alt', onAlt);
      window.removeEventListener('click', onDocClick);
    };
  });

  function resetPickerLibrary() {
    listQuery = '';
    query = '';
    library = [];
    libraryTotal = 0;
    libraryPage = 1;
    void loadPage(1);
  }

  $effect(() => {
    if (!dialogEl || manage) return;
    if (dialogOpen && !dialogEl.open) {
      dialogEl.showModal();
      // hideTrigger: parent bật open (PostEditor…) — không qua openDialog.
      if (hideTrigger) resetPickerLibrary();
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
    const nextId = next?.id ?? null;
    if (nextId !== previewId) usesExpanded = false;
    previewId = nextId;
    altDraft = next?.alt ?? '';
    altStatus = '';
  }

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
      library = (payload.items ?? []).map(normalizeItem);
      for (const item of library) seedById.set(item.id, item);
      useMap = payload.uses ?? {};
      libraryTotal = payload.total;
      libraryPage = payload.page;
      rememberPreview(library);
      // Chỉ đổi URL trên trang quản lý media — picker mở từ bài/SP không được đẩy sang /admin/media.
      if (manage) window.history.replaceState(null, '', `${url.pathname}${url.search}`);
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
    message = '';
    loadError = '';
    if (hideTrigger) {
      open = true;
      return;
    }
    resetPickerLibrary();
    showing = true;
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
    if (item.id !== previewId) usesExpanded = false;
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

  /** Nút "Lưu thay đổi" ở khung preview: lưu mô tả ALT của ảnh đang xem. */
  async function savePreviewAlt() {
    if (!preview) return;
    await saveTileAlt(preview, altDraft);
  }

  function toggleMenu(id: number) {
    menuFor = menuFor === id ? null : id;
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

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /** Ô lưới / preview chọn (~140px+): dùng card 800px, không dùng thumb 96 (bị mờ khi phóng). */
  function tileSrc(item: MediaItem): string {
    return item.cardUrl || item.url;
  }

  /** Chip nhỏ: thumb đủ nét. */
  function chipSrc(item: MediaItem): string {
    return item.thumbUrl || item.cardUrl || item.url;
  }

  async function runBackfill() {
    if (backfilling) return;
    backfilling = true;
    backfillStatus = '';
    message = '';
    try {
      const body = new FormData();
      body.set('csrf', csrf);
      body.set('intent', 'backfill-variants');
      const response = await fetch(routes.adminMedia, {
        method: 'POST',
        headers: { accept: 'application/json' },
        body,
      });
      const payload = (await response.json()) as {
        error?: string;
        updated?: number;
        processed?: number;
        remaining?: number;
        skipped?: number;
      };
      if (!response.ok) throw new Error(payload.error ?? 'Không tạo được bản card/thumb.');
      backfillStatus = `Đã cập nhật ${payload.updated ?? 0}/${payload.processed ?? 0} ảnh; còn ${payload.remaining ?? 0}.`;
      await loadPage(libraryPage);
    } catch (error) {
      message = error instanceof Error ? error.message : 'Không tạo được bản card/thumb.';
    } finally {
      backfilling = false;
    }
  }

  /** Thêm tham số cache-bust để <img> tải lại ngay sau khi thay (URL/key không đổi). */
  function bust(url: string): string {
    return `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`;
  }

  function onPickReplace(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (file) void replacePreview(file);
  }

  /** Thay nội dung ảnh đang xem bằng file mới; giữ nguyên id nên mọi nơi dùng tự cập nhật. */
  async function replacePreview(file: File) {
    if (!preview || replacing) return;
    const target = preview;
    replacing = true;
    message = '';
    altStatus = 'Đang thay ảnh...';
    try {
      const image = await resizeImage(file);
      const body = new FormData();
      body.set('csrf', csrf);
      body.set('intent', 'replace');
      body.set('id', String(target.id));
      body.set('file', image.file, image.file.name);
      body.set('width', String(image.width));
      body.set('height', String(image.height));
      const response = await fetch(routes.adminMedia, { method: 'POST', headers: { accept: 'application/json' }, body });
      const payload = (await response.json().catch(() => null)) as
        | ({ ok?: boolean; url?: string; cardUrl?: string | null; thumbUrl?: string | null; filename?: string; mimeType?: string; width?: number | null; height?: number | null; sizeBytes?: number } & { error?: string })
        | null;
      if (!response.ok || !payload?.ok || !payload.url) {
        altStatus = '';
        message = payload?.error ?? 'Không thay được ảnh.';
        return;
      }
      const next: Partial<MediaItem> = {
        url: bust(payload.url),
        cardUrl: payload.cardUrl ? bust(payload.cardUrl) : null,
        thumbUrl: payload.thumbUrl ? bust(payload.thumbUrl) : null,
        filename: payload.filename ?? target.filename,
        mimeType: payload.mimeType ?? target.mimeType,
        width: payload.width ?? null,
        height: payload.height ?? null,
        sizeBytes: payload.sizeBytes ?? target.sizeBytes,
      };
      library = library.map((entry) => (entry.id === target.id ? { ...entry, ...next } : entry));
      altStatus = 'Đã thay ảnh.';
    } catch (error) {
      altStatus = '';
      message = error instanceof Error ? error.message : 'Không thay được ảnh.';
    } finally {
      replacing = false;
    }
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
    <input class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple bind:this={fileInput} onchange={onPickFile} />
    {#if manageEmpty}
      <div class="media-library-bar is-empty">
        <button class="btn btn-primary" type="button" disabled={busy} onclick={() => fileInput?.click()}>Tải ảnh lên</button>
      </div>
    {:else}
      <div class="media-shell" aria-busy={loading}>
        <div class="media-main">
          <div class="media-dropbar" class:media-dropbar-hot={hot}>
            <div class="media-dropbar-text">
              <p class="media-dropbar-title">Kéo thả ảnh vào đây hoặc</p>
              <button class="btn btn-primary media-dropbar-pick" type="button" disabled={busy} onclick={() => fileInput?.click()}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M12 16V4" />
                  <path d="m7 9 5-5 5 5" />
                  <path d="M5 16v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
                </svg>
                Chọn ảnh từ máy
              </button>
              <p class="media-meta">Hỗ trợ JPG, PNG, WEBP · Tối đa 2MB/ảnh</p>
            </div>
          </div>
          <div class="media-library-bar">
            <label class="media-search">
              <svg class="media-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input class="field" type="search" placeholder="Tìm theo tên ảnh hoặc mô tả ALT..." value={listQuery} oninput={(event) => { listQuery = (event.currentTarget as HTMLInputElement).value; scheduleLibrary(); }} />
            </label>
            <select class="field" value={listUsage} onchange={(event) => { listUsage = (event.currentTarget as HTMLSelectElement).value as typeof listUsage; void loadPage(1); }}>
              <option value="all">Tất cả ảnh</option>
              <option value="used">Đang dùng</option>
              <option value="unused">Chưa dùng</option>
            </select>
            <select class="field" value={listSort} onchange={(event) => { listSort = (event.currentTarget as HTMLSelectElement).value as typeof listSort; void loadPage(1); }}>
              <option value="newest">Mới nhất</option>
              <option value="name">Tên</option>
              <option value="size">Dung lượng</option>
            </select>
            <div class="media-view-toggle" role="group" aria-label="Kiểu hiển thị">
              <button class="media-view-btn" type="button" aria-pressed={viewMode === 'grid'} title="Lưới" onclick={() => (viewMode = 'grid')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
                <span class="sr-only">Lưới</span>
              </button>
              <button class="media-view-btn" type="button" aria-pressed={viewMode === 'list'} title="Danh sách" onclick={() => (viewMode = 'list')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" />
                  <path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" />
                </svg>
                <span class="sr-only">Danh sách</span>
              </button>
            </div>
          </div>
          <div class="media-backfill-row">
            <button class="media-backfill-link" type="button" disabled={backfilling || busy} onclick={() => void runBackfill()}>
              {backfilling ? 'Đang tạo card/thumb…' : 'Tạo card/thumb còn thiếu'}
            </button>
          </div>
          {#if progress}<p class="media-meta" role="status">{progress}</p>{/if}
          {#if backfillStatus}<p class="media-meta" role="status">{backfillStatus}</p>{/if}
          {#if message}<p class="error-text" role="alert">{message}</p>{/if}
          {#if loadError}<p class="error-text" role="alert">{loadError}</p>{/if}
          {@render grid(true)}
          <div class="media-pages">
            <span class="media-pages-count">Hiển thị {rangeFrom}–{rangeTo} trong {libraryTotal} ảnh</span>
            <div class="media-pages-nav">
              <button class="media-page-arrow" type="button" aria-label="Trang trước" disabled={libraryPage <= 1 || loading} onclick={() => void loadPage(libraryPage - 1)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
              </button>
              {#each pageWindow as pageNumber (pageNumber)}
                <button class="media-page-num" type="button" aria-current={pageNumber === libraryPage ? 'page' : undefined} aria-pressed={pageNumber === libraryPage} disabled={loading} onclick={() => void loadPage(pageNumber)}>{pageNumber}</button>
              {/each}
              <button class="media-page-arrow" type="button" aria-label="Trang sau" disabled={libraryPage >= pageCount || loading} onclick={() => void loadPage(libraryPage + 1)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
              </button>
            </div>
          </div>
        </div>
        {@render previewPane()}
      </div>
    {/if}
  </div>
  {#if zoomed && preview}
    <div
      class="media-lightbox"
      role="button"
      tabindex="0"
      aria-label="Đóng xem ảnh"
      onclick={() => (zoomed = false)}
      onkeydown={(event) => { if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') { event.preventDefault(); zoomed = false; } }}
    >
      <img src={preview.url} alt={preview.alt || preview.filename} />
    </div>
  {/if}
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
              <img src={chipSrc(item)} alt="" />
              <span>{item.filename}</span>
            </button>
          {/each}
          <button class="btn" type="button" onclick={openDialog}>Thêm ảnh</button>
        </div>
        <p class="media-meta">{chosen.length}/{max} ảnh</p>
      {:else if chosenItems[0]}
        <div class="media-picked">
          <img src={tileSrc(chosenItems[0])} alt={alt || chosenItems[0].filename} />
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
      <div class="media-dialog-body">
        {@render toolbar()}
        {#if message}<p class="error-text" role="alert">{message}</p>{/if}
        {#if loadError}<p class="error-text" role="alert">{loadError}</p>{/if}
        <div class="media-layout media-layout-picker">
          {@render grid(false)}
        </div>
        {@render pickerPager()}
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
    <input
      class="field media-search-field"
      type="search"
      placeholder="Tìm theo tên hoặc mô tả"
      bind:this={searchEl}
      bind:value={listQuery}
      oninput={() => scheduleLibrary()}
      onkeydown={(event) => event.key === 'Enter' && event.preventDefault()}
    />
    {@render dropzone()}
  </div>
{/snippet}

{#snippet pickerPager()}
  {#if libraryTotal > 0}
    <div class="media-pages media-pages-picker">
      <span class="media-pages-count">
        {loading ? 'Đang tải…' : `Hiển thị ${rangeFrom}–${rangeTo} / ${libraryTotal} ảnh`}
      </span>
      {#if pageCount > 1}
        <div class="media-pages-nav">
          <button class="media-page-arrow" type="button" aria-label="Trang trước" disabled={libraryPage <= 1 || loading} onclick={() => void loadPage(libraryPage - 1)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <span class="media-pages-label">Trang {libraryPage}/{pageCount}</span>
          <button class="media-page-arrow" type="button" aria-label="Trang sau" disabled={libraryPage >= pageCount || loading} onclick={() => void loadPage(libraryPage + 1)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet dropzone(after: (() => void) | undefined = undefined)}
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
  <aside class="media-preview" class:media-preview-card={manage}>
    {#if preview}
      {#if manage}
        {@const inUse = usesOf(preview).length > 0}
        <div class="media-preview-figure">
          <img src={preview.url} alt={preview.alt || preview.filename} />
          <button class="media-zoom-btn" type="button" aria-label="Phóng to ảnh" onclick={() => (zoomed = true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M8 3H5a2 2 0 0 0-2 2v3" />
              <path d="M16 3h3a2 2 0 0 1 2 2v3" />
              <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
              <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
            </svg>
          </button>
        </div>
        <p class="media-preview-name">{preview.filename}</p>
        <p class="media-meta">{formatBytes(preview.sizeBytes)} · {preview.width && preview.height ? `${preview.width} × ${preview.height}` : 'Chưa có kích thước'} · {formatDateTime(preview.createdAt)}</p>
        <div class="media-preview-actions">
          <button class="btn media-action-btn media-copy-btn" type="button" aria-label={copied === preview.url ? 'Đã sao chép URL' : 'Sao chép URL'} title={copied === preview.url ? 'Đã sao chép' : 'Sao chép URL'} onclick={() => preview && void copyPath(preview.url)}>
            {#if copied === preview.url}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            {:else}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            {/if}
          </button>
          <button class="btn media-action-btn media-replace-btn" type="button" disabled={replacing} aria-label="Thay ảnh" title="Thay ảnh (giữ nguyên mọi nơi đang dùng, chỉ đổi nội dung)" onclick={() => replaceInput?.click()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class:media-spin={replacing}>
              <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            </svg>
          </button>
          <button class="btn media-action-btn media-del-btn" type="button" disabled={inUse} aria-label="Xóa ảnh" title={inUse ? 'Ảnh đang được dùng, chưa xóa được.' : 'Xóa ảnh'} onclick={() => (confirmDeleteId = preview?.id ?? null)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6" /><path d="M14 11v6" />
            </svg>
          </button>
          <input class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" bind:this={replaceInput} onchange={onPickReplace} />
        </div>
        <label class="media-field-block">
          <span class="media-field-label">ALT (mô tả ảnh)</span>
          <input class="field" maxlength="200" placeholder="Mô tả ngắn gọn nội dung ảnh" value={altDraft} oninput={(event) => { altDraft = (event.currentTarget as HTMLInputElement).value; altStatus = ''; }} />
        </label>
        <div class="media-status-row">
          <span class="media-field-label">Trạng thái sử dụng</span>
          {#if usesOf(preview).length > 0}
            {@const allUses = usesOf(preview)}
            {@const usesTotal = allUses.length}
            {@const usesVisible = usesExpanded ? allUses : allUses.slice(0, USES_PREVIEW_COUNT)}
            <span class="media-status-badge" data-used="yes">Đang dùng</span>
            <ul class="media-uses" class:is-expanded={usesExpanded && usesTotal > USES_PREVIEW_COUNT}>
              {#each usesVisible as place (place.href + place.label)}
                <li><a href={place.href}>{place.label}</a></li>
              {/each}
            </ul>
            {#if usesTotal > USES_PREVIEW_COUNT}
              <button class="media-uses-more" type="button" onclick={() => (usesExpanded = !usesExpanded)}>
                {usesExpanded ? 'Thu gọn' : `Xem thêm ${usesTotal - USES_PREVIEW_COUNT} nơi`}
              </button>
            {/if}
            <p class="media-meta">Ảnh đang được dùng, chưa xóa được.</p>
          {:else}
            <span class="media-status-badge" data-used="no">Chưa dùng</span>
          {/if}
        </div>
        {#if altStatus}<p class="media-meta" role="status">{altStatus}</p>{/if}
        {#if confirmDeleteId === preview.id}
          <div class="media-delete-confirm">
            <p class="media-meta">Xóa ảnh này? Không khôi phục được.</p>
            <div class="media-delete-actions">
              <button class="btn" type="button" disabled={deleting} onclick={() => (confirmDeleteId = null)}>Hủy</button>
              <button class="btn btn-accent" type="button" disabled={deleting} onclick={() => preview && void removeItem(preview)}>{deleting ? 'Đang xóa...' : 'Xác nhận xóa'}</button>
            </div>
          </div>
        {/if}
        <button class="btn btn-primary media-save-btn" type="button" onclick={() => void savePreviewAlt()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          Lưu thay đổi
        </button>
      {:else}
        <img src={preview.url} alt={preview.alt || preview.filename} />
        <p class="font-semibold">{preview.filename}</p>
        <p class="media-meta">{meta(preview)}</p>
        <button class="btn" type="button" onclick={() => preview && void copyPath(preview.url)}>{copied === preview.url ? 'Đã copy' : 'Copy đường dẫn'}</button>
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
    <ul class="media-grid" class:media-grid-list={showUses && viewMode === 'list'}>
      {#each visible as item (item.id)}
        {@const selectedTile = marked(item.id) || previewId === item.id}
        {@const usedTile = usesOf(item).length > 0}
        <li class="media-cell">
          <button class="media-tile" type="button" aria-pressed={selectedTile} onclick={() => chooseTile(item)}>
            <span class="media-thumb">
              <img src={tileSrc(item)} alt="" width="800" height="800" loading="lazy" />
              {#if showUses && selectedTile}
                <span class="media-check" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                </span>
              {/if}
            </span>
            <span class="media-tile-name">{item.filename}</span>
            {#if showUses}
              <span class="media-tile-size">{formatBytes(item.sizeBytes)}</span>
              <span class="media-tile-flag" data-used={usedTile ? 'yes' : 'no'}>{usedTile ? 'Đang dùng' : 'Chưa dùng'}</span>
            {/if}
          </button>
          {#if showUses}
            <div class="media-cell-menu">
              <button class="media-dots" type="button" aria-haspopup="true" aria-expanded={menuFor === item.id} aria-label="Thao tác ảnh" onclick={(event) => { event.stopPropagation(); toggleMenu(item.id); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
              </button>
              {#if menuFor === item.id}
                <div class="media-menu" role="menu">
                  <button class="media-menu-item" type="button" role="menuitem" onclick={() => { void copyPath(item.url); menuFor = null; }}>
                    {copied === item.url ? 'Đã sao chép' : 'Sao chép URL'}
                  </button>
                  <button class="media-menu-item media-menu-del" type="button" role="menuitem" disabled={usedTile} onclick={() => { previewId = item.id; altDraft = item.alt; confirmDeleteId = item.id; menuFor = null; }}>
                    Xóa ảnh
                  </button>
                </div>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}
