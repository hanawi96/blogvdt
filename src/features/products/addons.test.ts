import { describe, expect, it } from 'vitest';
import {
  addonShowsPopularBadge,
  addonShipHint,
  addonShipHintText,
  cartShowsAddonUpsell,
  findAddonInCatalog,
  findAddonsInCatalog,
  isKeychainAddon,
  recommendedAddonSlug,
  resolveAddonSlug,
  resolveAddonSlugs,
  type PublicAddon,
} from './addons';

const addons: PublicAddon[] = [
  {
    id: 1,
    slug: 'bo-dau-7-canh',
    name: 'Bó dâu tằm 7 cành',
    price: 39_000,
    sold: 0,
    isFeatured: false,
    coverUrl: null,
    coverAlt: '',
  },
  {
    id: 2,
    slug: 'bo-dau-9-canh',
    name: 'Bó dâu tằm 9 cành',
    price: 49_000,
    sold: 0,
    isFeatured: false,
    coverUrl: null,
    coverAlt: '',
  },
];

describe('resolveAddonSlug', () => {
  it('chấp nhận slug trong danh sách; bỏ trống hoặc lạ', () => {
    expect(resolveAddonSlug('bo-dau-7-canh', addons)).toBe('bo-dau-7-canh');
    expect(resolveAddonSlug('  bo-dau-9-canh  ', addons)).toBe('bo-dau-9-canh');
    expect(resolveAddonSlug('', addons)).toBeNull();
    expect(resolveAddonSlug('vong-tron', addons)).toBeNull();
  });
});

describe('findAddonInCatalog', () => {
  const catalog = [
    { slug: 'vong-tron', categorySlug: 'vong-tron' },
    { slug: 'bo-dau-7-canh', categorySlug: 'san-pham-ban-kem' },
    { slug: 'bo-dau-9-canh', categorySlug: 'san-pham-ban-kem' },
    { slug: 'charm', categorySlug: 'bi-charm-bac' },
  ];

  it('chỉ trả SP thuộc danh mục bán kèm', () => {
    expect(findAddonInCatalog('bo-dau-7-canh', catalog)?.slug).toBe('bo-dau-7-canh');
    expect(findAddonInCatalog('vong-tron', catalog)).toBeNull();
    expect(findAddonInCatalog('charm', catalog)).toBeNull();
    expect(findAddonInCatalog('', catalog)).toBeNull();
  });

  it('findAddonsInCatalog lấy nhiều slug hợp lệ, bỏ trùng', () => {
    expect(findAddonsInCatalog(['bo-dau-7-canh', 'bo-dau-9-canh', 'bo-dau-7-canh'], catalog).map((item) => item.slug)).toEqual([
      'bo-dau-7-canh',
      'bo-dau-9-canh',
    ]);
    expect(resolveAddonSlugs(['bo-dau-7-canh', 'vong-tron', 'bo-dau-9-canh'], addons)).toEqual([
      'bo-dau-7-canh',
      'bo-dau-9-canh',
    ]);
  });
});

describe('recommendedAddonSlug', () => {
  it('ưu tiên featured, không thì giá cao hơn', () => {
    expect(recommendedAddonSlug(addons)).toBe('bo-dau-9-canh');
    expect(
      recommendedAddonSlug([
        { ...addons[1]!, isFeatured: false },
        { ...addons[0]!, isFeatured: true },
      ]),
    ).toBe('bo-dau-7-canh');
    expect(recommendedAddonSlug([])).toBeNull();
  });
});

describe('addonShowsPopularBadge / isKeychainAddon', () => {
  it('badge cho bó dâu; móc chìa khóa không badge và nhận diện đúng', () => {
    expect(addonShowsPopularBadge({ slug: 'bo-dau-7-canh-be-trai' })).toBe(true);
    expect(addonShowsPopularBadge({ slug: 'bo-dau-9-canh-be-gai' })).toBe(true);
    expect(addonShowsPopularBadge({ slug: 'moc-chia-khoa-dau-tam' })).toBe(false);
    expect(isKeychainAddon({ slug: 'moc-chia-khoa-dau-tam' })).toBe(true);
    expect(isKeychainAddon({ slug: 'bo-dau-7-canh-be-trai' })).toBe(false);
  });
});

describe('addonShipHint', () => {
  it('vòng dưới 100k gợi ý miễn ship', () => {
    expect(addonShipHint(69_000)).toBe('free-ship');
    expect(addonShipHint(100_000)).toBe('together');
    expect(addonShipHintText('free-ship')).toBe('Bấm để chọn/bỏ chọn sản phẩm mua kèm');
    expect(addonShipHintText('together')).toBe('Bấm để chọn/bỏ chọn sản phẩm mua kèm');
  });
});

describe('cartShowsAddonUpsell', () => {
  it('hiện khi có vòng, kể cả đã thêm bán kèm', () => {
    expect(cartShowsAddonUpsell([{ shipGroup: 'bracelet' }])).toBe(true);
    expect(cartShowsAddonUpsell([{ shipGroup: 'bracelet' }, { shipGroup: 'addon' }])).toBe(true);
    expect(cartShowsAddonUpsell([{ shipGroup: 'addon' }])).toBe(false);
    expect(cartShowsAddonUpsell([{ shipGroup: 'silver' }])).toBe(false);
    expect(cartShowsAddonUpsell([])).toBe(false);
  });
});
