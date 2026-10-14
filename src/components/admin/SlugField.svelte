<script lang="ts">
  import { untrack } from 'svelte';
  import { slugify } from '../../features/posts/slug';

  let {
    title = '',
    slug = '',
    titleError = '',
    slugError = '',
    label = 'Tiêu đề',
    field = 'title',
  }: {
    title?: string;
    slug?: string;
    titleError?: string;
    slugError?: string;
    label?: string;
    field?: string;
  } = $props();

  let titleValue = $state(untrack(() => title));
  let slugValue = $state(untrack(() => slug));
  let slugTouched = $state(untrack(() => slug.length > 0));

  function onTitle(event: Event) {
    titleValue = (event.currentTarget as HTMLInputElement).value;
    if (!slugTouched) slugValue = slugify(titleValue);
  }

  function onSlug(event: Event) {
    slugTouched = true;
    slugValue = (event.currentTarget as HTMLInputElement).value;
  }
</script>

<label class="block">
  <span class="mb-1 block font-semibold">{label}</span>
  <input class="field" name={field} required maxlength="180" value={titleValue} oninput={onTitle} />
  {#if titleError}<span class="error-text">{titleError}</span>{/if}
</label>
<label class="mt-4 block">
  <span class="mb-1 block font-semibold">Slug</span>
  <input class="field" name="slug" required maxlength="180" value={slugValue} oninput={onSlug} />
  {#if slugError}<span class="error-text">{slugError}</span>{/if}
</label>
