<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import MediaPicker from './MediaPicker.svelte';
  import SlugField from './SlugField.svelte';
  import type { MediaItem } from '../../features/media/types';
  import { WEIGHT_SCALE_LABELS } from '../../features/products/weight';

  type CategoryDraft = { id: number | null; name: string; slug: string; description: string; coverMediaId: string; weightScale: string };
  type FieldErrors = { form?: string; name?: string; slug?: string; description?: string; cover?: string };

  const weightScales = WEIGHT_SCALE_LABELS;

  let {
    csrf,
    items,
    initial,
    errors = {},
  }: { csrf: string; items: MediaItem[]; initial: CategoryDraft; errors?: FieldErrors } = $props();

  let current = $state(untrack(() => initial));
  let shownErrors = $state<FieldErrors>(untrack(() => errors));
  let library = $state(untrack(() => items));
  let version = $state(0);

  onMount(() => {
    // SlugField/MediaPicker giữ state nội bộ, nên đổi danh mục bằng cách dựng lại chúng qua {#key}.
    const load = (event: Event) => {
      current = (event as CustomEvent<CategoryDraft>).detail;
      shownErrors = {};
      version += 1;
    };
    // Giữ ảnh vừa tải/sửa alt để lần dựng lại sau vẫn thấy trong thư viện.
    const onAdd = (event: Event) => {
      const item = (event as CustomEvent<MediaItem>).detail;
      if (item && !library.some((entry) => entry.id === item.id)) library = [item, ...library];
    };
    const onAlt = (event: Event) => {
      const detail = (event as CustomEvent<{ id: number; alt: string }>).detail;
      if (detail) library = library.map((item) => (item.id === detail.id ? { ...item, alt: detail.alt } : item));
    };
    window.addEventListener('product-category-form', load);
    window.addEventListener('media-uploaded', onAdd);
    window.addEventListener('media-alt', onAlt);
    return () => {
      window.removeEventListener('product-category-form', load);
      window.removeEventListener('media-uploaded', onAdd);
      window.removeEventListener('media-alt', onAlt);
    };
  });
</script>

<h2 id="category-dialog-title" class="text-lg font-semibold">{current.id ? 'Sửa danh mục' : 'Thêm danh mục'}</h2>
{#if shownErrors.form}<p class="error-text mt-2" role="alert">{shownErrors.form}</p>{/if}
{#key version}
  {#if current.id}<input type="hidden" name="id" value={current.id} />{/if}
  <div class="mt-4">
    <SlugField
      label="Tên"
      field="name"
      title={current.name}
      slug={current.slug}
      titleError={shownErrors.name}
      slugError={shownErrors.slug}
      nameMax={120}
      slugPattern={'[a-z0-9]+(?:-[a-z0-9]+)*'}
    />
  </div>
  <p class="seo-hint">Slug tự tạo từ tên khi thêm mới. Sửa tên danh mục cũ không đổi slug.</p>
  <label class="mt-4 block">
    <span class="mb-1 block font-semibold">Mô tả ngắn</span>
    <textarea class="field min-h-24" name="description" maxlength="300" value={current.description}></textarea>
    {#if shownErrors.description}<span class="error-text">{shownErrors.description}</span>{/if}
  </label>
  <label class="mt-4 block">
    <span class="mb-1 block font-semibold">Chọn cân nặng khi mua</span>
    <select class="field" name="weightScale" value={current.weightScale}>
      {#each weightScales as scale (scale.value)}
        <option value={scale.value}>{scale.label}</option>
      {/each}
    </select>
    <span class="seo-hint">Thang “Bé” buộc khách chọn cân nặng khi thêm vào giỏ. Chọn “Không cần” cho danh mục không áp dụng.</span>
  </label>
  <fieldset class="mt-4">
    <legend class="mb-1 font-semibold">Ảnh danh mục</legend>
    <MediaPicker {csrf} items={library} name="coverMediaId" selected={current.coverMediaId ? [current.coverMediaId] : []} />
    {#if shownErrors.cover}<span class="error-text">{shownErrors.cover}</span>{/if}
  </fieldset>
{/key}
<div class="category-actions">
  <button class="btn" type="button" data-category-close>Hủy</button>
  <button class="btn btn-primary" type="submit">{current.id ? 'Cập nhật' : 'Thêm danh mục'}</button>
</div>
