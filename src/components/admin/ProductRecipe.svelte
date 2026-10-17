<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import {
    DEFAULT_ROUND_STEP,
    DEFAULT_TARGET_MARGIN,
    LOW_MARGIN_PERCENT,
    MAX_TARGET_MARGIN,
    RECIPE_MAX_LINES,
    RECIPE_MAX_QUANTITY,
    lineCost,
    marginTone,
    profitOf,
    recipeCost,
    suggestedPrice,
    type CostedLine,
    type MaterialOption,
  } from '../../features/materials/costing';
  import { formatVnd } from '../../lib/money';

  let {
    options,
    lines,
    error = '',
    priceInput = 'price',
    materialsHref = '/admin/materials',
  }: { options: MaterialOption[]; lines: CostedLine[]; error?: string; priceInput?: string; materialsHref?: string } = $props();

  let rows = $state<CostedLine[]>(untrack(() => lines.map((line) => ({ ...line }))));
  let picked = $state('');
  let pickedQuantity = $state(1);
  let price = $state(0);
  let targetMargin = $state<number | null>(DEFAULT_TARGET_MARGIN);
  let priceEl: HTMLInputElement | null = null;

  const taken = $derived(new Set(rows.map((row) => row.materialId)));
  const available = $derived(options.filter((option) => option.active && !taken.has(option.id)));
  const groups = $derived.by(() => {
    const map = new Map<string, MaterialOption[]>();
    for (const option of available) {
      const list = map.get(option.group);
      if (list) list.push(option);
      else map.set(option.group, [option]);
    }
    return [...map.entries()];
  });
  const cost = $derived(recipeCost(rows));
  const figures = $derived(profitOf(price, cost));
  const full = $derived(rows.length >= RECIPE_MAX_LINES);
  const tone = $derived(rows.length > 0 && price > 0 ? marginTone(figures.marginPercent) : 'none');
  const margin = $derived(
    typeof targetMargin === 'number' && Number.isInteger(targetMargin) && targetMargin >= 0 && targetMargin <= MAX_TARGET_MARGIN
      ? targetMargin
      : DEFAULT_TARGET_MARGIN,
  );
  const suggested = $derived(rows.length > 0 ? suggestedPrice(cost, margin, DEFAULT_ROUND_STEP) : null);

  // Điền giá đề xuất vào ô Giá của form (vẫn phải bấm Lưu sản phẩm mới có hiệu lực).
  function applySuggested() {
    if (!priceEl || suggested === null) return;
    priceEl.value = String(suggested);
    priceEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function clampQuantity(value: number): number {
    if (!Number.isInteger(value) || value < 1) return 1;
    return Math.min(RECIPE_MAX_QUANTITY, value);
  }

  function add() {
    const option = options.find((item) => String(item.id) === picked);
    if (!option || full || taken.has(option.id)) return;
    rows.push({ materialId: option.id, quantity: clampQuantity(pickedQuantity), name: option.name, group: option.group, unitCost: option.unitCost, active: option.active });
    picked = '';
    pickedQuantity = 1;
  }

  function remove(index: number) {
    rows.splice(index, 1);
  }

  function setQuantity(index: number, event: Event) {
    const row = rows[index];
    if (!row) return;
    const input = event.currentTarget as HTMLInputElement;
    row.quantity = clampQuantity(Number(input.value));
    input.value = String(row.quantity);
  }

  // Enter trong ô số lượng không được gửi cả form sản phẩm.
  function holdEnter(event: KeyboardEvent) {
    if (event.key === 'Enter') event.preventDefault();
  }

  function readPrice(input: HTMLInputElement): number {
    const digits = input.value.replace(/[^\d]/g, '');
    return digits ? Number(digits) : 0;
  }

  onMount(() => {
    const input = document.querySelector(`input[name="${priceInput}"]`);
    if (!(input instanceof HTMLInputElement)) return;
    priceEl = input;
    price = readPrice(input);
    const sync = () => {
      price = readPrice(input);
    };
    input.addEventListener('input', sync);
    return () => input.removeEventListener('input', sync);
  });
</script>

<section class="recipe" aria-labelledby="recipe-title">
  <h2 id="recipe-title" class="recipe-title">Nguyên liệu và giá vốn</h2>
  <p class="recipe-hint">Chọn các nguyên liệu làm một sản phẩm (tính theo cỡ chuẩn). Giá vốn tự cập nhật khi giá nguyên liệu đổi.</p>

  {#each rows as row (row.materialId)}
    <input type="hidden" name="materialId" value={row.materialId} />
    <input type="hidden" name="materialQty" value={row.quantity} />
  {/each}

  {#if rows.length === 0}
    <p class="recipe-empty">Chưa chọn nguyên liệu nào, nên chưa tính được giá vốn.</p>
  {:else}
    <ul class="recipe-lines">
      {#each rows as row, index (row.materialId)}
        <li class="recipe-line">
          <div class="recipe-name">
            <strong>{row.name}</strong>
            <span>{row.group}{#if !row.active} · <em>Ngừng dùng</em>{/if}</span>
          </div>
          <label class="recipe-qty">
            <span class="sr-only">Số lượng {row.name}</span>
            <input
              class="field"
              type="number"
              inputmode="numeric"
              min="1"
              max={RECIPE_MAX_QUANTITY}
              value={row.quantity}
              onchange={(event) => setQuantity(index, event)}
              onkeydown={holdEnter}
            />
          </label>
          <span class="recipe-unit">× {formatVnd(row.unitCost)}</span>
          <strong class="recipe-total">{formatVnd(lineCost(row.unitCost, row.quantity))}</strong>
          <button class="recipe-remove" type="button" onclick={() => remove(index)} aria-label={`Bỏ ${row.name}`}>Bỏ</button>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="recipe-add">
    <label class="recipe-pick">
      <span class="sr-only">Chọn nguyên liệu để thêm</span>
      <select class="field" bind:value={picked} disabled={full || available.length === 0}>
        <option value="">{available.length === 0 ? 'Không còn nguyên liệu để thêm' : 'Chọn nguyên liệu…'}</option>
        {#each groups as [group, list] (group)}
          <optgroup label={group}>
            {#each list as option (option.id)}
              <option value={String(option.id)}>{option.name} — {formatVnd(option.unitCost)}</option>
            {/each}
          </optgroup>
        {/each}
      </select>
    </label>
    <label class="recipe-qty">
      <span class="sr-only">Số lượng cần thêm</span>
      <input class="field" type="number" inputmode="numeric" min="1" max={RECIPE_MAX_QUANTITY} bind:value={pickedQuantity} onkeydown={holdEnter} disabled={full} />
    </label>
    <button class="btn" type="button" onclick={add} disabled={!picked || full}>Thêm</button>
  </div>
  {#if full}<p class="recipe-hint">Tối đa {RECIPE_MAX_LINES} nguyên liệu mỗi sản phẩm.</p>{/if}
  {#if error}<span class="error-text" role="alert">{error}</span>{/if}
  <p class="recipe-hint">
    Chưa thấy nguyên liệu cần dùng? <a href={materialsHref}>Quản lý nguyên liệu</a> (lưu sản phẩm trước khi rời trang).
  </p>

  <dl class="recipe-sum" aria-live="polite">
    <div><dt>Giá vốn</dt><dd>{rows.length > 0 ? formatVnd(cost) : '—'}</dd></div>
    <div><dt>Giá bán</dt><dd>{price > 0 ? formatVnd(price) : '—'}</dd></div>
    <div>
      <dt>Lợi nhuận</dt>
      <dd class:is-loss={rows.length > 0 && price > 0 && figures.profit < 0}>{rows.length > 0 && price > 0 ? formatVnd(figures.profit) : '—'}</dd>
    </div>
    <div>
      <dt>Biên lợi nhuận</dt>
      <dd class:is-loss={rows.length > 0 && figures.marginPercent !== null && figures.marginPercent < 0}>
        {rows.length > 0 && figures.marginPercent !== null ? `${figures.marginPercent}%` : '—'}
      </dd>
    </div>
  </dl>

  {#if tone === 'loss' || tone === 'low'}
    <p class="recipe-warn" role="status">
      {tone === 'loss' ? 'Sản phẩm đang bán lỗ so với giá vốn.' : `Biên lợi nhuận thấp, dưới ${LOW_MARGIN_PERCENT}%.`}
    </p>
  {/if}

  {#if suggested !== null}
    <div class="recipe-suggest">
      <label class="recipe-margin">
        <span>Biên mục tiêu (%)</span>
        <input class="field" type="number" inputmode="numeric" min="0" max={MAX_TARGET_MARGIN} bind:value={targetMargin} onkeydown={holdEnter} />
      </label>
      <p class="recipe-suggest-price">
        Giá đề xuất <strong>{formatVnd(suggested)}</strong>
        <span>làm tròn lên {formatVnd(DEFAULT_ROUND_STEP)}</span>
      </p>
      <button class="btn" type="button" onclick={applySuggested} disabled={price === suggested}>Dùng giá này</button>
    </div>
  {/if}
</section>
