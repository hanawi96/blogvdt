<script lang="ts">
  import { replyMentionPrefix } from '../../features/product-comments/parse';
  import type { AdminComment } from '../../features/product-comments/comments';
  import { routes } from '../../lib/routes';

  let {
    csrf,
    comments: initialComments,
    page,
    pageCount,
    status,
  }: {
    csrf: string;
    comments: AdminComment[];
    page: number;
    pageCount: number;
    status: string;
  } = $props();

  let comments = $state([...initialComments]);
  let flashMsg = $state('');
  let busyId = $state<number | null>(null);
  let replyFor = $state<AdminComment | null>(null);
  let replyBody = $state('');
  let replyError = $state('');
  let replyBusy = $state(false);

  function formatTime(ts: number): string {
    try {
      return new Intl.DateTimeFormat('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(ts));
    } catch {
      return '';
    }
  }

  function statusLabel(value: string): string {
    if (value === 'pending') return 'Chờ duyệt';
    if (value === 'approved') return 'Đã duyệt';
    if (value === 'hidden') return 'Đã ẩn';
    return value;
  }

  function tabHref(next: string): string {
    return next === 'pending' ? routes.adminProductComments : `${routes.adminProductComments}?status=${next}`;
  }

  function pageHref(nextPage: number): string {
    const params = new URLSearchParams();
    if (status !== 'pending') params.set('status', status);
    if (nextPage > 1) params.set('page', String(nextPage));
    const q = params.toString();
    return q ? `${routes.adminProductComments}?${q}` : routes.adminProductComments;
  }

  function flash(message: string) {
    flashMsg = message;
    window.setTimeout(() => {
      if (flashMsg === message) flashMsg = '';
    }, 2800);
  }

  async function postIntent(intent: string, fields: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
    const body = new FormData();
    body.set('csrf', csrf);
    body.set('intent', intent);
    for (const [key, value] of Object.entries(fields)) body.set(key, value);
    const response = await fetch(routes.adminProductComments, {
      method: 'POST',
      body,
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !payload?.ok) return { ok: false, error: payload?.error ?? 'Thao tác thất bại.' };
    return { ok: true };
  }

  async function approve(item: AdminComment) {
    if (busyId != null) return;
    busyId = item.id;
    const result = await postIntent('approve', { id: String(item.id) });
    busyId = null;
    if (!result.ok) {
      flash(result.error ?? 'Không duyệt được.');
      return;
    }
    comments = comments.map((row) => (row.id === item.id ? { ...row, status: 'approved' } : row));
    if (status === 'pending') comments = comments.filter((row) => row.id !== item.id);
    flash('Đã duyệt bình luận.');
  }

  async function hide(item: AdminComment) {
    if (busyId != null) return;
    busyId = item.id;
    const result = await postIntent('hide', { id: String(item.id) });
    busyId = null;
    if (!result.ok) {
      flash(result.error ?? 'Không ẩn được.');
      return;
    }
    comments = comments.map((row) => (row.id === item.id ? { ...row, status: 'hidden' } : row));
    if (status === 'approved' || status === 'pending') comments = comments.filter((row) => row.id !== item.id);
    flash('Đã ẩn bình luận.');
  }

  async function remove(item: AdminComment) {
    if (busyId != null) return;
    if (!window.confirm('Xóa bình luận này? Thao tác không hoàn tác.')) return;
    busyId = item.id;
    const result = await postIntent('delete', { id: String(item.id) });
    busyId = null;
    if (!result.ok) {
      flash(result.error ?? 'Không xóa được.');
      return;
    }
    comments = comments.filter((row) => row.id !== item.id);
    flash('Đã xóa bình luận.');
  }

  function openReply(item: AdminComment) {
    if (item.parentId != null || item.status !== 'approved') return;
    replyFor = item;
    replyBody = replyMentionPrefix(item.authorName);
    replyError = '';
  }

  function closeReply() {
    replyFor = null;
    replyBody = '';
    replyError = '';
  }

  async function submitReply(event: Event) {
    event.preventDefault();
    if (!replyFor || replyBusy) return;
    replyBusy = true;
    replyError = '';
    const result = await postIntent('reply', {
      parentId: String(replyFor.id),
      body: replyBody,
    });
    replyBusy = false;
    if (!result.ok) {
      replyError = result.error ?? 'Không gửi được trả lời.';
      return;
    }
    closeReply();
    flash('Đã trả lời với nhãn Shop (hiện ngay).');
  }
</script>

<section class="pcm">
  {#if flashMsg}
    <p class="pcm-flash" role="status">{flashMsg}</p>
  {/if}

  <nav class="pcm-tabs" aria-label="Lọc trạng thái">
    {#each [
      ['pending', 'Chờ duyệt'],
      ['approved', 'Đã duyệt'],
      ['hidden', 'Đã ẩn'],
      ['all', 'Tất cả'],
    ] as [value, label]}
      <a class="pcm-tab" class:is-active={status === value} href={tabHref(value)}>{label}</a>
    {/each}
  </nav>

  {#if comments.length === 0}
    <div class="pcm-empty">
      <p class="font-semibold">Chưa có bình luận</p>
      <p class="text-muted">Bình luận từ trang sản phẩm sẽ hiện ở đây để duyệt.</p>
    </div>
  {:else}
    <ul class="pcm-list">
      {#each comments as item (item.id)}
        <li class="pcm-card" class:is-pending={item.status === 'pending'}>
          <div class="pcm-card-top">
            <div class="pcm-who">
              <strong>{item.authorName}</strong>
              {#if item.authorKind === 'shop'}
                <span class="pcm-badge">Chủ shop</span>
              {/if}
              <span class="pcm-status" data-status={item.status}>{statusLabel(item.status)}</span>
            </div>
            <time class="pcm-time">{formatTime(item.createdAt)}</time>
          </div>
          <p class="pcm-product">
            <a href={routes.product(item.productSlug)} target="_blank" rel="noopener noreferrer">{item.productName}</a>
            {#if item.parentId != null}
              <span class="pcm-reply-tag">Trả lời #{item.parentId}</span>
            {/if}
          </p>
          <p class="pcm-body">{item.body}</p>
          {#if item.imageUrl}
            <a class="pcm-photo" href={item.imageUrl} target="_blank" rel="noopener noreferrer">
              <img src={item.imageUrl} alt="" loading="lazy" />
            </a>
          {/if}
          <div class="pcm-actions">
            {#if item.status !== 'approved'}
              <button class="btn btn-primary btn-compact" type="button" disabled={busyId === item.id} onclick={() => approve(item)}>
                Duyệt
              </button>
            {/if}
            {#if item.status !== 'hidden'}
              <button class="btn btn-compact" type="button" disabled={busyId === item.id} onclick={() => hide(item)}>Ẩn</button>
            {/if}
            {#if item.parentId == null && item.status === 'approved'}
              <button class="btn btn-compact" type="button" onclick={() => openReply(item)}>Trả lời Shop</button>
            {/if}
            <button class="btn btn-compact pcm-danger" type="button" disabled={busyId === item.id} onclick={() => remove(item)}>
              Xóa
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  {#if pageCount > 1}
    <nav class="post-pager" aria-label="Phân trang">
      {#if page > 1}
        <a href={pageHref(page - 1)}>Trước</a>
      {/if}
      <span>Trang {page}/{pageCount}</span>
      {#if page < pageCount}
        <a href={pageHref(page + 1)}>Sau</a>
      {/if}
    </nav>
  {/if}
</section>

{#if replyFor}
  <div class="pcm-modal" role="dialog" aria-modal="true" aria-labelledby="pcm-reply-title">
    <form class="pcm-modal-card" onsubmit={submitReply}>
      <div class="pcm-modal-head">
        <h2 id="pcm-reply-title">Trả lời với nhãn Shop</h2>
        <button type="button" class="pcm-modal-close" onclick={closeReply} aria-label="Đóng">×</button>
      </div>
      <p class="pcm-modal-meta">Trả lời <strong>{replyFor.authorName}</strong> · {replyFor.productName}</p>
      <textarea class="field" rows="4" maxlength="1000" required bind:value={replyBody}></textarea>
      {#if replyError}
        <p class="error-text" role="alert">{replyError}</p>
      {/if}
      <div class="pcm-modal-actions">
        <button class="btn" type="button" onclick={closeReply}>Hủy</button>
        <button class="btn btn-primary" type="submit" disabled={replyBusy}>
          {replyBusy ? 'Đang gửi…' : 'Gửi (hiện ngay)'}
        </button>
      </div>
    </form>
  </div>
{/if}

<style>
  .pcm-flash {
    margin-bottom: 0.75rem;
    padding: 0.45rem 0.75rem;
    border-radius: var(--radius-md);
    background: color-mix(in oklab, var(--color-primary) 14%, var(--color-surface));
    color: var(--color-primary-strong);
    font-weight: 600;
    font-size: 0.875rem;
  }
  .pcm-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-bottom: 1rem;
  }
  .pcm-tab {
    display: inline-flex;
    align-items: center;
    min-height: 2.1rem;
    padding: 0.25rem 0.75rem;
    border-radius: 999px;
    border: 1px solid var(--color-line);
    background: var(--color-surface);
    color: var(--color-ink);
    text-decoration: none;
    font-size: 0.875rem;
    font-weight: 600;
  }
  .pcm-tab.is-active {
    border-color: var(--color-primary-strong);
    background: color-mix(in oklab, var(--color-primary) 16%, var(--color-surface));
    color: var(--color-primary-strong);
  }
  .pcm-empty {
    padding: 1.5rem;
    border: 1px dashed var(--color-line);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }
  .pcm-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.75rem;
  }
  .pcm-card {
    border: 1px solid var(--color-line);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    padding: 0.9rem 1rem;
  }
  .pcm-card.is-pending {
    border-color: color-mix(in oklab, var(--color-accent) 45%, var(--color-line));
    background: color-mix(in oklab, var(--color-sand) 50%, var(--color-surface));
  }
  .pcm-card-top {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.75rem;
    justify-content: space-between;
    align-items: center;
  }
  .pcm-who {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
  }
  .pcm-badge {
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--color-primary-strong);
    background: color-mix(in oklab, var(--color-primary) 16%, var(--color-surface));
    border-radius: 999px;
    padding: 0.1rem 0.4rem;
  }
  .pcm-status {
    font-size: 0.75rem;
    font-weight: 700;
    border-radius: 999px;
    padding: 0.1rem 0.45rem;
    background: var(--color-sand);
    color: var(--color-muted);
  }
  .pcm-status[data-status='pending'] {
    background: color-mix(in oklab, var(--color-accent) 18%, var(--color-surface));
    color: var(--color-accent-strong);
  }
  .pcm-status[data-status='approved'] {
    background: color-mix(in oklab, var(--color-primary) 16%, var(--color-surface));
    color: var(--color-primary-strong);
  }
  .pcm-time {
    font-size: 0.8125rem;
    color: var(--color-muted);
  }
  .pcm-product {
    margin-top: 0.35rem;
    font-size: 0.875rem;
  }
  .pcm-reply-tag {
    margin-left: 0.5rem;
    color: var(--color-muted);
  }
  .pcm-body {
    margin-top: 0.55rem;
    white-space: pre-wrap;
    line-height: 1.5;
  }
  .pcm-photo {
    display: inline-block;
    margin-top: 0.65rem;
    max-width: 8rem;
  }
  .pcm-photo img {
    display: block;
    width: 100%;
    height: auto;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-line);
  }
  .pcm-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.75rem;
  }
  .pcm-danger {
    color: var(--color-danger);
  }
  .pcm-modal {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: color-mix(in oklab, var(--color-ink) 35%, transparent);
  }
  .pcm-modal-card {
    width: min(32rem, 100%);
    background: var(--color-surface);
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-line);
    padding: 1rem;
    display: grid;
    gap: 0.65rem;
  }
  .pcm-modal-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
  }
  .pcm-modal-head h2 {
    font-size: 1.05rem;
    font-weight: 700;
  }
  .pcm-modal-close {
    width: 2rem;
    height: 2rem;
    border-radius: 999px;
    border: 1px solid var(--color-line);
    background: var(--color-surface);
    cursor: pointer;
  }
  .pcm-modal-meta {
    font-size: 0.875rem;
    color: var(--color-muted);
  }
  .pcm-modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>
