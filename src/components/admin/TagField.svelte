<script lang="ts">
  import { untrack } from 'svelte';
  import { MAX_POST_TAGS } from '../../features/posts/tag-limits';
  import { routes } from '../../lib/routes';

  type TagOption = { id: number; name: string };

  let {
    csrf,
    options = [],
    selected = [],
  }: {
    csrf: string;
    options?: TagOption[];
    selected?: TagOption[];
  } = $props();

  let chosen = $state<TagOption[]>(untrack(() => selected.map((item) => ({ ...item })).slice(0, MAX_POST_TAGS)));
  let catalogue = $state<TagOption[]>(untrack(() => mergeOptions(options, selected)));
  let query = $state('');
  let open = $state(false);
  let busy = $state(false);
  let error = $state('');
  let rootEl = $state<HTMLDivElement | null>(null);

  const chosenIds = $derived(new Set(chosen.map((item) => item.id)));
  const atLimit = $derived(chosen.length >= MAX_POST_TAGS);
  const needle = $derived(query.trim().toLowerCase());
  const suggestions = $derived(
    catalogue
      .filter((item) => !chosenIds.has(item.id) && (!needle || item.name.toLowerCase().includes(needle)))
      .slice(0, 8),
  );
  const exactInCatalogue = $derived(
    needle ? catalogue.some((item) => item.name.toLowerCase() === needle) : false,
  );
  const canCreate = $derived(Boolean(needle) && needle.length <= 80 && !exactInCatalogue && !atLimit);

  function mergeOptions(base: TagOption[], extra: TagOption[]): TagOption[] {
    const map = new Map<number, TagOption>();
    for (const item of [...base, ...extra]) map.set(item.id, item);
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }

  function notifyForm() {
    rootEl?.closest('form')?.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function addTag(tag: TagOption) {
    if (chosenIds.has(tag.id)) return;
    if (chosen.length >= MAX_POST_TAGS) {
      error = `Mỗi bài tối đa ${MAX_POST_TAGS} thẻ.`;
      return;
    }
    chosen = [...chosen, tag];
    query = '';
    open = false;
    error = '';
    notifyForm();
  }

  function removeTag(id: number) {
    chosen = chosen.filter((item) => item.id !== id);
    error = '';
    notifyForm();
  }

  async function createTag() {
    const name = query.trim();
    if (!canCreate || busy || atLimit) return;
    busy = true;
    error = '';
    try {
      const body = new FormData();
      body.set('csrf', csrf);
      body.set('intent', 'save');
      body.set('name', name);
      body.set('slug', '');
      body.set('description', '');
      body.set('seoTitle', '');
      body.set('metaDescription', '');
      body.set('robots', 'noindex');
      const response = await fetch(routes.adminTags, {
        method: 'POST',
        body,
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; tag?: TagOption };
      if (!response.ok || !payload.ok || !payload.tag) {
        const existing = catalogue.find((item) => item.name.toLowerCase() === name.toLowerCase());
        if (existing) {
          addTag(existing);
          return;
        }
        error = payload.error || 'Không tạo được thẻ.';
        return;
      }
      catalogue = mergeOptions(catalogue, [payload.tag]);
      addTag(payload.tag);
    } catch {
      error = 'Không tạo được thẻ.';
    } finally {
      busy = false;
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      open = false;
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (suggestions[0]) addTag(suggestions[0]);
    else if (canCreate) void createTag();
  }
</script>

<div class="tag-field" bind:this={rootEl}>
  {#each chosen as tag (tag.id)}
    <input type="hidden" name="tagIds" value={tag.id} />
  {/each}

  {#if chosen.length > 0}
    <ul class="tag-chips" aria-label="Thẻ đã chọn">
      {#each chosen as tag (tag.id)}
        <li>
          <span>{tag.name}</span>
          <button type="button" aria-label={`Bỏ thẻ ${tag.name}`} onclick={() => removeTag(tag.id)}>×</button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if !atLimit}
    <div class="tag-combobox">
      <input
        class="field"
        type="search"
        placeholder={catalogue.length ? 'Tìm hoặc tạo thẻ…' : 'Nhập tên thẻ mới…'}
        autocomplete="off"
        maxlength="80"
        bind:value={query}
        onfocus={() => (open = true)}
        oninput={() => {
          open = true;
          error = '';
        }}
        onkeydown={onKeydown}
        aria-expanded={open}
        aria-controls="tag-suggestions"
        aria-autocomplete="list"
      />
      {#if open && (suggestions.length > 0 || canCreate)}
        <ul id="tag-suggestions" class="tag-suggestions" role="listbox">
          {#each suggestions as tag (tag.id)}
            <li>
              <button type="button" role="option" onclick={() => addTag(tag)}>{tag.name}</button>
            </li>
          {/each}
          {#if canCreate}
            <li>
              <button type="button" class="tag-create" disabled={busy} onclick={() => void createTag()}>
                {busy ? 'Đang tạo…' : `Tạo thẻ “${query.trim()}”`}
              </button>
            </li>
          {/if}
        </ul>
      {/if}
    </div>
  {/if}

  <p class="seo-hint mt-2">Nên dùng khoảng 2–5 thẻ (tối đa {MAX_POST_TAGS}). Không bắt buộc.</p>
  {#if error}<span class="error-text">{error}</span>{/if}
</div>

<svelte:window
  onclick={(event) => {
    if (!(event.target instanceof Node) || !rootEl?.contains(event.target)) open = false;
  }}
/>
