import { describe, expect, it } from 'vitest';
import { parseProductForm } from './form';
import { productAdminQuery, productListSort, readProductBulk } from './products';
import { canFeatureProduct } from './status';

describe('danh sách sản phẩm', () => {
  it('chỉ nhận các kiểu sắp xếp đã định', () => {
    expect(productListSort('price-desc')).toBe('price-desc');
    expect(productListSort('updated')).toBe('newest');
    expect(productListSort(null)).toBe('newest');
  });

  it('giữ tham số lọc hợp lệ và bỏ giá trị lạ', () => {
    expect(productAdminQuery({ query: 'vòng%', status: 'active', sort: 'name', page: 2 })).toBe(
      '/admin/products?q=v%C3%B2ng&status=active&sort=name&page=2',
    );
    expect(productAdminQuery({ category: 4, status: 'active' })).toBe('/admin/products?status=active&category=4');
    expect(productAdminQuery({ category: 0 })).toBe('/admin/products');
    expect(productAdminQuery({ status: 'archived', sort: 'random', notice: 'feature-error' })).toBe(
      '/admin/products?error=feature',
    );
  });

  it('đọc thao tác hàng loạt: lọc trùng, bỏ ID sai, từ chối hành động lạ và quá 100 sản phẩm', () => {
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
    for (let id = 1; id <= 101; id += 1) many.append('ids', String(id));
    expect(readProductBulk(many)).toBe(null);
    many.delete('ids');
    for (let id = 1; id <= 100; id += 1) many.append('ids', String(id));
    expect(readProductBulk(many)?.ids).toHaveLength(100);

    expect(productAdminQuery({ status: 'active', bulk: { action: 'delete', count: 2 } })).toBe(
      '/admin/products?status=active&bulk=delete&n=2',
    );
    expect(productAdminQuery({ bulk: 'error' })).toBe('/admin/products?error=bulk');
  });

  it('không cho sản phẩm ngừng bán được đánh dấu nổi bật', () => {
    expect(canFeatureProduct('inactive', true)).toBe(false);
    expect(canFeatureProduct('active', true)).toBe(true);
    const form = new FormData();
    form.set('name', 'Vòng mẫu');
    form.set('slug', 'vong-mau');
    form.set('price', '120000');
    form.set('description', 'Mô tả sản phẩm mẫu.');
    form.set('coverMediaId', '');
    form.set('options', '');
    form.set('status', 'inactive');
    form.set('sortOrder', '0');
    form.set('seoTitle', 'Tiêu đề SEO');
    form.set('metaDescription', 'Mô tả SEO');
    form.set('featured', '1');
    const parsed = parseProductForm(form);
    expect(parsed.ok && parsed.input.isFeatured).toBe(false);
    expect(parsed.ok && parsed.input.seoTitle).toBe('Tiêu đề SEO');
    expect(parsed.ok && parsed.input.comparePrice).toBe(null);
    expect(parsed.ok && parsed.input.categoryId).toBe(null);
    expect(parsed.ok && parsed.input.cordType).toBe('');
  });

  it('nhận giá gốc, danh mục và kiểu dây', () => {
    const form = productForm();
    form.set('comparePrice', '180000');
    form.set('categoryId', '4');
    form.set('cordType', 'Dây rút');
    const parsed = parseProductForm(form);
    expect(parsed.ok && parsed.input.comparePrice).toBe(180000);
    expect(parsed.ok && parsed.input.categoryId).toBe(4);
    expect(parsed.ok && parsed.input.cordType).toBe('Dây rút');
    const elastic = productForm();
    elastic.set('cordType', 'Dây co giãn');
    expect(parseProductForm(elastic).ok).toBe(true);
    const unknown = productForm();
    unknown.set('cordType', 'Chun');
    const rejected = parseProductForm(unknown);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.errors.cordType).toBe('Kiểu dây không hợp lệ.');

    const invalid = productForm();
    invalid.set('categoryId', 'nhom');
    const bad = parseProductForm(invalid);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.categoryId).toBe('Danh mục không hợp lệ.');
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
});

function productForm(): FormData {
  const form = new FormData();
  form.set('name', 'Vòng mẫu');
  form.set('slug', 'vong-mau');
  form.set('price', '120000');
  form.set('description', 'Mô tả sản phẩm mẫu.');
  form.set('coverMediaId', '');
  form.set('options', '');
  form.set('status', 'active');
  form.set('sortOrder', '0');
  form.set('seoTitle', '');
  form.set('metaDescription', '');
  return form;
}
