<script lang="ts">
  import { onMount } from 'svelte';
  import { checkPostSeo, slugCheckState, type SeoCheck, type SeoCheckState } from '../../features/posts/seo-check';
  import { routes } from '../../lib/routes';

  let { siteName, host, publishedAt = null }: { siteName: string; host: string; publishedAt?: number | null } = $props();

  let items = $state<SeoCheck[]>([]);
  let slugTaken = $state<boolean | null>(null);

  const labels: Record<SeoCheckState, string> = {
    pass: 'Đạt',
    improve: 'Cần cải thiện',
    error: 'Cần sửa',
    na: 'Không áp dụng',
  };

  function read(form: HTMLFormElement, name: string): string {
    const field = form.querySelector(`[name="${name}"]`);
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) return field.value;
    return '';
  }

  function paint(form: HTMLFormElement) {
    const coverAlt = form.querySelector('[data-cover-alt]');
    items = checkPostSeo({
      title: read(form, 'title'),
      slug: read(form, 'slug'),
      slugCheck: slugCheckState(read(form, 'slug'), slugTaken),
      seoTitle: read(form, 'seoTitle'),
      metaDescription: read(form, 'metaDescription'),
      excerpt: read(form, 'excerpt'),
      contentJson: read(form, 'contentJson'),
      hasCover: read(form, 'coverMediaId').trim().length > 0,
      coverAlt: coverAlt instanceof HTMLInputElement ? coverAlt.value : '',
      publishedAt,
      siteName,
      host,
    });
  }

  async function checkSlug(form: HTMLFormElement) {
    const slug = read(form, 'slug').trim();
    const state = slugCheckState(slug, null);
    if (state === 'empty' || state === 'invalid') {
      slugTaken = null;
      paint(form);
      return;
    }
    const excludeAtStart = form.dataset.postId ?? '';
    const url = new URL(routes.adminPosts, location.origin);
    url.searchParams.set('slug', slug);
    if (excludeAtStart) url.searchParams.set('exclude', excludeAtStart);
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } });
      if (!response.ok) return;
      const body = (await response.json()) as { taken?: unknown };
      if ((form.dataset.postId ?? '') !== excludeAtStart) {
        void checkSlug(form);
        return;
      }
      if (read(form, 'slug').trim() !== slug) return;
      slugTaken = body.taken === true;
      paint(form);
    } catch {
      slugTaken = null;
      paint(form);
    }
  }

  function focusTarget(target: string) {
    const form = document.querySelector('form[data-post-form]');
    const node = form?.querySelector(target);
    if (!(node instanceof HTMLElement)) return;
    node.scrollIntoView({ block: 'center' });
    node.focus();
  }

  onMount(() => {
    const form = document.querySelector('form[data-post-form]');
    if (!(form instanceof HTMLFormElement)) return;
    let timer = 0;
    let slugTimer = 0;
    const run = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => paint(form), 200);
      window.clearTimeout(slugTimer);
      slugTimer = window.setTimeout(() => void checkSlug(form), 500);
    };
    form.addEventListener('input', run);
    form.addEventListener('change', run);
    form.addEventListener('post-input', run);
    form.addEventListener('post-saved', run);
    paint(form);
    void checkSlug(form);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(slugTimer);
    };
  });
</script>

<section class="post-card seo-checks">
  <h2 class="post-card-title">Kiểm tra SEO</h2>
  <p class="seo-hint">Gợi ý khi đang viết. Không phải điểm xếp hạng, và không chặn lưu nháp.</p>
  <ul>
    {#each items as item (item.id)}
      <li>
        {#if item.target && (item.state === 'error' || item.state === 'improve')}
          <button type="button" onclick={() => focusTarget(item.target)}>
            <span class="seo-check-state" data-state={item.state}>{labels[item.state]}</span>
            <span>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </span>
          </button>
        {:else}
          <div>
            <span class="seo-check-state" data-state={item.state}>{labels[item.state]}</span>
            <span>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </span>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
</section>
