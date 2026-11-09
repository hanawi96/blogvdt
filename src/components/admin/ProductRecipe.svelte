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
  let draft = $state<CostedLine[]>([]);
  let query = $state('');
  let price = $state(0);
  let targetMargin = $state<number | null>(DEFAULT_TARGET_MARGIN);
  let priceEl: HTMLInputElement | null = null;
  let dialogEl = $state<HTMLDialogElement | null>(null);

  const cost = $derived(recipeCost(rows));
  const draftCost = $derived(recipeCost(draft));
  const groups = $derived.by(() => {
    const term = query.trim().toLocaleLowerCase('vi');
    const map = new Map<string, MaterialOption[]>();
    for (const option of options) {
      if (term && !`${option.name} ${option.group}`.toLocaleLowerCase('vi').includes(term)) continue;
      const list = map.get(option.group);
      if (list) list.push(option);
      else map.set(option.group, [option]);
    }
    return [...map.entries()];
  });
  const figures = $derived(profitOf(price, cost));
  const full = $derived(rows.length >= RECIPE_MAX_LINES);
  const draftFull = $derived(draft.length >= RECIPE_MAX_LINES);
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

  function openPicker() {
    draft = rows.map((line) => ({ ...line }));
    query = '';
    dialogEl?.showModal();
  }

  function applyDraft() {
    const rank = new Map(options.map((option, index) => [option.id, index]));
    rows = draft.map((line) => ({ ...line })).sort((a, b) => (rank.get(a.materialId) ?? 0) - (rank.get(b.materialId) ?? 0));
    dialogEl?.close();
  }

  function draftRow(id: number): CostedLine | undefined {
    return draft.find((row) => row.materialId === id);
  }

  function setPicked(option: MaterialOption, on: boolean) {
    const index = draft.findIndex((row) => row.materialId === option.id);
    if (on) {
      if (index >= 0 || draft.length >= RECIPE_MAX_LINES) return;
      draft = [
        ...draft,
        { materialId: option.id, quantity: 1, name: option.name, group: option.group, unitCost: option.unitCost, active: option.active },
      ];
      return;
    }
    if (index < 0) return;
    draft = draft.filter((_, i) => i !== index);
  }

  function step(id: number, delta: number) {
    const row = draftRow(id);
    if (!row) return;
    row.quantity = clampQuantity(row.quantity + delta);
  }

  function setDraftQuantity(id: number, event: Event) {
    const row = draftRow(id);
    if (!row) return;
    const input = event.currentTarget as HTMLInputElement;
    row.quantity = clampQuantity(Number(input.value));
    input.value = String(row.quantity);
  }

  function onDialogClick(event: MouseEvent) {
    const node = dialogEl;
    if (!node || event.target !== node) return;
    const box = node.getBoundingClientRect();
    const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    if (!inside) node.close();
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

  function stepRow(index: number, delta: number) {
    const row = rows[index];
    if (!row) return;
    row.quantity = clampQuantity(row.quantity + delta);
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
  <p class="recipe-hint">Một chiếc vòng chọn được nhiều nguyên liệu cùng lúc. Giá vốn bằng số lượng nhân đơn giá, và tự đổi khi giá nguyên liệu đổi.</p>

  {#each rows as row (row.materialId)}
    <input type="hidden" name="materialId" value={row.materialId} />
    <input type="hidden" name="materialQty" value={row.quantity} />
  {/each}

  <div class="recipe-toolbar">
    <button class="btn" type="button" onclick={openPicker} disabled={options.length === 0}>Chọn nguyên liệu</button>
  </div>
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
          <div class="recipe-qty">
            <button class="recipe-qty-btn" type="button" aria-label={`Giảm ${row.name}`} onclick={() => stepRow(index, -1)} disabled={row.quantity <= 1}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
            </button>
            <input
              class="field recipe-qty-input"
              type="number"
              inputmode="numeric"
              min="1"
              max={RECIPE_MAX_QUANTITY}
              value={row.quantity}
              aria-label={`Số lượng ${row.name}`}
              onchange={(event) => setQuantity(index, event)}
              onkeydown={holdEnter}
            />
            <button class="recipe-qty-btn" type="button" aria-label={`Tăng ${row.name}`} onclick={() => stepRow(index, 1)} disabled={row.quantity >= RECIPE_MAX_QUANTITY}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </div>
          <span class="recipe-unit">× {formatVnd(row.unitCost)}</span>
          <strong class="recipe-total">{formatVnd(lineCost(row.unitCost, row.quantity))}</strong>
          <button class="recipe-remove" type="button" onclick={() => remove(index)} aria-label={`Bỏ ${row.name}`}>Bỏ</button>
        </li>
      {/each}
    </ul>
  {/if}
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
      </p>
      <button class="btn" type="button" onclick={applySuggested} disabled={price === suggested}>Dùng giá này</button>
    </div>
  {/if}

  <dialog class="recipe-dialog" aria-labelledby="recipe-dialog-title" bind:this={dialogEl} onclick={onDialogClick}>
    <header class="recipe-dialog-head">
      <div>
        <h2 id="recipe-dialog-title">Chọn nguyên liệu</h2>
        <p>Đã chọn: {draft.length} nguyên liệu</p>
      </div>
      <button class="recipe-dialog-close" type="button" aria-label="Đóng" onclick={() => dialogEl?.close()}>×</button>
    </header>
    <div class="recipe-dialog-body">
      <label class="recipe-search">
        <span class="sr-only">Tìm nguyên liệu</span>
        <input class="field" type="search" placeholder="Tìm theo tên hoặc nhóm" bind:value={query} onkeydown={holdEnter} />
      </label>
      <p class="recipe-hint">Giá vốn tạm tính theo đơn giá hiện tại. Bấm Lưu sản phẩm để ghi công thức.</p>
      {#if draftFull}<p class="recipe-hint">Tối đa {RECIPE_MAX_LINES} nguyên liệu. Bỏ bớt nếu muốn chọn loại khác.</p>{/if}
      {#if groups.length === 0}
        <p class="recipe-empty">{options.length === 0 ? 'Chưa có nguyên liệu đang dùng.' : 'Không có nguyên liệu khớp.'}</p>
      {:else}
        {#each groups as [group, list], groupIndex (group)}
          <section class="recipe-group" aria-labelledby={`recipe-group-${groupIndex}`}>
            <h3 id={`recipe-group-${groupIndex}`}>{group} <span>({list.length})</span></h3>
            <ul class="recipe-grid">
              {#each list as option (option.id)}
                {@const picked = draftRow(option.id)}
                <li class="recipe-card" class:is-on={picked !== undefined}>
                  <label class="recipe-card-pick">
                    <input
                      type="checkbox"
                      checked={picked !== undefined}
                      disabled={picked === undefined && draftFull}
                      onchange={(event) => {
                        const input = event.currentTarget;
                        if (!(input instanceof HTMLInputElement)) return;
                        setPicked(option, input.checked);
                        // Đồng bộ lại theo draft (tránh lệch khi đã đủ số dòng tối đa).
                        input.checked = draft.some((row) => row.materialId === option.id);
                      }}
                    />
                    <span class="recipe-card-name">
                      <strong>{option.name}</strong>
                      {#if !option.active}<em>Ngừng dùng</em>{/if}
                    </span>
                    <span class="recipe-card-price">{formatVnd(option.unitCost)}</span>
                  </label>
                  {#if picked}
                    <div class="recipe-card-foot">
                      <div class="recipe-step">
                        <button class="recipe-qty-btn" type="button" aria-label={`Giảm ${option.name}`} onclick={() => step(option.id, -1)} disabled={picked.quantity <= 1}>
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
                        </button>
                        <input
                          class="recipe-qty-input"
                          aria-label={`Số lượng ${option.name}`}
                          type="number"
                          inputmode="numeric"
                          min="1"
                          max={RECIPE_MAX_QUANTITY}
                          value={picked.quantity}
                          onchange={(event) => setDraftQuantity(option.id, event)}
                          onkeydown={holdEnter}
                        />
                        <button class="recipe-qty-btn" type="button" aria-label={`Tăng ${option.name}`} onclick={() => step(option.id, 1)} disabled={picked.quantity >= RECIPE_MAX_QUANTITY}>
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                        </button>
                      </div>
                      <strong>{formatVnd(lineCost(option.unitCost, picked.quantity))}</strong>
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      {/if}
    </div>
    <footer class="recipe-dialog-foot">
      <p>
        {draft.length} nguyên liệu đã chọn
        <span>Giá vốn {draft.length > 0 ? formatVnd(draftCost) : '—'}</span>
      </p>
      <div class="recipe-dialog-actions">
        <button class="btn" type="button" onclick={() => dialogEl?.close()}>Hủy</button>
        <button class="btn btn-primary" type="button" onclick={applyDraft}>Lưu nguyên liệu</button>
      </div>
    </footer>
  </dialog>
</section>
