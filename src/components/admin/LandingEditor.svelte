<script lang="ts">
  import { untrack } from 'svelte';
  import {
    LANDING_MAX_BLOCKS,
    LANDING_MAX_BENEFITS,
    parseBlocks,
    serializeBlocks,
    type LandingBlock,
    type LandingBlockType,
  } from '../../features/landings/blocks';
  import type { MediaItem } from '../../features/media/types';
  import MediaPicker from './MediaPicker.svelte';

  type ProductOption = { id: number; name: string; price: number };

  let {
    csrf,
    media = [],
    products = [],
    blocksJson = '[]',
    error = '',
  }: {
    csrf: string;
    media?: MediaItem[];
    products?: ProductOption[];
    blocksJson?: string;
    error?: string;
  } = $props();

  let blocks = $state<LandingBlock[]>(untrack(() => parseBlocks(blocksJson)));
  let picking = $state(false);
  let pickingIndex = $state(-1);

  const serialized = $derived(serializeBlocks(blocks));
  const mediaById = $derived(new Map(media.map((item) => [item.id, item])));

  const BLOCK_LABELS: Record<LandingBlockType, string> = {
    hero: 'Hero (đầu trang)',
    text: 'Văn bản',
    image: 'Ảnh',
    benefits: 'Lợi ích',
    products: 'Lưới sản phẩm',
    cta: 'Kêu gọi hành động',
  };

  const formatVnd = (value: number) => `${value.toLocaleString('vi-VN')}₫`;

  function addBlock(type: LandingBlockType) {
    if (blocks.length >= LANDING_MAX_BLOCKS) return;
    if (type === 'hero') blocks.push({ type: 'hero', eyebrow: '', title: '', subtitle: '', imageMediaId: null, ctaText: 'Đặt hàng ngay', ctaAnchor: '#dat-hang' });
    else if (type === 'text') blocks.push({ type: 'text', title: '', body: '' });
    else if (type === 'image') blocks.push({ type: 'image', imageMediaId: null, caption: '' });
    else if (type === 'benefits') blocks.push({ type: 'benefits', title: '', items: [{ title: '', desc: '' }] });
    else if (type === 'products') blocks.push({ type: 'products', title: 'Chọn mẫu bạn thích', productIds: [] });
    else blocks.push({ type: 'cta', title: '', subtitle: '', buttonText: 'Đặt hàng ngay', anchor: '#dat-hang' });
  }

  function removeBlock(index: number) {
    blocks.splice(index, 1);
  }

  function move(index: number, delta: number) {
    const to = index + delta;
    if (to < 0 || to >= blocks.length) return;
    const [item] = blocks.splice(index, 1);
    if (item) blocks.splice(to, 0, item);
  }

  function addBenefit(block: Extract<LandingBlock, { type: 'benefits' }>) {
    if (block.items.length >= LANDING_MAX_BENEFITS) return;
    block.items.push({ title: '', desc: '' });
  }

  function removeBenefit(block: Extract<LandingBlock, { type: 'benefits' }>, index: number) {
    block.items.splice(index, 1);
    if (block.items.length === 0) block.items.push({ title: '', desc: '' });
  }

  function toggleProduct(block: Extract<LandingBlock, { type: 'products' }>, id: number, checked: boolean) {
    if (checked) {
      if (!block.productIds.includes(id)) block.productIds.push(id);
    } else {
      block.productIds = block.productIds.filter((value) => value !== id);
    }
  }

  function openPicker(index: number) {
    pickingIndex = index;
    picking = true;
  }

  function onPickImage(item: MediaItem) {
    const block = blocks[pickingIndex];
    if (block?.type === 'hero' || block?.type === 'image') block.imageMediaId = item.id;
    picking = false;
    pickingIndex = -1;
  }
</script>

<input type="hidden" name="blocksJson" value={serialized} />

<div class="landing-editor">
  {#if error}<p class="error-text" role="alert">{error}</p>{/if}

  {#if blocks.length === 0}
    <p class="post-empty">Chưa có khối nào. Thêm khối đầu tiên bên dưới.</p>
  {/if}

  {#each blocks as block, index (index)}
    <section class="landing-block">
      <header class="landing-block-head">
        <span class="landing-block-kind">{BLOCK_LABELS[block.type]}</span>
        <div class="landing-block-tools">
          <button type="button" class="btn" title="Lên" aria-label="Di chuyển lên" disabled={index === 0} onclick={() => move(index, -1)}>↑</button>
          <button type="button" class="btn" title="Xuống" aria-label="Di chuyển xuống" disabled={index === blocks.length - 1} onclick={() => move(index, 1)}>↓</button>
          <button type="button" class="btn btn-accent" aria-label="Xóa khối" onclick={() => removeBlock(index)}>Xóa</button>
        </div>
      </header>

      {#if block.type === 'hero'}
        <label class="block"><span class="landing-field-label">Dòng nhỏ phía trên</span>
          <input class="field" maxlength="80" bind:value={block.eyebrow} placeholder="Ví dụ: Thủ công cho mẹ và bé" /></label>
        <label class="block"><span class="landing-field-label">Tiêu đề lớn</span>
          <input class="field" maxlength="160" bind:value={block.title} placeholder="Tiêu đề nổi bật" /></label>
        <label class="block"><span class="landing-field-label">Mô tả ngắn</span>
          <textarea class="field min-h-20" maxlength="300" bind:value={block.subtitle}></textarea></label>
        <div class="landing-hero-image">
          {#if block.imageMediaId && mediaById.get(block.imageMediaId)}
            <img src={mediaById.get(block.imageMediaId)?.url} alt="" />
          {/if}
          <div class="landing-block-tools">
            <button type="button" class="btn" onclick={() => openPicker(index)}>{block.imageMediaId ? 'Đổi ảnh' : 'Chọn ảnh'}</button>
            {#if block.imageMediaId}<button type="button" class="btn" onclick={() => (block.imageMediaId = null)}>Bỏ ảnh</button>{/if}
          </div>
        </div>
        <div class="landing-cta-row">
          <label class="block"><span class="landing-field-label">Chữ trên nút</span>
            <input class="field" maxlength="80" bind:value={block.ctaText} /></label>
          <label class="block"><span class="landing-field-label">Nút cuộn tới</span>
            <select class="field" bind:value={block.ctaAnchor}>
              <option value="#dat-hang">Form đặt hàng</option>
              <option value="#san-pham">Lưới sản phẩm</option>
            </select></label>
        </div>
      {:else if block.type === 'text'}
        <label class="block"><span class="landing-field-label">Tiêu đề</span>
          <input class="field" maxlength="160" bind:value={block.title} /></label>
        <label class="block"><span class="landing-field-label">Nội dung</span>
          <textarea class="field min-h-32" maxlength="2000" bind:value={block.body}></textarea></label>
      {:else if block.type === 'image'}
        <div class="landing-hero-image">
          {#if block.imageMediaId && mediaById.get(block.imageMediaId)}
            <img src={mediaById.get(block.imageMediaId)?.url} alt="" />
          {:else}
            <p class="landing-hint">Chưa chọn ảnh.</p>
          {/if}
          <div class="landing-block-tools">
            <button type="button" class="btn" onclick={() => openPicker(index)}>{block.imageMediaId ? 'Đổi ảnh' : 'Chọn ảnh'}</button>
            {#if block.imageMediaId}<button type="button" class="btn" onclick={() => (block.imageMediaId = null)}>Bỏ ảnh</button>{/if}
          </div>
        </div>
        <label class="block"><span class="landing-field-label">Chú thích (tùy chọn)</span>
          <input class="field" maxlength="300" bind:value={block.caption} placeholder="Mô tả ngắn dưới ảnh" /></label>
      {:else if block.type === 'benefits'}
        <label class="block"><span class="landing-field-label">Tiêu đề khối</span>
          <input class="field" maxlength="160" bind:value={block.title} placeholder="Vì sao chọn chúng tôi" /></label>
        {#each block.items as item, itemIndex (itemIndex)}
          <div class="landing-benefit">
            <input class="field" maxlength="80" bind:value={item.title} placeholder="Lợi ích" />
            <input class="field" maxlength="300" bind:value={item.desc} placeholder="Mô tả ngắn" />
            <button type="button" class="btn" aria-label="Xóa lợi ích" onclick={() => removeBenefit(block, itemIndex)}>✕</button>
          </div>
        {/each}
        <button type="button" class="btn" disabled={block.items.length >= LANDING_MAX_BENEFITS} onclick={() => addBenefit(block)}>+ Thêm lợi ích</button>
      {:else if block.type === 'products'}
        <label class="block"><span class="landing-field-label">Tiêu đề khối</span>
          <input class="field" maxlength="160" bind:value={block.title} /></label>
        {#if products.length === 0}
          <p class="post-empty">Chưa có sản phẩm đang bán. Thêm sản phẩm trước.</p>
        {:else}
          <p class="landing-hint">Không chọn mẫu nào = hiện toàn bộ sản phẩm đang bán.</p>
          <div class="landing-product-pick">
            {#each products as product (product.id)}
              <label class="landing-product-option">
                <input
                  type="checkbox"
                  checked={block.productIds.includes(product.id)}
                  onchange={(event) => toggleProduct(block, product.id, (event.currentTarget as HTMLInputElement).checked)}
                />
                <span>{product.name}</span>
                <span class="landing-product-price">{formatVnd(product.price)}</span>
              </label>
            {/each}
          </div>
        {/if}
      {:else}
        <label class="block"><span class="landing-field-label">Tiêu đề</span>
          <input class="field" maxlength="160" bind:value={block.title} /></label>
        <label class="block"><span class="landing-field-label">Mô tả</span>
          <textarea class="field min-h-20" maxlength="300" bind:value={block.subtitle}></textarea></label>
        <div class="landing-cta-row">
          <label class="block"><span class="landing-field-label">Chữ trên nút</span>
            <input class="field" maxlength="80" bind:value={block.buttonText} /></label>
          <label class="block"><span class="landing-field-label">Nút cuộn tới</span>
            <select class="field" bind:value={block.anchor}>
              <option value="#dat-hang">Form đặt hàng</option>
              <option value="#san-pham">Lưới sản phẩm</option>
            </select></label>
        </div>
      {/if}
    </section>
  {/each}

  <div class="landing-add" role="group" aria-label="Thêm khối">
    <span class="landing-field-label">Thêm khối:</span>
    <button type="button" class="btn" disabled={blocks.length >= LANDING_MAX_BLOCKS} onclick={() => addBlock('hero')}>Hero</button>
    <button type="button" class="btn" disabled={blocks.length >= LANDING_MAX_BLOCKS} onclick={() => addBlock('text')}>Văn bản</button>
    <button type="button" class="btn" disabled={blocks.length >= LANDING_MAX_BLOCKS} onclick={() => addBlock('image')}>Ảnh</button>
    <button type="button" class="btn" disabled={blocks.length >= LANDING_MAX_BLOCKS} onclick={() => addBlock('benefits')}>Lợi ích</button>
    <button type="button" class="btn" disabled={blocks.length >= LANDING_MAX_BLOCKS} onclick={() => addBlock('products')}>Sản phẩm</button>
    <button type="button" class="btn" disabled={blocks.length >= LANDING_MAX_BLOCKS} onclick={() => addBlock('cta')}>CTA</button>
  </div>
  {#if blocks.length >= LANDING_MAX_BLOCKS}<p class="landing-hint">Đã đạt tối đa {LANDING_MAX_BLOCKS} khối.</p>{/if}
</div>

<MediaPicker {csrf} items={media} hideTrigger bind:open={picking} onPick={onPickImage} />
