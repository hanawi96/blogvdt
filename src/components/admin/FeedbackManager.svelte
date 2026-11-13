<script lang="ts">
  import { ADMIN_FLASH_MS } from '../../lib/admin-flash';
  import { FEEDBACK_PIN_MAX } from '../../features/feedback/query';
  import { uploadMedia } from './upload-media';
  import { routes } from '../../lib/routes';

  type FeedbackItem = {
    id: number;
    src: string;
    alt: string;
    width: number;
    height: number;
    mediaId: number | null;
    pinRank: number | null;
  };

  let {
    csrf,
    items: initialItems,
    total: initialTotal,
    pinnedCount: initialPinned,
    page,
    pageCount,
  }: {
    csrf: string;
    items: FeedbackItem[];
    total: number;
    pinnedCount: number;
    page: number;
    pageCount: number;
  } = $props();

  let items = $state<FeedbackItem[]>([...initialItems]);
  let total = $state(initialTotal);
  let pinnedCount = $state(initialPinned);
  let busy = $state(false);
  let hot = $state(false);
  let progress = $state('');
  let message = $state('');
  let error = $state('');
  let fileInput = $state<HTMLInputElement | null>(null);
  let pendingDelete = $state<number | null>(null);
  let deleting = $state(false);
  let pinningId = $state<number | null>(null);
  let movingId = $state<number | null>(null);
  let flashTimer = 0;
  let deleteDialog = $state<HTMLDialogElement | null>(null);

  const pendingPhoto = $derived(items.find((item) => item.id === pendingDelete) ?? null);
  const pinnedItems = $derived(
    items.filter((item) => item.pinRank != null).sort((a, b) => (a.pinRank ?? 0) - (b.pinRank ?? 0)),
  );

  function askDelete(id: number) {
    pendingDelete = id;
    queueMicrotask(() => deleteDialog?.showModal());
  }

  function cancelDelete() {
    if (deleting) return;
    deleteDialog?.close();
    pendingDelete = null;
  }

  const pinsFull = $derived(pinnedCount >= FEEDBACK_PIN_MAX);

  function flash(text: string) {
    message = text;
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => {
      message = '';
      flashTimer = 0;
    }, ADMIN_FLASH_MS);
  }

  function sortItems(list: FeedbackItem[]): FeedbackItem[] {
    return [...list].sort((a, b) => {
      const aPinned = a.pinRank == null ? 1 : 0;
      const bPinned = b.pinRank == null ? 1 : 0;
      if (aPinned !== bPinned) return aPinned - bPinned;
      if (a.pinRank != null && b.pinRank != null && a.pinRank !== b.pinRank) return a.pinRank - b.pinRank;
      return b.id - a.id;
    });
  }

  async function attachMedia(mediaId: number, alt: string, width: number | null, height: number | null) {
    const body = new FormData();
    body.set('csrf', csrf);
    body.set('intent', 'attach');
    body.set('mediaId', String(mediaId));
    body.set('alt', alt);
    if (width) body.set('width', String(width));
    if (height) body.set('height', String(height));
    const response = await fetch(routes.adminFeedback, {
      method: 'POST',
      headers: { accept: 'application/json' },
      body,
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: string;
      photo?: FeedbackItem;
    };
    if (!response.ok || !payload.ok || !payload.photo) {
      throw new Error(payload.error ?? 'Không gắn được ảnh vào feedback.');
    }
    return payload.photo;
  }

  async function uploadFiles(files: File[]) {
    if (files.length === 0 || busy) return;
    if (files.length > 20) {
      error = 'Mỗi lần tải tối đa 20 ảnh.';
      return;
    }
    busy = true;
    error = '';
    message = '';
    let added = 0;
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      if (!file) continue;
      progress = `Đang tải ${index + 1}/${files.length}`;
      try {
        const media = await uploadMedia(csrf, file);
        const photo = await attachMedia(media.id, media.alt || 'Ảnh phản hồi mua hàng từ khách', media.width, media.height);
        items = sortItems([{ ...photo, pinRank: photo.pinRank ?? null }, ...items]);
        total += 1;
        added += 1;
      } catch (reason) {
        error = reason instanceof Error ? reason.message : 'Không tải được ảnh.';
        break;
      }
    }
    busy = false;
    progress = '';
    if (added > 0) flash(added === 1 ? 'Đã thêm 1 ảnh feedback.' : `Đã thêm ${added} ảnh feedback.`);
  }

  function onPickFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    void uploadFiles(files);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    hot = false;
    const files = [...(event.dataTransfer?.files ?? [])].filter((file) => file.type.startsWith('image/'));
    void uploadFiles(files);
  }

  function canMove(photo: FeedbackItem, direction: 'up' | 'down'): boolean {
    if (photo.pinRank == null) return false;
    const index = pinnedItems.findIndex((item) => item.id === photo.id);
    if (index < 0) return false;
    return direction === 'up' ? index > 0 : index < pinnedItems.length - 1;
  }

  async function movePinned(photo: FeedbackItem, direction: 'up' | 'down') {
    if (movingId != null || !canMove(photo, direction)) return;
    movingId = photo.id;
    error = '';
    const body = new FormData();
    body.set('csrf', csrf);
    body.set('intent', 'reorder');
    body.set('id', String(photo.id));
    body.set('direction', direction);
    const response = await fetch(routes.adminFeedback, {
      method: 'POST',
      headers: { accept: 'application/json' },
      body,
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: string;
      updates?: Array<{ id: number; pinRank: number }>;
    };
    movingId = null;
    if (!response.ok || !payload.ok || !payload.updates) {
      error = payload.error ?? 'Không đổi được vị trí.';
      return;
    }
    const next = new Map(payload.updates.map((item) => [item.id, item.pinRank]));
    items = sortItems(items.map((item) => (next.has(item.id) ? { ...item, pinRank: next.get(item.id)! } : item)));
  }

  async function togglePin(photo: FeedbackItem) {
    if (pinningId != null) return;
    if (photo.pinRank == null && pinsFull) {
      error = `Đã ghim tối đa ${FEEDBACK_PIN_MAX} ảnh.`;
      return;
    }
    pinningId = photo.id;
    error = '';
    const body = new FormData();
    body.set('csrf', csrf);
    body.set('intent', photo.pinRank == null ? 'pin' : 'unpin');
    body.set('id', String(photo.id));
    const response = await fetch(routes.adminFeedback, {
      method: 'POST',
      headers: { accept: 'application/json' },
      body,
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: string;
      pinRank?: number | null;
      pinnedCount?: number;
    };
    pinningId = null;
    if (!response.ok || !payload.ok) {
      error = payload.error ?? 'Không đổi được trạng thái ghim.';
      return;
    }
    const nextRank = photo.pinRank == null ? (payload.pinRank ?? null) : null;
    items = sortItems(items.map((item) => (item.id === photo.id ? { ...item, pinRank: nextRank } : item)));
    pinnedCount = payload.pinnedCount ?? pinnedCount;
    flash(nextRank != null ? `Đã ghim ảnh (vị trí ${nextRank}).` : 'Đã bỏ ghim ảnh.');
  }

  async function confirmDelete() {
    const id = pendingDelete;
    if (id == null || deleting) return;
    deleting = true;
    error = '';
    const body = new FormData();
    body.set('csrf', csrf);
    body.set('intent', 'delete');
    body.set('id', String(id));
    const response = await fetch(routes.adminFeedback, {
      method: 'POST',
      headers: { accept: 'application/json' },
      body,
    });
    const payload = (await response.json()) as { ok?: boolean; error?: string };
    deleting = false;
    if (!response.ok || !payload.ok) {
      error = payload.error ?? 'Không xóa được ảnh.';
      cancelDelete();
      return;
    }
    const removed = items.find((item) => item.id === id);
    items = items.filter((item) => item.id !== id);
    total = Math.max(0, total - 1);
    if (removed?.pinRank != null) pinnedCount = Math.max(0, pinnedCount - 1);
    deleteDialog?.close();
    pendingDelete = null;
    flash('Đã xóa ảnh khỏi feedback.');
  }
</script>

<section class="feedback-admin">
  <header class="feedback-admin-head">
    <h1 class="feedback-admin-title">Feedback mua hàng</h1>
    <p class="feedback-admin-pin-meta">Ghim {pinnedCount}/{FEEDBACK_PIN_MAX} · ảnh ghim hiện đầu trang công khai</p>
  </header>

  {#if message}<p class="mb-4 text-primary-strong" role="status" data-admin-flash>{message}</p>{/if}
  {#if error}<p class="error-text mb-4" role="alert">{error}</p>{/if}

  <div
    class="media-drop feedback-admin-drop"
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
    onclick={() => fileInput?.click()}
    onkeydown={(event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      fileInput?.click();
    }}
  >
    <p>{progress || (busy ? 'Đang tải...' : 'Kéo ảnh vào đây, hoặc chọn tệp')}</p>
    <p class="media-meta">JPEG, PNG hoặc WebP · tối đa 2 MB/ảnh · có thể chọn nhiều (tối đa 20)</p>
  </div>
  <input class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple bind:this={fileInput} onchange={onPickFile} />

  {#if items.length === 0}
    <div class="feedback-admin-empty">
      <p class="font-semibold">Chưa có ảnh feedback</p>
      <p class="media-meta">Kéo ảnh dọc từ điện thoại khách vào ô phía trên để bắt đầu.</p>
    </div>
  {:else}
    <ul class="feedback-admin-grid">
      {#each items as photo (photo.id)}
        <li class="feedback-admin-card" class:is-pinned={photo.pinRank != null}>
          <div class="feedback-admin-thumb">
            <img src={photo.src} alt={photo.alt} width={photo.width} height={photo.height} loading="lazy" decoding="async" />
            {#if photo.pinRank != null}
              <span class="feedback-admin-badge">Ghim · {photo.pinRank}</span>
            {/if}
          </div>
          <div class="feedback-admin-card-bar" class:has-move={photo.pinRank != null}>
            {#if photo.pinRank != null}
              <button
                class="feedback-admin-icon-btn"
                type="button"
                aria-label="Đưa sang trước"
                disabled={movingId != null || !canMove(photo, 'up')}
                onclick={() => void movePinned(photo, 'up')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
            {:else}
              <span class="feedback-admin-icon-slot" aria-hidden="true"></span>
            {/if}
            <div class="feedback-admin-actions">
              <button
                class="btn btn-compact"
                type="button"
                disabled={pinningId === photo.id || (photo.pinRank == null && pinsFull)}
                title={photo.pinRank == null && pinsFull ? `Đã ghim tối đa ${FEEDBACK_PIN_MAX} ảnh` : undefined}
                onclick={() => void togglePin(photo)}
              >
                {pinningId === photo.id ? '…' : photo.pinRank != null ? 'Bỏ ghim' : 'Ghim'}
              </button>
              <button
                class="feedback-admin-icon-btn"
                type="button"
                aria-label="Xóa ảnh"
                title="Xóa"
                onclick={() => askDelete(photo.id)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="18" height="18" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                </svg>
              </button>
            </div>
            {#if photo.pinRank != null}
              <button
                class="feedback-admin-icon-btn"
                type="button"
                aria-label="Đưa sang sau"
                disabled={movingId != null || !canMove(photo, 'down')}
                onclick={() => void movePinned(photo, 'down')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            {:else}
              <span class="feedback-admin-icon-slot" aria-hidden="true"></span>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  <dialog
    class="confirm-dialog"
    bind:this={deleteDialog}
    aria-labelledby="feedback-delete-title"
    aria-describedby="feedback-delete-message"
    onclose={() => {
      if (!deleting) pendingDelete = null;
    }}
  >
    <h2 id="feedback-delete-title" class="text-lg font-semibold">Xóa ảnh feedback?</h2>
    <p id="feedback-delete-message" class="mt-2 text-sm text-muted">
      {#if pendingPhoto?.pinRank != null}
        Ảnh đang được ghim sẽ bị bỏ khỏi trang công khai. Không khôi phục được.
      {:else}
        Ảnh sẽ bị bỏ khỏi trang công khai. Không khôi phục được.
      {/if}
    </p>
    <div class="category-actions">
      <button class="btn" type="button" disabled={deleting} onclick={cancelDelete}>Hủy</button>
      <button class="btn btn-accent" type="button" disabled={deleting} onclick={() => void confirmDelete()}>
        {deleting ? 'Đang xóa…' : 'Xác nhận xóa'}
      </button>
    </div>
  </dialog>

  {#if pageCount > 1}
    <nav class="pager mt-4" aria-label="Phân trang feedback">
      {#if page > 1}
        <a class="pager-num" href={`${routes.adminFeedback}?page=${page - 1}`}>‹</a>
      {/if}
      <span class="pager-num is-active">{page} / {pageCount}</span>
      {#if page < pageCount}
        <a class="pager-num" href={`${routes.adminFeedback}?page=${page + 1}`}>›</a>
      {/if}
    </nav>
  {/if}
</section>
