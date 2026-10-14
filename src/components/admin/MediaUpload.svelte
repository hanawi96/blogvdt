<script lang="ts">
  import { routes } from '../../lib/routes';

  let { csrf, onUploaded }: { csrf: string; onUploaded: (item: { id: number; url: string; alt: string }) => void } = $props();

  let message = $state('');
  let busy = $state(false);
  let alt = $state('');

  async function upload(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    message = '';
    busy = true;
    try {
      const image = await resizeImage(file);
      const body = new FormData();
      body.set('csrf', csrf);
      body.set('file', image, image.name);
      body.set('alt', alt);
      const response = await fetch(routes.adminMedia, {
        method: 'POST',
        headers: { accept: 'application/json' },
        body,
      });
      const payload = (await response.json()) as { id?: number; url?: string; alt?: string; error?: string };
      if (!response.ok || !payload.id || !payload.url) {
        message = payload.error ?? 'Không lưu được ảnh.';
        return;
      }
      alt = '';
      onUploaded({ id: payload.id, url: payload.url, alt: payload.alt ?? '' });
    } catch (error) {
      message = error instanceof Error ? error.message : 'Không xử lý được ảnh.';
    } finally {
      busy = false;
    }
  }

  async function resizeImage(file: File): Promise<File> {
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > 1600 ? 1600 / longest : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Trình duyệt không xử lý được ảnh.');
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
    const output = blob ?? (await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82)));
    if (!output) throw new Error('Không thu nhỏ được ảnh. Hãy chọn ảnh JPEG hoặc PNG nhỏ hơn.');
    const extension = output.type === 'image/webp' ? 'webp' : 'jpg';
    return new File([output], `anh.${extension}`, { type: output.type });
  }
</script>

<div class="mt-3">
  <label class="block">
    <span class="mb-1 block font-semibold">Mô tả ảnh</span>
    <input class="field" maxlength="200" bind:value={alt} />
  </label>
  <label class="btn mt-3">
    {busy ? 'Đang tải...' : 'Tải ảnh lên'}
    <input class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onchange={upload} />
  </label>
  {#if message}<p class="error-text mt-2">{message}</p>{/if}
</div>
