<script lang="ts">
  import { untrack } from 'svelte';
  import { uploadMedia } from './upload-media';

  const ALBUM_MAX = 8;
  type Photo = { id: string; url: string };

  let {
    csrf,
    cover: initialCover,
    album: initialAlbum,
    error = '',
  }: { csrf: string; cover: Photo | null; album: Photo[]; error?: string } = $props();

  let cover = $state<Photo | null>(untrack(() => (initialCover ? { ...initialCover } : null)));
  let album = $state<Photo[]>(untrack(() => initialAlbum.map((photo) => ({ ...photo }))));
  let busy = $state(false);
  let note = $state('');

  const room = $derived((cover ? 0 : 1) + (ALBUM_MAX - album.length));

  function removeCover() {
    cover = album[0] ?? null;
    album = album.slice(1);
  }

  function removeAlbum(id: string) {
    album = album.filter((photo) => photo.id !== id);
  }

  function makeCover(photo: Photo) {
    if (!cover || cover.id === photo.id) return;
    const index = album.findIndex((item) => item.id === photo.id);
    if (index < 0) return;
    const next = album.slice();
    next[index] = cover;
    album = next;
    cover = photo;
  }

  async function onFiles(input: HTMLInputElement) {
    const files = [...(input.files ?? [])];
    input.value = '';
    if (files.length === 0 || busy) return;
    busy = true;
    note = '';
    let failed = '';
    for (let index = 0; index < files.length; index += 1) {
      if (roomTaken()) {
        note = 'Tối đa 1 ảnh đại diện và 8 ảnh thêm.';
        break;
      }
      const file = files[index];
      if (!file) continue;
      note = `Đang tải ${index + 1}/${files.length}`;
      try {
        const item = await uploadMedia(csrf, file);
        const photo = { id: String(item.id), url: item.url };
        if (!cover) cover = photo;
        else album = [...album, photo];
      } catch (reason) {
        failed = reason instanceof Error ? reason.message : 'Không lưu được ảnh.';
        break;
      }
    }
    busy = false;
    if (failed) note = failed;
    else if (!note.startsWith('Tối đa')) note = '';
  }

  function roomTaken(): boolean {
    return Boolean(cover) && album.length >= ALBUM_MAX;
  }
</script>

<div class="mt-4">
  <span class="mb-1 block font-semibold">Ảnh</span>
  <div class="product-photos">
    {#if cover}
      <figure class="product-photo is-cover">
        <img src={cover.url} alt="" width="72" height="72" />
        <button class="product-photo-remove" type="button" aria-label="Bỏ ảnh đại diện" onclick={removeCover}>×</button>
      </figure>
    {/if}
    {#each album as photo (photo.id)}
      <figure class="product-photo">
        <button type="button" class="product-photo-pick" aria-label="Đặt làm ảnh đại diện" onclick={() => makeCover(photo)}>
          <img src={photo.url} alt="" width="72" height="72" />
        </button>
        <button class="product-photo-remove" type="button" aria-label="Bỏ ảnh" onclick={() => removeAlbum(photo.id)}>×</button>
      </figure>
    {/each}
    {#if room > 0}
      <label class="product-photo-add">
        {busy ? '…' : 'Thêm'}
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onchange={(event) => onFiles(event.currentTarget)} />
      </label>
    {/if}
  </div>
  <p class="seo-hint">{cover ? 'Ảnh viền xanh là ảnh đại diện. Bấm ảnh khác để đổi.' : 'Ảnh tải lên đầu tiên là ảnh đại diện.'} Thêm tối đa 8 ảnh.</p>
  {#if note}<p class="seo-hint" role="status">{note}</p>{/if}
  {#if error}<p class="error-text">{error}</p>{/if}
  {#if cover}<input type="hidden" name="coverMediaId" value={cover.id} />{/if}
  {#each album as photo (photo.id)}
    <input type="hidden" name="album" value={photo.id} />
  {/each}
</div>
