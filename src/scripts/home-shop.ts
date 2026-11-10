/** Filter danh mục/sort + Xem tiếp trên trang chủ — fetch JSON /api/catalog, không reload. */
import { CART_MAX_QUANTITY } from '../features/cart/cart';
import { WEIGHT_SCALES, type WeightScale } from '../features/products/weight';
import { FREE_SHIP_WITH_ADDON_LABEL, type ProductShipBadge } from '../features/shipping/customer-fee';

const PAGE_SIZE = 12;

function weightLabels(scale: string): readonly string[] {
  return scale in WEIGHT_SCALES ? WEIGHT_SCALES[scale as WeightScale] : [];
}

type ApiProduct = {
  id: number;
  name: string;
  slug: string;
  price: number;
  comparePrice: number | null;
  discountPercent: number | null;
  weightScale: string;
  shipBadge?: ProductShipBadge;
  coverUrl: string | null;
  coverAlt: string;
  coverWidth: number | null;
  coverHeight: number | null;
};

type ApiPayload = {
  page: number;
  pageCount: number;
  total: number;
  products: ApiProduct[];
};

function boot() {
  const found = document.querySelector('[data-home-shop]');
  if (!(found instanceof HTMLElement)) return;
  const root: HTMLElement = found;

  const grid = root.querySelector('[data-home-grid]');
  const moreWrap = root.querySelector('[data-home-more-wrap]');
  const moreBtn = root.querySelector('[data-home-more]');
  const countEl = root.querySelector('[data-home-count]');
  const emptyEl = root.querySelector('[data-home-empty]');
  const cats = document.querySelector('[data-home-cats]');
  const apiBase = root.dataset.api || '/api/catalog';
  const cartPath = root.dataset.cart || '/gio-hang';
  const checkoutPath = root.dataset.checkout || '/dat-hang';
  const productBase = root.dataset.productBase || '/san-pham/';
  let busy = false;

  function state() {
    return {
      page: Number(root.dataset.page || '1') || 1,
      pageCount: Number(root.dataset.pageCount || '1') || 1,
      category: root.dataset.category || '',
      sort: root.dataset.sort || 'ban-chay',
    };
  }

  function apiUrl(page: number, category: string, sort: string) {
    const params = new URLSearchParams();
    if (category) params.set('danh-muc', category);
    if (sort && sort !== 'mac-dinh') params.set('sap-xep', sort);
    if (page > 1) params.set('page', String(page));
    const text = params.toString();
    return text ? `${apiBase}?${text}` : apiBase;
  }

  function shopUrl(category: string, sort: string) {
    const params = new URLSearchParams();
    if (category) params.set('danh-muc', category);
    if (sort && sort !== 'mac-dinh') params.set('sap-xep', sort);
    const text = params.toString();
    return text ? `/?${text}#san-pham` : '/#san-pham';
  }

  function escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatVnd(amount: number) {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'VND',
      maximumFractionDigits: 0,
    }).format(amount);
  }

  function cardHtml(product: ApiProduct, eager: boolean) {
    const href = `${productBase}${encodeURIComponent(product.slug)}`;
    const orderHref = `${checkoutPath}?san-pham=${encodeURIComponent(product.slug)}`;
    const name = escapeHtml(product.name);
    const needsWeight = product.weightScale !== 'none';
    const media = product.coverUrl
      ? `<img src="${escapeHtml(product.coverUrl)}" alt="" width="${product.coverWidth ?? 480}" height="${product.coverHeight ?? 480}" loading="${eager ? 'eager' : 'lazy'}" decoding="async" sizes="(min-width: 64rem) 16rem, (min-width: 40rem) 30vw, 46vw" />`
      : '<span class="home-shop-media-empty" aria-hidden="true"></span>';
    const badge =
      product.discountPercent != null ? `<span class="home-shop-badge">-${product.discountPercent}%</span>` : '';
    const compare =
      product.comparePrice != null
        ? `<span class="home-shop-price-was">${formatVnd(product.comparePrice)}</span>`
        : '';
    const shipBadge =
      product.shipBadge === 'free'
        ? '<p class="free-ship-badge"><span class="free-ship-heart" aria-hidden="true">♥</span> Miễn phí vận chuyển</p>'
        : product.shipBadge === 'with-addon'
          ? `<p class="free-ship-hint">${FREE_SHIP_WITH_ADDON_LABEL}</p>`
          : '';
    const addId = `home-add-${product.id}`;
    const addTitleId = `home-add-title-${product.id}`;
    const weights = weightLabels(product.weightScale);
    const cart = needsWeight
      ? `<button class="btn home-shop-cart" type="button" data-add-open aria-haspopup="dialog" aria-controls="${addId}">Thêm giỏ</button>`
      : `<form class="home-shop-cart-form" method="post" action="${cartPath}" data-cart-form>
          <input type="hidden" name="intent" value="add" />
          <input type="hidden" name="slug" value="${escapeHtml(product.slug)}" />
          <input type="hidden" name="weight" value="" />
          <input type="hidden" name="quantity" value="1" />
          <button class="btn home-shop-cart" type="submit">Thêm giỏ</button>
        </form>`;
    const dialog = needsWeight
      ? `<dialog id="${addId}" class="add-dialog" aria-labelledby="${addTitleId}">
          <form class="add-form" method="post" action="${cartPath}" data-cart-form data-requires-weight="true">
            <div class="add-head">
              <p id="${addTitleId}" class="font-semibold">${name}</p>
              <button class="add-close" type="button" data-add-close aria-label="Đóng">×</button>
            </div>
            <p class="font-semibold text-primary-strong">${formatVnd(product.price)}</p>
            <input type="hidden" name="intent" value="add" />
            <input type="hidden" name="slug" value="${escapeHtml(product.slug)}" />
            <fieldset class="mt-3">
              <legend class="text-sm font-semibold">Cân nặng của bé</legend>
              <div class="weight-grid mt-2" role="radiogroup">
                ${weights
                  .map(
                    (weight, index) =>
                      `<label class="weight-chip"><input type="radio" name="weight" value="${escapeHtml(weight)}"${index === 0 ? ' required' : ''} /><span>${escapeHtml(weight)}</span></label>`,
                  )
                  .join('')}
              </div>
            </fieldset>
            <div class="qty-stepper" data-qty-stepper>
              <p class="qty-stepper-label">Số lượng</p>
              <div class="qty-stepper-row" role="group" aria-label="Số lượng">
                <button class="qty-stepper-btn" type="button" data-qty-dec aria-label="Giảm số lượng">−</button>
                <input class="qty-stepper-input field" name="quantity" type="number" inputmode="numeric" min="1" max="${CART_MAX_QUANTITY}" value="1" required data-qty-input aria-label="Số lượng" />
                <button class="qty-stepper-btn" type="button" data-qty-inc aria-label="Tăng số lượng">+</button>
              </div>
            </div>
            <p class="add-error error-text mt-2" role="alert" hidden></p>
            <button class="btn btn-primary mt-4 w-full" type="submit">Thêm giỏ</button>
          </form>
        </dialog>`
      : '';
    return `<li><article class="home-shop-card">
      <a class="home-shop-media" href="${href}" tabindex="-1" aria-hidden="true">${media}${badge}</a>
      <div class="home-shop-body">
        <h3 class="home-shop-name"><a href="${href}">${name}</a></h3>
        <p class="home-shop-price"><span class="home-shop-price-now">${formatVnd(product.price)}</span>${compare}</p>
        ${shipBadge}
        <div class="home-shop-actions">
          <a class="btn btn-primary home-shop-buy" href="${orderHref}" data-order-open data-slug="${escapeHtml(product.slug)}" data-name="${name}" data-price="${product.price}" data-scale="${escapeHtml(product.weightScale)}" data-cover="${escapeHtml(product.coverUrl ?? '')}">Mua ngay</a>
          ${cart}
        </div>
      </div>
      ${dialog}
    </article></li>`;
  }

  function setCurrent(container: Element | null, attr: string, value: string) {
    if (!container) return;
    container.querySelectorAll(`[${attr}]`).forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      if ((node.getAttribute(attr) || '') === value) node.setAttribute('aria-current', 'true');
      else node.removeAttribute('aria-current');
    });
  }

  function updateMore(page: number, pageCount: number, category: string, sort: string) {
    root.dataset.page = String(page);
    root.dataset.pageCount = String(pageCount);
    if (!(moreWrap instanceof HTMLElement) || !(moreBtn instanceof HTMLAnchorElement)) return;
    if (page >= pageCount) {
      moreWrap.hidden = true;
      return;
    }
    moreWrap.hidden = false;
    const params = new URLSearchParams();
    if (category) params.set('danh-muc', category);
    if (sort !== 'mac-dinh') params.set('sap-xep', sort);
    params.set('page', String(page + 1));
    moreBtn.href = `/mau-vong-dau-tam?${params.toString()}`;
    moreBtn.dataset.nextApi = apiUrl(page + 1, category, sort);
    moreBtn.textContent = `Xem tiếp ${PAGE_SIZE} mẫu`;
  }

  function updateCount(total: number) {
    if (!(countEl instanceof HTMLElement)) return;
    countEl.textContent = total === 0 ? 'Chưa có mẫu' : total === 1 ? '1 mẫu' : `${total} mẫu`;
  }

  async function fetchPage(page: number, category: string, sort: string): Promise<ApiPayload> {
    const response = await fetch(apiUrl(page, category, sort), { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('catalog_api');
    return (await response.json()) as ApiPayload;
  }

  async function replaceList(category: string, sort: string) {
    if (busy) return;
    busy = true;
    root.dataset.category = category;
    root.dataset.sort = sort;
    setCurrent(cats, 'data-category', category);
    setCurrent(root.querySelector('.home-shop-sorts'), 'data-sort', sort);
    try {
      const data = await fetchPage(1, category, sort);
      if (grid instanceof HTMLElement) {
        grid.innerHTML = data.products.map((product, index) => cardHtml(product, index < 2)).join('');
        grid.hidden = data.products.length === 0;
      }
      if (emptyEl instanceof HTMLElement) emptyEl.hidden = data.products.length > 0;
      updateCount(data.total);
      updateMore(data.page, data.pageCount, category, sort);
      history.replaceState(null, '', shopUrl(category, sort));
    } catch {
      window.location.href = shopUrl(category, sort);
    } finally {
      busy = false;
    }
  }

  async function loadMore(event: Event) {
    event.preventDefault();
    if (busy || !(moreBtn instanceof HTMLAnchorElement)) return;
    const current = state();
    if (current.page >= current.pageCount) return;
    busy = true;
    moreBtn.setAttribute('aria-busy', 'true');
    try {
      const data = await fetchPage(current.page + 1, current.category, current.sort);
      if (grid instanceof HTMLElement) {
        grid.insertAdjacentHTML('beforeend', data.products.map((product) => cardHtml(product, false)).join(''));
      }
      updateMore(data.page, data.pageCount, current.category, current.sort);
    } catch {
      window.location.href = moreBtn.href;
    } finally {
      moreBtn.removeAttribute('aria-busy');
      busy = false;
    }
  }

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-home-filter]') : null;
    if (!(target instanceof HTMLAnchorElement)) return;
    if (!root.contains(target) && !(cats && cats.contains(target))) return;
    event.preventDefault();
    const nextCategory = target.dataset.category !== undefined ? target.dataset.category : state().category;
    const nextSort = target.dataset.sort !== undefined ? target.dataset.sort : state().sort;
    void replaceList(nextCategory, nextSort || 'ban-chay');
    if (target.dataset.category !== undefined) {
      document.getElementById('san-pham')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  moreBtn?.addEventListener('click', (event) => {
    void loadMore(event);
  });
}

boot();
