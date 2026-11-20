<script lang="ts">
  import { replyMentionPrefix } from '../../features/product-comments/parse';
  import { routes } from '../../lib/routes';
  import type { PublicComment, PublicCommentThread } from '../../features/product-comments/comments';

  type ViewComment = PublicComment & { pending?: boolean };
  type ViewThread = ViewComment & { replies: ViewComment[] };

  let {
    productId,
    threads: initialThreads,
  }: {
    productId: number;
    threads: PublicCommentThread[];
  } = $props();

  let threads = $state<ViewThread[]>(initialThreads.map((thread) => ({ ...thread, replies: [...thread.replies] })));
  let authorName = $state('');
  let body = $state('');
  let parentId = $state<number | null>(null);
  let replyToName = $state<string | null>(null);
  let imageFile = $state<File | null>(null);
  let imagePreview = $state<string | null>(null);
  let submitting = $state(false);
  let error = $state('');
  let success = $state('');
  let formEl = $state<HTMLElement | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLElement | null>(null);

  const totalCount = $derived(
    threads.reduce((sum, thread) => sum + 1 + thread.replies.length, 0),
  );

  function formatTime(ts: number): string {
    try {
      return new Intl.DateTimeFormat('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(new Date(ts));
    } catch {
      return '';
    }
  }

  function clearImage(revoke = true) {
    if (revoke && imagePreview) URL.revokeObjectURL(imagePreview);
    imagePreview = null;
    imageFile = null;
    if (fileInput) fileInput.value = '';
  }

  function onPickImage(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    if (!file) {
      imageFile = null;
      imagePreview = null;
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      error = 'Ảnh lớn hơn 2 MB.';
      input.value = '';
      return;
    }
    imageFile = file;
    imagePreview = URL.createObjectURL(file);
    error = '';
  }

  function startReply(thread: ViewThread) {
    if (thread.pending) return;
    parentId = thread.id;
    replyToName = thread.authorName;
    const mention = replyMentionPrefix(thread.authorName);
    if (!body.trim() || body.trimStart().startsWith('@')) {
      body = mention;
    } else if (!body.includes(mention.trim())) {
      body = `${mention}${body}`;
    }
    success = '';
    error = '';
    queueMicrotask(() => {
      formEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      const area = formEl?.querySelector('textarea');
      if (area instanceof HTMLTextAreaElement) {
        area.focus();
        area.setSelectionRange(body.length, body.length);
      }
    });
  }

  function cancelReply() {
    parentId = null;
    replyToName = null;
    if (body.trimStart().startsWith('@')) {
      body = body.replace(/^@\S+\s*/, '');
    }
  }

  function insertPending(comment: ViewComment, replyParentId: number | null) {
    if (replyParentId == null) {
      threads = [{ ...comment, replies: [] }, ...threads];
      return;
    }
    threads = threads.map((thread) =>
      thread.id === replyParentId ? { ...thread, replies: [...thread.replies, comment] } : thread,
    );
  }

  async function onSubmit(event: Event) {
    event.preventDefault();
    if (submitting) return;
    submitting = true;
    error = '';
    success = '';

    const submittedName = authorName.trim();
    const submittedBody = body.trim();
    const submittedParentId = parentId;
    const localImageUrl = imagePreview;
    const form = new FormData();
    form.set('productId', String(productId));
    form.set('authorName', authorName);
    form.set('body', body);
    if (parentId != null) form.set('parentId', String(parentId));
    if (imageFile) form.set('image', imageFile);

    try {
      const response = await fetch(routes.productCommentsApi, {
        method: 'POST',
        body: form,
        credentials: 'same-origin',
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; id?: number; error?: string } | null;
      if (!response.ok || !payload?.ok || !payload.id) {
        error = payload?.error ?? 'Không gửi được bình luận.';
        return;
      }

      insertPending(
        {
          id: payload.id,
          authorName: submittedName,
          authorKind: 'guest',
          body: submittedBody,
          imageUrl: localImageUrl,
          imageWidth: null,
          imageHeight: null,
          createdAt: Date.now(),
          pending: true,
        },
        submittedParentId,
      );

      // Giữ object URL cho ảnh pending; không revoke.
      imagePreview = null;
      imageFile = null;
      if (fileInput) fileInput.value = '';
      body = '';
      cancelReply();
      success = 'Đã gửi — đang chờ shop duyệt.';
      queueMicrotask(() => {
        listEl?.querySelector(`[data-comment-id="${payload.id}"]`)?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      });
    } catch {
      error = 'Không gửi được bình luận. Kiểm tra kết nối và thử lại.';
    } finally {
      submitting = false;
    }
  }
</script>

<section id="binh-luan" class="pc" aria-labelledby="pc-title">
  <header class="pc-head">
    <h2 id="pc-title" class="pc-title">Bình luận</h2>
    <p class="pc-lead">
      {totalCount > 0 ? `${totalCount} bình luận` : 'Chưa có bình luận — hãy là người đầu tiên.'}
    </p>
  </header>

  {#if threads.length > 0}
    <ul class="pc-list" bind:this={listEl}>
      {#each threads as thread (thread.id)}
        <li class="pc-item">
          <article
            class="pc-card"
            class:is-pending={thread.pending}
            data-comment-id={thread.id}
            aria-busy={thread.pending ? 'true' : undefined}
          >
            <div class="pc-meta">
              <span class="pc-author" class:is-shop={thread.authorKind === 'shop'}>{thread.authorName}</span>
              {#if thread.authorKind === 'shop'}
                <span class="pc-badge is-owner">Chủ shop</span>
              {/if}
              {#if thread.pending}
                <span class="pc-badge is-pending">Đang chờ duyệt</span>
              {/if}
              <time class="pc-time" datetime={new Date(thread.createdAt).toISOString()}>{formatTime(thread.createdAt)}</time>
            </div>
            <div class="pc-content">
              <p class="pc-body">{thread.body}</p>
              {#if thread.imageUrl}
                <div class="pc-photo">
                  <img
                    src={thread.imageUrl}
                    alt={`Ảnh từ ${thread.authorName}`}
                    width={thread.imageWidth ?? undefined}
                    height={thread.imageHeight ?? undefined}
                    loading="lazy"
                  />
                </div>
              {/if}
            </div>
            {#if !thread.pending}
              <button class="pc-reply-btn" type="button" onclick={() => startReply(thread)}>Trả lời</button>
            {/if}
          </article>

          {#if thread.replies.length > 0}
            <ul class="pc-replies">
              {#each thread.replies as reply (reply.id)}
                <li>
                  <article
                    class="pc-card is-reply"
                    class:is-pending={reply.pending}
                    data-comment-id={reply.id}
                    aria-busy={reply.pending ? 'true' : undefined}
                  >
                    <div class="pc-meta">
                      <span class="pc-author" class:is-shop={reply.authorKind === 'shop'}>{reply.authorName}</span>
                      {#if reply.authorKind === 'shop'}
                        <span class="pc-badge is-owner">Chủ shop</span>
                      {/if}
                      {#if reply.pending}
                        <span class="pc-badge is-pending">Đang chờ duyệt</span>
                      {/if}
                      <time class="pc-time" datetime={new Date(reply.createdAt).toISOString()}>{formatTime(reply.createdAt)}</time>
                    </div>
                    <div class="pc-content">
                      <p class="pc-body">{reply.body}</p>
                      {#if reply.imageUrl}
                        <div class="pc-photo">
                          <img
                            src={reply.imageUrl}
                            alt={`Ảnh từ ${reply.authorName}`}
                            width={reply.imageWidth ?? undefined}
                            height={reply.imageHeight ?? undefined}
                            loading="lazy"
                          />
                        </div>
                      {/if}
                    </div>
                  </article>
                </li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <form class="pc-form" bind:this={formEl} onsubmit={onSubmit}>
    <h3 class="pc-form-title">{parentId ? 'Trả lời bình luận' : 'Viết bình luận'}</h3>
    {#if replyToName}
      <p class="pc-replying">
        Đang trả lời <strong>{replyToName}</strong>
        <button type="button" class="pc-cancel" onclick={cancelReply}>Hủy</button>
      </p>
    {/if}

    <label class="pc-label">
      <span>Tên hiển thị</span>
      <input
        class="field"
        name="authorName"
        maxlength="40"
        autocomplete="nickname"
        required
        bind:value={authorName}
        placeholder="Ví dụ: Hương"
      />
    </label>

    <label class="pc-label">
      <span>Nội dung</span>
      <textarea
        class="field pc-textarea"
        name="body"
        rows="3"
        maxlength="1000"
        required
        bind:value={body}
        placeholder="Chia sẻ cảm nhận của bạn…"
      ></textarea>
    </label>

    <div class="pc-image-row">
      <label class="pc-file-btn">
        <input
          bind:this={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onchange={onPickImage}
        />
        {imageFile ? 'Đổi ảnh' : 'Thêm ảnh (tuỳ chọn)'}
      </label>
      {#if imagePreview}
        <div class="pc-preview">
          <img src={imagePreview} alt="" />
          <button type="button" class="pc-clear-img" onclick={() => clearImage(true)} aria-label="Gỡ ảnh">×</button>
        </div>
      {/if}
    </div>

    {#if error}
      <p class="error-text" role="alert">{error}</p>
    {/if}
    {#if success}
      <p class="pc-success" role="status">{success}</p>
    {/if}

    <button class="btn btn-primary pc-submit" type="submit" disabled={submitting}>
      {submitting ? 'Đang gửi…' : 'Gửi bình luận'}
    </button>
    <p class="pc-note">Không cần đăng nhập. Bình luận của bạn hiện ngay với trạng thái chờ duyệt.</p>
  </form>
</section>

<style>
  .pc {
    margin-top: 2.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--color-line);
  }
  .pc-head {
    margin-bottom: 1.25rem;
  }
  .pc-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--color-heading);
  }
  .pc-lead {
    margin-top: 0.35rem;
    color: var(--color-muted);
    font-size: 0.9375rem;
  }
  .pc-list,
  .pc-replies {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.85rem;
  }
  .pc-item {
    display: grid;
    gap: 0.65rem;
  }
  .pc-replies {
    margin-left: 1rem;
    padding-left: 0.85rem;
    border-left: 2px solid color-mix(in oklab, var(--color-primary) 28%, var(--color-line));
  }
  .pc-card {
    padding: 0.15rem 0;
    animation: pc-in 0.35s ease;
  }
  .pc-card.is-pending {
    opacity: 0.95;
  }
  .pc-card.is-pending .pc-content {
    filter: blur(2.5px);
    opacity: 0.72;
    user-select: none;
    pointer-events: none;
  }
  .pc-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.55rem;
  }
  .pc-author {
    font-weight: 600;
    color: var(--color-heading);
  }
  .pc-author.is-shop {
    color: var(--color-primary-strong);
  }
  .pc-badge {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--color-primary-strong);
    background: color-mix(in oklab, var(--color-primary) 16%, var(--color-surface));
    border-radius: 999px;
    padding: 0.12rem 0.45rem;
  }
  .pc-badge.is-owner,
  .pc-badge.is-pending {
    text-transform: none;
    letter-spacing: 0;
  }
  .pc-badge.is-pending {
    color: var(--color-accent-strong);
    background: color-mix(in oklab, var(--color-accent) 18%, var(--color-surface));
  }
  .pc-time {
    margin-left: auto;
    font-size: 0.8125rem;
    color: var(--color-muted);
  }
  .pc-body {
    margin-top: 0.45rem;
    white-space: pre-wrap;
    line-height: 1.55;
    color: var(--color-ink);
  }
  .pc-photo {
    display: block;
    margin-top: 0.65rem;
    max-width: 14rem;
  }
  .pc-photo img {
    display: block;
    width: 100%;
    height: auto;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-line);
  }
  .pc-reply-btn {
    margin-top: 0.55rem;
    border: 0;
    background: transparent;
    color: var(--color-primary-strong);
    font-weight: 600;
    font-size: 0.875rem;
    padding: 0;
    cursor: pointer;
  }
  .pc-reply-btn:hover {
    text-decoration: underline;
  }
  .pc-form {
    margin-top: 1.5rem;
    padding: 1rem;
    border-radius: var(--radius-md);
    border: 0;
    background: var(--color-surface);
    display: grid;
    gap: 0.75rem;
  }
  .pc-form-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-heading);
  }
  .pc-replying {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    font-size: 0.875rem;
    color: var(--color-muted);
  }
  .pc-cancel {
    border: 0;
    background: transparent;
    color: var(--color-accent-strong);
    font-weight: 600;
    cursor: pointer;
    padding: 0;
  }
  .pc-label {
    display: grid;
    gap: 0.35rem;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-heading);
  }
  .pc-textarea {
    resize: vertical;
    min-height: 5rem;
  }
  .pc-image-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }
  .pc-file-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    min-height: 2.25rem;
    padding: 0.35rem 0.85rem;
    border-radius: var(--radius-md);
    border: 1px dashed var(--color-line);
    background: color-mix(in oklab, var(--color-sand) 40%, var(--color-surface));
    color: var(--color-primary-strong);
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
  }
  .pc-file-btn input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .pc-preview {
    position: relative;
    width: 4.5rem;
    height: 4.5rem;
  }
  .pc-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-line);
  }
  .pc-clear-img {
    position: absolute;
    top: -0.35rem;
    right: -0.35rem;
    width: 1.35rem;
    height: 1.35rem;
    border-radius: 999px;
    border: 1px solid var(--color-line);
    background: var(--color-surface);
    color: var(--color-ink);
    line-height: 1;
    cursor: pointer;
  }
  .pc-success {
    color: var(--color-primary-strong);
    font-size: 0.9375rem;
  }
  .pc-submit {
    justify-self: start;
  }
  .pc-note {
    font-size: 0.8125rem;
    color: var(--color-muted);
  }
  @keyframes pc-in {
    from {
      opacity: 0;
      transform: translateY(0.4rem);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pc-card {
      animation: none;
    }
  }
  @media (min-width: 640px) {
    .pc-replies {
      margin-left: 1.35rem;
      padding-left: 1.1rem;
    }
  }
</style>
