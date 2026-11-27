<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import MediaPicker from './MediaPicker.svelte';
  import SlugField from './SlugField.svelte';
  import type { MediaItem } from '../../features/media/types';

  type CategoryDraft = {
    id: number | null;
    name: string;
    slug: string;
    description: string;
    coverMediaId: string;
    weightScale: string;
    qtyMin: string;
    qtyMax: string;
  };
  type FieldErrors = { form?: string; name?: string; slug?: string; description?: string; cover?: string; qty?: string };

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
  <fieldset class="mt-4">
    <legend class="mb-1 font-semibold">Thang cân nặng khi đặt hàng</legend>
    <div class="mt-2 flex flex-col gap-2 text-sm">
      <label class="inline-flex items-center gap-2">
        <input type="radio" name="weightScale" value="baby" checked={current.weightScale === 'baby'} />
        Vòng bé (3–15kg + cân nặng khác)
      </label>
      <label class="inline-flex items-center gap-2">
        <input type="radio" name="weightScale" value="adult" checked={current.weightScale === 'adult'} />
        Vòng người lớn (40–80kg, mỗi mốc 5kg)
      </label>
      <label class="inline-flex items-center gap-2">
        <input type="radio" name="weightScale" value="none" checked={current.weightScale === 'none'} />
        Không cần chọn cân nặng
      </label>
    </div>
  </fieldset>
  <fieldset class="mt-4">
    <legend class="mb-1 font-semibold">Số lượng mua (min – max)</legend>
    <div class="mt-2 flex flex-wrap items-end gap-3">
      <label class="block text-sm">
        <span class="mb-1 block font-semibold">Tối thiểu</span>
        <input class="field w-24" name="qtyMin" type="number" inputmode="numeric" min="1" max="500" required value={current.qtyMin} />
      </label>
      <label class="block text-sm">
        <span class="mb-1 block font-semibold">Tối đa</span>
        <input class="field w-24" name="qtyMax" type="number" inputmode="numeric" min="1" max="500" required value={current.qtyMax} />
      </label>
    </div>
    <p class="seo-hint mt-1">Mặc định 1–20. Hạt bán theo số lượng lớn có thể đặt 10–500.</p>
    {#if shownErrors.qty}<span class="error-text">{shownErrors.qty}</span>{/if}
  </fieldset>
  <fieldset class="mt-4">
    <legend class="mb-1 font-semibold">Ảnh danh mục</legend>
    <MediaPicker {csrf} items={library} name="coverMediaId" selected={current.coverMediaId ? [current.coverMediaId] : []} />
    {#if shownErrors.cover}<span class="error-text">{shownErrors.cover}</span>{/if}
  </fieldset>
{/key}
<div class="category-actions">
  <button class="btn" type="button" data-category-close>Hủy</button>
  <button class="btn btn-primary" type="submit">
    {#if !current.id}
      <svg
        class="admin-plus-icon"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        stroke-width="1.5"
        stroke="currentColor"
        width="18"
        height="18"
        aria-hidden="true"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"></path>
      </svg>
    {/if}
    {current.id ? 'Cập nhật' : 'Thêm danh mục'}
  </button>
</div>
