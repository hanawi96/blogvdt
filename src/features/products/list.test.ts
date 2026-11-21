import { describe, expect, it } from 'vitest';
import { audienceCardLabel, readAudience } from './audience';
import { cordCardLabel, productCardName } from './cord';
import { parseProductForm, ratingFormValue } from './form';
import { productMarginAttr, productMarginBand } from '../materials/costing';
import {
  DEFAULT_PRODUCT_LIST_SORT,
  productAdminQuery,
  productListCord,
  productListMargin,
  productListSort,
  productListView,
  readProductBulk,
} from './products';
import { isPubliclySellable } from './status';

describe('danh sách sản phẩm', () => {
  it('chỉ nhận các kiểu sắp xếp đã định', () => {
    expect(productListSort('price-desc')).toBe('price-desc');
    expect(productListSort('stock-asc')).toBe('stock-asc');
    expect(productListSort('stock-desc')).toBe('stock-desc');
    expect(productListSort('sold-desc')).toBe('sold-desc');
    expect(productListSort('updated')).toBe(DEFAULT_PRODUCT_LIST_SORT);
    expect(productListSort(null)).toBe('sold-desc');
  });

  it('giữ tham số lọc hợp lệ và bỏ giá trị lạ', () => {
    expect(productAdminQuery({ query: 'vòng%', status: 'active', sort: 'name', page: 2 })).toBe(
      '/admin/products?q=v%C3%B2ng&status=active&sort=name&page=2',
    );
    expect(productAdminQuery({ category: 4, status: 'active' })).toBe('/admin/products?status=active&category=4');
    expect(productAdminQuery({ category: 0 })).toBe('/admin/products');
    expect(productAdminQuery({ cord: 'adjustable', sort: 'stock-desc' })).toBe(
      '/admin/products?cord=adjustable&sort=stock-desc',
    );
    expect(productAdminQuery({ sort: 'sold-desc' })).toBe('/admin/products');
    expect(productAdminQuery({ view: 'list', status: 'active' })).toBe('/admin/products?status=active&view=list');
    expect(productAdminQuery({ view: 'cards' })).toBe('/admin/products');
    expect(productAdminQuery({ margin: 'low', status: 'active' })).toBe('/admin/products?status=active&margin=low');
    expect(productAdminQuery({ margin: 'weird' })).toBe('/admin/products');
    expect(productListView('list')).toBe('list');
    expect(productListView(null)).toBe('cards');
    expect(productListView('grid')).toBe('cards');
    expect(productListMargin('high')).toBe('high');
    expect(productListMargin('none')).toBe('none');
    expect(productListMargin('x')).toBe('');
    expect(productMarginBand(null)).toBe('none');
    expect(productMarginBand(-5)).toBe('loss');
    expect(productMarginBand(10)).toBe('low');
    expect(productMarginBand(20)).toBe('mid');
    expect(productMarginBand(40)).toBe('high');
    expect(productMarginAttr(-5)).toBe('low');
    expect(productMarginAttr(40)).toBe('high');
    expect(productListCord('elastic')).toBe('elastic');
    expect(productListCord('Dây co giãn')).toBe('elastic');
    expect(productListCord('Chun')).toBe('');
    expect(productAdminQuery({ status: 'archived', sort: 'random', notice: 'deleted' })).toBe(
      '/admin/products?deleted=1',
    );
  });

  it('đọc thao tác hàng loạt: lọc trùng, bỏ ID sai, từ chối hành động lạ và quá 20 sản phẩm', () => {
    const form = new FormData();
    form.set('bulk', 'inactive');
    for (const id of ['3', '3', '7', 'abc', '-1', '2.5', '0']) form.append('ids', id);
    expect(readProductBulk(form)).toEqual({ action: 'inactive', ids: [3, 7] });

    form.set('bulk', 'archive');
    expect(readProductBulk(form)).toBe(null);

    const empty = new FormData();
    empty.set('bulk', 'delete');
    expect(readProductBulk(empty)).toBe(null);

    const many = new FormData();
    many.set('bulk', 'delete');
    for (let id = 1; id <= 21; id += 1) many.append('ids', String(id));
    expect(readProductBulk(many)).toBe(null);
    many.delete('ids');
    for (let id = 1; id <= 20; id += 1) many.append('ids', String(id));
    expect(readProductBulk(many)?.ids).toHaveLength(20);

    expect(productAdminQuery({ status: 'active', bulk: { action: 'delete', count: 2 } })).toBe(
      '/admin/products?status=active&bulk=delete&n=2',
    );
    expect(productAdminQuery({ bulk: 'error' })).toBe('/admin/products?error=bulk');
  });

  it('ẩn sản phẩm khi danh mục tạm tắt', () => {
    expect(isPubliclySellable({ status: 'active', categoryStatus: null })).toBe(true);
    expect(isPubliclySellable({ status: 'active', categoryStatus: 'active' })).toBe(true);
    expect(isPubliclySellable({ status: 'active', categoryStatus: 'inactive' })).toBe(false);
    expect(isPubliclySellable({ status: 'inactive', categoryStatus: 'active' })).toBe(false);
  });

  it('nhận form sản phẩm ngừng bán và SEO', () => {
    const form = new FormData();
    form.set('name', 'Vòng mẫu');
    form.set('slug', 'vong-mau');
    form.set('price', '120000');
    form.set('description', 'Mô tả sản phẩm mẫu.');
    form.set('coverMediaId', '');
    form.set('status', 'inactive');
    form.set('sortOrder', '0');
    form.set('seoTitle', 'Tiêu đề SEO');
    form.set('metaDescription', 'Mô tả SEO');
    const parsed = parseProductForm(form);
    expect(parsed.ok && parsed.input.status).toBe('inactive');
    expect(parsed.ok && parsed.input.seoTitle).toBe('Tiêu đề SEO');
    expect(parsed.ok && parsed.input.comparePrice).toBe(null);
    expect(parsed.ok && parsed.input.categoryIds).toEqual([]);
    expect(parsed.ok && parsed.input.cordType).toBe('');
    expect(parsed.ok && parsed.input.audience).toBe('none');
  });

  it('nhận đối tượng đeo và từ chối giá trị lạ', () => {
    expect(readAudience(undefined)).toBe('none');
    expect(audienceCardLabel('none')).toBe('');
    expect(audienceCardLabel('both')).toBe('Cho cả bé trai & bé gái');
    expect(audienceCardLabel('boy')).toBe('Cho bé trai');
    expect(audienceCardLabel('girl')).toBe('Cho bé gái');
    const both = productForm();
    both.set('audience', 'both');
    const parsedBoth = parseProductForm(both);
    expect(parsedBoth.ok && parsedBoth.input.audience).toBe('both');
    const bad = productForm();
    bad.set('audience', 'unisex');
    const rejected = parseProductForm(bad);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.errors.audience).toBe('Đối tượng đeo không hợp lệ.');
  });

  it('nhận giá gốc, danh mục và kiểu dây', () => {
    const form = productForm();
    form.set('comparePrice', '180000');
    form.append('categoryIds', '4');
    form.append('categoryIds', '7');
    form.set('cordType', 'adjustable');
    const parsed = parseProductForm(form);
    expect(parsed.ok && parsed.input.comparePrice).toBe(180000);
    expect(parsed.ok && parsed.input.categoryIds).toEqual([4, 7]);
    expect(parsed.ok && parsed.input.cordType).toBe('adjustable');
    const elastic = productForm();
    elastic.set('cordType', 'elastic');
    expect(parseProductForm(elastic).ok).toBe(true);
    const other = productForm();
    other.set('cordType', 'other');
    const otherParsed = parseProductForm(other);
    expect(otherParsed.ok && otherParsed.input.cordType).toBe('other');
    const unknown = productForm();
    unknown.set('cordType', 'Chun');
    const rejected = parseProductForm(unknown);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.errors.cordType).toBe('Kiểu dây không hợp lệ.');

    const invalid = productForm();
    invalid.append('categoryIds', 'nhom');
    const bad = parseProductForm(invalid);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.categoryIds).toBe('Danh mục không hợp lệ.');
  });

  it('tiền tố tên card theo kiểu dây', () => {
    expect(productCardName('Vòng mix bạc', 'adjustable')).toBe('[DÂY RÚT] Vòng mix bạc');
    expect(productCardName('Vòng mix bạc', 'elastic')).toBe('[CO GIÃN] Vòng mix bạc');
    expect(productCardName('Vòng mix bạc', 'Dây rút')).toBe('[DÂY RÚT] Vòng mix bạc');
    expect(productCardName('Vòng mix bạc', 'other')).toBe('Vòng mix bạc');
    expect(productCardName('Vòng mix bạc', '')).toBe('Vòng mix bạc');
    expect(productCardName('Vòng mix bạc', null)).toBe('Vòng mix bạc');
    expect(cordCardLabel('adjustable')).toBe('Dây rút');
    expect(cordCardLabel('elastic')).toBe('Co giãn');
    expect(cordCardLabel('other')).toBe('');
    expect(cordCardLabel('')).toBe('');
  });

  it('từ chối giá gốc không lớn hơn giá bán', () => {
    const low = productForm();
    low.set('comparePrice', '120000');
    const same = parseProductForm(low);
    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.errors.comparePrice).toBe('Giá gốc phải lớn hơn giá bán.');

    const invalid = productForm();
    invalid.set('comparePrice', '18a');
    const bad = parseProductForm(invalid);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.comparePrice).toBe('Giá gốc là số nguyên VND.');
  });

  it('nhận tồn kho và điểm đánh giá (lưu ×10)', () => {
    const form = productForm();
    form.set('stockQty', '25');
    form.set('rating', '4.5');
    const parsed = parseProductForm(form);
    expect(parsed.ok && parsed.input.stockQty).toBe(25);
    expect(parsed.ok && parsed.input.rating).toBe(45);
    expect(ratingFormValue(45)).toBe('4.5');
    expect(ratingFormValue(0)).toBe('');

    const empty = productForm();
    const defaults = parseProductForm(empty);
    expect(defaults.ok && defaults.input.stockQty).toBe(0);
    expect(defaults.ok && defaults.input.rating).toBe(0);

    const badStock = productForm();
    badStock.set('stockQty', '-1');
    expect(parseProductForm(badStock).ok).toBe(false);

    const badRating = productForm();
    badRating.set('rating', '5.1');
    const rejected = parseProductForm(badRating);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.errors.rating).toContain('0 đến 5');
  });
});

function productForm(): FormData {
  const form = new FormData();
  form.set('name', 'Vòng mẫu');
  form.set('slug', 'vong-mau');
  form.set('price', '120000');
  form.set('description', 'Mô tả sản phẩm mẫu.');
  form.set('coverMediaId', '');
  form.set('status', 'active');
  form.set('sortOrder', '0');
  form.set('stockQty', '0');
  form.set('rating', '');
  form.set('seoTitle', '');
  form.set('metaDescription', '');
  return form;
}
