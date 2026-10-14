<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { routes } from '../../lib/routes';
  import { resizeImage } from './resize-image';

  let {
    csrf,
    coverId = '',
    coverUrl = '',
    coverAlt = '',
  }: { csrf: string; coverId?: string; coverUrl?: string; coverAlt?: string } = $props();

  let pickedId = $state(untrack(() => coverId));
  let pickedUrl = $state(untrack(() => coverUrl));
  let alt = $state(untrack(() => coverAlt));
  let message = $state('');
  let busy = $state(false);
  let hot = $state(false);
  let fileInput = $state<HTMLInputElement | null>(null);
  let idInput = $state<HTMLInputElement | null>(null);
  let altTimer = 0;

  function openPicker() {
    if (!busy) fileInput?.click();
  }

  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openPicker();
  }

  function onDragOver(event: DragEvent) {
    event.preventDefault();
    hot = true;
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    hot = false;
    const file = event.dataTransfer?.files[0];
    if (file) void send(file);
  }

  function onPick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void send(file);
  }

  async function send(file: File) {
    message = '';
    busy = true;
    try {
      const image = await resizeImage(file);
      const body = new FormData();
      body.set('csrf', csrf);
      body.set('file', image, image.name);
      body.set('alt', '');
      const response = await fetch(routes.adminMedia, {
        method: 'POST',
        headers: { accept: 'application/json' },
        body,
      });
      const payload = (await response.json()) as { id?: number; url?: string; error?: string };
      if (!response.ok || !payload.id || !payload.url) {
        message = payload.error ?? 'Không lưu được ảnh.';
        return;
      }
      pickedId = String(payload.id);
      pickedUrl = payload.url;
      alt = '';
      await tick();
      idInput?.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (error) {
      message = error instanceof Error ? error.message : 'Không xử lý được ảnh.';
    } finally {
      busy = false;
    }
  }

  function clearCover() {
    pickedId = '';
    pickedUrl = '';
    alt = '';
    message = '';
    void tick().then(() => idInput?.dispatchEvent(new Event('change', { bubbles: true })));
  }

  function scheduleAlt() {
    window.clearTimeout(altTimer);
    altTimer = window.setTimeout(() => void saveAlt(), 500);
  }

  async function saveAlt() {
    window.clearTimeout(altTimer);
    if (!pickedId) return;
    const body = new FormData();
    body.set('csrf', csrf);
    body.set('intent', 'alt');
    body.set('id', pickedId);
    body.set('alt', alt);
    const response = await fetch(routes.adminMedia, {
      method: 'POST',
      headers: { accept: 'application/json' },
      body,
    });
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      message = payload.error ?? 'Không lưu được mô tả ảnh.';
    }
  }
</script>

<input type="hidden" name="coverMediaId" value={pickedId} bind:this={idInput} />
<input class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" bind:this={fileInput} onchange={onPick} />

{#if pickedUrl}
  <div class="cover-picked">
    <img src={pickedUrl} alt={alt || 'Ảnh đại diện'} />
    <div class="cover-picked-actions">
      <button type="button" onclick={openPicker}>Đổi ảnh</button>
      <button type="button" onclick={clearCover}>Bỏ ảnh</button>
    </div>
  </div>
  <label class="mt-3 block">
    <span class="mb-1 block font-semibold">Mô tả ảnh</span>
    <input class="field" maxlength="200" bind:value={alt} oninput={scheduleAlt} onblur={saveAlt} />
  </label>
{:else}
  <div
    class="cover-drop"
    class:cover-drop-hot={hot}
    role="button"
    tabindex="0"
    aria-disabled={busy}
    ondragover={onDragOver}
    ondragleave={() => (hot = false)}
    ondrop={onDrop}
    onclick={openPicker}
    onkeydown={onKey}
  >
    <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
      <rect x="8" y="10" width="32" height="28" rx="4" fill="none" stroke="currentColor" stroke-width="2" />
      <circle cx="18" cy="20" r="3" fill="currentColor" />
      <path d="m14 32 7-7 5 5 3-3 5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
    </svg>
    <p>
      {#if busy}
        Đang tải...
      {:else}
        Kéo ảnh vào đây, hoặc <span class="cover-drop-link">chọn tệp</span>
      {/if}
    </p>
    <p class="cover-drop-hint">JPEG, PNG hoặc WebP</p>
  </div>
{/if}
{#if message}<p class="error-text mt-2">{message}</p>{/if}
