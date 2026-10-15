<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { slugify } from '../../features/posts/slug';

  let {
    title = '',
    slug = '',
    titleError = '',
    slugError = '',
    label = 'Tiêu đề',
    field = 'title',
    titleInput = '',
    nameMax = 180,
    slugPattern = '',
  }: {
    title?: string;
    slug?: string;
    titleError?: string;
    slugError?: string;
    label?: string;
    field?: string;
    titleInput?: string;
    nameMax?: number;
    slugPattern?: string;
  } = $props();

  let titleValue = $state(untrack(() => title));
  let slugValue = $state(untrack(() => slug));
  let slugTouched = $state(untrack(() => slug.length > 0));
  let slugInput = $state<HTMLInputElement | null>(null);

  function onTitle(event: Event) {
    titleValue = (event.currentTarget as HTMLInputElement).value;
    if (!slugTouched) slugValue = slugify(titleValue);
  }

  function onSlug(event: Event) {
    slugTouched = true;
    slugValue = (event.currentTarget as HTMLInputElement).value;
  }

  onMount(() => {
    if (!titleInput) return;
    const input = document.getElementById(titleInput);
    if (!(input instanceof HTMLInputElement)) return;
    const sync = () => {
      if (slugTouched) return;
      slugValue = slugify(input.value);
      void tick().then(() => slugInput?.dispatchEvent(new Event('input', { bubbles: true })));
    };
    input.addEventListener('input', sync);
    return () => input.removeEventListener('input', sync);
  });
</script>

{#if !titleInput}
  <label class="block">
    <span class="mb-1 block font-semibold">{label}</span>
    <input class="field" name={field} required maxlength={nameMax} value={titleValue} oninput={onTitle} />
    {#if titleError}<span class="error-text">{titleError}</span>{/if}
  </label>
{/if}
<label class={titleInput ? 'block' : 'mt-4 block'}>
  <span class="mb-1 block font-semibold">Slug</span>
    <input
      class="field"
      name="slug"
      required
      maxlength="180"
      pattern={slugPattern || undefined}
      title={slugPattern ? 'Slug chỉ gồm chữ thường, số và dấu gạch.' : undefined}
      value={slugValue}
      oninput={onSlug}
      bind:this={slugInput}
    />
  {#if slugError}<span class="error-text">{slugError}</span>{/if}
</label>
