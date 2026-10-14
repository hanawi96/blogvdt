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
  } = $props();

  let library = $state<MediaItem[]>(untrack(() => items.map((item) => ({ ...item }))));
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
    const needle = query.trim().toLowerCase();
    if (!needle) return library;
    return library.filter((item) => `${item.filename} ${item.alt}`.toLowerCase().includes(needle));
  });
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
    return uses[String(item.id)] ?? [];
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
    message = '';
    busy = true;
    try {
      const item = await uploadMedia(csrf, file);
      previewId = item.id;
      const id = String(item.id);
      if (manage) return;
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
    } catch (error) {
      message = error instanceof Error ? error.message : 'Không lưu được ảnh.';
    } finally {
      busy = false;
    }
  }

  function onPickFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void send(file);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    hot = false;
    const file = event.dataTransfer?.files[0];
    if (file) void send(file);
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
      message = payload.error ?? 'Không lưu được mô tả ảnh.';
      return;
    }
    library = library.map((entry) => (entry.id === item.id ? { ...entry, alt: next } : entry));
    window.dispatchEvent(new CustomEvent('media-alt', { detail: { id: item.id, alt: next } }));
  }

  async function removeItem(item: MediaItem) {
    if (usesOf(item).length > 0) return;
    if (!confirm('Xóa ảnh này?')) return;
    const body = new FormData();
    body.set('csrf', csrf);
    const response = await fetch(routes.adminMediaDelete(item.id), {
      method: 'POST',
      headers: { accept: 'application/json' },
      body,
    });
    const payload = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      message = payload.error ?? 'Không xóa được ảnh.';
      return;
    }
    library = library.filter((entry) => entry.id !== item.id);
    if (previewId === item.id) previewId = null;
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
</script>

{#if manage}
  <div class="media-page">
    {@render toolbar()}
    {#if message}<p class="error-text" role="alert">{message}</p>{/if}
    <div class="media-layout">
      {@render grid(true)}
      {@render previewPane()}
    </div>
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
    <p>{busy ? 'Đang tải...' : after ? 'Kéo ảnh vào đây, hoặc mở thư viện' : 'Kéo ảnh vào đây, hoặc chọn tệp'}</p>
    <p class="media-meta">JPEG, PNG hoặc WebP, tối đa 2 MB</p>
  </div>
  <input class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" bind:this={fileInput} onchange={onPickFile} />
{/snippet}

{#snippet previewPane()}
  <aside class="media-preview">
    {#if preview}
      <img src={preview.url} alt={preview.alt || preview.filename} />
      <p class="font-semibold">{preview.filename}</p>
      <p class="media-meta">{meta(preview)}</p>
      <button class="btn" type="button" onclick={() => preview && void copyPath(preview.url)}>{copied === preview.url ? 'Đã copy' : 'Copy đường dẫn'}</button>
      {#if manage}
        <label class="mt-3 block">
          <span class="mb-1 block font-semibold">Mô tả ảnh</span>
          <input class="field" maxlength="200" value={preview.alt} onchange={(event) => { const input = event.currentTarget as HTMLInputElement; if (preview) void saveTileAlt(preview, input.value); }} />
        </label>
        {#if usesOf(preview).length > 0}
          <p class="mt-3 font-semibold">Đang dùng ở</p>
          <ul class="media-uses">
            {#each usesOf(preview) as place (place.href + place.label)}
              <li><a href={place.href}>{place.label}</a></li>
            {/each}
          </ul>
        {:else}
          <button class="btn btn-accent mt-3" type="button" onclick={() => preview && void removeItem(preview)}>Xóa</button>
        {/if}
      {/if}
    {:else}
      <p class="media-meta">Chọn một ảnh để xem trước.</p>
    {/if}
  </aside>
{/snippet}

{#snippet grid(showUses: boolean)}
  {#if visible.length === 0}
    <p class="media-meta">{library.length === 0 ? 'Chưa có ảnh.' : 'Không thấy ảnh phù hợp.'}</p>
  {:else}
    <ul class="media-grid">
      {#each visible as item (item.id)}
        <li>
          <button class="media-tile" type="button" aria-pressed={marked(item.id) || previewId === item.id} onclick={() => chooseTile(item)}>
            <img src={item.url} alt={item.alt || item.filename} width={item.width ?? undefined} height={item.height ?? undefined} loading="lazy" />
            <span>{item.filename}</span>
          </button>
          {#if showUses && usesOf(item).length > 0}
            <p class="media-meta">Đang dùng · {usesOf(item).length}</p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}
